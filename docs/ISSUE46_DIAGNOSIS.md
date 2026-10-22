# issue #46 诊断与修复：插件的模型表**系统性排除**了「带日期的快照配置」

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/46>
> （yuantao313：「模型列表不对齐，无法获取DeepseekV4.1 Flash 1017模型ID · 插件中无法获取Trae的1017模型，只能使用正式版」，
> 截图两张：Trae IDE 内置模型下拉里有 `DeepSeek-V4.1-Flash-1017`，插件卡片里只有 `DeepSeek-V4.1-Flash`）
> 诊断时间：2026-10-22　方法：本机 CN 实时凭据跑「IDE 全量 roster（22 function）+ SOLO wire roster（5 function）
> + Remote 目录（7 function）+ `mergeTraeModelSources` 全链路探针」（`scripts/probe-issue46-*.mjs`，只读、零额度）
> + Trae CN 安装包与本机 IDE 日志检索
> 状态：**已修复**（A/B/C 三处，973 个测试全绿，见 §5）

---

## 0. 一句话结论

| 项 | 结论 | 证据强度 |
|---|---|---|
| 上游有 `DeepSeek-V4.1-Flash-1017` 这个 id 吗 | **本机账号没有**。IDE 全量 roster（22 个 function，1.87 MB 原始 JSON）、SOLO wire roster（5 个 function）、Remote 目录（7 个 function）三份原始响应里 `1017` 出现 **0 次**；Trae CN 安装包全文检索命中 0 次；本机 IDE 日志检索命中 0 次 | 实测（2026-10-22，本机 CN 账号） |
| 那 IDE 菜单里的「1017」是什么 | **是另一份真实的 config_name，不是显示别名**。上游**确实**发布带日期的独立 config_name：`kimi-k2-0905`、`seed-code-pro-0430`、`search_agent_qwen_fast-0710`；且 `kimi-k2` 与 `kimi-k2-0905` 是**两个不同的 id**（能力不同：dev 116000 vs dev 200000/max 200000）。所以 IDE 能同时列出 `…-1017` 和 `…` 两行 | 实测（逐行 dump 上游 `config_name`） |
| 那为什么插件看不到？ | **因为插件的模型表（Remote 骨架）系统性排除所有带日期的 config_name** —— 实测骨架里带日期的行**为 0**，而 wire 名单里有 3 行。合并层只遍历骨架，于是这些快照全被丢弃 | 实测 |
| 「模型列表不对齐」是真的吗 | **是真的**。根因有两个：(1) 骨架不是完整的名单（且漏问了几个 function）；(2) 两侧的**显示名**取自不同接口，且上游对同一个 id **按 function 发布不同的显示名** | 实测 + 代码链 |
| 修复效果 | 目录 33 → **42 行**（+9）：新出现 7 个此前被丢的用户可识别模型（`glm-4.6`、`glm-4.7`、`glm-5-turbo`、`minimax-m2`、`minimax-m2.1`、`qwen3-coder`、`seed-code-pro-0430`）与 2 个此前没问到的（`kimi-k2` → `Kimi-K2-0905`、`doubao_1_8` → `Doubao-Seed-1.8`） | 实测（修复后探针） |

---

## 1. 先把「1017」这件事钉死

报告人的截图里，Trae IDE 的「内置模型」下拉有一项 `DeepSeek-V4.1-Flash-1017`，插件卡片里只有
`DeepSeek-V4.1-Flash`。实测三份上游目录里根本没有 `1017`：

| 目录 | 端点 | 覆盖 function | 原始响应 | 含 `1017` |
|---|---|---|---|---|
| IDE 全量 roster | `POST /api/ide/v1/batch_get_detail_param` | **22 个** | 1 874 274 B | **0** |
| SOLO wire roster | `POST /api/ide/v1/get_detail_param` × 5 | `solo_work_remote`/`solo_work_lite`/`solo_agent_remote`/`chat_v3`/`solo_coder` | 284–482 KB / 个 | **0** |
| Remote 目录 | `GET /api/remote/v1/models?functions=…` | 7 个 | 97 356 B | **0** |

全量 IDE roster 共 **102 个唯一 config_name**，逐条 dump 后与 `1017` 相关的：**没有**。
Trae CN 安装包（`libai_agent.dylib`、`libharness.dylib`、`@byted-icube/*`）全文检索命中 0 次；
本机 IDE 日志检索 `*-1017` 命中 0 次，日志里真实的 `model_config_name` 只有 `deepseek-v4.1-flash`。

### 「1017」属于哪一类？—— **独立 config_name，不是别名**

上游**确实**发布带日期的 config_name，而且它们与无日期的同族模型**并存**：

| config_name | display_name | 归属 function | 上下文 |
|---|---|---|---|
| `kimi-k2` | `Kimi-K2-0905` | `chat_v3` | dev 116000 |
| `kimi-k2-0905` | `Kimi-K2-0905` | `solo_coder` | dev 200000 / max 200000 |
| `seed-code-pro-0430` | `Doubao-Seed-2.1-Pro` | `solo_work_remote` | dev 232768 |
| `search_agent_qwen_fast-0710` | （空） | `solo_agent` | — |

**同一个显示名挂在两个不同的 id 上** —— 所以 IDE 能同时列出 `DeepSeek-V4.1-Flash-1017` 和
`DeepSeek-V4.1-Flash` 两行，它们本来就是**两个条目**，不是同一模型的两种叫法。

> 这一点纠正了本仓库早先的一版判断（曾写成「`-1017` 只是显示名的后缀，背后是同一个模型」）。
> 正确的表述是：**上游按版本发布独立的 config_name**，而插件的模型表恰好漏掉了这一整类。

---

## 2. 真正的根因：模型表把「带日期的配置」系统性排除了

插件的目录是两张表 join 出来的（`src/index.ts` `discoverModels`）：

```text
Remote 骨架 (solo.trae.cn/api/remote/v1/models, 7 function)   ← 主表（骨架）
        │
        │  mergeTraeModelSources(remote, wire)   src/catalog.ts
        ↓
   只遍历 remote ←── wire（solo get_detail_param, 5 function）
   wire 只用来补字段           ↑ 骨架里没有的行，wire 说再多也不出现
```

### 关键实测：骨架系统性排除带日期的 config_name

| 名单 | 带日期的 config_name |
|---|---|
| Remote 骨架（主表） | **0 个**（33 行，一个都没有） |
| SOLO wire roster | 3 个（`kimi-k2-0905`、`seed-code-pro-0430`、`search_agent_qwen_fast-0710`） |

**这不是巧合，是一类别的系统性缺失**：上游把「当前快照」放进 wire 名单、把「带日期的版本快照」
放在别处，而插件的主表恰好只收前者。**于是每一个带日期的模型，插件都拿不到。**

### 另一处丢失：插件没问那几个 function

`kimi-k2` 在 Remote 侧只归属 **`inline_chat`**，而插件请求 Remote 目录时**没有问这个 function**
（`TRAE_REMOTE_DIRECTORY_FUNCTIONS`，`src/solo-remote.ts`）：

| Remote 查询的 function | 得到的模型数 | 含 `kimi-k2` |
|---|---|---|
| 插件原来的 7 个 | 33 | **否** |
| 加上 IDE 的 5 个（`chat`, `inline_chat`, `solo_agent_lite`, `solo_design_lite`, `solo_design_remote`） | **41** | **是**（`inline_chat` → `Kimi-K2-0905`） |

放宽后新增的 8 行全是真模型：`kimi-k2`、`doubao_1_8`、`deepseek-V3`、`deepseek-V3.1`、
`doubao-2.0-mini`、`glm-4.7`、`code-review-judge`、`multimodal_image_kimi-k2.5`。

### 两处叠加的后果

wire 名单每次返回 **73–81** 个 config，合并后只剩 33 行 —— **50 个 wire config 被丢弃**。
其中约 30 个是 `custom_model_*` / `search_agent_*` / `title_generation` 这类内部或自定义 config，
**丢掉是对的**；但下面这些**不该丢**：

```
kimi-k2 (chat_v3)            kimi-k2-0905 (solo_coder)     ← 正是 Kimi-K2-0905 那一族
glm-4.6 / glm-4.6-auto        glm-4.7 / glm-4.7-auto
minimax-m2 / minimax-m2.1     minimax-m2-auto / minimax-m2.1-auto
qwen3-coder                  glm-5-turbo
Doubao-Seed-2.0-Code-auto    Doubao_1_6
glm-5.1_advisor              glm-5.2_advisor_default / glm-5.2_advisor_doubao
doubao-for-auto              seed-code-pro-0430
```

### 仓库里已有同类问题的处理方式

- **issue #42**：wire 有 `max_tokens`、合并层没复制 → 修 `mergeTraeModelSources` 补一行。
- **issue #19**：Remote 有行、wire 无行 → 修 `withChatCallableFunctions` **保留行、只清 function**。
  当时的结论是「**名单的沉默不能证明模型不可调用**（名单按账号范围裁剪）」。

**issue #46 是同一个洞的反面**：这次是 **wire 有行、Remote 无行**，而合并层同样把行丢掉了。
#19 立下的那条原则在反方向上没有被遵守。

---

## 3. 显示名为什么对不齐（以及一次被实测否掉的修法）

两侧的显示名取自**不同的接口**，而且**上游对同一个 id 按 function 发布不同的显示名**。

实测（2026-10-22，本机 CN 账号）：

| config_name | Remote（插件骨架） | wire（`get_detail_param`） | IDE（`batch_get_detail_param`） |
|---|---|---|---|
| `DeepSeek-V4-Pro-Official` | `DeepSeek-V4-Pro` | `DeepSeek-V4-Pro` | **`DeepSeek-V4-Pro 正式版`** |
| `Doubao-Seed-2.0-Code` | `Doubao-Seed-2.0-Code` | **`Doubao-Seed-2.1-Turbo`** | `Doubao-Seed-2.0-Code` |
| `Doubao-Seed-2.1-Pro` | `Seed-2.1-Pro-0915` | `Seed-2.1-Pro-0915` | **`Seed-2.1-Pro`** |
| `glm-5.2` | `GLM-5.2` | `GLM-5.2` | **`glm-5.2`** |
| `doubao-for-auto` | （骨架无此行） | （空 / `Seed-Code`） | `Seed-Code` |

IDE 全量 roster 里，**102 个 id 中有 10 个在不同 function 下带不同的 `display_name`**
（`DeepSeek-V4-Pro-Official` 既是 `DeepSeek-V4-Pro` 又是 `DeepSeek-V4-Pro 正式版`；
`doubao-for-auto` 在 `chat_v3` 下为空、在 `solo_coder` 下是 `Seed-Code`）。

### 一次被实测否掉的修法

最初的方案是「显示名以 wire 为准，因为 IDE 渲染的是 wire 的 `display_name`」。
**这个假设是错的，实测把它否掉了**：

| 名单 | 与 IDE 名单不一致的行 |
|---|---|
| wire（`get_detail_param`，插件读的是聊天 function） | **32 / 81** |
| Remote 骨架 | **3 / 33** |

原因是 wire 名单是**按 function 分片**的，插件的 wire client 读的是**聊天 function**，
于是常常落在「某个聊天 function 发布的名字」上，而不是 IDE 选择器渲染的那个名字。
**所以修法改为：显示名仍以骨架为准**（它与 IDE 只差 3 行，wire 差 32 行），
并在 `mergeTraeModelSources` 的注释与 `tests/catalog.spec.ts` 里把这个**被否掉的结论**钉住，
避免日后有人凭「听起来合理」再改回去。

### 顺带修掉的一个真 bug

上游对同一个 config 在不同 function 下发布不同名字，而插件的 wire client 是
**先到先得（first wins）**：先列到该 config 的 function 拥有这一行**及其 function**
（function 决定可调用性，必须由拥有者决定），但**那个 function 不一定知道名字**。
实测 `doubao-for-auto` 在 `chat_v3` 下名字为空、在 `solo_coder` 下是 `Seed-Code` ——
于是这行在插件里显示成了 config id 本身。

修法：**行归拥有者，名字取最"充实"的那一份** —— 拥有者没有真名字时，
另一个 function 发布的真名字可以补上（`src/solo.ts` `collectModels`）。
占位符 `-`（上游对 `sagitta`、`aquila` 这类 codename config 发布的占位）不算真名字。

---

## 4. 修复方案（已实施）

三处改动，全部由上游信号驱动，**没有一处是凭空发明的**。

### A. Remote 目录多问几个 function

`TRAE_REMOTE_DIRECTORY_FUNCTIONS`（`src/solo-remote.ts`）加上
`chat`、`inline_chat`、`solo_agent_lite`、`solo_design_lite`、`solo_design_remote`。
问一个网关不提供的 function 是无害的（未知名字被忽略，不报错）。

**实测**：Remote 骨架 33 → **35 行**，新增 `kimi-k2`（`Kimi-K2-0905`）、`doubao_1_8`（`Doubao-Seed-1.8`）等。

### B. 合并层补齐 wire 侧的行

`mergeTraeModelSources`（`src/catalog.ts`）在遍历完骨架后，把
**wire 有、骨架没有**的行也作为目录行输出。

**但不是无条件的** —— `isPromotableWireModel` 要求四个上游信号同时成立：

| 信号 | 排除掉什么 | 实测 |
|---|---|---|
| `usage === 'chat_completion'` | IDE 的工具配置（`summary`、`title_generation`、`fast_apply`、`input_optimization`）与账号的自定义模型（`usage: 'custom_model'`） | 50 → 27 |
| `config_source === 1` | 账号自己的自定义模型（source 3，携带用户自己的 base_url 与 key）—— 插件不该代扣费 | 27 → 27 |
| 显示名是**真名字**（非空、非 `-`、非 config 标识符、且不等于自己的 id） | `sagitta`、`aquila`、`search_agent_qwen_fast`、`computer_use_subagent` | 27 → 17 |
| 显示名**未被骨架占用** | `Doubao_1_6`（`Seed-Code`）、`glm-5.1_advisor`（`GLM-5.1`）、`glm-5.2_advisor_*`（`GLM-5.2`）等别名 | 17 → 12 |

被提升的行是**完整的目录行**：带 wire 自己的 id（那就是它的 `config_name`，所以不产生 `wireConfigName`）、
function、上下文窗口、输出上限、倍率、促销规则 —— wire 解析层早就把这些字段备齐了
（`src/solo.ts`），缺的只是「不让合并层丢弃」。

> **一个必须一起做的细节**：别名判定要同时看**骨架的名字**和**本轮已提升的名字**。
> 实测 `glm-4.7` 与 `glm-4.7-auto` 都叫 `GLM-4.7`，`minimax-m2` 与 `minimax-m2-auto` 都叫 `MiniMax-M2`；
> 只看骨架会让同一模型在选择器里出现两次。

### C. 显示名：保持骨架为准

见 §3 —— 修法是被实测**否掉**的，代码里留下的是「为什么不用 wire」的理由和对应的回归测试。

---

## 5. 修复后的实测结果

```
Remote 骨架行数: 33  →  35
wire 名单行数  : 81
合并后目录行数 : 33  →  42
```

新增的 9 行：

| id | 显示名 | 来源 |
|---|---|---|
| `kimi-k2` | `Kimi-K2-0905` | A（`inline_chat` 组） |
| `doubao_1_8` | `Doubao-Seed-1.8` | A（`chat` 组） |
| `seed-code-pro-0430` | `Doubao-Seed-2.1-Pro` | B |
| `glm-5-turbo` | `GLM-5-Turbo` | B |
| `glm-4.7` | `GLM-4.7` | B |
| `glm-4.6` | `GLM-4.6` | B |
| `minimax-m2.1` | `MiniMax-M2.1` | B |
| `minimax-m2` | `MiniMax-M2` | B |
| `qwen3-coder` | `Qwen3-Coder-Next` | B |

仍然被正确排除的：42 行（工具配置、自定义模型、别名、无真名字的 codename config、
`-auto` 孪生行）。

显示名与 IDE 不一致的：42 行里 **3 行**（`Seed-2.1-Pro-0915` vs `Seed-2.1-Pro`、
`GLM-5.2` vs `glm-5.2`、`DeepSeek-V4-Pro` vs `DeepSeek-V4-Pro 正式版`）——
这三处是**上游自身**在两个接口间不一致，不是插件引入的。

---

## 6. 诚实的边界

- **取证在维护者本机的 CN 账号上完成。** 名单按账号/套餐裁剪，报告人的账号可能有**不同的名单**
  —— 特别是**报告人账号上很可能真的有 `deepseek-v4.1-flash-1017` 这一行**（本机没有），
  而它正好落在「骨架排除、wire 有」这一类里，**修复后应当会出现**。
  这需要报告人升级后确认。
- **新提升的 7 个模型未逐个实测可调用性**（调用会产生额度消耗）。
  按 #19 的原则，缺的是「证据」而不是「行」，但「能否真的调用」仍需实测。
- `kimi-k2` 归属 `inline_chat`，而 `TRAE_DIRECTORY_FUNCTIONS` 不含该 function ——
  它的**可调用性尚未取证**，需与 #19 的 function 矩阵一起验。
- 修复**没有**改变上游的名单裁剪规则：账号看不到的模型依然看不到。

---

## 7. 复现

```bash
node scripts/probe-issue46-roster.mjs   # 诊断：7 节结论
node scripts/probe-issue46-verify.mjs   # 修复后验证：三个方向各一节
node scripts/probe-issue46-dated.mjs    # 日期 config_name 是别名还是独立 id
```

（探针与本仓库其它 `scripts/probe-*.mjs` 一样，直接用本机 Trae CN 的实时凭据，
不落盘任何 token；`scripts/decrypt-block.js` 是从 `probe-toolcalls.mjs` 原样抽出的解密例程，
供各探针共用。）

---

## 8. 顺带发现并修复的第二个缺陷：账号池开关保存后失效

> 与 #46 无关,是同一轮排查中发现的独立缺陷(用户截图报出):**在插件里打开账号池并保存,
> 再打开插件又显示为没保存。**

### 根因:「保存模型列表」整体替换了 region slot,把 `pool` 字段冲掉

插件有 4 处写 `regions` 的地方,其中 3 处都是**先展开旧 slot 再覆盖自己管的字段**:

```ts
nextRegionEnabled        → { ...regionSlotOf(...), enabled }         ✅
nextRegionCreditPosition → { ...regionSlotOf(...), creditPosition }  ✅
nextRegionPool           → { ...regionSlotOf(...), pool }             ✅
```

但「保存模型列表」那处**是从零重建 slot 的**(`src/client/TraeUsageCard.tsx`):

```ts
const nextSlot = {
  enabled, lastCatalog, enabledModelIds, imageModelIds, contextBudgets,
  // ← 没有 pool,也没有 creditPosition
}
```

而这个写入会**整体替换**该 panel 的 slot —— 于是 `pool` 被静默丢弃。所以:
**开账号池 → 保存模型列表 → 池被关掉 → 重开显示「未保存」**。

**顺带发现 `creditPosition` 也被同样冲掉** —— 保存模型列表会把积分读数的座位重置回 `composer`。

### 修法

新增 `nextRegionDirectory()`(`src/status-paths.ts`):展开旧 slot,再用目录字段覆盖。
卡片改用它。回归测试在 `tests/issue46-regressions.spec.ts`。

> 这与 #42 记录的 `wireConfigName` 丢失是**同一类缺陷**:整块替换 slot 时,
> 保存方不知道的字段就消失了。#42 丢的是 `wireConfigName`(导致每次保存都 4001),
> 这次丢的是 `pool` 与 `creditPosition`。**教训:整块替换 slot 的写入,必须显式列出它拥有的字段,
> 其余一律继承。**

---

## 9. 4.4.1：4.4.0 的修复自己引入了一个缺口（`kimi-k2-0905` 仍被丢掉）

> 这一节记录的是一次**自我纠正**。4.4.0 发布后做了真实调用实测，实测把 4.4.0 的一个缺陷暴露了出来。

### 实测：4.4.0 提升的 7 个模型确实能调用

真调用（不是名单推断），走插件自己的 bridge，每个模型一次最小 `ping`：

| 模型 | function | 结果 | 耗时 |
|---|---|---|---|
| `seed-code-pro-0430` | `solo_work_remote` | AVAILABLE | 6.6s |
| `glm-5-turbo` | `solo_work_remote` | AVAILABLE | 5.6s |
| `glm-4.7` | `chat_v3` | AVAILABLE | 9.6s |
| `glm-4.6` | `chat_v3` | AVAILABLE | 12.7s |
| `minimax-m2.1` | `chat_v3` | AVAILABLE | 1.3s |
| `minimax-m2` | `chat_v3` | AVAILABLE | 1.5s |
| `qwen3-coder` | `chat_v3` | AVAILABLE | 2.8s |

`kimi-k2`（归属 `inline_chat`，可调用性此前存疑）在 `inline_chat` / `chat_v3` /
`solo_work_remote` **三个 function 下全部可调用**。成本：17 次调用共 **7.38 额度**（约 0.43/次）。

### 但 `kimi-k2-0905` 不在表里，而它是能调用的

| | id | 上下文 | 输出上限 | function | 实测 |
|---|---|---|---|---|---|
| 已有 | `kimi-k2` | 28000 | 16000 | `chat_v3` | AVAILABLE |
| 被丢掉 | `kimi-k2-0905` | **168000** | **32000** | `solo_coder` | **AVAILABLE**（26s） |

**成因换了机制，症状没变。** 4.4.0 修掉了旧的「合并只遍历骨架」；但 4.4.0 新加的
「显示名已被占用就跳过」规则又把它丢掉了 —— 因为两行都叫 `Kimi-K2-0905`。
也就是说：**报告人抱怨的「带日期的快照 ID 拿不到」，在 `kimi-k2-0905` 上依然成立。**

这正是「重名」不等于「别名」的反例。用于区分的上游信号只有**能力**：

- `kimi-k2` 28000 vs `kimi-k2-0905` 168000 → 名字一样、能力差 6 倍
- `glm-4.7` vs `glm-4.7-auto` → 元数据**完全相同**（100000/16000/`chat_v3`），是真重复
- `glm-5.2_advisor_default` 168000 vs skeleton `glm-5.2` 200000 → 比已有的**小**，是内部改道

### 4.4.1 的规则：重名是**能力测试**，不是名字测试

`claimedNames` 记录每个显示名下**最大的**上下文窗口。重名行只有在**严格更大**时才提升，
并且显示名追加 id 以便区分（两行都渲染成 `Kimi-K2-0905` 的 picker 是在撒谎）。

实测效果：目录 **42 → 46 行**，提升行 7 → 11：

| 新增行 | 显示名 | function | 上下文 | 实测 |
|---|---|---|---|---|
| `kimi-k2-0905` | `Kimi-K2-0905 (kimi-k2-0905)` | `solo_coder` | 168000 | AVAILABLE 26.4s |
| `minimax-m2-auto` | `MiniMax-M2 (minimax-m2-auto)` | `solo_coder` | 168000 | AVAILABLE 1.8s |
| `minimax-m2.1-auto` | `MiniMax-M2.1 (minimax-m2.1-auto)` | `solo_coder` | 168000 | AVAILABLE 1.6s |
| `glm-4.6-auto` | `GLM-4.6 (glm-4.6-auto)` | `solo_coder` | 168000 | AVAILABLE 10.8s |

**11/11 提升行全部实测可调用。** `glm-4.7-auto` 仍被排除（与 `glm-4.7` 元数据相同），
`glm-5.1_advisor` / `glm-5.2_advisor_*` / `Doubao_1_6` / `doubao-for-auto` 仍被排除（更弱）。

### 另一条实测发现：`doubao_1_8` 调不通

fix A 多问 function 带出来的 `doubao_1_8`（`Doubao-Seed-1.8`）**实测 4001 拒绝** ——
它没有 `wireFunction`，也没有上下文/输出元数据，是条残缺的骨架行。
按 #19「全部呈现 + 如实报错」的策略这是合规的，但它确实是**新增的、调不通的**一行，需要说明。

### 教训

1. **「名字相同」不能推出「是同一个模型」。** 要判断重复，比的是能力，不是字面。
2. **修一个「被丢弃」类缺陷时，要检查自己新加的过滤条件会不会产生同一个症状。**
   4.4.0 把「骨架丢行」换成了「去重丢行」，报告人看到的还是一样。
3. **实测能推翻单测。** 46 个单测全绿也看不出 `kimi-k2-0905` 少了一行 —— 因为
   单测只能验证「我写的规则按我写的执行」，验证不了「这个规则对不对」。
