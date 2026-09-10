import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { VERSION } from "./config.js";
import { logger } from "./utils/logger.js";

const require = createRequire(import.meta.url);
const CODEX_VERSION = String((require("@openai/codex/package.json") as { version: string }).version);

/** 输出本地版本。WorldCodes 包发布前不再查询或提示上游 Agent。 */
export function checkVersions() {
    const localCodexVersion = commandVersion("codex");
    logger.info("WorldCodes Canvas Agent version", { version: VERSION });
    logger.info("Bundled Codex version", { version: CODEX_VERSION });
    logger.info("Local Codex version", { version: localCodexVersion || "not found" });
    if (!localCodexVersion) {
        logger.warn("Local Codex was not found. Install the latest version with: npm install -g @openai/codex@latest");
    } else if (localCodexVersion !== CODEX_VERSION) {
        logger.warn(`Bundled Codex ${CODEX_VERSION} does not match local Codex ${localCodexVersion}. Rebuild WorldCodes Canvas Agent after upgrading Codex.`);
    }
}

/** 读取本机命令输出中的语义版本号。 */
function commandVersion(command: string) {
    try {
        return execFileSync(command, ["--version"], { encoding: "utf8", timeout: 5_000 }).match(/\d+\.\d+\.\d+/)?.[0] || "";
    } catch {
        return "";
    }
}
