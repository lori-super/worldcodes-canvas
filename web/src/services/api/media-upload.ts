import axios from "axios";

import i18n from "@/i18n";
import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";

type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string };

type PresignedUpload = {
    id: string;
    method: "PUT";
    upload_url: string;
    asset_url: string;
    headers?: Record<string, string>;
    expires_at: number;
};

type CompletedUpload = {
    id: string;
    status: "ready";
    asset_url: string;
    expires_at: number;
};

export type TemporaryMediaUpload = {
    id: string;
    assetUrl: string;
    expiresAt: number;
};

function authHeaders(config: AiConfig) {
    return { Authorization: `Bearer ${config.apiKey}` };
}

function unwrap<T>(payload: ApiEnvelope<T>): T {
    if (payload && typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(payload.msg || payload.message || i18n.t("apiErrors.videoTaskCreateFailed"));
        if (!payload.data) throw new Error(i18n.t("apiErrors.videoTaskCreateFailed"));
        return payload.data;
    }
    return payload as T;
}

/** Upload directly to the Relay-issued object-store URL; the media bytes never pass through Relay. */
export async function uploadTemporaryMedia(config: AiConfig, blob: Blob, filename: string, signal?: AbortSignal): Promise<TemporaryMediaUpload> {
    const presigned = unwrap(
        (
            await axios.post<ApiEnvelope<PresignedUpload>>(
                buildApiUrl(config.baseUrl, "/media/uploads/presign"),
                { filename, content_type: blob.type || "application/octet-stream", size_bytes: blob.size },
                { headers: { ...authHeaders(config), "Content-Type": "application/json" }, signal },
            )
        ).data,
    );
    if (!presigned.id || presigned.method !== "PUT" || !presigned.upload_url) throw new Error(i18n.t("apiErrors.videoTaskCreateFailed"));

    try {
        const uploadHeaders = { ...(presigned.headers || {}) };
        if (!Object.keys(uploadHeaders).some((key) => key.toLowerCase() === "content-type")) uploadHeaders["Content-Type"] = blob.type || "application/octet-stream";
        await axios.put(presigned.upload_url, blob, { headers: uploadHeaders, signal });
        const completed = unwrap((await axios.post<ApiEnvelope<CompletedUpload>>(buildApiUrl(config.baseUrl, `/media/uploads/${encodeURIComponent(presigned.id)}/complete`), undefined, { headers: authHeaders(config), signal })).data);
        if (completed.status !== "ready") throw new Error(i18n.t("apiErrors.videoTaskCreateFailed"));
        return { id: completed.id, assetUrl: completed.asset_url || presigned.asset_url, expiresAt: completed.expires_at || presigned.expires_at };
    } catch (error) {
        await deleteTemporaryMedia(config, [presigned.id]);
        throw error;
    }
}

export async function deleteTemporaryMedia(config: AiConfig, ids: Iterable<string>) {
    await Promise.allSettled(Array.from(new Set(ids)).map((id) => axios.delete(buildApiUrl(config.baseUrl, `/media/uploads/${encodeURIComponent(id)}`), { headers: authHeaders(config) })));
}
