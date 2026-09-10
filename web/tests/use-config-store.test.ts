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

    expect(useConfigStore.getState().config.channels[0]?.models).toEqual([
        { name: "grok-imagine-image-quality", displayName: "Grok Imagine", capability: "image" },
        { name: "gpt-image-2", displayName: "GPT Image 2", capability: "image" },
        { name: "nano-banana-2", displayName: "Nano Banana 2", capability: "image" },
        { name: "gpt-5.5", capability: "text" },
    ]);
    expect(useConfigStore.getState().config.audioModel).toBe("");
    expect(guessCapability("nano-banana-pro")).toBe("image");
});
