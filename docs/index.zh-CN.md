# WorldCodes Canvas 文档索引

## 核心文档

- [快速开始](/zh-CN/docs/overview/quick-start)
- [功能介绍](/zh-CN/docs/overview/features)
- [Docker 部署](/zh-CN/docs/overview/docker)
- [静态托管边界](/zh-CN/docs/overview/render)
- [本地 Agent](/zh-CN/docs/overview/codex-app-plugin)

## 画布与开发

- [画布节点操作手册](/zh-CN/docs/canvas/canvas-node-manual)
- [画布快捷键](/zh-CN/docs/canvas/canvas-shortcuts)
- [本地开发](/zh-CN/docs/development/local-development)
- [画布数据结构](/zh-CN/docs/development/canvas-data-structure)
- [本地 Codex 连接原理](/zh-CN/docs/development/local-codex-canvas)

## 安全与许可

- [开源协议](/zh-CN/docs/business/license)
- [漏洞提交](/zh-CN/docs/support/security)

## 运行边界

- 生产模型请求只走同源 WorldCodes Relay。
- 用户的 WorldCodes API Key 保存在浏览器；供应商密钥和路由保留在 Relay。
- 画布与素材主要保存在浏览器 IndexedDB。
- 本地参考媒体仅在生成需要时直传私有 R2 临时对象。
- 提示词库预置 7 组经过审核的只读 JSON 数据源，页面不提供外部仓库跳转；生产版仍不放行外部 WebDAV 或任意模型地址。
