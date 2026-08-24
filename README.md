<p align="center">
  <img src="web/public/logo.svg" width="96" alt="WorldCodes Canvas Logo">
</p>

<h1 align="center">WorldCodes Canvas</h1>

<p align="center">面向多模态 AI 创作的无限画布工作台</p>

WorldCodes Canvas 将画布编排、图片与视频生成、参考素材、提示词和可复用资产放在同一个工作流中。站点通过 WorldCodes Relay 调用模型，浏览器不直接持有上游服务密钥。

## 核心能力

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做与导入导出。
- 图片生成：Grok Imagine、GPT Image 2、Nano Banana 2。
- 视频生成：MiniMax H3，支持图片、视频和音频参考。
- 参考素材：编辑期间保存在浏览器 IndexedDB；生成需要公网地址时，由浏览器直传 R2 临时对象。
- 站内文档：应用内 `/docs` 提供配置、模型、素材、存储与部署说明。
- 本地 Agent：作为可选能力保留；入口默认显示，需在用户电脑运行本地桥接器，不影响图片或视频生成。

## 本地预览

```bash
cd web
bun install
bun run dev
```

默认访问 `http://localhost:3000`。

本地 Vite 只提供界面预览，不包含同源 WorldCodes Relay；默认生成能力需要受控的同源反向代理。

## Docker

```bash
docker compose up --build -d
```

镜像由当前源码构建，不会拉取其他项目的预构建镜像。

该镜像只包含静态前端。完整生产部署还需要 `deploy/worldcodes/` 中的 Caddy、Relay 与 R2 合同。

## 项目结构

- `web/`：WorldCodes Canvas 主站与站内文档。
- `canvas-agent/`：可选的本地 Agent 源码。
- `plugins/`：画布节点与 Agent 插件源码。
- `docs/`：独立文档站源码，不作为主站生产入口。

## Agent 策略

Agent 需要访问用户本机的 Codex、Skills 与工作区，因此只在用户电脑上运行，不能作为多人共享服务部署到 Relay。主站显示 Agent 入口；如需关闭，可在构建环境设置 `VITE_AGENT_ENABLED=false`。

## 开源协议

项目沿用 [MIT License](LICENSE)，版权信息与许可原文保留在仓库中。
