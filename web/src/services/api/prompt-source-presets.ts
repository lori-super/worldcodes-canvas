import { nanoid } from "nanoid";

export type PromptSource = {
    id: string;
    name: string;
    url: string;
    homepage: string;
    enabled: boolean;
    builtIn: boolean;
};

const PROMPT_REGISTRY_SOURCE_BASE = "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources";

export function createPromptSource(source?: Partial<PromptSource>): PromptSource {
    return {
        id: source?.id?.trim() || nanoid(),
        name: source?.name?.trim() || "",
        url: source?.url?.trim() || "",
        homepage: source?.homepage?.trim() || "",
        enabled: source?.enabled ?? true,
        builtIn: source?.builtIn ?? false,
    };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [
    registrySource("banana-prompt-quicker", "Banana Prompt Quicker"),
    registrySource("davidwu-gpt-image2-prompts", "DavidWu GPT Image 2"),
    registrySource("freestylefly-gpt-image-2", "Freestylefly GPT Image 2"),
    registrySource("awesome-gpt-image", "Awesome GPT Image"),
    registrySource("awesome-gpt4o-image-prompts", "Awesome GPT-4o"),
    registrySource("youmind-gpt-image-2", "YouMind GPT Image 2"),
    registrySource("youmind-nano-banana-pro", "YouMind Nano Banana Pro"),
];

function registrySource(id: string, name: string): PromptSource {
    return { id, name, url: `${PROMPT_REGISTRY_SOURCE_BASE}/${id}.json`, homepage: "/docs#prompts", enabled: true, builtIn: true };
}
