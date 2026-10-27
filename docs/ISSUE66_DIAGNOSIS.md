# issue #66 诊断与修复：美国区凭据被当成新加坡区，401 又被包成 500

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/66>
> （国际版 Trae（美国区）凭据被判成 `ai` 区：`pay_status` 401、模型目录 500、重登无效）
> 诊断/修复时间：2026-10-27　方法：读代码 + 报告人提供的上游实测证据 + 新增单元测试
> 状态：**已修复（未发版）**。美国区本身**仍未支持**，本版把它变成「明确的、不再误路由的不支持」。

---

## 0. 一句话结论

报告里两个现象是**同一条链**上的两段：区域判定把 US 凭据归到了 `ai`（→ 所有读请求打到
`*.trae.ai` → 401），模型刷新路由又把那个 401 包成 500（→ 用户看到「HTTP 500」，排障方向被
带到「重新登录」）。修复分两处：**US 必须是一个显式的、不被服务的区域**；**上游 401/403 必须
保留原状态跨过 HTTP 边界**。

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| `pay_status` 401 | `regionOfUserRegion("US")` / `regionOfHost("…traeapi.us")` 都不认识 US，回退到 `regionOfEdition("sg") = "ai"` | US 从 `userRegion` 与 `host` 两级都能解析出来，且**不会再回退成 `ai`** |
| 模型刷新 500 | 目录读拿 US token 打 SG 网关得 401；路由 `catch` 一律 `json(res, 500, …)` | US 在选网关**之前**被拒；上游 401/403 原样透出（`code: authentication`），本地「不支持」= 501 + `code: unsupported-region` |
| 重登无效并循环 | 重登只会再拿到一份 US 凭据；卡片把它当 `ai` 账号继续 401，界面上没有任何一句说清「这个区不支持」 | US 凭据**不可被选中、不会计费**，但会在卡片上被点名：未登录态显示「美国区（US）暂不支持」+ 账号名，并说明「重新登录不会有任何变化」 |

---

## 1. 根因链（按数据流）

```text
~/.dsh/.trae-auth.ai.json
  { host: "https://grow-normal.traeapi.us", userRegion: "US", edition: "sg" }
        │
        ▼
regionOfCredential()            src/region.ts
  regionOfUserRegion("US")   → undefined   ← 只认 cn / sg / ai
  regionOfHost("…traeapi.us")→ undefined   ← 只认 .trae.ai / .trae.cn / .trae.com.cn
  regionOfEdition("sg")      → "ai"        ← 唯一命中的一级，于是 US 变 SG
        │
        ▼
REGION_GATEWAYS["ai"] = { pay: growsg-normal.trae.ai, remote: coresg-normal.trae.ai, chat: coresg-normal.trae.ai }
        │
        ├─ pay_status            → 401 {code:1001}
        ├─ /api/remote/v1/models → 401 {code:1001}
        └─ 模型刷新路由 catch     → HTTP 500 {"error":"SOLO remote models returned HTTP 401"}
```

三个「静默」叠加才让问题难查：

1. **静默回退**：区域解析有三级回退，前两级不认识 US 时不会报错，只会取第三级；
2. **静默换主机**：`REGION_GATEWAYS` 只有两个键，`ai` 的键恰好存在，所以取到的是「另一个区」的
   网关，而不是「查不到」；
3. **静默改状态码**：`web-status.ts` 的刷新路由把所有异常写成 500，把「网关拒绝了你」翻译成
   「插件坏了」。

报告人的实测（US token，同一套请求头）正好把第 2 条钉死：同样的 token 打
`grow-normal.traeapi.us` 是 200、打 `growsg-normal.trae.ai` 是 401；目录同理（US 200 / 29 项，
SG 401）。

---

## 2. 为什么不是「加一行 `us → ai` 的映射」

这是本次修复最重要的取舍。**不能**把 US 映射成 `ai`，因为 `ai` 的语义是「已经验证过的新加坡
网关集合」：`REGION_GATEWAYS.ai`、`TRAE_REMOTE_DIRECTORY_FUNCTIONS.ai`、`while` 的目录/计费
契约都是按 SG 实测出来的。US 的实测结论恰好相反：

| 能力 | SG（`*.trae.ai`） | US（`*.traeapi.us`） | 结论 |
| --- | --- | --- | --- |
| pay / pay_status | 200（SG 凭据） | 200 | US 可用 |
| 远程目录 `/api/remote/v1/models` | 200 | **404** | 路径不存在 |
| 模型目录 `get_detail_param` | 200 | 200（`function` 单数 + `agent_type: null` 才有 29 项） | 形态不同 |
| `llm_utils_chat` | 200 | **403 `40006 no schema found`** | 未注册 |
| `create_agent_task` | — | 200 但流内 `4001 model config is empty` | 契约未确认 |

所以 US 是一个**真实存在、可识别、但尚未实现**的区域。把它映射成 `ai` 等于继续用 SG 的契约去
打 US（或反过来），两条路都是错的。本版的选择是把它变成类型系统里的第三个值
`TraeServiceRegion = 'cn' | 'ai' | 'us'`：`TraeRegion`（存储/路由桶）仍然只有 `cn | ai`，
`assertSupportedRegion()` 是唯一从 service region 进桶的入口，`us` 在这里抛
`TraeUnsupportedRegionError`，**在任何网关被选中之前**。

这项取舍还有一个直接好处：以后真要接 US，编译器会把所有「按区域取网关」的位置列出来，
不会再出现「新加一个区但漏了一处、悄悄读了另一个区的配置」这种 bug。

---

## 3. 具体改动

| 位置 | 改动 |
| --- | --- |
| `src/region.ts` | 新增 `TraeServiceRegion` / `TRAE_UNSUPPORTED_REGION_CODE` / `TraeUnsupportedRegionError` / `isSupportedRegion` / `assertSupportedRegion`；`regionOfUserRegion` 认 `US`，`regionOfHost` 认 `*.traeapi.us` |
| `src/failure.ts`（新） | `TraeHttpError`（携带上游状态）+ `httpFailureOf()`：401/403 → 原状态 + `authentication`；`us` → 501 + `unsupported-region`；其余 → 500 |
| `src/auth.ts` | 区域解析为 `us` 的凭据不再进入 `readAll()`（因此不可选中、不可计费、不会被 refresh 到任何网关）；新增 `unsupportedCredentials()` 供卡片点名；`resolve()` 在「没有可用凭据但存在 US 凭据」时抛 `TraeUnsupportedRegionError`，而不是笼统的 "no signed-in account found" |
| `src/usage.ts` / `src/solo.ts` / `src/solo-remote.ts` / `src/raw-upstream.ts` / `src/official-roster.ts` | 取网关前一律 `assertSupportedRegion(regionOfCredential(credential))`；目录的 4xx 改为 `TraeHttpError` |
| `src/web-status.ts` | 上游读路由（状态/额度/账号表/模型刷新/模型测速/签到/账号池签到与测速）改用 `failJson()`，不再一律 500；状态文档新增 `unsupportedRegion` |
| `src/status-paths.ts` | `TraeWebUnsupportedRegion`，挂在 signed-in / signed-out 两种文档上 |
| `src/transfer.ts` | 区域门控接受 `us`，因此 US 凭据**导入也会被跳过**（和其它外区记录一样），不会被塞进 `ai` 库 |
| `src/client/TraeUsageCard.tsx` + `locales.ts` | 未登录态显示「美国区（US）暂不支持」卡片（含账号名，并说明重登无用）；诊断面板加一行；失败请求显示**服务端原文**而不是 `HTTP 401/500` |

---

## 4. 验证

新增两个测试文件，共 25 例：

- `tests/issue66-us-region.spec.ts`（23 例）
  - 区域解析：`userRegion: "US"`、`*.traeapi.us`、以及报告人那份「三字段齐全」的凭据都必须解析成
    `us`，且**不能**经 `edition: "sg"` 回退成 `ai`；SG/CN 的判定保持不变。
  - 零请求：`TraeUsageClient.payStatus()`、`TraeSoloRemoteCatalogClient.fetchModels()`、
    `TraeSoloUpstreamClient.fetchModels()`、`TraeRawChatUpstreamClient.chatStream()` 面对 US 凭据
    都在本地失败，`fetch` 调用次数断言为 **0**。
  - 凭据库：US 凭据 `resolve()` 抛 `TraeUnsupportedRegionError`、`accounts()` 为空、
    `status()` 为 signed-out，但 `unsupportedCredentials()` 能报出账号名；没有 US 凭据时仍报
    "no signed-in account found"。
  - HTTP 语义：401/403 保持原状态 + `authentication`，404 → `upstream`，US → 501 +
    `unsupported-region`，普通异常仍 500；模型刷新路由逐条验证。
  - 状态文档：signed-out 文档携带 `unsupportedRegion` 且不再重复英文异常文本。
- `tests/issue66-card-us-notice.spec.tsx`（2 例）
  - 未登录文档带 `unsupportedRegion` 时卡片点名账号；
  - 状态请求失败时显示服务端 `error` 原文，而不是 `HTTP 401`。

**变异验证**（确认测试不是「恰好绿」）：

1. 把 `regionOfUserRegion` 的 `us` 分支改回 `undefined` → 2 例转红；
2. 把模型刷新路由的 `failJson()` 改回 `json(res, 500, …)` → 401/501 两例转红；
3. 删掉 `readAll()` 里「不支持的区域不进候选」那一行 → 未作用域 store 的 1 例转红
   （作用域 store 靠区域比较本来就挡住，所以这一条专门钉住无作用域 store）。

全量：`tsc` 双配置通过；`vitest` **95 files / 1211 tests** 通过（原 93 / 1186 + 新增 2 files / 25 例）。

---

## 5. 明确没做的事

- **没有实现美国区**。`REGION_GATEWAYS` 仍然只有 `cn` / `ai`；US 的 pay 端点虽然报告人实测可用，
  但目录形态（`get_detail_param` + `function` 单数 + `agent_type: null`）与 chat 契约
  （`llm_utils_chat` 未注册、`create_agent_task` 的 config 绑定未知）都缺一份可信报文，
  这部分按 issue 里的建议留给「抓一次 IDE 实际请求」之后再做。
- **没有在本机对 US 网关发过请求**。开发机没有美国区凭据，所有结论来自报告人给出的实测数据
  与代码路径；测试用注入 `fetch` 断言「不会发出请求」，而不是模拟 US 响应。
- 没有改版本号、没有写 CHANGELOG 条目——按本仓库的发版流程，这两件事在
  `chore: 版本升级至 x.y.z` 提交里一起完成。

---

## 6. 给报告人的回复要点

1. 两个现象同源：US 被解析成 `ai`，读请求全部打到 `*.trae.ai`，那个 401 又被刷新路由包成了
   500。谢谢你附的两张对照表，它们直接定位了「host 选错」而不是「token 坏了」。
2. 本版不再把 US 当 SG：US 凭据不会被选中、不会发往任何网关，卡片会明确写「美国区暂不支持」
   并点名账号，重新登录的循环到此为止。
3. 401/403 已原样透出，刷新失败不会再显示成 `HTTP 500`。
4. **美国区仍未接入**。如果你能抓到一次 IDE 侧的 `/api/agent/*` 实际报文（尤其
   `create_agent_task` 的 model config 字段），US chat 就能照着实现；目录侧已有你的
   `get_detail_param` 结论可用。
