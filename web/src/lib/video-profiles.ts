// WorldCodes video group: only tiers verified against upstream billing are shown.
export type VideoProfile = { min: number; max: number; seconds: number[]; resolutions: string[]; images: number; videos: number; audios: number };
const profile = (min: number, max: number, resolutions: string[], images = 9, videos = 3, audios = 3): VideoProfile => ({ min, max, resolutions, images, videos, audios, seconds: [...new Set([min, 5, 10, 15, 20, 30])].filter(n => n >= min && n <= max) });
export const videoProfiles: Record<string, VideoProfile> = {
    "grok-imagine-video": profile(1, 15, ["480p"], 7, 0, 0),
    "grok-imagine-video-1.5-preview": profile(1, 15, ["480p"], 7, 0, 0),
    "seedance2.5": profile(4, 30, ["480p"], 30, 10, 10),
    "kling-video-v3-omni": profile(3, 15, ["720p"]),
    "kling-video-v3-turbo": profile(3, 15, ["720p"]),
};
export function videoProfile(model: string) { return videoProfiles[model.split("::").pop() || ""]; }
export function normalizeProfileVideo(model: string, seconds: string, resolution: string, ratio: string) {
    const p = videoProfile(model);
    if (!p) return { videoSeconds: seconds, vquality: resolution, size: ratio };
    const n = Number(seconds);
    const discrete = model.includes("drama-video-");
    return {
        videoSeconds: String(Number.isInteger(n) && n >= p.min && n <= p.max && (!discrete || p.seconds.includes(n)) ? n : p.min),
        vquality: p.resolutions.includes(resolution.toLowerCase()) ? resolution.toLowerCase() : p.resolutions[0],
        size: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(ratio) ? ratio : "16:9",
    };
}
