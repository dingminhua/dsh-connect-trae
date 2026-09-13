# Changelog

## 1.5.0 (2026-09-13)

### Breaking Changes

- **目录与勾选按客户端隔离（CN / SOLO 各一套槽位）**：`lastCatalog`、`enabledModelIds`、`imageModelIds`、`contextBudgets` 此前是**全局单槽**。两个 Trae 客户端的模型目录互不包含（21 vs 15，仅 9 个重叠），共用一槽意味着在一个客户端下勾选的模型，切到另一个客户端后会与**对方目录**求交集——凡是对方不列的 id 被静默丢弃，用户的选择看起来「凭空消失」。这正是 `dsh-connect-workbuddy` 在国际版支持里踩过并已修复的同一类缺陷。
  - 现改为 `editions.cn` / `editions.solo` 两套独立槽位（目录、勾选、图片开关、上下文预算各一份），互不干扰；切换账号不再覆盖另一客户端的配置。
  - 旧的扁平字段保留为 **CN 槽位的迁移来源**（旧配置一律来自 Trae IDE），**SOLO 槽位绝不继承**——那条继承路径正是丢勾选的根源。
  - 卡片保存改为写入 `status.edition` 所指的槽位；usage 文档新增 `edition` 字段供卡片定位（与 workbuddy 的 `region` 字段同构）。

### Fixes

- **修复「Trae 加载失败：adapter returned invalid context metadata」**：`mergeTraeModelSources` 的上下文窗口只从 Remote 行读取，**忽略了 wire 行自己的值**。这在「每次调用都同时抓两个源」时看不出来（Remote 恰好补上了），但 1.4.5 引入的按源选择让 `wire` 模式**只抓 wire**，于是 21 个模型全部丢失 `contextWindow`——`PiAiAdapter` 恒定输出 `context: { contextWindow: resolvedModel.contextWindow }`，缺失即 `undefined`，直接被内核 `normalizeModelInfo` 判为 `INVALID_MODEL_CONTEXT`，整个 provider 不可用。
  - 现与倍率同规则：**wire 行的值优先，Remote 行兜底**（`wireModel.contextWindow ?? model?.contextWindow`）。实测 21/21 全部带回窗口（`Seed-2.1-Pro` 100000、`Seed-Code` 224000、`Kimi-K3` 168000 等），`resolveModelInfo` 对全部 21 个模型零报错。

- **修复「只勾选了 2 个，却服务了几乎全部模型」**：有**两条独立路径**把原始目录直接当成服务目录，绕过了 `enabledModelIds`：
  - `discoverModels` 内部 `catalog.set(...)` 之前写的是合并后的**全量目录**（`applyImageSelection(merged, ...)`），完全没有走 `deriveCatalog`。
  - `registerModelDiscovery` 回调返回的是**全量目录**（只套了 image 选择）——而 model-management 消费的正是这个通道，所以卡片勾 2 个、那边列 15 个。
  两处现均与其它路径一致，改为 `deriveCatalog(目录, enabledSet(current()), budgets)` 再发布。实测勾选 `glm-5.2` + `glm-4.7` 两个 → 服务与广告均恰为这 2 个（修复前为 21 个 / 15 个）。
  参考实现 `dsh-connect-workbuddy` 的 discovery 回调同样先 `deriveCatalog(discovered, new Set(state.enabledModelIds ?? []), ...)` 再返回；这两处正是与其偏离之处。

### Fixes

- **修复上下文窗口被系统性低估（100K / 116K 而非真实的 200K / 256K）**：两处各自独立地把窗口算小了。
  - **`prompt_max_tokens` 被当成上下文窗口**：`get_detail_param` 同时给出 `context_window_tokens.dev`（真实窗口）与 `model_detail_list[].prompt_max_tokens`（**单次请求 prompt 的上限**），而 `solo.ts` 取的是 `promptMaxTokens ?? devTokens`——后者恒小于前者。实测 `Seed-2.1-Pro`：`dev=256000` 而 `prompt_max_tokens=100000`，Trae IDE 显示 **256K**，插件却显示 100K。现改为 **`devTokens ?? promptMaxTokens`**（`dev` 缺失时才退回 prompt 上限）。
  - **`wire` 模式不再单独抓取，导致 Max 窗口恒为 `undefined`**：`get_detail_param` 从不提供 `context_window_tokens.max`，Max 窗口只存在于 Remote 目录（实测 `max_mode:true, max:1000000`）。1.4.5 的「按源选择」让 `wire` 模式只抓 wire，Max 窗口因此全部丢失。现在**两个目录始终都抓**（各自失败降级为 `[]`，互不影响），但**服务哪些行、用哪个倍率仍只由 `mode` 决定**：`selectTraeModelSource` 不会让 Remote 增删或改价任何一行。
  - **窗口取值改为 Remote 优先**：两个源对 `Seed-2.1-Pro` / `Seed-2.1-Turbo` 给出的 `dev` 相差 2.5 倍（wire 116000 vs Remote 256000）。经用户在 Trae IDE 侧确认显示 **256K 且无 Max 选项**，与 Remote 完全一致，故以 Remote 为准、wire 兜底。

  修复后实测（`edition=cn`）：`Seed-2.1-Pro`/`Seed-2.1-Turbo`/`Seed-Code` → **256000**（此前 100000）、`Kimi-K3`/`Qwen3.7-Plus` → 200000、`GLM-5.2` 等 → 116000；6 个模型正确暴露 1M 的 Max 窗口，而 `Seed-2.1-Pro` **不**暴露 Max——与 IDE 的「无 Max 选项」一致。

### Changes

- **槽位随所选账号收敛**：账号是权威——选中 SOLO 账号即服务 SOLO 目录与该客户端的存档；`edition` 设置退化为「凭据无法解析时的兜底」。切换账号时先收敛槽位再重算目录，避免用上一个客户端的目录去交集新客户端的勾选。
- **`merge` 模式归入 CN 槽位**：未验证的 `sg` / `solo-sg` 没有自己的客户端，共用 CN 槽位而非新造第三个。

### Tests

- 新增 `tests/edition-slots.spec.ts`（6 项）：`traeEditionSlotOf` 的模式→槽位映射；`traeEditionState` 的显式槽位优先、旧扁平字段**只**迁移为 CN、**SOLO 绝不继承**、pre-split `models` 列表仍作 CN 目录迁移、未配置时为空。去掉「SOLO 不继承」的守卫后该测试确实失败。
- `tests/settings-integration.spec.ts` 新增 1 项端到端：写入 SOLO 槽位后，CN 槽位所服务的目录与勾选**不被替换也不被交集**。
- `tests/web-status.spec.ts` 新增 2 项：文档携带的 `edition` 与路由给出的槽位一致；路由未提供时回退到已登录账号自身的客户端（而非默认 `cn`）。
- `tests/catalog.spec.ts` 新增 3 项锁定上下文窗口：**仅抓 wire 源时仍保留 wire 行自己的窗口**（退回旧写法后该测试确实失败）、wire 优先且 Remote 兜底、所选行不得出现非正整数窗口。
- `tests/settings-integration.spec.ts` 新增 1 项：勾选 2 个模型时，服务列表与 discovery 广告列表都**恰为这 2 个**（修复前分别为 21 / 15）。
- `tests/solo.spec.ts`：窗口断言由 `prompt_max_tokens` 改为 `context_window_tokens.dev`，并新增「`dev` 缺失时退回 prompt 上限」一项。
- `tests/catalog.spec.ts`：窗口优先级断言改为 **Remote 优先、wire 兜底**（含「Remote 未描述的 wire 行保留自己的窗口」）。

- **按客户端选择模型目录，不再强行合并两个源**：Trae 有两个**互不包含**的模型目录，用户的 Trae IDE 和另一个 Trae 客户端各显示其中一个：
  - **Wire 目录**（`get_detail_param`）：27 个具名模型，倍率是**折后现价**——`Seed-2.1-Pro · x0.08`（限时 1 折）、`Seed-Evolving · x0.08`；但没有 `Kimi-K2.8-Preview`、`GLM-5.3-Flash`。
  - **Remote 目录**（`solo.trae.cn/api/remote/v1/models`）：15 个模型，含 `Kimi-K2.8-Preview`(0.98)、`GLM-5.3-Flash`(0.06)、`Seed-Evolving`；但 `Seed-2.1-Pro` 报**未打折的 `x0.80`**，且缺少 `GLM-5.1`、`GLM-4.6/4.7`、`K2`、`Qwen3.5`、`Qwen3-Coder` 等 12 个。
  此前插件**无条件合并**两者并一律以 Wire 为准，结果是「哪个客户端都不像」：Remote 独有的 6 个模型永远不出现，而它们的倍率也拿不到（Remote 对折扣不可靠）。
- **`edition` 设置现在决定服务哪一份目录**（`traeModelSourceMode`）：`cn` → Wire（Trae IDE 的菜单）、`solo` → Remote（另一个客户端的菜单）、`auto` → Wire（凭据解析 IDE 优先）、`sg` / `solo-sg` → 保持原有合并行为（这两个客户端的契约未经验证，不做猜测）。新增 `selectTraeModelSource()`；只抓取被选中的那一个源，未选中的源即使超时也不影响服务。
- **卡片账号选择器同时切换 edition**：选账号即选该客户端的模型目录。此前选择器只写 `accountId`，换账号后仍服务另一个客户端的菜单——这正是「切了账号刷新出来还是老样子」的原因（三个账号的目录本身是同一份，差异全在客户端）。

### Fixes

- **修复「solo 的 token 不读取了，只读取 cn」**：上面那条把账号选择与 `edition` 绑在一起是错的。`edition` 在 `TraeCredentialStore.candidates()` 里还会**收窄读取哪些 Trae 安装**——一旦写成 `edition: cn`，solo 安装整个不再被读取，账号列表里直接看不到它；更糟的是若 `accountId` 仍指向被收窄掉的那个账号，`current()` 返回 `undefined`，于是一份**完全有效的 token 被报成「未登录」**（实测该 token 有效期到 2026-09-26 却解析失败）。现在两件事彻底解耦：
  - **Credential store 恒以 `auto` 读取 CN 两个安装**（`cn` + `solo`），与 `edition` 无关；`edition` 只决定服务哪一份模型目录。分工是「账号说谁付费，`edition` 说显示哪个菜单」。
  - 卡片账号选择器恢复为**只写 `accountId`**，不再回写 `edition`。
  - 显式指定 `authFile` 时仍按该路径读取（此时本就没有第二个安装可读）。

### Notes

- 说明为什么不做并集：用户要的是「插件显示哪个客户端，就和那个客户端一致」，而不是合成第三份两个菜单都没有的清单。`merge` 模式保留给未验证的 edition，也仍是 `selectTraeModelSource` 的显式选项。
- `Remote` 源的倍率**不被 Wire 覆盖**（`remote` 模式下不调用 `mergeTraeModelSources`）：选这一份目录就是要复现该客户端显示的 `0.80`，替换成 `0.08` 反而与该客户端不一致。

### Tests

- `tests/catalog.spec.ts` 新增 4 项：`wire` / `remote` / `merge` 三种模式的模型集合与倍率归属（含「remote 模式保留 0.80、不被 Wire 的 0.08 覆盖」和「两目录互不包含」），以及 `edition` → 模式映射。
- `tests/settings-integration.spec.ts` 新增 1 项：`edition` 固定为 `cn` / `solo` / `auto` 时插件都必须仍能解析凭据并服务非空目录——锁定「账号选择与模型目录互不耦合」。

## 1.4.4 (2026-09-13)

### Fixes

- **实时发现优先，存档降级为离线兜底**：此前 `configuredModels` / `displayModels` 的取值顺序是「先读设置里存的 `lastCatalog`，没有才用实时发现」，即**一次刷新就把模型列表和倍率冻结在那一天**。存档（`lastCatalog` / 遗留 `models`）本来只是本插件上次刷新的快照，不是实时答案；把它排在实时发现之前，会让插件在重新联网、切换账号、以及 Trae 自己改活动折扣之后继续显示旧倍率与旧模型集。现在顺序改为**实时发现 → 存档 → 内置兜底表**，存档恢复到它本来的角色：只在启动时完全连不上 Trae（无凭据 / 无网络）时兜底。
- **修复「离线启动后即使恢复网络也不再刷新」**：这是上面那条的实际症状来源。启动时若发现失败，插件会服务存档快照，而全插件除「启动」和「卡片上的刷新按钮」之外没有任何地方会重新读 Trae——于是那份陈旧列表会一直留在屏幕上，直到用户手动点刷新或重启进程。现在**任何设置变更**（尤其是切换账号 / edition 这一类「当前数据已知是错的」的时刻）都会在后台重新发现一次；该请求 fire-and-forget、不阻塞设置写入，失败或返回空时保持当前目录不变（新增回归测试覆盖失败路径，确认不会把目录清空或退回内置表）。
- **实时行不再自己过滤自己**：`pickRaw` 返回实时目录时跳过 `dropDeadModels`。实时行**就是**线路目录（`callableKeys` 正是由它构建），拿它跟自己比对只可能删掉发现到的真实行；过滤只对可能过期的存档快照生效，防止旧存档复活已被线路移除的 `config_name`。

> 曾有一条「刷新时把新模型一并启用」的改动随本版一起提交，**已撤销**：`enabledModelIds` 是用户自己的选择，刷新只更新目录、不得改变选择。把实时目录里未出现在选择中的模型并进来，会让每次刷新都把一个精心挑选的 2 个模型的选择悄悄变成全选（21 个）——其中被用户主动关闭的模型同样会被重新打开。现在刷新照旧只做「按 id 求交集」：选择里已消失的行丢弃，其余原样保留，绝不新增。

### Tests

- `tests/settings-integration.spec.ts` 新增 4 项集成回归测试（基于真实插件注册路径，非单元桩）：离线启动仍服务存档快照（兜底仍然有效）、恢复网络后任一设置变更即用实时数据替换陈旧快照（去掉修复后该测试确实失败）、后台重发现失败时保持当前目录不变、**刷新目录不得扩大用户的启用选择**（选择 2 个模型 → 刷新 → 仍为这 2 个）。新增 `networkSwitch()` 辅助函数——`fetch` 必须在插件加载**之前**替换，因为 `TraeSoloClient` / `TraeSoloRemoteCatalogClient` 在构造时捕获 `fetch`。

## 1.4.3 (2026-09-13)

### Fixes

- **模型列表去除同名重复项**：TraeCode 目录里有 6 组同名行，模型选择器会并列显示两行完全相同的 `GLM-5.2 · x0.78`。去重后模型数由 27 → 21。两类成因分别处理：
  - **`config_source: 3` 直接丢弃**：它是 OpenAI 兼容自定义模型的占位条目，与内置模型同名但调不通——`deepseek-v4-pro` / `deepseek-v4-flash` 调用返回 4001 `param is invalid`，而同名的内置 `DeepSeek-V4-Pro` / `DeepSeek-V4-Flash` 正常。
  - **Trae 同源双注册按可见性择一**：`Doubao_1_6` / `Doubao-Seed-Code`、`glm-5.2_advisor_doubao` / `glm-5.2`、`glm-5.1` / `glm-5.1_advisor` 两个 id 实测**都能调通**，保留 `is_invisible_to_user !== true` 的那行。
  - **特别注意「保留首行」是错的**：Trae 把 `_advisor`/legacy 变体排在前面且标记不可见，而它往往窗口更小。按首行规则会让 `GLM-5.2` 落到 advisor 变体、`Seed-Code` 丢掉 140k 上下文（116k vs 256k）。输出顺序仍按 Trae 首次出现的次序。
  - `DeepSeek-V4-Pro 正式版` 与 `DeepSeek-V4-Pro` 是 Trae 给出的两个不同显示名，**不去重**（IDE 菜单同样并列显示）。
- 新增 4 项去重回归测试（`config_source` 过滤、可见性优先、窗口不被降级、大小写不敏感与顺序保持）；去掉可见性优先后其中 2 项确实失败。

## 1.4.2 (2026-09-13)

### Fixes

- **修正积分倍率取错数据源**：模型名里的倍率此前读的是 `solo.trae.cn` 的 Remote 目录，而 Trae IDE 实际渲染的倍率在 `get_detail_param` 每行的 `display_contact_config` 字段里（该字段是第二层 JSON 字符串）。两者对同一模型可达 **10 倍**差异——`Seed-2.1-Pro` / `Seed-Evolving` 在 IDE 显示 `x0.08`（限时 1 折），Remote 却报 `0.8`，因为它的 `activity_discount` 对同一活动写 `discount_type:"none"`、`discount:100`（即「无折扣」）。现以 wire 的 `display_contact_config.consumption_rate.data.rate` 为准，Remote 仅在 wire 未提供时兜底。
- 该值本身已是折后价，故 `limited`（限时）、`subsidy`（专属补贴）、`off_peak`（闲时）、会员折扣四类折扣无需分别处理，与 IDE 显示口径一致。
- 实测对齐用户的 Trae IDE 截图：`Seed-2.1-Pro · x0.08`、`Seed-2.1-Turbo · x0.20`、`Seed-Code · x0.06`、`GLM-5.2 · x0.78`、`DeepSeek-V4-Flash 正式版 · x0.08`、`DeepSeek-V4-Pro 正式版 · x0.36`、`Kimi-K3 · x1.83` 全部一致（此前 `Seed-2.1-Pro`、`Seed-Evolving` 显示 `x0.80`）。
- `display_contact_config` 缺失、被禁用或 JSON 损坏时，模型行照常保留、倍率留空，不会因此丢模型。

## 1.4.1 (2026-09-13)

### Fixes

- **模型列表与调用统一改为 TraeCode 产品线**（此前取的是 TraeWork 的模型集）。Trae 按产品线切分目录，`get_detail_param` 的 `function` 决定返回哪一套：`solo_work_lite` / `solo_work_remote` 属 TraeWork，`chat_v3` / `builder_v3` 属 TraeCode。插件此前用 `solo_work_lite` 取目录、并以 TraeWork 的 `solo_agent_remote,solo_work_remote` 拉 Remote 目录，导致暴露的是 TraeWork 模型集：
  - `TRAE_SOLO_FUNCTION` 由 `solo_work_lite` 改为 `chat_v3`。该常量同时决定模型列表与转发调用，二者不会再漂移。
  - Remote 目录请求函数由 `solo_agent_remote,solo_work_remote` 改为 `chat_v3`。
  - `TRAE_MODEL_DETAIL_FUNCTIONS` 移除 `solo_agent`、`solo_agent_remote`、`solo_work_remote`、`solo_agent_lite`、`solo_work_lite`、`solo_design_lite`、`solo_design_remote`、`solo_builder` 八个 TraeWork 函数，只留 TraeCode 的。
- **模型目录改以 `get_detail_param` 为准，不再以 Remote 目录为骨架**。实测同一账号：Remote 的 TraeCode 组列出了 `chat_v3` 拒绝的模型（`Doubao-Seed-Evolving`、`glm-5.3`、`qwen3.8-max`、`kimi-k2.8-preview`、`glm-5.3-flash`，调用一律 4001 `param is invalid`），又漏掉了可调用的模型（`glm-4.7`、`glm-4.6`、`kimi-k2`、`qwen-3.5`、`minimax-m2`、`qwen3-coder`）。现在逐条枚举 wire 目录，Remote 只用于补充展示名等元数据。本机实测由「TraeWork 模型集」变为 **24 个 TraeCode 可调用模型**，TraeCode 独占模型全部可用，且不再有不可调用项泄漏。
- **只保留 Trae 提供 `display_name` 的行**。同一次响应里有 21/48 行是内部功能项而非可选模型（`custom_model_*`、`fast_apply`、`fast_apply_new`、`title_generation`、`input_optimization`、`summary`、`doubao-for-auto`、`glm-4.7-auto`），此前被当作模型暴露。注意 `is_invisible_to_user` 不能用作判据——Trae 对 `glm-4.7`、`kimi-k2`、`minimax-m2` 等正常模型同样标记为 invisible。
- **修复启动时发现的模型目录被覆盖**：`shim.ready` 回调先跑 `discoverModels()` 装好实时目录，紧接着无条件执行 `catalog.set(configuredModels(current()))`。全新配置下 `lastCatalog` 为空，这一步会退回内置兜底表，把刚发现的模型全部丢弃——表现为插件永远只提供 5 个硬编码模型。现在仅在发现未产出时才回退。
- **修复目录中的重复 id**：`get_detail_param` 会把同一 `config_name` 列出两次（实测 `kimi-k3`），而 `PiAiAdapter` 对重复 id 直接抛 `invalid or duplicate model metadata`、整条目录不可用。现在按 id 去重，保留首行。
- 内置兜底表改为全部可经 TraeCode 调用：移除 `auto`（TraeCode 目录不含且 `chat_v3` 拒绝），新增 `kimi-k3`、`minimax-m3`。`kimi-k2.6` 虽不在 TraeCode wire 目录中，但转发调用实际接受，故保留可调用性判断依据。
- 一处判断依据说明：`wireConfigName` 不再由合并产出（行 id 即 wire `config_name`，映射为恒等），字段保留声明以兼容旧版本已保存的目录，桥接层仍照常读取。

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
