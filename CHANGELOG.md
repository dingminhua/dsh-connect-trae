# Changelog

## 4.4.3 (2026-10-23)

> **模型选择器里也看得见活动优惠；账号池信息架构对齐 workbuddy；顺带修一个会让已保存设置
> 读回空值的区域映射缺陷，和三处「写了等于没写」的样式。**
>
> 合并自 PR #51（issue #50 的落实）。两条从姊妹插件 `dsh-connect-workbuddy` 搬来的账：
> **模型的活动优惠该在「挑模型的地方」就看得见**，以及一个会让**已保存的设置读回空值**的
> 区域映射缺陷。搬的是结论与陷阱，不是代码 —— 两边的促销协议不同（Trae 发 `activity_discount`
> 规则，WorkBuddy 发 `badge` + `displayMode`），所以只有「怎么判、什么时候判、显示几个数字」
> 这三件事是共通的。

### 新增

- **模型选择器里也画活动优惠胶囊**（`feat(client)`，移植自 workbuddy 的 #120）。
  DSH 的模型选择器由宿主编排，插件能塞进去的只有一个字符 —— 而字符的颜色由 emoji 字体决定，
  不是我们能定的。宿主为此留的唯一缝隙是 `conversation.input.model.label` 插槽（契约原文：
  「渲染非交互的内联内容，例如带颜色的名称或徽标」，官方自己就用它挂 DeepSeek 的发布徽标）。
  插件在该插槽注册 `TraeModelLabel`：
  - **只显示一个倍率**。`traeModelDisplayName` 已经把目录倍率拼进名字（`Kimi-K2 · x0.55`），
    宿主原样渲染该字符串，所以插槽若再追加一个倍率就会印成 `· x0.55 · x0.55` —— 这正是
    workbuddy 的 #120 回归。现在后缀被**按形状**拆回名字之外（`/ · x(\d+(?:\.\d+)?)$/`），
    再画在那个能承载折后价的 span 里：有折扣时显示折后价，没有时显示目录价，**永远只有一个数字**，
    且是此刻成立的那个。
  - **在渲染时刻判定，不在解析时刻**。判据是钟点（闲时窗口开合、活动到期），所以快照只取一次、
    胶囊每次渲染现算，并挂一只**共享的分钟定时器**（20 行标签只花一个 interval）；夜间折扣不会
    在第二天早上继续挂着。
  - **取数走 `detail=fast`**（issue #77）。插槽在卡片之外，读不到卡片的 React state，只能自己问
    宿主；用的是卡片轮询的同一个 `/usage` 路由，但取**首屏文档**：模型名册、`creditMultiplier`
    与未解析的 `activityDiscount` 都是本地已知的，所以**打开选择器不会触发一次上游读**。
    结果缓存 60 秒。
  - **归属按 provider 判**：`panelOfProvider`（`src/region.ts`）把 `trae` / `trae-enterprise` /
    `trae-global` 映射到各自的 panel，**企业版读自己的名册**（同一凭据、不同计费池、不同阵容）；
    别人的 provider 一个徽标都不画、**连请求都不发**。
  - **语言不靠注入的 `t`**：插槽拿不到卡片的 `t`，所以直接读浏览器语言并查同一张
    `locales.ts` 表（中文「5 折」/ 英文「50% off」，两个占位符都传，各自取用的那个）。
  - 关键样式内联兜底：插槽渲染在卡片之外，卡片样式表不一定在位（从未打开过卡片的页面），
    所以胶囊的颜色/边框/圆角由组件自带，与 `.dsm-trae-model-promo-*` 同源同值。
  - **测试**：`tests/model-label-slot.spec.tsx`（13 条）覆盖「拆后缀」「折扣优先于名字里的倍率」
    「按形状而非数值拆」「`detail=fast` 与 panel 路由」「无价格就不画」「别人的 provider 不 fetch」
    与「中文文案」；`tests/client-activation.spec.tsx` 的注册计数 4 → 5。

### 修复

- **三处新样式被后定义的基础类吃掉**（`fix(styles)`，真机截图比对时发现）。
  这三个元素都同时挂两个类，而修饰类的规则写在基础类**之前** —— 特异性相同时后定义者胜，于是
  「写了的样式」在页面上等于「没写」：
  - `.dsm-trae-pool-modebar`（462 行）被 `.dsm-trae-pool-settings`（518 行）的
    `padding:0` / `border` / `background` 抹平，蓝色描边与淡蓝渐变全部消失，模式条塌成一条普通分隔行；
  - 免费模型缺失的警示语 `.dsm-trae-pool-serving-note`（471 行）被 `.dsm-trae-pool-note`（501 行）
    的 tertiary 灰覆盖，该显示橙色的地方显示成灰；
  - 账号下拉 `.dsm-trae-pool-account-select`（511 行）的 `max-width:min(320px,50%)`
    被 `.dsm-trae-select`（600 行）的 `max-width:220px` 覆盖，框比设计值窄。

  三处都改成双类选择器（`.a.b`，特异性 0-2-0），与规则顺序解耦。姊妹插件 `promo` 没有这个问题
  —— 是搬样式时把新规则插错位置的连带伤。
  **验证**：写脚本扫两端 JSX 里全部 33 组多类组合，按「交集属性 + 定义行号」判定谁覆盖谁，
  Trae 修完 0 处、promo 本来 0 处；`tsc` 两端静默，`vitest run` 81 文件 / 1014 条全过。

- **`regionsMapOf` 不再跳到过期的同名区域**（`fix(region)`，已单独提交，移植自 workbuddy 的 5.5.x）。
  旧规则是「有 `regions` 键就往下跳」，但 **`regions` map 自己也可能带 `regions` 键** —— 早期构建
  往 map 里写过旧兄弟字段（真实 profile 里 `accounts` / `regions` / `cliBridge` 就并排躺在
  `cn` 旁边）。跳下去读到的是**同一 panel 的另一份更旧的拷贝**，于是已保存的开关/手动排序读回空值，
  表现为「设置没保存」，而文件里其实还在。
  - 新规则按**形状**判定：外层只要含 panel id（`cn` / `enterprise` / `ai`）就是 map，不跳；
    否则才视为整段设置文档。
  - **变异验证**：把判定改回旧行为，新增用例必红（实测 1 条失败）；恢复后 22 条全绿。

### 重构

- **「更多设置」下面三段说明收进折叠块**（`refactor(pool)`，与 workbuddy 的「本池如何挑选账号」同形）。
  副本路径、保存规则、删除行为三段原本平铺，在标题下占掉八行，把两个真正的控件（目标测速模型、
  测试请求体积）顶出首屏。改用 `<details>/<summary>`：键盘可操作、展开状态对屏幕阅读器原生可见，
  不需要拿按钮和 state 去追 DOM；`open` 受控，因为这张卡片每次轮询都会重渲染，非受控会在用户
  刚点开时把它收回去。文案一字未删，副本路径那句照样在（「插件留了真副本」是主张，「这两个 id
  此刻就在这个文件里」是用户能打开来核对的事实）。顺带删掉从未写过样式的死类名
  `dsm-trae-pool-copyfile`。新增双语 key `row.poolMoreRulesTitle`。

- **账号池的信息架构重排**（`refactor(pool)`，结论移植自 workbuddy 的 5.4.0，代码按 Trae 的结构重写）。
  这一批不是改功能，是改**同一件事说几次、在哪里说**。十条原则里 Trae 欠九条，逐条落地：
  1. **总开关移到标题下方**。它原本是「账号池设置」框的最后一行，被它控制一切的成员表在它上方
     一百多行；池开/池关意味着「未入池」这一列**有没有意义**，所以选模式的控件必须排在
     依赖模式的控件之前。开关那一行同时给出**运行中的模式**（自动挑号 / 手动选号）——
     读的是已保存的值而不是草稿，因为开关本身已经显示待保存的编辑，旁边的「未保存」胶囊
     说明这件事，模式胶囊因此可以回答另一个问题：池此刻在做什么。
  2. **手动选号搬进标题行**。原来它自己占一整块，重复写着账号名。现在它与「当前计费：X」
     徽标**共用一个槽位**：池关闭且有绑定路由时是选择器（控件自带名字），否则是徽标。
     一个控件回答一个问题，不并存。
  3. **「派单中」不再与「未入池」同框**。这两件事正交：Host 在池里没有可用成员时会回退到
     已保存的选择，于是「正在计费的账号」完全可能不在池中。同一行还顶着「已选 0 / 1」，
     正确状态因此读起来像 bug。现在行内只留成员关系（且跟随**草稿**而非已保存列表），
     谁在计费由标题回答；两者真的冲突时，模式条下方给**一句话**解释。整行着色保留，
     计费行仍然一眼可辨。
  4. **批量按钮搬进成员区**。顺序改为「先声明范围（已选 N / M · 全部 / 清空）→ 再给动作
     （一键测试 / 重新检测）→ 再列账号」。它原先是整块页头工具条，按钮在问「对哪些账号下手」
     时，回答这个问题的控件还在一整块之外。「为什么按钮是灰的」紧贴动作行，不再隔一屏。
  5. **保存条 sticky**。两个生效按钮原本在整页最底部：改完一行偏好，按钮在视口之外。
  6. **「账号池设置」降级为「更多设置」**，它是「剩下那些」而不是页面主标题，不该与顶部的
     「账号池」争主次。
  7. **账号导入/导出搬到「更多设置」之上**。它们点一下立即生效，而它们下方那句提示写的是
     「点保存才生效」——立即生效的动作不能住在只承诺保存的区块里。
  8. **测试模型只说一遍**。设置区「目标测速模型」、表头「目标模型」、行尾各说一次，
     同一个名字在一屏里出现三遍。表头改为「**状态**」（它描述的是结果），行尾仅在
     **实际测的模型 ≠ 本池保存的模型**时才点名——那才是看着像 bug 而其实不是的情形。
     来源（实时请求 / 批量测试）仍然保留，它不在这两个地方说过。
  9. 顺带删掉因此变死的两条规则（`.dsm-trae-pool-bind`、`.dsm-trae-pool-tag-current`）
     与一个死键（`row.poolCurrentBadge`）；`row.poolCurrentHeader` 原本已定义却从未使用，
     这次终于用上。
- **测试相应重写**：`「派单中」 names only the pool's own answer` 那组改为断言**信息搬到了哪里**
  ——标题行的计费账号、池外旁注、以及池关闭时槽位里是选择器而不是徽标。新增三组共 10 条
  结构断言：开关在成员表之前且标签读运行态；批量按钮在「已选」之后、表格之前；保存条
  `position:sticky`；表头是「状态」、相同模型不复述而不同模型必点名。
  - **变异验证**（通过 ≠ 有效）：把 `modelDiffers` 改回「有模型就显示」→ **2 条必红**；
    把动作条移出成员区 → **1 条必红**；恢复后 50 条全绿。

### 验证

- `tsc -p tsconfig.json` 与 `tsc -p tsconfig.client.json` 均无输出。
- `vitest run` **81 文件 / 1014 条全过**（合并后 main 上复核实测；PR 写作过程中为 1007，末两个提交又加了 7 条）。
- `tsdown` 两个 build 通过。

## 4.4.2 (2026-10-23)

> **带工具的对话在 deepseek-v4.1-flash 上整轮 400/4027 拒绝。这个版本在两个工具出口
> 把 draft-3 风格的 `required: true` 归一化为 draft-4。**
>
> 接 issue #48 的后续证据（issue #49）：上游校验**分后端**。同一凭证、同一 SOLO 出口、
> 同一工具 schema，`glm-5.2`（智谱后端）放行属性内的 `required: true`，而
> `deepseek-v4.1-flash` 按 JSON Schema draft-4+ 严校验，直接回
> `4027 … tools.N.function.parameters/properties/X/required: invalid JSON Schema` ——
> 且 `tools.N` 是**按批校验**，一个不合格即全挂，所以「带工具必 400」。
> 之前 #48 判「上游已放行」是因为只在宽松的智谱后端上试过。

### 修复

- **工具 schema 出口统一归一化为 draft-4**（`fix(protocol)`，issue #49）。
  DSH schemastery 生成的工具参数是 draft-3 风格 —— `required: true` 写在属性**内部**：

  ```json
  { "type": "object", "properties": { "tool": { "type": "string", "required": true } } }
  ```

  JSON Schema draft-4 起已把 per-property boolean `required` 移除，改为父级字符串数组
  `{ "required": ["tool"] }`。deepseek-v4.1-flash 这类严校验后端对前者直接判
  `invalid JSON Schema`，整请求被拒。由于模型路由到哪个后端由上游决定、随 config 变化，
  凡带工具的请求都必须是 draft-4 干净的，与探针上次试过后端无关。
  - 新增 `normalizeTraeToolSchema` / `normalizeTraeToolSchemas`（`src/raw-chat.ts`）：
    递归把属性内 boolean `required` 提升到父级 `required` 数组（与既有数组去重合并）后
    删除 boolean；覆盖 `items` / `anyOf` / `oneOf` / `allOf` 等任意嵌套。**幂等** ——
    已是 draft-4 的 schema 原样返回（同一对象，零拷贝），不改变合法载荷。
  - **两个工具出口都套上归一化**：`prepareSoloBody`（SOLO `llm_utils_chat` 主路径，
    `parameters` 在 `JSON.stringify` 前归一化）与 `buildTraeRawChatDraft`（raw chat 路径，
    `structuredClone` 后的 `tools` 归一化）。纯本地、不碰凭据、不改调用方入参。
  - 归一化后的载荷形态与 issue #49 的 D3 对照实验（draft-4 提升后经
    deepseek-v4.1-flash 后端 200 正常 SSE）一致。

### 测试补强

- **989 例测试全绿**（`pnpm run test`），新增 **7 例**：draft-3 提升、嵌套
  `items`/`anyOf` 递归、与既有 `required` 数组合并、draft-4 幂等（字节不变）、
  `properties` 之外的 boolean `required` 与 `required: false` 不误伤、调用方 `tools`
  不被原地修改、SOLO 信封 wire 载荷为 draft-4。

### 已知边界

- 归一化只处理 draft-3 boolean `required` 这一种已实测命中的非法形态；上游若日后
  收紧到拒绝更多 draft-3 残留（如属性内其他 boolean 关键字），需另行取证后处理。
- 本次修复未经本机真实凭据实测（修复者无 Trae 凭据）；上游行为依据 issue #49 报告人
  的三步对照实验（D1 无工具 200 / D2 draft-3 4027 / D3 draft-4 200）。本地验证为
  单测 + 构造载荷核验。

## 4.4.1 (2026-10-22)

> **4.4.0 的修复自己藏掉了 `kimi-k2-0905`。这个版本把它捞回来，并补上 4.4.0 缺的实测。**
>
> 一条自我纠正。4.4.0 发布后作者对提升的模型做了**真实调用**实测，实测把 4.4.0 的
> 一个缺陷暴露出来：为了防止重名孪生行，4.4.0 加了「显示名已被占用就跳过」的规则 ——
> 这条规则把 `kimi-k2-0905` 也丢掉了，而它**是另一个真模型**（168K 上下文，实测可调用）。
> 于是报告人 `yuantao313` 抱怨的那一类「带日期的快照 ID」在 `kimi-k2-0905` 上**依然拿不到** ——
> 成因从「合并只遍历骨架」换成了「去重按名字判断」，**症状没变**。
> 详见 [`docs/ISSUE46_DIAGNOSIS.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/ISSUE46_DIAGNOSIS.md) 第 9 节。

### 修复

- **重名判断改为「能力测试」而非「名字测试」**（`fix(catalog)`，issue #46）。
  `claimedNames` 记录每个显示名下**最大的**上下文窗口；一个重名行只有在**严格更大于**
  该最大值时才提升，并被追加 id 以便区分（两行都渲染成 `Kimi-K2-0905` 的 picker 是在撒谎）。
  - **实测依据**（2026-10-22，CN 凭据）：`kimi-k2` 是 28000 而 `kimi-k2-0905` 是 168000，
    名字相同、能力差 6 倍，且 `kimi-k2-0905` 在 `solo_coder` 与 `chat_v3` 下**都能调用**。
  - 反面对照：`glm-4.7` 与 `glm-4.7-auto` 元数据**完全相同**（100000/16000/`chat_v3`），
    是真重复，仍然只留一行；`glm-5.2_advisor_default`（168000）比 skeleton 的 `glm-5.2`
    （200000）**更小**，是内部改道，仍被排除。
  - **实测结果**：目录 **42 → 46 行**，提升行 7 → 11。新增
    `kimi-k2-0905`、`minimax-m2-auto`、`minimax-m2.1-auto`、`glm-4.6-auto`
    （全部为 168K / `solo_coder`，显示名形如 `MiniMax-M2 (minimax-m2-auto)`）。
  - 比较基准是**最强的占用者**，因此与 wire 名单的顺序无关（有回归测试钉住）。

### 测试补强

- **982 例测试全绿**（`pnpm run test`），新增 **4 例**：重名但更强者被提升且名字带 id、
  重名且相等/更弱者仍被排除、`-auto` 孪生按能力取舍、比较基准取最强占用者。

### 实测记录（4.4.0 遗留边界现已关闭）

`4.4.0` 的 CHANGELOG 曾记「新提升的 7 个模型未逐个实测可调用性」。现已实测，**全部通过**
（真调用，走插件自己的 bridge，每个一次最小 `ping`）：

| 模型 | function | 结果 |
| --- | --- | --- |
| `seed-code-pro-0430` / `glm-5-turbo` | `solo_work_remote` | AVAILABLE |
| `glm-4.7` / `glm-4.6` / `minimax-m2` / `minimax-m2.1` / `qwen3-coder` | `chat_v3` | AVAILABLE |
| `kimi-k2` | `inline_chat` · `chat_v3` · `solo_work_remote` | 三个 function 全部 AVAILABLE |
| 4.4.1 新增的 4 行 | `solo_coder` | 全部 AVAILABLE |

合计 21 次真实调用，消耗 **约 11 额度**（约 0.43/次）。
因此 `4.4.0` 中「`kimi-k2` 归属 `inline_chat`、可调用性尚未取证」这条边界**一并关闭**。

### 已知边界

- fix A 多问 function 带出的 `doubao_1_8`（`Doubao-Seed-1.8`）**实测 4001 拒绝**：它没有
  `wireFunction`、也没有上下文与输出元数据，是条残缺的骨架行。按 issue #19「全部呈现 +
  如实报错」的策略这是合规行为（选中会得到明确的上游原文错误），但它确实是一条新增的、
  调不通的行 —— 记在这里，不假装它可用。
- 取证仍在维护者本机的 CN 账号上完成。报告人账号上是否真有
  `deepseek-v4.1-flash-1017` 这一行，仍需他升级后确认（本机 roster 上无此行）。

## 4.4.0 (2026-10-22)

> **模型表不再系统性排除「带日期的快照配置」；账号池开关不再被模型目录的保存冲掉。**
>
> 两条都来自 [issue #46](https://github.com/dingminhua/dsh-connect-trae/issues/46)
> （yuantao313：「模型列表不对齐，无法获取DeepseekV4.1 Flash 1017模型ID · 插件中无法获取Trae的1017模型，
> 只能使用正式版」）。诊断见 [`docs/ISSUE46_DIAGNOSIS.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/ISSUE46_DIAGNOSIS.md)。
> 版本号取 **minor**：模型名录的行为变了（多出一批此前拿不到的模型），接口与配置项零变更。

### 修复

- **模型表补齐 wire 名单里有、Remote 目录里没有的模型**（`fix(catalog)`，issue #46）。
  - 目录是「Remote 骨架 × wire 名单」两张表 join 出来的，而 `mergeTraeModelSources()`
    **只遍历骨架** —— wire 有、骨架没有的行被整体丢掉。这不是零星遗漏，而是**一整类别的系统性缺失**：
    **实测**本机 CN 账号上，Remote 骨架里带日期的 config_name **一个都没有**（`kimi-k2-0905`、
    `seed-code-pro-0430`、`search_agent_qwen_fast-0710` 全在 wire 名单里），于是**每一个带日期的
    模型插件都拿不到**。这正是报告人「IDE 有 `DeepSeek-V4.1-Flash-1017`、插件没有」的直接成因。
  - 提升**不是无条件的**：`isPromotableWireModel()` 要求四个上游信号同时成立 ——
    `usage === 'chat_completion'`（真模型，不是 IDE 的工具配置也不是账号的自定义模型）、
    `config_source === 1`（Trae 预设，不是用户自己的 custom model）、
    显示名是**真名字**（非空、非上游占位符 `-`、非 config 标识符、且不等于自己的 id）、
    显示名**未被已存在的行占用**（否则同一模型会以两个 id 出现两次）。
    **实测**：50 行 wire-only 收敛为 7 个真模型，其余 43 行（工具配置 / 自定义模型 / 别名 /
    `-auto` 孪生行 / codename config）仍被正确排除。
  - 被提升的行是**完整的目录行**：带自己的 id（那就是它的 `config_name`，所以不产生
    `wireConfigName`）、所属 function、上下文窗口、输出上限、倍率与促销规则。

- **Remote 目录多问几个 function**（`fix(solo-remote)`，issue #46）。
  `TRAE_REMOTE_DIRECTORY_FUNCTIONS` 增加 `chat`、`inline_chat`、`solo_agent_lite`、
  `solo_design_lite`、`solo_design_remote`。`kimi-k2` 在 Remote 侧**只**归属 `inline_chat`，
  而插件没问它 —— 这就是 `Kimi-K2-0905` 那一族拿不到的原因。
  **实测**：Remote 骨架 33 → 35 行，新增 `kimi-k2`（`Kimi-K2-0905`）与 `doubao_1_8`
  （`Doubao-Seed-1.8`）。问网关不提供的 function 无害（未知名字被忽略，不报错）。

- **账号池开关不再被「保存模型列表」冲掉**（`fix(client)`）。
  插件有 4 处写 `regions`，其中 3 处都**先展开旧 slot 再覆盖自己管的字段**；只有
  「保存模型列表」那处是**从零重建整个 region slot** 的，而它并不知道 slot 里还有 `pool`
  这个字段 —— 整体替换把账号池偏好冲掉了。症状：**开账号池 → 保存模型列表 → 池被关掉 →
  重开插件显示「未保存」**。
  修法：新增 `nextRegionDirectory()`（`src/status-paths.ts`），展开旧 slot 再用目录字段覆盖。
  **顺带修掉**同一处的另一个受害者：`creditPosition`（积分读数的座位）也一直被冲掉，
  保存模型列表会把读数重置回默认位置。
  > 这与 issue #42 记录的 `wireConfigName` 丢失是**同一类缺陷**：整块替换 slot 时，
  > 保存方不知道的字段就消失了。#42 丢的是 `wireConfigName`（每次保存都 4001），
  > 这次丢的是 `pool` 与 `creditPosition`。

- **同一模型在不同 function 下发布不同显示名时，取最充实的那一份**（`fix(solo)`）。
  上游对同一个 config 在不同 function 下发布不同的 `display_name`（实测：`doubao-for-auto`
  在 `chat_v3` 下为空、在 `solo_coder` 下是 `Seed-Code`），而插件的 wire client 是**先到先得**，
  于是「拥有它的 function 恰好不知道名字」的模型在插件里显示成 config id 本身。
  现在**行归拥有者**（function 决定可调用性，必须不动）、**名字取最充实的那一份**。
  上游对无名字 config 发布的占位符 `-` 不算真名字。

### 行为说明

- **显示名仍以 Remote 目录为准，刻意没有改成 wire 名单的**（issue #46）。
  最初的方案是「以 wire 为准，因为 IDE 渲染的是 wire 的 `display_name`」——
  **这个假设被实测否掉了**：wire 名单与 IDE 名单**32/81 行不一致**，而 Remote 骨架只有 **3/33**。
  原因是 wire 名单**按 function 分片**，插件的 wire client 读的是聊天 function，
  常落在 IDE 选择器并不渲染的那个名字上。代码与回归测试里把这个**被否掉的结论**钉住了，
  以免日后凭「听起来合理」再改回去。

### 测试

- **978 例测试全绿**（`pnpm run test`），其中新增 **17 例**：
  - `tests/catalog.spec.ts`（+6）：显示名保持骨架（钉住被否掉的方案）、提升 wire-only 模型、
    不提升工具/自定义/别名、别名不重复、`isPromotableWireModel` 的五种边界。
  - `tests/solo.spec.ts`（+4）：读 `usage` / `config_source`、上游没说时保持 undefined、
    跨 function 取最充实的名字。
  - `tests/issue46-regressions.spec.ts`（+5，**新文件**）：账号池开关与积分座位在
    每一种写入后都还在、模型目录多问 function、wire-only 模型被提升、
    工具/自定义/别名仍被排除。
  - `tests/solo-remote.spec.ts`：5 处硬编码的 function 列表 URL 改为引用常量。

### 文档

- 新增 [`docs/ISSUE46_DIAGNOSIS.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/ISSUE46_DIAGNOSIS.md)
  与 [`docs/ISSUE46_REPLY_DRAFT.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/ISSUE46_REPLY_DRAFT.md)。
- 新增三个只读探针（`scripts/probe-issue46-*.mjs`），只读、零额度，输出诊断与修复后验证的全部结论；
  `scripts/decrypt-block.js` 是从 `probe-toolcalls.mjs` 原样抽出的解密例程，供各探针共用。

### 已知边界

- **取证在维护者本机的 CN 账号上完成。** 名单按账号/套餐裁剪，报告人账号上很可能**真的有**
  `deepseek-v4.1-flash-1017` 这一行（本机没有）—— 它正好落在「骨架排除、wire 有」这一类，
  **修复后应当会出现**，但需报告人升级后确认。
- **新提升的 7 个模型未逐个实测可调用性**（调用会产生额度消耗）。按 issue #19 的既定原则
  「名单的沉默不能证明模型不可调用」，缺的是证据而不是行；但「能否真的调用」仍需实测。
- `kimi-k2` 归属 `inline_chat`，而可调用 function 列表里没有它 —— 它的可调用性尚未取证。

## 4.3.0 (2026-10-22)

> **设置卡片按「账号 / 模型 / 诊断」分栏，模型栏改回全部铺开。**
>
> 卡片原来是一列长页，把两类互不相干的事情混排在一起：运维账号（谁在服务、还剩多少、签到、
> 账号池及其日志）与编辑目录（勾模型、图片输入、上下文预算）。两者连提交语义都不同——账号改动
> 点一下即生效，目录改动是草稿、必须点「保存」——于是保存按钮常常离它要保存的东西隔着三屏。
> 学自同族 `dsh-connect-workbuddy` 的分栏实现。版本号取 **minor**：新增界面与一个只读栏，
> 接口、配置项与请求结构零变更。

### 新增

- **设置卡片按「账号 / 模型 / 诊断」分栏**（`feat(client)`）。
  - 顶部地区那排仍是**作用域**（这张卡片讲的是哪个供应商）；其下新增分栏 tablist（账号 / 模型 /
    诊断），三者共享同一个地区作用域。两排视觉上明确区分：地区是带开关的方框 chip，分栏是设置窗
    口那种下划线 strip——两排方框会被读成一个六选一。
  - 非活动栏用 `hidden` 留在页面里：切栏不重新拉取、不丢未保存的模型草稿、账号池日志不重建；
    `hidden` 同时让非活动栏退出无障碍树，这正是 `role="tabpanel"` 要的语义。
  - 新增只读「诊断」栏：面板名、供应商 id、服务账号（按名字，不打印 id）、访问令牌与重新登录两个
    到期时间、目录模型数与已启用数、账号池与签到支持与否、Raw 会话通道状态，以及上游最近一次错误
    **的原文**（原样引用，不翻译、不概括）。这一栏没有任何会改设置的控件，存在的唯一理由是被整段
    贴进反馈。
  - 签出态不画分栏：那一段说明不会被一个看不见的 tab 藏起来。
  - 文案同时补 en/zh（`row.panel*` / `row.diag*`）；样式新增 `.dsm-trae-panels` /
    `.dsm-trae-panel-tab` / `.dsm-trae-panel` / `.dsm-trae-diag*`。

- **模型栏把所有模型全部铺开，没有内层滚动条**（`feat(client)`）。
  - `.dsm-trae-model-list` 不设 `max-height`，`overflow-y` 也不是 `auto`：唯一滚动是卡片自己的
    页滚。`overflow: hidden` 保留，只为圆角描边——纵向不裁任何内容。
  - **实测**（`tools/panels-shot.tsx`，30 个模型的目录）：`scrollHeight == clientHeight == 1889`、
    `clipped: false`、`max-height: none`、面板内自带滚动元素 `0` 个，保存栏落在页面末尾。

### 重构

- **账号栏抽成 `src/client/TraeAccountPanel.tsx`**（520 行），`TraeUsageCard.tsx` 从 2354 行
  降到 1981 行。拆分是「笨」的那一半：所有判定仍留在卡片里（谁在服务、每行值多少、能不能签到、
  读数放哪儿），账号栏只接收算好的行视图；这样账号表与账号池表读的是同一份判定，不会各说各话。
- 卡片与账号栏共用的格式化/判定（`formatNumber` / `formatDateTime` / `dotStyle` /
  `refreshTokenWarning`）下沉到 `src/client/display.ts`，避免两处各写一份而漂移。

### 修复

- **诊断栏的「每日签到」不再依赖账号池**。原先读 `pool.checkinSupported`，而账号池是**可选功能**，
  没开池的国内账号会显示「本面板不提供」——恰好与事实相反。改为先读签到文档（`status.checkin`）。

### 测试

- `tests/card-panels.spec.tsx`（10 条，新增）：默认落在账号栏、点模型/诊断可切换、非活动栏仍挂载
  （草稿不丢）、恰好一个 `aria-selected`、tab 与 tabpanel 互相指向、切栏不改地区作用域、诊断栏无
  任何可交互控件、签出态无分栏；另加两条：30 个模型全部渲染且列表样式里没有 `max-height` /
  `overflow-y:auto`，「每日签到」按签到文档而非账号池判定。
- 顺带修好受影响的既有卡片测试（`card-test-models` / `card-context-bulk` / `card-promo` 的
  `renderOpen` 先点开模型栏），因为模型控件现在确实在那一栏里。
- 新增 `tools/panels-shot.tsx` + `pnpm panels:shot`：把三个分栏各自渲染成
  `/tmp/panels-preview-<section>.html`（真实中文文案、30 模型目录），页面里的 `#audit` 给出
  面板盒、分栏下划线与模型列表 `scrollHeight`/`clientHeight` 的实测值，用 `--dump-dom` 读回，
  用来证明「没有内滚」而不是靠肉眼。
- 全量 `vitest run` = 79 文件 / 961 测试全绿；两份 tsconfig 均 exit 0；`tsdown` 构建成功。

### 文档

- README / README.en 的卡片特性列表补上分栏一节（含「为什么分栏 = 提交语义不同」与「模型全部铺开」）。

## 4.2.0 (2026-10-21)

> **模型行显示活动优惠徽标：只在上游此刻真在打折时出现。**
>
> Trae 把促销放在模型目录的同一次响应里——remote 目录的 `features.activity_discount`、wire 名单的
> `display_contact_config.activity_discount`（都是 JSON 字符串）。上游发的是**规则**（折扣比例、原价、
> 闲时时段与命名时区），不是文案。插件解析规则、在卡片**每次渲染时**按当前时钟判定，在模型名旁边画一枚
> 胶囊：`5 折` / `闲时 5 折` / `限时 5 折`，悬停给出原价→现价与时段。请求数、请求身份、积分语义全部不变。
>
> 判定放在渲染时刻而不是解析时刻，是因为 `time_windows` 是「Asia/Shanghai 周一到周五 00:00–09:00、
> 12:00–14:00、18:00–24:00，周末全天」这种墙钟时段：若在解析时挑定结论，夜里读到的「闲时 5 折」会在
> 第二天早上继续挂着。实测同一份规则，时钟平移 +0/6/12/24/36h 分别画出 3/5/5/3/5 枚（2026-10-21 18:16）。

### 新增

- **模型行显示活动优惠徽标**（`feat(model)`）。解析 Trae 目录里的 `activity_discount` 规则，按渲染时刻判定后
  在模型名旁边画一枚胶囊：`5 折` / `闲时 5 折` / `限时 5 折`，悬停给出原价→现价、时段与时区。
  - 解析层只留规则、不挑徽标；规则随 `lastCatalog` 持久化，判定在卡片每次渲染时做，胶囊随窗口自动出现和消失。
  - **先信上游的 `current`**（服务端算好的「此刻状态」）：`discount_type !== 'none'` 且折后价真比折前低才显示；
    只有它报「没打折」时才用 `off_peak.time_windows` 按模型声明的时区自己算（跨零点不推断、`start` 含 `end` 不含）。
  - 文案只认上游明说的：只有 `limited_discount` 写「限时」，其余按「补贴 / 闲时」；颜色是插件自己的选择。
  - **不从倍率反推折扣**：那一行本来就显示 `x0.40`，再挂「5 折」是同一句话说两遍。
  - 纯提示：不新增请求、不改计费语义；国际区（订阅制）目录里没有这份数据，显示路径同一条、上游补齐即生效。
  - 详见 `docs/PROMO_BADGE.md`；复算脚本 `scripts/probe-promo.mjs`（只读，不消耗积分）。

### 修复

- **跨 group 去重不再丢促销规则**（`fix(solo-remote)`）。同一次目录响应里，同一个模型在部分 group 带
  `activity_discount`、在部分 group 完全没有，而 group 顺序每次调用都可能不同（issue #23 的同一现象）。
  `preferStrongerRow` 原先只按容量选行（等容量时先到先得），会把带规则的那一行丢掉，导致同一份上游数据
  相邻两次调用一次 1 枚徽标、一次 0 枚。现在选行仍按容量，但把另一行携带的规则**并到赢家身上**；
  没有改成「选带规则的行」，因为那会丢掉 1M Max 档——徽标不能以用户失去上下文预算为代价。
- **活动徽标的两处边界收紧**（`fix(promo)`）。
  - 两条规则评分并列（都没有 `current`、各 1 个窗口）时，原先留先到的那条，今晚有没有徽标就取决于网关的
    分组顺序；改按规则内容的规范化 JSON（键名排序）取定，任意分组顺序结果一致。
  - 上游 `time_zone` 写坏时，判定退回账号时区但悬停仍报那个读不出来的名字；改为报**实际用于判定的**时区。

### 文档

- 新增 `docs/PROMO_BADGE.md`（两处字段位置、逐字抓包、判定规则、与 WorkBuddy #91 的能力对照、实机复核输出）。
- README / README.en 功能列表各加一条「活动优惠徽标」。
- `docs/PROMO_BADGE.md` 按 2026-10-21 17:14 复测校正：wire 侧实测 214 行 / 26 行带规则 / 9 个模型
  （旧记 54 行 / 8 行 / 3 行在打折）；补记判不了的窗口直接丢弃（不推断「全天」或跨零点）、
  `limited` 分支的 `end_at` 未被读取（实测限时活动 `current` 报 `none`，所以「限时」暂不会真的出现）。

### 测试

- 新增 `tests/promo.spec.ts`（20 例）：`enable: false` 丢弃、JSON 字符串形态、两段价格字段（`consumption_rate` /
  `after_consumption_rate`）、窗口过滤与丢弃（缺周几、空区间、越界）、时区判定、坏时区退回账号时区、
  跨零点不外推、`current` 优先、非 `limited` 不写「限时」、无数字不画、以及「同一份规则在框内/框外判定不同」。
- 新增 `tests/card-promo.spec.tsx`（6 例）：胶囊渲染在模型名旁边、三种类型的颜色类、悬停数字、无规则不渲染、
  窗口外不渲染。
- `tests/solo-remote.spec.ts` 补跨 group 去重 4 例：容量与规则并存、评分排序、并列按内容取定、
  同一份数据换 group 顺序结果不变。
- 全仓 **78 文件 951 例**通过；`tsc` 两个工程干净；`build` 通过（CJS 344.00 kB / ESM 426.33 kB）；
  CI（ubuntu + windows）全绿。

## 4.1.0 (2026-10-21)

> **受限网络（企业网只放行少数域名）下「刷新模型 500 / 聊天 4001」的完整修复。**
>
> 链路是三段式的：`solo.trae.cn` 的 CONNECT 被代理拒绝（403）→ 目录 `fetch failed`（刷新 500）→
> 模型丢失 `wireFunction` → 聊天按默认 `solo_work_lite` 发请求 → 模型不在该 function 的 config 名单里就
> 4001 `config_name rejected`。本版对三段各有一处改动：目录 host 回退到聊天网关的同路径（带冷却重试）、
> 目录分组的 function 兜底 `wireFunction`（只认可聊分组）、bridge 对「只带 function」的目录行保留
> resolver 的 `config_name` 大小写（issue #38 的坑）。
>
> 合并 PR #43 前做了对抗性复现，修掉了四处会伤到真实用户的回归——**最关键的一处**：原实现把功能名
> 属于 `solo_agent`/`builder_v3` 的目录行整行丢弃，而受限网络下那正是 9 个只在 `solo_agent` 分组里
> 出现的模型（`gpt-5.5`、`gpt-5.6-*`、`gpt-6-astra`、`glm-5.2`、`kimi-k2.7-code`、`Dola-Seed-2.0-Code`、
> `deepseek-v4-flash-0731`），它们正是 issue #19 修复要暴露的那批、且实测在默认 chat function 下
> 都能正常应答。现在只把非可聊 function **降级清空**，行保留。

### 修复

- **受限网络下模型目录走聊天网关备用 host，目录分组 function 兜底 `wireFunction`**（`fix(cn)`）。修复分三层：
  - **目录 host 回退**：官方 remote host 网络错误 / 超时 / 5xx 时，按序尝试聊天网关的同一路径
    （CN 为 `trae-api-cn.mchost.guru/api/remote/v1`，实测同路径同响应结构）；401/403/404 等语义性拒绝**不回退**。
    进程内记住最近一次**给出了非空目录**的 host。官方 host 失败后进入 5 分钟冷却：冷却期内先走记住的备用
    host、官方 host 排在链尾（备用也挂了时仍有一次机会），冷却到期后官方 host 重新排第一 —— 只把官方 host
    「排在第二」并不能让它被重试，因为循环在第一个成功处返回，所以必须显式冷却重试，恢复的网络才会在
    一个冷却窗口内重新接管。空目录（200-but-empty）既不算成功（不记忆）也不终止链路（继续试下一个 base），
    否则一个还没同步的镜像会永久堵死官方 host。回退只作用于 remote/v1 目录这一个 base；
    `get_detail_param`、`llm_utils_chat` 照旧走各自原有 host。
  - **目录分组 function 归因**：`fetchModels` 不再丢弃 `data.list[].function`——解析时把**可聊**分组的 function
    附到每个模型（同一模型出现于多个分组时按 `TRAE_DIRECTORY_FUNCTIONS` 的实测优先级取，而非请求参数
    `functions=` 的顺序；后者是历史列表，与 wire roster 自己的收集顺序不同，混用会让同一模型在「roster 有没有
    返回」两种网络下拿到不同 function，`solo_agent_remote` 在 Remote 付费门后，优先它会多出 1005）。
    `mergeTraeModelSources` 的 `wireFunction` 优先取 `get_detail_param` 的结论，目录分组兜底（roster 知道
    账号的付费/可用状态，目录不知道）。同一 function 名重复出现时按名分桶保留全部，不再只留最后一组。
  - **非可聊 function 只降级、不丢行**：`solo_agent`、`builder_v3` 是 IDE/Remote-agent roster，聊天通道实测
    4011/4001，所以**不把这两个 function 写进 `wireFunction`**；模型本身**保留**，改由默认 chat function
    调用。把它们整行丢掉等于在本次修复针对的受限网络里重新藏起 issue #19 的成果（详见上方导语）。
    仅带 `wireFunction`（无 `wireConfigName`）的目录行，聊天请求会带上该 function，但 `config_name` 仍由
    resolver 提供（目录 id 只是展示名，网关 `config_name` 大小写敏感，见 issue #38）。默认 function 与
    fallback 模型常量未动。
  - 已知取舍：模型被目录放在 `chat_v3` 分组下、但实际不可聊时，插件仅凭目录数据无法区分，仍会展示，
    聊天失败走现有 4001 提示翻译（诊断入口见 `docs/ISSUE19_DIAGNOSIS.md`）。

### 测试

- 回归用例：host 回退（官方网络错误 → 备用 host 同路径同查询；401 不回退；5xx 回退；**空目录继续尝试下一个
  base 且不被记住**；记住最近成功 host；**冷却到期后官方 host 重新排第一**；显式 baseUrl 钉住单 host）、
  分组 function 归因（可聊分组优先；**同一 function 名重复出现时不丢模型**；容量来自后分组时保留先到先得的
  function）、合并兜底与 `withChatCallableFunctions` 的**降级而非丢弃**、bridge 对 wireFunction-only 目录行
  保留 resolver 的 `config_name`（大小写）、以及受限网络端到端（wire roster 为空时 9 个 `solo_agent`-only
  模型仍然在目录里）。
- 全仓 **921** 例通过，0 skipped；`tsc` 两个工程干净；`build` 通过；CI（ubuntu + windows）全绿。

## 4.0.1 (2026-10-19)

> CN 区模型卡「最大输出」整列空白（issue #42）修复：上游**是**发布输出上限的——`get_detail_param` 的
> CN 80 个 config **80/80** 都带 `model_detail_list[].max_tokens`——但目录合并 `mergeTraeModelSources()`
> 把 wire 侧的 `maxTokens` 丢掉了。这个字段从合并函数诞生那天（1.1.0）起就没被复制过，卡片、
> `/models/refresh` 与 DSH 模型注册因此永远收到「未知」。附带落地同一 issue 的批量请求：整区上下文
> 一键切换两个按钮。

### 修复

- **目录合并带上 wire 的 `max_tokens`**（`fix(catalog)`）。合并时其余字段（contextWindow / maxContextWindow /
  倍率 / reasoning / multimodal / config_name）一路都复制了，唯独漏了 `maxTokens` 一行。修复后 CN 实测
  32 行目录 30 行带值；**仍空白的行是诚实的**——`kimi-k2.8-preview`、`qwen3.8-flash` 这类 TraeCode 通道行
  在 SOLO 名单里没有对应 config，拿不到候选值，宁空白不编造。取值链其余部分不动：`collectModels` 读
  `model_detail_list[0]` 实测无损（71/80 config 的双项 `__dev`/`__max` 上限恒等）。该值是**元数据**，
  请求体照旧不下发 `max_tokens`（上限由 Trae 服务端决定），行为无变化。
- 报告人「想确认的一点」（输出上限是否挂在后面的 detail 项或别的键）已逐项 dump 排除，全文见
  `docs/ISSUE42_DIAGNOSIS.md`，取证脚本 `scripts/probe-cn-maxtokens.mjs`（只读，随仓库提交）。

### 新增

- **卡片模型管理区两个批量上下文按钮**（`feat(card)`，issue #42 附带需求）：「**整区切到 Max**」给本区
  每个带 Max 档的模型一次性写入其 `maxContextWindow`（正是 `applyContextBudgets` 认的精确值），
  没有 Max 档的行不动、已有手动预算保留；「**全部恢复默认上下文**」清空本区预算。二者作用于草稿、
  按「保存」生效，落盘形状与逐行单选完全一致——因此**没有**新增 `contextBudgetMode` 配置键，
  运行时零新分支、旧配置零迁移。报告人数的 18 次点击现在是一次。
- README 新增「最大输出与上下文预算」一节（issue #42 建议 1 换内容采纳：事实已变，文档写明上游发布该值、
  空白行另有其因）。

### 测试

- 新增合并回归用例（修复前必红：wire 行带 `maxTokens` → 合并行必须保留；join-miss 行必须缺席）与
  5 例卡片用例（批量按钮的落盘内容、既有手动预算的保留、两按钮各自禁用条件）。
- 全仓 **901** 例通过，0 skipped；`tsc` 两个工程干净；`build` 通过。修复前后各跑一次实时探针对照
  （0/32 → 30/32）。

## 4.0.0 (2026-10-19)

> 移除 issue #29 的「跟随 Trae 桌面端当前登录」整套机制，连同它派生的两处 UI。
>
> **原因：账号池功能无法兼容原需求。** #29 要的是「插件始终跟着 App 当前的登录走」，而账号池要的是
> 「每个账号都能被长期保留、随时选中、按可用性换号」——池里选中的账号往往正是那个已经不在 App 里
> 登录的账号，它必须照常可用。「跟随当前登录」与「账号池」是互斥的两条规则，只能是后者。
>
> 这是**大版本**：一个配置字段与两处界面被移除。

### 移除

- **设置卡片里的「跟随 Trae 当前登录的账号」开关**。连带删除 `Config.followAppLogin` 字段、每次设置
  生效时的自动重绑、以及启动时的那次跟随。插件不再有「不点也会自己换绑计费账号」的路径。
  该开关默认关闭，所以从未打开过它的用户没有任何行为变化；存过 `true` 的旧配置里的这个键会被忽略。
- **账号区上方的「Trae 已登录 X，但本插件绑定的是 Y。改用 Y」提示条**。连带删除 Host 侧
  `TraeCredentialStore.liveLogin()`、usage 文档的 `appLogin` 字段及其读取路径、`TraeWebAppLogin` 类型。
  usage 文档不再携带这个字段。
- **账号池设置里的「每登录一个账号，就刷新一次」黄色警告框**。账号副本是每次读取就补齐一次的，
  这句「没刷新就换号，上一个账号不会被保存」与实现不符。
- 顺带清掉只服务于跟随开关的 Host 侧 `writeSettings` 写入通道（`settings.update` + revision 冲突重试），
  它的唯一消费者就是那个开关。

### 不变

- **没有显式选择账号时，仍然默认使用 App 当前登录的账号**（`preferred()` 对 `source === 'desktop'`
  的凭据优先）。这是本次移除后仍然保留的「跟随」行为，且不需要任何开关。
- **账号副本机制不变**：本机每个 Trae 登录都会被复制成自己的一份（`~/.dsh/.trae-auth.<region>.json`），
  换号不会顶掉任何账号，之前的账号仍可被重新选回来。

### 测试

- 删掉随功能退役的用例：`auth.spec.ts` 的 `liveLogin()` 三态、`web-status.spec.ts` 整个
  `app sign-in follow hint (issue #29)` describe、`card-accounts-table` 的提示条两条、`card-pool` 的
  警告框一条。`card-styles` 的遮罩用例改用 `showPointsInMainUi` 开关驱动。
- 全仓 **895** 例通过，0 skipped；`tsc` 两个工程干净；`build` 通过。

## 3.10.2 (2026-10-19)

> 设置页的账号列表**先出、积分后补**。打开卡片原本要等**一整份**用量文档组装完才画第一笔：那份文档的
> 尾巴上挂着「逐账号读上游余额」和「逐账号读签到状态」，每个账号一次网络往返，单次超时 30 秒、没有重试，
> 上游一慢就层层等待——这正是兄弟插件 dsh-connect-workbuddy 的 issue #77（实测 30–60 秒才看到账号）。
> Trae 这边同一份文档里 `poolMembersOf` 甚至被调了 **4 次**（`members`、`effectiveMemberAccountIds`、
> `memberNames`、`otherAccounts` 各一次），签到那条路还要再触发一次，所以同样的机器上比 workbuddy 更慢。
> 本版把首屏与「测量」拆开：首屏只用本机已存的东西，测量结果随后补上。

### 修复

- **账号列表不再等上游余额**。`GET /usage?region=…&detail=fast` 返回一份只用本机状态的「首屏文档」：
  `store.current()` 读已存凭据（不做网络刷新）、账号行来自新增的 `localMembers`（就是请求路径本来就在用的
  `localPoolMembers`，零上游调用）、签到状态来自本进程已测过的缓存。**实测 0 次上游请求**，本机 1.3 秒的
  完整文档变成毫秒级首屏。
- **卡片分两笔画**：先请求 `detail=fast` 上屏，再请求完整文档补齐积分/签到/模型探测结果。首屏文档**永不
  覆盖**已经在屏的完整文档——否则每次轮询都会把积分闪回「—」。
- **首屏之前不再谎称「未登录」**。旧代码在 `statusByRegion` 里预置了一份 `signed-out` 占位文档并直接渲染，
  于是整段等待时间里已登录的用户看到的是「去登录」引导；现在状态表初始为空，未拿到任何文档时显示新增的
  「正在加载账号…」，真正的 `signed-out` 文档到了才显示登录引导。
- **完整文档故意保持不变**：`detail` 缺省、或值不是精确的 `fast`（比如大小写写错、拼成 `fastest`）时一律
  退回完整文档——宁可慢一会儿，也不能给出一份更空的卡片。
- Host 侧配套：`TraePoolDeps` 新增可选 `localMembers` / `cachedCheckinState`，`src/index.ts` 里分别接到
  `localPoolMembers` 与新增的签到状态缓存（`CHECKIN_CACHE_MS = 10 * 60_000`）。老版本 Host 没有这两个
  dep 时，首屏文档**省略** pool 段而不是回头去付那次昂贵读取。

### 测试

- 新增 `tests/issue77-fast-first-paint.spec.ts`（11 例）：首屏文档的上游调用数为 0、用的是 `current()`
  而不是 `resolve()`、缺 dep 时省略 pool 段、`detail` 缺省/拼错一律退回完整文档。
- 新增 `tests/issue77-card-first-paint.spec.tsx`（3 例）：完整文档还在路上时账号行已经上屏、未拿到任何
  文档时显示「正在加载账号」而不是「未登录」引导、迟到的首屏文档不会覆盖已在屏的完整文档。
- 全仓 **902** 例通过，0 skipped。


## 3.10.1 (2026-10-19)

> 「一键签到所有账号」下线。Trae 限制**每台设备每天只能签到一次**：本机任一账号签过之后，这个按钮
> 对整批账号在当天剩余时间里只能是灰的——一个永远点不动的控件，还得在下方专门写一句话解释它为什么灰。
> 单账号签到仍在名册表里，那才是能真正执行的入口。

### 变更

- **移除账号池动作行里的「一键签到所有账号」按钮**，动作行现在只剩「一键测试所有账号」。连带移除
  批量签到的请求逻辑（`runCheckin`）、`busy` 的 `checkin` 态、签到进行中的状态行，以及只服务于这个
  按钮的 8 个文案键（中英各一份：`poolCheckinAll` / `poolCheckingIn` / `poolLogCheckinStart` /
  `poolLogCheckinClaimed` / `poolLogCheckinAlready` / `poolLogCheckinFailed` / `poolLogCheckinDone` /
  `poolActionNoteCheckinDevice`），并删掉卡片里已不可达的 `checkin-unsupported` 409 分支。
- **单账号签到不受影响**：名册表（「Trae 账号」表格）的签到列仍按账号逐个签到，签到列的状态文字与
  本机设备限制提示照旧。
- Host 侧 `?action=checkin` 路由与 `checkinSupported` 字段保留不删：浏览器里可能还有旧的 client
  bundle 在调它，删掉会让它们直接 503。新卡片不再调用该 action。

### 测试

- `card-pool` 的批量签到用例改为断言按钮缺席：不再渲染 `poolCheckinAll`、不再出现「本机今日的签到
  已用掉」提示行；同时保留「成员为空」「面板无免费模型」两条原因断言，确保这次删除没有顺带删掉测试
  按钮的说明。全仓 **888** 例通过，0 skipped。

## 3.10.0 (2026-10-18)

> 本版把「账号在本机到底存了几份、删一个账号到底删掉了什么」讲清楚并做对：本机每个 Trae 登录都会
> 自动变成插件的一份副本，卡片只显示、也只使用副本；「删除」现在也真的落到 Trae 应用本身（连同它在
> `storage.json` 里的登录一起注销，改写前留备份、应用运行中则拒绝并点名）。另外修掉了一批让测速与
> 池子「看起来坏了」的问题：目标模型不在已启用列表时的假 4001、重启后立刻测速的 4001、一处点击
> 两条日志、一次整批等待才上屏。默认测试套件不再有 skipped。

### 新增

- **本机每个 Trae 登录都会自动变成插件的一份副本，卡片只显示、也只使用副本。** Trae 应用只有一个
  登录槽，下次登录就把上一个覆盖掉；插件改为每次刷新（读账号列表）时把本机现有登录**镜像**成自己的
  副本，因此换号不再丢号：已有副本的账号**不动**（副本里可能是插件刷新过、比应用更新的令牌）；没有
  副本的本机登录**补建**一份，写进该区域自己的凭据文件；卡片与账号池只列副本，来源统一显示「插件副本」。
  镜像在插件加载时就跑一遍（三个面板各一次），不必等用户点开那个面板。
- **一张卡片上同时支持多号**：登录 A 号后刷新 → 生成 A 副本；在 Trae 里换 B 号后刷新 → A 的副本仍在、
  B 也生成副本，池子里两个号都能用。
- **设置区写明了「登录一个号就刷新一次」这条规则。** 卡片顶部的账号说明与账号池设置区都提示：Trae 只有
  一个登录位，登录任意账号后要刷新一次（打开卡片或点「重新检测账号」），插件才会把这次登录保存成副本；
  没刷新就换号，上一个账号不会被保存——它会被 Trae 里的新登录覆盖。设置区是一条警示框，因为漏掉这一步
  的代价是静默丢号。
- **导出 / 导入也只针对副本。** 导出写出去的是**插件自己保存的副本**令牌（`copyOf`），不再从合并视图里
  取 Trae 应用那一份；导入的账号一律作为**插件副本**写入本区域的凭据文件，不触碰 Trae 的
  `storage.json`。界面文案同步写明「账号副本」。
- **账号池的每一行只有一个销毁动作：「删除」。** 原来的「移除」被整体撤掉——它只改成员草稿、不动本机
  凭据，和「删除」并排出现时是同一个坑的两条岔路，用户反复把它当成「删不掉」。删除 = 插件副本 +
  Trae 应用登录一起清（见下一条）。路由 `?action=remove` 与 `removeOne` 仍保留不删：浏览器里可能还有
  旧的 client bundle 在调它，删掉会让它们 503；新卡片不再使用。

### 变更

- **「删除」现在也落到本机：连 Trae 自己那份登录一起注销，并留备份。** 上一版只删插件自己写的
  `~/.dsh/.trae-auth.*.json`，可账号同时也登录在 Trae 应用里（桌面 `storage.json` 的
  `iCubeAuthInfo://icube.cloudide`），Trae 每次都会把它再报上来，于是行永远回来。现在 `deleteAccount`
  先删自己那几份，再改写各版本 `storage.json`（删掉该键、从 `iCubeAuthInfo://usertag` 里摘掉该
  userId、其余键原样保留），为此 `decrypt.ts` 补了 `encryptTraeStorageValue` / `traeStorageValueType`
  （同一套固定盐值 AES-128-CBC，与解密器互为逆运算）。
  - **应用开着就不写**：Trae 把 `storage.json` 放在内存里、退出时回写，运行中改写一定会被覆盖。新增
    `src/trae-process.ts` 的 `probeRunningTraeApps`（macOS/Linux 读 `ps`，Windows 读 `tasklist` 保守判定），
    运行中的版本进 `blockedApps`，卡片写明「先完全退出 X 再删」——这是用户能自己执行的下一步，而不是
    一个读不懂的失败。进程名互为前缀（`Trae` vs `Trae CN`），匹配按最长优先并消费已匹配项，否则只开
    Trae CN 时会误报国际版在运行。
  - **可回退**：改写前在同目录留 `storage.json.dsh-backup-<时间戳>`，写后回读校验，`encoded` 还在就
    视为失败（可能被别的写入者覆盖）。
  - 返回值扩展为 `{deleted, stillSignedIn, hadCopy, signedOutApps, blockedApps}`；`deleted` 的语义从
    「插件不再持有」升级为「**本机任何地方都不再持有**」。`stillSignedIn:true` 时卡片不再谎报成功，
    而是按 `hadCopy` 区分「已删副本但仍登录在 Trae 里」与「本来就没有副本，只存在于应用登录」。
  - 删除的进行中态是瞬时 in-flight 集合（沿用「成功后按钮不能一直转圈」的教训）；设置落盘失败时报错且
    **不**写成功日志——否则下一次刷新就把账号带回来，与日志互相打脸。
- **成员关系只有一个写者：卡片。** Host 侧的 `removeOne` 只忘掉这条测速记录（成员关系不在它那里），
  卡片负责把 `regions.<面板>.pool.memberAccountIds` 落盘，写完读回校验；开关 / 目标模型 / 测试体积
  一律按**已保存值**原样写回（它们是「改完要保存」的偏好，不该被一次移除顺带提交）。草稿的重置从
  「整份设置一变就全量回滚」拆成**按字段**重置，因此这次落盘不会把用户正在编辑、尚未保存的开关或
  目标模型悄悄改回去。
- **「派单中」只在池开启且这一行确实是池成员时显示。** 池子被清空时 Host 会故意回退到面板绑定的账号
  继续计费，于是那个账号的 `current` 仍为 `true`，卡片照旧给它打上「派单中」，与同一屏上方「尚未勾选
  任何池成员」互相打脸。手动模式（池关闭）下绑定就是答案，徽标照常显示。
- **无副本的残留成员行不再冒充正常账号。** 设置里仍保存、但本机已没有任何登录的成员（`reachable:false`）
  原来有绿点和空白说明，读起来像「插件没建副本」。现在名字回退成 id、点变灰、带「本机无副本」标签
  （`row.poolNoCopyTag`），一眼能认出是残留并点删除清掉。

### 修复

- **池子的「目标模型」不在已启用模型列表里时，测速会假报「上游不提供」。** Trae 把它答成
  `4001 config_name rejected`，卡片再把它渲染成「所有已选成员当前均不可用」，于是每个账号都像是坏的。
  根因是同一个模型在两套目录里各取一半：目标模型的下拉来自**完整**目录，而请求走的是**已启用**子集
  （`enabledModelIds`）——子集里没有该模型的行，桥接层就拿不到它所属的 SOLO function，只能按默认
  `solo_work_lite` 发送；`Doubao-Seed-Code` 只被 `solo_agent_remote` 收录，于是稳定的 4001。现在启动时的
  wire 解析表**登记合并目录里的每一行**（`configName = wireConfigName ?? id`，并带上 `wireFunction`），
  不再只登记「wire 名与显示 id 不同」的行；显示名回退按**先到先得**，避免同名（`Seed-Code`）互相覆盖。
  桥接层另外在目录行只带 config_name、不带 function 时**从解析表借用 function**——仅当两边 config_name
  一致，不一致时保留目录答案。
- **重启后立刻点测速不再 4001。** wire 表要等宿主刷新模型列表才会填上，这段时间里探针仍然只能按默认
  function 发送。池子的「测速 / 一键测试」与「测试模型」现在在 wire 表未解析时先补一次目录发现：失败
  不阻断，探针照旧报告上游的真实答案。
- **测速不再「卡住」：按行流式读取 + 3 分钟硬超时。** Host 的 `action=test` 本来就是一行一个账号的
  NDJSON，卡片原来 `await response.text()` 才解析，等于整批跑完才一次性上屏；改 `testLinesOf()` 用
  `response.body.getReader()` 边到边解析，每个账号测完立刻出现，`response.body` 缺失时回退 `text()`。
  另外加 `TEST_TIMEOUT_MS = 180_000` + `AbortController`：连接被重启/断流吊住时（Host 重启后旧页面
  开着的请求就是这种）按钮原来会永久禁用、只能刷新页面；现在到点自动取消、按钮恢复，日志给出
  `row.poolLogTimeout`。
- **一次点击只记一条测速日志。** Host 的 `test` 流先逐账号推 `{row}`，末尾再推一份 `{rows}` 汇总重复
  同样的行；卡片把两处都当新结果，于是一次点击出现两条「LaoDing：正常。」。现在按 `accountId` 去重，
  第二次只刷新单元格、不再记日志（单号测速路径同样去重）。
- **移除之后按钮不再永远停在「移除中…」。** 移除成功后写下的标记，与按钮显示「移除中…」读的是同一个
  状态，于是按钮从此一直是转圈的禁用态——点成功了也长得像点坏了。现在进行中的账号只在一个集合里停留
  到本次请求结束，结束后按钮恢复。
- **幽灵成员没有存名字时不再渲染成空行。** 行名回退到它在设置里被索引的 id，用户才能找到并删掉那份副本。

### 构建

- **默认测试套件不再有 skipped。** 旧的 `tests/card-shot.spec.tsx` 是 `CARD_SHOT=1` 才跑的手动截图工具
  （写 `/tmp/card-preview.html`、要靠 headless Chrome 量几何）。它被默认 glob 收集，导致 `pnpm test`
  永远报 **1 skipped**，「全绿」因此不再等价于「全都跑了」。现移到 `tools/card-shot.tsx`（不匹配
  `tests/**/*.spec.*`）、去掉 `describe.skipIf`、新增 `vitest.card.config.ts` 与 `pnpm card:shot`；
  `tools/**/*.tsx` 纳入 `tsconfig.client.json`，仍受 typecheck 保护。

### 测试

- `auth` 两例锁定删除语义：① 「连应用登录一起删（并留下备份）」——断言 `signedOutApps:['cn']`、
  插件副本与桌面登录都不再含该账号、目录里恰有一份 `dsh-backup`、之后再登录会被重新镜像；② 「应用
  运行中拒绝并点名」——断言 `deleted:false` / `blockedApps:['cn']`、桌面文件原样、无备份、插件副本仍被删。
- 新增 `trae-process` 4 例覆盖进程名前缀歧义（只开 `Trae CN` 不误报国际版、只开 `Trae` 不误报 CN 等）。
- `solo-bridge` 3 例锁定 wire 表：给**每一行**都登记 function（含 id 即 config_name 的 `Doubao-Seed-Code`）、
  同名显示名先到先得、目录行缺 function 时借用解析表的 function 且 config_name 不一致时不借。
- `card-pool` 覆盖：删除语义 9 例（无 `deleteSupported` 时不渲染删除、成功落盘与日志、`hadCopy` 两种
  措辞、运行中提示退出应用且不写设置不刷新）、成员移除 6 例、徽标语义 3 例、流式与超时 2 例、日志去重、
  幽灵成员名字回退、无副本行的标签。
- 全仓 **889** 例通过，0 skipped。

## 3.9.2 (2026-10-18)

### 新增

- **批量按钮被禁用时在行内说明原因**：「一键签到所有账号」「一键测试所有账号」变灰时，动作行下方
  直接写出为什么——本机今日已签到 / 面板里没有可解析出的目标模型 / 一个成员都没勾。此前只是一个
  不可点的按钮，看不出缘由。

### 修复

- **签到列不再渲染永远点不动的按钮**：已领取 / 本设备今日已用原本各带一个灰色死按钮，现在只留状态
  文字；账号名册表同样处理（不可再签时渲染文字而不是禁用按钮），信息不丢。
- **池工具行与导入 / 导出区不再各印一遍标题**：两处原本都写了「导入 / 导出账号」，现在是同一行一个
  标题加两个按钮，并去掉多余的分隔线。
- **放弃 / 保存的按钮尺寸**：不再套用行内小按钮的紧凑内边距，显式声明为与卡片其它按钮一致（高度
  32px、13px 字），不再依赖某条规则「缺席」才正确。

### 变更（卡片外观）

- 池成员表下的勾选说明句删除；卡头补回 12px 下边距，表格分隔线不会贴着标题。
- 保存条改与模型区底部同款：左侧「鼓励一下 ★」，右侧放弃 / 保存；其下的面板说明文字删除（三面板
  tab 已写明各自独立）。

### 测试

- 全仓 **849** 例通过（另有 1 例是 `CARD_SHOT=1` 才跑的截图用例，默认跳过）。新增：批量按钮禁用
  原因 3 例、死按钮移除 7 例（断言「按钮缺席 + 状态文字在场」，含名册与池两张表），`card-checkin`
  的 5 例改写为同样的断言方向。

## 3.9.1 (2026-10-18)

> **3.9.0 从未发布到 npm**（发版时卡在 OTP 认证），本版本是同一套账号池功能加上 tag 之后
> 的十三处修正与重排。功能面见下面的 3.9.0 段；这里只列 3.9.0 tag 之后的改动。

### 新增

- **测试请求体积**（`regions.<面板>.pool.probeInputTokens`，默认 `0`）：测速时向上游发多少
  文本。`0` 是**一个词的最小探针**，其余选项 1 万 / 2 万 / 3 万 / 5 万 / 10 万 token。默认
  保持最小而不是「像真实对话」——填多少就扣多少积分，插件没有证据说明 Trae 在小请求上会
  误判，就不该让默认值替你花钱。老 Host 不认识这个字段时，卡片**不渲染这一行**（否则保存
  必然读回失败）。
- **读余额前按需刷新 token**：单个账号的凭证过期后，读它的余额/签到/探针会先刷新一次
  （同一账号并发只刷一次，失败时不重试而是返回旧凭证让上游如实 401）。此前只有「当前
  绑定」的账号会被刷新，池里其他账号过期后余额永远是空的；现在读不到余额的行会明确标
  「登录已失效」，而不是只显示一个 `—`。

### 修复

- **「本机今日已签到」是设备级事实，不是账号级**：Trae 的每日签到绑在 `x-device-id` 上，
  同一台机器第二次签到必被 9095 拒。此前按账号记账，于是池表里第二个账号照样给一个「签到」
  按钮——点了注定失败。现在任一账号当日已领即视为整台机器已用：其余行的按钮禁用、状态写
  「本设备今日已用」，「一键签到所有账号」同样禁用并说明「一台设备一天一次」。
- **无签到面板的行列数错位**：表格换成四列时，行里仍渲染五个格子，动作按钮被挤到第二行。
- **绑定下拉里列出幽灵账号**：设置里存着、本机已无登录的账号没有凭证，选中后什么都不会
  发生；现在从「手动选择计费账号」里剔除（仍留在成员表里可移除）。
- **刷新失败改为五分钟退避**：被吊销的账号每轮轮询都触发两次注定失败的上游刷新。
- **`tokenExpired` 只在真的读不到余额时上报**：不再出现「登录已失效」与有效余额并排。
- **药丸开关只作用于设置行**：它曾被写成全局 `.dsm-trae-switch input`，导致面板 tab 里的
  开关也长成药丸；配色也改用能分清明暗的令牌（此前取到的 `brand-primary` 在浅色主题里近黑）。

### 变更（卡片外观）

- **池区块按参考卡片重排**：顶部只留动作行（一键签到 / 一键测试 / 重新检测），成员表自成
  一张卡（卡头装「已选 N / M」+ 全选 / 清空），每格都是「主行 + 灰副行」，账号管理控件放进
  虚线工具区，保存行移出设置盒并与「鼓励一下」同排。不再有第二张账号表重复同样的名字、
  积分和签到状态。
- **一套尺度**：内边距 14 / 10，圆角 14（面）、10（面内的盒）、999（药丸），字阶 10–14，
  区块用分隔线而不是再套一层框，同一行各格首行对齐。
- **成员状态写成字**：「已在池中」/「未入池」不再只靠勾选框表达；勾选框的 label 只包 input，
  点账号名不会改计费对象。

### 测试

- 全仓 **841** 例通过（3.9.0 tag 时为 809）。新增：`tests/card-shot.spec.tsx`（用真实组件
  渲染成静态页 + 几何审计 + Chrome headless 截图，`CARD_SHOT=1` 才跑，CI 零副作用）、
  尺度守卫（间距变量、圆角白名单）、设备级签到的三条断言（含反向验证：改回按账号即失败）。

## 3.9.0 (2026-10-18)

> **账号池：多账号不再只是「列出来让你手点」。** 本机读完几个账号之后，可以打开一个
> **按规则自动选号、请求失败自动换号**的池（默认关闭）。此前多账号的全部能力止步于
> 「卡片把还有额度的账号列出来，你自己点一下切过去」——额度耗尽发生在一次对话中途时，
> 你只会看到一条失败，然后回去点按钮、再重发。这个版本把「谁付钱」变成一条可以委托给
> 插件的规则，同时**不偷偷替你换计费对象**：池默认关闭，打开它本身就是一次显式选择。

### 新增

- **账号池（逐面板，默认关闭）**：`enabled` / `targetModelId` / `memberAccountIds` 三个字段
  落在 `regions.<面板>.pool`。名单是**显式 opt-in**（默认空，空名单意味着「谁都不服务」，
  而不是「全员」）。

  | 规则 | 为什么是这个顺序 |
  | --- | --- |
  | 先排除不可用 | `credential-rejected` / `plan-gated` / `not-found` 永久出池（这三种都不是「等一会儿就好」）；`rate-limited` / `out-of-credit` / `unavailable` / `failed` 在重试时间后回池；`model-busy` 用 2 分钟短时钟 |
  | 再优先快到期 | 同样是额度，先花掉 3 天内会过期的那部分，否则它过期后等于没拿到 |
  | 然后比可用额度、token 新鲜度 | 额度高者先；同额度取 token 更新者 |
  | 最后按账号 id 兜底 | 排序必须是**全序**，否则卡片与路由器会在两行之间来回抖 |

- **失败换号（真实请求路径）**：一次请求最多试 3 个账号。只有**账号级**失败才换号
  （`authentication` / `hard_credit` / `soft_rate` / `server`）；`not_found` / `client`
  不换——模型 id 写错换号只会把同一个错误烧两遍，还会冤枉一个没机会服务的账号。换号
  仍然失败时，错误消息尾部会带一句**为什么没有别的账号能接**（全部试过 / 剩余全被排除
  + 原因），而不是只留一个裸的上游错误。
- **实盘失败落盘**：换号过程中学到的结论以 `live-request` 探针写进
  `$DSH_HOME/.trae-pool.<面板>.json`（0o600、原子写、永不抛错、**不存任何凭证**），
  卡片能分辨「批量测出来的」与「真实流量告诉我的」。
- **卡片上的池区块**：成员表（草稿勾选框、状态点、当前计费徽标、在池标记、排除原因、
  **通用积分**列并标注 Work 不可花、探针结论 + 相对时间 + 模型作用域、签到列只在支持的
  面板出现、行内测速/移除）、幽灵成员（设置里存着但本机已无登录，仍渲染成可移除的行）、
  「全部签到」与「全部测速」（NDJSON **逐行**返回，跑一个显示一个）、目标模型选择
  （`''` = 自动挑免费模型；已下架的模型单独成一个选项并给「切回自动」按钮）、保存/放弃
  草稿与未保存徽标、活动日志。
- **三条路由**：`POST /plugins/dsh-connect-trae/pool?action=checkin|test|remove`
  （`test` 走 `application/x-ndjson`）。守卫：仅 POST（405）、仅环回来源（403）、池不可用
  （503）、`action` 必须可解析（400）、`accountId` 必须是 24 位十六进制（400，且**在任何
  写入或上游调用之前**校验——这个 id 会进文件名与凭证查找）、空池 409 区分 `no-members`
  与 `no-live-members`、签到不支持的面板 409 `checkin-unsupported`（**在花掉一次只能失败
  的请求之前**）。

### 修复

- **`checkinSupported` 按面板判定**：只有国内版有个人签到活动（国际版与企业版网关直接
  404）。此前没有任何地方表达这件事，卡片只能靠「请求失败」来发现。
- **`toCredits` 补 `endpoint`**：Trae 的额度分 General（SOLO 聊天实际扣的）与 Work（够不到）
  两个桶。池的排序与卡片显示统一用 **General**，此前只能拿到两桶之和——一个 Work 余额很
  大、General 已空的账号会排在一个真能服务的账号前面。

### 测试

- 新增 **5 个文件 / 112 例**：`tests/account-pool.spec.ts`（56：排序全分支、出池规则、
  冷却时钟、`billableMembers`、`resolveTargetModel` 的 stale 不给 id、批处理串行与流式、
  9095 中止整批、落盘合并规则、`parseUpstreamResetAt` 无时区一律 undefined）、
  `tests/account-pool-store.spec.ts`（20：往返/合并/按面板隔离/坏 JSON/版本不符/读时修补/
  文件不含凭证/池文档组装与幽灵成员）、`tests/account-pool-route.spec.ts`（14：五种拒绝、
  坏 id 时上游调用次数为 0、NDJSON 三行、409 两种空池、签到不支持时零次 claim）、
  `tests/account-pool-failover.spec.ts`（12：轮转压倒绑定、清空恢复绑定、**refresh 落在被
  轮转的账号上**、企业店拒绝个人轮转、shim 只在账号级失败换号、三次上限 + shortfall 文本、
  池 hook 抛异常仍正常作答）、`tests/card-pool.spec.tsx`（10：草稿勾选→写 `regions`、
  放弃还原、stale 目标、签到列按能力隐藏、NDJSON 增量渲染、幽灵成员可移除、**以及「区块里
  每个 class 都真有样式规则」**——这条守卫此前只覆盖输入框读数，池区块曾在零 CSS 的情况下
  通过全部行为断言）。
- 全仓 **823** 例通过（3.8.1 为 711）。

## 3.8.1 (2026-10-18)

> **signed-out 不再吞掉账号列表。** 2026-10-18 的现场报告是「本地突然刷不出账号了」：
> 绑定的账号 access token 过期、refresh 被上游 401，这本身是要重登的凭据问题；真正致命的是
> 卡片在 `signed-out` 状态下把整张账号表藏起来、只留一行状态——明明列表里还有一个可用账号，
> 屏幕上却一个都看不见，而唯一能自救的那一下点击（改绑另一个账号）在界面上不存在。
> 本版修复这条恢复路径。3.8.0 从未发布到 npm，所以本版即「3.8.0 全部内容 + 本修复」。

### 修复

- **账号面板 signed-out 时仍列出账号名册**（`src/client/TraeUsageCard.tsx`）：渲染门控从
  `status !== 'signed-in' || accounts.length === 0` 改为 `status !== 'error' && accounts.length > 0`。
  Host 在「有名册但绑定的账号用不了」时回的就是 `signed-out` + 原因 + 名册——三者同一条响应，
  此前名册被状态丢弃。改绑完成后原因仍单独显示在表格下方一行，不再连带吞掉账号行。

### 测试

- 新增 1 例（`tests/card-accounts-table.spec.tsx`）：断言 signed-out 时原因可见、表头与两行都渲染、
  已绑定行标为当前且不重复给按钮、**另一行的绑定按钮点击后确实写入 `accounts.cn`**。
  变异验证：把门控还原成 `=== 'signed-in'`，恰好只有这一例变红。
- 全仓 **711** 例通过（710 + 1）。

## 3.8.0 (2026-10-18)

> **本版未发布到 npm**（tag `v3.8.0` 与 GitHub Release 已建、不可移动；发布被 npm 2FA 的
> PUT 401 挡住）。其全部内容随 3.8.1 一起上线，以下保留原文。

> **国内区多了一个面板：企业版。** 同一张 CN 凭据若属于 `tob_online` 租户，会被两个网关
> 同时服务——消费池扣个人积分，租户池扣企业额度。同一模型、两种付费方，所以「谁付钱」
> 必须由你选，不能由插件猜。同时修好 `config_name` 大小写导致的 `4001`，以及企业网关
> 用 HTTP 200 + `event:error` 拒绝时被当成「这轮助手什么都没说」的问题。

### 新增

- **卡片新增「企业版」面板**：供应商开关从「按区域」改为「按面板」，国内版、企业版、
  国际版三者并列，各有**独立开关、独立账号绑定、独立模型选择**。

  | 面板 | provider | 默认开关 |
  |---|---|---|
  | 国内版 | `trae` | 开 |
  | 企业版 | `trae-enterprise` | **关**（原来两个面板的用户不受影响） |
  | 国际版 | `trae-global` | 开 |

  关掉企业版不会影响国内版；两个 CN 池的模型选择也不再互相覆盖。企业版默认关闭，
  因为纯个人账号用不了企业池——默认放开等于给所有人塞一条一用就失败的 provider。

- **`trae-enterprise`（显示名「Trae 企业版」）**：现在 `cn` 区并列发布两个 provider：

  | provider | 计费池 | 说明 |
  |---|---|---|
  | `trae` | 消费 SOLO | 行为与此前完全一致，永不碰企业网关 |
  | `trae-enterprise` | 企业租户 | **不回落**，失败如实报错 |

  `TRAE_PROVIDER_IDS` 描述每个区发布哪些 id，`routeOfTraeProvider` 把 id 映射到计费池；
  **路由在构建 provider 的客户端时固定**，不存在「按调用猜一次」。shim 为每个 provider
  提供一条 bearer 路由并按 bearer 分派，未知 token 直接 401，不会退回第一条路由。

### 修复

- **计费账号与卡片显示可能不是同一个（本版最重要的一个）**：`accounts()` 从**已经为展示
  过滤过**的列表推导 `selected`，而 `current()` 从**全量**登录里解析真正计费的凭据。
  开着 `hideTenantAccounts` 且企业号排序在前时，两者分歧——卡片高亮个人号，聊天扣企业池，
  而卡片里的 `rescanAccounts` 还会把这个错误绑定**存下来**。现在 `inUse` 拆成两个入参：
  显式绑定走全量（展示过滤不得缩小「用户选的号」的查找范围），无绑定时默认值走过滤后列表
  （隐藏企业号是计费决定，不是展示细节）；`current()` 与 `accounts()` 传同一对参数，
  结构上不可能再分歧，正在计费的账号也永不会被从列表里隐藏。

- **`deepseek-v4.1-flash` 等模型报 `4001`（`param is invalid`）**：网关的 `config_name`
  **区分大小写**，而 Remote 目录给的是小写、网关只认 `DeepSeek-V4.1-Flash`。三处一起修：

  1. `modelConfig` 补上 `wireConfigName`。DSH 设置通道用它重建文档，未声明的字段会在
     **每次保存时被丢掉**——映射一丢，该模型就要等到下一次发现才能用。
  2. `fetchModels` 改为从**客户端所钉的那条网关**读名录。两个池的名录不同
     （`DeepSeek-V4.1-Flash` 只有企业池列），原本钉在企业池的客户端去读消费池名录，
     永远发现不了自己池的独占模型。
  3. `TraeSoloBridge` 查表改为大小写不敏感，映射都落空时退回目录行自己的 id。

- **企业网关的拒绝形态**：它是 **HTTP 200**，但首帧是 `event:error`（`code 4001`）。
  现在会被转成真正的客户端错误，正常流则逐字节重放给调用方——否则拒绝会表现成
  「这一轮助手什么都没说」。

- **企业网关要求每次调用带 `session_id`**，而消费网关会拒绝带它的请求体，所以只在该路由上加。

### 自测

- 企业版相关新增 **38** 项（`enterprise-provider` 17、`card-enterprise-panel` 9、auth 租户
  作用域 4、web-status 过滤 3、catalog 费率 1、solo-bridge 错误码 1……详见 PR 描述第 3 节）。
  覆盖按 bearer 分派、`session_id` 只在该路由、200/`event:error` 识别、流原样透传、
  名录按路由读取、大小写映射与 schema 往返、租户账号作用域、4222 可读等。
- 计费一致性新增 2 例：`accounts()` 里 `selected` 的那一行必须就是 `current()` 计费的那个账号；
  被隐藏的账号正在计费时仍须留在列表里。两例在修复前均变红（`expected 'tenant-user' to be 'personal-user'`）。
- 用真实 `tob_online` 帐号实测：企业路由返回 PONG、带 `session_id`、个人 `consumed_amount` 不变。
- 全仓 **710** 例通过，双 tsconfig 类型检查通过。

## 3.7.1 (2026-10-18)

> **对齐 DSH 0.2.1-rc.2，并把发布后核验收敛为一条命令。** 宿主 rc.1 → rc.2 对本插件消费的
> API 是**零变化**（逐字节核对确认），所以本版没有行为改动——它做的是两件事：把开发树钉到
> 用户实际运行的那份宿主上，以及让「npm 上的包是否等于 tag 指向的源码」不再依赖手工核对。

### 变更

- **对齐宿主 DSH 0.2.1-rc.2**：13 个 `@deepseek-ai/dsh-*` devDependency 从 `0.2.1-rc.1`
  推进到 `0.2.1-rc.2`。`cordis` / `schemastery` / `pi-ai`（仍 `1.1.0`）均未变。
- **peer 范围无需改动**：`0.2.1-rc.2` 对 `>=0.1.7-rc.1 <0.3.0-0` 已判通过（实测）。

### 新增

- **`pnpm run verify:release`**（`scripts/verify-release.mjs`）：把 RELEASING.md 第 8 步
  从手工核验变成一条命令，21 项检查一次做完 —— tag 版本、tag 之后的提交、工作树状态、registry 收录、
  `latest` 指向、**发布包每一个文件**与 tag 逐字节比对、`lib/` 由 tag 源码重建后比对。
  退出码即结论：`0` 一致 / `1` 不一致 / `2` 前置条件不满足。

  > 手工版本的三个已知盲点被闭合：核对清单只写了 8 个文件而发布包有 15 个
  > （`icons/`、`docs/assets/`、`scripts/verify-windows.mjs` 从未被核对）；
  > 拿本地 `lib/` 当基准会掩盖「构建自未提交工作树」；`git show` 默认按 UTF-8 解码，
  > 把 PNG 当文本会得到假的不一致 —— 本脚本第一版就踩了这个坑，三个图片文件全部误报。

### 文档

- RELEASING.md 第 8 步改为脚本优先，手工等价步骤保留在折叠区并注明其局限。
- **新增 `docs/PENDING_CHANGELOG.md` 暂存机制**：`CHANGELOG.md` 是随包文件，在已发布的 tag
  之后改动它会让 `verify:release` 正确地报「tag 之后改动了发布内容」。未发布版本的条目因此
  暂存在 `docs/`（`docs/*.md` 不进包），发版时并入 CHANGELOG 再删除。RELEASING.md 第 3 步
  已加入对应指引。

### 测试

- `tests/dsh-peer-range.spec.ts` 的 `MUST_ADMIT` 补入 `0.2.1-rc.1` / `0.2.1-rc.2` / `0.2.1`。
  此前这份「必须放行的版本」清单里**没有当前正在使用的版本**——范围若被误收窄到
  当前宿主之外，测试仍会全绿。变异验证：把上界改到 `<0.2.1-rc.2` → 对应用例立刻变红。
- 新增 7 例（`tests/verify-release.spec.ts`），用 PATH 上的假 `npm`/`tar` 提供受控发布包，
  子进程跑**真脚本**：一致→0、篡改→1、多出文件→1、无 tag→2、未发布→2、二进制逐字节比对、
  tag 之后有提交仍→0。
- **变异验证**：把 `git show` 改回 UTF-8 解码 → 2 例变红；让比对恒返回「一致」→ 1 例变红。
- 全仓 **670** 例通过。

### 已核对确认无变化

- 逐字节比对插件消费的宿主包（`.d.ts` 与 `lib/*.js`）——`dsh-llm`、`dsh-llm-pi-ai`、
  `dsh-settings`、`dsh-host-webserver`、`dsh-atomic-write`、`dsh-home-paths`、
  `dsh-attachment`、`dsh-client-ui-renderer`，以及 `dsh-app-boot` 的 peer 门禁：**全部相同**。
- pi-ai 仍为 `1.1.0`，`openai-completions.js` 与 `utils/transcript.js` 未变，
  上一轮的双向适配结论原样成立。
- 线上请求体探针在真实 rc.2 栈上复跑，结果与 rc.1 一致。


## 3.7.0 (2026-10-17)

> **对齐 DSH 0.2.1-rc.1。** 宿主把 `@earendil-works/pi-ai` 从 `^0.85.1` 抬到 `^1.1.0`，
> 这是 0.2 线里唯一有行为影响的变更。本插件的请求体**没有**回归——但那是靠 3.4.2 的双向适配
> 兜住的，本版把这条结论从「推理」变成「被测住的对照」。

### 变更

- **开发树对齐宿主实际随包版本**：13 个 `@deepseek-ai/dsh-*` devDependency 固定为 `0.2.1-rc.1`，
  `cordis` → `^4.0.5`，`schemastery` → `3.18.5`（`pnpm-workspace.yaml` 的 override 同步抬升），
  `@earendil-works/pi-ai` → **`1.1.0`（精确固定，不用 `^`）**，使本地 typecheck 与测试
  跑在与用户**字节一致**的契约上。
- **`@earendil-works/pi-ai` peer 上界收窄为 `<2.0.0`**：原先 `>=0.85.1` 无上界，会默默放行
  未审阅的 2.x。两端均已实测（0.85.1 ✅、1.1.0 ✅、1.3.0 ✅、2.0.0 ❌）。

### 修复

- **pi-ai 1.1.0 的类型契约**：1.1.0 把 `ProviderStreams` 的第二参改成带 `unique symbol`
  品牌标记的 `TranscriptContext`，只有 `normalizeContext()` 能产出，于是 `withContextAdaptation`
  在两处调用点报 `TS2345`（升级后才暴露，0.85.1 下类型可通）。适配层本来就在归一化器
  **下方**、且旧代分支**必须**产出无品牌形状，所以在这唯一一条边界上做显式转型，
  并在 `src/adapter.ts` 与测试侧 `send()` helper 处写明理由。

### 测试

- 新增 **线上请求体矩阵**（`tests/pi-ai-context.spec.ts`）：起一个真实 SSE 端点，走
  `createProvider` + 真实 `openAICompletionsApi()`，断言线上 body 里 `roles[0] === 'system'`、
  system 文本等于原提示、`tools` 长度为 1；并覆盖「已归一化输入不二次包裹」的幂等性。
- 新增 **反向对照**：**不**套适配器时，现代副本会把提示与工具全部丢光（`roles: ["user"]`、
  `system: null`、`tools: 0`，且**不报错**）——这条钉住适配器为什么是承重的。
- 全仓 **663** 例测试通过（原 660 + 3），双 tsconfig 类型检查通过，构建通过。

### 已核对、无需改动

- **peer 范围**：DSH 用 `satisfies(runtime, range, { includePrerelease: true })` 求值且只校验
  `@deepseek-ai/dsh*`，`0.2.1-rc.1` 对 `>=0.1.7-rc.1 <0.3.0-0` 已判通过（实测）。预发布悬崖
  只在**默认选项**下成立，不适用于本插件的门禁。
- **宿主 API**：`dsh-llm` / `dsh-settings` / `dsh-host-webserver` / `dsh-llm-pi-ai` 消费点签名未变。
- **客户端外壳**：产物仍只 `require` react / react-dom / react/jsx-runtime，槽位与主题令牌未变。

## 3.6.1 (2026-10-16)

> **「自动续期」不再是一句没有期限的承诺。** 卡片现在会告诉你**刷新令牌**何时到期 ——
> 在那之前访问令牌会自动续期，在那之后自动续期就彻底停了，必须重新登录一次 Trae。

### 修复

- **刷新令牌的到期时间对用户完全不可见（issue #37 追问引出）**：
  - **问题**：卡片一直只写「访问令牌 {时间} 过期（自动续期）」。这句话是对的，
    而且一直对 —— 直到**刷新令牌**到期的那个瞬间，自动续期就永久停止了。
    一个读了几个月「自动续期」的用户，没有任何理由预期这件事。
  - **根因**：刷新令牌的到期时间**被解析了、也被存下来了，但从来没送到浏览器** ——
    状态接口里根本没有这个字段，所以卡片无从显示。
  - **现在**：状态接口暴露刷新令牌到期时间，卡片**按账号**在临近到期时给出一行提示：
    - 剩余 **30 天**以内 → 提醒（警告色），写明**到期时间**与**还剩几天**；
    - **已到期** → 明确说明「自动续期已停止」，并给出恢复方式（重新登录一次 Trae）；
    - **还很久 / 没有该字段**（CLI 凭据本身不带）→ **不显示任何东西**。
      健康的令牌不该在每一行都占一行文字，伪造的期限比不显示更糟。

  > 这条不是理论问题：我们在排查 `#38` 时**亲身遇到过** —— 某区域插件自存的凭据访问令牌已过期，
  刷新也返回 401，而卡片上一直写着「自动续期」。当时只能靠人肉发现。

### 测试

- 新增 5 例覆盖三种状态与两个边界（健康不显示、临近显示截止日与剩余天数、已过期显示错误态、
  无该字段不伪造、最后一天仍算「未过期」）。
- **变异验证**：去掉 30 天提醒窗口 → 2 例变红；在缺少字段时伪造一个期限 → 1 例变红。
- 全仓 **660** 例测试通过，类型检查通过。

## 3.6.0 (2026-10-16)

> **多个账号可以并存了。** 本版新增**账号导入 / 导出**：不再需要每次把某台机器的登录凭据
> 手工写进默认路径来顶掉上一个账号 —— 导出一份 JSON、在另一处导入即可。同时补上
> `#39` 那条诊断：上游没下发 function 配置时，报错不再读起来像本地故障。

这是一次 **minor** 升级（新增用户可见的界面与能力）。

### 新增

- **账号导入 / 导出（issue #37）**：账号区新增一行「导入 / 导出账号」，
  - **导出**：勾选若干账号 → 下载一个 JSON 文件（`trae-accounts-YYYY-MM-DD.json`）；
  - **导入**：选择文件 → **脱敏预览**（只显示账号标识与「是否有 Token」，不显示凭据）→ 勾选 → 导入；
  - 文件格式与同族 `dsh-connect-workbuddy` **互通**（顶层 snake_case：`access_token` / `refresh_token` /
    `uid` / `nickname` / `domain` / `expiresAt`(毫秒) / `refreshExpiresAt` / `auth_raw`），
    所以两边导出的文件可以互相导入。
  - **顺带把存储升级成多账号**：本插件原先每个区域只保存**一个**凭据，导入的第二个账号无处可放。
    现改为**每区域一个文件保存凭据数组**（格式版本 1→2），**旧文件仍可读**、在下一次写入时自动升级。
  - 导入按钮在**未登录时也可用** —— 一台从没登录过的机器，正是最需要导入别处导出的文件的时候。

  > **区域门禁是正向匹配**：导入文件里的 `domain` 是文件作者可控的值，而本插件「认不出就当作国内版」
  > 的规则对**上游下发**的数据是对的、对**导入文件**是危险的（伪造域名会被塞进国内版）。
  > 因此导入走一条**只认正向识别**的通道：空值、认不出的值、以及明确属于另一区域的值一律**跳过并计数**，
  > 绝不静默落库。国内版与国际版是两个并行的供应商栈，跨区导入会导致跨区计费。

### 修复

- **修复一个会导致账号丢失的写入缺陷（本次实现导入功能时发现）**：本插件的刷新路径原先把
  「刚刷新好的那一个凭据」当作**整个文件**写回。在单凭据时代这没问题；一旦一个区域能保存多个账号
  （正是导入带来的），**刷新一个账号就会把同区域的其他账号全部删掉**。
  已改为**读-改-写**：只替换被刷新账号自己那一条，其余条目原样保留。回归测试专门钉住了这一点。

- **上游未下发 function 配置时，报错读起来不再像本地故障（issue #39）**：
  - 报告者遇到的现象是每次调用都返回 `2001 no function config found for appId=…`，
    他据此排查了一圈本地凭据与插件版本，最后才发现问题在服务端 —— 上游的
    `get_detail_param` 当时对**每个** SOLO function 都返回空的 `config_info_list`，随后**自行恢复**。
  - 现在（a）`2001` 有了明确文案：**「上游尚未下发本通道的 function 配置（这是上游侧的状态，
    不是本地凭据或配置问题）」**；（b）当**所有** function 都返回 200 却一条配置都没有时，
    目录读取会抛出专用的 `TraeEmptySoloDirectory`，把「上游没下发」与「所有 function 都请求失败」
    区分开。两者都不暗示需要重新登录，因为这个条件是**会自行恢复**的。

### 测试

- 新增 4 个测试文件、共 34 例：导入导出格式（解析 / 脱敏预览 / 往返 / 区域门禁）、
  导入路由（HTTP 边界上的伪造区域拒绝、导入前重新解析文件而非信任预览）、
  存储升级与**刷新不吞账号**、以及端到端的「一处导出 → 另一处导入」。
- 区域门禁做了**变异验证**：把门禁改成 fail-open（正是同族插件 `#42` 修过的那个缺陷）后，
  格式层与路由层**各有用例变红**；把毫秒单位改成错误的换算同样被抓住。
- 全仓 **655** 例测试通过，类型检查通过。

## 3.5.1 (2026-10-16)

> **DeepSeek-V4 四个模型行不再必然报 4001。** 本版修一处 wire 名单合并的方向错误：
> 同名的多行里，旧代码让**最后**一行取胜，于是一个元数据残缺的小写尾行抢走了展示名，
> 桥接层把 `config_name` 改写成了上游不认的小写拼写。改为**每张映射表先到先得**后，
> 规范行留在原位，不再发生任何改写。

### 修复

- **DeepSeek-V4 四行（`DeepSeek-V4-Flash` / `-Flash-Official` / `-Pro` / `-Pro-Official`）选中发送必报 4001**（issue #38）：
  - **上游名单的形状**：CN 区 wire（`get_detail_param`）把同一族列了**三行**，共享同一个展示名，其中尾行是
    元数据残缺的小写行 —— `DeepSeek-V4-Flash` 展示名同时对应 `DeepSeek-V4-Flash-Official`、
    `DeepSeek-V4-Flash`、`deepseek-v4-flash` 三个 id；`DeepSeek-V4-Pro` 完全同构。
  - **改坏它的那一步**：`mergeTraeModelSources` 用 `wireByName.set(...)` / `wireById.set(...)`
    **无条件写入**，所以后到的那一行会覆盖先到的同名键。尾行的 `name` 正好是小写 id，
    于是 `displayKey("DeepSeek-V4-Flash")` 被它抢占，桥接层据此把 `config_name` 改写成
    `deepseek-v4-flash`，上游回 `4001 the param is invalid`。
  - **为什么 `-Official` 行也一起废**：`TraeSoloBridge` 在 catalog 取不到 `wireConfigName` 时
    会退回 `wireResolver(entry?.name)`，而 `entry.name` 同样是 `DeepSeek-V4-Flash`，
    于是又落到那一行上 —— **两行一起废**。
  - **修法**：两张映射表都改成**先到先得**（`if (!map.has(key)) map.set(...)`）。
    `displayKey("DeepSeek-V4-Flash")` 于是命中 id 完全相同的规范行，该行的 `config_name`
    本就是 `DeepSeek-V4-Flash`（与展示名一致），**不再发生改写**。
  - **本机 CN 实测**（插件真实请求形状 `{messages, model, config_name, function, stream}`）：
    - 修前：`DeepSeek-V4-Flash` → 发出 `deepseek-v4-flash` → 流内 `4001`；`DeepSeek-V4-Pro` 同；
    - 修后：四行发出 `DeepSeek-V4-Flash` / `DeepSeek-V4-Pro`（`-Official` 两行发出自身 id）→ **HTTP 200 + 完整正文**；
    - 对照探测：大写能通、小写必 `4001`，`glm-5.2` 作基线正常 —— 证实「号码牌本身是好的，是被改写坏的」。

  > 注意：`4001` 是**流内** `event:error`（外层 HTTP 仍是 200），所以只看状态码会把它误判成成功。

### 测试

- 新增 2 例回归：`mergeTraeModelSources` 在「同名 + 尾行小写」的 wire 上必须让规范行取胜；
  以及「按展示名 join」在改为先到先得后仍然生效（防止过度修正）。
  两例在旧代码上均失败、在新代码上通过。
- 全仓 **619** 例测试通过。

## 3.5.0 (2026-10-14)

> **积分读数不再只有一个固定位置。** 本版向同族 `dsh-connect-workbuddy` 学来它的 issue #62
> 修法：把「读数显示在哪里」做成每个区域一个选项，默认值与升级前完全一致。

### 新增

- **输入框读数的显示位置可选：输入框工具栏 / 输入框下方**（学自 `dsh-connect-workbuddy` issue #62）：
  - **为什么需要**：那个位置本身是脆的。`conversation.input.left`（输入框工具栏）是一个**共享的 list 插槽**，
    外壳自己的控件和**任何其他 bundle** 都注册在那里，而 list 插槽**无法保证每个占用者都可见** ——
    同族的报告者装了第三方插件（`dsh-auto-continue`）之后，积分读数就**整个消失了**。
    本插件其实已经因为这个原因丢过一次这行读数：它早年放在**侧边栏底部**，那是一个共享的**根级行**，
    与 `dsh-connect-workbuddy` 的两行并排时被挤成只剩一个「Tr」的残片（2.12.0 才迁到输入框工具栏）。
    **同一个坑踩了两次，这次把位置交给用户。**
  - **两个席位**：
    - `composer`（**默认**）—— 输入框工具栏 `conversation.input.left`，与模型选择同一行，即现在的样子；
    - `stats` —— 输入框下方 `conversation.composer.dock`，外壳自己渲染「轮次 / 步数 · tok/s · token ·
      缓存命中」那一行；`order: 10` 排在 shell 统计**之后**，所以官方那几颗统计仍在最左，读数是**追加**而不是顶替。
  - **判定顺序：归属 → 区域开关 → 显示开关 → 席位。** 席位排在**最后**，所以一个被关掉的区域在
    **两个席位都不渲染**，而不是先在非当前席位画一帧再被拒。

### 修复

- **区域被关闭后，它的积分读数仍在输入框工具栏里渲染**（本次移植时由新守卫发现）：
  - 把某个区域的供应商关掉时，Host 会把该区域的 adapter 路由与可配置供应商条目**一并撤下**，
    模型选择器里也不再有它 —— 但 gate 只检查了「显示积分」那个开关，**从未检查区域开关**。
    于是一个已被关闭的区域只要模型投影还指着它的 provider，读数就会继续画在那里，
    并且它的取数请求注定失败。
  - 现按 Host 的同一套 opt-out 规则（`regionEnabledOf`：只有显式 `false` 才算关闭）在 gate 里补上这一判。
    这与卡片上那个区域开关**用的是同一个 reader**，所以卡片和 gate 不可能对「这个区域开没开」产生分歧。
  - 同族的 gate 一直有这一判，是本插件漏了。

### 设计取舍（两条，都写下来免得后人改回去）

- **两个席位都无条件注册，决定权在 gate 里一处**（席位不符就 `return null`）。
  若改成「按设置只注册当前席位」，则每次改设置都要**重新注册插槽** —— 而本仓库的文件头已经写明
  这种绑定是脆的（rc.6→rc.7 的 `id`/`order` → `key`/`priority` 改名就是同类问题），
  且用户是「一边看着结果一边改」的。现在改设置只是一次 settings 写入。
- **卡片控件读的是设置文档，不是 Host 的 usage 应答**（这里**故意与同族不同**）。
  同族那样做是因为它的 0.1.7 部署上浏览器设置镜像**实测是过期的那份**；本仓库没有复现到这种过期，
  而读镜像才能让控件**首帧就是对的** —— 只靠 usage 文档喂值的控件会先停在默认值上等一次网络往返，
  这正是「看起来没生效」的观感。这一点有守卫钉住（见下）。

### 测试

- **+19**（全仓 **598 → 617**）：
  - `tests/credit-position.spec.tsx`（新增 13 例）：默认 `composer`（含设置存在之前的 profile、
    手改的未知值 `'sidebar'`）；**按区域**而非全局读取；整段设置与裸 `regions` 映射两种入参都接受
    （传错形状在本卡片上真的出过货）；写入只改该区域该字段（模型列表 / 预算 / enabled / 兄弟区域都不动）；
    席位与两个开关相互独立；gate 在**指定席位渲染 / 另一席位渲染 0 个 / 两个席位都不渲染（隐藏或区域关闭）/
    别的 provider 两个席位都不渲染 / 按会话所指区域取席位（CN 与 AI 各在各自席位）**；
    以及 Host 侧 `creditPosition()` 与浏览器侧 `regionCreditPositionOf()` **两边答案一致**（含 schema 默认值）。
  - `tests/card-composer-credits-switch.spec.tsx`（新增 6 例）：控件默认值、**跟随标签页切换**
    （按区域而非一个全局值）、写入是**整槽合并**（不丢模型选择、不动另一个区域）、
    区域关闭时**禁用而不是隐藏**（控件消失会读成功能没了）、与显示开关相互独立（隐藏后仍保留所选席位）、
    只读 scope 拒绝写入。
  - `tests/client-activation.spec.tsx`（更新 2 处 + 新增 1 条断言）：插槽清单由 3 个变 4 个，
    并**钉住两个席位的 slot id 互不相同** —— 两个注册共用一个 id 会让后一个静默替换前一个，
    于是设置能选到一个已不在册的席位、读数反而彻底消失（正是本特性要修的那个缺陷）。
    测试替身原先只认 `key` 字段，现在同时认 `id`/`key`（真实的 0.1.7 注册表两者都用），
    否则一条关于 slot 身份的新断言会静默读到 `undefined` 而假绿。
  - **变异验证**（各自变红后恢复）：删掉 gate 的席位判定 → 4 例红；把读取的默认值去掉（升级前的 profile
    读成 `undefined`）→ 4 例红；只注册一个席位 → 2 例红；控件不读所存席位 → 2 例红。
  - 构建产物核对：`lib/client.js` 内两个插槽名与两个 slot id 均在。

## 3.4.3 (2026-10-13)

> **保存模型列表时终于有了「正在进行」的反馈。** 本版对齐同族 `dsh-connect-workbuddy` 4.4.2
> 对忙碌遮罩做的修正（该处修的是同族共有的缺陷），并把当初核实过的依据一并带过来。

### 新增

- **保存 / 写设置时有一层忙碌遮罩**（新增 `src/client/BusyOverlay.tsx`，共用组件）：
  - **此前完全没有。** 保存状态只表现为控件变灰加按钮文案从「保存」变「保存中…」——
    用户盯着某个具体行等它落地时，屏幕上没有任何「正在进行」的迹象。
  - 遮罩由卡片的**两条**写路径共同驱动：`saveModels` 的 `saving`（保存模型列表）与
    `writePreference` 的 `savingSettings`（跟随登录 / 输入框读数两个开关）。
  - 遮罩在该写路径的 `finally` 里随忙碌标记一起落下，也就是 **Host 重读落地的时刻**——
    延迟从「看不见」变成「看着它发生」。

### 修复

- **遮罩的配色与动效改用宿主自己的令牌与节奏**（对齐同族 workbuddy 4.4.2）：
  - **遮罩卡片底色**若沿用同族的旧值 `--dsw-alias-bg-primary`，那个变量**在宿主令牌集里根本不存在**
    （实测宿主 bundle 零命中；宿主只有 `bg-base` / `bg-layer-1..3` / `bg-module-platform` / `bg-overlay` 等），
    于是一路回退到写死的近黑 —— 卡片变成一块黑板子，上面的字看不清。现改用宿主给弹层用的
    `--dsw-alias-bg-layer-2`，亮暗两套主题各自成立；阴影也从手写的 drop shadow 换成宿主的
    `--dsw-elevation-prominent`。
  - **遮罩底色**原写死 `rgba(0,0,0,.38)`，既不跟随主题、也没有宿主的模糊。改用宿主自己遮罩用的
    `--dsw-alias-bg-mask-1`（亮 `.24` / 暗 `.5`）+ `--dsw-mask-blur`，与外壳里其他遮罩一致。
  - **提示行**用 `label-secondary` —— 原先的 `label-tertiary` 是宿主最暗的一档
    （亮 `neutral-bluish-600`、暗 `neutral-bluish-400`），给元数据用的，不该承载一句要等的人必须读的话。
  - **spinner 换成宿主同款弧线**。此前那种 18px 的 CSS border 环、`.7s` 匀速转，比宿主自己的状态
    转圈（`_dsh-state-dot-spin`：SVG 弧线 + dash 呼吸、`1.5s`）快了近一倍 —— 比起形状本身，
    **这个速度差才是它看着廉价的主因**。现按宿主 bundle 实测到的几何逐条对齐：
    `viewBox 0 0 20 20`、`r=8`、`stroke-width 2`、track `opacity .25`、弧线 `stroke-dasharray 12 150`
    与 dash 呼吸、`1.5s`、`currentColor` 继承所在层级；reduced-motion 降级为**静态弧线**
    （与宿主降级方式一致），并补 `aria-hidden`，免得 `role="status"` 之外多报一次。

### 测试

- **+4**（`tests/card-styles.spec.tsx` 5 → 9，全仓 **594 → 598**）：
  - 遮罩选择器守卫：逐条钉住五个遮罩规则，且要求整条 `{` 结尾匹配，避免改名前缀后被子串误判为存在。
  - 弧线节奏守卫：钉住 `dsm-trae-veil-dash` 关键帧与 reduced-motion 降级，防止退回到自绘 border 环。
  - **渲染守卫（唯一能证明「遮罩真的出现」的断言）**：jsdom 不做层叠，前几条都只证明样式表里有这些
    名字。这条在 `scope.set` 挂起的条件下点「跟随 Trae 当前登录的账号」，断言遮罩确实进 DOM
    （`role=status` / `aria-busy=true` / `aria-live=polite`）、文案为 `row.veilSaving`、弧线与卡片都在，
    写盘落地后卸载。
  - 令牌白名单补三条（`--dsw-alias-bg-mask-1` / `--dsw-mask-blur` / `--dsw-elevation-prominent`），
    三者均经宿主 bundle 实测存在。白名单断言「大小必须等于实际用到的令牌数」，遮罩引入新令牌后必须同步补齐。
  - 变异验证（各自变红后恢复）：把 `.dsm-trae-veil{` 改成 `.dsm-trae-veilz{` → 仅选择器守卫变红；
    把 `visible={saving || savingSettings}` 改成 `visible={false}` → 仅渲染守卫变红。
  - **一处诚实记录，不夸大守卫能力**：本仓库的 `vite/oxc` 与 `tsdown` 比 workbuddy 严格，模板字符串被
    反引号截断后会**直接报解析错误**（构建同样失败），所以「顶层语句数」那条截断守卫在本仓库
    不会比它们更早报警。真正拦不住截断的是 `tsc`（实测被截断的文件 `tsc` 仍 `exit 0`）——
    这正是同族当初能静默中招的原因。那条守卫作为「解析器不再拦时的兜底」保留。

### 文档

- 无。本版只含上述新增、修复与配套测试。

## 3.4.2 (2026-10-13)

> **插件现在与它自己解析到的那份 `@earendil-works/pi-ai` 代数对齐了**——这是 [issue #27](https://github.com/dingminhua/dsh-connect-trae/issues/27)
> 的修复。起因是报告人用任意模型都拿到 `PI_AI_ERROR / Cannot read properties of undefined (reading 'length')`，
> 且 usage 恒为 0：崩溃发生在**请求发出之前**的本地 token 估算里，所以既与模型无关，也看不到任何 HTTP 痕迹。
> 取证见 `docs/ISSUE27_DIAGNOSIS.md`。

### 修复

- **插件现在会在两种上下文形状之间双向适配，而不是把宿主的形状原样交给自己的 api**（issue #27）：
  - **原行为**：`createTraeAdapter` 把 `openAICompletionsApi()` 直接交给 `createProvider`，没有任何适配层。
    插件声明 pi-ai 为 peer（`>=0.85.1`），所以它解析到哪一份**由安装环境决定**，未必是宿主那一份。
  - **为什么这是必崩**：pi-ai **0.86 起**在每个公开入口调一次 `normalizeContext()`，于是 provider 收到的是
    *归一化 transcript*：`{ messages: [ { role:'system', content:<字符串>, toolsAdded }, … ] }`——系统提示与工具声明
    **只**挂在这条 system 消息上，顶层 `systemPrompt` / `tools` 已被删除。而 ≤0.85 的 `estimateMessageTokens`
    **没有 `role === 'system'` 分支**：它 `for (const block of message.content)` 迭代一个**字符串**，逐字符拿到
    `block`，再读 `block.name.length` → `TypeError`。因为这一步位于 `buildBaseOptions` 内、早于任何 HTTP 构造，
    所以现象就是「105ms 内本地崩溃 + usage 恒 0 + 换模型无效」。
  - **两个方向都要修**，因为 **DSH 自己也横跨两代**（`dsh-llm-pi-ai` ≤0.2.0-rc.1 声明 `^0.85.1`，0.2.0-rc.2 起声明
    `^0.87.1`，0.2.1-alpha.2 已到 `^1.0.2`），而本插件声明支持 `>=0.1.7-rc.1 <0.3.0-0`：
    - **新宿主 + 旧库**（issue #27 本尊）：必崩。
    - **旧宿主 + 新库**：不崩，但现代 api 只从 system 消息读提示与工具，顶层字段被**静默忽略** → 系统提示与
      **全部工具声明**丢失（模型永远不会产生 toolCall）。只修前者会把一个响亮的故障换成一个安静的故障。
  - **改后**：新增 `withContextAdaptation(api, generation)`，按**本插件自己解析到的那一代**决定折返方向；
    两个适配函数都以**形状**做幂等短路（普通路径返回同一个对象，零分配）。
    - `adaptLegacyPiAiContext`（transcript → 旧形状）：把 system 文本提升为 `systemPrompt`，并把
      `toolsRemoved`/`toolsAdded` **按序回放**成顶层 `tools`——工具那一步不能省，`normalizeContext` 之后它是
      工具声明的**唯一**载体。
    - `adaptModernPiAiContext`（旧形状 → transcript）：把 `systemPrompt`/`tools` 提到一条首部 system 消息上，
      并移除顶层字段，避免后续的形状判据误判。
  - **提示文本的三条载体都要搬，`sections` 不能漏**：新代 `SystemMessage` 的提示文本有 `content` 与
    `sections` 两条载体（`Record<string, string | null>`），库自己的 `getSystemMessageText` 是
    「`content` + 全部非 null section」按空行连接。只读 `content` 会让以 section 形态到达的提示整体折成
    `undefined`——与该适配器要防的「静默丢失」完全同类。现已逐字对齐库的语义（`content` 在前、
    按声明顺序接 section、跳过 `null`）。
  - **折上的语义与 `normalizeContext` 逐字对齐，包括「混合形状」**：当上下文**同时**带顶层字段和
    system 消息时（部分归一化的宿主），pi-ai 自己的做法是**前插**（于是有两条 system 消息，provider 再按
    空行折叠），本插件因此同样前插。实测该输出经真实 0.87.1 的 `resolveTranscript` 折叠后，与
    `normalizeContext` 的结果**逐字相同**。早先版本在混合形状下直接原样返回，会静默丢掉顶层提示与其
    工具——这条是评审的变异测试暴露的（见「测试」）。
- **代际判据落在 0.86，不是 0.87**（issue #27）：
  - 报告与兄弟插件的既有实现都按 `>= 0.87 → modern` 划分。实测**真实边界是 0.86.0**——
    `dist/utils/transcript.js`、`normalizeContext`、估算器的 system 分支、以及「不再读 `systemPrompt`/`tools`」
    四件事**同时**出现在 0.86.0。
  - **为什么这个偏差有害**：若插件解析到 **0.86.x**，`>= 0.87` 的判据会把它当旧代而执行折返，而 0.86+ 的 api
    根本不读顶层字段 → 系统提示与全部工具被静默丢弃。即「照抄现成实现」反而会引入一个新的静默故障。
- **新增 `src/pi-ai-runtime.ts`：世代探测不依赖版本号字符串**（issue #27）：
  - 主判据是解析到的那份包 manifest 的版本，用**数值**比较（`major > 0` 或 `minor >= 86` 即现代），
    因此 `0.9.0` 不会被误判为高于 `0.86.0`，已发布的 `1.x` 也无需改动即可正确归类。
  - 版本读不到时退化为**包布局**判据（`dist/utils/transcript.js` 是否存在）。
  - **刻意不使用 `import.meta.resolve()` 做能力探测**：bundler 风格的解析器（vite，以及在它之上的 vitest）
    会把 exports map 里的 `"./utils/*"` 通配符展开成路径**并直接返回，不检查文件是否存在**，于是对 0.85.1
    也回答「有」——实测该假阳性会把 0.85.1 判成 modern，从而**在声称按能力判断的同时放过 issue #27**。
    读包目录则不会被这样骗过。
  - 解析不到 pi-ai（宿主外探测的市场安装）时取 `modern` 透传：每个做归一化的宿主都同时提供现代代，
    且透传不可能破坏一个本来就正确的上下文。

### 诊断

- **启动时打印解析到的 pi-ai 版本与代数**（issue #27）：混代安装是「安静坏掉」的那一类，日志里一行
  `dsh-connect-trae: pi-ai 0.85.1 (legacy generation)` 让它在下次出现时立刻可见，而不是只表现为一次崩溃。

### 测试

- **全仓 549 → 594（+45）**：
  - `tests/pi-ai-context.spec.ts`（38 例）：代际判定（含 0.86/0.87 边界、数值排序、`1.x`、不可读版本）、
    `decidePiAiGeneration` 的三条分支（含本机**永不可达**的「什么都没探测到」——市场安装的默认答案，
    必须显式钉住）、折返（提示提升、**工具提升**、`toolsRemoved`/`toolsAdded` 顺序回放、既有顶层 `tools`
    权威、空文本 system 消息只丢文本不丢工具、文本块、**`sections` 三条载体**、混合形状、畸形输入）、
    折上（提升、移除顶层字段、幂等、空提示、**混合形状前插**）、
    `withContextAdaptation`（两个入口都适配、同形状透传为**同一对象**、保留 `fetchDeferred` 等其余字段），
    以及**对真实解析到的那份 pi-ai 的集成对拍**：`estimateContextTokens` 不抛错、`convertMessages` 后
    `messages[0].role === 'system'` 且 `tools` 仍在。
  - `tests/pi-ai-adapter-wiring.spec.ts`（7 例）：**接线层**用例。上面那批函数级用例在把适配层从工厂里删掉后
    **依然全绿**（已用变异验证），正是「函数没问题、只是没人调用」这一原始缺陷的形状；本文件 mock 掉
    `openai-completions.lazy`，经 `adapter.current() → piProvider → streamSimple` 走真实装配路径断言交付给
    api 的形状。
  - **变异验证 8 次，8 次全部被抓**（①–⑤ 为自查，⑥–⑧ 由独立评审提出）：
    ① 工厂里移除适配层 → 5 例失败；② 折返只搬 prompt 不搬 tools → 6 例失败；③ 边界写成 `>= 87` →
    1 例失败；④ 折上时不移除顶层字段 → 2 例失败；⑤ 折返不做幂等短路 → 5 例失败；
    **⑥ 折返忽略 `sections` → 2 例失败**；**⑦ 折上跳过多 system 消息的混合形状 → 1 例失败**；
    **⑧ 不可探测时默认 `legacy` → 1 例失败**。恢复后 57 文件 594 例全绿。
  - 确认新增用例真的在跑：改动前基线 **549**、改动后 **594**，净增 45，与新增用例数一致。

### 独立评审

发布前由独立评审对 diff 做了对抗性复核（真实发布包 + 真实 api 模块），确认：双向四组合均不丢提示、
不丢工具、不重复 system 消息；**0.86 边界**在 0.85.1/0.86.0/0.86.1/0.87.1/1.0.2 五个真实 tarball 上
逐项复核成立；**`import.meta.resolve` 的假阳性被独立复现**（该模块在 0.85.1 磁盘上不存在，vite 仍返回
其 URL）；接线层用例确实覆盖工厂路径。

评审同时提出 **3 条有效缺陷**，均已修复并补上用例（即上表 ⑥⑦⑧）：`sections` 载体被漏读、
混合形状下折上会静默丢弃顶层提示与工具、以及不可探测分支的默认值无任何用例约束。

### 文档

- `docs/ISSUE27_DIAGNOSIS.md`：对外部报告的逐条核验——链路 6 跳的取证、双向错配四组合矩阵的实测结果、
  DSH 各版本与 pi-ai 代数对照，并明确指出该报告的 **3 处硬错误**（代际边界实为 0.86 而非 0.87；
  CASE B 实测为 `{"tokens":25}` 而非 `15`；`undefined maxTokens` 实为 `NaN` 而非「夹回正整数」）
  与 **2 处需修正的修复建议**（「收紧 peer 即可在安装期被拒」不成立——DSH 内核预检
  `evaluatePluginCompatibility` 只覆盖 `@deepseek-ai/dsh*`，pi-ai 不在其中，报告引用的 `install-compat`
  告警来自 dshmarket 社区插件且属只告警不阻止的 `soft-incompatible`；以及「升级 DSH」解决不了问题，
  报告人本就在最新的 0.2.0-rc.2 上，而升级只会把他更牢地留在「新宿主」一侧）。

## 3.4.1 (2026-10-12)

> **`4011` 的含义改正了：它是 Trae 对 SOLO 通道的限流，不是「该 function 不提供此模型」。**
> 起因是 [issue #33](https://github.com/dingminhua/dsh-connect-trae/issues/33)：报告人用 `GLM-5.3` 拿到
> `Trae code 4011`，报文原文写着 `your requests have exceeded the rate limit`，而他额度充足、
> Trae 客户端的 SOLO 里同一模型正常。**两边都没错**——Trae 把「额度」和「限流」分成两个码，
> 插件此前把限流读成了「function 归属错误」，于是用一个与上游原文矛盾的结论来解释，用户只能来问。
> 取证过程见 `docs/ISSUE33_DIAGNOSIS.md`。

### 修复

- **`4011` 的文案不再断言一个与上游原文矛盾的原因**（issue #33）：
  - **原行为**：`TRAE_ERROR_HINTS[4011]` 写死为「Trae refused this model under the SOLO function the request used」，并把 Trae 自己的原文降级成 `· upstream:` 后缀。用户看到的主句是「模型/function 错了」，于是按那个方向去查。
  - **为什么那个断言站不住**：本机 CN 实时凭据上跑 **22 个 function × 6 个模型**的最小请求矩阵，
    「模型不在该 function 名单里」**无一例外回 `4001`**（`the param is invalid`）——22 个 function 全部如此，**没有一次回 4011**；而报告人用的 `glm-5.3` 归属的正是 `solo_work_remote`（插件本来就发这个 function），同一份请求体**正常出字**。也就是说「function 选错」这个条件已经被 `4001` 占用了，4011 不可能是它。
  - **改后**：`4011` 如实描述为「Trae 限流了这条 SOLO 通道（是限流，不是余额）」，Trae 原文照旧附在后面。
- **`4011` 的 HTTP 状态改为 `429`（`soft_rate`），让状态码、文案与内核判定三者一致**：
  - **原行为**：4011 被归类为 `400 / client`（按本插件 `fallback-upstream.ts` 的语义，`client` 属于「可换通道重放」的一类，绝不是「等一下再来」的一类）。但内核 `@deepseek-ai/dsh-llm-pi-ai` 是**按消息文本**分类的（`/\b429\b|rate.?limit/i` → `RATE_LIMIT`），而 `RATE_LIMIT` 在 `DEFAULT_RETRYABLE_CODES` 里、`maxRetries = 5`。
  - **后果（issue #33 截图逐项吻合）**：失败的 4011 被内核当限流重试——`已重试模型请求 (5/5)`、重试延迟 7328 毫秒、右侧 `RATE_LIMIT` 徽标；而同一行正文却说「该 function 不提供此模型」。**被限流的通道 8 秒内又挨了 5 发请求。**
  - **改后**：4011 → `429 / soft_rate`，三处判定不再打架；`soft_rate` 也正是 `fallback-upstream` 拒绝换通道重放的类别（限流不是通道兼容性问题，是对的）。
- **一键测试不再把「被限流」判成「上游不提供」**（issue #33）：
  - `UNSUPPORTED_CODES` 此前是 `{4001, 4011}`，于是 4011 会得到 `unsupported`——卡片文案「上游不提供」，是一个**永久性的负面结论**。这与该模块自己写在文件头的原则直接冲突（「the verdict must never turn an inconclusive answer into "unavailable"」）。报告人用一键测试时会被告知一个能用的模型已经死了。
  - **改后**：4011 归入 `rate_limited`（卡片「被限流」），`unsupported` 只由 `4001` 产生。
  - **顺带把「一个码只能有一个 verdict」变成结构性约束**：原来每个 verdict 一个 `Set`，一个码同时出现在两个集合里时，结果取决于分支书写顺序——实测把 4011 加回「unsupported」集合**所有测试都过**。现在改成单一 `CODE_VERDICTS` 映射表 + 加载期唯一性断言，并补了交叉断言用例钉住它。
- **登记两个此前不认识的错误码**：
  - **`4008` = 额度/配额耗尽**（原文 `Your requests have exceeded the quota.`）。它与 `4011` **是两个不同的码**：Trae 把「额度用完」和「被限流」分开报，所以 issue #33 里「我额度还有很多」与「我被 4011 拦住」可以同时成立。只登记文案与分类，**不改它的既有语义**（仍 `400 / client`）。本机只在国际版账号上观察到（该账号当前对多数模型都回 4008），CN 未触发——属**未验证项**。
  - **`4023` = 模型名不存在**（原文 `the model is unknown`）。
  - 一键测试里 `4008` 归入 `unknown`：它是**账号级**状态，不能变成对某个**模型**的判决。

### 测试

- **全仓 541 → 549（+8）**：
  - `tests/solo-bridge.spec.ts`：4011 文案改为「限流」并保留 Trae 原文、`4008` 与 `4011` 文案分开、`4023` 命名、未登记码回退；`bridgeTraeSoloStreamOrFail` 的 4011 用例改为断言 `429 / soft_rate`；`4008` 的既有用例改为断言新文案。
  - `tests/model-probe.spec.ts`：4011 → `rate_limited`（含「消息里只有码、没有 429 状态」的路径与「流中拒绝」路径）、`4008` → `unknown`、`4001` → `unsupported`，以及一条**表级交叉断言**（每个已知码都只映射到一个 verdict）——它正是为上面那个「顺序依赖」缺陷加的。
  - **变异验证 6 次，6 次全部被抓**：① 去掉 4011 的 429 映射 → 1 例失败；② 恢复旧 4011 文案 → 2 例失败；③ 把 4011 在映射表里改回 `unsupported` → 4 例失败（**这条在改造前是抓不到的**）；④ 去掉 4008 的 `unknown` 映射 → 2 例失败；⑤ 删除「表内唯一性」的交叉断言依赖的行为 → 2 例失败；⑥ 其余组合。恢复后 55 文件 549 例全绿。
- 确认新增用例真的在跑：改动前基线 **541**、改动后 **549**，净增 8，与新增用例数一致。

### 文档

- `docs/ISSUE33_DIAGNOSIS.md`：完整取证——`4008`/`4011`/`4001`/`4023`/`1001`/`1005` 的码→语义对照、
  22 function × 6 模型的调用矩阵、`glm-5.3` 的归属验证、本机 30 并发未触发限流的对照，以及内核
  `dsh-llm-pi-ai` 按文本分类 + `DEFAULT_RETRYABLE_CODES` 的证据链（为什么截图里是 5/5 与 7328 毫秒）。
  同时明确列出**未证实项**（4011 的粒度是「通道」还是「账号」、`4008` 的边界与恢复时间、CN 是否也用 4008）。

## 3.4.0 (2026-10-12)

### 新增

- **积分即将过期时给出提醒**（贡献者 [JeffTsuiCUG](https://github.com/JeffTsuiCUG)，PR [#32](https://github.com/dingminhua/dsh-connect-trae/pull/32)）。剩余额度只回答「还有多少」，回答不了「**哪一笔先到期**」，而后者才是「该先用哪个」的依据。此前一个 1 小时后过期的包和一个下个月才过期的包在界面上看起来完全一样，只盯总额的用户会毫无察觉地丢掉最先到期的那个。
  - **数据在上一版（3.3.0，PR #31）已就绪**：`credits.accounts[].expiresAtMs` 已逐包携带到期时刻；本版在其之上加提醒 UI，**不新增任何上游读、卡片也不因此多一次请求**。原始起因见 [issue #26](https://github.com/dingminhua/dsh-connect-trae/issues/26)（DSH 主界面侧边栏显示积分状态的长期目标；`credits.expiry` 这份数据将来做 #26 可直接复用，同一个计费请求的结果）。
  - **`toCredits` 按到期时刻把有余额的积分包分桶汇总为 `credits.expiry`**：`within24h` / `within3d` / `within7d` / `expired` 四桶，每桶带金额合计、套餐数量与最早到期时间。
    - 只统计**正余额**的包：已用尽的包即使今天到期也不计入，否则长命账号会看起来永远「迫在眉睫」。
    - 已过期的包**单独计桶**，不进入前瞻窗口——剩余毫秒数为负时会满足所有前瞻条件（`end - now < 24h`），混在一起会让一个早就死掉的包看起来永远临近。
    - 抽出 `usableExpiry()` 谓词（`> 0` 且有限），与每包投影共用同一判断，两者不可能对同一批数据得出矛盾结论。`0` 与 `NaN`/`Infinity` 均被排除。
  - **`TraeWebCreditExpiry` / `TraeWebExpiringCredits` 仅当有包携带可用到期时间时才存在**——「没拿到数据」不得渲染成「没有要过期的」，这与 #31 里 `expiresAtMs` 缺省即省略的设计一致。
  - **两处 UI 不再一视同仁**：使用量标签页新增到期提示条，按 **7 天 → 24 小时 → 已过期**逐级加重，写明金额、套餐数和最早到期时间；输入框下面的积分面板（真正常驻看额度的地方）同样渲染提示条。仅国内版：国际版是订阅制（`payStatus`），没有逐包到期数据。
  - 中英双语文案（`row.expiryWarningSoon` / `row.expiryWarningWeek` / `row.expiryWarningLapsed` / `row.expiryEarliest`）。
  - 新增测试覆盖分桶边界、正余额排除、已过期/未到期分离、最早到期选取、非有限值与 `0` 的处理，以及「无数据」与「没有要过期的」这两个必须区分的状态。

### 测试

- `tests/composer-styles.spec.tsx` 的 fixture 补上带 `expiry` 的数据，让输入框面板的到期提示条真正被渲染并接受「每个渲染出的 class 在样式表里有规则」的守卫检查；并做了负向验证——临时删掉一条样式规则，测试精确报出缺失的 class（`dsm-trae-expiry-detail`），确认守卫是真的在覆盖而不是假通过。
- `tests/web-status.spec.ts` 新增 `expiry summary` 一组，钉住分桶与两种状态的区分。

## 3.3.0 (2026-10-11)

### 新增

- **一键测试所有模型**：模型区在「一键测试启用模型」旁新增「一键测试所有模型」，对当前 region 的**全部可见模型**发起可用性探测。两个按钮共用同一套探测路径，唯一区别是提交的 id 集合（勾选的行 / 全部可见行）。
- **`/usage` 的每个积分包携带自己的到期时刻**（`credits.accounts[].expiresAtMs`）。剩余额度只回答「还有多少」，回答不了「哪一笔先到期」，而后者才是「该先用哪个」的依据。上游本来就在 `user_entitlement_pack_list[].entitlement_base_info.end_time` 里逐包给出该时刻，这里只是把它投影进卡片文档——**不新增任何上游读**，卡片自身也不因此多一次请求。没有可用时刻的包**不带该字段**（而不是给 0）：0 是 1970，会排在所有真实日期之前，读起来像「早已过期」。

### 新增（国际版的输入框读数）

- **输入框工具栏读数扩展到国际版**（用户反馈「国际版也要这个显示，现在没有」）。此前只有国内版显示「Trae CN · <积分>」，选中国际版模型时整块读数消失。
  - 原限制是**数据决定的**，不是偏好：国际版的用量文档由 `payStatus` 构建，从不带 `credits`（`webStatusFor` 对 `region === 'ai'` 提前返回），把订阅制成的东西套进数字槽位只会渲染一个破折号。但正确的修法是**渲染那一边真正有的东西**，而不是什么都不渲染——所以国际版显示**套餐**（`Pro` / `Free`），与卡片账号行的额度列同源。
  - 三处文案随之区域化：产品名（`Trae CN` / `Trae 国际版`）、面板标题（`Trae 积分` / `Trae 国际版套餐`）、列头（`通用积分` / `套餐`）。在国际版面板里写「通用积分」而下面是 `Pro`，是在命名一个不存在的量。
  - 面板的**逐账号套餐**走的是卡片名册用的那条**账号状态路由**（它对 ai 返回 `payStatus`），而不是积分路由——后者是 CN 形状的（它调用积分快照）。仍然**只在面板打开时读**，5 分钟周期不为它付费。
  - 顺带把套餐判定抽成 `src/client/plan-text.ts`：卡片账号行的额度列、这里现在共用一个实现。此前卡片里另有一个独立订阅框与账号行各读各的源，正因如此才对同一账号给出不同档位（该框已删除，见下）。

### 修复（「刷新账号与 Token」显示已绑定，设置里却是空的）

- **刷新账号后显示的账号，就是真正被写进设置的账号**。报告的现象是：刷新后提示「找到 1 个账号 · 仍绑定 丁敏华」，而设置文档里 `accounts.cn` **一直是空的**。
  - 根因是把路由的 `selected` 标志读成了「已经绑定过」。该标志回答的是「**哪个账号正在使用**」，而不是「哪个账号被显式保存过」：没有保存过绑定时，存储层会用**探测到的默认值**（Trae App 当前登录的那个）来回答。于是「从未显式绑定」被读成「检测到的默认值正在使用，无需写入」——刷新恰好**什么都没保存**，而卡片却把它显示成已绑定；下一次存储重建（重启、或 Trae 换登录）就静默改回别的账号。
  - 现在按「**这个区域实际在用的账号**（存储层的裁决，也正是卡片显示的那个）写盘」，仅在路由完全没给出裁决时才退回该区域自己的名册；**已经是保存中绑定**的行不重复写——一次点击不该为无变化重写设置文档（那会触发 `loader/volatile-update`、重跑 `applySelection` 并重建两个存储）。
  - 提示语随之区分两件事：`已绑定 X`（这次真的写入了）与 `仍绑定 X`（这次没写，X 是既有绑定）。旧措辞把「保存了」和「本来就没动」压成同一句话，正是这个缺口看不见的原因。
- `tests/card-accounts-rescan.spec.tsx`（新增 6 条）钉住不变式：**刷新后卡片显示为在用的账号，必须就是设置文档记录的账号**——显示一个、保存零个是 bug，而它在截图里完全看不出来。覆盖：未绑定时必须写入、必须携带另一区域的绑定（不能把国内版的选择刷掉）、已是保存绑定时不得重写、路由未标 `selected` 时仍绑定它、只读 scope 不写且如实报告、以及提示语必须区分「已绑定」与「仍绑定」。

### 新增（输入框读数开关扩展到国际版）

- **「在输入框工具栏显示积分读数」不再只在国内版出现**。该开关此前是 CN 专属，理由是它背后的读数只服务国内版；读数扩展后它服务**两条供应商路由**（`trae` 上显示余额、`trae-global` 上显示套餐），继续藏起开关等于让国际版的读数**从任何入口都够不着**。
  - 仍是**同一个设置、同一次写入**，不是第二个开关——按区域各存一份会让读数与设置它的 tab 对不上。
  - 提示文案按所在 tab 取值（新增 `row.showPointsInMainUiHintAi`）：原提示一句话描述了两个区域（「…国内版为…，国际版为…」），那是它只在一个 tab 上渲染时写的；现在两个 tab 都渲染，提示只说自己这一边，勾之前就能知道会得到什么。

### 移除（国际版独立的「订阅状态」框）

- **卡片里那个独立的「订阅状态」框已删除**，订阅档位**只由账号表「额度」列渲染**。
  - 它当初是为了补「国际版没有那个积分框」的不对称而恢复的（595e01e），但账号表的额度列此后已经吸收了同一个数字，于是它**直接重复了正上方那一行**。同一份裁决有两个渲染器正是 `plan-text.ts` 存在要防的漂移，而该框能说的永远只是被标为「当前使用」的那行已经说过的内容。
  - `tests/card-subscription.spec.tsx` 的三条框测试替换为**反向守卫**：国际版 tab 上不得再出现 `row.subscriptionLabel` / `row.payStatusUnknown`，包括**读失败**这一路也不得把它以降级形态复活。

### 界面重做（用户反馈「现在的样式太难看了，而且内容也复杂」）

- **账号区改为定宽网格表格**（用户反馈「选择的样式……都和 WorkBuddy 有区别」，随后确认推翻上一版的列表要求）。每账号一行，四列：**账号 / 额度 / 签到 / 操作**，上方带表头行。
  - 「Token 到期」整列不再保留：它独占一列却没有人据此做决策。
  - 同一信息原本出现三次（状态点、名字旁的徽标、操作列又写一遍「当前使用」），现在只保留名字旁一个标记；当前绑定账号不再渲染任何动作按钮。
  - 国内版额度（积分）与国际版订阅（套餐）落在**额度列**，不再各占一个独立统计块。
  - **列宽用容器的分数**（`grid-template-columns:1.7fr 1.1fr 1fr 1.1fr`），这是关键：上一版四列各自按内容撑开，列与列在行间对不齐，才是「表格难看」的真正原因；定宽后可以沿列向下读。国际版没有签到列（该 region 无签到接口），列数降为 3，让出的宽度给账号名。
  - 当前使用中的行用**左侧强调竖条 + 淡色底**标记：只有 7% 透明度底色时，长表格里它会被误读成斑马纹的隔行底色。
  - 行内「切换」按钮改用共享的 `dsm-btn dsm-btn-outline` 原语并缩小，不再自造一套按钮。
- **设置区改为裸行开关、即点即存**（同一轮对齐）。去掉边框盒子、标题与「保存 / 放弃修改」按钮，两个开关各自成为一行带复选框的 `<label>`，**点击即写**。见下方「刻意改变的决定」。
- **签到按钮并入账号行**，奖励直接写在按钮上（`签到 +150`），因此删掉了旁边单独一行的「每日 150 积分」说明。见下方「刻意改变的决定」。
- **开关统一为平台原生复选框**（同一轮对齐）。tab 切换与设置项都改为 `<input type="checkbox">` + `accent-color`，撤销本次重做里自绘的圆钮开关。原委见下方「刻意改变的决定」。
- **文案精简**：tab 提示、设置说明、账号说明、两个开关说明、供应商关闭提示等 15 处长段落各压缩为一行，关键信息不丢。完整解释移入 `title` 提示。

### 修复（三处静默失效，任何行为测试都测不到）

- **`TraeUsagePack.endTimeMs` 装的是秒，不是毫秒**（外部贡献，PR #31 by [@welsongit](https://github.com/welsongit)）。该字段直接取自上游的 `entitlement_base_info.end_time`（`src/usage.ts`），而 Trae 给出的 `end_time` 是**秒**：对照真机 CN 账号，`1788340660` 是 2026-09-02；按毫秒读则是 1970-01-21。字段名写的是 `Ms`，于是任何照名字取用的调用方都会得到一个 1970 的日期——它排在所有真实日期之前，读起来像「早已过期」。
  - 该字段此前**没有任何读取方**（全仓只有写入点、没有一处消费），所以这个错误没有表现，也就没被发现。
  - 现在在解析处按量级归一（`> 1e12` 视为毫秒、否则按秒换算），与 `src/auth.ts` 对存储过期字段的既有判定一致；上游若某天改用毫秒也不会被乘成公元 57000 年。
  - `tests/web-status.spec.ts` 新增用例钉住这条契约：到期时刻必须成为毫秒，且「上游没给」时字段**缺席**而不是 0。

- **游离的右括号吞掉了一整条规则**：`.dsm-trae-models-actions` 之后有一个孤立的 `}`（全文 193 个 `{` 对 194 个 `}`）。它让紧随其后的 `.dsm-trae-usage-alternative` **完全不生效**——积分耗尽提示框因此没有琥珀底、没有边框，按钮被挤到文字下方（flex 失效）而不是并排。jsdom 不做层叠计算，一个没样式但类名与文本都正确的元素能通过任何行为断言，所以这个 bug 骗过了当时全部 517 个测试。
- **6 个 DSH 并不存在的 token**：`--dsw-alias-bg-layer-4`、`--dsw-alias-state-warning-bg/-border/-primary`、`--dsw-state-warning`、`--dsw-state-success`。`var(--nope, #333740)` 是合法 CSS，**看起来已被兜底处理**，但兜底值会在**两个主题下都生效**：
  - 那个 hover 因此长期是深色 `#333740`：浅色主题下按钮底色本是白的，一 hover 变成深炭色而文字仍是近黑 `#0f1115`，**几乎看不见**；深色主题下 `#353638 → #333740` 每个通道只差 2，**等于没有反馈**。改用 DSH 真正为此提供的 `--dsw-alias-interactive-bg-hover`（半透明叠加层，自适应任何底色且文字始终可读）。
  - 警告类 token 改用真实名称 `state-warn-primary/-secondary/-tertiary`，其中 `-tertiary` 本身按主题取值（浅色 amber-100 / 深色 amber-900），警告框从此随主题正确显示。
- **开关打开态的旋钮在深色主题下不可见**：旋钮硬编码 `#fff`，而轨道用 `--dsw-alias-brand-primary`——该 token 不是蓝色，而是**反差色**（浅色近黑 / 深色近白）。深色主题下即白旋钮配近白轨道。旋钮改用 `--dsw-alias-bg-layer-1`（与轨道在两个主题下都相反）。
- **「仍绑定在上一个账号」提示看不懂**。该提示只在 App 登录与插件绑定确实不一致时出现（`liveLogin()` 在 `liveId === this.accountId` 时返回 `undefined`），事实没错，但措辞有三个问题：只点名 App 登录的账号、把绑定账号写成**「上一个账号」**（而这条提示存在的意义恰恰是省掉去列表里找这一步）；用「当前登录」与列表里绑定账号的**「当前使用」**徽标撞车，两个「当前」指向不同账号，读起来像自相矛盾；且「上一个」断言了插件无从得知的顺序。现改为同时点名两个账号（`Trae 已登录 X，但本插件绑定的是 Y。`），按钮也改为点明目标（`改用 X`）。

### 测试

- `tests/card-styles.spec.tsx` 新增两组**结构性**防线，各对应一个已发生的真实故障：
  - **括号平衡**：失效时报出偏移量（`expected -1 to be 1` 说不出任何有用信息）。
  - **token 白名单**：15 个 token 全部逐一对照过 DSH；新增 token 必须人工加入白名单——那正是该去 `grep` 一遍 DSH、而不是「编一个看起来合理的名字」的时刻。该白名单同时校验**不得成为无人清理的超集**，删掉圆钮开关后 `--dsw-alias-bg-layer-1` 就此暴露并移除。
  - 同时**刻意没有**加「所有 `var()` 必须带兜底值」这条：本次 bug 恰恰是**错误兜底值**造成的，裸 `var()` 会明显失效，而错误的兜底值只会静默变色。
- `tests/card-accounts-table.spec.tsx` 新增「过期绑定提示」两条：句子必须同时包含绑定账号名与 App 登录账号名；按钮文案必须包含要切过去的账号名。该提示此前**零测试覆盖**，旧文案才能一直躺在那里。
- `tests/card-checkin.spec.tsx` 新增一条：一次签到必须**重读该 region 的每一行**，而不只是被点的那一行（见下）。
- `tests/card-composer-credits-switch.spec.tsx` 随「即点即存」改写：原来断言「点开关不写、按保存才写、放弃修改不写」的三条，改为断言**点击即产生一次且仅一次写入**、且**只写被点的那个字段**（另一开关已在文档中为 true 时不得被这次点击覆盖）、写入落定后方框显示提交值且页面上不存在任何「未保存」标记。
- 开关的可访问名随 `<label>` 包裹提示文字而变化（由 `row.showPointsInMainUi` 变为 `row.showPointsInMainUi row.showPointsInMainUiHint`），测试改为**锚定前缀**而不是要求整串相等。
- `tests/card-accounts-table.spec.tsx` / `card-checkin.spec.tsx` 的行定位从 `li` / `role=listitem` 改为 `role=row` 与 `.dsm-trae-account-row`；行数断言由 2 变 3，并把**表头行必须存在**写成契约的一部分——表头正是「能沿列读下去」的前提。
- 全量 `pnpm run check`（typecheck × 2 + 534 测试 + build）通过（本节各轮次累计后的当前值）。

### 刻意改变的决定（国际版读数显示套餐，而不是隐藏整块）

原实现**刻意**把 `trae-global` 排除在 `TRAE_COMPOSER_PROVIDERS` 之外，理由写在注释里：国际版没有可比的余额，映射过去会渲染「Trae CN」标签配一个破折号——一个没有数字的数字槽位。那个判断对了一半：**标签硬编码确实是错的**，但结论不该是整块消失。

- 现在两个 provider 路由都映射，读数按区域决定显示什么：CN 显示通用积分，ai 显示套餐名。`composer.points` 也从硬编码的 `Trae CN` 改为按区域取（新增 `composer.pointsGlobal`）。
- 对国际版用户来说，此前这个功能的实际行为是「打开开关，什么都没有」；现在至少回答「这个账号是什么档位」。

### 刻意改变的决定（设置区去掉草稿式保存，改为即点即存）

3.2.0 把设置区做成**草稿式保存**：「点『保存』才生效」，两个开关先写进本地草稿，由「保存」统一落盘，「放弃修改」丢弃草稿。本次改为**点击即写**，删除「保存 / 放弃修改」「设置」标题与整个边框盒子。

- **理由**：它保护的只有两个布尔值。让用户为两个布尔值记住「还要按一下保存」，成本大于收益；而同一张卡片里，tab 栏的供应商开关本来就是即点即写——卡片内部因此有**两套提交模型**。改为一套后，用户不必分辨哪个开关需要保存。
- **不丢的那点保护**：写入本身仍是**乐观更新 + 以宿主为准**——点击先立即反映在方框上，写入完成后撤掉乐观值，改读已提交的文档。写失败时方框会**弹回宿主的值**，而不是继续显示一个从未落盘的状态。两个写入者由 `savingSettings` 串行化，因为它们写同一份设置文档。
- **只写被点的那一个字段**：不发整个对象，避免一次点击用陈旧快照覆盖另一个开关在别处发生的改动。

### 刻意改变的决定（撤销本次重做里的圆钮开关）

本次界面重做把 tab 切换与设置项做成了**自绘圆钮开关**（34×20 轨道 + 14px 旋钮），理由写在当时的 CSS 注释里：「让 tab 栏和设置区看起来是同一个产品，而不是旁边放一个原生复选框」。用户看到 WorkBuddy 卡片后指出「选择的样式……都和 WorkBuddy 有区别」，现全部改回**平台原生复选框 + `accent-color`**。

- **原设计有两个说不通的地方。** 其一，同一个插件里的**输入框工具栏开关**（`.dsm-trae-mainui-switch-label`）一直就是原生 checkbox + `accent-color`，圆钮只出现在卡片里，插件自己就不统一；其二，圆钮的选中色用 `--dsw-alias-brand-primary`，而该 token 是 DSH 的**反差色**（浅色 `#0f1115` / 深色 `#f9fafb`），不是强调色——于是「打开」渲染成一枚**纯黑大胶囊**，比卡片里任何元素都重，且和两步之外的原生复选框毫无关系。
- **原生复选框顺带解决主题与可访问性**：勾选态、深色模式、键盘焦点环、高对比度模式全部交给宿主，插件不再维护旋钮几何。行为不变（仍是同一个 `type="checkbox"`，`aria-label` / `aria-labelledby` 与写设置路径都没动），因此行为测试全绿。
- **测试同步改写**：原来锁死旋钮的断言（`dsm-trae-switch-track`、`input:checked+track`、`::after`）改为锁**反向不变式**——必须存在 `accent-color` 规则，且**不得**再出现手绘轨道或 `clip:rect` 隐藏原生框的写法，防止圆钮被无意间改回来。

### 刻意改变的决定（取代 3.2.0 中「不提供逐账号签到」）

3.2.0 明确写过「**账号表格里不提供任何签到操作**，签到按钮仍只有全卡唯一一个」，理由是 Trae 的签到按**每台设备每天一次**计，批量签到只会制造一排假失败。本次改为**每行各带一个按钮**，理由与边界如下：

- **仍然没有「一键全签」**：一次点击只发一次 claim，只针对该行账号；测试继续断言不存在批量控件。3.2.0 反对的是**批量遍历**，不是「让用户自己选哪个账号」。
- **每行如实显示设备级状态**：可领 → `签到 +150`；该账号当天已领 → `已领取`；**本机额度已用但该账号没领** → `本机已签`（绝不显示成「已领取」）。设备额度用完后按钮**直接禁用**，而不是留给用户点一次再吃 9095。
- **新增：一次签到后重读所有行**。设备额度被本次签到花掉后，其它行从「可签到」变为「本机已签」；只刷新被点的那一行会让兄弟行继续展示一个只可能被 9095 拒绝的按钮——正是 3.2.0 想避免的「一排假失败」的弱化版。改为**重读服务端状态**而不是前端猜测：本次签到若并未花掉设备额度（该账号在别处已领），兄弟行照旧保留可签按钮。
## 3.2.0 (2026-10-11)

### 设置与账号区按 WorkBuddy 的组织方式重做

用户反馈「没看到设置菜单变化，WorkBuddy 里设置菜单变化挺大的」。对齐 WorkBuddy 卡片的组织方式后，本插件的设置与账号区从「散落的裸复选框 + 一个下拉框」变成两个有标题、有说明、有明确提交边界的区块：

- **「设置」区块（新）**：标题 + 说明 + 每项一行「标签 + 说明 + 开关」。
  - 两项偏好（`followAppLogin` 跟随 Trae 登录、`showPointsInMainUi` 输入框积分读数）改为**草稿式提交**：改动先留在卡片里，出现「有未保存的修改」提示，点「保存」才写入，点「放弃修改」还原为已保存的值。
  - 保存**只写被改动的那一项**——另一项若在别处（DSH 设置表单、另一个窗口）被改过，不会被本次保存用卡片里的旧值覆盖。写入仍走原有回读校验（`set()` 返回成功不算落地，必须读回一致），失败照旧显示错误行而不是静默回滚。
  - 开关是真正的开关样式（含键盘焦点环），不再是一个贴在右下角、没有任何说明的裸复选框。
- **「Trae 账号」区块（新）**：下拉框换成表格，列为 **账号 / 通用积分 / Token 到期 / 操作**。
  - 每行显示账号名、**产品名**（Trae / Trae 国际版 / TRAE SOLO / TRAE SOLO 国际版——不再是难以辨认的 `solo` 原始标记）、region、来源（桌面端 / Trae CLI / 插件副本）、Token 到期时间。
  - 当前绑定账号带「当前使用」标记且该行操作禁用；点击其它行的「切换」即换绑。切换**只写本 region 的槽位**，另一 region 的绑定原样保留（两个供应商并行时的既有约定，issue #11）。
  - 余额列**按需读取**：点「读取各账号余额」才发请求（该路由每账号一次上游读取，因此**绝不在卡片打开时自动读**，否则看一眼卡片就要为整个账号列表付费）；绑定账号的余额直接来自用量文档，不额外发请求。读取失败会**报错且不清空账号列表**，未知余额显示 `—` 而不是 `0`。

### 刻意不做的事（与 3.1.1 一致，这里再次钉死）

- **没有一键签到、没有逐账号签到**。签到仍是当前账号的单次点击：Trae 的签到按**每台设备每天一次**计（2026-10-11 本机实测：`did_checked_in` 随 `x-device-id` 变化而翻转），设备额度用完后其它账号 claim 只会被 `9095` 拒绝，批量只会制造一排假失败。账号表格里**不提供**任何签到操作，签到按钮仍只有全卡唯一一个；测试直接断言这一点。
- **没有「隐藏/删除账号」**。WorkBuddy 有这项是因为它有宿主侧的隐藏名单（`.dismissed.json`）；Trae 侧没有这套持久化，本次是纯前端重组与交互补齐，不假装提供该能力。

### 测试

- `tests/card-composer-credits-switch.spec.tsx`：两个开关的断言从「点击即写」改为**保存流**——点开关**不产生任何写入**、出现「有未保存的修改」、「保存」后才写入且提示消失、「放弃修改」丢弃草稿且零写入、一次保存只写被改动的那一项、只读 scope 下仍不可写。
- `tests/card-accounts-table.spec.tsx`（新增 7 条）：账号表格渲染与产品名/来源；当前账号被标记且无操作、其它账号可切换；切换只写本 region 槽位并保留另一 region；**打开卡片不读余额**而按需点击才读（且只读一次、带 region 参数）；余额读取失败报错但名单保留；**全卡只有一个签到按钮且不在账号表格内**（禁止逐账号/批量签到的防回归）。
- 全量 `pnpm run check`（typecheck × 2 + 507 测试 + build）通过。

## 3.1.1 (2026-10-11)

### 签到与多账号切换的边界（验证后说明）

- **多账号切换沿用 WorkBuddy 同款用法**：卡片顶部账号下拉切换当前绑定账号、跟随 Trae 当前登录（issue #29）、积分耗尽时提示可切换的其它账号（issue #25）——**切到哪个账号，积分读数与签到就属于哪个账号**。
- **刻意不做「一键签到」**：签到按钮只对当前选中的账号生效，点击一次只发一次 claim 请求（防回归测试见下），**不会**遍历本机其它账号逐个签到。理由是本机实测的 Trae 规则：
  - **Trae 的签到按「每台设备每天一次」计，不按账号**（2026-10-11 本机实测：同一 CN 账号同一天，带本机 `x-device-id` 读签到状态得 `did_checked_in: true`——本机额度已用；去掉该请求头再读同一时刻变 `false`——设备级键控坐实）。
  - 「账号未领、设备已签」（`checked_in: false, did_checked_in: true`）正是**切换账号后的常态**：新账号今天在本机领不到，claim 只会被业务码 `9095`（"该设备今日已参与签到"）拒绝。所以**一键全签没有意义**——只有第一个账号能成功，其余全部被拒，只会制造一排虚假的「签到失败」。
- 行为不变，只是把上述边界写进文档并钉死：设备已签时宿主路由**先读状态、不发 claim**（测试断言 upstream 调用数为 0），把 `9095` 呈现为「本机今日已签到，可换设备或明天」的说明而非错误。

### 测试

- `tests/card-checkin.spec.tsx` 新增：**多账号在场（含跨 region 账号）时，点击签到仍只产生一次 claim POST**，不向其它账号扩散——防止未来把单账号签到改成批量签到。
- 全量 `pnpm run check`（typecheck × 2 + 497 测试 + build）通过。

## 3.1.0 (2026-10-11)

### 修复

- **适配 Trae 新版刷新契约（`DeviceProof` 签名），国内版与国际版一并支持**。原报告「国际版 token 获取不到」的表象是国际版 tab 恒报 `trae: token refresh failed … (http 401); sign in again in Trae`，根因有**两层**：

  1. **表层——绑定了失效账号。** `accounts.ai` 指向的账号来自本机已卸载的 **TRAE SOLO 国际版**，其 access token 已于 2026-10-09 过期；同区域另一个有效账号（Trae 国际桌面版）就在旁边，但 `current()` 刻意不回退（避免静默换人计费），于是整个区域显示未登录。用配置里的账号下拉切一次即可恢复。

  2. **深层——刷新契约已换代（本次修复的主体）。** 官方客户端（Trae CN 3.4.2 / Trae 国际 3.6.2）已从 `/cloudide/api/v3/trae/oauth/ExchangeToken` 换到 **`/trae/api/v3/oauth/ExchangeToken`**，并**强制要求 `DeviceProof`**：

     - `DeviceProof.Signature` = 用**本机 ECDSA P-256 私钥**对 `["POST", 路径, ClientID, RefreshToken, 时间戳秒, nonce]` 做 SHA-256 签名（base64）。**六个字段用换行符连接**——官方 bundle 是 `.join("\n")`，用空格连接会被拒为 `20403 Token device not match`，表现与「密钥不对」**完全一致**，极易误诊。
     - 私钥就存在 `storage.json` 的 `iCubeAuthInfo://icube-dc:<deviceId>` 里，与凭证同一套 AES 加密，**用现有的 `decryptTraeStorageValue` 即可解出**（四版通吃）——不需要 keychain。
     - ClientID **按「是否 SOLO 包」分叉，不按 region**：桌面（cn/sg）→ `ono9krqynydwx5` + `IDE_PC`；SOLO（**solo 与 solo-sg**）→ `en1oxy7wnw8j9n` + `SOLO_PC`。**旧的「SOLO CN 用桌面 ClientID」在新契约下会得到 `10101 无效参数`**——这正是旧 `REFRESH_CONTRACT` 表的失效点。

  实现：`src/refresh.ts` 重写为「当前契约（带签名）优先、旧契约回退」，`src/identity.ts` 新增 `deviceKeyPairOf()` 读出 keypair 并补 `DeviceName`/`DeviceModel`，宿主把 keypair 随 DeviceInfo 传入。**没有 keypair 时（CLI-only 或旧安装）直接走旧契约**，不发送注定被 `20405 Device proof required` 拒绝的请求。

- **顺带修掉一个更隐蔽的老 bug：旧契约的 ClientID 一直用错。** 实测四个 edition 在旧 `/cloudide` 路径上**都能刷新成功**，但**必须用各自对应的 ClientID**（用错 → `10101 refresh token is not matched to the client`）。这说明该分叉**属于 OAuth client，不属于 endpoint**，而 3.1.0 之前插件在旧路径上**写死桌面 ClientID**，所以 **`solo` 与 `solo-sg` 的旧路径一直是 400**——国际 SOLO 账号一旦过期就再也刷不回来，正是本次报告的现象。现在两条路径共用同一张按 edition 分叉的 ClientID 表，四个 edition 在**两条路径上均实测 200**。

- 错误码语义已实测归档（`docs/INTL_SG_EVIDENCE.md` §2.2.1）：`20405` 完全没带 proof、`20403` proof 对不上、`10101` ClientID 用错、`20101` refresh token 本身失效。

### 证据

- 两条独立来源交叉：**读客户端 bundle**（`NPe()` 签名函数、`$v()` ClientID 分支、`m(t)` 请求头）+ **读 App 自己写的请求日志**（`[exchangeTokenByRefreshToken] request …` / `[exchangeToken] response success`），再用**四个 edition 实测**验证：cn / sg / solo / solo-sg **全部 HTTP 200**。
- `DeviceInfo` 必填梯度实测：`DeviceID` + `PlatformCode` + `DeviceType` 必填（去掉 `DeviceType` → `20403`），`MachineID` / `ClientVersion` / `DevicePublicKey` 可省（实现仍带全，与官方同形）。
- 成功响应新增记录 `RefreshExpireAt`（此前被丢弃）。

### 测试

- `tests/refresh.spec.ts` 重写：四 edition 的路径/ClientID/PlatformCode、proof 用**真实 P-256 密钥**签发并按换行消息验签（并断言空格连接必然验签失败）、无 keypair 降级、当前契约被拒后回退、两条路径失败都进错误信息。
- 全量 `pnpm run check`（typecheck × 2 + 495 测试 + build）通过；并用**构建产物 `lib/index.js`** 对四个 edition 做了端到端实测。

## 3.0.1 (2026-10-10)

### 修复

- **跟随 Trae 当前登录的账号（issue #29）**。在 Trae 桌面端**退出换登录**后，插件此前一直绑定**换号前**的账号继续计费，而同族插件 `dsh-connect-workbuddy` 会自动跟随 App 的新登录；报告人需要每次手动打开账号下拉切一次。根因是两处：`TraeCredentialStore.preferred()` 只取 `credentials[0]`（**不认哪个来源是 App 的 live 登录**），`current()` 在 `accountId` 有值时**严格绑定、find 不命中也不回退**（刻意为之，见 `src/auth.ts` 的注释——避免悄悄给用户换一个计费账号）。

  分两条路径修，**都不改变未勾选用户的任何行为**：

  1. **`preferred()` 改为 live 登录优先**（`source === 'desktop'` 的凭据先于插件自己的刷新副本）。只改**排序**、不改 `readAll()` 的取值去重——同一账号仍保留更长寿的副本，否则会退回「有效 token 在隔壁文件却读成过期」的旧问题（`src/auth.ts:371-384` 的注释）。这修好「从未显式选择」的默认路径，与 workbuddy 对齐。
  2. **显式绑定的跟随**：新增只读方法 `liveLogin()` 报告「App 当前登录 ≠ 绑定账号」的**不一致**（纯读，绝不静默换绑）；卡片在账号下拉旁给出**提示行 + 一键切换**（复用与下拉相同的 `switchAccount` 写入，保持单一写入路径）；新增配置字段 `followAppLogin`（volatile，默认**关闭**）让宿主在每次配置生效时自动重绑——**默认关**是因为自动换绑意味着换人计费，必须由用户主动勾选，未勾选时提示行就是手动通道。

  配套：usage 文档新增 `appLogin` 字段（仅在不一致时携带，健康文档不加字段、扫描失败也不拖垮整个文档），双语文案 `row.appLoginMismatch` / `row.appLoginFollow` / `row.followAppLogin`，README「多账号切换」补充该行为说明。

### 测试

- 新增 5 个：`preferred()` 优先 App 登录（旧 own 副本仍列出但不默认选中）、`liveLogin()` 三种不一致/一致状态、usage 文档 `appLogin` 的携带/省略/扫描失败降级；集成测试的 `MemorySettings` 补上 `revision` 冲突门（建模真实 `SettingsConflictError`）与新 volatile 字段 `followAppLogin`。
- `pnpm run check`（typecheck + 全量测试 + build）通过。

## 3.0.0 (2026-10-07)

> **积分从「侧边栏常驻一行」改为「输入框工具栏的按供应商读数 + 账号表格浮层」。**
>
> 这是一次**大版本**，因为它含一处功能移除与一处行为变更：
>
> - **侧边栏积分行已移除**（2.13.0）。它与同族插件 `dsh-connect-workbuddy` 争同一条共享行，实测被挤成裁切的碎片；现在积分只在输入框工具栏出现，且**只在选中的模型属于本插件时**出现。
> - **`showPointsInMainUi` 重新生效**：2.11.0–2.13.2 期间读数无视该字段、始终渲染；现在重新遵守它（**默认关闭**）。字段为 `true` 的用户读数保留。
>
> npm 上的 `latest` 此前是 **2.10.0**——2.11.0 至 2.14.0 **均未发布**，因此从 npm 升级会一次性拿到下面全部内容。

### 自 2.10.0 以来的变化

**新增**

- 输入框工具栏积分读数（2.11.0）：`Trae CN · <数值>`，5 分钟自动刷新，**仅当选中本插件模型时出现**。
- 读数整块可点击 → 锚定浮层（2.12.0），`Esc` 或点击外部关闭。
- **浮层改为账号表格**（2.14.0）：本区域每个账号一行、**只列通用积分**、**点行即切换账号**，手动刷新按钮在浮层内。
- 卡片恢复「在输入框工具栏显示积分读数」开关（2.13.3），并只出现在**国内版**面板（2.13.4）。

**移除 / 行为变更**

- 侧边栏积分行及其行内 `×` 关闭按钮已移除（2.13.0）。
- 读数限定国内版（2.13.4）：国际版是订阅制，其用量文档不含 `credits` 字段。
- `showPointsInMainUi` 重新生效，**默认关闭**。

**修复**

- 与 `dsh-connect-workbuddy` 侧边栏行重叠、被挤成裁切（2.10.3）。
- 读数字号过大、颜色过深（2.13.6）。
- composer 整段样式丢失导致默认按钮方框、浮层不显示（2.13.5）。
- 客户端整半无法加载：`react-dom` 被内联，`process.env` 在浏览器抛错（2.13.2）。
- 账号表格：绑定账号无数字、切换账号后另一账号丢失积分（本版）。

### Fixes

- **切换账号后，另一个账号不再丢失积分**。真机复现：绑定账号切换到 B 后，A 那行变成「—」。

  根因是 `readAll()` 的副本合并规则——**桌面副本先入，own 副本同 id 即跳过**，于是插件自己刷新出来的有效凭据被丢弃，账号永远「token 过期」，而有效 token 就在隔壁文件里：

  | | 访问 token |
  | --- | --- |
  | `~/.dsh/.trae-auth.cn.json`（15:08 刚写入） | **有效到 2026-10-14** ✅ |
  | `credentialOf()` 实际取到的桌面副本 | 过期于 **2026-09-27** ❌ |

  修复：**按账号归并，同一 id 保留访问 token 更长寿的副本**。插入顺序仍跟随桌面列表，因此「选哪个账号」不变——只改「同一账号取哪份副本」。这也解释了为何该 bug 只在**切换之后**出现：`ownAuthPath()` 每区域一个文件，绑定账号刷新会覆盖它。

- **绑定账号的取数改走会刷新 token 的路径**（`/account-credits` 端点）。它的存储 token 是已过期状态，而 `creditsOfAccount` 是纯查找、按设计原样返回过期 token（`creditAlternatives` 因此专门排除选中账号）；表格不排除，故改用与用量接口同一条 `deps.client(region)` 路径，并在客户端用量文档兜底——同一屏上读数与表格不能对同一账号给出两个答案。

- **积分浮层表格样式**：统一行高与首列对齐（按钮承担全部左右内边距并回拉，使标签与表头对齐）、表头细分割线、当前账号加粗与绿点、悬停只作用于可点的按钮。

### Screenshot

本图为修复后的实际呈现——两个账号各有数字，输入框读数与选中账号一致：

<img src="docs/assets/dsh-connect-trae-composer-credits.png" width="536" alt="Trae credits panel: a table of accounts with their general balance, and the composer readout below" />


## 2.14.0 (2026-10-07)

> **积分浮层改为表格：本区域每个账号一行、只列通用积分、点行即可切换账号。**

### Features

- **浮层改成一张表格**：表头「账号 | 通用积分」，**本区域有几个账号就显示几行**。
- **只列通用积分**，去掉 Work 积分那一栏。表格里放两列数字是噪音，而 Work 积分本来就不参与消耗——明细该去卡片看。
- **点行直接切换账号**。当前账号那行标记为当前（绿色圆点）且**禁用**（点了是无效写入）；其余行可点。
- 刷新按钮保留在浮层里。

### 切换的正确性

`accounts` 是**共享字段**，卡片和这个表格是它的**两个写入者**。因此把 `configuredAccountsOf`（深解包 + 合并规则）从卡片私有**提到 `status-paths.ts` 共用**：两个写入者必须共用同一条合并规则，否则会分叉。这条规则本身是踩出来的——`{ ...configured, [region]: id }` 若不解包会把 `{get()}` 引用散播进配置文档，**丢掉另一个区域的选择并把函数泄漏进去**。

写入仍然**读后校验**：`set()` resolve 不等于落库，读回不是目标值就报错，而不是把标记画在一个从未被选中的账号上。

### 新端点：`/plugins/dsh-connect-trae/account-credits`

返回本区域**每个账号的通用积分**。三个取舍：

1. **只在浮层打开时才取**（每账号 1 次上游读）。5 分钟的读数**不按账号数量翻倍**——健康余额不该为一张没人看的表付费，这与 `creditAlternatives` 只在余额归零时才触发是同一条原则。有测试锁住这一点。
2. **不排除已选账号、不排除 0 余额账号**。`creditAlternatives` 的那两条排除是为「你可以切过去的账号」设计的，而这张表是「**这里有什么**」的清单，两条都不适用。
3. **读失败的账号仍在表里**（只是没有数字）——面板的目的是**看见有哪些账号并切过去**，一个过期 token 不该让它从表里消失。

未提供 `creditsOfAccount` 的宿主也会列出账号（无数字）。

### Tests

- 全仓 476 → **480**。
- **客户端**（新增 4 例）：只在**浮层打开**时取账号积分（锁住成本决策）；当前行禁用、其余行可点；切换写入 `accounts` 且**保留另一个区域**的选择；按当前账号行不产生任何写入。
- **宿主**（新增 4 例）：列出**全部**账号（含已选、含 0 余额）；读失败的账号保留但无数字；无 `creditsOfAccount` 时仍列账号；**不混入其它区域的账号**。
- **变异验证 4+1 次全部被抓**：合并丢掉另一区域 → 1 例；表格不显示数值 → 1 例；打开前就取积分 → 2 例；当前行不禁用 → 3 例；像 alternatives 那样过滤 0 余额 → 1 例。
- 顺带修复测试桩：stub 之前对**所有** URL 返回用量文档，会把新端点的 `accounts` 填成 `[]`，使表格为空——测试会因**错误的原因**通过/失败。现已按 URL 分流应答。

## 2.13.6 (2026-10-07)

> **输入框积分读数：字号 12px、颜色改为浅一级的 `label-tertiary`。**

### 变更

2.13.5 把触发器改成了纯文本外观，但用了 `font: inherit` / `color: inherit`——**继承了输入框正文自己的字号与正文色**，于是读数比旁边的权限/专家/模型控件更醒目，用户反馈「字太大了，颜色也深」。

积分是**次要信息**，不该抢眼。改成显式值：

| | 之前 | 现在 |
| --- | --- | --- |
| 字号 | `inherit`（输入框正文，约 14–15px） | **`12px`**（本插件 2.11.x 的原设计值） |
| 颜色 | `inherit`（正文色，深） | **`--dsw-alias-label-tertiary`**（浅一级） |

参照的是 shell 自己的同排控件 `ContextMeter`——它用的正是 `label-tertiary`，本行的读数与它并排，口径一致。

顺带删掉多余的 `font: inherit`：一旦 `font-size` / `line-height` 是显式的，它既多余又会与之后的声明争夺层叠顺序。

### Tests

- 全仓 472 保持通过；守卫测试补上这两条断言（`font-size:12px` 与 `label-tertiary`），使这次的反馈不会再被后续改动悄悄退回。
- **变异验证**：改回 `14px` + `inherit` → 1 例失败。

## 2.13.5 (2026-10-07)

> **修复：输入框积分读数完全没有样式——丑按钮方框、点开没有账号面板，是同一个原因。**

### 根因

**composer 的样式根本没有被注入。** 2.12.0 我把 `.dsm-trae-composer-*` 写进了 `TRAE_SIDEBAR_CSS` 那个模板里，而 2.13.0 移除侧边栏时把整个常量删掉——**连带删掉了 composer 的样式**。此后（2.13.0–2.13.4）这个组件渲染时没有任何规则可用：

- 触发器 → 退回浏览器**默认按钮样式**，于是变成截图里那个带边框的方块；
- 浮层 → 没有 `position: fixed`，内联的 `left/top` 因此**被忽略**，它落在文档流里、根本不在触发器附近——所以你**看不到账号面板**。

两件事是同一个原因。

### 修复

- 新增**独立**的 `COMPOSER_POINTS_CSS`，由 `ComposerPoints` 在**模块加载时注入 `<head>`**（与卡片同一套幂等模式，重复渲染不会重复插入）。
- **触发器改为纯文本外观**：`border:0`、`background:transparent`、`color/font: inherit`——静止时和周围的输入框文字完全一致，只有 `padding` 提供点击区域，悬停时才有底色提示可点。即「保留之前的样式，只加一个点击区域」。
- **浮层恢复 `position: fixed` + `z-index`**，材质取自 shell 的 `--dsw-*` 令牌（跟随主题，不再硬编码明暗值）。
- 浮层的刷新按钮**不再依赖 `.dsm-btn`**（那个类在只随卡片注入的 `TRAE_CARD_CSS` 里，composer 永远拿不到），改为自带样式。

### 防复发

新增 **`tests/composer-styles.spec.tsx`**（5 例），把这次漏掉的东西变成断言：

- 组件确实在 `<head>` 写入了样式标签，且**重复渲染只写一次**；
- **组件渲染的每一个 `dsm-*` 类，在它注入的样式表里都必须有规则**；
- 浮层规则必须含 `position:fixed`（这一个属性的缺失就是面板消失的原因）；
- 触发器必须 `border:0` + 透明背景，且存在 `:hover` 状态。

**变异验证 4 次全部被抓**：构造了 `<style>` 却不挂进 `<head>`、触发器规则丢失、浮层改为 `absolute`、触发器改回带边框——各 1 例失败。

之所以必须写成这种结构断言：jsdom **不做布局、不参与层叠**，所以「样式被整个删掉」在原有 460+ 个测试里一条都不会红。这已经是本次会话里第三类「注释/删块副作用导致的静默破坏」，现在有了针对它的守卫。

### Tests

- 全仓 467 → **472**。

## 2.13.4 (2026-10-07)

> **修正积分开关的位置：它是国内版专属，却放在了卡片顶部，看起来对两个区域都生效。**

### 变更

- **开关移入「国内版」面板**，紧邻它的账号区，不再挂在卡片顶部：位置本身就是一种声明——放在顶部意味着它对两个 tab 都成立。
- **读数限定国内版**。这是一处**潜在 bug 的修复**，不只是配合开关：国际版的用量文档是由 `payStatus` 构建的，**根本不带 `credits` 字段**（宿主 `webStatusFor` 对 `region === 'ai'` 提前返回），因为国际版是订阅制、没有可比余额。此前 `trae-global` 也被映射到读数上，于是选中**国际版模型**时会渲染出 `Trae CN · —`——一个写死「CN」的标签配一个空数字。
- **开关放在「已登录」子树之外**。它关联的积分数字确实只在已登录时才有，但把开关嵌在那里会导致**未登录的用户恰恰找不到它**——而「找不到这个开关」正是上一个版本要解决的问题。

### Tests

- 全仓 466 → **467**。
- 新增「**国际版 tab 上开关不存在**，切回国内版又出现」的用例——这是本次修正的核心契约。
- 把「国际版也渲染并抓取财务数据」的旧用例反转为「**国际版不渲染、不抓取**」，并注明这是**数据决定**而非供应商决定（该用例传入的是**已开启**的开关，以证明拦下它的是区域规则）。
- **变异验证 2 次全部被抓**：去掉「仅国内版」限制 → 1 例失败；把国际版映射加回读数 → 2 例失败。

## 2.13.3 (2026-10-07)

> **把「显示积分」开关加回设置卡片，这次控制的是输入框的积分读数。**

### 背景

2.13.0 移除侧边栏积分行时，我把卡片里那两处「在DSH主界面显示积分状态」复选框一并删了——理由是输入框读数会自动出现、不需要开关。用户随后去找这个开关，发现没有了。

用户是对的：**输入框工具栏是与 shell 自己的权限/专家/模型控件共享的一行**，那里的读数应当由用户主动开启，而不是默认塞进去。2.13.0 到 2.13.2 之间它是无条件渲染的。

### 变更

- **恢复开关**：卡片顶部一个复选框「在输入框工具栏显示积分读数」（英文 `Show credits in the composer row`），带说明性 tooltip。
- **字段复用 `showPointsInMainUi`**，而不是新建一个：已经把它设为 `true` 的用户（例如为了旧侧边栏行开启过的人）升级后**读数直接保留**，不会发现它悄悄关掉了。
- **默认关闭**（与之前对侧边栏行声明的偏好一致）。因此：字段为 `true` 的用户保持显示；字段缺失或为 `false` 的用户在 2.11.0–2.13.2 期间**曾看到过**读数，升级后不再看到，需要勾选开启。
  - 这一条是**行为变更**，明确记录在此：2.11.0 起读数无视该字段、始终渲染；现在它重新遵守这个字段所表达的用户意图。
- 开关是**唯一写入者**：读数本身不带控件。写入沿用卡片其余设置同样的「写后读回校验」，避免出现渲染了却存不下去的假开关。

### 实现

- `ComposerPointsGate` 接收注入的 `settingsScope`，订阅它，只在 `showPointsInMainUi === true` **且**当前模型属于本插件（`trae`/`trae-global`）时渲染。两个条件相互独立，任一不满足即零 DOM、零请求。
- 客户端入口把 `settingsScope` 一并注入 `conversation.input.left` 槽位。

### Tests

- 全仓 461 → **466**（+5 卡片开关测试，gate 测试从 5 → 8）。
- **刻意修正了一处会“假通过”的测试**：`renders nothing while ANOTHER provider is selected` 与新开关叠加后，会因为「开关关闭」而不是「供应商不匹配」通过——即那条断言会失去意义。现在它显式传入**已开启**的 scope，确保仍在验证供应商判断。同理处理「投影尚未就绪」那条。
- 新增卡片测试直接点击**真实复选框**并断言 `scope.set('showPointsInMainUi', …)`：本插件曾出过「复选框渲染了但存不下去」的假开关，所以断言写在该字段上，且控件按**标签**选取而非位置（卡片里还有两个区域开关）。
- **变异验证 4 次全部被抓**：缺失即视为开启 → 1 例失败；完全不理会开关 → 4 例；复选框点了不写入 → 2 例；字段名大小写写错 → 2 例。

## 2.13.2 (2026-10-07)

> **修复 2.12.0 起客户端整半无法加载。2.13.1 的归因是错的，这一版是真正的原因。**
>
> ```
> web boot: 1 entry did not activate
> dsh-connect-trae: import failed
> ```
>
> 受影响版本：**2.12.0、2.13.0、2.13.1**。

### 真正的根因

2.12.0 为积分浮层引入了 `import { createPortal } from 'react-dom'`。**`react-dom` 不在 `tsdown.config.ts` 的 `CLIENT_EXTERNALS` 名单里，于是被内联打包**，其 CJS 构建开头就是：

```js
if (process.env.NODE_ENV !== "production") { … }
```

浏览器里没有 `process` → 模块**求值时**抛 `ReferenceError: process is not defined` → 整个客户端半边 import 失败。

证据链：

| | |
| --- | --- |
| 产物里 `process.env` 出现次数 | 2.13.1 为 **5**，修复后为 **0** |
| 产物体积 | 2.13.1 为 **1,072,561 B**（含内联 react-dom），修复后 **119,427 B** |
| 宿主是否注册 `react-dom` | 是（`staticModules` 里有 `"react-dom":Rf,"react-dom/client":Df`） |
| 同族插件 `dsh-better-sidebar` | 产物为 `require("react-dom")`（外部化），因此正常 |

### 修复

- `react-dom` 与 `react-dom/client` 加入 `CLIENT_EXTERNALS`，改为向 shell 的模块加载器 `require`，不再内联。

### 2.13.1 的归因错在哪（保留记录）

2.13.1 判定原因是「值导入了 `@deepseek-ai/dsh-client-ui-primitives`，浏览器无法解析」。**这是错的**：我把宿主的前端 bundle 反出来看了它的模块加载器，`staticModules` 明确注册了该包：

```js
{ react, "react/jsx-runtime", "react-dom", "react-dom/client",
  "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",   // ← 注册了
  "@deepseek-ai/dsh-client-ui-dockkit" }
```

我当时只对比了「2.11.1 有两个 require、2.12.0 有三个」，看到多的那个就下了结论，**没有去验证那个 require 在浏览器里到底能不能解析**。真正变化的是 `createPortal` 带来的 react-dom 内联，证据（`process.env`、1MB 体积）一直都在产物里。

2.13.1 顺带把两个浮层 hook 改成了本地实现（`src/client/popover.ts`）。这个改动本身是好的（少一个运行时依赖、测试无需 mock），因此**保留**；但它的注释里那段错误归因已改正。

### 防止复发（这一版的重点）

`tests/client-runtime-imports.spec.ts` 重写为两条**真正的不变量**——之前的版本禁止一切 DSH 值导入，那是基于错误前提的：

1. **凡值导入必须已外部化**。若一个 shell 已提供的包没进 `CLIENT_EXTERNALS`，它就会被内联——这正是 react-dom 事故。
2. **凡外部化的导入必须是 shell 注册过的模块**，否则产出的 `require(...)` 解析不到。

宿主注册表在测试里以常量记录，来源已在注释里写明（前端 bundle 的 `staticModules`）。

- **已验证能抓住真实事故**：把 `react-dom` 移出 `CLIENT_EXTERNALS`（即还原 2.12.0 的状态）→ 2 例失败；导入一个未注册的包 → 1 例失败。
- 该守卫跑在常规测试里、**不需要构建产物**，在引入问题的那一行就失败。
- 附带修掉一个解析 bug：解析 `CLIENT_EXTERNALS` 时注释里的撇号（`shell's`）会骗过引号匹配、把注释文本当成条目，现改为先剥离注释再按行匹配。

### Tests

- 全仓 455 → **457**。

## 2.13.1 (2026-10-07)

> **紧急修复：2.12.0 引入的客户端整半无法加载。**
>
> ```
> web boot: 1 entry did not activate
> dsh-connect-trae: import failed
> ```
>
> 受影响版本：**2.12.0、2.13.0**。2.11.1 及更早不受影响。

### 根因

2.12.0 为积分浮层加了锚定定位，为此在客户端入口**值导入**了 `@deepseek-ai/dsh-client-ui-primitives`。

插件的客户端 bundle 由 shell 的模块加载器载入（`window.__ModuleLoader__.load({ factory: (require) => … })`），它只注册了极少数模块名。tsdown 会把该值导入转成一个外部 `require(...)`，而浏览器无法解析它——**整个客户端半边因此加载失败**。

**这个不变量一直写在仓库里**：`tests/client-activation.spec.tsx` 明确记录「入口的运行时依赖只有 React 和本地文件——所有 DSH 包都是 type-only 导入、编译期被擦除」。2.12.0 破坏了它，而且**所有测试依然全绿**：测试里该包被 mock、Node 也能从 node_modules 解析它，**问题只存在于浏览器中**。

### 修复

- 两个 hook（`useAnchoredPosition` / `useDismissOnOutsidePointer`）**改为本地实现**，新增 `src/client/popover.ts`，零 DSH 导入。行为对齐 shell 版本：同一套上/下放置与视口夹取、同一套滚动（capture）/缩放/浮层尺寸变化时重测、同一条「按下位置既不在触发区也不在浮层内则关闭」规则。
- 移除入口的 primitives 值导入，以及为此引入的依赖注入绕路。
- 产物恢复为**只有 `react` 与 `react/jsx-runtime` 两个 require**——即 2.11.1 那个已验证可用的状态。

### 防止复发

- **新增 `tests/client-runtime-imports.spec.ts`**：静态扫描 `src/client/**`，**若有任何 DSH 包的值导入即失败**（`import type` 允许，编译期被擦除）。这条守卫**已验证能抓住 2.12.0 的那个错误**。它跑在常规测试里、不需要构建产物，**在引入问题的那一行就失败，而不是等到启动时**。
- 新增 `tests/popover.spec.tsx`（14 例）覆盖本地 hook 的真实几何与关闭规则。

### Tests

- 全仓 438 → **455**。**变异验证 5 次全部被抓**：定位忘记减去浮层高度 → 2 例；`align=end` 失效 → 1 例；去掉水平夹取 → 2 例；点浮层自身被当成外部点击 → 1 例；关闭状态下仍挂监听 → 1 例。
- 另：`client-activation.spec.tsx` 中 2.12.0 为此加的 primitives mock **已删除**——该测试恢复为「加载真实入口、零 mock」。

### 教训

「所有测试全绿」不能证明插件能加载。这个仓库的测试把 DSH 包都 mock 掉了（Node 需要），因此**构建产物里出现什么 require，测试看不见**。现在这条静态守卫补上了这个盲区。

## 2.13.0 (2026-10-07)

> **移除侧边栏积分行。侧边栏不再有任何本插件的痕迹，积分只在输入框工具栏、且仅在选用本插件模型时出现。**

### 变更

- **删除侧边栏积分行**（`sidebar.footer.action` 槽位已不再注册）。侧边栏底部是**一条根级共享行**，两个连接器插件各占一行必然互相挤压——2.10.3 的修复只是让本插件的行不被裁切，位置依然各占一行。现在积分只在输入框工具栏出现，而那里是**按会话、按供应商**的，同一时刻只有一个插件的额度是相关的。
- **删除卡片里两处「在DSH主界面显示积分状态」复选框**：它们控制的侧边栏行已不存在，留着就是死开关。
- 删除随之无用的代码：`SidebarPoints.tsx`、`SidebarPointsGate.tsx`、`TRAE_SIDEBAR_CSS` 全部侧边栏样式、12 个仅服务于该行的文案键（`sidebar.*` 与 `row.showPointsInMainUi*`）、以及 `togglingMainUi` 状态。

### 关于配置字段 `showPointsInMainUi`

**保留在 schema 中，但已废弃、不再被读写。** 用户可能已经保存了这个字段的值；从 schema 里删掉一个已持久化的配置字段，会让那份数据对宿主设置存储变成未知键。保留一个死字段的代价，远小于数据变动。字段描述已改为说明它已废弃。

### Tests

- 全仓 49 → **47** 个文件、450 → **438** 个测试（删除 `sidebar-points` 10 例、`card-mainui-switch` 2 例——它们测的正是被删掉的功能）。
- 槽位断言更新为三个（`plugins.bundle.config`、`plugins.row.config`、`conversation.input.left`）。
- **过程中的一个真实错误**：用脚本按注释边界删除侧边栏注册块时，把紧邻其后的 composer 注册块**一起吞掉了**（两块的结束边界重叠）。是激活测试的槽位数量断言立刻发现的（注册数从 3 少到 2）——这正是那条断言存在的价值。已恢复 composer 块。

## 2.12.0 (2026-10-07)

> **输入框积分读数改为可点击：整块点击打开浮层，浮层内显示账号与积分，手动刷新按钮移入浮层。**

### Features

- **整块可点击**：`Trae CN · 3,392` 本身就是一个按钮（`aria-haspopup="dialog"`），**行内不再有刷新按钮**。这一行与权限/专家/模型控件共享，必须保持窄；而把操作收进浮层，正好与旁边的「专家」控件是同一套交互。
- **点击弹出锚定浮层**（浮现在控件上方，`Esc` 或点击外部关闭），内含：
  - **账号**（回答「这是谁的额度」）
  - **Work 积分** 与 **通用积分** 两个桶，各自数值
  - **最近刷新时间**
  - **手动刷新按钮**（从行内移到这里）
  - 刷新失败时在浮层底部报错；未登录时显示「未登录」
- 沿用宿主原语 `useAnchoredPosition` + `useDismissOnOutsidePointer`，与 shell 其它浮层（ContextMeter 等）行为一致。

### 依赖注入的架构决定

浮层所需的那两个 hook **由客户端入口注入**，组件本身不 import `@deepseek-ai/dsh-client-ui-primitives`。原因：该包是浏览器 bundle（自身 `import '*.module.css'`，并依赖 `clsx`/`mdast-util-*` 等 Node 无法解析的传递依赖），组件一旦 import 它，Node 测试环境就无法加载它。

- 组件对 `popover` 缺省时使用**惰性桩**（不定位、不自动关闭），保证两个 hook **每次渲染都被调用**——条件调用会改变 hook 数量、违反 hooks 规则。
- 组件测试因此无需 mock 任何东西即可渲染。
- `client-activation.spec.tsx`（该测试要加载**真实入口**）沿用本仓库既有约定 mock primitives——与 `card-*.spec.tsx`、`sidebar-points.spec.tsx` 一致；mock 的是第三方 UI 库，不影响它验证的 `inject` 数组。

### Tests

- 全仓 449 → **450**（+1）：新增「`Esc` 关闭浮层」用例。
- 补强了浮层内容断言：此前只断言了字段名存在，**没验证数值**；现在断言账号名与两个桶的**具体数值**（fixture 中 work=1,777 / general=3,392，两者互不相同，避免「两个桶显示同一个数」这种错误不被发现）。
- **变异验证 6 次全部被抓**：去掉圆点 → 2 例失败；去掉 `aria-haspopup` → 1 例；点击不再打开浮层 → 1 例；浮层不显示 Work 积分数值 → 1 例；浮层不显示账号 → 1 例；`Esc` 不再关闭 → 1 例。
  - 其中「浮层不显示 Work 积分数值」与「`Esc` 不再关闭」**最初都没被抓到**：前者因为断言只看字段名、不看值；后者因为根本没测。两处已补。

## 2.11.1 (2026-10-07)

### 变更

- **输入框积分读数去掉「积分」二字，改用中心圆点分隔**：由 `Trae CN 积分 3,392` 改为 **`Trae CN · 3,392`**（英文同样是 `Trae CN · 3,392`）。
  - 这一行与权限/专家/模型控件共享空间，必须保持窄；圆点与旁边模型选择器的写法（`DeepSeek-V4.1-Flash · x0.08`）属于同一套视觉语言。

### Tests

- 全仓 447 → **449**：新增「真实文案断言」——直接对**打包的中英文文案表**断言（`Trae CN`、无 `积分`/`credits`），并用真实中文 `t` 渲染断言文本恰为 `Trae CN · 3,392`。
- 之所以加这条：组件测试里的 `t` 返回的是**键名**，因此「真实文案里又混回 `积分`」这种改动永远不会让组件测试变红——必须直接断言文案表本身。
- **变异验证 2 次全部被抓**：圆点换成空格 → 1 例失败；真实文案里加回 `积分` → 1 例失败。

## 2.11.0 (2026-10-07)

> **新增：在输入框工具栏显示「Trae CN 积分」——只在当前模型属于本插件时出现。**
>
> 这样两个连接器插件不再争同一个位置：侧边栏底部是**一条共享的根级行**，两个插件各放一行就会互相挤压（实测结果是本插件的行被压成裁切的「Tr」，见 2.10.3）；而输入框工具栏是**按会话、按供应商**的，同一时刻只有一个插件的额度是相关的。

### Features

- **输入框工具栏的积分读数**（`conversation.input.left` 槽位，位于「专家」与模型选择器之间）：
  - 显示 `Trae CN 积分 <数值>` + **一个刷新图标按钮**——不占标签、不放第二个按钮，因为这一行与权限/专家/模型控件共享，必须保持窄。
  - **按供应商显示**：读宿主自己的 `modelSelection` 投影，只有当前模型的 provider 是 `trae` / `trae-global` 时才渲染。选其它供应商的模型时**完全不渲染**（无 DOM、无请求）。
  - `next` 优先于 `lastUsed`：已经切换但尚未发送的选择，才是输入框上显示给用户看的那个。
  - 5 分钟自动刷新；点击图标可手动刷新；失败保留上次数值。
  - 数值为**通用积分**（`credits.generalAvailable`），与卡片上那一栏口径一致。

### 为什么用投影而不是插件自己的状态

`modelSelection` 投影是**模型选择器写入、下一次请求实际使用**的那个值，因此读数不可能与生效的模型不一致。

### 为什么改到输入框工具栏

侧边栏底部（`sidebar.footer.action`）是**根级共享行**：它按横向 flex 排列 shell 自己的按钮与所有插件的贡献，两个插件各占一行就会互相挤压。输入框工具栏是**会话作用域**且能读到当前供应商，因此天然只显示相关的那一个——**这是「各自占位置」问题的结构性解法，而不是把行做窄一点**。

### Tests

- 全仓 435 → **446**（+11）：`selectedProviderOf` 的四种退化输入；**另一个供应商时零渲染零请求**；投影未就绪时零渲染；`trae` → CN 区域、`trae-global` → 国际区域；**直接以非本插件 provider 渲染组件时零渲染零请求**；读数取通用积分而非汇总；行内**只有 1 个按钮**且是刷新图标。
- **变异验证 3 次全部被抓**：忽略 `next` 只看 `lastUsed` → 1 例失败；改回汇总口径 `available` → 2 例失败；去掉组件内层的归属守卫 → 1 例失败。
  - 其中「去掉归属守卫」最初**没被抓到**：外层 Gate 已经过滤，组件内层守卫是纵深防御，两条都被删也不会红。为此补了一条**直接以外部 provider 渲染组件**的用例——这个盲区正是「冗余守卫无人覆盖」的典型。

## 2.10.3 (2026-10-07)

> **修复：与同族插件 `dsh-connect-workbuddy` 的积分行重叠，我们的行被挤成裁切的一小条。**

### 问题

侧边栏底部同时显示两个插件的积分时，实际呈现是：

```
WB CN 积分： 3,392   刷新
WB AI 积分： 0      刷新
Tr                        ← 我们的行只剩开头两个字母
```

根因：**shell 把 `sidebar.footer.action` 渲染成一个横向 flex 行**（它自己的按钮 + 每个插件的贡献都在同一行）。我们的行容器**没有声明占满整行宽度**，于是被排到其他行旁边、挤进剩余空间里。

### 修复

- 行容器加上 **`flex: 0 0 100%` 与 `min-width: 0`**，声明独占整行宽度——这样无论 footer 里有多少其他贡献，本行都占满一行而不是被挤压。
- 这与 `dsh-connect-workbuddy` 的做法一致：它在自己的 Gate 注释里记录过同一问题（「fragment 让两行成为横向 flex 的兄弟节点，两行被并排挤在一起，用户报告不可读」），并同样用「声明宽度」解决。

### Tests

- 全仓 435 保持通过。这一处是**纯布局**问题：jsdom 不做布局计算，因此**单元测试无法覆盖**——判断依据是真实界面截图与两处 CSS 的逐行对比。这一点如实记录，避免留下「测试全绿所以没问题」的错觉。

## 2.10.2 (2026-10-07)

### 变更

- **侧边栏标签改为 `Trae CN 积分`**（英文 `Trae CN credits`），对齐同族插件 `dsh-connect-workbuddy` 的呈现格式（`WB CN 积分： 3,392`）——即「**产品缩写 + 区域 + 积分**」。
  - 上一版是 `Trae通用积分`，没有区域标记。加上 `CN` 后，与 workbuddy 的两行（`WB CN 积分` / `WB AI 积分`）在视觉上属于同一套语言。
  - 数值仍是**通用积分**（`credits.generalAvailable`），未改动。

## 2.10.1 (2026-10-07)

> **对齐 `dsh-connect-workbuddy` 的侧边栏积分呈现方式：去掉行内开关，默认不显示。**

### 变更

- **默认不显示**（`showPointsInMainUi` 默认 `false`）。侧边栏底部与 shell 自己的控件共享空间，一行常驻信息应当是用户主动要来的，而不是升级后自动出现的。开关在卡片里——**和它控制的设置（账号、模型）待在一起**。
- **去掉积分行里的 `×` 关闭按钮**。行内不再有任何控件，只有数值与「刷新」。理由有两条，都是同族插件 `dsh-connect-workbuddy` 先踩到并记录下来的：
  1. 行内的 `scope.set()` 是**同一个字段的第二个写入者**，而它的成功判定比卡片的「写入后读回校验」弱——**同一个设置存在两条可以互相矛盾的写入路径**；
  2. 它和「让这一行保持清爽」的目标相冲突。
- 随之删除不再使用的样式（`.dsm-trae-sidebar-points-hide`）与文案键（`sidebar.hide`）。

### 保留不变

- **关闭后整行彻底消失**（无 DOM、无残迹），轮询一并停止。
- **侧边栏收起（56px 导轨）时整行不渲染**。
- **5 分钟**刷新间隔；开启后先立即抓取一次，完成后再启动定时器。
- 显示**通用积分**（`credits.generalAvailable`）——对齐卡片上真实存在的「通用积分」那一栏。卡片没有「合计」栏，所以不采用 workbuddy 的 `credits.total`（否则侧边栏的数字在卡片上找不到对应）。
- 卡片里**两处**复选框（卡片顶部 + 模型区标题旁）保留，作为唯一的开关入口。

### Tests

- 全仓 435：`sidebar-points` 的用例改写为新契约——**「字段缺失即关闭」**（原先断言「缺失即开启」）、**「行内不携带任何控件」**（断言行内**只有 1 个按钮**且是刷新、且不产生任何写入）、**「关闭后容器内无 DOM」**。
- **变异验证 2 次全部被抓**：改回「缺失即开启」→ 1 例失败；行内多出一个按钮 → 1 例失败。

### 致谢

同族插件 **dsh-connect-workbuddy** 在它的 `SidebarCreditsGate.tsx` 里明确记录了「行内 `×` 作为第二个写入者曾导致关不掉」这一结论，本版据此对齐。

## 2.10.0 (2026-10-07)

> **新增：在 DSH 主界面侧边栏常驻一行「Trae通用积分」**（[#26](https://github.com/dingminhua/dsh-connect-trae/issues/26)，**实现由报告人 JiewiW 贡献**）。
>
> 看积分原先必须打开插件设置卡片、展开、找到额度区。现在侧边栏底部（工作区列表下方、设置上方）常驻一行「Trae通用积分：<数值>」与刷新按钮，**默认显示**，每 5 分钟自动更新，也可手动刷新。

> 这是 2.9.0 起五个版本合并后的首个公开版本：npm 上的 `latest` 此前仍是 2.8.0，因此**从 2.8.0 升级会一次拿到下面全部内容**。

### Features

- **侧边栏积分行**：在 `sidebar.footer.action` 槽位渲染「Trae通用积分：<数值>」+ 「刷新」按钮。
  - **默认显示**（opt-out）：`showPointsInMainUi` 默认 `true`。
  - **关闭即彻底消失**：行内的 `×` 或卡片里的复选框都能关闭，关闭后**侧边栏不留任何 DOM**，轮询一并停止。
  - 开启后**先立即抓取一次，完成后再启动 5 分钟周期**的定时器，不叠加；关闭或卸载即清除定时器并中止在途请求。
  - 抓取失败保留上一次数值并提示；刷新进行中忽略重复点击。
  - 显示的是**通用积分**（`credits.generalAvailable`，SOLO 聊天实际消耗的那个池子），与卡片上的数字口径一致。
  - 侧边栏收起（56px 导轨）时整行不渲染；国际版为订阅制、无可比数字，因此不显示。
- **开关在三处，写同一个字段**（`showPointsInMainUi`），永不冲突：侧边栏那一行的 `×`、卡片顶部、卡片「模型」区标题旁（在「从 Trae 刷新」「一键测试启用模型」左侧）。

### 为什么不只用插件卡片里的复选框

第一版把开关**只**放在插件卡片里，结果在装了 **dshmarket** 的宿主上等于不存在：市场插件接管了插件页，而它的 UI **完全不渲染插件自带的配置卡片**（其客户端 bundle 里 `plugins.row.config` / `plugins.bundle.config` **0 处引用**）。于是积分行被挡住、开关又在打不开的页面里。现在把开关同时放在**模型区**（用户管理模型时视线所在）与**积分行本身**，并默认显示——不再依赖任何一个可能不可达的页面。

### 修复（本版合并的 2.9.1–2.9.4）

- **2.9.1**：积分行默认显示，关闭入口移到行内（原为默认关闭 + 开关藏在插件卡片）。
- **2.9.2**：标签由「通用积分」改为「**Trae通用积分**」，避免与侧边栏里其他插件的数字混淆。
- **2.9.3**：**补上复选框缺失的 CSS**——移植贡献者实现时只搬了侧边栏积分行的样式，漏掉了卡片里复选框的样式，导致它一直在渲染但**没有布局与配色、等同于不可见**；同时在「模型」区标题旁加了同一个复选框。
- **2.9.4**：关闭后**彻底不显示**，不再残留「积分」小按钮（回到开关的路已在卡片两处）。

### Tests

- 全仓 423 → **435**：开关默认即显示；关闭后容器内**无任何 DOM**（`container.innerHTML === ''`）且轮询停止；行内 `×` 与卡片两处复选框**写同一字段、互相同步**；`preferStrongerRow` 等既有用例不变。
- **变异验证多次全部被抓**：关闭时残留元素 → 2 例失败；去掉模型区的复选框 → 2 例失败；「缺失即开启」改回「必须显式 true」→ 1 例失败；收起态不退出 → 1 例失败。

### 致谢

报告人 **JiewiW** 独立完成了实现、430 个测试（含假定时器），并在独立 DSH 实例上做了端到端验证——包括「关闭开关后跨越两个应触发周期点无任何请求」这类定时器泄漏检查，还明确声明未改动版本号与无关代码。他当初在说明里提醒的「该 rc.2 宿主未内联挂载插件配置面板」后来被证明是真实的坑，本版据此把开关放到了可达位置。

## 2.9.4 (2026-10-07)

### 变更

- **关闭积分显示后，侧边栏彻底不留任何东西**（`×` 或取消勾选都是如此）。之前关闭后会在原位置留一个「积分」小按钮，理由是可以随时找回开关；但 2.9.3 已经把同一个复选框放进卡片**两处**（卡片顶部 + 模型区），回到开关的路本来就在配置它的地方。**用户要的是清干净，残留一个按钮仍然占着他们想腾空的位置。**
- 随之删除不再使用的样式（`.dsm-trae-sidebar-points-off` / `-show`）与文案键（`sidebar.show` / `sidebar.showHint`）。

### Tests

- `sidebar-points` 的用例改为断言**关闭后容器里没有任何 DOM**（`container.innerHTML === ''`），而不是「还剩一个可恢复的入口」；并断言轮询也随之停止。行内 `×` 的用例同样断言完全清空。
- **变异验证被抓**：关闭时改为残留一个元素 → 2 例失败。

## 2.9.3 (2026-10-07)

> **修复：「显示积分」复选框实际上看不见**——它一直在卡片里渲染，但**没有任何 CSS**，所以读起来像是不存在。

### 问题

2.9.0 移植贡献者的实现时，我只搬了侧边栏积分行的样式，**漏掉了卡片里那个复选框的样式**（`.dsm-trae-mainui-switch*`）。复选框本身渲染了，但没有布局、没有间距、没有配色——在卡片里等同于不可见。用户因此反复找不到「在DSH主界面显示积分状态」这个开关。

### 修复

- **补上缺失的样式**（`.dsm-trae-mainui-switch` / `-label` / `input`），复选框现在正常显示、可点、有品牌色。
- **在「模型」区标题旁再加一个同样的复选框**（就在「从 Trae 刷新」「一键测试启用模型」两个按钮的左侧）。理由：管理模型时视线就在那里，而**需要用户去找的设置等于没有设置**——这正是这个开关此前丢失的原因。两处写**同一个字段**，永不冲突；顶部的那个也保留。

### Tests

- 全仓 435（用例数不变，但 `card-mainui-switch` 的两条被**加强**）：现在断言卡片里**两处都有**复选框、默认都未勾选、且**勾任意一处另一处同步**（共享字段）；「配置已开启」的用例也改为断言**两处都是勾选态**。
- **变异验证被抓**：删掉模型区那一个复选框 → 2 例失败。

## 2.9.2 (2026-10-07)

### 变更

- **侧边栏积分行的标签改为「Trae通用积分」**（英文 `Trae credits`）。原先只写「通用积分」，而侧边栏底部可能同时出现其他插件的数字，读者无法确定这个余额属于谁。加上产品名前缀后一眼可辨。

## 2.9.1 (2026-10-07)

> **修复：积分行默认不显示，而它的开关在一个部分宿主上根本打不开。**

### 问题

2.9.0 把积分行做成 **opt-in**（`showPointsInMainUi` 默认 `false`），开关只放在插件卡片里。这在部分宿主上等于**功能不存在**：

- 用户装了 **dshmarket**，插件页默认停在市场的 tab，而市场 UI **完全不渲染插件自带的配置卡片**（我在它的客户端 bundle 里搜 `plugins.row.config` / `plugins.bundle.config`，**0 处引用**；它只注册自己的卡片，key 是 `dshmarket`）。
- 于是积分行被 Gate 挡住不渲染，而唯一能打开它的开关在用户到不了的页面里 —— 既看不到功能，也找不到开关。

**根因是我把「可关闭」实现成了「默认关闭」**：用户的原话是「**如果要加这个显示**，再加一个开关让不想显示的用户可以关闭」——那本该是**默认显示 + 可关闭**。

### 修复

- **`showPointsInMainUi` 默认改为 `true`**（opt-out）。侧边栏底部直接显示通用积分。
- **关闭开关移到积分行自己身上**：积分行右侧多一个 `×`，点一下即隐藏；隐藏后**同一位置留一个极小的「积分」按钮**，一点即恢复。
  - 两个控件写的是**同一个字段**（`showPointsInMainUi`），因此与插件卡片里的复选框永不冲突。
  - 关键点：**控制入口和功能渲染在同一处**，所以「宿主能画这一行」就等于「用户能控制它」，不再依赖任何设置页。
- 侧边栏收起（56px 导轨）时仍然整行不渲染：收起态塞不下标签+数值+按钮，会变成「积…」。

### 兼容性说明

- 之前**明确关闭过**该开关的用户不受影响（显式 `false` 仍是关闭）；「字段缺失」现在按**开启**处理（原先按关闭），所以升级后会直接看到积分行。
- 插件卡片里的复选框**保留**：在能渲染卡片的宿主上（如内置插件管理器），它依然可用。

### Tests

- 全仓 433 → **435**：新增「默认即显示」「关闭后留下可恢复的入口」「行内关闭按钮写入共享字段」；并把原「关闭时不渲染任何 DOM」的用例改写为**「关闭时仍留一个可操作入口」**——那条旧断言正是把这次的问题固化下来的地方。
- **变异验证 2 次全部被抓**：把「缺失即开启」改回「必须显式 true」→ 1 例失败；关闭时改为不渲染入口 → 1 例失败。

## 2.9.0 (2026-10-06)

> **可选：在 DSH 主界面侧边栏常驻一行通用积分**（[#26](https://github.com/dingminhua/dsh-connect-trae/issues/26)，**由报告人 JiewiW 提交实现**）。
>
> 看积分原先必须打开插件设置卡片、展开、找到额度区；现在勾一个开关，侧边栏底部（工作区列表下方、设置上方）常驻一行「通用积分：<数值>」与刷新按钮。

### Features

- **侧边栏积分行**（开关 `showPointsInMainUi`，**默认关闭**）：在 `sidebar.footer.action` 槽位渲染「通用积分：<数值>」+ 「刷新」按钮；`title` 显示最近刷新时间；抓取失败保留上一次数值并提示；刷新进行中忽略重复点击。
  - 开关关闭时**不渲染任何 DOM**（不是隐藏），因此不产生任何请求；关闭开关或插件卸载即清除定时器并中止在途请求。
  - 开启后**先立即抓取一次，完成后再启动 5 分钟周期**的定时器，不叠加。

### 合入时相对贡献者实现的三处调整

1. **数字口径：`credits.generalAvailable`（通用积分），不是 `credits.available`。** `available` 是上游汇总（`summary.totalAmount - consumedAmount`），而卡片展示的是按额度包分出的 Work / 通用两桶；汇总**不保证**等于任一桶。一个用户在侧边栏找不到对应数字的余额，比没有数字更糟。通用桶也正是 SOLO 聊天路径消耗的那个。
2. **轮询 60s → 5 分钟。** 卡片的轮询本身就是 60s，而每次 usage 读取会打**两个**上游请求；积分以「模型调用」而非秒为单位变化，60s 的边际价值很低。
3. **侧边栏收起时整行不渲染**（`wide === false` → `null`）。宿主 CSS 并**不会**在收起时隐藏底部区域，而是把它压成 56px 居中窄条（`SidebarRoot.module.css` 的 `.collapsed .footerActions`）；标签 + 余额 + 按钮塞进 56px 会被裁成「积…」。而**收起正是长时间工作的常态**——这个功能最需要成立的时刻不能是它最坏看的时刻。提前退出也意味着收起期间不启动抓取循环。

### Tests

- 全仓 423 → **433**：移植贡献者的 7 例（开关默认关闭/持久化/读回/回显；挂载即抓取、首次抓取后启定时器、卸载即清除；失败保留上次数值；进行中点击被忽略；Gate 关闭时零 DOM），并新增 3 例锁定上述调整。
- **测试加固**：贡献者的 fixture 让 `available` 与 `generalAvailable` **恰好相等**，所以换成哪个字段测试都过——这正是能悄悄退回汇总口径的盲区。现已让两者**不相等**，字段选错会立刻失败。
- 同时把 `card-region-switch` 的取元素方式从「按下标取前两个 checkbox」改为**按 aria-label 精确匹配区域开关**：新开关让卡片多了第三个 checkbox，按下标会开始断言到错误的控件。
- **变异验证 3 次全部被抓**：收起态不再退出 → 1 例失败；取字段改回 `available` → 3 例失败；轮询改回 60s → 1 例失败。

### 致谢

报告人 **JiewiW** 独立完成了实现、430 个测试（含假定时器）、并在独立 DSH 实例上做了端到端验证（含「关闭开关后跨越两个应触发周期点无任何请求」这类定时器泄漏检查），还明确声明未改动版本号与无关代码。

## 2.8.0 (2026-10-06)

> **绑定账号额度耗尽时不再是一块没有解释的空面板**（[#25](https://github.com/dingminhua/dsh-connect-trae/issues/25)，报告人 JiewiW）。
>
> 账号选择是**持久化**的：你一旦把某个账号绑上去，它就长期生效。于是「绑定的那个账号额度用尽」在卡片上表现为**一个永远为 0 的面板，没有任何解释**；而「刷新账号与 Token」会返回 200 和同一份账号列表，看起来和失败一模一样。报告人遇到的正是这个：TRAE SOLO CN 卸载后其凭据仍留在 `%APPDATA%`，CN 区一直绑着那个已耗尽的残留账号，而他以为绑的是自己正在用的 Trae CN。

### Features

- **「刷新账号与 Token」现在会报告结果**（`rescanAccounts`）：成功后显示「找到 N 个账号 · 仍绑定 X」，失败时显示原因并保留原错误。用户从此能区分「刷新成功但无变化」与「刷新失败」。
- **绑定账号额度耗尽且本机另有可用账号时，卡片给出明确提示并支持一键切换**（仅国内版，额度接口只存在于 CN）：
  - 仅当**已选账号自身额度为 0** 时才去查其他账号，账号健康时**不产生任何额外请求**；
  - 提示里带上可用账号的名字、产品与可用积分数，一键写入绑定并立即刷新；
  - 其他账号同样为空、或来自另一区域（国际版）的，一律不提示——避免给出「切过去也用不了」或「数字不适用本区」的建议。
- **账号下拉显示可读的产品名**：`Trae` / `Trae 国际版` / `TRAE SOLO` / `TRAE SOLO 国际版`，取代原先裸露的 `cn` / `sg` / `solo` 标记——正是这个标记让报告人分不清哪个凭据来自已卸载的产品。

### Implementation notes

- 新增只读的 `TraeCredentialStore.credentialOf(accountId)`：查某个**指定**账号的凭据而不改绑。原先只能靠 `selectAccount` 切换来读，而那会与共用同一 store 的在途聊天请求竞争，并持久化一次用户并未做出的选择。这个方法是纯查询：只读、无刷新副作用、`accountId` 不变。
- 探测其他账号的额度用一个**临时** usage client，并复用与绑定账号**完全相同**的 `toCredits`（Work/general 分桶），避免出现「提示里的数字和旁边显示的数字算法不一致」。

### Tests

- 全仓 419 → **423**（+4）：绑定账号为空时才出现替代账号；账号健康时**一次都不探测**（断言探测次数为 0）；同样为空、以及**跨区域**的账号既不被提示也不被探测；单个账号探测抛错时安全降级。
- **变异验证 3 次全部被抓**：永不触发探测 → 1 例失败；去掉「无额度」过滤（空账号也会被当作出路）→ 1 例失败；去掉区域限制（会去探测国际版账号）→ 1 例失败。

## 2.7.2 (2026-10-05)

> **补完 #23 的确定性**：2.7.1 修好了 Max 档随机丢失，但**在 max 相等时仍保留了先到者**，于是 **dev 基础窗口**还会随货架顺序漂移。报告人 JiewiW 在 Windows 复测时发现并给了修法（`glm-5.2`：`chat_v3` 的 dev=116000 与 `solo_agent_remote` 的 dev=200000 都带 max=1000000，谁先到就取谁）。

### Bug Fixes

- **择强规则改为逐级比较到底（字典序），不再在「max 相等」处停止**（`preferStrongerRow`）：
  - ① 带 Max 的行优先 → ② Max 更大者胜 → ③ **max 相等（或都无 Max）时比 dev，取更宽者** → ④ 完全相等才保留先到者。
  - **为什么第 ③ 步不是多余的**：2.7.1 在 max 相等时直接保留先到者，导致**未配置预算的模型**其默认窗口仍是一次抛硬币——本机 CN 30 个模型里有 9 个如此（`glm-5.2` 就是其一）。配了 1M 预算时最终仍恒为 1M，所以用户不易察觉；但「默认窗口」决定 DSH 的显示与压缩基准，正是 #23 要消除的同一类缺陷。
  - **实测（本机 CN，连刷 8 次）**：修复后**整目录指纹 8/8 完全一致**（含每个模型的 dev 与 max，30 个模型）；`glm-5.2` 稳定为 `dev=200000 / max=1000000`。修复前同一份数据的两种货架顺序分别得到 dev=116000 与 dev=200000。

### Tests

- **全仓 417 → 419**：新增 2 例（max 相等时按 dev 取宽、且与顺序无关；带 Max 的行仍胜过 dev 更宽的无 Max 行）。同时把原有的「6 种货架排列」用例的**数据改成「max 相等但 dev 不等」**——正是报告人指出的形态，断言全部排列落到同一个 dev；这条用例此前只覆盖了 dev 相同的情形，所以没能发现该问题。
- **变异验证 2 次全部被抓**：把规则退回「max 相等即保留先到者」→ 2 例失败；去掉「带 Max 优先于 dev 更宽」→ 2 例失败。

### 致谢

报告人 **JiewiW** 在 Windows 上完成了三项预期验证，并额外指出 `preferStrongerRow` 在 max 相等时的残留不确定性，连修法（「在 max 相等时继续落到 dev 取更宽」）一并给出——本版照此实现。

## 2.7.1 (2026-10-05)

> **修复「Max 档随机丢失、同一模型上下文窗口在多次刷新间漂移」**（[#23](https://github.com/dingminhua/dsh-connect-trae/issues/23)，报告人 JiewiW）。
>
> 这是 **2.6.0 引入/放大的缺陷**：那一版把发现侧从 2 个货架扩到 7 个，却保留了「先到先得」去重——而同一个模型在多个货架里的**容量并不相同**，货架顺序又**每次调用都不同**。结果同一模型这次是 `116000`、下次是 `256000`、再下次才带 1M Max，用户配置的 1M 预算被随机忽略。

### Bug Fixes

- **跨货架去重改为「保留容量最强的行」**（`TraeSoloRemoteCatalogClient.fetchModels`）：
  - **根因**：remote `/models` 按 function 分组，同一模型 id 出现在多个组里，各组报告不同容量。实测（本机 CN 凭证，2026-10-05）同一次响应里 `Doubao-Seed-2.1-Pro` 的各组值：`builder_v3` → `116000`/无 Max；`solo_work_remote` / `solo_work_lite` → `256000`/无 Max；`chat_v3` / `solo_agent` / `solo_agent_remote` → `256000`/**`1000000`**（`max_mode: true`）。
  - **为什么旧写法必错**：原来的去重是 `seen` Set 的「第一次遇到就锁定」，而我当时的代码注释还写着「保持网关自己的组顺序稳定」——**那个假设是错的**：连打 5 次实测得到 **5 种不同的组顺序**。于是容量的发布值取决于哪一组恰好先回来。`applyContextBudgets` 只能在 `maxContextWindow` 存在时升窗，所以丢失该字段会让配置了 1M 的模型被静默压到 256K 或更低，DSH 因此在远早于用户设定的阈值处反复压缩。
  - **修法**：按 ① 带 Max 档优先 ② 都有 Max 取更大 ③ 都无 Max 取更宽的 dev 窗口 的顺序择强；平手保留先到者（模型顺序仍由网关决定）。同一 id 的各行在 `multimodal` / `reasoning` / 积分倍率上完全一致（同日实测逐字段核对），因此按容量择强不会丢失能力信息。
  - **实测对比**（本机 CN，连打 6 次实时目录，同一预算配置）：
    | | 修复前 | 修复后 |
    | --- | --- | --- |
    | `Doubao-Seed-2.1-Pro` 的取值 | `116000/无`、`256000/1000000`、`256000/无` **三种漂移** | 6/6 稳定 **`256000/1000000`** |
    | 整目录带 Max 的模型数 | 11 → 26 **随机** | 6/6 稳定 **26** |

### Tests

- **全仓 413 → 417**：新增 4 例（`preferStrongerRow` 的三条择强分支 + 平手保留先到；以及**同一组数据在全部 6 种货架排列下产出完全相同的目录**——这条直接锁住了「结果不得依赖网关顺序」）。
- **变异验证 3 次全部被抓**：改回「先到先得」→ 1 例失败；去掉 Max 档优先 → 2 例失败；把平手规则从 `>` 改成 `>=`（后到者胜）→ 1 例失败。
  - 其中第 3 次最初**没被抓到**：我原来的平手用例只覆盖了「都无 Max」的情况，没覆盖「两个相等的 Max」。补齐用例后才抓住——这本身说明那条断言当时的覆盖是假的。

### 致谢

报告人 **JiewiW** 给出的定位（跨组容量不一致 + 组顺序不稳定）与实测数据表完全正确，并附了可直接套用的补丁思路；本版按其方向实现，并补上了「结果与顺序无关」的回归测试。

## 2.7.0 (2026-10-02)

> **新增「一键测试启用模型」**：给每个已启用的模型发一条最小消息，看哪些**真的能应答**。
>
> 起因是 issue #19 留下的那个问题——目录里有一些模型拿不到调用 id，而**能不能调用取决于账号档位**，本地任何检查都判断不了（本机只有免费账号，测不出付费账号的真实现状）。既然无法代替用户判断，就把判断交给上游，让用户一键问一次。

### Features

- **一键测试启用模型**（卡片模型区新增按钮）：
  - 对**已启用**的每个模型发一条最小的聊天请求（一句 `ping`、不带工具，花费降到最低），逐个给出结论：
    | 结论 | 含义 |
    | --- | --- |
    | **可用** | 上游正常应答 |
    | **需要更高档位** | `1005`：当前套餐不覆盖该模型（报告人 Pro 账号能用的模型，免费账号会看到这一条） |
    | **上游不提供** | `4001` / `4011`：没有任何 SOLO function 服务这个 config_name |
    | **被限流** | 上游限流，本次未测出 |
    | **登录凭据被拒** | 凭据失效；整轮测试立即停止（否则后续每个模型都只会重复同一句） |
    | **本次未测出** | 超时、连接中断、代理、5xx——**一律不算「不可用」** |
  - **`本次未测出` 是一等公民**：把限流或断连显示成「不可用」，用户会去删掉一个其实能用的模型。只有上游明确的拒绝才算负面结论。
  - **这是插件里唯一消耗额度的操作**（另一个是签到，改变的是账号状态）。因此：只由用户点击触发、没有定时也没有启动时自动跑；按钮带说明；一次测试发送的提示词固定为一句「ping」且不带工具。
  - **逐个请求、串行执行**：Trae 对突发请求限流明显，并发探测会自己制造出「被限流/未测出」；每测完一个立刻更新该行徽标，所以不是空等一分钟。
  - **结果只在会话内存里**：不写进设置——某个模型「上游不提供」是某一刻、某个账号的事实，持久化下来只会在上游改主意后继续误报。
  - **路由守卫**：POST + 回环来源 + 区域参数；待测 id 必须存在于该区域的实时目录（不能拿任意的上游 config 名去消耗额度），数量上限 64。

### Tests

- **全仓 395 → 413（+18）**：
  - `tests/model-probe.spec.ts`（新增 16 例）：分类规则的每一个分支，重点是「不许把不确定判成不可用」——超时、断连、5xx、无输出的 200 流全部保持 `unknown`；`1005` → `gated`、`4001/4011` → `unsupported`、401 → `auth`、429 → `rate_limited`；流中途抛出的拒绝**带错误码时仍要分类**（不能退回 unknown）；串行顺序与「认证失败即停止」；探测请求体是最小的 `ping` 且不含 `tools`。
  - `tests/web-status.spec.ts`（+2 例）：新路由把 id 交给**该区域**的探测实现并回传结论；方法/来源/请求体不合法时**一次调用都不发出**（用探测调用次数断言，而不是只看状态码），以及超过上限的列表被拒。
- **变异验证 3 次全部被抓**：把「不确定」改成负面结论 → 1 例失败；去掉认证失败即停止 → 1 例失败；不识别 `1005` 门禁码 → 2 例失败。恢复后 46 文件 413 例全绿。
- **真机验证（本机免费账号，国际版）**：`gpt-5.4` / `kimi-k3` → 可用；`gpt-6-luna` → 需要更高档位（`1005`）；`gpt-6-astra` / `gpt-5.6-sol` / `glm-5.2` → 上游不提供。三种结论都在真实链路上得到验证。

## 2.6.0 (2026-10-02)

> **包含仍未发布的 2.5.1。** 2.5.1（补问 `chat_v3`，国际版目录 11 → 17）只打了 tag、未推 npm，因此没有用户拿到过它；2.6.0 在同一棵树上带上它。
>
> 本版做了一件**行为上的反转**：目录里拿不到调用 id 的模型**不再被隐藏，而是照常显示**，调用失败时给出可读的上游错误。起因是 issue #19 的讨论——可调用名单是**按账号档位**下发的，用免费账号测不到，不能推出付费账号用不了；**隐藏用户自己 IDE 里有的模型，比让他看到一条明确的错误更糟**。

### Features

- **模型列表改为「全部呈现」：不再隐藏拿不到调用 id 的模型**（issue #19）：
  - **原行为**：`mergeTraeModelSources` 会剔除「目录里有、但任何 function 的可调用名单里都没有」的行（2026-08-30 的结论：这类模型发出去必然 `4001 param is invalid`，所以不该暴露）。
  - **为什么反转**：那个结论把**账号范围的事实**当成了**普遍事实**。可调用名单按账号档位下发，本机免费账号问不到不等于付费账号没有——报告人是 Pro，他的账号能正常调用本机免费账号被门禁（`1005`）挡住的模型。插件隐藏了他 Trae IDE 里明明有的模型，这才是更糟的结果。
  - **现在的行为**：这些行照常出现在列表与勾选界面里；因为没有 wire 目标，调用会走显示 id + 默认 function，上游拒绝时由 2.5.0 引入的错误翻译如实转述，用户看到的是：
    ```
    Trae does not serve this model under the SOLO function the request used
    (config_name rejected) · Trae code 4001 · upstream: We're sorry, the param is invalid…
    ```
    而不是「模型不见了」或一句像网络故障的提示。
  - **实测（本机实时凭据 + 插件自身代码路径）**：国际版目录 **17 → 22**（新增 `gpt-6-astra`、`gpt-5.6-sol/terra/luna`、`glm-5.2` 这 5 个无调用目标的行）；国内版目录 **19 → 30**。无调用目标的行会随上游开放 SOLO 通道而自动变得可调用——判据就是能不能 join 到调用 id，无需再改插件。

### Bug Fixes

- **国内版目录补齐：读全 7 个货架，新增 11 个模型**（issue #19 跟进）：
  - 国内版的发现名单此前只有 `solo_agent_remote` + `solo_work_remote`，把 `solo_coder`（12 个）、`chat_v3`（18 个）、`solo_agent`（18 个）、`solo_work_lite`（15 个）等组全部漏读——与国际版此前那个缺口形状相同。现在两个区域使用同一份组名单。
  - 调用名单同步补上 `solo_agent_remote` / `chat_v3` / `solo_coder`（都在最后，只补缺口）：实测国内版新增可见 `Doubao-Seed-Code`、`Doubao-Seed-2.0-Code`、`glm-5.1`、`glm-5`、`glm-5v-turbo`、`DeepSeek-V4-Pro`、`DeepSeek-V4-Flash`、`kimi-k2.5`、`qwen-3.5`、`minimax-m2.7`、`qwen-3.6-plus` 等。
  - **纠正一处我自己的测量错误**：2.5.1 曾记「CN 的 `solo_coder` 组里 3 个模型任何 function 都 4001，所以不能扩大 CN」——那是**探测脚本的 bug**：调用时用了展示名而不是该 function 返回的 `config_name`。用正确的 config_name 重测，`doubao-seed-2.0-code`、`deepseek-v4-pro`、`deepseek-v4-flash` 在 `solo_coder` / `chat_v3` 等下**全部正常出字**。（同一个坑在同一轮里踩了两次，见 `docs/RELEASE_EXPERIENCE.md` 的教训类型。）

### Tests

- **全仓 395 → 395**（改写 4 条既有断言为新的行为契约）：merge 保留无 wire 目标的行且不伪造 `wireConfigName` / `wireFunction`；国内版发现名单必须含 `solo_coder` / `chat_v3` / `solo_work_lite`；国内版调用名单的顺序与内容。
- **变异验证 3 次全部被抓**：把 merge 改回「丢弃无线行」→ 2 例失败；把国内版调用名单改回两项 → 1 例失败；把国内版发现名单改回两项 → 2 例失败。恢复后 45 文件 395 例全绿。

### Docs

- README（中英）「暂不支持」一节改写：这类模型**会显示**，选中后得到明确的上游拒绝错误，并说明「按账号档位下发、免费账号测不到不等于付费不可用」的新策略。

## 2.5.1 (2026-10-02)

> **补上一个 2.5.0 没修完的缺口**：国际版模型目录仍比应有的少。报告人升级 2.5.0 后反馈「pro 状态 PASS、调用 PASS，但模型数量还是没取全」——复测确认，并定位到插件**从未请求过的那个 function**。

### Bug Fixes

- **国际版模型目录 11 → 17：`chat_v3` 是一个从未被请求的宽名单**（issue #19 跟进）：
  - **现象**：2.5.0 之后报告人仍看不到 `Dola-Seed-2.0-Code`、`kimi-k2.7-code`、`deepseek-v4-flash-0731` 等模型。
  - **根因**：2.5.0 只扩大了**发现侧**（remote 目录读全部组），而**最终目录 = 发现 ∩ wire**（`mergeTraeModelSources` 会剔除 join 不到 `config_name` 的模型——这是防止「显示了但一点就 4001」的保护，本身正确）。问题是插件的 wire 名单只问过 `solo_work_remote` / `solo_work_lite` / `solo_agent_remote`，而 **`chat_v3` 从未被请求**——它恰恰是名单最宽的一个：ai 区域 40 个 `config_name`（仅次于不可用于聊天的 `solo_agent` 的 43 个），并且列着一批别的 function 都没有的模型。
  - **实测（本机实时凭据，AI 区域）**：把 `chat_v3` 加入 wire 名单（**放在最后**，因此只会补缺口、不改变任何既有模型的 function 归属）后，用插件自身代码路径（`TraeSoloRemoteCatalogClient` + `TraeSoloUpstreamClient` + `mergeTraeModelSources`）跑实时上游：发现 22 → wire 51 → **最终目录 11 → 17**。新增的 6 个全部挂在 `chat_v3`：`Dola-Seed-2.0-Code`、`deepseek-v4-flash-0731`、`kimi-k2.7-code`、`deepseek-v3.2`、`gemini-3-flash-premium`、`gemini_2.5_flash_premium`；每个都用插件自己的 `prepareSoloBody` 信封逐个验证**可正常出字**（同一模型在 `solo_agent_remote` 下回 `4001 param is invalid`）。
  - **发现侧同步**：`deepseek-v3.2`、`gemini-3-flash-premium`、`gemini_2.5_flash_premium` 只出现在 `chat_v3` 组，因此 remote 目录也补问该组（否则它们根本不会被发现）。
  - **仍然不显示的**：`gpt-6-astra`、`gpt-5.6-Sol/Terra/Luna`、`glm-5.2` —— 它们在**任何** function 的 wire 名单里都不存在，对 `llm_utils_chat` 每个通道都返回 `4011`/`4001`。它们属于 Trae IDE 的内置通道，不是插件能走的 SOLO 通道；merge 剔除它们是**正确行为**（宁可没有，也不放一个点了就报错的模型）。另外 `gpt-5.5` 现在可以显示了（它在 `solo_work_remote` 的 wire 名单里，此前只是被发现侧漏读）。
  - **CN 区域故意未动**：CN 的 `solo_coder` 组确实还藏着模型（`glm-5`、`glm-5.1`、`qwen-3.5` 可调用），但它与另外三个「任何 function 都 4001」的模型（`doubao-seed-2.0-code`、`deepseek-v4-pro`、`deepseek-v4-flash`）**混在同一组**，而 merge 无法按 function 区分它们。扩大 CN 发现等于把它们一起暴露出来——正是这条 join 规则要防的事，因此留待逐个模型定出可用 function 后再做。

### Tests

- **全仓 392 → 395**：新增「ai wire 名单把 `chat_v3` 排在最后（且断言它必须是最后一位，防止将来被挪到前面抢走既有模型的 config）」、「ai 发现名单请求 `chat_v3`」、以及一条**守护 CN 不被顺手扩大**的断言（CN 名单既不含 `chat_v3` 也不含 `solo_coder`）。
- **变异验证 3 次全部被抓**：把 `chat_v3` 挪到名单最前（优先级被夺）→ 3 例失败；从 ai 发现名单去掉 `chat_v3` → 2 例失败；顺手扩大 CN 发现名单 → 2 例失败。恢复后 45 文件 395 例全绿。

### Docs

- `docs/MODEL_MANAGEMENT_DESIGN.md` 更正一处结论：2026-08-30 记的「`Doubao-Seed-Code` 不是任何 `config_name`、必须剔除」只对**当时问过的 function** 成立——它的 `config_name` 在 `chat_v3` 里且可正常调用。join 规则不变，变的是「有没有 wire」必须建立在**完整的 function 名单**上。

## 2.5.0 (2026-10-01)

> **国际版（AI 区域）三条用户可见故障的修复**，全部来自 [issue #19](https://github.com/dingminhua/dsh-connect-trae/issues/19) 的报告与
> 在真实 SG 凭据上的逐条实测（取证过程见 `docs/ISSUE19_DIAGNOSIS.md`，档位接口探索见 `docs/INTL_PAID_TIER_PROBE.md`）。

### Features

- **国际版模型目录改为读取全部组并集——此前只读 `solo_agent_remote` 一个组，另外 9 个模型从未出现**（issue #19 症状一）：
  - Trae 的 remote `/models` 答复**按 function 分组**，且组间不是互替关系：实测 `solo_agent` 组 19 个模型、`solo_agent_remote` 组 10 个。旧代码请求 `solo_agent_remote,solo_work_remote` 后**只遍历 preferred 一个组**，报告人 Trae IDE 里能看到、插件里却没有的 `GPT-6-Astra`、`GPT-5.6-Sol/Terra/Luna`、`GPT-5.5`、`GLM-5.2` 等**恰好全部在没读的 `solo_agent` 组里**。
  - 现在 `TRAE_REMOTE_DIRECTORY_FUNCTIONS` 按区域声明要请求的组（AI 区域三个全取），**每个返回的组都并入目录**，同一模型先出现者胜、只发一次。请求一个网关不认识的组是无害的（未知组名被忽略而非拒绝）。
  - **发现面变宽，调用面反而收窄**：目录 union 让模型「可见」，但模型**只能通过列出它的那个 function 调用**。实测 `get_detail_param` 对 `solo_agent` 有求必应地返回 43 条，而 `llm_utils_chat` 对**所有**以 `function: "solo_agent"` 发出的模型一律回 `code 4011`——所以 wire 函数表 `TRAE_DIRECTORY_FUNCTIONS.ai` 从 `['solo_agent','solo_work_remote','solo_work_lite']` 改为 `['solo_work_remote','solo_work_lite','solo_agent_remote']`：让目录可见的新模型仍通过真正可调用的 function 去调，`solo_agent_remote` 放最后，使两个 function 都列出的模型保持无 Remote 门禁的 IDE function。CN 区域未重新测量，维持原列表不变（union 会保留网关返回的任何组）。

### Bug Fixes

- **国际版订阅状态显示错误——Pro 会员被显示为「暂无有效套餐」**（issue #19 症状二）：
  - 卡片的判据只有 `has_package`，但那个字段回答的是「是否存在套餐权益对象」，不是「账号处于什么档位」——付费会员可以持有档位而没有套餐行，报告人的账号正是如此。
  - Trae 同时返回的**权威档位字段** `user_pay_identity` / `user_pay_identity_str`（实测免费账号为 `0` / `"Free"`）此前在插件源码里**零引用**，被直接丢弃。
  - 现在 `payStatus()` 完整保留两个档位字段（缺失时省略，不伪造），卡片判定改为 `has_package ∪ 档位非 Free`，并把档位名渲染进套餐行：「已有有效套餐 · Pro」/「暂无有效套餐 · Free」——免费用户看到**为什么**没有套餐，而不是只看到一个布尔。
  - **只有精确的 `Free`（大小写不敏感）算免费**：未知或未来的档位名按付费处理。把付费会员错标成免费，比把免费账号显示成未知档位，是伤害更大的那个错误。
- **订阅门禁错误被吞成「Stream ended without finish_reason」**（issue #19 症状三）：
  - **现象**：免费/低档位账号选中需订阅的模型（如 `GPT-6-Sol`），得到的是一句像网络故障的报错，且会被重试多次。Trae 实际返回的是 **HTTP 200** + `event:error {"code":1005,"extra":"{\"plan\":N}"}`（`extra` 是 wire 上的 JSON **字符串**，订阅门禁只体现在 `extra.plan`）。
  - **根因**：旧实现把上游答复原样以 200 转发，中途 `controller.error()` 截断流——HTTP 头已按 200 发出，`code 1005` 与 `plan` 在 HTTP 边界处丢失，pi-ai 只看到「流没给 finish_reason 就断了」，按传输故障处理。
  - **修法**：`bridgeTraeSoloStreamOrFail` 在转发前**窥探流头**——任何输出开始之前的拒绝被翻译成真实的错误结果：`1005` → `402 hard_credit`（携带 plan 与「需要付费档」的文案，`hard_credit` 是让客户端停止而非重试的语义，402 是如实的状态码），`4011` / `4001` / 未知码 → `400 client`。code、plan、以及 Trae 那句与 code 相矛盾的原文（如 4011 自称"rate limit"）**全部保留在 message 里**。
  - 输出已开始后到来的拒绝（拒绝打断正在进行的回答）：流以翻译后的可读错误终止，而不是裸截断。
  - **窥探不伤健康流**：被窥探消费的头部字节逐字节重放；队列/进度/输出等任何 Trae 自有事件即触发直通，缓冲不超过首个事件。排队事件、分片工具调用等既有行为不变。
  - **顺带登记两个此前不认识的错误码**（`grep` 证实源码与测试均零命中）：`1005` = 订阅门禁（档位不够，`extra.plan` 指明所需档位）；`4011` = 该 function 不提供此模型（其自报文案声称 rate limit，具有误导性）。已知的 `4001` = `config_name` 不被该 function 接受，语义不变。

### Tests

- **全仓 373 → 392（+19），含 5 次变异验证全部被抓**：
  - `tests/solo-bridge.spec.ts` **+11**：`describeTraeFailure` 文案 5 例（1005 带 plan、4011 用 hint 而把误导原文降级为 detail、未知码回退、无 code 事件不虚构后缀、已解包的 extra 对象也能读 plan）；`bridgeTraeSoloStreamOrFail` 策略 5 例（1005→402 `hard_credit`、4011→400 `client`、无名事件经错误码带识别、健康流含排队事件直通且头部重放逐字节不丢、输出先行后拒绝的流中场景以可读 message 终止）；`TraeSoloBridge` 端到端 1 例（完整链路上订阅门禁成为错误结果而非被截断的 200 流）。其中「流中拒绝」用分块流构造：单块 body 会被窥探一起解码，无法测到该路径。
  - `tests/card-subscription.spec.tsx` **新文件 5 例**：渲染真实卡片断言档位行——Pro 从档位单独判定、无档位时套餐行仍工作、Free 命名而非只报布尔、试用窗口优先于档位文案，及 `traePlanIsPaid` 判据表（只有精确 Free 算免费，未知档位按付费）。一例说明：无档位字符串时 badge 与 value 渲染同一裸标签，`getByText` 会命中多个元素，须用 `getAllByText`——这例测试在上一会话中断前正以多元素匹配失败，本次接续修复。
  - `tests/usage.spec.ts` **+2**：档位字段与 `has_package` 分开保留；上游不带档位时省略而非伪造。
  - `tests/solo-remote.spec.ts` **+1**、`tests/solo.spec.ts` 改写既有断言：目录 union 行为、AI 区域 function 顺序（`solo_agent` 必须绝迹）。
  - **变异验证**（确认测试有约束力，5 次全部被抓）：① 分类忽略 1005 → 2 例失败；② plan 提取禁用 → 4 例失败；③ 窥探失效（打回旧行为，即本次要修的 bug）→ 4 例失败；④ 档位恒判免费 → 2 例失败；⑤ union 退回单组 → 3 例失败。恢复后 45 文件 392 例全绿。

### Docs

- `docs/ISSUE19_DIAGNOSIS.md`（随 2.4.0 后的 `009d9a7` 提交）：三个症状的完整取证——remote 目录两组的差集与报告人 IDE 的模型逐一吻合、`user_pay_identity_str` 零引用的 grep 证据、以真实上游字节喂给 bridge 复现「截断的 200」。
- `docs/INTL_PAID_TIER_PROBE.md`（`d76800d`）：付费账号是否有专属接口的探索结论——**没有**，免费/付费同端点同目录，差别在调用时授权；含 `1005` / `4011` 的对照实验记录。

## 2.4.0 (2026-09-29)

> **包含仍未发布的 2.3.2。** 2.3.2 的 peer 范围修复（`>=0.1.7-rc.1 <0.2.0-0` → `<0.3.0-0`，见下一节）
> 只提交到 git、未推送也未发 npm，因此**没有用户拿到过 2.3.2**；2.4.0 在同一棵树上，同时带上该修复。
> 若你希望「先单独发一个只含关键修复的补丁版」，就先推 2.3.2 的 tag 并 `npm publish`，再把本节改号为 2.4.0。

### Features

- **识图能力改为跟随 Trae 自身的 `multimodal` 标注，不再要求逐一手勾**（issue #16）：
  - **原来的行为**：插件唯一决定是否给某个模型开图片输入的入口是 `applyImageSelection()`，判据只有用户手动勾选的 `imageModelIds`；上游 `multimodal` 字段虽然在 `parseTraeRemoteModel` 里被解析出来，但**从不进入 `TraeModelInfo`**，等于被丢弃。于是 Trae 自己标为多模态的模型，在这里也必须手动勾一次才认图。
  - **改后的判据**：`你手动勾选的 ∪ Trae 标注 multimodal=true 的`（新增 `traeModelAcceptsImage()` 作为唯一判据函数，`applyImageSelection()` 走它）。
  - **为什么是并集而不是"只信上游"**：上游标注是**建议**而非契约——`llm_utils_chat` 是轻量 SOLO 通道，本插件历史上多次被 `4001 param is invalid` 坑过。所以上游标注**只决定图片输入，从不决定模型可用性**：模型能否出现在目录里仍只由 wire（`get_detail_param` 的 `config_name`）join 决定，标注不会把一个不可调用的模型放进来。
  - **为什么也不"只信手动"**：Trae IDE 自己的附图按钮就是纯粹由 `capabilities.vision` 驱动的，没有任何用户开关。厂商已声明的能力还要用户再勾一次，只有本插件这一处。
  - **缺失或为 false 一律按纯文本**：`multimodal` 缺失（旧版本保存的目录、静态兜底目录）或明确 `false` 都不自动开。宁可不发，也不对能力不确定的模型谎报"支持"——一旦声明 `image`，DSH 会把图片原样发出而不是降级成文字。
  - **自动开启 ≠ 自动发图**：它只是让 DSH 允许给该模型附图；图片始终由你在对话里自己贴，插件不会替你发送任何东西。
  - **卡片同步**：被自动开启的行显示为**已勾选且只读**并带说明（新增 `row.modelImageAuto`）。并集语义下取消勾选会被立刻重新加上，给它一个可点的框是在撒谎。目前**不提供**单个模型"强制关闭"的出口（那需要额外的 opt-out 状态）；如需请在该 issue 下提出。
  - **实测结果**（本机 CN 账号，实时目录 15 个模型，用户零勾选）：8 个自动获得图片输入（`Doubao-Seed-Evolving`、`Doubao-Seed-2.1-Pro`、`Doubao-Seed-2.1-Turbo`、`deepseek-v4.1-flash`、`kimi-k3`、`minimax-m3`、`qwen3.8-max`、`qwen-3.7-plus`）；Trae 明确标 `false` 的 4 个（`glm-5.3`、`glm-5.2`、`DeepSeek-V4-Flash-Official`、`DeepSeek-V4-Pro-Official`）**正确地保持纯文本**；目录未标注的 3 个同样保持纯文本。
  - **文档**：`docs/MODEL_MANAGEMENT_DESIGN.md` 里「仅展示，不作为图片授权依据」的描述随此改动失效（该字段现在确实参与授权，但**不**决定可用性）；README 新增「图片输入（识图）」一节说明完整语义（中英同步）。

### Bug Fixes

- **`multimodal` 必须随 `lastCatalog` 一起持久化，否则"自动识图"会在保存/重启后失效**：运行时目录每次保存与启动都从 `lastCatalog` 重新推导（`derive()` → `applyImageSelection()`）。若 schema 不声明该字段，它被剥掉后自动开图会立刻退回手动。已在 `modelConfig`（`src/index.ts`）显式声明 `multimodal: z.boolean()`，并在卡片保存处显式带上——卡片原本会强制把 `input` 写回 `['text']`（这是对的，`input` 由宿主推导），但 `multimodal` 是上游事实，不能跟着一起丢。
- **README「暂不支持」表格过期**：`deepseek-v4.1-flash` 已从该表移除。`docs/DS41_CALLABILITY.md`（2026-09-15）取证时 8 个 SOLO function 全部返回 `4001`，但**上游后来把它开放到了 SOLO 通道**——当前实时目录里它带 `wireFunction: solo_work_remote`，已实测刷新确认可调用。表内其余 3 个（`glm-5.3-flash`、`kimi-k2.8-preview`、`qwen3.8-flash`）实测仍不在目录里，保留在表中。

### Tests

- **新增 6 例**（全仓 367 → 373），覆盖并集的四个方向：标注 true 自动开、标注 false 不开、缺失按不开、手动勾选永不撤销（含上游后来不再标注的情况），以及"别的模型的勾选不得串到本行"。
- **新增 2 例端到端**（走真实插件 + `ctx.llm.listModels()`）：零勾选时标注为 true 的模型 `inputModalities === ['text','image']`；标注 false 的模型仍为 `['text']`。后者同时证明**手动勾选路径没被破坏**，且旧形状（不带 `multimodal` 的 `lastCatalog` 行）仍能通过 schema 校验。
- **变异验证**（确认测试有约束力，3 次全部被抓）：① 把并集改回"仅手动勾选" → 3 例失败（含端到端那例）；② 让 schema 不声明 `multimodal` → 无法编译（弱信号，已改写为更真实的形式）；③ 在 `derive` 里于 `applyImageSelection` 之前剥掉该字段 → 端到端那例精确失败。恢复后 44 文件 373 例全绿。

## 2.3.2 (2026-09-29)

### Bug Fixes

- **插件在 DSH 0.2.0-rc.1 上整个不加载——peer 上界 `<0.2.0-0` 把 0.2.0 的预发布线一起挡掉了**（用户升级宿主后发现，2.3.1 的实际故障）：
  - **现象**：升级到 0.2.0-rc.1 后插件「凭空消失」——模型选择器里没有 `trae` / `trae-global`，插件设置卡片不见，用量路由 `/plugins/dsh-connect-trae/usage` 返回 **404**。不是某个功能坏掉，是 bundle 从未挂载。
  - **根因**：DSH 自 0.1.7-rc.1 起有一道 **bundle 级 peer 门禁**（`@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility`）：`loadProfileDirectory()` 逐条比对 bundle 自己声明的 DSH peer，任一条不满足就**抛错并整体跳过该 bundle**，只往 stderr 写一行 `skipping profile bundle ...`。本插件 8 条范围写的是 `>=0.1.7-rc.1 <0.2.0-0`，而 **SemVer 里 `0.2.0-rc.1 < 0.2.0-0`**——`-0` 这个上界本意是「排除 0.2.0 正式版」，实际却把**整个 0.2.0 预发布线**也排除了。宿主的判定是 `semver.satisfies(runtime, range, {includePrerelease: true})`，在这条范围下对 `0.2.0-rc.1` 返回 `false`。
  - **不是 0.2.0 破坏了契约**：逐符号核对确认本插件消费的 API 在 0.2.0-rc.1 上**全部未变**（`resolveRetryPolicy`、`PiAiAdapter`、`ResolvedPiAiProviderProfile`、`withFileLock`、`writeFileAtomic`、`resolveDshHome`、`AttachmentStore` 的声明逐字一致；插件触及的 `dsh-atomic-write` / `dsh-home-paths` / `dsh-attachment` / `dsh-settings` / `dsh-host-webserver` / `dsh-client-ui-slots` 源码**逐字节相同**）。同级 `dsh-connect-workbuddy` 2.1.1 写的是 `<0.2.0`——**放行 0.2.0 预发布、只挡正式版**，因此照常加载；本插件用的 `-0` 是同一意图下多写了一个 `-0`，恰好把预发布线也挡在门外。差别只在这一个字符。
  - **也不是本插件独有的现象**：本机 profile 的 19 个 bundle 里有 **5 个**同时被这道门禁拒绝（本插件、`@changfenhuang/dsh-genui`、`dsh-better-reasoning-effort`、`dsh-free-search`、`dsh-rewind-plugin`）。用宿主自带的门禁逐条判定，这 5 个全部不在挂载行里、其余全部 `active`——判定与观测逐一吻合，排除了「判定模型与宿主不一致」。
  - **修法**：8 条 peer 上界改为 `>=0.1.7-rc.1 <0.3.0-0`——放行 0.1.7 与 0.2 两条线（含各自的 alpha/rc），仍挡住未审查的 0.3 线。用宿主自己发行的门禁代码复验：0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-alpha.1 / 0.2.0-rc.1 / 0.2.0 / 0.2.9 全部放行，0.3.0-rc.1 / 0.3.0 / 1.0.0 仍被拒绝。
  - **`devDependencies` 一并升到 0.2.0-rc.1**：否则本地 typecheck / 测试验的是 0.1.7 的契约，而用户跑的是 0.2.0——「开发树与用户解析不一致」正是上一轮 `pnpm-workspace.yaml` 里为 schemastery 写过的那类隐患。
  - **为什么 CI 全绿却漏掉了**：范围写错不会让任何断言变红——`tsc` 通过（范围只是字符串）、345 条单测通过（插件自身代码没动）、`pnpm install` 通过（devDependency 钉的版本满足那段写错的范围）、CI 通过。**只有真实宿主会拒绝加载**。这个缺口已由下面的回归测试补上。

### Tests

- **新增 `tests/dsh-peer-range.spec.ts`（+22 例，全仓 345 → 367）**：把「peer 范围必须覆盖哪些运行时」变成可执行的断言，而不只是一句文档。
  - **逐条范围断言四个边界**：**必须放行** 0.1.7-rc.1 / 0.1.7-rc.2 / 0.1.9 / **0.2.0-alpha.1** / 0.2.0-rc.1 / 0.2.0 / 0.2.9；**必须拒绝** 0.3.0-rc.1 / 0.3.0 / 1.0.0。只断言「0.2.0-rc.1 能过」是不够的——那样把范围放宽成完全没有上界的 `>=0.1.7-rc.1` 也会通过。
  - **镜像宿主而不是自创判定**：宿主用 `semver.satisfies(runtime, range, {includePrerelease: true})`，本测试用同一选项，并**单独断言该选项确实是必需的**（同一条范围在默认选项下会拒绝 `0.2.0-rc.1`）——否则将来 semver 语义一变，断言会静默地不再测宿主真正做的事。
  - **点名禁止 `<0.2.0-0` 回归**：把这次故障的写法单独钉死，因为它在「整理版本范围」时很容易被误改回去。
  - **守护开发树一致性**：断言每个声明了 peer 范围的包都在 `devDependencies` 里有钉住的版本、且该版本落在自己声明的范围内；另断言 `dsh.client.inject` 里的每个客户端包都有 devDependency 钉版本。（客户端 roster 那 5 个包没有 peer 范围——宿主从自己的图解析它们，因此只断言「有钉版本」，不虚构范围。）
  - **变异验证**（确认测试真的有约束力，不是空转）：把范围改回 `<0.2.0-0` → **10 例失败**；改成无上界的 `>=0.1.7-rc.1` → **8 例失败**；把 peer 下界抬到 `>=0.2.0-rc.1` 但留下 0.1.7 的 devDependency 钉 → **8 例失败**。三次变异全部被抓住，恢复后 22 例全绿。

### Docs

- **新增 `docs/DSH_0.2.0_RC1_IMPACT_CHECK.md`**：0.1.7-rc.2 → 0.2.0-rc.1 的完整影响面核对（261 提交 / 1109 文件 / 0 处破坏性提交；插件触及的包逐字节比对；类型级与运行时值级符号核对各 0 处移除；端到端类型验证）。含方法论备注：宿主 `app.asar` 内的 payload 基准在本机实测为 `8 + headerSize`（不是常见的 `16 + headerSize`），需用条目 `integrity.hash` 做 SHA256 校验后定位，否则会读出错位数据。
- **README（中英）新增「peer 上界为什么不写 `<0.2.0`」**：给出三种写法的对照表与故障成因，说明该类错误为什么没有 CI 能拦、只能靠专门的测试。

## 2.3.1 (2026-09-26)

### Features

- **Windows 真机验证脚本 `scripts/verify-windows.mjs`**：把「Windows 上到底能不能读到 Trae 登录」从一串手工步骤变成**一条命令给出结论**。
  - **跑的是插件自己的构建产物**（`lib/`），不是重写一份逻辑——单元测试只能证明「代码在 Windows 上不崩」，因为 CI 的 windows-latest 上并没有装 Trae；真机验证要回答的是「这台机器上的 Trae 登录文件，插件读不读得到」，只有把真机文件交给真代码才成立。
  - 报告四项：① 它在这台机器上探测的**每条路径 + 文件是否存在**；② 真实账号解析解出了几个账号；③ 即将发给 Trae 的设备指纹（`x-device-type` / `x-os-version` / `x-device-id` / `x-app-version`）；④ 全部通过 / 几项未通过的结论。
  - **输出默认脱敏，可直接贴公开 issue**：Windows 用户名替换为 `<user>`（`C:\Users\<真名>\...`）、账号名与设备号只报**形态**（长度 / 是否纯数字）。脱敏而非全删是关键——`Trae CN` vs `trae-cn` 这个目录拼写正是报告唯一要查的东西，抹掉它报告就没价值。
  - 脱敏规则抽到 `src/redact.ts`（`maskUserPath` / `describeNameShape` / `describeIdShape`）并由脚本从插件导出中取用，避免「两处各写一版、改一处漏一处」。**+11 条单元测试**，既断言敏感值必须消失，也断言目录拼写/形态信息必须保留（只测「名字没了」的话，一个恒返回 `<redacted>` 的实现在测试下也会通过）。
  - 随 npm 包分发（`files` 白名单新增该单文件 8.8KB）：README 指引用户运行它，不随包则 npm 用户根本执行不了这一步。
  - **非 Windows 平台会显式说明**：脚本在 macOS / Linux 上也能跑，但会标注「当前平台非 Windows，平台相关的失败属预期」，避免被误读成兼容性缺陷。

### Bug Fixes

- **验证脚本在 Windows 上启动即崩，一条检查都跑不到**（在 Windows 真机上实测发现）：`scripts/verify-windows.mjs` 的 `loadPlugin()` 写的是 `import(join(here, '..', 'lib', 'index.js'))`，把**路径**当成 **URL** 传给了 `import()`。Node 把 `C:\...` 解析成 scheme 为 `c:` 的 URL，抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（"On Windows, absolute paths must be valid file:// URLs"）——**恰好在这个脚本唯一存在的目的平台上崩**。修法：改用 `pathToFileURL(local).href`。
  - **为什么 CI 没拦住**：`.github/workflows/ci.yml` 只跑 typecheck / test / build，**从不执行这个脚本**；而 `tests/verify-windows.spec.ts` 测的是 `src/`，脚本是个独立的 `.mjs` 入口——「代码正确」与「入口能跑起来」是两件事，这条缝隙正好够一个致命启动错误通过。这不是笔误而是覆盖盲区：对**以单文件入口形式交付**的产物，测它所调用的库不等于测它本身。
  - **回归测试**（+1 例，全仓 337 → 338）：把脚本**复制到临时目录**并配一个桩 `lib/index.js`（令 `existsSync(local)` 为真，从而精确命中崩掉的那个分支），再以**子进程**执行它，断言 ① 不出现 `ERR_UNSUPPORTED_ESM_URL_SCHEME`、② 输出走到了「结论：」而非死在加载器里。用桩而非本仓 `lib/` 是刻意的：`lib/` 不进版本库，且 CI 在**测试之后**才构建，测试不能依赖产物已存在。
  - **变异验证**：把脚本退回 `import(local)` → 该用例失败（`stdout` 为空）；确认两条 stderr 断言也真的有约束力（同一变异下 `stderr` 确实含该错误码），不是空转。
- **`[2]` 段把「已成功解出账号的那个文件」报成 `invalid`**（同一轮真机演练发现）：`TraeCredentialStore` 绑定单个 `storagePath` 时，会把该路径**同时当作桌面 `storage.json` 和 CLI token 文件各探一次**（覆盖路径的形态事先不可知，见 `candidates()`），因此直接打印 `diagnose()` 的 `failures` 会导致：① 每条路径重复出现两遍；② **刚刚成功解出账号的那个文件**被列为 `invalid`——一次按「不是存储文档」、一次按「不是 CLI token」。一台**唯一凭证已被成功找到**的机器，报告读起来却像有故障。修法：两段合并为**一次遍历**（`accounts()` 与 `diagnose()` 读同一批文件，探两遍纯属重复劳动），按路径**合并成一个结论**，命中账号的路径记为「已解出」；失败原因优先取更具体的一项（`missing` 是两种形态对不存在的文件的共同答案，非 `missing` 才说明读到了内容但被拒）。
  - 实测修正前后：`invalid [solo] ...TRAE SOLO CN\...` + 每行重复两遍 → `已解出 [solo] ...TRAE SOLO CN\...  (桌面)`，与「解出至少一个账号」的结论一致。

- **Windows 上只探测单一目录名，且这条路径从未在真机验证过**（"项目要支持 Windows"）。Trae 是 VS Code 系 Electron 应用，其每用户数据目录由安装器注册的产品名决定；插件此前在 Windows 上只按 macOS 的名字（`Trae CN` / `TRAE SOLO CN`）各探一条路径，猜错就直接「未登录」，而 `docs/WINDOWS_TOKEN_PROBE.md` 自己就写着「目录名是从 macOS 抄过来的，Windows 上实际名称未经确认」——即这条主路径从未验证，且失败时用户只看到「未登录」。
  - **依据（2026-09-26 实测 macOS 包）**：`product.json` 的 `win32DirName` 才是 Windows 侧目录名的权威字段——`Trae CN` 为 `Trae CN`（`applicationName: trae-cn`）、`TRAE SOLO CN` 为 `TRAE SOLO CN`（`applicationName: trae-solo-cn`）。因此 macOS 拼写大概率正确，但同一产品族在 Linux 用的是小写 `applicationName` 拼写，Windows 实际写哪个未验证。
  - **修法**：新增 `traeWindowsAppNames()`，Windows 侧改为**多候选并列探测**（`Trae CN` + `trae-cn`、`TRAE SOLO CN` + `trae-solo-cn`），与 Linux 侧既有的 `LINUX_APP_NAMES` 处理方式对齐；`src/identity.ts` 读 `product.json` 也共用同一份拼写表，避免「一个文件认这个名字、另一个不认」的不对称。**不再列出仅大小写不同的重复项**——Windows 文件系统不区分大小写，`trae cn` 与 `Trae CN` 是同一个目录，列两遍只会让探测清单和卡片上的「已检查的路径」重复一倍。
  - **明确未解决的部分**：Windows 真机上的实际目录名**仍然没有验证**（本机为 macOS，无 Windows 环境）。多候选只是把「猜错即失败」降级为「多一次失败的 `readFile`」，并不是验证。`docs/WINDOWS_TOKEN_PROBE.md` 保留为待真机回报的清单，并把「第二步：确认数据目录名」标为仍需执行。
  - **回归测试**（+2 例，全仓 319 → 322）：`paths.spec.ts`「探测 Windows 两种拼写」「不列出仅大小写不同的重复项」；`identity.spec.ts`「备用拼写（`trae-solo-cn`）下也能读到 `product.json`」。变异验证：`paths.ts` 退回单一目录名 → 1 条失败；`identity.ts` 退回单一拼写 → 1 条失败。

- **`src/model-cache.ts` 的缓存路径与凭据路径各自为政，在真机上指向一个不存在的目录**（Windows 真机适配检查时发现，属**潜伏缺陷**）：
  - **症状**：该模块把 `state.vscdb` 路径**硬编码为单一拼写 `Trae CN`**（macOS 与 Windows 两分支都写死这一个名字），而 `paths.ts` 早已是**多候选拼写**探测（`Trae CN` / `trae-cn`、`TRAE SOLO CN` / `trae-solo-cn`）。它**自己重算了一遍目录**，没有复用 `traeStorageCandidates`——即 2.3.1 修「多候选」时只修了登录路径，漏了这个兄弟模块。
  - **真机证据**（Windows 10.0.22621 + TRAE SOLO CN）：真实数据目录是 `TRAE SOLO CN`，而旧代码拼出的是 `%APPDATA%\Trae CN\User\globalStorage\state.vscdb` —— **该文件根本不存在**（实测 `existsSync` 为 false，而 `TRAE SOLO CN\...\state.vscdb` 存在）。**即便装了 `sqlite3` 也读不到**，与「装了 `sqlite3` 且小写拼写才失效」的初步判断相比，实际失效面**更大**：只要装的不是目录名恰好为 `Trae CN` 的版本就一定失败。
  - **为什么一直没被发现**：Windows 上 `sqlite3` 通常不存在，该调用**必然**先抛 `ENOENT`；调用方 `.catch(() => undefined)` 兜底后功能退化为「无缓存」，于是**一个错误的路径被另一个看似合理的错误（依赖缺失）掩盖**。这类「两个错误互相掩护」的情形，单看错误码永远排查不到——只有把期望的路径与磁盘实际路径对照才暴露。
  - **修法**：不再拼写目录，改为**从凭据路径推导**——`state.vscdb` 与 `storage.json` 同在 `globalStorage`，故同一个候选目录既管登录也管缓存；`traeStateDatabaseCandidates()` 复用 `traeStorageCandidates()`（单一事实来源），`raw-resolver.ts` 把命中的候选传下去。**明确带 `candidate` 时只看该 edition**：多版本共存时读另一个安装的数据库会拿到**别的账号**的模型表。选择顺序是「先看存在的，都不存在才用最可能的那条」，这样 `sqlite3` 缺失时调用方仍能看到**真实**失败，而不是被换成一个猜出来的错误。
  - **回归测试**（+7 例，全仓 338 → 345）：① 每个凭据候选的兄弟 `state.vscdb` 都必须可探测（**断言「与凭据表同源」而非硬编码期望字符串**——跟着写死拼写的测试会与 bug 一致地通过）；② Windows 上必须能找到 `TRAE SOLO CN`（旧的写死实现永远够不到）；③ 带 `candidate` 时它排第一且不越出自己的 edition；④ 大小写不同不重复列；⑤ macOS / Linux 也从各自凭据表推导；⑥ **选中的路径真的传给了执行器**（用注入的 `runSqlite` 断言 argv，否则「列表正确但查错条目」无法被发现）；⑦ 全都不存在时仍发起一次查询以暴露真实失败。
  - **变异验证**：把实现退回「硬编码单一拼写」→ **9 条中 5 条失败**；恢复后全绿。（首版变异脚本因文件是 CRLF 而静默未生效，导致测试「通过」——已加断言令变异未落地时**直接报错**，否则这种假阴性会被误读成「测试抓不到这个 bug」。）
  - **顺带修掉一个测试自身的问题**：⑥ 首版用 `path.includes('Library/Application Support')` 断言 macOS 路径，而 `join()` 在 Windows 上产出反斜杠——该测试在作者机器（macOS）通过而会在 CI 的 `windows-latest` 上失败。现先归一化分隔符再断言，这正是本项目「Windows 必须真机/win runner 验证」这条约定要防的错。

- **切换账号后无法领取签到：把「本机已签到」误判成「该账号已领取」**（用户上报）。2.3.0 的卡片与路由把 `checked_in` 与 `did_checked_in` **一并**当作「今日已领取」，于是切换账号后新账号显示「今日已领取」、按钮置灰、点不动。
  - **根因（2026-09-26 实测，两个 CN 账号 + 同一台机器 + 同一北京日）**：两个字段判定维度不同——`checked_in` 是**账号**口径（该账号今天的奖励包已存在），`did_checked_in` 是**设备**口径（这台机器的今日名额已用掉，由 `x-device-id` 决定，与是哪个账号用的无关）。切换账号后正是后者：设备名额已用，而当前账号**没有拿到任何奖励**——此时说「今日已领取」把「没领到」说成了「已领到」。（详见 `docs/USAGE_API_RESEARCH.md` 新增的「决定性修正」一节，含四组请求头对照表。）
  - **实测要点**：账号 A（当天已领取）与账号 B（当天未领取，无 `checkin_20260926_*` 奖励包）带**同一真实设备号**读状态，两者都返回 `did_checked_in:true`；不带该头、带合成号、或带本机另一安装的设备号，两者都返回 `false`；同一合成号连读三次也不会变 `true`（所以它不是「读过就算」的标记）。账号 B 带真实设备号 `claim` → `{"code":9095,"message":"当前设备今日已经签到，请明日再来哦～"}`，**未发放**，且 `total/consumed` 前后逐字节相同（`1900 / 1522.85`）。官方 NLS 文案 `2345 -> 该设备今日已参与签到` 亦为设备口径。
  - **修法**：`checked_in` 成为唯一的「今日已领取」（账号口径）判据——已领取才直接返回 `alreadyCheckedIn` 且不发请求；`did_checked_in` 且未领取时，路由返回新的 `deviceCheckedIn: true`（不再谎报 `alreadyCheckedIn`），卡片保持按钮禁用但改说「本机今日的签到已用掉」并说明可换设备 / 明天再来；上游以 `9095` 拒绝时（窗口竞争）同样按 `deviceCheckedIn` 处理，**不当成失败**——那是一条上游规则，不是插件故障。
  - **回归测试**（+4 例，全仓 316 → 319）：路由侧「设备已签但账号未领 → 不发请求且返回 `deviceCheckedIn:true` / `alreadyCheckedIn:false` / `code:9095`」「上游 9095 → 按设备已满上报而非错误」，卡片侧「设备已签不显示『今日已领取』且显示设备说明」「路由回 9095 时显示设备说明而非『签到失败』」。做过**变异验证**：把路由的 `checkedIn || didCheckedIn` 复原 → 1 条失败；把卡片的两个字段合并 → 1 条失败；删掉路由的设备守卫（照发请求）→ 1 条失败。

### Tests

- **Windows 真机验证脚本的三处可用性缺陷**（在真正按「Windows 用户拉代码 → 跑脚本」的流程演练时发现，全部是脚本自身的问题）：
  - **空机器误报「解出 1 个账号」**（最严重）：`TraeCredentialStore` 不传 `storagePath` 时会按 `process.platform` 扫描**宿主**目录，于是在一个刻意清空的 HOME 上，脚本从开发者本机解出了凭证——即「断言在一台没有任何 Trae 的机器上找到了 Trae」。这是本脚本可能产出的最误导性结果，因为它恰好会被读成「Windows 能用了」。修法：每个候选都**绑定到它自己的路径**，绝不回退到宿主扫描；并新增 4 条回归测试（`tests/verify-windows.spec.ts`）锁死该性质，变异验证：让 store 忽略固定路径 → 2 条失败。
  - **`[1]` 与 `[2]` 可能描述不同机器**：`[1]` 列的是 win32 候选，`[2]` 却扫宿主平台目录。现在两段同源，且 `[2]` 逐候选诊断并给出**命中路径**归属。
  - **未构建时的报错不可用**：`lib/` 不进版本库，拉代码后直接跑脚本会撞 `ERR_MODULE_NOT_FOUND` 堆栈。现在明确提示「这是源码 checkout、需要先 `pnpm install && pnpm run build`」，并以退出码 1 结束（实测）。
- **CLI-only 场景的两处误判**：① 身份解析误把 CLI token 当 `storage.json` 解析而抛 JSON 错——`resolveTraeIdentity` 的 CLI 兜底**只在文件不存在时**触发，故 CLI 候选改用 `readTraeCliIdentity` 直连；② `x-app-version` 缺失被计为失败，但那只是少一个请求头（登录/聊天/签到均不受影响），会让一台完全可用的机器报「未通过」，现改为 `[INFO]`，并对 CLI 候选改用不同措辞（CLI 从 `ide_version.json` 取版本，而非 `product.json`）。
- **修复 Windows CI 的冷启动超时抖动**（CI #60 失败，同一份代码在 #59 / #61 通过）。`windows-latest` 上每个测试文件的**第一个**用例会吃到一次性的模块转换成本，超过 vitest 默认的 5000ms：
  - 实测（#60，该次仅改 `.md`，代码与通过的那次逐字节相同）：`identity.spec.ts` 首个用例 5179ms 超时、同文件后续用例 6–60ms；`card-checkin.spec.tsx` 首个用例 9435ms 超时、后续 50–196ms；该次总计 `transform 17.71s / import 24.28s`。
  - **判定为抖动而非缺陷的依据**：只有每个文件的第一个用例受影响，同文件其余用例均在毫秒级；且同一份代码在前后两次 CI 均通过。
  - **修法**：`vitest.config.ts` 设 `testTimeout: 20_000`，**不动任何断言**。已验证超时机制仍生效（用一个必然挂起的探测用例确认仍会失败，探测文件随后删除）。
  - **明写在配置注释里**：不得用「放宽断言」的方式消除超时——若某个原本很快的用例在**所有**平台上都开始超时，那是真实回归，改这个数字不是答案。

### Docs

- **Windows 真机验证取得首个通过结果，README / 验证指引的「未验证项」措辞随之收敛**：此前 README（中英双语）与 `docs/WINDOWS_VERIFY_GUIDE.md` 都以「Windows 上 Trae 数据目录的实际名称尚未在真机确认过」为前提写成，而现在已有真机证据，把这句话留着就是反向的失真（本项目对「未验证项不得写成既成事实」有明确要求，反过来把**已验证项**写成未验证同样会误导）。
  - **实测结果**（Windows 10.0.22621 + TRAE SOLO CN，`node scripts/verify-windows.mjs` 退出码 0）：命中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json`；解出 1 个账号（`solo`/`cn`）；`x-device-type: windows`；`x-os-version: Windows 10.0.22621`；`x-device-id` 为 16 位纯数字（来自数据目录，**非**兜底哈希）；`x-app-version: 0.1.56`（取自 `%LOCALAPPDATA%\Programs\TRAE SOLO CN\resources\app\product.json`）。
  - **确认的是**：`product.json` 的 `win32DirName` 作为 Windows 目录名依据**是对的**——`TRAE SOLO CN` 确实是真机上的实际目录名；安装路径推导与设备指纹四个字段也都成立。即「Windows 上插件读得到 Trae 登录」由真机证据支持，不再是推断。
  - **仍然未验证的是**：`Trae CN` / `trae-cn`（中国版）两个拼写——那台机器只装了 SOLO 版。README 与验证指引都**明确保留**这一条并说明「它在此机器上不存在只反映本机没装该版本，不代表拼写有误」，避免读者把「本机没命中」误读成「拼写错了」。
  - 因此平台支持表的 Windows 行由「目录名见下方『未验证项』」改为「**已在一台真机通过验证**」，并新增「真机验证结果」小节逐项列出实测值；`docs/WINDOWS_VERIFY_GUIDE.md` 删去「本机（macOS）无法执行这一步」的旧前提，改为状态节 + 实测输出样例；`docs/WINDOWS_TOKEN_PROBE.md` 文首改用状态更新说明，并在第二节与「已知问题」逐条标注哪些已由真机确认。
  - `docs/WINDOWS_VERIFY_GUIDE.md` 的样例输出**改为真实输出的形态**（含 `[2]` 段一行一个候选的写法与退出码 0/1/2 的含义），此前的样例是示意性的，与实际输出格式已有偏差。
- **验证脚本的检查范围被明确划出，并补跑脚本之外的主流程实测**：`verify-windows.mjs` 的六项**只覆盖路径探测与设备指纹**，把它读成「整个插件在 Windows 上没问题」是过度外推。因此同一台真机上另外直接调用 `lib/` 导出跑了主流程：
  - `TraeCredentialStore.resolve()` ✅ 返回凭据（host `https://api.trae.cn`）；`identityHeaders()` ✅ 10 个请求头全部生成；只读用量查询 ✅ 9 个积分包（总额 2050 / 已用 1522.85）；只读模型目录 ✅ **42 个模型**；`writeFileAtomic` ✅ 写入回读一致；并发 `withFileLock` ✅ **8 并发串行化且无丢失更新**（此前 README 只写「宿主原生处理 Windows 独占创建语义」，现改为**实测成立**）；`SSE` 解码 ✅ 按 `\r?\n` 切分，CRLF 与分块均支持。
  - **实测确认了一处已知限制的真实行为**：`model-cache` 的 `sqlite3` 在本机不存在，抛 `ENOENT`（`spawn sqlite3 ENOENT`），调用方 `.catch(() => undefined)` 正确兜底，主流程不受影响——README 原写「会失败并安全回退」，现补上错误码作为依据。
  - **顺带发现并修掉一处真实精度缺口**（详见下方 Bug Fixes）：`src/model-cache.ts` 在 Windows 上把 `state.vscdb` 路径**硬编码为单一拼写 `Trae CN`**（`paths.ts` 是多候选 `Trae CN` / `trae-cn`），且该模块自己重算了一遍目录而没复用 `traeStorageCandidates`。本机真实目录名是 `TRAE SOLO CN`，旧代码指向的 `...\Trae CN\...\state.vscdb` **根本不存在**；只因 `sqlite3` 缺失、该调用必然失败并兜底，才把一个**错误的路径**藏在「依赖缺失」这个看似合理的错误后面。
  - 以上「脚本之外」的实测结果同时写入 README（中英）与 `docs/WINDOWS_VERIFY_GUIDE.md`，与脚本自身那六项**分表列出**，不让读者混淆两者的证据强度。
- **`docs/WINDOWS_TOKEN_PROBE.md` 的「已知的其他 Windows 问题」整节已过期**：其中两条（`product.json` 硬编码 macOS 路径、`osVersion` 拼成 `win32 <release>`）**在代码里早已修复**，文档却仍写成未解决的缺陷——按它排查会把 Windows 用户引向错误方向。已复核并改写为「已处理 + 当前实现」，同时补上「Windows 安装/数据目录名仍未验证」这一条真实缺口，以及 `mode: 0o600` 在 Windows 被忽略属已知无害。
  - 该文档**改为「先跑脚本」**：手工五步降级为「脚本跑不起来时的备选路径」，并把第二步（数据目录名）更新为当前的**多候选拼写**清单与依据，明确「这一条是本次要查的核心」。
- **README 明确 Windows 支持，并把「以后都要考虑 Windows」固化为开发约定**（"我们的项目要支持 Windows 的" / "之后都要考虑对 Windows 的影响"）。
  - README（中英双语）新增**平台支持表**（macOS ✅ 完全支持 / Windows ✅ 支持 / Linux ✅ 支持），并在开头段落明示「支持 macOS、Windows 与 Linux」+ CI 双平台矩阵，让 Windows 支持成为对外可见的承诺而非隐含行为。
  - 「Windows 说明」节**改写为与代码逐条对应**：账号目录（多候选拼写探测 + 与安装目录无关）、应用版本头（含 `LOCALAPPDATA` 回退）、设备指纹（`x-device-type: windows`、`Windows <release>`）、文件锁（宿主原生处理）、Raw Chat 的 `sqlite3` 限制、权限位被忽略。**每条都核对了代码位置后写入**。
  - **删掉一句未经验证的断言**：原文写「目录名与 macOS 一致，**无需额外配置**」——而 `docs/WINDOWS_TOKEN_PROBE.md` 自己就说该目录名从未在真机确认。这正是本项目反复强调的「不得把未验证项写成既成事实」，故改为「未验证项（欢迎回报）」小节，说明依据是 `product.json` 的 `win32DirName`、兜底是 `applicationName` 拼写，并给出回报路径与 `authFile` 临时绕法。
  - `DEVELOPMENT.md` 新增「**多平台要求（Windows 为长期支持目标）**」一节：给出平台相关面/无关面的分区表（路径解析与设备指纹为相关面，其余共用），以及 6 条改动强制检查项——新增路径必须带平台分支且多候选、不得用仅大小写不同的重复候选、新增外部命令依赖须确认 Windows 行为并登记限制、CI 必须在 `windows-latest` 通过、平台结论必须区分已验证/未验证、文档同步。这条约定使「考虑 Windows 影响」成为可执行的检查项而非口头要求。
  - **顺带修掉一处链接会在 npm 页 404 的问题**：本次新增的「未验证项」指引用户去看 `docs/WINDOWS_TOKEN_PROBE.md`，但 `package.json` 的 `files` 白名单（`RELEASING.md` 有明确记载，属有意的包体控制）只放行 `docs/assets/` 下那张截图，**所有 `docs/*.md` 都不进 npm 包**——写成相对 Markdown 链接会在 npm 页面上 404。既有引用（`docs/IMPLEMENTATION_PLAN.md` 等）用的是反引号纯文本故不受影响，本次改为指向 GitHub 的绝对链接（实测 HTTP 200）。
  - `RELEASING.md` 的打包内容清单同步更新（新增 `scripts/verify-windows.mjs`），并记下两条纪律：该脚本必须随包（否则用户无法执行验证步骤）、`docs/*.md` 不进包故 README 引用必须用绝对链接。


## 2.3.0 (2026-09-25)

### Breaking Changes

- **只支持 DSH 0.1.7-rc.1 及以上，不再支持 0.1.7 之前的宿主**。2.2.0 用「双线 + 运行期能力探测」同时服务 0.1.5 与 0.1.7；0.1.5 线的设置面（`installSection` / `settingsScope` / `settings.plugin.item` / 非 volatile 写入）与 0.1.7 的新模型**互不相交**，保留它意味着每条路径都要背两套契约。从本版起删除全部 0.1.5 分支，`peerDependencies` 与 `devDependencies` 一并收窄到 `>=0.1.7-rc.1` / `0.1.7-rc.1`（`cordis >=4.0.4`、`schemastery >=3.18.4`）。做法对齐同级 `dsh-connect-workbuddy`（其 2.1.0 起的 0.1.7-only 改造）。

### Bug Fixes

- **0.1.7 上 provider 被判「未配置」——命名空间必须用宿主服务的那个**（对齐 workbuddy 2.0.16 的实测）。0.1.7 的 `SettingsForms.describe()` 以 **Loader 条目 id** 为键，harness 对 provider 的命名空间做**精确匹配**查表（`namespaces.get(entry.settingsNs)`）。此前硬编码 `settingsNs: 'trae'`，而桌面宿主实际以 `dsh-connect-trae`（或 `include:dsh-connect-trae`）挂载条目，于是查表落空、provider 读作「未配置」，**配置入口与模型发现静默失效**、不报错。
  - **修法**：新增 `settingsNamespaceOf(ctx)`，采用一线插件（`dsh-llm-pi-ai`）的权威范式 `const settingsNs = ctx.fiber.entry?.options.id ?? TRAE_SETTINGS_NS`，`registerConfigurableProviders` 与 `registerModelDiscovery` 全部改用解析值；`ctx.fiber.entry` 由 Loader 注入（非 Cordis 公共类型），保留探测 + 回落到 `'trae'`。
  - **回归测试**（`tests/settings-integration.spec.ts`，+4 例）：采纳 Loader 条目 id、无条目/空 id/非字符串时回落、以及**目录实际宣告的就是解析值**（断言目录条目而非常量，否则恒过）。
- **移除宿主端 `installSection` 双路径，`configure({auto}, owner)` 成为唯一路径**（对齐 workbuddy 的 0.1.7-only 写法）。0.1.7 的 `SettingsForms` 删除了 `installSection`；2.2.0 按能力探测两条路径，本版起无条件调用 `configure`，且把返回的 disposer 挂进 `ctx.effect()`——否则展示策略泄漏到插件销毁之后（一线插件同款：`child.effect(() => child.settings.configure({ auto: false }, …))`）。随 `installSection` 一起删除 `legacyInstallSettingsSection` / `sectionHooks` 及其对 `@deepseek-ai/dsh-settings` 命名空间的依赖。
- **客户端设置面只走 `configForms`**（对齐 workbuddy 的 0.1.7-only 写法）：删除 `settingsScope.bind` 回退分支与 `settings.plugin.item` 槽位注册，只保留 `configForms.get(entryId)` + `plugins.bundle.config` / `plugins.row.config` 两个槽位。`inject` 维持 `['slots', 'locale']`，设置面仍经 `ctx.get()` 软探测。
- **卡片的 `view` 行为不再按双线区分**：`page` 视图默认展开、无 `view` 默认折叠；`set()` 契约收窄为 `Promise<boolean>`（0.1.7 表单返回显式布尔，`false` 即拒绝）。
- **区域开关等设置保存被宿主拒绝（`No configurable plugin entry "trae"`）——客户端命名空间绑定必须跟随 describe 镜像**。卡片此前在 `apply()` 时**一次性**解析命名空间：describe 镜像异步加载，且在运行中的 profile 里新增插件条目（本插件正是这种场景）时，镜像首次 describe 可能早于条目出现；`/trae/i` 匹配落空就**永久**回落到声明的 `'trae'`。`configForms.get('trae')` 把表单控制器永久绑到该 ns——宿主 `configEditor.entries()` 里没有 `options.id === 'trae'` 的条目，每次写入都抛 `No configurable plugin entry "trae"` 被拒；而控件仍可点（controller 对「ns 不在镜像」的派生沿用全局 `writable=true`），表现为「开关翻过去又弹回」。
  - **修法**：设置面改为**可重绑代理**——`getSnapshot` / `set` 转发到「当前」控制器；别名解析（`served.ns`，`/trae/i` 匹配）在 apply 时尝试一次，并订阅镜像（`describe().subscribe`）在每次变化后重绑；镜像已就绪但缺条目时**一次性**触发 `describe().load()` 补拉（此后宿主 `settings/document-updated` 事件保持新鲜）。绑定前代理返回 `writable: false`，卡片只读而非提供必定失败的控件。
  - **回归测试**（+3 例）：激活测试的镜像桩改为真实形状（`ns: 'dsh-connect-trae'`，即 patch id，非声明的 fallback），断言绑定到 `dsh-connect-trae`；新增「镜像在 apply 后才出现条目 → 重绑到正确 ns」与「一次性 nudge 补拉镜像」两例。测试桩此前的 `ns: 'trae'` 恰好把 fallback 当成了正解，是这条缺陷没被 CI 拦住的原因之一。
- **插件管理页 / 市场页的 logo 显示不对**（默认占位/空白，对齐 workbuddy 2.0.17 的实测）。0.1.7 的插件管理页从插件包 `package.json` 的 `icon` 字段读图标（`dsh-client-ui-plugin-manager` 渲染 `row.meta?.icon`），此前没有声明该字段 → 宿主无图可用。
  - **修法**（照同级 `dsh-connect-workbuddy` 的做法）：新增 `icons/` 目录（64px + 128px 真实 PNG，其中 64px 与既有卡片内嵌 base64 逐字节一致——同族 LD logo），`package.json` 声明 `"icon": "icons/dsh-connect-trae-128.png"`，并把 `icons` 加入 `files` 白名单随包分发。
  - **验证**：`npm pack --dry-run` 确认两个 PNG 进包（12 → 14 文件）。
- **模型倍率改回「wire 权威、Remote 兜底」，恢复折后价显示**（回归：b8f09bc 重构时误删 1.4.2 的 `display_contact_config` 解析）。`get_detail_param` 每行的 `display_contact_config`（第二层 JSON）里的 `consumption_rate.data.rate` 才是 Trae IDE 渲染的**折后价**；Remote 目录的 `consumption_rate` 在限时折扣下会报**未折价**（Seed-2.1-Pro：IDE `x0.08` vs Remote `0.80`，差 10 倍）。b8f09bc 改成多 function 并集时把这个解析连带删掉，倍率从此退化成 Remote 值。
  - **修法**：`solo.ts` 恢复 `wireCreditMultiplier()`（读 `display_contact_config.consumption_rate.data.rate`，`enable` 为真且为正有限数时取值，缺失/损坏留空不虚构），`TraeSoloModel` / `TraeWireModel` 增列 `creditMultiplier`；`mergeTraeModelSources` 合并时 **wire 优先、Remote 兜底**（wire 未提供才用 Remote）。
  - **国际版（ai）区域**：实测（2026-09-25 只读探测）国际版上游任何目录都不含 `consumption_rate`（订阅制，只有 `cost` 标签与 `manual_usage: 0|1`，官方 App 也只渲染「Lite-friendly」这类标签而非数值倍率），因此 ai 模型行按「解析不出则留空」保持不显示倍率——不虚构数值。
  - **回归测试**（+2 例）：`solo.spec.ts` 断言 wire 解析出折后价、缺失时不虚构；`catalog.spec.ts` 断言合并时 wire 优先、Remote 兜底、双缺留空。变异验证：把合并改回只读 Remote → 新用例立即失败。

### Dependencies

- `peerDependencies`：全部 `@deepseek-ai/dsh-*` 收窄为 `>=0.1.7-rc.1 <0.2.0-0`；`@deepseek-ai/cordis` 收窄为 `>=4.0.4 <5.0.0`；`@deepseek-ai/schemastery` 收窄为 `>=3.18.4 <4.0.0`（`volatile()` 自 3.18.3 起才有）。
- `devDependencies`：全部 `@deepseek-ai/dsh-*` 与 `cordis` / `schemastery` 升到 0.1.7-rc.1 线，开发树与用户解析一致。
- `tests/settings-integration.spec.ts` 的 settings 测试替身改为 **0.1.7 形状**（`SettingsForms` 语义的内存服务：`configure` + `describe` + 只写 volatile 字段的 `update` + `loader/volatile-update`），插件以**活引用配置**（volatile 字段 = `{get(): T}` 指向同一份文档）挂载，模拟真实宿主的写入→重放路径；原先写非 volatile 扁平字段（`lastCatalog` / `imageModelIds` / `enabledModelIds`）的用例改为写 `regions.cn` 槽位——正是 0.1.7 写入门接受且卡片实际采用的形状。

### Tests

- 310 → 316。移除 0.1.5 形态用例（client-activation 的 `settingsScope` 宿主、client-fallback 的 `settingsScope.bind` 回退、card-region-switch 的 void 返回契约），新增 4 例 `settingsNamespaceOf`、3 例命名空间重绑/补拉、2 例 wire 倍率解析与合并优先级。`pnpm run check`（typecheck + test + build）全绿。

## 2.2.0 (2026-09-24)

### Bug Fixes

- **支持 DSH 0.1.7 线，且同一个构建同时服务 0.1.5 与 0.1.7**（修复 [issue #13](https://github.com/dingminhua/dsh-connect-trae/issues/13)）。这不是「多支持一个版本」的可选增强——**在 0.1.7 上插件的浏览器半侧此前根本不激活**：

  ```
  web boot: 1 entry did not activate
  dsh-connect-trae: pending (waiting for service: settingsScope)
  ```

  - **根因：`settingsScope` 被整个移除，而 Cordis 的依赖闸门是硬闸。** DSH **0.1.7-alpha.1** 起客户端设置服务换成 `configForms`，`settingsScope` **不再存在**（不是弃用、没有兼容层；0.1.6-alpha.2 还有，0.1.7-alpha.1 起包内已无此符号）。插件 `inject` 里仍声明它，于是 fiber 永远停在 `PENDING`——**不是某个功能坏掉，是整个客户端插件不激活**，因此「重新登录」「重装插件」一概无效。修法与 workbuddy 一致：`inject` 收窄为两条线都有的 `['slots', 'locale']`，设置面改由 `ctx.get()` **按能力软探测**（属性访问会抛 `cannot get property X without inject`，`?.` 挡不住；`ctx.get` 对缺失服务返回 `undefined`）。
  - **0.1.7 上另有三处断裂，issue 只报了第一处。** 逐项对照 workbuddy 的实测（该仓库已用同一套适配跑通 0.1.7）：

    | # | 位置 | 0.1.5 | 0.1.7 |
    |---|---|---|---|
    | 1 | 客户端设置服务 | `settingsScope` | `configForms` |
    | 2 | 客户端槽位名 | `settings.plugin.item` | `plugins.bundle.config` / `plugins.row.config` |
    | 3 | 宿主端注册 | `installSection()` | `configure({auto}, owner)` |
    | 4 | schema 可写声明 | 无需 | 必须标 `volatile()` |
    | 5 | primitives 图标名 | `…Outline14` | `…OutlineRegular` |

  - **第 2 条（槽位名）最容易被漏掉**：两条线声明的槽位集合**互不相交**（0.1.5 只有 `settings.plugin.item`；0.1.7 只有 `plugins.*`）。就算设置服务改对了，槽位名不改卡片依然渲染不出来。现在三个槽位**各自独立 try/catch** 逐个注册——一条线上不存在的槽位不能把另一条线的注册一起带走。
  - **第 3 条（宿主端）在 0.1.7 上是静默失败**：`installSection` 被 `SettingsForms.configure()` 取代。由于该调用位于嵌套的 `ctx.inject` 回调内，抛出的 `installSection is not a function` 落在**那个子 fiber** 上——外层插件照常加载、两个 provider 照常注册，**但 `trae` 设置命名空间从未注册**，表现为卡片设置区无声消失。现在按能力探测：有 `configure` 走 `configure`，否则回落 `installSection`。
  - **第 4 条（易失声明）**：0.1.7 的 settings 写入门要求插件 schema 把可写字段标为 volatile，否则**写入被直接拒绝**（`Plugin entry "trae" has no volatile fields`），而 `scope.set()` 却正常 resolve——用户会看到开关翻过去又静默复原。新增 `asVolatile()`：运行时探测 `schema.volatile()`，**有则调用、无则退化为 identity no-op**（`volatile()` 自 schemastery 3.18.3 起才有，0.1.5 线锁在 3.18.2）。**故意不手写 `meta.volatile = true`**——那会绕过 schemastery 自身的 `validateVolatileSchema` 校验，产出一个它自己都不认的 schema。
  - **0.1.7 以「活引用」交付配置值。** 该线把 volatile 字段以 `{get(): T}` 形式交给消费方；不解包则 `config.regions`、`value.accounts[region]`、`config.authFile` 静默变成对象或 `undefined`，表现为「设置明明写了却读不到」。更隐蔽的是**展开一个活引用得到的是 `{get: <function>}` 而不是值**——卡片「写一个区域、保留另一个」的合并会因此**丢掉兄弟区域并把函数泄进设置文档**。新增 `unwrapVolatile()` / `unwrapVolatileDeep()` 并在所有读取与合并路径上解包，同时监听 `loader/volatile-update` 在每次写入后重读选择。
  - **第 5 条（图标）会让整个客户端包挂掉**：两条线 primitives 的图标名不重叠（`IconChevronDownOutline14` vs `IconChevronDownOutlineRegular`），**没有任何一个静态 import 能同时服务两边**——静态导入 0.1.5 的名字会让 0.1.7 上的客户端包解析失败，整个卡片随之消失。折叠箭头改为**纯 CSS caret**（`border` + `rotate`），与版本无关。
  - **设置写入改为「写入后回读校验」**：`set()` 的 promise resolve **不代表值已落盘**（0.1.7 上被拒绝的写入会重新加载 Host 状态然后正常返回，0.1.5 上则可能被文件占用丢弃）。四处写入（账号选择、账号重扫、区域开关、模型目录）统一走 `writeSettingsField()`：写入后回读，未落盘即抛错并在卡片上明确显示，而不是「点了没反应」。0.1.7 的 `set()` 还会返回显式布尔值，`false` 同样按拒绝处理。
  - **卡片的 `view` 属性**：0.1.7 的插件管理器通过 owner props 向每个配置条目索取两种视图（`summary` 一句话简介 / `page` 带保存控件的完整表单）。卡片接受该属性并在 `page` 下默认展开——否则在 0.1.7 的插件页里卡片会是折叠的一行。
  - **开发环境的 schemastery 从 3.18.2 提到 3.18.4**（`pnpm-workspace.yaml` 的 override，与 `devDependencies` 对齐）。此前 dev 树锁在 3.18.2，那里没有 `volatile()`，`asVolatile()` 退化为 no-op——**于是 volatile 真正生效的那条路径（每个 0.1.7 用户都会走的那条）在本地从未被执行过**，这类缺陷可以同时躲过评审与 CI。这与 workbuddy 记录的教训同源。

### Tests

测试总数 282 → 310。

- **新增 `tests/client-activation.spec.tsx`（3 例，本次最关键的一组）**：用真实的 cordis `Context` **启动真实的客户端入口模块**，分别对 0.1.7 形态（有 `configForms`、**无** `settingsScope`）、0.1.5 形态（有 `settingsScope`、无 `configForms`）、以及**两者都没有**的形态断言 fiber 到达 `ACTIVE`、槽位注册齐全、scope 取自正确的服务。之所以能直接导入真实入口，是因为它运行期只依赖 React 与本地文件，所有 DSH 包都是**类型导入**、构建时即被擦除。
  - 此前 `client-fallback.spec.ts` 抓不到这个缺陷：它**手工镜像**入口函数体，因此验证的是「思路」而**从不执行真实的 `inject` 数组**——而恰恰是那个数组让 fiber 卡在 PENDING。
  - **变异验证**：把 `inject` 改回 `['slots','locale','settingsScope']`，0.1.7 与「无设置面」两例立即变红（fiber 停在 0/1，永远到不了 `ACTIVE`），0.1.5 那例仍绿——精确复现了 issue 报的现象。
- **新增 `tests/dsh-017-compat.spec.ts`（13 例）**：活引用的单层/深层解包、数组与嵌套、**不就地改写调用方对象**；`regionEnabledOf` / `regionStateOf` / `regionEnabled` 穿透活引用读值；合并时**保留兄弟区域且不泄露函数**；`asVolatile()` 的两条分支按运行时能力确定性断言；以及**宿主端 `configure()` 优先于 `installSection()`**（用一个只有 `configure` 的真 Service 装配，断言走的是 `configure({auto:true})` 且没有 `installSection` 报错）。
  - **变异验证**：把 `configure` 探测改回无保护裸调 `installSection` → 1 条立即变红；把 `nextRegionSlots` 的深解包去掉 → 1 条立即变红。
- `client-fallback.spec.ts` 的镜像同步更新，并补 2 例：**两条线都提供时 `configForms` 优先**（0.1.7 的写入闸门只认它），以及 **`configForms` 缺席时回落 `settingsScope.bind()`**。
- **`card-region-switch.spec.tsx` 新增 8 例**（渲染真组件、点真按钮）：穿透活引用读区域开关；合并时**保留兄弟区域且不泄露函数**；Host 明确拒绝（`set()` 返回 `false`）与**「接受了但没落盘」**（`set()` 返回 `true` 而文档未变）两种失败都必须显式报错；0.1.5 的 `void` 返回视为成功；`view: 'page'` 时默认展开、无 `view` 时默认折叠；无设置面时渲染为只读。
  - **变异验证**：去掉 `regionsMapOf` 的解包 → 1 条失败；去掉 `view` 判断 → 1 条失败；去掉 `false` 判断 → 0 条失败（回读校验兜住了，说明两层防护确实互补）；去掉回读校验 → 1 条失败；**两层都去掉 → 1 条失败**。
  - 顺带移除了该文件对 `dsh-client-ui-primitives` 的整包 `vi.mock`：图标已改纯 CSS，不再需要这个桩。

**双版本验证**：同一份代码在 schemastery **3.18.4**（volatile 生效）与 **3.18.2**（no-op 分支）下**均为 310 通过**。

## 2.1.0 (2026-09-24)

### Features

- **新增「每日签到领取」**（对齐 `dsh-connect-workbuddy` 的签到能力）：
  - **交互**：国内版卡片在积分面板下方多一行签到：显示每日奖励（基础 + 额外，本机实测 `150 + 50`）与一个「立即领取」按钮；领取中显示「领取中…」，当日已领取显示「今日已领取」并禁用。国际版没有签到活动，因此**不显示该行**。
  - **这是插件里唯一的写操作**，也是唯一会改变账号状态的调用（`POST /trae/api/v2/ug/checkin_credits/claim`）；其余查询全部只读。README 顶部与特性列表都按此措辞改写，不再把整个用量面板称为「只读」。
  - **根因级发现：缺 `x-device-id` 会被静默拒绝**。同一份 Authorization，只加这一个头，结果从「HTTP 200 + 业务码 `9004`（The submitted order parameters are incorrect）」变成「`code: 0`，奖励到账」——**HTTP 状态始终是 200**，只看状态码会把它误判为成功。设备号取自本机 `iCubeAuthInfo://icube-dc:<id>`，即 `identity.ts` 里聊天通道同源的那个 `deviceId`（官方客户端在 `main.js` 的 `fb(headers)` 里给每个 ug 请求都补上它）。`deviceId` 由 `index.ts` 惰性注入；读不到时降级为不发该头——**只影响领取，不影响状态查询**（状态接口两种情况下都正常返回）。
  - **领取前的守卫比上游更强**：路由 `POST /plugins/dsh-connect-trae/checkin` 仅接受 POST、仅接受回环来源、仅服务 `cn` 区域，并且**先读状态**——已领取（`checked_in` 或 `did_checked_in` 任一为真）就直接返回 `alreadyCheckedIn` 且**根本不发领取请求**；活动关闭答 409。国际版直接答 404 并说明原因，而不是把上游的 HTML 404 当成网络故障抛给用户。
  - **已实测上游按北京自然日幂等**：重复领取仍回 `code: 0`，而权益总额（`total=1600, consumed=390.8`）逐字节不变，**不会重复发放**。插件仍然自行守卫——「不会重复发放」是上游的行为，不是插件可以依赖的保证。
  - **业务拒绝不当成故障**：`claimed: false` + 原始业务码与 message 原样回给卡片并显示出来，而不是包成 500。否则用户只会看到「领取失败」，而丢掉唯一能解释原因的 `9004`。
  - **对齐官方客户端的状态判定**：`checked_in` 与 `did_checked_in` 是两个独立字段，官方在「今日已领取」判定上也参考后者，插件据此保持按钮禁用。~~插件在卡片与路由两侧都按同一规则判定~~ —— **注：这里的口径在 2.3.1 被修正**。当时把两者一并当作「今日已领取」是**错的**：`did_checked_in` 实际是**设备**口径（`x-device-id`），不是账号口径，切换账号后会谎报「已领取」。以 2.3.1 为准；`extra_credits` 的展示（避免把当天实际到账的 200 说成 150）保持不变。
  - 卡片新增 8 条真实点击测试（`tests/card-checkin.spec.tsx`，渲染**真组件**、`fireEvent.click` 真按钮、断言真发出去的请求），`usage.spec.ts` 补 6 条、`web-status.spec.ts` 补 7 条，共 21 条新测试（全仓 261 → 282）。做过**变异验证**：去掉路由的 `did_checked_in` 守卫 → 2 条失败；去掉卡片的同款判定 → 1 条失败；把卡片的 `POST` 改成 `GET` → 1 条失败；删掉「已领取则不发请求」的守卫 → 2 条失败。（其中针对 `did_checked_in` 的两条断言在 2.3.1 按其真实语义重写。）
  - 取证与接口契约：`docs/USAGE_API_RESEARCH.md` 新增「每日签到领取」一节（含决定性请求头对照表、幂等性实测表、区域限制与官方字段语义）。

## 2.0.6 (2026-09-22)

### Features

- **新增「可单独关闭任一版本的供应商」**（issue #11：用户问「能禁用国际版或国内版吗，有没有配置的地方」——「比如说我根本用不到国际版」）：
  - **此前确实无解，而且最容易被误用的那条路走不通**：`edition` 配置只收窄**凭据扫描范围**（找账号用），不参与 provider 注册；`src/index.ts` 的注册循环对 `REGION_KEYS = ['cn','ai']` 是无条件注册的，所以设 `edition: "cn"` 之后 `trae-global` 依旧出现在模型选择器里。卸载国际版 App 同理——无账号时该区域回落到**插件内置的兜底目录**（Gemini / GPT / MiniMax / Kimi 共 7 条），这些模型一个都调不通，却和可用模型并排显示（这正是 issue #8 的成因）。DSH 侧也没有「停用某供应商」的入口。
  - **交互**：设置卡片两个 tab 各带一个勾选，**默认都勾选**（老用户零感知）；取消勾选即关闭该供应商，重新勾选即恢复。
  - **关闭是「真撤掉」，不是「藏 tab」**：抽掉 adapter 路由（`AdapterRegistrationHandle.replace([])`）——这是让模型**从 DSH 模型选择器消失**的那一步；同时抽掉供应商目录条目（`DirectoryRegistrationHandle.replace([])`），否则「设置 → 模型」仍会列出它。DSH 的类型契约明确允许持零路由而保持注册（"An empty array is legal here ... unlike an empty initial registration"），因此实现是**先正常注册、再 `replace([])`**，两步在同一同步段内完成，无可观测的路由空窗，且开关**立即生效、无需重启**。
  - **顺带消掉一个失败面**：关闭的区域连启动时的模型目录拉取都跳过，不再发任何 Remote/SOLO 请求——「没装国际版每次启动报一次错」那类噪音一并消失。
  - **状态不丢**：开关写入只改目标槽位的 `enabled` 一个字段，该区域的目录 / 勾选 / 图片开关 / 上下文预算与另一区域的整个槽位原样带过，所以「关掉 → 再打开」能完整恢复。配套地在卡片保存模型目录时**回写 `enabled`**——那次写入会替换整个槽位，漏掉它就会「保存一次模型列表 = 悄悄重新打开已关闭的供应商」。
  - **已知代价（明确提示而非静默失败）**：若某会话此前选中了被关闭供应商的模型，路由撤掉后再调用会报 `NO_ADAPTER`；这是「彻底移除」的必然结果，卡片在该 tab 上给出明确文案说明设置均已保留、勾选即可恢复。
  - **两侧读同一条规则**：Host 的 `regionEnabled()` 与卡片的 `regionEnabledOf()` 共用「仅显式 `false` 关闭」的判定，回归测试用 8 种正常/畸形形状交叉比对二者，锁定永不分歧；卡片另读 Host 随文档下发的 `enabled`（signed-in / signed-out 两个分支都带），因为**未登录的区域恰恰是用户最想关掉的那一个**。
  - **修复开发期发现的「勾选点了没反应」**：卡片把**整个 settings 段**传给了只接受 **`regions` 子对象**的判定函数，于是它去查 `section['cn']`（不存在）并**永远返回 `true`**——复选框恒定显示为勾选、点击看起来毫无变化；而**写入其实已经成功**（设置里确实落下了 `enabled: false`），Host 侧路由也确实撤掉了，问题只在卡片的读取。修复方式不是「把参数改对」了事，而是让 `regionsMapOf()` 统一收口、**同时接受整段与子对象两种入参**，使传错一半在结构上不再可能静默返回 `true`；并补 2 条回归测试覆盖「整段入参」与「返回值必须是 `regions` 子对象」（把拆包逻辑改回原样，这 2 条立刻失败，已实测）。
  - **补齐「真实点击」测试，堵住让该 bug 溜过的结构性缺口**：此前 `vitest.config.ts` 只收 `tests/**/*.spec.ts` 且 `environment: 'node'`，**根本无法渲染 React 组件**——仓库里唯一的客户端测试还是自己标注了 DRIFT WARNING 的「手工镜像副本」，不是产品代码，所以「点一下复选框」从来没有被自动化验证过（这正是 bug 能发布出去的原因）。现在 `tests/card-region-switch.spec.tsx` 在 jsdom 里渲染**真组件**、`fireEvent.click` 真实 `<input type="checkbox">`，断言 settings 落值与勾选态翻转，8 条用例覆盖空配置/已关闭/点击写入/重新启用保留选择/点第二个框/不切 tab/关闭态文案/不可写禁用。**变异验证**：把拆包逻辑改回出 bug 的样子，4 条立刻失败（含「存了 false 却显示已勾选」这一条，与用户症状一致）。配套：放开 `.spec.tsx`、`tsconfig` 分派、新增 `jsdom` / `@testing-library/react` / `@testing-library/dom` / `react-dom@18` 四个 devDependencies；`dsh-client-ui-primitives` 因带浏览器专用 CSS modules 在测试中整体 mock（产品依赖契约不变）。
  - 新增 10 条回归测试（区域开关判定与两侧一致性、整段/子对象双入参、开关往返不丢状态、关闭后 `listProviders()` 与目录条目同步消失且不影响另一侧、**模型选择器分组也消失**、重启后仍生效、两个都关仍可恢复、旧配置两边都开、`enabled` 在两种文档分支都下发）。开发中做过**变异验证**：把「抽掉路由」改成「照常注册」（即只隐藏 tab 的假实现），集成测试立刻失败；把目录 `replace` 改回按区域调用，4 条测试失败；把整段入参的拆包逻辑去掉，2 条测试失败——测试确实咬得住。
  - 取证与回复草稿：`docs/ISSUE11_DIAGNOSIS.md`、`docs/ISSUE11_REPLY_DRAFT.md`。

## 2.0.5 (2026-09-22)

### Fixes

- **修复「缓存统计一直是 0」**（issue #10：用户反馈「我测试了一下一直0缓存」，并猜测是接口原因或 Trae 本身不缓存）：
  - **根因在插件自己这一层**：Trae 上游**确实有前缀缓存、也确实在报**（实测逐字节相同的长 prompt 连发，第二次起 `cache_read_input_tokens` 从 0 升到 5248、9216），但插件解码 `token_usage` 事件时**只搬了 4 个计数器**（`prompt_tokens` / `completion_tokens` / `total_tokens` / `reasoning_tokens`），`cache_read_input_tokens` 与 `cache_creation_input_tokens` 被直接丢弃；`TraeStreamEvent.usage` 在**类型层就无法表达**这两个值，转发层自然也无从搬运。
  - **不是「放行」就够，必须做字段名映射**：`dsh-llm-pi-ai` 只在 `usage.cacheRead > 0` 时写入 `cacheReadTokens`，而 pi-ai 的 `parseChunkUsage` 只识别 `prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens` / `cached_tokens` 三种拼写——Trae 的原生字段名不在其中，原样透传依然读不到。现在映射为规范的 `prompt_tokens_details.cached_tokens` / `.cache_write_tokens`。
  - **先确认了语义再动手**：pi-ai 会做 `input = prompt_tokens - cacheRead - cacheWrite`，该减法仅在「`prompt_tokens` 包含缓存量」（OpenAI 口径）时成立。实测同一份 prompt 的 `prompt_tokens` 恒为 9224 而 `cache_read` 从 5248 涨到 9216，若为 Anthropic 的排除口径则同一输入的实际规模会在 14472 → 18440 之间跳变，不可能——据此确认 Trae 用包含口径。端到端复核账目守恒：`8 + 9216 + 0 = 9224`，与 `prompt_tokens` 完全相等，无重复扣减。
  - **`src/raw-chat.ts` 存在同一类缺口**（Raw Chat 通道将来启用时会踩同一个坑）：`RawChatDelta.usage` 补上缓存字段，并同时接受 OpenAI 嵌套拼写与 DeepSeek/Kimi 的顶层拼写。两个通道均保证「上游没报缓存时 wire 形状不变」，不产生空 `prompt_tokens_details`。
  - 新增 4 个回归测试，其中 bridge 用例直接以真机捕获的 `token_usage` 事件原文作为输入。
  - 取证与复现脚本：`docs/ISSUE10_DIAGNOSIS.md`、`scripts/probe-cache-convention.mjs`。
  - **说明**：修复只保证「上游报了缓存就如实上报」。新会话/新前缀的第一轮必然 `cache_read=0`（冷启动），第二轮起才有值；实测 Trae 当前只报读不报写（`cache_creation_input_tokens` 恒为 0）。

## 2.0.4 (2026-09-16)

### Fixes

- **修复「某个区域没有实时模型目录时，该区域的 provider 整个加载失败」**（issue #8：未安装国际版的用户看到 `Trae Global 加载失败：adapter returned invalid context metadata for provider "trae-global" model "gemini-3.1-pro"`）：
  - **根因**：两个区域的内置兜底目录里，每个模型都缺少 `contextWindow`。DSH 要求它必须是正整数（`INVALID_MODEL_CONTEXT`），而 `dsh-llm-pi-ai` 的回退链是 `entry.contextWindow → 已安装 catalog → request.defaultContextWindow`——本插件既没传 `defaultContextWindow`，兜底模型也不在已安装 catalog 里，三条全空，于是校验失败。
  - **失败粒度是 provider 级**：不是丢单个模型，而是**整个区域不可用**。触发场景包括未安装该区客户端、未登录、目录拉取失败（该端点有已知的间歇性 401）、以及首次安装尚未刷新过目录。因此这不是「没装国际版拖累国内版」，而是**两个区域各自独立地有这个缺陷**。
  - **修复**：(1) 兜底目录补上实测 `contextWindow`——国际版依据 2026-09-15 实测目录（`gemini-3.1-pro`/`gemini-3-flash-solo`/`minimax-m3`/`minimax-m2.7`/`kimi-k2.5` = 200000，`gpt-5.4`/`gpt-5.2` = 272000），国内版依据 SOLO 通道实测（200000）；(2) adapter 传 `defaultContextWindow` 作为最终防线，将来任何来源的条目不慎缺字段时降级为「一个保守尺寸的模型」而非「整区不可用」。
  - 新增不变量测试：**两个区域的兜底行都必须带正整数 `contextWindow`**。原先有一条测试断言「兜底条目没有 `contextWindow`」——它固化的正是这个 bug，已改正。

## 2.0.3 (2026-09-16)

### Fixes

- **修复内置兜底目录里存在「不可调用模型」的问题**——插件在首次实时刷新落地前会先提供一份内置兜底模型列表，且这份列表**故意不经过「死 config_name」过滤**（过滤依赖实时目录，会把兜底本身误删）。因此它的 id 必须在源头就是正确的 `llm_utils_chat` config_name，而它此前不是：
  - `auto` 不是任何 Trae 的 config_name，选中后会以 `4001` 失败——已移除。该条目会在「尚未刷新目录」时（未登录 / 网络抖动 / 卡片未刷新）被真正提供给用户，因此并非理论问题。
  - `DeepSeek-V4-Flash` / `DeepSeek-V4-Pro` 缺少 `-Official` 后缀，不是真实 wire id——已更正为 `DeepSeek-V4-Flash-Official` / `DeepSeek-V4-Pro-Official`（依据 2026-09-15 实测目录，`docs/DS41_CALLABILITY.md`）。
  - 新增回归测试锁定三条不变量：兜底 id 必须是真实 config_name（显式禁 `auto` 与裸名）、两个区域的兜底都不得出现 TraeCode 独占模型、`mergeTraeModelSources` 确实丢弃无 wire 匹配的目录行。

### Docs

- **README 新增「模型覆盖范围」一节（中英同步）**——说明插件提供的是 Trae SOLO 通道的模型，而 TraeCode 通道的 4 个模型（`deepseek-v4.1-flash`、`glm-5.3-flash`、`kimi-k2.8-preview`、`qwen3.8-flash`）尚未开放到 SOLO 通道，因此暂不支持，**需要等官方开放到 SOLO 后才能支持**；并区分了 `GLM-5.3`（支持）与 `glm-5.3-flash`（不支持）。
- 新增 TraeCode / agent-task 通道与 TraeCLI 的可行性取证（`docs/CODEC_CHANNEL_FEASIBILITY.md`、`docs/TRAECLI_FEASIBILITY.md`、`docs/TRAE_ECOSYSTEM_RESEARCH.md`）：四条路径逐一实测均不通，且阻塞原因互相独立（协议 / 配额 / 同机 / 登录态与 agent 归属），据此确认这批模型属上游授权边界而非插件可绕过的技术问题。

## 2.0.2 (2026-09-15)

### Fixes

- **修复「Trae 目录里有、插件列表里没有」的整类问题**（issue #7：GLM-5.3 缺失）——根因是**模型调用的 `function` 选错了**，不是目录读取有误：
  - Trae 把可调用目录**分散在多个 SOLO 模式 function 下**，且一个模型**只能通过列出它的那个 function 调用**。插件此前固定用 `solo_work_lite` 取目录与发请求，而 `glm-5.3` 只存在于 **`solo_work_remote`**：用前者调用会被上游拒绝（`4001 param is invalid`），用后者则正常流式返回（2026-09-15 受控实测，同一份请求体，仅 function 不同）。
  - **目录发现改为多 function 并集**：CN 依序请求 `solo_work_remote` → `solo_work_lite`，国际请求 `solo_agent` → `solo_work_remote` → `solo_work_lite`；同一个 config 由**先列出的 function 拥有**（顺序即优先级）。某个 function 失败不再影响其它 function 的目录。
  - **聊天请求按模型回放其来源 function**：每个模型随目录记下 `wireFunction`（并纳入设置 schema 持久化，重启后仍生效），调用时写回请求体——`glm-5.3` 因而会走 `solo_work_remote`。
  - 顺带确认：CN 的两个登录（Trae CN IDE 与 TRAE SOLO CN）在同一 function 下拿到**完全相同**的列表，因此该修复对两者一致生效；国际版覆盖最全的仍是 `solo_agent`。
  - 新增 4 个回归测试（多 function 并集、来源 function 标记、优先级归属、显式 function 覆盖默认值），230/230 全绿。
- **目录拉取失败时重试一次**——Trae 的目录端点存在间歇性 401/限流（实测同一凭证数秒前 200、随后 401）。启动时若恰好撞上，live 目录会拉取失败并**静默回退到上次保存的快照**，从而丢掉自那次保存以来的所有新模型（本版要放出的 glm-5.3 就在其中，实测复现）。现在合并骨架（remote 目录）失败会先重试一次（800ms 间隔）再降级。

## 2.0.1 (2026-09-15)

### Fixes

- **修复纯 CLI 环境（WSL2 等）下「账号已识别但模型目录拉不出来、聊天也全部失败」**（issue #5 后续反馈）——1.4.2 让凭据层认得了 `traecli` 的裸 JWT，但**身份层只认桌面版 `storage.json`**：只装 CLI 的机器上没有任何桌面安装，`x-machine-id` / `x-device-id` 的来源解析直接抛「Trae storage was not found」，而目录查询与聊天请求的构造都需要它，于是模型目录永远停在兜底列表、选中模型也无法对话。现在身份解析在「桌面安装全部不存在」时降级到 **CLI 家目录自身的持久化标识**：
  - `~/.trae-cn/argv.json` 的 `crash-reporter-id`（CLI 首次运行时写入的稳定 UUID）作为设备 ID；
  - `~/.trae-cn/builtin/ide_version.json` 的 `version` 作为 `x-app-version`；
  - 由设备 ID + 主机名 + 用户名做 SHA-256 得到 64 字符 `x-machine-id`（与官方客户端形态一致）。
  全部取自 CLI 自己写下的稳定值，**不是每次请求随机生成**（延续本项目既有红线）；有桌面安装时仍优先使用桌面 `machineid` / `telemetry.machineId`。文件存在但内容损坏时依旧暴露真实解析错误，不被降级掩盖。
- 修复 CI 在 ubuntu-latest 上的测试失败：`auth.spec.ts` 的 edition 收窄用例断言了候选数量为 1，而 Linux 会对每个 edition 并列探测多个目录拼写（`trae-solo` / `TRAE SOLO`），候选数为 2 —— 该多候选是 1.4.2 为 Linux 特意加的设计。测试改为断言收窄语义本身（候选数 > 0 且全部属于该 edition 的桌面安装），并已对 darwin / linux / win32 三平台逐一验证。

## 2.0.0 (2026-09-15)

### Breaking Changes

- **为什么是 2.0.0**：本版在「国际版支持」之上完成架构级变更——插件由「单 provider 单活区域」变为「双 provider 并行」，运行形态与外部可见契约均有变化，按语义化版本升主版本号：
  - **运行形态**：插件现在注册两个 provider 路由（`trae` + `trae-global`）并打开**两个**回环端口（原先各一个）。下游脚本若假定「只存在一个 trae provider」，需适配新增的 `trae-global`。
  - **设置 schema 扩展**：新增 `accounts.{cn,ai}` 每区域账号选择。旧的单 `accountId` 仍被读取并按其账号实际区域自动归位（软迁移，非硬破坏）；`regions` 分槽结构不变。
  - **CLI 不可见面**：卡片路由全部按 `?region=cn|ai` 参数化（未知区域 400）；这是 host↔卡片之间的私有契约，对用户透明。

### Features

- **🆕 国内版与国际版拆分为两个并行供应商，可同时使用**——此前一个 provider 一次只能活一个区域（选哪个账号整个 `trae` 就服务于哪个区域，切账号 = 翻转整个运行时目录）。现在两侧是两套完全独立的实例，**互不干扰**：

  - **双 provider 注册**：国内版保持 `trae`（老 id 不变，存量会话的默认模型与已保存选择全部继续有效），国际版新增 `trae-global`（displayName `Trae Global`）。**两边模型同时出现在 DSH 模型选择器里**——不同会话 / 子代理可以各选一边，互不干扰。
  - **每个区域一套完整运行时栈**：凭据 store、模型 catalog、wire 映射（display id/name → `llm_utils_chat` config_name）、Remote/SOLO 客户端、回环 shim、adapter 各一份。store 按凭据自带的区域声明过滤可见账号，两个区域的账号可同时在线。
  - **插件卡片 tab 化**：设置卡片顶部新增「国内版 / 国际版」tab 栏（带各自登录状态圆点）。每个 tab 有独立的账号选择、用量/订阅概览与模型管理；**切 tab 不丢另一侧未保存的草稿**（模型勾选 / 图片开关 / 上下文预算的草稿按区域隔离保存）。
  - **「减少刷新变化」**：一个 tab 里切账号、刷新模型、轮询用量，完全不触碰另一边的运行时目录——绑定另一边模型的进行中会话不受任何影响（单 provider 架构做不到这一点）。
  - **账号选择按区域独立**：配置新增 `accounts.{cn,ai}`，每个 tab 各选各的账号。旧的单 `accountId` 在启动时按其实际所属区域归位（另一区域保持「首个发现账号」的默认，绝不静默继承错区域的选中账号）。
  - **凭据刷新副本按区域分文件**：`$DSH_HOME/.trae-auth.cn.json` 与 `.trae-auth.ai.json`，双账号同时在线互不覆盖（此前单文件只存一个账号的刷新结果，后写者赢）；旧单文件 `.trae-auth.json` 作为迁移来源保留读取（只被其凭据所属的区域采纳），`logout` 清除全部。
  - **身份解析按区域收窄**：机器/设备 identity 的候选安装先按区域过滤，国内栈不会去读国际安装的 identity（反之亦然），避免跨安装取错 deviceId/machineId。
  - **Raw Chat 探测仅在国内栈**：探测模型 `qwen-3.7-plus` 仅国内可用，且该路径本就 `enabled: false`；国际栈固定报告 `disabled`，不再触碰 raw 端点。

- **国际版支持（国内与国际账号对等）**——沿用本版已完成的区域化工作，**零配置、零开关**：

  > **🆕 正式支持 Trae 国际版（www.trae.ai）**——国内版与国际版账号在本插件中获得完全对等的支持：

- **怎么用**：在插件卡片对应区域的 tab 里选账号（Trae / TRAE SOLO 国际版安装的登录即国际版；Trae CN / TRAE SOLO CN 即国内版）。区域判定完全跟随凭证自带的 `userRegion` 声明（`SG` → 国际，`CN` → 国内，host 后缀与 edition 标签兜底），无需任何手动设置。
- **国际账号可用的完整功能**（目录/网关/订阅状态均经 2026-09-15 实测取证，见 `docs/INTL_SG_EVIDENCE.md`）：
  - **模型接入**：聊天与目录请求自动走国际网关 `https://coresg-normal.trae.ai`；国际版 remote 目录（Gemini-3.1-Pro / Gemini-3-Flash / MiniMax-M3 / M2.7 / Kimi-K2.5 / GPT-5.4 / GPT-5.2）进入 DSH 模型选择器；CN 版解析器直通国际响应（`wireConfigName` 机制命中 `gemini-3.1-pro → custom_model_gemini`）。
  - **订阅状态**：国际账号无 Work 积分包（订阅制），卡片显示订阅/试用状态（`ide_user_pay_status`，官方 App 同款端点）。
  - **请求头零分叉**：CN 版整套请求头（`x-app-id`、identity 头、`Cloud-IDE-JWT`）被国际网关原样接受；`storage.json` 解密器四版通用。
- **目录与勾选按区域隔离（国内 / 国际各一套）**：`regions.cn` / `regions.ai` 两套独立槽位（目录、勾选、图片开关、上下文预算各一份），切换账号互不干扰；旧的扁平字段保留为**国内区域的迁移来源**（区域拆分前的配置一律来自国内端点），国际区域绝不继承。
- **凭证层**：四个桌面版安装（Trae CN / Trae / TRAE SOLO CN / TRAE SOLO）全部纳入账号扫描；国际 CLI（`~/.trae`）因默认 host 未验证暂不支持（给出可诊断错误而非静默误路由）。
- **refresh 契约按 edition 分叉**：TRAE SOLO 国际版走 `/trae/api/v3/oauth/ExchangeToken` + ClientID `en1oxy7wnw8j9n` + DeviceInfo（官方 App 日志直证）；其余三版维持 `/cloudide/api/v3/trae/oauth/ExchangeToken` + `ono9krqynydwx5`。
- **端到端实测（2026-09-15）**：SOLO 国际版有效凭证经本项目正式代码路径（`prepareSoloBody` + `buildTraeHeaders` + `REGION_GATEWAYS.ai.chat`）发最小 `solo_work_lite` 请求：`gpt-5.4` 走 `coresg-normal.trae.ai` 返回 HTTP 200 + 完整 SSE（`output("OK")` / `usage` / `done`），`SseDecoder` 原样可用。账号扫描实测：`edition: auto` 下四版安装共发现 5 个账号（含 2 个国际版，region 正确标 `ai`）。
- 测试：region 判定（userRegion 大小写不敏感/host 后缀/edition 三级兜底）、regionStateOf 迁移语义（扁平读作 cn、ai 绝不继承、显式槽优先）、fallback 目录区域隔离与实测快照、solo/remote/usage 的 ai 网关路由断言、refresh 四版契约断言、web-status 的 ai 分派与降级、nextRegionSlots 保存合并语义。220/220 全绿（含双 provider 注册、跨区域隔离、区域路由分派、区域化 store 与旧副本迁移）。

## 1.4.2 (2026-09-14)

> **版本号说明**：`v1.4.1` ~ `v1.4.4` 四个 git tag 曾推送到远端，但对应代码已整体回档到 `1.4.0`、
> 从未发布到 npm。发布前已删除这四个废弃 tag（备份见 `backup/abandoned-v1.4.1-v1.4.4` 分支
> 及 `abandoned-tags-v1.4.1-4.bundle`）。
>
> 本次实际使用 `1.4.2` 而非 `1.4.1`：`1.4.1` 在 npm 上处于 **staged 状态**
> （由一次未完成的发布预占，`npm view` 查不到该版本，但 `npm publish` 报
> `E409 Cannot publish over previously staged version`），该编号已无法复用。

### Fixes

- 修复 CLI 登录（`traecli`）不被识别、插件恒显「未登录」的问题（issue #5，WSL2 用户报告）。插件此前只认桌面版 Electron 的 `globalStorage/storage.json`（加密值 `iCubeAuthInfo://icube.cloudide`），而 `traecli` 把登录信息写在自己的家目录里、内容是**未加密的裸 JWT**（实测 macOS 上是 `~/.trae-cn/trae-jwt-token`）；纯 CLI 环境（WSL2 常见）根本没有 `storage.json`，因此永远解析不出账号。现在：
  - 凭据来源扩展为 `desktop` / `cli` 两类，`TraeStorageCandidate` 新增 `source` 字段；新增 `parseTraeCliToken()` 直接解析裸 JWT（取 `data.user_id` 与 `exp`），不走 AES 解密链路。CLI token 不含 host 声明，统一补 CN 主机 `https://api.trae.cn`，避免空字符串变成不可用的 base URL。
  - CLI 候选路径在 macOS / Windows / Linux 三平台都会探测（`~/.trae-cn/`、`~/.trae/`）。
  - Linux 桌面版目录名改为**多候选并列探测**（`trae-cn` 与 macOS 拼写 `Trae CN` 都试）。此前只认从 macOS 抄来的 `Trae CN`，而 Linux 上 Electron 应用通常用小写无空格目录名；该拼写从未在 Linux 真机验证过。多探测保证猜错也不会漏掉真实安装。
- 把 `readDesktopAll()` 里的静默 `catch { continue }` 改为记录失败原因，新增 `TraeCredentialStore.diagnose()`：返回探测过的每个路径及其失败类型（`missing` / `unreadable` / `invalid`）。未登录时卡片新增可折叠的「已检查的路径」列表。此前无论路径不存在、key 缺失还是加密头不支持，用户都只看到「未登录」三个字，无从自助定位——`docs/WINDOWS_TOKEN_PROBE.md` 整篇文档的存在本身就是这个可观测性缺口的补丁。诊断内容只含路径与固定原因文案（错误消息不回显输入），不携带任何 token 材料，并有专门测试守住这一点。

## 1.4.0 (2026-09-10)

### Changes

- 对齐 DSH 内核 `0.1.2-rc.1` → `0.1.5-rc.2`（桌面 `dsh-plugin-desktop` 2.0.9 所捆绑通道；`0.1.5-rc.1` 为 npm `latest`，`rc.2` 在 `next`）：
  - `ResolvedPiAiProviderProfile` 在 0.1.5 新增**必填**字段 `modelErrors`：`PiAiAdapter` 现在按模型查此表，命中即以 `INVALID_CONFIG` 拒绝请求；`piProvider` 同时由必填改为可选。本插件是手工构造 profile（不走内核目录解析，故该表不会被子系统填充），补 `modelErrors: new Map()` 表达「所服务的模型全部可用」这一事实。不补则本插件在 0.1.5 宿主上**无法通过类型检查**（`TS2741`）。
  - devDependencies 升级至 `@deepseek-ai/dsh-*@0.1.5-rc.2`，`@earendil-works/pi-ai` 由 `0.84.2` 升至 `^0.85.1`：`dsh-llm-pi-ai@0.1.5-rc.2` 要求 `pi-ai@^0.85.1`，版本不一致会在 `node_modules` 里留下两份互不兼容的 `pi-ai`，导致 `Provider<Api>` 结构不匹配的编译错误。
  - `peerDependencies` 的 `@deepseek-ai/dsh-*` 由 `>=0.1.2-0` 抬到 `>=0.1.5-0`（`modelErrors` 为编译期硬依赖，0.1.2 宿主无法满足），`@earendil-works/pi-ai` 抬到 `>=0.85.1`。仍按范围声明、不锁死补丁版本，与内核 `next` 通道继续前进保持一致。
  - 经核实本次不受文档列出的其余破坏项影响：未使用 `dsh-session` / `dsh-session-persistence` / `dsh-persona` / `dsh-system-prompt` / `dsh-message-feedback` / `dsh-subagent`；未读取 `DSH_SESSION_JSONL`、未调用已移除的 `locate()` / `readRaw()`；`AttachmentStore` 仅作类型引用，`IconChevronDownOutline14` 与客户端 `dsh.client.inject` 六个包在 0.1.5 均仍存在。会话格式 v3 与 persona 段改名对本插件不适用。

### Fixes

- 修复内置回退模型表被实时线路映射过滤、导致真实安装上模型几乎全部消失的问题：`FALLBACK_TRAE_MODELS` 是本插件自带的静态兜底表，其中每个 id 都**从未**由 Trae Remote 目录公布，因此永远不会出现在 `callableKeys` 里。此前 `configuredModels` / `derive` 把这张表也交给 `dropDeadModels` 过滤，只要实时目录只返回一部分模型（账号权限、版本或网络给出的子集），过滤就会把「这次没被提到的」回退模型一并删掉——本机实测在无凭据环境下只剩 `glm-5.2` / `kimi-k2.6` 两个模型可用。现在回退表不再参与线路过滤，并以 `wireResolved` 标志取代「`callableKeys` 非空」作为「线路目录已解析」的判据，避免空目录被误读为「没有模型可用」。新增回归测试覆盖该路径；该缺陷在本仓库 1.3.0 上本来就会失败（与内核升级无关），修复后 `pnpm run test` 首次达到 157/157 全绿（此前 154/156）。

## 1.3.0 (2026-09-08)

### Changes

- 模型名称内嵌积分倍率，与 Trae 自身模型菜单的显示格式一致（如 `GLM-5.2 · x0.79`）：DSH 模型选择器中由本插件注册的模型名在 Trae 公布 `consumption_rate` 时带上 `· x倍率` 后缀，倍率随目录刷新更新，未公布倍率的模型保持原名；模型 id 与内部目录仍用原始名称（不影响 wire 解析与已保存的选择）。插件设置卡片模型行的倍率同步改为 `· x0.79` 内联显示；`lastCatalog` 设置模式新增 `creditMultiplier` 字段声明，保证倍率跨重启持久化。

## 1.2.0 (2026-09-04)

### Changes

- 适配 DSH v0.1.2-rc.1 上游重构（`dsh-plugin-desktop` 2.0.5），同一份构建继续兼容 0.1.1 宿主：
  - `@deepseek-ai/dsh-settings` 在 0.1.2 的 npm 包中移除了 `settingsNamespace` / `installSettingsSection` 自由函数（桌面宿主内置兼容垫片，npm 安装没有；缺失导出会在 ESM 链接期直接报错）。设置接线改为双轨：从模块命名空间读取旧自由函数，存在则使用（0.1.1 宿主与带垫片的 0.1.2 桌面宿主），否则回退 `settings` 服务的 `installSection` 方法（无垫片的 0.1.2 npm 环境）；`TRAE_SETTINGS_NS` 改为字面量 `'trae'`。
  - `@deepseek-ai/dsh-client-runtime` 包在上游被拆分删除：客户端入口的 `ClientContext` 类型改从 `@deepseek-ai/cordis` 导入，`slots` / `settingsScope` / `locale` 服务类型分别通过 `dsh-client-ui-renderer/client`、`dsh-client-ui-settings/client`、`dsh-client-locale/client` 的类型增广获得；`package.json` 的 `dsh.client.inject` 相应把 `@deepseek-ai/dsh-client-runtime` 替换为 `@deepseek-ai/dsh-client-ui-renderer`（0.1.2 中 `slots` 服务的提供方，该包在 0.1.1 中同样存在）。
  - `llm.registerModelDiscovery` 的取消信号从 `request.signal` 移到回调第二个参数：发现回调改用 `(request, signal)` 签名并透传给 Trae 发现请求，修复 0.1.2 宿主下取消不再传播的问题；0.1.1 宿主回退读取 `request.signal`。
- devDependencies 升级至 `@deepseek-ai/dsh-*@0.1.2-rc.1`、`cordis@^4.0.2`、`schemastery@3.18.2`、`pi-ai@0.84.2`（新增 `dsh-client-ui-renderer`、`dsh-client-ui-settings`，移除已删除的 `dsh-client-runtime`），`pnpm run check` 现在直接面向 0.1.2 类型与运行时验证；`peerDependencies` 维持 `>=0.1.2-0 <0.2.0-0` 不变。

## 1.1.2 (2026-08-31)

### Fixes

- 对齐 DSH 宿主（`dsh-plugin-desktop`）实际提供的依赖版本，修正 `peerDependencies` 范围：`@deepseek-ai/dsh-*` 由 `^0.1.1-rc.2` 改为 `>=0.1.2-0 <0.2.0-0`（覆盖宿主 `0.1.2-alpha.1` 及 npm 预发布线），`@earendil-works/pi-ai` 由精确 `0.82.1` 放宽为 `>=0.82.1`（宿主为 `0.84.3`）。修复旧范围按 node-semver 预发布元组规则静默排除宿主版本、安装时报 `ERESOLVE` 的问题。

## 1.1.1 (2026-08-31)

### Fixes

- 修复身份解析在 Windows 等只安装部分 Trae 版本（如仅 SOLO）的机器上读取不存在的存储文件而抛 `ENOENT`、导致刷新与聊天请求全部失败的问题：现在按「第一个实际存在的 CN/SOLO 存储候选」解析 Trae identity，与凭据存储的跳过缺失语义保持一致。

## 1.1.0 (2026-08-30)

### Fixes

- 保持 `llm_utils_chat` / `solo_work_lite` 为模型调用主路径，继续保留 Trae 原生结构化 `tool_calls`，避免模型无法调用 DSH 本地 `read` / `write` / `bash` 工具。
- 删除只提取最终文本、无法返回 DSH `tool_calls` 的 `TraeSoloRemoteBridge` 及 Remote 会话调用逻辑；保留独立、只读的 `TraeSoloRemoteCatalogClient` 用于刷新完整模型能力目录，类型上不提供聊天方法，防止再次误接为模型调用主路径。
- 收紧 SOLO 请求为实证字段 allowlist，过滤会触发 `param is invalid` 的 OpenAI 可选字段；推理档位完成 DSH canonical → Trae wire 转换。
- 修复 `get_detail_param` 解析器字段名：上下文窗口改读 `model_detail_list[].prompt_max_tokens`（回退 `context_window_tokens.dev`）、最大输出改读 `model_detail_list[].max_tokens`。原代码读不存在的 `max_input_tokens` / `max_output_tokens`，导致每个模型的 contextWindow / maxTokens 恒为 undefined。
- 模型发现合并时剔除「Remote 目录有、但 `get_detail_param` 无对应 `config_name`」的不可调用模型（`Doubao-Seed-Code`、`glm-5.3` 均属此类，发往 `llm_utils_chat` 必返回 `4001 param is invalid`）；`FALLBACK_TRAE_MODELS` 移除已下线的 `Doubao-Seed-Code`。
- 账号选择改为严格绑定用户显式选择：删除启动时按通用积分自动挑选账号的逻辑，未选号时仅用第一个发现的账号；账号失效时不再静默切换到其他账号，而是报「未登录」让用户重新选择，避免账单落到用户未选择的账号上。

### Changes

- 模型管理体验与 `dsh-connect-workbuddy` 对齐：一个上游模型只对应一个 DSH 模型 id，移除运行时 `@1m` 变体，改用逐模型 `contextBudgets` 在 Trae 公布的默认 / Max 窗口之间选择。
- 未勾选任何模型时按完整目录提供模型，避免初次配置或旧设置迁移后 provider 目录为空；旧配置中的 `@1m` 行会被自动过滤。
- 模型卡片改为右侧上下文预算单选或固定窗口值，并统一显示多模态标记与原始推理档位 `low / high / xhigh`。
- 模型发现草稿补充与适配器目录一致的 `inputModalities`；当前 DSH 版本可能在核心规范化阶段丢弃该扩展字段，但正式 PiAiAdapter 模型元数据与图片请求链路保持完整。
- Trae SOLO 请求改为按已验证字段构造 `llm_utils_chat` envelope，过滤 OpenAI 可选参数以避免 `param is invalid`；同时将 DSH 推理档位映射为模型声明的 Trae wire value，并继续规范化 `developer` 为 `system`。
- 模型发现以 Remote `/models` 目录为骨架，用 `get_detail_param` 补充 `wireConfigName`（`llm_utils_chat` 真正接受的 `config_name`），按 `config_name == id` 优先、`display_name == name` 次之两级 join；join 不到 wire 行的 remote 模型（不可调用）会被剔除，修复 Seed-Code 等模型因展示名与 wire id 不一致导致的 `param is invalid`。

### Docs

- 更新 README 顶部插件卡片截图（账号选择、积分卡片与模型列表的当前界面）。
- 移除仓库内开发期的一次性探测脚本（`scripts/probe-*.mjs`、`scripts/inspect-raw-chat-log.mjs`）及其只读脚本内容断言测试，保持仓库与发布包聚焦产品代码；`lib/`、`tests/` 与 `node_modules/` 依旧不进入发布包。

## 1.0.1 (2026-08-31)

### Changes

- 将 Cordis 插件运行 ID 从 `llm-trae` 统一调整为 `dsh-connect-trae`，与 npm 包名保持一致。已有 1.0.0 本地安装升级后如保留旧配置条目，需移除旧的 `llm-trae` 实例，避免重复加载。

### Windows support

- `src/identity.ts` 现按平台读取 `product.json`：macOS 保持原路径，新增 Windows 路径 `<LOCALAPPDATA>\Programs\<AppName>\resources\app\product.json`（缺失时回退 `<home>\AppData\Local`），Windows 上 `appVersion` 不再恒为 `undefined`，会随请求头发送 `x-app-version` / `x-ide-version`。
- `src/identity.ts` 的 `osVersion` 在 Windows 上由 `win32 <release>` 规范化为 `Windows <release>`。
- `src/identity.ts` / `src/model-cache.ts` 路径推导参数化（`platform` / `home` / `env` 可选注入，默认取真实环境），便于跨平台测试；所有平台判断统一使用同一平台源，避免 `x-device-type` 与 `x-os-version` 自相矛盾。
- `src/model-cache.ts` 的 `state.vscdb` 路径按平台推导；该模块依赖 `sqlite3` 命令行，Windows 默认未安装，Raw Chat 探测会失败并安全回退（Raw Chat 默认关闭，不影响主流程），详见 README「Windows 说明」。
- 新增 Windows / Linux / `sg` / `solo-sg` 的 identity 测试用例；修复 `tests/identity.spec.ts` 中依赖测试机平台类型的断言（现显式注入平台，Windows 真机与 CI 均可通过）。

## 1.0.0 (2026-08-30)

### Features

- 首个稳定版本：将本机当前登录的 Trae 中国区模型接入 DSH，并通过安全 loopback shim 提供模型调用。
- 接入 `llm_utils_chat` 原生函数调用通道，将 Trae `function_call` 转换为 DSH 可执行的 OpenAI `tool_calls`，支持工具结果回传与连续 Agent 循环。
- 自动发现 Trae CN / TRAE SOLO CN 本地登录账号，支持刷新 Token 列表、选择账号，并优先使用具有通用积分的账号。
- 提供 DSH Connect Trae 插件卡片，分别展示 Work 积分与 DSH 可使用的通用积分，并支持模型目录刷新和启用选择。
- 支持 DeepSeek-V4-Flash 等 Trae 模型、只读用量接口及中英文界面。

### Fixes

- 凭据选择优先使用可供 `llm_utils_chat` 计费的通用积分账号；单个损坏、过期或已退出的本地凭据不会阻断其他账号。
- 规范化 DSH 的 `developer` 消息角色为 Trae 接受的 `system`，避免模型请求持续 400 重试。
- 正确处理 Trae 流式错误事件，配额错误不再被误报为 `EMPTY_RESPONSE`。

### Docs

- 发布元数据、双语 README、发布流程、第三方 Trae 相关项目声明与 npm 打包白名单均已补齐。
- 项目以 MIT 许可证发布，版权归属明确为 `Copyright (c) 2026 LaoDing`。

## 0.1.0-dev.1 (2026-08-28)

### Features

- **新版 SOLO 远程会话通道**：`TraeSoloRemoteClient` + `TraeSoloRemoteBridge`，把 `solo.trae.cn/api/remote/v1/chat_sessions` 的轮询结果转换为 OpenAI SSE，接入安全 loopback shim，成为第一可用上游路线。
- **本地模型目录**：`DeepSeek-V4-Flash` / `DeepSeek-V4-Pro` / `Doubao_1_6` / `kimi-k2.6` / `qwen-3.6-plus` / `glm-5.1` / `minimax-m2.7`。
- **只读用量概览**：`TraeUsageClient` 查询总可用额度、积分来源、每日签到与奖励活动（`web_user_ent_usage` / `checkin_credits/status` / `activity/info`），只读、不消耗积分。
- **插件设置卡片**（对齐 `dsh-subagent-default-model` 外部形象）：在 `settings.plugin.item` 注册折叠卡片（key `trae`），带 LD 品牌图标与 `dsm-plugin-card` 卡片外壳，展开后展示总可用/已消耗、各项积分进度条、每日签到与奖励活动；Host 侧通过 `webServer` 只读路由 `/plugins/dsh-connect-trae/usage` 提供脱敏数据。
- **SSE 扩展**：解析 `token_usage` 与 `tool_calls` 事件。
- **安全骨架**：随机 loopback 端口、进程内随机 secret、Host/Origin/Content-Type 校验、请求取消、body 上限。

### Docs

- 新增 `docs/SOLO_ROUTE_DECISION.md`、`docs/USAGE_API_RESEARCH.md`、`docs/HANDOFF.md`。
- README 中英双语双文件，对齐插件外部形象标准。
- 新增 `THIRD_PARTY_NOTICES.md` 第三方开源声明：只记录与 Trae 接入直接相关的架构/协议参考项目及其许可证与合规说明；README 增加对应章节，发布包 `files` 白名单纳入该文件。
