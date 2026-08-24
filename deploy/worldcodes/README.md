# WorldCodes Canvas 独立部署

此目录只提供可审计的部署产物，不会连接生产、修改 DNS 或创建 R2 资源。

## 已确认拓扑

- 站点：`https://canvas.worldcodes.online`
- 静态目录：`/opt/worldcodes-canvas/current`
- Caddy 主配置：`/etc/caddy/Caddyfile`
- Canvas 片段：`/etc/caddy/Caddyfile.canvas`
- 当前 Relay：`127.0.0.1:3000`
- 候选测试 Relay：`127.0.0.1:33102`（仅真实验收期间使用）
- Sub2API 切换后：`127.0.0.1:8080`
- `3001` 是 WireGuard 私网入口，不得用于公开 Canvas

本机已有 `ssh worldcodes-relay` 别名。源站 IP 不写入公共仓库。权威 DNS 检查时 `canvas.worldcodes.online` 尚无记录，部署前需在 Cloudflare 创建指向同一 Relay 源站的代理记录，并使用 Full (strict) TLS。

## 公网 API 合同

Caddy 只用一个 `reverse_proxy` handler，并同时匹配 HTTP 方法与路径：

| 方法 | 路径 |
| --- | --- |
| GET | `/v1/models` |
| POST | `/v1/responses` |
| POST | `/v1/audio/speech` |
| POST | `/v1/images/generations` |
| POST | `/v1/images/edits` |
| POST | `/v1/videos` |
| GET | `/v1/videos/*` |
| POST | `/v1/media/uploads/presign` |
| POST、DELETE | `/v1/media/uploads/*` |
| POST | `/v1beta/models/*` |

其他 `/v1/*`、`/v1beta/*`、`/api/*` 或错误方法固定返回 `404`，不会落到 SPA。`/v1/responses` 和 `/v1/audio/speech` 分别供默认文本与语音节点使用；`/v1beta/models/*` 供 `nano-banana-2` 的 Gemini-compatible 生图调用。API 仍由 Relay 的 Bearer API Key 或该兼容接口要求的 `x-goog-api-key` 鉴权和计费，Caddy 不持有用户密钥。

CSP 只允许请求同源 API 和一个精确 R2 S3 Origin；内置提示词 JSON 已随站点静态包发布，不再请求 GitHub。图片、音频、视频可从 HTTPS 地址展示。未放行 `unsafe-eval`、任意模型 API Origin、远程模型脚本、远程插件、WebDAV 或统计脚本。当前主题初始化仍是内联脚本，因此暂时保留 `script-src 'unsafe-inline'`。

## R2 临时素材桶

桶使用 Standard 存储，关闭 `r2.dev`，只绑定 `media.canvas.worldcodes.online` 作为短期对象读取域。浏览器只拿短时预签名 PUT URL，R2 Access Key 永不下发。对象键由 Relay 生成为 `canvas-temp/{user_id}/{date}/{random-id}.{ext}`，不包含原文件名或 API Key；任务终态主动删除，24 小时生命周期处理异常遗留。

生产 Relay 必须注入 [relay-temporary-media.env.example](./relay-temporary-media.env.example) 中同名变量，并用受保护值替换 endpoint 和两项 Access Key。`TEMP_MEDIA_S3_PREFIX=canvas-temp` 与 `TEMP_MEDIA_PUBLIC_BASE_URL=https://media.canvas.worldcodes.online` 必须保留；前者必须与生命周期的 `canvas-temp/` 一致。不要把真实凭据写入仓库。

应用策略：

```bash
npx wrangler r2 bucket cors set worldcodes-canvas-temp \
  --file deploy/worldcodes/r2-cors.json --force
npx wrangler r2 bucket lifecycle set worldcodes-canvas-temp \
  --file deploy/worldcodes/r2-lifecycle.json --force
npx wrangler r2 bucket cors list worldcodes-canvas-temp
npx wrangler r2 bucket lifecycle list worldcodes-canvas-temp
```

浏览器跨域只放行 `PUT`、`HEAD`。PixStag 通过 R2 自定义域的短公开 URL 读取随机键临时对象，不受浏览器 CORS 限制。任务终态主动删除对象，24 小时生命周期负责失败兜底。

## Relay 安全注入 R2 配置

从 [relay-temporary-media.env.example](./relay-temporary-media.env.example) 复制一份到仓库外的受保护路径，填入真实 Account ID、Access Key ID 和 Secret Access Key，并设置为当前所有者的 `0400` 或 `0600`。然后先检查、再安装：

```bash
deploy/worldcodes/install-relay-r2-config.sh --check \
  --env-file /protected/path/relay-temporary-media.env

sudo deploy/worldcodes/install-relay-r2-config.sh --apply \
  --env-file /protected/path/relay-temporary-media.env
```

脚本不会输出凭据，也不会重启 Relay。它将 env 以 `root:root 0600` 安装到 `/etc/worldcodes/relay-temporary-media.env`，将无密钥 Compose overlay 以 `root:root 0640` 安装到 `/etc/worldcodes/docker-compose.canvas-r2.yml`，并输出 overlay SHA-256。蓝绿脚本把该 overlay 叠加到生产基线；Green 与最终 canonical 容器都必须通过 `docker inspect` 环境门禁。

## Caddy 安装

先做只读检查。R2 Account ID 不是密钥，但必须填写真实值，不能猜测：

```bash
export WORLDCODES_CANVAS_R2_ORIGIN=https://<32位account-id>.r2.cloudflarestorage.com
export WORLDCODES_CANVAS_RELAY_PORT=3000

sudo --preserve-env=WORLDCODES_CANVAS_R2_ORIGIN,WORLDCODES_CANVAS_RELAY_PORT \
  deploy/worldcodes/install-canvas-caddy.sh --check
```

真实验收期间可临时改为 `33102`，让 Canvas 同源 API 指向保留的新测试站 B；验收结束后必须重新安装为 `3000`，不得把候选端口当作长期生产拓扑。

检查结果会输出当前主 Caddy hash、加入 import 后的新 hash 和 Canvas fragment hash。确认现状未漂移后再安装：

```bash
export WORLDCODES_EXPECTED_MAIN_CADDY_SHA256=<check输出的current_main_sha256>
sudo --preserve-env=WORLDCODES_CANVAS_R2_ORIGIN,WORLDCODES_CANVAS_RELAY_PORT,WORLDCODES_EXPECTED_MAIN_CADDY_SHA256 \
  deploy/worldcodes/install-canvas-caddy.sh --apply
```

脚本先验证完整候选配置，再原子替换、reload；失败会恢复主配置和 Canvas fragment。

## Relay 蓝绿合同

现有 `613a3820` 发布脚本的主 Caddy hash、上游数量和端口切换都是固定合同。Canvas 增加一个上游后，必须同时：

- 固定主 Caddy与 Canvas fragment 的 SHA-256；
- 总 Relay 上游从 8 个变为 9 个；
- Green 阶段将 Canvas fragment 从 `3000` 复制并切换到 `13000`；
- Green 主配置改为导入该临时 fragment；
- Blue drain 前确保 Canvas 不再向 `3000` 发新请求；
- 回切和最终门禁再次校验原始 Canvas hash、import 和端口。

对已审计的 `613a3820` 脚本可生成独立补丁：

```bash
python3 deploy/worldcodes/patch-relay-bluegreen-613a3820.py check \
  --script /path/to/deploy-613a3820-bluegreen.sh \
  --expected-main-caddy-sha256 <安装后的main_sha256> \
  --expected-canvas-caddy-sha256 <安装后的canvas_sha256> \
  --expected-canvas-r2-compose-sha256 <R2安装脚本输出的compose_sha256>

python3 deploy/worldcodes/patch-relay-bluegreen-613a3820.py apply \
  --script /path/to/deploy-613a3820-bluegreen.sh \
  --expected-main-caddy-sha256 <安装后的main_sha256> \
  --expected-canvas-caddy-sha256 <安装后的canvas_sha256> \
  --expected-canvas-r2-compose-sha256 <R2安装脚本输出的compose_sha256>
```

补丁器只接受该固定 revision，遇到新版脚本会拒绝模糊修改；新版发布流程需显式移植同一合同。发布门禁会固定 Compose overlay hash、检查 env 权限和值、锁定发布期间的 env hash，并验证 Compose 渲染结果、Green 容器和最终 canonical 容器均带完整 `TEMP_MEDIA_*`。迁移到 Sub2API `8080` 后，不再套用这份 `3000 ↔ 13000` 补丁。

## 静态版本发布

构建后的 `.tar.gz` 根目录必须直接包含 `index.html`、`config.js`、`assets/`。先校验，再显式发布：

```bash
deploy/worldcodes/publish-canvas-release.sh --check \
  --artifact worldcodes-canvas-<revision>.tar.gz \
  --revision <revision> \
  --sha256 <sha256>

sudo deploy/worldcodes/publish-canvas-release.sh --apply \
  --artifact worldcodes-canvas-<revision>.tar.gz \
  --revision <revision> \
  --sha256 <sha256>
```

发布脚本拒绝路径穿越、链接和特殊 tar 条目，原子切换 `current`，并检查首页、CSP、未鉴权模型请求及错误方法/路径；失败自动回切旧静态版本。

本地合同验证：

```bash
deploy/worldcodes/verify-canvas-deploy.sh \
  --relay-env /path/to/relay-production.env \
  --relay-release-script /path/to/deploy-613a3820-bluegreen.sh
```

验证会 fail closed：Relay env 必须且只能声明一次非空 `TEMP_MEDIA_S3_PREFIX`，并与 R2 生命周期前缀一致。未生成生产 env 时可省略 `--relay-env`，脚本会验证仓库内的无密钥模板。

当前由用户在浏览器填写自己的 WorldCodes API Key。后续无感登录按 [AUTH-LAUNCH.md](./AUTH-LAUNCH.md) 实施，禁止把长期 API Key 放进 URL。
