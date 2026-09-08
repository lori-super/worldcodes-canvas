import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { videoProfile, normalizeProfileVideo } from "@/lib/video-profiles";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { deleteTemporaryMedia, uploadTemporaryMedia } from "./media-upload";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id?: string; task_id?: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
export type VideoDeliveryProgress = { phase: "generating" | "downloading" | "saving"; loaded?: number; total?: number };
type RequestOptions = { signal?: AbortSignal; onProgress?: (progress: VideoDeliveryProgress) => void };
type VideoRequestOptions = RequestOptions & { task?: VideoGenerationTask; onTaskCreated?: (task: VideoGenerationTask) => Promise<void> };
export const VIDEO_QUERY_TIMEOUT_MS = 30_000;
export const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationReferences = { images?: ReferenceImage[]; videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "plugin"; model: string; temporaryUploadIds?: string[] };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
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

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: VideoGenerationReferences = {}, options?: VideoRequestOptions): Promise<VideoGenerationResult> {
    const task = options?.task || await createVideoGenerationTask(config, prompt, references, options);
    if (!options?.task) await options?.onTaskCreated?.(task);
    for (let attempt = 0; attempt < 360; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        if (attempt === 359) throw new Error(apiText("videoTimeout", { provider: "" }));
        await delay(5000, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
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
    if (videoProfile(requestConfig.model)) return createCompatibleVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (isMiniMaxH3(requestConfig.model)) return createMiniMaxH3Task(requestConfig, selectedModel, prompt, references, options);
    const mediaOptions = { ...options, videos: references.videos, audios: references.audios };
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references.images || [], mediaOptions);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references.images || [], mediaOptions);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length),
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

async function createCompatibleVideoTask(config: AiConfig, model: string, prompt: string, references: VideoGenerationReferences, options?: RequestOptions): Promise<VideoGenerationTask> {
    const name = modelOptionName(model);
    const profile = videoProfile(name)!;
    const images = references.images || [], videos = references.videos || [], audios = references.audios || [];
    if (!prompt.trim()) throw new Error(apiText("videoPromptRequired"));
    if (images.length > profile.images || videos.length > profile.videos || audios.length > profile.audios) throw new Error(`该模型最多支持 ${profile.images} 张图片、${profile.videos} 个视频和 ${profile.audios} 条音频`);
    const normalized = normalizeProfileVideo(name, config.videoSeconds, config.vquality, config.size);
    const grok = name.startsWith("grok-imagine-video");
    if (grok && ![0, 1, 7].includes(images.length)) throw new Error("Grok 需要 1 张首帧图或恰好 7 张参考图");
    if (name === "grok-imagine-video" && images.length === 7 && Number(normalized.videoSeconds) > 10) throw new Error("Grok 参考图模式最多支持 10 秒");
    const prepared = await prepareMiniMaxH3Content(config, prompt, references, options?.signal);
    try {
        const urls = (type: string) => prepared.content.flatMap(item => {
            if (item.type !== type || item.type === "text") return [];
            const entry = item as Exclude<MiniMaxH3Content, { type: "text" }>;
            const url = entry.upload_id ? prepared.urls[entry.upload_id] : "image_url" in entry ? entry.image_url.url : "video_url" in entry ? entry.video_url.url : entry.audio_url.url;
            return url ? [url] : [];
        });
        const body = { model: name, prompt, seconds: normalized.videoSeconds, resolution: normalized.vquality,
            ...(!(grok && images.length === 1) ? { aspect_ratio: normalized.size } : {}),
            images: urls("image_url"), videos: urls("video_url"), audios: urls("audio_url"),
            ...(grok ? { video_mode: images.length === 1 ? "first_frame" : images.length === 7 ? "reference" : "text" } : {}),
        };
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const id = created.id || created.task_id;
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "openai", model, temporaryUploadIds: prepared.uploadIds };
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status !== undefined && status >= 400 && status < 500) await deleteTemporaryMedia(config, prepared.uploadIds);
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function prepareMiniMaxH3Content(config: AiConfig, prompt: string, references: VideoGenerationReferences, signal?: AbortSignal) {
    const content: MiniMaxH3Content[] = [{ type: "text", text: prompt }];
    const uploadIds: string[] = [];
    const urls: Record<string, string> = {};

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
            urls[upload.id] = upload.assetUrl;
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
            urls[upload.id] = upload.assetUrl;
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
            urls[upload.id] = upload.assetUrl;
            content.push({ type: "audio_url", upload_id: upload.id, audio_url: { role: "reference_audio" } });
        }
        return { content, uploadIds, urls };
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

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    body.append("size", normalizeVideoSize(config.size, config.vquality) || "1280x720");
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    body.append("mode", mode);
    if (mode === "frames") {
        if (images[0]) body.append("first_frame", images[0], "first.png");
        if (images[1]) body.append("last_frame", images[1], "last.png");
    } else {
        images.forEach((file) => body.append("image[]", file, "ref.png"));
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
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
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal, timeout: VIDEO_QUERY_TIMEOUT_MS })).data);
        const url = videoResultUrl(video);
        if (url) {
            const result = await videoResultFromUrl(url, options);
            await cleanupTaskUploads(config, task);
            options?.onProgress?.({ phase: "saving" });
            return { status: "completed", result };
        }
        if (video.status === "completed" || video.status === "succeeded") {
            options?.onProgress?.({ phase: "downloading" });
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), {
                headers: aiHeaders(config), responseType: "blob", signal: options?.signal, timeout: VIDEO_DOWNLOAD_TIMEOUT_MS,
                onDownloadProgress: ({ loaded, total }) => options?.onProgress?.({ phase: "downloading", loaded, total }),
            });
            await assertVideoBlob(content.data);
            await cleanupTaskUploads(config, task);
            options?.onProgress?.({ phase: "saving" });
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") {
            await cleanupTaskUploads(config, task);
            return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        }
        options?.onProgress?.({ phase: "generating" });
        return { status: "pending" };
    } catch (error) {
        if (axios.isAxiosError(error) && ["ECONNABORTED", "ETIMEDOUT"].includes(error.code || "")) throw new Error(i18n.t("videoDelivery.timeout"));
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function cleanupTaskUploads(config: AiConfig, task: VideoGenerationTask) {
    // Temporary uploads also expire server-side; cleanup must not block delivery.
    if (task.temporaryUploadIds?.length) void deleteTemporaryMedia(config, task.temporaryUploadIds).catch(() => {});
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        options?.onProgress?.({ phase: "downloading" });
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal, timeout: VIDEO_DOWNLOAD_TIMEOUT_MS });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                resolution: normalizeVideoResolution(config.vquality),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
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
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
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
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
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
