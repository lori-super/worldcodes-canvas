# WorldCodes Canvas Agent

WorldCodes Canvas Agent 是可选的本地桥接器，让 Codex 读取和操作当前网页画布。它需要访问本机 Codex、Skills 与工作区，因此只能运行在用户电脑上，不能部署为 Relay 上的多人共享服务。

## 当前状态

WorldCodes 安装包和 Codex 插件尚未发布，主站默认隐藏 Agent 入口。图片生成、视频生成和参考素材管理都不依赖 Agent。

源码开发时可以本地运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

Debug 模式：

```bash
npm run debug
```

Agent 默认只监听 `127.0.0.1:17371`，配置与日志保存在用户本机 `~/.infinite-canvas`。这里暂时保留旧目录名与 MCP ID `infinite-canvas`，用于兼容已有本地配置和浏览器数据。

## 本地 MCP 开发

构建后可用绝对路径注册本地 MCP：

```bash
codex mcp add infinite-canvas -- node /absolute/path/to/worldcodes-canvas/canvas-agent/dist/index.js mcp
```

不再使用时：

```bash
codex mcp remove infinite-canvas
```

正式开放 Agent 前需要完成：

1. 发布 `@worldcodes/canvas-agent`。
2. 发布 WorldCodes Codex 插件并配置自有站点地址。
3. 完成签名、版本更新和安装说明。
4. 在 Web 构建环境设置 `VITE_AGENT_ENABLED=true`。
