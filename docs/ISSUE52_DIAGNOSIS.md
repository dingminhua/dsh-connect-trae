# issue #52 诊断：模型数量爆炸的三条根因，以及「客户端只有 21 个」的真实来源

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/52>
> （「啊，为啥 trae 的模型数量这么爆炸」——截图两张：插件卡片 40+ 行，尾部整屏是老模型；
> 「traecode 客户端显示的最新模型 21 个左右吧，而且排序非常规整」「还存在拿 code 的模型请求
> solo 模型的潜在风险？」）
> 诊断时间：2026-10-23　方法：本机 CN 实时凭据跑**只读、零额度**探针
> （Remote `/models` 目录 + SOLO wire `get_detail_param` + IDE 全量
> `batch_get_detail_param` 三份原始响应 → `mergeTraeModelSources` 全链路）
> 状态：**P1 已实施**（`src/official-roster.ts` + 发现流程接入，见 §10）；P0/P2/P3 未做

---

## 0. 一句话结论

| 问题 | 结论 | 证据强度 |
|---|---|---|
| 为什么会 46 个 | 插件列的是 **12 个通道的并集**（35 行骨架 + 11 行 #46 提升），而客户端**一次只渲染一个通道** | 实测（单通道官方可见 11–24 个） |
| 「21 个左右」是哪来的 | 就是**某一个通道**的官方可见列表：`solo_work_lite` 19 / `solo_agent_lite` 19 / `solo_agent_remote` 18 / `solo_work_remote` 24 | 实测 |
| 老模型是 Bug 还是设计 | 是 **#46 的修复溢出**：那 11 行提升行里，13 行（含 `kimi-k2`、`glm-4.6/4.7`、`minimax-m2*`）在官方名册里被显式标为 `is_invisible_to_user: true` | 实测 |
| 排序为什么乱 | **没有任何排序**：顺序 = 12 段目录的拼接顺序，而网关的分组顺序**每次调用都会变**（代码里早已记录，`src/solo-remote.ts:115`），提升行还统一追加在尾部 | 实测 + 代码 |
| 「拿 code 的模型请求 solo」 | 担心是对的，但泄漏点不是计费：46 行里 **8 行钉在 `solo_coder`、8 行钉在 `chat_v3`**，另有 1 行没有 function 会被塞进默认 `solo_work_lite`（就是 #46 §9 实测 4001 的 `doubao_1_8`） | 实测 |
| 有没有现成的解 | 有。参考插件 `deepseek-harness-codearts` 已经用 `batch_get_detail_param` + `is_invisible_to_user` + 通道优先级 + 用户黑名单做完了同类取舍 | 源码对照 |

---

## 1. 先把数字钉死

本机 CN 账号，2026-10-23，只读探针（不调用任何 chat 接口）：

```text
Remote /models 目录   12 个分组  168 条原始行  →  解析后 35 行
SOLO wire roster      5 个 function           →  85 行
mergeTraeModelSources                        →  46 行（当前发布的行为）
```

46 行的构成：

| 来源 | 行数 | 说明 |
|---|---|---|
| Remote 骨架 | 35 | 12 个通道拼接去重 |
| #46 提升的 wire 行 | 11 | 骨架不收录的历史/快照 config |

按调用通道（`wireFunction`）分布——**这一列才是「拿哪个通道的模型去请求」的真相**：

| function | 行数 | 性质 |
|---|---|---|
| `solo_work_remote` | 26 | 主工作通道 |
| `chat_v3` | 8 | 通用 chat 通道 |
| `solo_coder` | 8 | **代码通道** |
| `solo_agent_remote` | 3 | agent 通道 |
| （无，回落到默认 `solo_work_lite`） | 1 | `doubao_1_8`，实测 4001 |

---

## 2. 根因一：我们在列「并集」，客户端在列「一个模式」

这一条是整件事的核心，也是之前所有 issue 都没说破的地方。

`batch_get_detail_param`（IDE 选择器渲染的那份名册）实测：**22 个分组、554 条、106 个唯一
config**。按官方信号过滤（`usage === 'chat_completion'`、`is_invisible_to_user !== true`）后，
**每个通道各自**的可见对话模型数是：

| 通道 | 对话条目 | 官方可见 |
|---|---|---|
| `solo_work_remote` | 35 | **24** |
| `solo_agent_lite` | 24 | **19** |
| `solo_work_lite` | 28 | **19** |
| `solo_agent_remote` | 26 | **18** |
| `solo_coder` | 29 | **16** |
| `builder_v3` | 31 | **15** |
| `chat` | 23 | **15** |
| `chat_v3` | 30 | **14** |
| `solo_agent` | 38 | **14** |
| `builder` | 26 | **13** |
| `solo_design_lite` / `solo_design_remote` | 11 | **9** |
| `inline_chat` | 7 | **6** |
| `ui_builder_v2` / `solo_builder` / `custom_agent_generation` / `utils` | 4 | **4** |

把 12 个通道**并起来**去重：**43 个**。用户看到的 21 个，正好落在「单通道 14–24」这个区间。

**所以「数量爆炸」不是读错了数据，而是产品语义选错了**：Trae 客户端是
「你在哪个模式，就只看那个模式的模型」；我们是「把所有模式的模型倒进一个列表」。
单通道 19 个 × 12 个通道的并集 = 46 行——两边都没错，错在把它们当成同一件事。

---

## 3. 根因二：#46 的补齐把「能调但官方不展示」的历史模型翻了出来

46 行里，有 **13 行**在官方名册中被显式标记 `is_invisible_to_user: true`：

```text
kimi-k2 (Kimi-K2-0905, 28K)   kimi-k2.7-code      seed-code-pro-0430
glm-5-turbo                   glm-4.7             glm-4.6
minimax-m2 / minimax-m2.1     minimax-m2-auto      minimax-m2.1-auto
glm-4.6-auto                  qwen3-coder          kimi-k2-0905 (168K)
```

外加 2 行（`kimi-k2.8-preview`、`qwen3.8-flash`）**根本不在 batch 名册里**——它们只存在于
Remote 目录的 `chat_v3` 分组。

这不是「插件读错」，而是 #46 立下的规则本身没有上限：`isPromotableWireModel`
（`src/catalog.ts:292`）只问「能不能调、有没有真名字、有没有被占名」，**没问「官方是否对用户
隐藏」**。于是每一个历史 config 只要可调用，就都被提升成了目录行——#46 当时的心智是
「别把用户能用的东西藏起来」，代价就是 #52 的「怎么这么多」。

> 这两条 issue 是同一条钟摆的两端：
> **#19**「名单的沉默不等于不可调用」→ 保留行；
> **#46**「骨架漏收带日期的快照」→ 提升行；
> **#52**「那也别把官方已经藏起来的都翻出来」→ 需要第三条信号：**上游说它该不该显示**。
> 而 `is_invisible_to_user` 正是这条信号，我们早就有它的端点（`src/model-detail.ts`），
> 却从没调用过。

### 重名不是去重规则的问题，是并集的必然产物

实测 6 组显示名重复：

| 显示名 | 两个 id | 上下文 |
|---|---|---|
| `DeepSeek-V4-Flash` | `DeepSeek-V4-Flash-Official`（`solo_work_remote`） / `DeepSeek-V4-Flash`（`chat_v3`+`solo_coder`，beta） | 都是 200K |
| `DeepSeek-V4-Pro` | 同上结构 | 都是 200K |
| `Kimi-K2-0905` | `kimi-k2`（28K，`inline_chat`） / `kimi-k2-0905`（168K，`solo_coder`） | 差 6 倍 |
| `GLM-4.6` / `MiniMax-M2` / `MiniMax-M2.1` | 本体 / `-auto` 孪生 | 100K vs 168K |

注意前两组：**两个 id 是同一模型在不同通道的两份 config**，客户端在单个通道里永远不会同时
出现——只有并集才会。这也是为什么 #46 §9 那条「重名按能力比较」的规则越修越复杂：它是在
**替并集擦屁股**。回到单通道视图，6 组重名里有 4 组会自然消失。

---

## 4. 根因三：顺序没有任何规则

`mergeTraeModelSources` 的输出顺序 = `for (const model of remote)` 的到达顺序，
而 `remote` 是 12 个分组的拼接。`src/solo-remote.ts:115` 自己写着：

> the gateway groups its directory by function and reports a model's capacity per group,
> **with the group order varying between calls**.

也就是说：**同一份目录，两次刷新可能给出不同顺序**。代码只用这个事实决定了「同一模型取哪
一行字段」（`pickStrongerRow`），从没把它当排序问题处理。再叠上提升行统一追加尾部
（实测 `#36`–`#46` 全是提升行），就得到用户看到的形状：

```text
1–35   骨架 12 段拼接（顺序随网关波动）
36–46  历史模型，整齐地排在最后
```

「排序非常规整」的客户端 = 单通道名册的**固定顺序**；我们 = **12 段拼接 + 尾部追加**。

---

## 5. 「拿 code 的模型请求 solo」：担心成立，但要换个说法

用户的原话是「拿 code 的模型请求 solo 模型的潜在风险」。实测下来，风险存在，但**不是计费
串味**，而是三个具体的错配：

1. **通道错配**：46 行里 8 行钉 `solo_coder`、8 行钉 `chat_v3`。`wireFunction` 会被原样回放
   （`prepareSoloBody`），所以 `kimi-k2-0905` 这类只在代码通道出现的 config，是**以代码通道
   的身份**被我们当通用模型调用的。能出字（#46 §9 实测 26s AVAILABLE），但语义上不是同一个东西。
2. **默认通道兜底**：`doubao_1_8` 在目录里没有 chat function，`withChatCallableFunctions` 会
   清空 function，于是它被塞进默认的 `solo_work_lite`——那正是 #46 §9 实测 **4001** 的那一行。
   「保留行 + 如实报错」在 #19 成立，但这一行是**已知调不通还留在列表里**。
3. **隐藏是逐通道的**：`is_invisible_to_user` 不是 config 的属性，是 **(config, 通道)** 的属性。
   实测 `glm-4.7` 在 `code_review_summary` 下官方可见、在 `solo_coder` / `solo_work_remote` 下
   被隐藏。我们取的是「首个出现通道」的那一份判定——**恰好可能就是官方不让用的那一份**。

第 3 点是最隐蔽的：它意味着「官方可见性」必须**和 function 一起判定、一起搬运**，不能像
`contextWindow` 那样单独 merge 一个字段。

---

## 6. 参考插件怎么做的：`deepseek-harness-codearts`

同作者的另一份插件（`trae.ts` / `trae-adapter.ts` / `trae-product.ts`）已经把这套取舍做完了，
四个可以直接借的做法：

| 做法 | 它的实现 | 对应我们的哪个洞 |
|---|---|---|
| **名册只用 batch 端点** | `TRAE_BATCH_MODELS_PATH` 一次拉 22 个 function（`trae-auth.ts:694`），不再逐个 `get_detail_param` | 我们用 Remote 骨架 + wire join 拼，才需要 #46 的提升逻辑 |
| **三条硬性过滤** | `usage !== chat_completion` → 排除；`config_switch === false` → 排除；`is_invisible_to_user === true` → 排除（`parseTraeBatchModelList`） | 我们一条都没有（除 usage 在提升时才看） |
| **通道优先级，不是到达顺序** | `TRAE_CHANNELS` 顺序即优先级，同 config 跨通道取「声明出的信息更多」的那条（含 reasoning 档位与 function 同源） | 我们 first-wins，顺序随网关波动 |
| **用户级黑名单** | `disabledModels`（Jet Hub「显示列表」开关），`listAllModels()` 不过滤、`listModels()` 过滤，设置页才能把关掉的模型也画出来 | 我们只有 `enabledModelIds`（勾选式），没有「官方默认 + 我额外关掉几个」的减法 |

另外两个细节值得抄：

- **`isHidden` 与「能否调用」严格分离**：`isTraeModelCallable` 只看 `isCustomModel` / `isEnabled`，
  注释里明确写「把 `isHidden` 并进可用性判定会连带删掉一批能用的模型」。这正是 #19 与 #46
  之间那条正确的缝。
- **官方对齐是一个开关，不是默认**：`hideInternalModels`（`DSH_TRAE_HIDE_INTERNAL`）默认 `false`
  ——「只挡必然调不通的，其余交给用户黑名单」。它没敢把「与官方一致」设成默认，因为它知道自己
  也在服务一批要「全都要」的用户。

---

## 7. 改法建议

按「先止住看不过来、再对齐官方、最后给开关」的顺序。P0 全在 UI 层，零协议风险。

### P0 · 卡片先能看（不碰目录语义）

| 改动 | 位置 | 理由 |
|---|---|---|
| 模型列表**按通道分组**（`solo_work_remote` / `chat_v3` / `solo_coder` / 其他），组可折叠 | `src/client/TraeUsageCard.tsx:1720` 的 `visibleModels.map` | 「46 行平铺」是观感问题的直接来源；`wireFunction` 已经在行上了，分组不需要新数据 |
| 加**搜索框** | 同上 | 46 行里找 `glm-5.3` 目前靠肉眼 |
| 尾部历史行加**标记**（`is_invisible_to_user` 一旦接入就变成「官方未展示」角标；未接入前先按「非主通道」标） | 行渲染 | 让用户知道哪些不是客户端里那 21 个 |
| 顺序固定为「主通道优先 + 通道内保持名册顺序」 | 新增一个纯函数 + 单测 | 现在的顺序随网关波动，同一个用户两次刷新会看到不同排列 |

### P1 · 接入官方可见性（这是 #52 的正解）

```text
batch_get_detail_param（已有 model-detail 头 + 请求体构造）
  → 解析 (config, 通道) → { usage, config_switch, is_invisible_to_user, display_name, max_tokens }
  → 目录行保留 isHiddenByChannel / visibleChannels
  → 默认隐藏「在它自己的调用通道里被官方隐藏」的行
```

- 端点与请求体我们已经有了（`src/model-detail.ts`，含 `show_custom_model`），只差一个 client
  与解析器；体积 ~1.8MB（#46 实测 1 874 274 B），需要缓存 + 超时 + 失败不降级（沿用
  `withDirectoryRetry` 的语义）。
- 预期效果：46 → **33**（13 行隐藏 + 2 行名册外另算），重名 6 组里的 4 组自然消失，
  `Kimi-K2-0905 (kimi-k2-0905)` 这类「名字带 id」的后缀不再需要。
- **必须一起做**：`is_invisible_to_user` 与 `wireFunction` 同源搬运，不能单独 merge
  （见 §5.3）。

### P2 · 视图抽象（把 #19 / #46 / #52 一次性收口）

给 Trae 面板加一个 `模型视图` 选择：

| 视图 | 语义 | 行数（实测） |
|---|---|---|
| **当前通道**（默认） | 只列 provider 主通道（`solo_work_remote`）在官方名册里可见的模型 | ~24 |
| **常用通道组** | `solo_work_*` + `solo_agent_*` + `chat_v3`，即用户真正会用的那几个 | ~33 |
| **全部**（现状 + 隐藏标记） | 现在的 46 行，历史行带角标 | 46 |

配一个「我已隐藏 N 个模型，点此展开」的折叠条——这是 #46 不回归的关键：**默认窄，但一个点击
就能回到全量**，而不是靠删功能。

### P3 · 用户黑名单 + 家族分组（借参考插件的减法）

- `disabledModels`（减法）与现有 `enabledModelIds`（加法）并存：默认视图 = 官方可见 − 黑名单；
  用户勾选 = 加法覆盖。两者的优先级必须写死并测住，否则就是又一处「整块替换 slot」类缺陷
  （#46 §8 的教训）。
- 家族分组可以借 batch 里的 `model_detail_list[].icon`（实测 `glm-v3-dark.svg` /
  `kimi-v2-dark.svg` 等按家族给图），比在显示名上做正则稳。

### 不建议做

- **不要把「与客户端完全一致」设成默认**：参考插件都没这么干（`hideInternalModels` 默认关）。
  #46 的报告人就是要「带日期的快照」，一刀切回 21 个等于把 #46 推翻。
- **不要按显示名去重**：#46 §9 已经用 `kimi-k2` vs `kimi-k2-0905` 证明过重名 ≠ 别名。
  去重键必须是 `config_name`，且发生在**同一通道内**。
- **不要用 `is_new` 判断新旧**：实测 `glm-5.1`、`DeepSeek-V4-Flash`（chat 组）、
  `mimo-v2.6-*` 都是 `is_new: true`，而 `glm-5.3`、`kimi-k3` 是 `false` —— 它标的是「新上线」，
  不是「当前推荐」，拿来排序会得到一份更乱的名单。

---

## 8. 诚实的边界

- **全部实测在维护者本机的 CN 账号上完成**。名册按账号/套餐裁剪，报告人的 46 行可能与本节
  的 46 行不完全相同（例如其账号可能存在 `deepseek-v4.1-flash-1017`）。
- **「21 个」是推断值**：本机单通道官方可见是 14–24，落在「21 左右」区间；但要精确复现
  报告人截图里的那 21 行，需要知道他那张截图处在哪个模式（SOLO / Builder / Code），本机无法反推。
- **`batch_get_detail_param` 需要 `profile: 'model-detail'` 的完整头**（含 `X-Ide-Token` 与设备身份）。
  用 Remote 目录那套精简头去调，会得到 HTTP 200 + 每个 function `error_code: 2001
  "Config detail for function: … not found"` —— 这个假成功很容易误导后续排查，实测踩过。
- **13 行隐藏的判定口径**：按「该 config 首次出现的通道」判定。因为该标记是逐通道的（§5.3），
  换成「任一通道可见」口径会得到 43 而非 33，两种口径都自洽，**必须先定口径再写代码**。
  → **已在 §10 定下**：两种都不对，实测发现真正的语义是「这个模式下不给看」，于是拆成三种判决。
- 未验证：接入官方可见性后，那 11 行提升行里哪些还能保留（`glm-4.7` 在
  `code_review_summary` 下是可见的，按「自身调用通道」口径会被隐藏，按「任一通道」口径会保留）。
  → **已实测**：`glm-4.7` 属于「退役」那一类（唯一的可见通道不是对话通道），`glm-5` 属于「改钉」。

---

## 9. 复现

三个请求，全部只读、零额度：

```bash
# 1. Remote 骨架 + SOLO wire → 46 行，带 wireFunction 分布
node -e "…"   # 见下方「请求配方」

# 2. IDE 全量名册：22 分组 / 554 条 / 106 唯一 config
POST https://trae-api-cn.mchost.guru/api/ide/v1/batch_get_detail_param
  headers: profile='model-detail'
  body:    buildTraeModelDetailRequest('') + { show_custom_model: true }

# 3. 逐通道可见数：证明「21 ≈ 单通道」
```

**请求配方**（探针已随本次诊断删除，复现按此三行接入 `lib/index.js` 的导出）：

```js
const remote = await new TraeSoloRemoteCatalogClient({ credential }).fetchModels()
const wire = await new TraeSoloUpstreamClient({ credential, identity }).fetchModels()
const ours = mergeTraeModelSources(remote, wire)   // → 46
```

> 诊断用的临时脚本没有留在仓库里：它们依赖本机登录态与硬编码主机名，属于一次性的取证工具，
> 进版本库只会变成下一份「跑不起来的 probe」。需要长期留存的应该是 P1 的那个 client + 它的单测。

---

## 10. 实施记录（P1，2026-10-23）

### 10.1 口径先定下来：两种口径都不对

§8 留下的问题（「按自身通道」33 行 vs「任一通道」43 行）在实施时被实测推翻了：**这不是一个二选一，
而是把一个标记当成了两件不同的事。**

把 18 个「自己通道被隐藏」的行逐通道打印出来（本机 CN 账号），立刻分成泾渭分明的两类：

```text
退役类（所有对话通道都隐藏，只剩非对话通道可见）
  glm-4.7         chat_v3:hidden  solo_coder:hidden  chat:hidden  sole_coder…  code_review_summary:VISIBLE
  glm-4.6 / minimax-m2 / minimax-m2.1 / qwen3-coder / seed-code-pro-0430 / glm-5-turbo
  minimax-m2-auto / minimax-m2.1-auto / glm-4.6-auto / kimi-k2-0905 / kimi-k2(仅 inline_chat)

改钉类（自己的通道隐藏，别的对话通道可见 → 模型仍在用）
  DeepSeek-V4-Flash  solo_work_remote:hidden  solo_coder:VISIBLE  chat:VISIBLE  inline_chat:VISIBLE
  DeepSeek-V4-Pro    solo_work_remote:hidden  chat_v3:VISIBLE    solo_coder:VISIBLE
  glm-5              solo_work_remote:hidden  solo_work_lite:VISIBLE  solo_coder:VISIBLE
  glm-5.1 / qwen-3.5 / Doubao-Seed-2.0-Code
```

`is_invisible_to_user` 的真实语义是**「这个模式的选择器不给看」**（一份配置一个模式一份可见性），
而不是「这个模型下架了」。所以：

- 按「自身通道」判 → 会删掉 6 个**在用**模型（`glm-5`、`glm-5.1`、`qwen-3.5`、
  `Doubao-Seed-2.0-Code`、`DeepSeek-V4-Flash/Pro` 的非 `-Official` 那份）。实测 46 → 28，**太狠**。
- 按「任一通道」判 → 12 个退役配置原样留着，报告人看到的「尾部整屏老模型」不动。

于是改成三种判决（`officialVerdictOf`）：

| 判决 | 条件 | 动作 |
|---|---|---|
| 退役 `hide` | **所有** `llm_utils_chat` 接受的 function 都隐藏它 | 移出目录 |
| 改钉 `repin` | 自己的通道隐藏，但另一个对话通道展示 | 留着，`wireFunction` 改成官方展示它的那个 |
| 保留 `keep` | 名册没提到、只当工具配置、或没有对话通道能判 | 原样不动 |

「改钉」不是我们发明的规则：它是把**我们已经猜错的那一格**（并集首个 function）换成官方自己的答案。
报告人问的「拿 code 的模型请求 solo」正是这个错位的表现——`Doubao-Seed-2.0-Code` 被钉在
`solo_work_remote`，而官方只在 `solo_coder` 展示它。

### 10.2 实测结果

本机 CN 账号，只读、零额度：

```text
官方名册        105 configs / 544 pairs   343 ms（含 1.8MB 文档）
46 callable  →  34 kept, 12 retired, 6 re-pinned

退役 12   kimi-k2  seed-code-pro-0430  glm-5-turbo  glm-4.7  glm-4.6
          minimax-m2.1  minimax-m2  qwen3-coder  minimax-m2.1-auto
          minimax-m2-auto  glm-4.6-auto  kimi-k2-0905
改钉 6    Doubao-Seed-2.0-Code  solo_work_remote → solo_coder
          glm-5.1              solo_agent_remote → solo_coder
          qwen-3.5             solo_agent_remote → solo_coder
          glm-5                solo_work_remote → solo_work_lite
          DeepSeek-V4-Flash    solo_work_remote → solo_work_lite
          DeepSeek-V4-Pro      solo_work_remote → solo_work_lite

通道分布（改钉后） solo_work_remote=20  solo_coder=7  solo_work_lite=3
                  chat_v3=2  solo_agent_remote=1  默认=1
```

比 §7 的预估（46 → 33）多一行：预估里的「13 行隐藏」实测是 12 行，而 `kimi-k2.8-preview` /
`qwen3.8-flash` 两行本来就不在名册里，按「沉默不是判决」保留。

### 10.3 为什么敢默认开启

`applyOfficialRoster` 是 **fail-open** 的，这是它不需要开关的全部理由：

| 情况 | 行为 |
|---|---|
| 名册读不到（受限网络 / 无设备身份 / 超时 / HTTP 非 2xx / 空文档） | 返回 `undefined`，**一行都不动** |
| 名册没有这个 config | 保留 |
| 名册只有它的工具配置（`usage: 'summary'`…） | 保留 |
| 没有任何 `llm_utils_chat` 接受的 function 提到它 | 保留 |
| `config_switch === false` | **只记录，不判决**（语义未实测，不拿它删模型） |

也就是说：它只能删「官方在所有对话通道里都不给看」的行，删不掉任何别的东西；而且它是给一次
**已经成功**的刷新做减噪，失败也只是回到旧行为。名册成功读一次缓存 10 分钟，失败同样缓存，
避免受限网络每次刷新都赔一个 20 秒超时。

### 10.4 落地位置

| 文件 | 内容 |
|---|---|
| `src/official-roster.ts`（新） | 解析器 `parseTraeOfficialRoster`、判定 `officialVerdictOf`、应用 `applyOfficialRoster`、读名册的 `TraeOfficialRosterClient`（缓存 / 超时 / 失败不抛） |
| `src/index.ts` | 与 `solo.fetchModels` **并行**读名册（`Promise.all`）；`withChatCallableFunctions` 之后再过滤；`callableKeys` / `wireTargetsOf` / `latestDiscovery` 全部改用过滤后的行 |
| `tests/official-roster.spec.ts`（新） | 23 条：解析容错、三种判决、通道优先级、`wireConfigName`、大小写、工具配置、fail-open、缓存窗口、端到端 |

`wire.callableKeys` 与 `wireTargetsOf` 同样只收保留行 —— 否则下一次保存设置时，
被退役的行会从旧 `lastCatalog` 里被复活。

## 11. 实施记录（P0，2026-10-23）

P1 把 46 行减到 34 行，但**行数与可读性是两件事**：34 行平铺仍然是一屏，而且顺序本身还是
不稳定的。P0 处理的就是剩下这半句「一屏平铺、顺序乱」。

### 11.1 顺序原本不是排出来的

卡片直接渲染合并结果的顺序，而 `src/solo-remote.ts:115` 自己写着分组顺序**每次调用可能不同**。
所以同一个账号刷新两次，同样的行可以排出两个样子 —— 这不是观感问题，是「用户找不到上次那个模型」。

新的顺序是**行的集合的纯函数**（`src/model-order.ts`）：

| 键 | 规则 | 为什么 |
|---|---|---|
| 1 | 区域自己的通道优先级 | 与线上一字不差：`solo_work_remote` → `solo_work_lite` → `solo_agent_remote` → `chat_v3` → `solo_coder`。第一个看到的组，就是解析器最偏好的那个 |
| 2 | 未知通道排在所有已知通道之后 | 那是 `withChatCallableFunctions` 会清掉的函数名，正常不该出现；出现时不该挤掉归属明确的行 |
| 3 | 无通道（走默认通道）排最后 | 解析器对它知道得最少 |
| 4 | 组内按显示名，大小写不敏感，**版本号按数字** | `GLM-5.10` 必须排在 `GLM-5.9` 之后，纯文本比较会反过来 |
| 5 | 同名再按 id | 保证全序，同一份目录两次渲染逐字相同 |

通道优先级表从 `solo.ts` 搬到 `src/model-order.ts`，`solo.ts` 反向重新导出。原因很实际：卡片要
import 这个模块，而 `solo.ts` 带着 `node:crypto`，客户端 bundle 进不来。两份拷贝的后果不是重复，
而是**线上先问 A、界面先画 B，而且没人看得出来**。

### 11.2 分组让「这是一份并集」变得可见

每行归到**它会被调用的那个通道**下，表头写模式名与行数。本机 CN 账号实测：

```text
merged=46  callable=46  kept=34  (retired=12, repinned=6)

── solo_work_remote   20 行
── solo_work_lite      3 行   （DeepSeek-V4-Flash / -V4-Pro / GLM-5，全部来自改钉）
── solo_agent_remote   1 行
── chat_v3             2 行   （kimi-k2.8-preview / qwen3.8-flash，官方名册未收录、按「沉默不是判决」保留）
── solo_coder          7 行   （Doubao-Seed-2.0-Code / GLM-5.1 / Qwen3.5-Plus 等改钉行）
── (未标注)            1 行   （doubao_1_8，无 function）

逆序输入后重新排序 → 逐字相同
```

用户看到的从「34 行平铺」变成「6 组、每组有名字」。顺带解决了一个 P1 遗留的观感问题：
`DeepSeek-V4-Flash` 这份显示名在 `solo_work_remote`（`-Official` 那份）和 `solo_work_lite`
（改钉那份）各出现一次，平铺时是两个**一模一样**的行，分组后它们落在不同组里，差异一眼可见。

默认**全开**，不做「只展开有关注的组」：默认折叠会把用户特意进来要勾的模型藏起来，
而这份目录的长度（34 行 / 6 组）还不值得用折叠去换。

### 11.3 搜索是视图，不是选择

搜索框匹配显示名、id 与 **`config_name`**。第三个是必要的：排查 `4001 config_name rejected`
的人手上拿的是上游名，而它恰好与屏幕名不同（`DeepSeek-V4-Flash` 那行真正发出去的是
`DeepSeek-V4-Flash-Official`）。

「测试所有模型」与批量上下文按钮**仍然作用于整个目录**（`visibleModels`，不是 `shownModels`）。
这是本次唯一有真实风险的地方：那是一花额度的动作，因搜索框里有字而悄悄缩小范围会被读成
「测过了都正常」。`tests/card-model-groups.spec.tsx` 里有一条专门钉住它。

「官方未展示」角标没做：P1 之后这类行已经不存在于目录里（退役的删了，改钉的换到官方通道），
角标无处可挂。留着的「名册未收录」两行由表头所在的分组就能解释，不值得再加一个标签。

### 11.4 落地位置

| 文件 | 内容 |
|---|---|
| `src/model-order.ts`（新，纯） | `TRAE_CHANNEL_PRIORITY` / `TRAE_SOLO_FUNCTION`、`orderTraeModels`、`groupTraeModels`、`filterTraeModels` |
| `src/solo.ts` | 通道表改为 alias 纯模块，`TRAE_DIRECTORY_FUNCTIONS = TRAE_CHANNEL_PRIORITY` |
| `src/index.ts` | 发现流程里 `orderTraeModels` 排在官方过滤之后 —— 于是 `lastCatalog`、以及按目录顺序渲染的 DSH 模型选择器一并变稳 |
| `src/status-paths.ts` | `TraeWebModel` 补 `wireFunction` / `wireConfigName`（运行时本来就在，只是类型没声明） |
| `src/client/TraeUsageCard.tsx` | 搜索框、`<details>` 分组、组头标签函数、折叠状态（键 `panel|channel`，存的是**例外**，所以默认全开） |
| `src/client/styles.ts` | 搜索框与组头的规则；组头底色用 6% 中性叠加而不是新 token（`--dsw-alias-bg-layer-1` 未在 DSH 的已验证清单里，样式测试会拒） |
| `tests/model-order.spec.ts`（新，21 条） / `tests/card-model-groups.spec.tsx`（新，7 条） | 见 CHANGELOG |

### 11.5 还没做的

- **P2（视图抽象）**：见 §12 —— 实施时发现 §7 设想的三档只剩两档站得住，理由是实测数据，
  不是省事。
- **P3（用户黑名单）**：`disabledModels` 减法。
- **改钉只验证到「官方展示它」这一步**，没有做真实对话调用（要花额度）。所以 §10.2 里的 6 行
  是「官方在别的通道展示它」，不是「我们实测这个通道能出字」。若后续有 4001，优先怀疑这里。
- **`config_switch`** 的语义仍然没测：本次只记录不判决，`TraeOfficialChannel.enabled` 留着备用。
- **组内顺序是字母序，不是厂商序**。Trae 自己的选择器是有排序的，但那个排序不在我们读到的任何
  字段里，唯一测过的一级（分组）还是不稳定的。字母序可预测、可复现；「猜一个更聪明的顺序」
  只是同一个猜测加上更多代码。


---

## 12. 实施记录（P2 视图，2026-10-23）

记录这一节的主要原因是：**§7 设想的三档视图，实施时只剩两档站得住**，而这件事只有拿到
P1 之后的真实数据才能发现。

### 12.1 §7 的三档在 P1 之后变成了两档

§7 的设想是 `当前通道 ~24 / 常用通道组 ~33 / 全部 46`，三档分别对应「客户端看到的 /
用户会用的 / 现在的全量」。P1 与 P0 落地后重新数一遍（本机 CN 账号，只读）：

```text
46 merged → 34 kept（退役 12 / 改钉 6）

solo_work_remote      20
solo_work_lite         3
solo_agent_remote      1
chat_v3                2
solo_coder             7
（无 function，走默认）  1
```

于是：

- **「常用通道组」= 全部（34）**。P1 已经把「任何对话通道都不给的 config」全部退役了，
  剩下的每一行都至少有一个对话通道在展示它，所以「常用」与「全部」不再是两个集合 ——
  这一档没有内容，做出来是个永远等价的开关。
- **「当前通道」= 20 行，会藏掉一个在用模型**。这一档的真实含义是「只留 provider 第一优先
  通道（`solo_work_remote`）」。它确实正好复刻客户端那种「一个模式一份名册」的观感，但代价是
  `glm-5` 这类**只由 `solo_work_lite` 提供**的模型从默认视图消失 —— 它不是 `-Official` 那份的
  影子，是独立可用的模型。用一个会藏掉在用模型的默认值去换「看起来像客户端」，不对。

所以收敛成两档，并且**默认是 24 而不是 20**：

| 视图 | 语义 | 实测行数 |
|---|---|---|
| **常用通道**（默认） | 走 `solo_work_remote` / `solo_work_lite`（含未标注行 —— 它的请求本来就落在 `solo_work_lite`） | **24** |
| **全部** | 再加上只在专用通道提供的：`solo_coder` 7 / `chat_v3` 2 / `solo_agent_remote` 1 | **34** |

24 这个数字同时是「客户端每个模式展示 14–24 个」区间的上沿，所以默认视图第一次和报告人
拿来比较的那个列表是同一个数量级 —— 这正是 #52 要的东西，而且没删任何一行。

### 12.2 三个必须守住的边界

**① 视图只影响绘制，不影响任何动作。** 「一键测试所有」「整区切到 Max」「全部恢复默认上下文」
仍然作用于完整目录（`visibleModels`）。这些动作花额度或改设置，若因为屏幕上少了 10 行就缩小
范围，用户会以为「都测过了」。`tests/card-model-groups.spec.tsx` 里那条「搜索时 test all 仍覆盖
全部」现在同时覆盖了这个场景。

**② 被视图藏起来的「已启用」行必须说出来。** 默认视图藏 10 行；如果用户之前勾选过其中几个，
它们的勾选框不在屏幕上。保存路径本来就是安全的（写的是 state 里的 `activeEnabledIds`，不是从
渲染出来的 checkbox 读），但如果不说，读者数一遍勾选框只会得出「那些模型被关了」的结论。
于是列表下方固定一行：**「另有 N 个已启用的模型不在此视图内 —— 查看全部」**。

**③ 搜索不能撒谎。** 搜索是**在视图内**进行的（全局搜索会和用户眼前的组头矛盾）。但这样就有
一个必须补的洞：搜 `kimi` 时默认视图内可能没有，而 `kimi-k2.5` 就在 `solo_coder` 组里。
所以空结果分成两种文案 ——

- 视图内没有、全目录也没有：`没有匹配「X」的模型。`
- 视图内没有、全目录里有 N 个：`常用通道内没有匹配「X」的模型，全部目录里有 N 个。` + 一键切到全部

「查不到」与「不在这个视图里」是两件事，混成一句是搜索框最不该犯的错。

### 12.3 落地位置

| 文件 | 内容 |
|---|---|
| `src/model-order.ts` | `TRAE_COMMON_FUNCTIONS`、`traeModelCallChannel`（无 function 的行按默认通道算）、`traeModelInView`、`scopeTraeModels`、`TraeModelView` |
| `src/client/TraeUsageCard.tsx` | `modelView` 状态（组件态，不是草稿 —— 改视图不是编辑，不该把卡片弄脏）、范围 → 搜索 → 分组三段计算、`enabledOutsideView`、两种空结果文案 |
| `src/client/locales.ts` | 视图与提示文案；`row.modelsChannelDefault` 改成「未标注模式（走 solo_work_lite）」，把真实调用路径写出来 |
| `src/client/styles.ts` | 分段控件与提示行。按下态用 `bg-layer-3` 压在 `bg-layer-2` 轨道上 —— 第一版写的是 `bg-layer-1`，`card-styles.spec.tsx` 立刻拒了：那不是 DSH 定义的 token，回退值会在两个主题里同时生效 |
| `tests/model-order.spec.ts` +5 条 / `tests/card-model-groups.spec.tsx` +5 条 | 见 CHANGELOG |

视图控件**只在真有行被排除时才渲染**（`orderedModels.length > commonModelCount`）：一个能在两个
相同列表之间切换的开关，比没有更糟。

### 12.4 还没做的

- **P3（用户黑名单）**：`disabledModels` 减法 —— 用户永久不想要的模型从界面上抹掉，与「视图」
  是两个不同的东西（视图是看多少，黑名单是删哪些）。
- **视图不跨会话记忆**：`modelView` 是组件态，重开面板回到「常用通道」。要记住得进设置，
  而一个「默认只看 24 个」的持久化默认值，会把 P1 之后才看到全部 34 行的人绕回去。
- **`solo_coder` 那 7 行到底能不能当普通对话模型用**：与 §11.5 的改钉一样，只验证到「官方在
  那个通道展示它」，没做真实调用。默认视图把它们排除在外，等于把这个未验证面收窄到「用户
  主动点全部」之后 —— 这也是默认选 24 而不是 34 的一个附带好处。
