# Trae 官方客户端怎么渲染活动优惠（以及我们为什么只画一枚）

2026-10-23 取证。起因：同一个 `deepseek-v4.1-flash`，插件在模型选择器里挂「闲时 5 折」，
Trae 自己的选择器挂「会员 5 折」，而它的详情栏又把「闲时折扣」和「会员专享 5 折」并排列出、
数字一模一样。看上去像两边算法差得很远，实际是**同一份数据被两套渲染模型解释**。

只读取证，不消耗积分、不改账号状态：

- 读本机安装包：`%LOCALAPPDATA%/Programs/Trae CN/resources/app/`（v3.4.4，build 2.3.93438）
- 读本机日志：`%APPDATA%/Trae CN/logs/<session>/window1/renderer.log`
- 走插件自己的凭据拉一次 `POST /api/ide/v1/batch_get_detail_param`（IDE 选择器用的那份名册）
  与 `GET https://solo.trae.cn/api/remote/v1/models`（插件目录）

## 0. 一句话

**官方不"判定折扣"，它渲染配置。** 服务端下发一棵 `featureOrder + features` 渲染树，
客户端逐条匹配路由、跑 Jexl 分支，产出「行上的一枚 tag」和「提示框里的若干 section」。
判定与文案都在配置里，所以同一个活动可以对会员、非会员、不同活动单独定制；
我们这边是「subKey → 单一 kind → 一枚徽标」，一句话概括就是**官方画的是活动，我们画的是判决**。

## 1. 渲染树（`@byted-solo/commercial-config-sdk`）

`resources/app/node_modules/@byted-solo/commercial-config-sdk/dist/index.d.cts`：

```ts
interface ModelFeatureRenderRootConfig {
  enabled?: boolean
  schemaVersion: number
  featureOrder?: string[]                                  // 画什么、按什么顺序
  features?: Record<string, ModelFeatureRenderConfig>      // key = "activity_discount/<subKey>"
}
```

每条 feature 可以给：

| 字段 | 作用 |
|---|---|
| `when` | Jexl，什么时候这条路由成立 |
| `base.render.tag` | 行上那枚胶囊（`content: CopyConfig` + `variant`） |
| `base.render.tooltip.sections[]` | 详情栏，一段一个 section（title / description / tags / link / button / highlight），也可以是内置渲染器 |
| `branches[]` | 按 `when` 选一层 patch（render / restriction / control） |
| `timeProjection` | 时段投影：`schedule.type='weekly_windows'`、时区**只允许** `Asia/Shanghai`/`UTC`、窗口是一段 Jexl；`active`/`inactive`/`fallback` 各给一条 `consumptionRate` 的 Jexl |

内置渲染器（`MODEL_TOOLTIP_BUILTIN_RENDERERS`）：
`max_mode_switch`、`reasoning_effort_internal_selector`、`reasoning_effort_selector`、
`context_window_selector`、`model_load`、`model_feedback`、`available_features`。
截图二右栏那些「图片理解 / 思考强度 / 更大上下文」就是这一层，和优惠无关。

解析入口是 `dist/index.cjs` 的 `resolveModelFeatureRenders()`，顺序：

1. 按 `featureOrder` 遍历，`parseFeatureRoute()` 把 `activity_discount/off_peak_member_discount_18_9`
   拆成 `featureKey` + `subKey`；
2. 取后端事实 `features[featureKey]`，**只有 `enable === true` 且 `subKey` 与路由一致**才算命中
   （否则 `continue`，所以一个模型只会命中它自己那条活动路由）；
3. 没有后端事实时才用配置里的 `when` 兜底；
4. 选第一个匹配的 branch，把 `base.render` 与 branch 的 `render` 合并；
5. 每个命中的 feature 都产出一份 `{tag, tooltip.sections, timeProjection}`，按顺序叠加。

时段判定不靠上游的 `current`：`resolveWeeklyWindowState()` 自己算——ISO 周几 + 当日分钟，
`start` 含 `end` 不含，并给出 `nextBoundaryMs`；倍率由 `active`/`inactive`/`fallback` 三条
Jexl 取。这与我们 `src/promo.ts` 的窗口算法**结论一致、来源不同**（我们信 `current` 优先）。

## 2. 现场证据（2026-10-23，CN 账号）

`renderer.log` 里 host-context 的快照（每次打开选择器都打一次）：

```json
{"userPayIdentity":0,"entitlementIdentity":0,"hasOriginPayStatus":true,
 "featureRenderEnabled":true,
 "featureOrder":["model_version_notice","provider","available_features","beta",
   "consumption_rate","reasoning_effort","max_mode",
   "activity_discount/subsidy_member_discount","activity_discount/limited_discount",
   "activity_discount/off_peak_discount","activity_discount/off_peak_member_discount",
   "activity_discount/off_peak_member_discount_18_9",
   "discount/member_discount","discount/exclusive_discount",
   "access","access/download_work"],
 "isCN":true,"isSaas":false,"isInternalUser":false}
```

两点值得记：

- `userPayIdentity: 0` = `CommercialUserPayIdentity.Free`（SDK 枚举），日志另有
  `isCommercialUser: false` —— **当前是免费用户**，但行上照样挂「会员 5 折」。
- `activity_discount/off_peak_member_discount_18_9` 是**单独一条命名路由**，与泛化的
  `activity_discount/off_peak_member_discount` 并列。配置可以针对单个活动定制文案，
  `18_9` 就是「18:00–09:00」那个窗口。

IDE 名册那一行（同一时刻）：

```json
{"config_name":"deepseek-v4.1-flash",
 "display_contact_config":{
   "activity_discount":{"enable":true,"subKey":"off_peak_member_discount_18_9","data":{
     "current":{"discount_type":"off_peak","before_consumption_rate":0.12,"consumption_rate":0.06,"discount":50},
     "member":{"before_consumption_rate":0.12,"after_consumption_rate":0.06,"discount":50},
     "off_peak":{"before_consumption_rate":0.12,"after_consumption_rate":0.06,"discount":50,
                 "time_zone":"Asia/Shanghai","time_windows":[/* 00:00-09:00, 12:00-14:00, 18:00-24:00, 周末全天 */]}}},
   "consumption_rate":{"enable":true,"data":{"rate":0.06}},
   "access":{…},"multimodal":{…},"reasoning":{…}}}
```

`current` 是**请求时刻服务端现算**的：13:31 取到 `off_peak / 0.12→0.06`，
14:01 再取同一条变成 `none / 0.12→0.12`（窗口在 14:00 关闭）。这一点与插件假设一致。

## 3. 两个 5 折是同一降价的两种资格路径

本地 i18n 表（`@byted-icube/solo-lite/dist/6645.b1c7b531.mjs`）把文案模型写得很直白：

| key | 中文 |
|---|---|
| `activity_discount.off_peak.title` | 闲时折扣 |
| `activity_discount.off_peak.description` | 空闲时段 {fold} 折，积分消耗速度从 {before} 倍降至 {after} 倍。 |
| `activity_discount.off_peak.non_off_peak_hours` | 非空闲时段：北京时间周一至周五 9:00-12:00、14:00-18:00 |
| `activity_discount.member.tag` | 会员 {fold} 折 |
| `activity_discount.member.title` | 会员专享 {fold} 折 |
| `activity_discount.member.upgrade_description` | 开通会员享 {fold} 折，积分消耗速度从 {before} 倍降至 {after} 倍。 |
| `activity_discount.member_all_day.description` | 会员全天专享 {fold} 折，… |
| `activity_discount.off_peak_member.free_description` | **非会员用户仅空闲时段 {fold} 折：{windows}。** |

最后一条是关键：`off_peak_member` 这个活动类型本身就意味着
「**会员全天 5 折；非会员只在闲时窗口内 5 折**」。两条分支指向同一个 0.06，
是两条资格路径，**不是两次叠加**。详情栏把两条都列出来是在回答「我能不能享」，
不是在算 0.12×0.5×0.5。

顺带一个自证：截图二会员段用的是 `member.upgrade_description`（「开通会员享…」），
不是 `member.description`（「会员专享…」）—— 给非会员的升级话术，与 `userPayIdentity: 0` 对得上。

## 4. 为什么行上是「会员 5 折」，我们是「闲时 5 折」

行上那枚胶囊是配置里的一条 `tag`（单条 CopyConfig）。对
`off_peak_member_discount_18_9` 这条路由，配置给的是 `member.tag` =「会员 {fold} 折」——
**它描述的是活动的招牌价，不是此刻这个人付的价**，所以免费用户也看得到。

插件这边 `kindOf()`（`src/promo.ts`）只看 `subKey` 的 `off_peak` 半截，`member` 那半直接丢，
于是同一个活动长出另一张脸：`闲时 5 折`。

两边都只说了半句真话：官方那半句是「这个活动的招牌是会员价」，我们这半句是「此刻闲时生效」。
合起来看就像算法差了十万八千里，实际是**表述粒度不同**。

## 5. 差异对照

| 维度 | 官方客户端 | 本插件 |
|---|---|---|
| 判定来源 | 服务端渲染配置的 Jexl + 本地时段投影 | 上游 `current` 优先，其次本地窗口 |
| 文案来源 | 配置里的 CopyConfig（引用本地 i18n 键） | `locales.ts` 固定几条 |
| 能画几段 | 每个命中 feature 一份 tag + 任意多 section | 一枚徽标 + 一句悬停 |
| 会员维度 | 活动类型自带（member / off_peak_member / subsidy_member），可给不同话术 | 只进悬停，不参与判定 |
| 活动特例 | 可按 subKey 定制（`…_18_9`） | 只按 subKey 前缀分三类 |

## 6. 由此改了什么（4.4.3）

- **会员价只在更便宜时才说**。`badgeOf()` 现在比较两条分支的**折后价**：
  `member.rate < 现价` 才带 `memberRate`/`memberDiscountPercent`，文案从「会员价另有 X 折」
  改成「会员价 {rate} 积分/百万 token（X 折）」。等值时整句不出现——
  这正是 `deepseek-v4.1-flash` 的形状，旧文案会让人读成 0.03。
- **「闲时」带上真的时段**。`current` 判定为 `offPeak` 且本地时钟确认有窗口在跑时，
  把该窗口挂到徽标上；时钟与上游不一致时宁可不报时段，也不编一个。

## 7. 复现

```bash
# 1) 官方名册（IDE 选择器读的那份），看 activity_discount 原文
node --experimental-transform-types scripts/probe-promo.mjs

# 2) 官方渲染顺序与付费身份（每次打开选择器写一次）
grep -o '"featureOrder":\[[^]]*\]' \
  "$APPDATA/Trae CN/logs/$(ls -t "$APPDATA/Trae CN/logs" | head -1)/window1/renderer.log"

# 3) 渲染树语法（类型即文档）
sed -n '840,1060p' \
  "$LOCALAPPDATA/Programs/Trae CN/resources/app/node_modules/@byted-solo/commercial-config-sdk/dist/index.d.cts"
```

## 8. 已知边界

- **配置体看不到原文**：`/icube/api/v1/native/config/query` 返回的 `data` 是
  AES-CTR + gzip（`dynamic-config-sdk` 的 `decodeConfig`），密钥由主进程注入，
  本机 JS 里没有。所以「这条路由的 tag 到底配了哪句话」只能从**渲染结果**反推；
  本文引用的类型、`featureOrder`、i18n 文案都是本地可验证的。
- **i18n 里有历史遗留文案**：本机这版 `off_peak.hours` 写的是「每日 22:00-次日 8:00」，
  与这个活动的真实窗口（00-09 / 12-14 / 18-24 / 周末）不符——配置改用了
  `non_off_peak_hours` 才没印错。文案与规则分离的另一面：配置选错键就会说过期的话。
- **`current` 会滞后**：服务端算的，缓存或时钟差会让它比真实窗口晚几分钟翻面。
  插件这次给徽标补窗口时，只在本地也认为窗口开着时才补——两边不一致就闭嘴。
