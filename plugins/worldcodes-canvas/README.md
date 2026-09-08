# WorldCodes Canvas Codex Plugin

这是 WorldCodes 自有的 Codex 插件，用来让 Codex 打开并操作 `canvas.worldcodes.online`。插件、Skills、MCP 与 Agent 安装包都由 WorldCodes 自有仓库和站点提供。

## 安装

```bash
codex plugin marketplace add lori-super/worldcodes-canvas
codex plugin add worldcodes-canvas@worldcodes-canvas
```

安装后新建一个 Codex 任务，然后输入：

```text
打开 WorldCodes Canvas
```

插件会加载 WorldCodes Canvas MCP。`open-canvas` Skill 会启动 WorldCodes 自托管 Agent，读取 `Local URL` 与 `Connect token`，再打开正式站并自动连接；用户无需手工复制连接参数。

如果只需要网页右侧对话、不需要在 Codex 任务中加载画布工具，也可以直接运行 Agent：

```bash
npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.1.tgz
```

直接运行 Agent 不会安装 MCP。插件更新后请重新安装并新建 Codex 任务，以加载最新 Skills 和工具。

移除插件：

```bash
codex plugin remove worldcodes-canvas@worldcodes-canvas
```

兼容 MCP ID `infinite-canvas` 与本地目录 `~/.infinite-canvas` 暂时保留已有用户配置，不代表上游安装或更新来源。
