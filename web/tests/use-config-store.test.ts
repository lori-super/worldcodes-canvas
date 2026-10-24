import { expect, test } from "bun:test";

test("fresh hydration keeps only real WorldCodes presets", async () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        get length() {
            return values.size;
        },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });

    const { guessCapability, useConfigStore } = await import("../src/stores/use-config-store");
    await useConfigStore.persist.rehydrate();

    const config = useConfigStore.getState().config;
    expect(config.channels[0]?.models.map((model) => model.name)).toEqual([
        "gpt-image-2",
        "gpt-image-2.5",
        "gpt-image-2.5-flare",
        "gpt-image-2.5-sunburst",
        "grok-imagine-image-2.0",
        "gemini-3.1-flash-image-preview",
        "gemini-3-pro-image-preview",
        "gpt-5.5",
    ]);
    expect(config.channels[1]?.models).toHaveLength(20);
    expect(config.videoModel).toBe("worldcodes-video::MiniMax-H3");
    expect(config.audioModel).toBe("");
    expect(guessCapability("nano-banana-pro")).toBe("image");
    for (const name of ["omni", "sd-2.5-480p", "seedance-2.0-mini", "wan-3.0", "seedance-3.0-preview"]) expect(guessCapability(name)).toBe("video");
});

test("saved WorldCodes channels gain the current models and move retired selections", async () => {
    const { CONFIG_STORE_KEY, useConfigStore } = await import("../src/stores/use-config-store");
    // Write through the store's own storage: other test files may have installed a different localStorage first.
    await useConfigStore.persist.getOptions().storage?.setItem(CONFIG_STORE_KEY, {
        state: {
            config: {
                channels: [
                    { id: "worldcodes", name: "WorldCodes Relay", baseUrl: "/", apiKey: "image-key", apiFormat: "openai", models: [{ name: "grok-imagine-image-quality", capability: "image" }, { name: "nano-banana-2", capability: "image" }, { name: "my-model", capability: "text" }] },
                    { id: "worldcodes-video", name: "WorldCodes 视频专用", baseUrl: "/", apiKey: "video-key", apiFormat: "openai", models: [{ name: "seedance2.5", capability: "video" }] },
                ],
                model: "worldcodes::nano-banana-2",
                imageModel: "worldcodes::grok-imagine-image-quality",
                videoModel: "worldcodes-video::seedance2.5",
            },
        },
        version: 0,
    } as never);
    await useConfigStore.persist.rehydrate();
    const config = useConfigStore.getState().config;
    expect(config.channels[0]?.apiKey).toBe("image-key");
    expect(config.channels[0]?.models.map((model) => model.name).slice(-2)).toEqual(["gpt-5.5", "my-model"]);
    expect(config.channels[0]?.models.some((model) => model.name === "nano-banana-2")).toBe(false);
    expect(config.model).toBe("worldcodes::gemini-3.1-flash-image-preview");
    expect(config.imageModel).toBe("worldcodes::grok-imagine-image-2.0");
    expect(config.channels[1]?.apiKey).toBe("video-key");
    expect(config.videoModel).toBe("worldcodes-video::MiniMax-H3");
});
