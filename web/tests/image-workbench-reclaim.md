# 图片创作页领取恢复回归

本地夹具不向真实上游转发生图请求。启动 `python3 tests/image-workbench-reclaim-server.py`，前端使用 OpenAI 格式测试渠道 `http://127.0.0.1:4318`、模型 `gpt-image-2`、任意非空测试 Key。

`GET http://127.0.0.1:4318/state` 查看生成 POST 数量及图片 GET 路径；`POST /control` 接受 JSON 字段 `mode`（`hang` / `fail` / `ok`）和 `fail_ids`（如 `["/image/3.png"]`）。`hang` 发送有效响应头和图片前8字节后等待客户端断开。

1. `hang` 下生成一张图。下载完成前，IndexedDB `infinite-canvas/image_generation_logs` 已保存对应结果的 `sourceUrl`；页面显示“图片已生成，正在领取”。
2. 不修改计时器，等待实际60秒。应出现“已生成，待领取”、具体超时说明、重新领取/打开原图/复制原图链接；记录包含 `delivery_failed` 与原图地址。
3. 将 `mode` 改为 `ok`，清空渠道 Key，刷新后点开原记录并重新领取。应保存和展示原图，POST 数量不增加，GET只新增原路径，历史 ID 不变。
4. 生成三张，令中间一张返回503。历史应显示已生成3、待领取1，保留三张各自状态。恢复下载、刷新并只重领中间一张，原成功图片保持不变，不创建新历史或生成请求。
5. 故障注入只让 `image_files` 的 IndexedDB put 抛出 QuotaExceededError，历史存储保持正常。应保留原图链接和实际错误；恢复存储后只重领原图。
6. 再次在 `hang` 下生成，结果已写入历史且尚未超时时刷新。点开历史应提示上次领取中断；切换 `ok` 后重领，不重复生成。
7. 历史不带 `results` 时保留旧成功图片；旧失败且没有原图链接时说明无法自动恢复。尚未返回结果的中断请求不得声称已生成，重新生成按钮明确标注会计费。

本轮浏览器证据见工作区 `diagnostics/image-workbench-reclaim-20260910/`。测试前后核对 POST/GET 计数，不使用真实付费生成来验证重试。
