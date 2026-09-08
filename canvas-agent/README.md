# WorldCodes Canvas Agent

WorldCodes Canvas Agent 是可选的本地桥接器，让 Codex 读取和操作当前网页画布。它需要访问本机 Codex、Skills 与工作区，因此只能运行在用户电脑上，不能部署为 Relay 上的多人共享服务。

## 启动

正式安装包由 WorldCodes Canvas 自有站点提供：

```bash
npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.1.tgz
```

需要排查连接、线程、Codex app-server 或工具调用问题时：

```bash
npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.1.tgz --debug
```

Agent 启动后会输出：

```text
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

在 WorldCodes Canvas 右上角打开 `Agent`。网页默认自动发现地址和 token；失败时再手动填写。

Agent 默认只监听 `127.0.0.1:17371`。网页第一次用正确 token 连接后会锁定 Origin，避免其他站点复用该本机 Agent。配置与日志保存在 `~/.infinite-canvas`；旧目录名暂时用于兼容已有用户数据。

图片生成、视频生成和参考素材管理不依赖 Agent。源码与插件不会安装、查询或提示升级任何上游 Canvas Agent 包。

## 源码开发

源码开发时可以本地运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

本地 Debug 模式：

```bash
npm run debug
```

## WorldCodes Codex 插件

插件安装命令：

```bash
codex plugin marketplace add lori-super/worldcodes-canvas
codex plugin add worldcodes-canvas@worldcodes-canvas
```

安装后新建 Codex 任务并输入“打开 WorldCodes Canvas”。插件会启动 WorldCodes 自托管包的 MCP 模式；`open-canvas` Skill 会按需再启动普通 Agent、读取连接信息并打开 `canvas.worldcodes.online`。

MCP 进程提供画布工具，普通 Agent 进程提供网页连接和右侧对话。两个进程读取同一份本机配置，但职责不同。只运行普通 Agent 不会安装 MCP，也不会把画布工具加入 Codex 上下文。

移除插件：

```bash
codex plugin remove worldcodes-canvas@worldcodes-canvas
```

## 手动 MCP

不使用插件时，可手动注册 WorldCodes 自托管 Agent 的 MCP 模式：

```bash
codex mcp add infinite-canvas -- npx -y https://canvas.worldcodes.online/downloads/worldcodes-canvas-agent-0.6.1.tgz mcp
```

构建后可用绝对路径注册本地 MCP：

```bash
codex mcp add infinite-canvas -- node /absolute/path/to/worldcodes-canvas/canvas-agent/dist/index.js mcp
```

不再使用时：

```bash
codex mcp remove infinite-canvas
```

兼容 MCP ID `infinite-canvas` 暂时保留已有配置；实际服务名、插件、安装包和站点都由 WorldCodes 提供。

常用工具包括读取画布与选区、创建或更新节点、连接节点、调整视口和触发生成。画布写操作会回到网页执行，并继续由右侧面板确认。

## 侧边栏 Codex

网页右侧面板把提示词发送给本机 Agent。Agent 通过官方 Codex app-server 创建或恢复 thread，并注入同一套画布 MCP 工具。侧边栏会展示思考、计划、命令、文件修改、工具调用和审批状态。

侧边栏上传或粘贴的图片会先发给本机 Agent，再作为本地图片输入交给 Codex；单次请求体限制为 30MB。Relay 不接触用户的 Codex 登录状态、Skills、工作区或本地文件。

## 发布检查

发布新版本前需要完成：

1. 构建并发布自有 Agent 安装包。
2. 更新 WorldCodes Codex 插件的固定版本地址。
3. 完成签名、版本更新和安装说明。
4. 验证正式站与 `127.0.0.1:17371` 的连接流程。
