# Changelog

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
