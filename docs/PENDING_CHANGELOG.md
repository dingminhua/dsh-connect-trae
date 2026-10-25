# 待写入 CHANGELOG 的条目（下一个版本）

> **这份文件是一块暂存区，不是文档。** 发版时把下面的内容整段追加到
> `CHANGELOG.md` 顶部（`# Changelog` 之后、最新已发布版本之前），然后删除本文件。
>
> **为什么不能直接写进 `CHANGELOG.md`：** 它是**随包文件**（在 `package.json` 的
> `files` 里）。已发布的 tag `v4.5.2` 之后若改动任何随包文件，
> `pnpm run verify:release` 会（正确地）报出「tag 之后改动了发布内容」——
> 因为那意味着线上包不再等于「tag 指向的源码」。而未发布版本的条目本来就
> 不属于已发布的那份 CHANGELOG。
>
> 放在 `docs/` 下是安全的：`docs/*.md` 不进发布包（只有
> `docs/assets/dsh-connect-trae-usage-card.png` 随包），所以改它不会污染发布内容。

---

## 未发布

### 修正

- **文生图现在把图片取回来了**（正确 4.6.0 里「字节插件拿不到」的说法）。那条按
  `?prompt=&image_size=` 再打一次 GET 的路确实不是取图、而是**又一次生成**（另一 uri、
  27 秒、零像素、约多扣 8.8 积分），但「uri → 字节」不是没有通道，只是请求体形态特殊：
  `POST /api/ide/v1/get_resource_url`，body 必须正是 `{"uri_list":["<tos key>"]}`
  ——`{uri}`/`{path}`/`{resource_uri}`/`{uris:[…]}`/`{resources:[…]}`/
  `{scene:'report',uri}` 以及 GET `?uri=` 统统只回 200 + 空 `url_map`（不报错、也不给
  地址）。应答是 `{"url_map":{"<key>":"<byteimg 签名 URL>"}}`，再直接 GET 那个签名地址
  （**不带任何 Trae 头**，签名在 query 里）即得字节——实测 `image/jpeg`、1,155,578 字节、
  头 `ffd8ffe0`。对已有 key 这一步**零成本**，不会重新生成。
- **图片落成会话文件并直接显示**：`generate` 返回 `{url, credit?, bytes, mimeType}`，
  `execute` 把字节写进 `<session cwd>/trae-images/trae-YYYYMMDD-HHMMSS-<hex>.<ext>`
  （扩展名跟 mime 走），`output.schema` 恢复 `path` 并进 `required`，`render` 输出
  `![Trae 文生图](trae-images/…)`。DSH 的聊天按 session cwd 解析相对路径、再过宿主的
  `api/file` 鉴权路由取字节，所以图真的显示出来，不需要用户去 Trae 客户端翻历史。
- **失败语义**：图已生成、积分已扣、但字节取不回来（`url_map` 里没有这个 key / CDN 非
  2xx / 0 字节 / 落盘失败）→ `IMAGE_UNAVAILABLE`，进 30 秒冷却，文案明说「积分已经扣了」
  并给出对象 key 供排障，要求模型**不要重试**。

### 变更

- **删掉已证明是「又一次生成」的配套代码**：`src/image-gen-trae.ts` 里的
  `traeImageFetchUrl()`、`computeTraeIdeSign()`、`traeImageSignFields()` 与
  `TRAE_IMAGE_SIGN_SALT` 全部移除（连同它们的测试）。取图跟 prompt 没有任何关系，
  留着只会诱导后人再打一次那条会再扣费的 GET。

### 测试

- `tests/image-tool-download.spec.ts` 3 例：stub fetch 断言**三跳**（POST 生图 →
  POST `get_resource_url` → GET 签名地址），且**没有任何**带 `image_size=` 的请求；
  `uri_list` 请求体；CDN 请求不带 `Authorization`、只带 `Accept: image/*`；
  空 `url_map` → `IMAGE_UNAVAILABLE`。
- `tests/image-tool-render.spec.ts` 9 例：字节真落盘、文件名与后缀、markdown 用相对路径
  且不含 key、credit 回显、写盘失败即 `IMAGE_UNAVAILABLE`、`IMAGE_UNAVAILABLE` 进冷却而
  `INVALID_ARGS` 不进。
- 真机（零成本，复用既有 key）：签名 → 1,155,578 字节 JPEG → 落盘同样字节 →
  render 输出 markdown 图片，整条链路跑通。

### 文档

- `README.md` / `README.en.md` 的「文生图」条目与协议表改成「两步取图 + 落盘 + 相对
  路径显示」，并保留「那条 GET 是又一次生成」的实测记录作为反面证据。
