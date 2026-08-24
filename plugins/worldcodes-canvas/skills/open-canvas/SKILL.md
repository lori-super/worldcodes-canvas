---
name: open-canvas
description: 打开 WorldCodes Canvas 正式站并连接用户电脑上的 WorldCodes Canvas Agent。
---

# Open WorldCodes Canvas

只使用 WorldCodes 自有站点与 Agent 包，不要运行第三方 Agent 或打开其他画布站点。

1. 在用户电脑启动本地 Agent 并保持运行：

```bash
npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.0.tgz
```

2. 从启动输出取得 `Local URL` 和 `Connect token`。

3. 打开下面的 WorldCodes 正式站地址：

```text
https://canvas.worldcodes.online/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>
```

插件 MCP 与普通 Agent 读取同一份本机配置。MCP 提供画布工具，普通 Agent 提供网页连接和对话能力；两者都只在用户电脑运行，不进入 Relay 服务器。
