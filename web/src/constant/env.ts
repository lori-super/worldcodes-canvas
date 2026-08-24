export const APP_VERSION = __APP_VERSION__ || "dev";

export const AGENT_AVAILABLE = import.meta.env.VITE_AGENT_ENABLED !== "false";

export const WORLD_CODES_MAIN_SITE_URL = "https://worldcodes.online/";

// Defaults to the same origin. Production can override this with a WorldCodes-owned registry.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "/plugin-registry.json";
