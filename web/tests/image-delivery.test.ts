import { expect, test } from "bun:test";
import { imageDownloadUrl } from "../src/lib/image-delivery";

const id = "9c8e0957-5084-4dfd-996b-189c7ba1f632";
const result = `https://download.xmimage2.cc.cd/r2/images/${id}`;
const origin = "https://canvas.worldcodes.online";

test("production result retrieval uses the fixed same-origin route", () => {
    expect(imageDownloadUrl(result, origin)).toBe(`/v1/images/content/pandatk/${id}`);
});

test("local preview, other providers and non-production installations retain their routes", () => {
    for (const input of ["data:image/png;base64,AA==", "blob:https://canvas.worldcodes.online/1", "/local.png", "https://other.example/image.png"]) {
        expect(imageDownloadUrl(input, origin)).toBe(input);
    }
    expect(imageDownloadUrl(result, "http://localhost:3000")).toBe(result);
});

test("credentials, query strings and deceptive hosts never enter the fixed upstream route", () => {
    for (const input of [result + "?url=https://other.example", result + "#x", result.replace("https://", "https://user:pass@"), result.replace(".cc.cd", ".cc.cd.evil.example"), result.replace(id, "..%2fsecret"), result.replace("https:", "http:")]) {
        expect(imageDownloadUrl(input, origin)).toBe(input);
    }
});
