import { beforeEach, expect, mock, test } from "bun:test";

const post = mock(async () => ({
    data: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AA==" } }] } }],
    },
}));

mock.module("axios", () => ({
    default: { post, isCancel: () => false, isAxiosError: () => false },
}));

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://canvas.worldcodes.online/" } });

beforeEach(() => post.mockClear());

test("Nano Banana 2 uses Gemini imageConfig with an explicit image size", async () => {
    const { requestGeneration } = await import("../src/services/api/image");
    const { defaultConfig } = await import("../src/stores/use-config-store");
    const model = "worldcodes::nano-banana-2";
    const config = {
        ...defaultConfig,
        model,
        imageModel: model,
        quality: "low",
        size: "1:1",
        channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "test-key" })),
    };

    await requestGeneration(config, "测试提示词");

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, options] = post.mock.calls[0];
    expect(url).toBe("/v1beta/models/nano-banana-2:generateContent");
    expect(body.generationConfig).toEqual({
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
    });
    expect(options.headers["x-goog-api-key"]).toBe("test-key");
});

test("the formal WorldCodes origin keeps the Nano Banana Relay route", async () => {
    const { requestGeneration } = await import("../src/services/api/image");
    const { defaultConfig } = await import("../src/stores/use-config-store");
    const model = "worldcodes::nano-banana-2";
    const config = {
        ...defaultConfig,
        model,
        imageModel: model,
        channels: defaultConfig.channels.map((channel) => ({
            ...channel,
            baseUrl: "https://worldcodes.online",
            apiKey: "formal-key",
        })),
    };

    await requestGeneration(config, "测试提示词");

    const [url, , options] = post.mock.calls[0];
    expect(url).toBe("https://worldcodes.online/v1beta/models/nano-banana-2:generateContent");
    expect(options.headers["x-goog-api-key"]).toBe("formal-key");
});

test("external Gemini uses the supported imageConfig payload", async () => {
    const { requestGeneration } = await import("../src/services/api/image");
    const { defaultConfig } = await import("../src/stores/use-config-store");
    const model = "gemini::gemini-3-pro-image-preview";
    const config = {
        ...defaultConfig,
        model,
        imageModel: model,
        quality: "high",
        size: "16:9",
        channels: [{
            id: "gemini",
            name: "Gemini",
            baseUrl: "https://generativelanguage.googleapis.com",
            apiKey: "gemini-key",
            apiFormat: "gemini" as const,
            models: [{ name: "gemini-3-pro-image-preview", capability: "image" as const }],
        }],
    };

    await requestGeneration(config, "测试提示词");

    const [, body] = post.mock.calls[0];
    expect(body.generationConfig).toEqual({
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
    });
});

test("GPT Image generation omits response_format and preserves returned URLs", async () => {
    const { requestGeneration } = await import("../src/services/api/image");
    const { defaultConfig } = await import("../src/stores/use-config-store");
    post.mockResolvedValueOnce({ data: { data: [{ url: "https://download.xmimage2.cc.cd/r2/images/9c8e0957-5084-4dfd-996b-189c7ba1f632" }] } } as never);
    const result = await requestGeneration({ ...defaultConfig, model: "worldcodes::gpt-image-2" }, "test");
    expect(post.mock.calls[0][0]).toBe("/v1/images/generations");
    expect(post.mock.calls[0][1]).not.toHaveProperty("response_format");
    expect(result[0].dataUrl).toContain("/r2/images/");
});

test("multi-reference GPT Image edits send image[] and omit response_format", async () => {
    const { requestEdit } = await import("../src/services/api/image");
    const { defaultConfig } = await import("../src/stores/use-config-store");
    post.mockResolvedValueOnce({ data: { data: [{ b64_json: "AA==" }] } } as never);
    const ref = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" };
    await requestEdit({ ...defaultConfig, model: "worldcodes::gpt-image-2" }, "test", [ref, { ...ref, id: "ref2" }]);
    const form = post.mock.calls[0][1] as unknown as FormData;
    expect(form.getAll("image[]")).toHaveLength(2);
    expect(form.has("image")).toBe(false);
    expect(form.has("response_format")).toBe(false);
});
