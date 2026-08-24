# WorldCodes Canvas Codex Plugin

这是 WorldCodes 自有的 Codex 插件源码，只连接 `canvas.worldcodes.online` 与 WorldCodes 自托管 Agent 包，不再安装或调用上游插件、Agent 包和站点。

## 安装

从 WorldCodes Canvas 自有 Fork 安装插件：

```bash
codex plugin marketplace add lori-super/worldcodes-canvas
codex plugin add worldcodes-canvas@worldcodes-canvas
```

安装后新建 Codex 任务，输入“打开 WorldCodes Canvas”。插件会启动自有 MCP；网页对话仍需在用户电脑另行运行本地 Agent：

```bash
npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.0.tgz
```

外部 MCP ID `infinite-canvas` 与本地目录 `~/.infinite-canvas` 只为兼容已有配置保留，不代表上游安装或更新来源。
