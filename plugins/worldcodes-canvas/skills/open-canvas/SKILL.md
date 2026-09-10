---
name: open-canvas
description: 打开 WorldCodes Canvas 在线或本地画布，并自动连接 WorldCodes Canvas Agent。用户要求打开、启动、进入或使用 WorldCodes Canvas 时使用。
---

# Open WorldCodes Canvas

默认打开 WorldCodes 正式站。只有用户明确要求使用本地项目时，才启动本地前端。只使用 WorldCodes 自有 Agent 包和站点。

## 在线版

1. 在用户电脑启动 WorldCodes Canvas Agent 并保持运行：

```bash
npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.1.tgz
```

2. 从启动输出取得 `Local URL` 和 `Connect token`。

3. 在 Codex 浏览器打开：

```text
https://canvas.worldcodes.online/canvas?mode=new#agentUrl=<Local URL>&agentToken=<Connect token>
```

## 本地版

1. 只有用户明确要求本地开发时，才在 WorldCodes Canvas 项目中启动前端：

```bash
cd web
bun install
bun run dev
```

2. 启动 WorldCodes Canvas Agent：

```bash
npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.1.tgz
```

3. 从启动输出取得 `Local URL` 和 `Connect token`，打开：

```text
<Vite Local 地址>/canvas?mode=new#agentUrl=<Local URL>&agentToken=<Connect token>
```

## MCP 与连接地址

插件在新的 Codex 任务中加载时会自动启动 WorldCodes 自托管包的 MCP 模式。这个 MCP 进程负责提供画布工具，不提供网页连接服务；上面启动的普通 Agent 负责提供 `Local URL`、`Connect token` 和网页对话。两个进程读取同一份本机配置，因此不要让用户手工复制连接参数。

## 打开模式

用户没有明确指定时始终使用 `mode=new` 新建画布。只有用户明确要求时才替换为：

- 最近画布：`mode=recent`
- 自己选择：`mode=choose`
