# Trae 用量管理 API 调查

> 只记录脱敏结构、字段名、数值与行为。不得复制 token、用户消息正文、账号信息或完整请求 body。

## 目标

确认能否用插件现有的 `Cloud-IDE-JWT` 凭据读取 Trae 「用量管理」数据（总可用额度、积分来源、签到、消费明细），以及每一步的证据与结论。

## 结论速览

| 数据 | 接口 | 结果 |
|---|---|---|
| 总可用额度 / 已消耗 / 比例 | `POST /trae/api/v2/pay/web_user_ent_usage`（别名 `user_current_entitlement_list`） | ✅ 可调，与截图精确一致 |
| 各项积分来源（老用户/签到/登录赠送/免费） | 同上 pack 列表 | ✅ |
| 计费状态（积分计费） | `POST /trae/api/v2/pay/cn_credits_billing_status` | ✅ `is_credits_billing: true` |
| 权益/活动规则 | `POST /trae/api/v2/pay/web_user_pay_status` | ✅ |
| 过期权益 | `POST /trae/api/v2/pay/expired_ents` | ✅ `{expired_ent_list: []}` |
| 每日签到状态 | `POST /trae/api/v2/ug/checkin_credits/status` | ✅ |
| **每日签到领取（写操作）** | `POST /trae/api/v2/ug/checkin_credits/claim` | ✅ 必须带 `x-device-id` |
| 奖励活动规则 | `POST /trae/api/v2/ug/activity/info` | ✅ |
| **每笔消费明细表** | `POST /trae/api/v1/pay/query_user_usage_group_by_session` | ⚠️ HTTP 200 但 `total: 0`，拿不到 |

除 `checkin_credits/claim` 外，所有接口均为**只读查询，不消耗 Trae 积分**。领取接口是**唯一会改变账号状态的调用**，只由用户在插件卡片上主动点击触发（详见下文「每日签到领取」）。

## 认证与 Host

- 凭据：桌面 `solo` edition 的 `Cloud-IDE-JWT` access token（插件 `auth.ts` 解析），host 为 `https://api.trae.cn`。
- 认证方式：`Authorization: Cloud-IDE-JWT <token>`，与聊天通道一致；与网页登录态（Cookie）是两套体系。
- 页面来源用 `Origin/Referer: https://www.trae.cn/` 与桌面 User-Agent 均可。

## 额度接口（核心，已验证）

`POST https://api.trae.cn/trae/api/v2/pay/web_user_ent_usage`
Body: `{"require_usage": true}`

返回顶层结构：

```text
is_credits_billing      true
is_dollar_usage_billing false
is_pay_freshman         true
trial_status            {is_eligible_for_trial:false, is_in_trial:false}
usage_summary           {consumed_amount, consumption_ratio, total_amount}
user_entitlement_pack_list[]
```

关键数值（本机实测）：

```text
total_amount    = 7500
consumed_amount = 5879.63
consumption_ratio = 0.78395...
可用            = total - consumed = 1620.37   ← 与截图"总可用额度 1,620.37"精确一致
```

### pack 列表（对应截图的积分来源）

| display_desc | currency | credits_limit | 说明 |
|---|---|---|---|
| 老用户福利 | 1 | 2000 | entitlement 326737122050 |
| 老用户福利 | 1 | 2000 | entitlement 326737122306 |
| 免费 | 0 | — | `free_utc20268_...` |
| 每月登录赠送 | 1 | 500 | `monthly_bonus_...` |
| 签到奖励 | 1 | 200 | `checkin_YYYYMMDD_...` 多笔（08-20 一笔已用剩 179.63） |

pack 内 `usage.credits_amount` 表示该套餐当前剩余积分。

## 其它已验证接口

- `POST /trae/api/v2/pay/cn_credits_billing_status` → `{is_credits_billing: true, should_force_switch: true}`
- `POST /trae/api/v2/pay/user_current_entitlement_list` → 与 web_user_ent_usage 相同结构（别名）
- `POST /trae/api/v2/pay/web_user_pay_status` → `client_reminder` + `commercial_activities`（express_lottery、work_fission、new_user_credits 等）
- `POST /trae/api/v2/pay/expired_ents` → `{expired_ent_list: []}`
- `POST /trae/api/v2/ug/checkin_credits/status` → `{checked_in: true, credits: 200, code: 0}`
- `POST /trae/api/v2/ug/activity/info` → `commercial_activities`（checkin_credits 200、new_user_credits 2000+2000、send_message_reward 500 等）

## 每日签到领取（写操作，2026-09-24 实测）

`POST https://api.trae.cn/trae/api/v2/ug/checkin_credits/claim`
Body: `{}`（官方客户端发 `{"req_source":1|2}`，实测该字段对结果无影响）

### 决定性发现：缺 `x-device-id` 会被拒

同一份 Authorization，仅改一个请求头，结果完全不同：

| 请求头 | 结果 |
|---|---|
| 插件原有头（`Authorization` / `Content-Type` / `UA` / `Origin` / `Referer`） | HTTP 200，`{"code":9004,"message":"The submitted order parameters are incorrect. Please try placing the order again"}` —— **未发放** |
| 追加 `x-device-id: <本机 dc 设备号>` | HTTP 200，`{"code":0,"message":"success"}` —— **奖励到账** |

- 业务码 `9004` 是**业务拒绝**，HTTP 状态仍是 200，所以「看 HTTP 状态」会把它误判为成功。
- `x-device-id` 取本机 `iCubeAuthInfo://icube-dc:<id>` 的数字后缀（即 `src/identity.ts` 的 `deviceId`，与聊天通道同源）。官方客户端在 `main.js` 的 `fb(headers)` 里给每个 ug 请求都补上它（`guaranteedDeviceId`）。
- 状态查询接口**不需要**该头也能正常返回；只有领取需要。

### 幂等性（已实测，未重复发放）

| 步骤 | 结果 |
|---|---|
| 领取前 status | `checked_in:false, did_checked_in:false` |
| claim | `code: 0` |
| 领取后 status | `checked_in:true, did_checked_in:true` |
| **再次 claim** | `code: 0`（仍报成功） |
| 再次 claim 后的额度 | `total=1600, consumed=390.8`，与首次领取后**逐字节相同** |

结论：上游按北京自然日幂等，重复调用**不会重复发放**。插件仍自行加守卫（领取前先读状态、已领取则直接返回且不发请求），因为「不会重复发放」是上游的行为、不是插件可以依赖的保证。

### 区域限制

`/trae/api/v2/ug/*` 全族在**国际版网关上不存在**（2026-09-24 实测：`growsg-normal.trae.ai` / `api-sg-central.trae.ai` / `api.trae.ai` 均 404，`www.trae.ai` 回落 HTML 首页）。因此国际版 tab 不显示签到按钮，插件路由对该区域直接答 404，而不是把一个上游 HTML 404 当成网络故障抛给用户。

### 客户端状态字段（来自官方 bundle）

官方 `workbench.desktop.main.solo-lite.js` 的签到状态机用到这些字段，插件对齐其判定：

- `enable` —— 活动是否开启（按钮是否可用）
- `checked_in` / `did_checked_in` —— **两个独立字段**；官方在「今日已领取」判定上同时看 `did_checked_in`，即使某次状态读回 `checked_in:false` 也保持按钮禁用
- `credits` —— 基础奖励；`extra_credits` —— 额外奖励（本机实测 150 + 50）

## 消费明细表（未拿到）

`POST https://api.trae.cn/trae/api/v1/pay/query_user_usage_group_by_session`

参数（来自 `www.trae.cn` 前端 bundle）：

```text
start_time, end_time, page_size, page_num, usage_type, Request
```

实测：
- 不传 `usage_type` → HTTP 200，`{"total":0, "user_usage_group_by_sessions":[]}`（多种时间窗、秒/毫秒、page_size、带不带 Request 均如此）。
- 传 `usage_type`（0/1/2/3 或字符串）→ HTTP 400（参数不合法）。

结论：认证通、接口存在，但当前账号/时间窗下不返回明细。截图里那些「DeepSeek-V4-Flash 0.09 / GLM-5.3 669.58」的记录无法从该接口复现。判断该明细可能属于另一产品端（Solo/TraeWork）或需要网页登录态下的其它接口；不继续无依据试错。

## 网页浏览调查

- `www.trae.cn/dashboard` 在无登录态下重定向到登录页（手机验证码/抖音/苹果/企业账号），走 Cookie 会话认证，与插件的 `Cloud-IDE-JWT` 是两套体系；无法代用户登录。
- `www.trae.cn` 前端 bundle 的 API client 统一注入 `Authorization: Cloud-IDE-JWT`，baseURL 为 `api.trae.cn`（`c.QU`）。
- 埋点/统计请求（`mcs.zijieapi.com`、`clarity.ms`、`bing`、`monitor_browser`）不含用量数据，可忽略。
- 从 Network 实测确认：用量页真正的数据请求就是 `api.trae.cn/trae/api/v2/pay/*`（已全部复现）和 `query_user_usage_group_by_session`（明细，空）。

## 建议下一步

1. ~~将已验证的额度/积分/签到/活动接口封装为插件只读命令（如 `trae.usage`）~~ **已完成（2026-08-28）**：
   - 新增 `src/usage.ts` 的 `TraeUsageClient`（只读，注入式 fetch），提供：
     - `snapshot()` —— 总可用额度、已消耗、各项积分来源与剩余
     - `checkinStatus()` —— 每日签到状态
     - `activities()` —— 奖励活动规则
     - `view()` —— 三者聚合
   - 已在 `tests/usage.spec.ts` 覆盖解析逻辑；`pnpm run check` 通过（19 测试文件、60 测试、typecheck 与 build 成功）。
   - 真实验证（本机 solo 凭据）：总可用 1620.37、签到 `checked_in:true`、packs 与活动规则均正常返回；只读、未消耗积分。
2. 消费明细表待拿到 Solo/TraeWork 网页版真实明细接口（需登录态）后再接入；不阻塞额度能力。
3. 所有新增接口遵循既有安全原则：只读、不写日志、不缓存 secret、脱敏输出。
4. ~~接入每日签到领取~~ **已完成（2026-09-24）**：
   - `TraeUsageClient` 新增 `claimCheckin()`（本客户端**唯一的写操作**），并让 `checkinStatus()` 一并回传 `didCheckedIn` / `extraCredits`；两者都带 `x-device-id`（`deviceId` 由 `index.ts` 从 `identity()` 注入，读不到时降级为不发该头，只影响领取、不影响状态查询）。
   - 新增路由 `POST /plugins/dsh-connect-trae/checkin`：仅 POST、仅回环来源、仅 `cn` 区域；**先读状态**，已领取直接返回且不发领取请求；活动关闭答 409。业务拒绝（如 9004）以 `claimed:false` + 原始 code/message 返回，不当成 500。
   - 卡片新增签到行（每日奖励、按钮、领取中/已领取三态），已领取判定同时看 `checkedIn` 与 `didCheckedIn`，与官方客户端一致。
   - 新增 21 条测试（`usage.spec.ts` 6 条、`web-status.spec.ts` 7 条、`card-checkin.spec.tsx` 8 条，含真实点击；全仓测试数 261 → 282）；做过**变异验证**：去掉路由的 `didCheckedIn` 守卫、去掉卡片的同款判定、把卡片改成 GET，对应测试各自立刻失败。
