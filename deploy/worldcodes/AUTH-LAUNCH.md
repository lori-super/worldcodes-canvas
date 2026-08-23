# Canvas 一次性启动凭证方案

## 当前阶段

Canvas 使用用户自己的 WorldCodes API Key，请求统一携带 `Authorization: Bearer <key>`。Key 只保存在浏览器本地，不经过 Caddy 配置，也不得通过 `?apiKey=`、Referer、访问日志或构建变量传递。

## 后续无感登录

不跨子域共享主站 Cookie，也不把主站 JWT直接交给 Canvas。使用一次性 code 换取短时、窄权限运行凭证：

1. 已登录主站通过会话认证和 CSRF 防护调用 `POST /api/worldcodes/canvas/launch`。
2. 后端生成 32 字节随机 code，只保存 SHA-256，绑定 `user_id`、主站 `session_id`、认证版本、`aud=canvas`、60 秒过期时间和未消费状态。
3. 主站打开 `https://canvas.worldcodes.online/launch#code=...`。Fragment 不发送给 Caddy；Canvas 读取后立即 `history.replaceState` 清理。
4. Canvas 调用同源 `POST /api/worldcodes/canvas/session/exchange`。后端校验精确 Origin、受众、会话状态并在一次原子操作中消费 code。
5. 返回 `wcc_` 前缀的短时 opaque token；服务端仍只保存摘要。Token 仅驻留内存，最长 15 分钟。

运行凭证必须复用现有用户、API Key、余额、分组、调度和 usage 账本，不创建第二套钱包或计费状态。建议绑定一条现有 Canvas 专用 API Key身份，并限制：

- 路径 scope：`models:read`、`text:generate`、`audio:speech`、`image:generate`、`video:generate`、`media:temporary`；
- 模型 scope：仅后台允许的 `gpt-5.5`、`gpt-4o-mini-tts`、Grok、GPT Image、Banana、MiniMax H3；
- 精确用户、会话、认证版本和 API Key ID；
- 单独的短 TTL、速率限制和撤销记录；
- 主站登出、会话撤销、用户禁用或 API Key禁用时立即失效。

若以后需要刷新页面后保留登录，可增加 `__Host-worldcodes_canvas_refresh`：`Secure; HttpOnly; SameSite=Strict; Path=/`，只用于换取新的内存 token，不向 JavaScript 暴露 refresh secret。

## 必须同时完成的门禁

- Exchange 必须原子消费，重复提交返回统一失败，禁止 code 重放。
- 创建、交换和刷新均需限流；日志只记摘要后缀、用户 ID 和结果。
- 响应设置 `Cache-Control: no-store`，不返回长期 WorldCodes API Key。
- Caddy 只在后端接口和回归测试上线后增加 exchange/refresh/logout 精确路径；目前 `/api/*` 固定 `404`。
- Canvas 启动时不得再接受 URL query 中的 `apiKey`。
- CSP 继续保持 `connect-src 'self' <exact-r2-origin>`，不因无感登录放宽任意 API Origin。
