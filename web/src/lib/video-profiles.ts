// WorldCodes「视频专用」分组的在售型号（渠道 26，2026-10-25 按 ai666 /v1/models 下架 6 个已不存在的 seedance/sd 型号）。时长/分辨率/参考素材上限取自上游广场说明与网关校验；
// 没写明的参考素材上限按同系列厂商文档取保守值。durations 表示上游只接受这几档时长。
export type VideoProfile = { min: number; max: number; durations?: number[]; defaultSeconds: number; resolutions: string[]; images: number; videos: number; audios: number };
const profile = (min: number, max: number, resolutions: string[], images: number, videos: number, audios: number, defaultSeconds = 5): VideoProfile => ({ min, max, defaultSeconds, resolutions, images, videos, audios });
const discrete = (durations: number[], resolutions: string[], images: number, videos: number, audios: number, defaultSeconds = durations[0]): VideoProfile => ({ ...profile(durations[0], durations[durations.length - 1], resolutions, images, videos, audios, defaultSeconds), durations });
const seedance20 = (resolutions: string[], videos = 3) => profile(4, 15, resolutions, 9, videos, 3);
const sd25 = (resolution: string) => profile(4, 30, [resolution], 30, 10, 10);
const wan = (resolutions: string[], max = 15) => profile(2, max, resolutions, 10, 5, 5);

export const videoProfiles: Record<string, VideoProfile> = {
    "MiniMax-H3": profile(1, 15, ["768p"], 9, 3, 3),
    "grok-imagine-video-1.5-preview": profile(1, 15, ["480p", "720p"], 1, 0, 0),
    omni: discrete([4, 6, 8, 10], ["720p", "1080p"], 7, 0, 0, 8),
    "sd-2.0-480p": seedance20(["480p"], 0),
    "sd-2.0-720p-plus": seedance20(["720p"], 0),
    "sd-2.5-480p": sd25("480p"),
    "sd-2.5-480p-plus": sd25("480p"),
    "sd-2.5-720p": sd25("720p"),
    "sd-2.5-720p-plus": sd25("720p"),
    "sd-2.5-720p-pro": sd25("720p"),
    "seedance-2.0-720p": seedance20(["720p"]),
    "seedance-2.0-mini": seedance20(["480p", "720p"]),
    "seedance-2.5-720p-pro": profile(4, 30, ["720p"], 30, 0, 10),
    "wan-3.0": wan(["720p", "1080p"]),
    "wan-3.0-1080p": wan(["1080p"]),
    "wan-3.0-720p-30s": discrete([30], ["720p"], 10, 5, 5),
    "wan-3.0-1080p-30s": discrete([30], ["1080p"], 10, 5, 5),
    "wan-3.0-1080p-30s-pro": discrete([30], ["1080p"], 10, 5, 5),
    "wan-3.0-per-second": wan(["720p"], 30),
    "wan-3.0-per-second-1080": wan(["1080p"], 30),
};
const VIDEO_PROFILE_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

export function videoProfile(model: string) { return videoProfiles[model.split("::").pop() || ""]; }
export function normalizeProfileVideo(model: string, seconds: string, resolution: string, ratio: string) {
    const p = videoProfile(model);
    if (!p) return { videoSeconds: seconds, vquality: resolution, size: ratio };
    const n = Math.round(Number(seconds));
    const valid = Number.isFinite(n) && n > 0;
    const videoSeconds = p.durations
        ? (valid ? p.durations.reduce((best, item) => (Math.abs(item - n) < Math.abs(best - n) ? item : best)) : p.defaultSeconds)
        : (valid ? Math.max(p.min, Math.min(p.max, n)) : p.defaultSeconds);
    const quality = `${resolution.trim().toLowerCase().replace(/p$/, "")}p`;
    return {
        videoSeconds: String(videoSeconds),
        vquality: p.resolutions.includes(quality) ? quality : p.resolutions[0],
        size: VIDEO_PROFILE_RATIOS.includes(ratio) ? ratio : "16:9",
    };
}
