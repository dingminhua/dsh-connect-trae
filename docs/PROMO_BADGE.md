# 模型行的活动优惠徽标

2026-10-21 实装。Trae 把促销**规则**发在模型目录里，插件按当前时钟判定后，在模型名旁边画一枚
胶囊徽标（`5 折` / `闲时 5 折` / `限时 5 折`），悬停说明原价、现价与时段。

只读取证：`GET /api/remote/v1/models` 与 `POST /api/ide/v1/get_detail_param`，不消耗积分、不改账号状态。

## 0. 一句话

**Trae 发的是规则，不是文案。** 徽标能显示，但「五折」这几个字是插件从上游的 `discount: 50`
读出来的数字，不是上游给的字——与 WorkBuddy 那种「上游原话」徽标不同（对照见 §4）。

## 1. 数据在哪：两个来源，同名字段

| 来源 | 字段位置 | 实测（CN，2026-10-21） |
|---|---|---|
| Remote 目录 `GET https://solo.trae.cn/api/remote/v1/models` | 每个模型行的 `features`（JSON 字符串）里的 `activity_discount` | 7 组 / 126 行 / **33 个不同模型**，其中 4–7 个带规则（见 §5 的组间差异） |
| Wire 名单 `POST https://trae-api-cn.mchost.guru/api/ide/v1/get_detail_param` | 每行的 `display_contact_config`（JSON 字符串）里的 `activity_discount` | 5 个聊天 function 共 214 行（去重前）、26 行带规则 → **9 个不同模型**；同一时刻 2 个在打折（2026-10-21 17:14 复测） |

wire 这份更全（同一模型两边 `subKey` 可能不同），所以 `mergeTraeModelSources` 里 **wire 覆盖 remote**
（`src/catalog.ts:330`），与 `creditMultiplier` 的既有优先级一致。

## 2. 字段形状（真实抓包，逐字）

`deepseek-v4.1-flash`（remote，节选）——闲时型：

```json
"activity_discount": {
  "enable": true,
  "subKey": "off_peak_member_discount_18_9",
  "data": {
    "current": { "discount_type": "none", "before_consumption_rate": 0.12, "consumption_rate": 0.12, "discount": 100 },
    "member":  { "before_consumption_rate": 0.12, "after_consumption_rate": 0.06, "discount": 50 },
    "off_peak": {
      "before_consumption_rate": 0.12, "after_consumption_rate": 0.06, "discount": 50,
      "time_zone": "Asia/Shanghai",
      "time_windows": [
        { "weekdays": [1,2,3,4,5], "start_minute": 0,    "end_minute": 540  },
        { "weekdays": [1,2,3,4,5], "start_minute": 720,  "end_minute": 840  },
        { "weekdays": [1,2,3,4,5], "start_minute": 1080, "end_minute": 1440 },
        { "weekdays": [6,7],       "start_minute": 0,    "end_minute": 1440 }
      ]
    }
  }
}
```

`Doubao-Seed-2.1-Turbo`（wire）——此刻真在打折的那条：

```json
"activity_discount": {
  "enable": true,
  "subKey": "subsidy_member_discount",
  "data": {
    "current": { "discount_type": "subsidy", "before_consumption_rate": 0.4, "consumption_rate": 0.2, "discount": 50 },
    "member":  { "before_consumption_rate": 0.4, "after_consumption_rate": 0.1, "discount": 25 },
    "subsidy": { "before_consumption_rate": 0.4, "after_consumption_rate": 0.2, "discount": 50 }
  }
}
```

要点：

- `discount` 是**百分比数字**（`100` = 不打折，`50` = 五折，`25` = 二五折），不是 0–1 的倍率。
- `subKey` 是活动机器名，实测四种：`limited_discount`（限时）、`subsidy_member_discount`（补贴+会员）、
  `off_peak_discount` / `off_peak_member_discount_18_9`（闲时）。
- `off_peak` 的 `time_windows` 是**周几 + 当天分钟数 + 命名时区**；`1440` 是上游写「当天结束」的方式，
  `start` 含、`end` 不含。
- `current` 是**上游自己算好的「此刻状态」**。实测把请求头 `x-trae-user-timezone` 从
  `Asia/Shanghai` 换成 `America/Los_Angeles`，`current` 完全不变——它是服务端时钟算的，
  **不跟随请求时区**；`time_windows` 才需要客户端自己按模型声明的时区算。
- 判不了窗口直接丢弃：缺周几、`start >= end`（含 `start === end`）、越界的条目都不进规则表。
  上游目前只发**同日**时段（`0–540`、`1080–1440`、周末 `0–1440`），所以插件**不推断**
  「`start === end` 即全天」，也不拼跨零点窗口——宁可少画一枚，不留一个自己发明的时段。
  时区写坏（不是合法 IANA 名）时退回账号时区，悬停里报**实际用来判定的那个时区**。

## 3. 判定规则（为什么必须在渲染时刻判定）

解析层只把规则**原样留下**，不挑徽标；徽标由 `selectTraePromoBadge(discount, now)`（`src/promo.ts:332`）
在卡片每次渲染时按当刻时钟判定。理由与 WorkBuddy #91 相同：若是解析时就定一枚，夜里读到的
「闲时五折」会在第二天早上继续挂着。实测同一份规则表，时钟 +6h 出现 3 枚、+12h 出现 5 枚、回到
白天又只剩 2 枚（§5 复现命令）。

顺序（宁可少画，不可乱画）：

1. `enable !== true`，或四个分支都没有价格 → 无徽标（`parseTraeActivityDiscount` 直接返回 `undefined`）。
2. 先信上游的 `current`：`discount_type !== 'none'` **且** `consumption_rate < before_consumption_rate`
   → 上游明确说此刻在打折，用它的数字。
3. `current` 说没打折时，再自算 `off_peak`：按 `time_zone`（缺省 `Asia/Shanghai`）取该时刻的
   ISO 周几与分钟数，落在某个窗口里 → 闲时折扣。
4. 两者都没有 → **不画**。不从 `creditMultiplier < 1` 猜：那可能是会员价或本来就便宜的定价，
   猜出来的徽标会是一句谎。
5. 一个模型最多一枚徽标：模型行只有一行宽，两枚会把模型名与勾选框挤出行外。
6. 徽标画在模型名**旁边**而不是名字里面：`dsm-trae-model-name` 带 `text-overflow: ellipsis`，
   放进名字里会被一起裁掉。

时钟可信度：`current` 是上游判断、`time_windows` 是本地判断，两者可能因时钟偏差或缓存不一致。
所以**先信 `current`**，只在它报「没打折」时才用本地窗口补算——既不会漏掉补贴活动，
也不会在窗口边界上自说自话。

## 4. 与 WorkBuddy #91 的差距

| 能力 | WorkBuddy | Trae | 影响 |
|---|---|---|---|
| 促销绑模型 | `modelIds` 数组 | 行自身字段（天然一对一） | 不需要 `attachPromos` |
| 文案 | `badge.label / labelEn` | ❌ 无 | 插件按 `subKey` + `discount` 生成 |
| 颜色 | `badge.color`（#rgb） | ❌ 无 | 插件按类型定色（见 `src/client/styles.ts:315`） |
| 悬停说明 | `hover.textZh / textEn` | ❌ 无 | 插件拼「原价 x → 现价 y」「时段 …」 |
| 时段 | `schedule.daily` + `validFrom/validUntil` | `off_peak.time_windows`；wire 的 `limited` 分支另有 `end_at`（插件不读，见 §7） | 闲时能算；「活动什么时候彻底结束」只有限时活动说过，而限时活动当前由 `current` 表达 |
| 优先级 | `priority` 数字 | ❌ 无 | 同一模型一般只有一条规则 |
| 常驻展示型 | `display !== 'activeOnly'` | ❌ 无 | 只有「此刻真的在打折」才画，不常驻 |
| 国际区 | 全球区有 5 条 | **无**（订阅制，连 `consumption_rate` 都没有） | 徽标只在 CN 出现，代码路径同一条 |

## 5. 实机复核（只读，不消耗积分）

`scripts/probe-promo.mjs` 用插件**自己的**解密逻辑读本机 Trae 登录、拉一次目录，然后用
`parseTraeRemoteModel` + `preferStrongerRow` + `selectTraePromoBadge` 复算卡片会画什么：

```
node --experimental-transform-types scripts/probe-promo.mjs --shifts
```

2026-10-21 15:58（Asia/Shanghai）的结果：

```
remote groups: 7   rows: 33   rows carrying a rule: 7
== badges now (2) ==
- Doubao-Seed-2.1-Turbo    subsidy   50% pay (50% off)
- Doubao-Seed-Code         subsidy   50% pay (50% off)
== rule but no badge right now (5) ==
- Doubao-Seed-2.1-Pro      subKey=limited_discount              windows=0
- Doubao-Seed-Evolving     subKey=limited_discount              windows=0
- deepseek-v4.1-flash      subKey=off_peak_member_discount_18_9  windows=4
- DeepSeek-V4-Flash-Official  subKey=off_peak_discount          windows=2
- DeepSeek-V4-Pro-Official    subKey=off_peak_discount          windows=2

== 同一份规则，时钟平移（判定随时间变，不是冻结值） ==
+ 0h: 2 badges   + 6h: 3 badges   +12h: 5 badges   +24h: 2 badges   +36h: 5 badges
```

`limited_discount` 与 `limited` 之外的两类都只有 `data`、没有绝对有效期，所以**只有
`limited_discount` 的文案敢写「限时」**；其余只写折扣数字。这与 #91「徽标只说上游的话」同一原则：
上游没说的，不编。

带规则那 7 行的实际构成（2026-10-21 17:14 复核）：3 个 `off_peak`（`off_peak_discount` ×2 +
`off_peak_member_discount_18_9` ×1）、2 个 `limited_discount`、2 个 `subsidy_member_discount`。
平移计数据此而来：窗口开合是**时钟**的函数，同一份规则在不同时刻画的枚数不同（上表 15:58 是
2/3/5/2/5；17:14 复跑是 2/5/5/2/5，因为 21:58 与 23:14 落在不同的闲时窗口里）。

### 组间不一致：规则会随分组出现/消失

同一次响应里，`Doubao-Seed-2.1-Turbo` 在部分 group 带规则、在部分 group 完全没有
`features.activity_discount`，而**分组顺序每次调用都可能不同**（issue #23 已记录同一现象）。
因此 `preferStrongerRow`（`src/solo-remote.ts`）在按容量选行之后，会把另一行携带的规则**并到赢家身上**
（`richerRule`：先比「当前是否真在打折」，再比窗口数量，分数相同再比规则内容的规范化 JSON——
最后这一步是必要的：两条「都没有 current、各 1 个窗口」的规则分数相同，若按先到先得，
今晚有没有徽标就取决于网关的分组顺序）。不这么做，徽标就会出现一半时间消失、
且与用户看到的折扣不一致——实测用「先到先得」去重时，两次相邻调用一次 0 枚、一次 1 枚。
选择「合并规则」而不是「选择带规则的行」，是因为后者会丢掉 1M Max 档：徽标不能以用户失去上下文预算为代价。

## 6. 落地位置

| 层 | 位置 |
|---|---|
| 解析 + 判定 | `src/promo.ts`：`parseTraeActivityDiscount`（`:174`）、`zonedClock`（`:225`）、`selectTraePromoBadge`（`:339`）、`runningWindow`（`:261`）；默认时区 `TRAE_PROMO_DEFAULT_TIME_ZONE`（`:116`） |
| remote 行 | `src/model-metadata.ts:98`（`features.activity_discount`）、`:116`（带出字段） |
| wire 行 | `src/solo.ts:190`（`wireActivityDiscount`）、`:351`（读 `display_contact_config`） |
| 合并 | `src/catalog.ts:340`（wire 覆盖 remote）、`:439`（`discoveredCatalog` 透传） |
| 持久化 | `src/index.ts:428`（`activityDiscount: z.any<TraeActivityDiscount>()`，未解析的规则原样存盘，读回后仍按当刻判定） |
| 送卡片 | `src/status-paths.ts:699`（`TraeWebModel.activityDiscount`）；`src/web-status.ts:610` 用对象展开送出，新字段自动抵达 |
| 渲染 | `src/client/TraeUsageCard.tsx:230`（`PROMO_LABELS`）、`:255`（`promoBadge`）、`:1151`（每次渲染取一次 `nowForPromo`）、`:1993`（挂在模型名旁边） |
| 样式 | `src/client/styles.ts:315-317`（补贴 / 闲时 / 限时三档，颜色为插件选择，非上游下发） |
| 文案 | `src/client/locales.ts:194-199`（en）、`:542-547`（zh） |
| 复算脚本 | `scripts/probe-promo.mjs` |

## 7. 已知限制

- **「限时」目前不会真的出现**：只有 `limited_discount` 有依据，其余只写折扣数字。而实测的两个
  `limited_discount` 行（`Doubao-Seed-2.1-Pro`、`Doubao-Seed-Evolving`）`current` 都报
  `discount_type: none`（活动已结束），且没有 `off_peak` 窗口，所以不画徽标——如实转述。
  wire 的 `limited` 分支还带一个绝对结束时间 `end_at`（实测 2026-10-15 已过期），
  解析层**有意不收**它：活动是否生效由上游的 `current` 说，插件不自己推断；
  若上游哪天把限时活动标成 `current.discount_type != none`，文案会直接跟着出现。
- **国际区恒无徽标**：订阅制没有 `consumption_rate`，更无 `activity_discount`；上游哪天补上即自动生效。
- **`current` 可能滞后**：服务端算的，缓存或时钟差会让徽标比真实窗口晚几分钟出现/消失；接受。
- **不动倍率那行**：`creditMultiplier` 照旧显示在 `x{rate}` 处（企业版不显示），徽标是额外的、
  只在活动时出现的信息。
- **`limited_discount` 没有窗口**：它只有 `current` 一个判断，不给 `off_peak.time_windows`。
  所以它在 `current` 报「没打折」时不会自己算出一个时段——这一点和其它两类不同，属于如实转述。
