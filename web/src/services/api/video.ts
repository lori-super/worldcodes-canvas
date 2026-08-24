import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { deleteTemporaryMedia, uploadTemporaryMedia } from "./media-upload";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id?: string; task_id?: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationReferences = { images?: ReferenceImage[]; videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
export type VideoGenerationTask = { id: string; provider: "openai" | "plugin"; model: string; temporaryUploadIds?: string[] };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: VideoGenerationReferences = {}, options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, options);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error(apiText("videoTimeout", { provider: "" }));
        await delay(2500, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: VideoGenerationReferences = {}, options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        assertStandardVideoReferences(references);
        return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references.images || [], options);
    }
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isMiniMaxH3(requestConfig.model)) return createMiniMaxH3Task(requestConfig, selectedModel, prompt, references, options);
    assertStandardVideoReferences(references, 7);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references.images || [], options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

type MiniMaxH3Content =
    | { type: "text"; text: string }
    | { type: "image_url"; upload_id?: string; image_url: { url?: string; role: "first_frame" | "last_frame" | "reference_image" } }
    | { type: "video_url"; upload_id?: string; video_url: { url?: string; role: "reference_video" } }
    | { type: "audio_url"; upload_id?: string; audio_url: { url?: string; role: "reference_audio" } };

async function createMiniMaxH3Task(config: AiConfig, model: string, prompt: string, references: VideoGenerationReferences, options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!prompt.trim()) throw new Error(apiText("videoPromptRequired"));
    const prepared = await prepareMiniMaxH3Content(config, prompt, references, options?.signal);
    try {
        const created = unwrapVideoResponse(
            (
                await axios.post<ApiVideoResponse>(
                    aiApiUrl(config, "/videos"),
                    {
                        model: "MiniMax-H3",
                        duration: normalizeMiniMaxH3Duration(config.videoSeconds),
                        ratio: normalizeMiniMaxH3Ratio(config.size),
                        resolution: normalizeMiniMaxH3Resolution(config.vquality),
                        content: prepared.content,
                    },
                    { headers: aiHeaders(config, "application/json"), signal: options?.signal },
                )
            ).data,
        );
        const id = created.id || created.task_id;
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "openai", model, temporaryUploadIds: prepared.uploadIds };
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (!axios.isAxiosError(error) || (status !== undefined && status >= 400 && status < 500)) await deleteTemporaryMedia(config, prepared.uploadIds);
        // A network error or 5xx may still have created the upstream task. Keep uploads until lifecycle expiry.
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function prepareMiniMaxH3Content(config: AiConfig, prompt: string, references: VideoGenerationReferences, signal?: AbortSignal) {
    const content: MiniMaxH3Content[] = [{ type: "text", text: prompt }];
    const uploadIds: string[] = [];

    try {
        for (const image of references.images || []) {
            const role = image.role || "reference_image";
            const url = publicReferenceUrl(image.dataUrl || image.url);
            if (url) {
                content.push({ type: "image_url", image_url: { url, role } });
                continue;
            }
            const blob = (image.storageKey ? await getImageBlob(image.storageKey) : null) || (await referenceBlob(image.dataUrl || image.url));
            if (!blob) throw new Error(apiText("referenceImageReadFailed"));
            await assertMiniMaxH3ReferenceDimensions(blob, "image");
            const upload = await uploadTemporaryMedia(config, blob, image.name || "reference.png", signal);
            uploadIds.push(upload.id);
            content.push({ type: "image_url", upload_id: upload.id, image_url: { role } });
        }

        for (const video of references.videos || []) {
            const url = publicReferenceUrl(video.url);
            if (url) {
                content.push({ type: "video_url", video_url: { url, role: "reference_video" } });
                continue;
            }
            const blob = (video.storageKey ? await getMediaBlob(video.storageKey) : null) || (await referenceBlob(video.url));
            if (!blob) throw new Error(apiText("invalidReferenceVideo"));
            await assertMiniMaxH3ReferenceDimensions(blob, "video");
            const upload = await uploadTemporaryMedia(config, blob, video.name || "reference.mp4", signal);
            uploadIds.push(upload.id);
            content.push({ type: "video_url", upload_id: upload.id, video_url: { role: "reference_video" } });
        }

        for (const audio of references.audios || []) {
            const url = publicReferenceUrl(audio.url);
            if (url) {
                content.push({ type: "audio_url", audio_url: { url, role: "reference_audio" } });
                continue;
            }
            const blob = (audio.storageKey ? await getMediaBlob(audio.storageKey) : null) || (await referenceBlob(audio.url));
            if (!blob) throw new Error(apiText("invalidReferenceAudio"));
            const upload = await uploadTemporaryMedia(config, blob, audio.name || "reference.mp3", signal);
            uploadIds.push(upload.id);
            content.push({ type: "audio_url", upload_id: upload.id, audio_url: { role: "reference_audio" } });
        }
        return { content, uploadIds };
    } catch (error) {
        await deleteTemporaryMedia(config, uploadIds);
        throw error;
    }
}

async function referenceBlob(value?: string) {
    if (!value || isPublicMediaUrl(value)) return null;
    try {
        return await (await fetch(value)).blob();
    } catch {
        return null;
    }
}

function publicReferenceUrl(value?: string) {
    return value && /^https:\/\//i.test(value) ? value : "";
}

async function assertMiniMaxH3ReferenceDimensions(blob: Blob, kind: "image" | "video") {
    const objectUrl = URL.createObjectURL(blob);
    try {
        const { width, height } = kind === "image" ? await loadImageDimensions(objectUrl) : await loadVideoDimensions(objectUrl);
        if (width < 256 || width > 5760 || height < 256 || height > 5760) {
            throw new Error(i18n.t(`apiReferenceDimensions.${kind}`, { width, height }));
        }
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function loadImageDimensions(url: string) {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error(apiText("referenceImageReadFailed")));
        image.src = url;
    });
}

function loadVideoDimensions(url: string) {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => reject(new Error(apiText("invalidReferenceVideo")));
        video.src = url;
    });
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) {
            const result = await videoResultFromUrl(url, options);
            await cleanupTaskUploads(config, task);
            return { status: "completed", result };
        }
        if (video.status === "completed" || video.status === "succeeded") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            await cleanupTaskUploads(config, task);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") {
            await cleanupTaskUploads(config, task);
            return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        }
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function cleanupTaskUploads(config: AiConfig, task: VideoGenerationTask) {
    if (task.temporaryUploadIds?.length) await deleteTemporaryMedia(config, task.temporaryUploadIds);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    if (config.apiFormat === "gemini") throw new Error(apiText("geminiVideoUnsupported"));
}

function assertStandardVideoReferences(references: VideoGenerationReferences, maxImages?: number) {
    if (references.videos?.length || references.audios?.length || references.images?.some((image) => image.role && image.role !== "reference_image")) throw new Error(apiText("h3ReferencesOnly"));
    if (maxImages && (references.images?.length || 0) > maxImages) throw new Error(apiText("standardVideoImageLimit", { count: maxImages }));
}

function isMiniMaxH3(model: string) {
    return modelOptionName(model).toLowerCase() === "minimax-h3";
}

function normalizeMiniMaxH3Duration(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return Math.max(4, Math.min(15, seconds));
}

function normalizeMiniMaxH3Ratio(value: string) {
    const supported = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
    if (value === "auto") return "adaptive";
    if (supported.includes(value as (typeof supported)[number])) return value;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return "1:1";
    const target = Number(match[1]) / Number(match[2]);
    return supported.slice(1).reduce((best, ratio) => {
        const [width, height] = ratio.split(":").map(Number);
        const [bestWidth, bestHeight] = best.split(":").map(Number);
        return Math.abs(width / height - target) < Math.abs(bestWidth / bestHeight - target) ? ratio : best;
    });
}

function normalizeMiniMaxH3Resolution(value: string) {
    const normalized = value.trim().toUpperCase().replace(/P$/, "");
    if (normalized === "768") return "768P";
    if (normalized === "1080") return "1080P";
    if (normalized === "2K" || normalized === "2048") return "2K";
    return "720P";
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("corsRequired");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
