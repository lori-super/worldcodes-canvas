const pandaImagePath = /^\/r2\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Only the production canvas exposes this fixed-origin, credential-free image route. */
export function imageDownloadUrl(input: string, pageOrigin = globalThis.location?.origin): string {
    if (pageOrigin !== "https://canvas.worldcodes.online") return input;
    try {
        const url = new URL(input);
        const match = url.pathname.match(pandaImagePath);
        if (url.origin === "https://download.xmimage2.cc.cd" && !url.username && !url.password && !url.search && !url.hash && match) {
            return `/v1/images/content/pandatk/${match[1]}`;
        }
    } catch { /* Local blobs and data URLs retain their original path. */ }
    return input;
}
