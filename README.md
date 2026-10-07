<p align="center">
  <img src="docs/assets/dsh-connect-trae-usage-card.png" width="860" alt="dsh-connect-trae settings panel" />
</p>

<h1 align="center">dsh-connect-trae</h1>

<p align="center"><b>把本机登录的 Trae 模型接入 DeepSeek Harness，并提供用量/积分概览与每日签到领取。</b></p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="#安装">安装</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#模型覆盖范围">模型覆盖范围</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="https://github.com/dingminhua/dsh-connect-trae/issues">问题反馈</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-connect-trae"><img src="https://img.shields.io/npm/v/dsh-connect-trae?style=flat-square&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-connect-trae"><img src="https://img.shields.io/npm/d18m/dsh-connect-trae?style=flat-square&label=downloads&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/dingminhua/dsh-connect-trae/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dingminhua/dsh-connect-trae/ci.yml?branch=main&style=flat-square&label=tests" alt="test status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dingminhua/dsh-connect-trae?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/dingminhua/dsh-connect-trae/stargazers"><img src="https://img.shields.io/github/stars/dingminhua/dsh-connect-trae?style=flat-square" alt="GitHub stars"></a>
  <a href="https://dshfind.com/plugins/dingminhua/dsh-connect-trae"><img src="https://dshfind.com/api/badge/dingminhua/dsh-connect-trae" alt="dshfind plugin"></a>
</p>

一个独立的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle 插件。它把本机已登录的 Trae 账号（**国内版与国际版均支持**）接到 DSH 的模型选择器：模型负责生成结构化工具调用，`bash` / `read` / `write` / `edit` 等工具由 DSH 本地执行；同时提供用量概览（国内版 Work/通用积分、国际版订阅状态）、每日签到领取与模型管理界面。**国内版与国际版是两个并行的供应商（`trae` / `trae-global`），可同时使用**；插件设置卡片以 tab 区分两者，方便统一管理。

**支持 macOS、Windows 与 Linux**：CI 在 `ubuntu-latest` 与 `windows-latest` 上跑完整 typecheck / 测试 / 构建；Windows 侧的目录探测、应用版本头与锁行为均有针对性处理，详见 [Windows 说明](#windows-说明)。

> 除每日签到领取外，插件的所有查询都是只读的、不消耗额度；签到领取也只在你点击按钮时才发生。

## 功能特性

- **双供应商并行接入** —— 国内版注册为 DSH 的 `trae` provider（`DeepSeek-V4-Flash`、`DeepSeek-V4-Pro` 等），国际版注册为 `trae-global`（Gemini / GPT / MiniMax 阵容），**两边模型同时出现在 DSH 模型选择器里**：不同会话可以各选一边，互不干扰。
- **可单独关闭任一版本** —— 两个 tab 各带一个勾选（默认都勾选）：取消勾选即把该版本的供应商**整个从 DSH 模型选择器撤掉**（不是只藏起 tab），并且不再发起任何请求；重新勾选即恢复，账号、目录、勾选与上下文预算全部保留。用不到国际版就把国际版关掉即可。
- **插件卡片 tab 切换** —— 设置卡片顶部为「国内版 / 国际版」两个 tab，各含独立的账号选择、用量概览与模型管理；每个 tab 的账号、目录、勾选与未保存草稿完全隔离——在一个 tab 里切账号或刷新模型，不会触碰另一边的运行时目录与会话。
- **倍率内嵌模型名** —— 模型名称按 Trae 自身菜单的格式显示积分倍率（如 `GLM-5.2 · x0.79`），倍率随目录刷新更新。
- **DSH 本地工具循环** —— 通过 Trae `llm_utils_chat` 获取待执行的结构化 `tool_calls`，交由 DSH 自带的本地工具执行，再将工具结果回传模型。
- **国内国际双区域自动识别** —— 自动发现 Trae CN / TRAE SOLO CN / Trae / TRAE SOLO 四个本地安装的登录账号；区域由凭证自带的 `userRegion` 声明自动判定（host 后缀与 edition 标签兜底），无需手动指定。
- **目录与勾选按区域隔离** —— 国内版与国际版各一套模型目录、勾选、图片开关与上下文预算，两个供应商各自读各自的槽位。
- **识图能力跟随 Trae 自身的标注** —— Trae 把某个模型标为 `multimodal` 时，插件直接按多模态对外声明，无需你在卡片上逐一手勾（issue #16）。判据是「**你手动勾选的 ∪ Trae 标注多模态的**」：Trae 明确标 `false` 或未标注的模型保持纯文本，你可以照旧手动为它们打开图片输入。卡片上被自动开启的那一行显示为已勾选且只读，并说明原因。详见下方「图片输入（识图）」。
- **多账号切换** —— 支持重新读取 Token 列表并选择账号；Token 不写入 DSH 设置。**你的选择会被记住并长期生效**：插件不会因为某个账号额度用尽、或检测到另一个可用账号就自作主张替你切换（换账号意味着换人计费）。所以当绑定的账号额度耗尽时，卡片会**明确告诉你**，并把本机其他还有额度的账号连同其可用积分数列出来，由你一键切换——而不是让面板一直空着、也不自动把你切走。「刷新账号与 Token」每次都会回报结果（找到几个账号、当前仍绑定谁），不会再「点了没反应」。下拉里显示的是产品名（`Trae` / `TRAE SOLO` / 国际版），便于分辨凭据来自哪个安装。
- **只读用量与模型管理** —— 国内版查看 Work 积分与通用积分，国际版查看订阅/试用状态；刷新/启用 Trae 模型；只读查询不消耗额度。
- **一键测试启用模型** —— 给**已启用**的每个模型发一条最小消息（一句 `ping`、不带工具），逐个告诉你能不能真的应答：**可用** / **需要更高档位**（Trae `1005`，你的套餐不覆盖）/ **上游不提供**（`4001`/`4011`，SOLO 通道没有这个模型）/ **被限流** / **登录凭据被拒** / **本次未测出**。最后一项是一等公民：超时、断连、代理、5xx **一律不算「不可用」**——只有上游明确的拒绝才算负面结论。**这是插件里唯一消耗额度的操作**（签到改变的是账号状态，不消耗），只在你点击时运行，结果只留在当前会话里不写入设置。
- **每日签到领取** —— 国内版卡片上一键领取当日签到积分（按钮显示每日奖励，该账号已领取则显示「今日已领取」并禁用）；这是插件里**唯一会改变账号状态**的操作，由你主动点击触发。Trae 的签到按「**每台设备每天一次**」限制：切换账号后如果本机今天的名额已经用掉（无论是哪个账号用的），当前账号在本机当天无法再签，卡片会说明原因而不是谎报「已领取」。国际版没有签到活动，因此不显示该按钮。
- **输入框积分读数** —— 在输入框工具栏（「专家」与模型选择器之间）显示「Trae CN · <数值>」，5 分钟自动刷新。**整块可点击**，弹出浮层显示当前账号、Work 积分、通用积分、最近刷新时间，并把手动刷新按钮放在浮层里。**只在当前会话选中的模型属于本插件时出现**——选其它供应商的模型时整块不渲染。这样两个连接器插件不会争同一个位置（侧边栏底部是共享的根级行，输入框工具栏是按会话、按供应商的）。
- **安全 loopback shim** —— 每区域一个随机端口 + 进程内随机 secret，真实 Trae token 不交给 pi-ai。

## 工作原理

```text
DSH PiAiAdapter（每个 provider 一套）
  -> 安全 loopback shim（每区域一个随机端口 + 进程内随机 secret）
  -> TraeSoloBridge
  -> 国内版 https://trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat
  -> 国际版 https://coresg-normal.trae.ai/api/agent/v3/llm_utils_chat
  -> Trae SSE / pending function_call
  -> OpenAI SSE tool_calls
  -> DSH 本地执行工具并回传结果
```

国内版与国际版各持一套完整的运行时栈——凭据 store、模型 catalog、wire 映射、上游客户端、回环 shim、adapter——按凭证自带的区域声明隔离可见账号，所以**两个区域的账号可以同时在线、同时被不同会话使用**。

用量概览走 `https://api.trae.cn/trae/api/v2/pay/*` 与 `/trae/api/v2/ug/*` 只读接口（国际账号走其自有网关的订阅状态端点）；每日签到领取是其中唯一的写操作，走 `POST /trae/api/v2/ug/checkin_credits/claim`，需要携带本机安装的设备号（`x-device-id`，与聊天通道同源）。该设备号也正是签到「每台设备每天一次」的判定依据，所以换账号不会重置当天名额。刷新得到的 token 按区域存放在 `$DSH_HOME/.trae-auth.cn.json` 与 `$DSH_HOME/.trae-auth.ai.json`（两个账号同时在线互不覆盖；旧的单文件 `.trae-auth.json` 作为迁移来源保留读取）。

> 详见 `docs/IMPLEMENTATION_PLAN.md`、`docs/SOLO_ROUTE_DECISION.md`、`docs/USAGE_API_RESEARCH.md`。

## 图片输入（识图）

插件对外声明「这个模型是否接受图片」，DSH 据此决定附图是**原样发出**还是**降级成文字描述**。所以这条声明是硬开关，不是一个无关紧要的标记。

判据是**两个来源的并集**（issue #16）：

| 来源 | 含义 |
|---|---|
| Trae 目录自带的 `multimodal` 字段 | Trae 自己对「这模型读不读图」的回答。Trae IDE 本体的附图按钮就是纯粹由这个字段驱动的，没有用户开关 |
| 你在卡片上手动勾选的 `imageModelIds` | 显式选择。即便 Trae 后来不再标注该模型，你的勾选也不会被撤掉 |

要点：

- **只有 `multimodal === true` 才自动开启。** 字段缺失（旧版本保存的目录、兜底目录）或明确 `false`，都按纯文本处理——宁可不发，也不对一个能力不确定的模型谎报「支持图片」。
- **自动开启并不等于自动发图。** 它只是让 DSH 允许你给该模型附图；图片始终由你在对话里自己贴，插件不会替你发送任何东西。
- **被自动开启的行在卡片上显示为已勾选且只读。** 因为并集语义下取消勾选会被立刻重新加上，给它一个可点的框是在撒谎。目前不为单个模型提供「强制关闭」的出口；如果你需要这个开关，可以在 issue #16 下提出。
- 手动勾选对 Trae 标注 `false`（或未标注）的模型依然有效，这是为那些「上游没标但实际可用」的情况留的口子。

## 模型覆盖范围

插件提供的是 Trae **SOLO 通道**的模型（`DeepSeek-V4-Flash-Official`、`DeepSeek-V4-Pro-Official`、`GLM-5.3`、`GLM-5.2`、`Kimi-K3`、`MiniMax-M3`、`Qwen3.8-Max`、`Doubao-Seed-*` 等），国内版与国际版均走这条通道。

以下 3 个模型目前来自 **TraeCode（Trae IDE）通道**，尚未开放到 SOLO 通道：

| 模型 |
| --- |
| `glm-5.3-flash` |
| `kimi-k2.8-preview` |
| `qwen3.8-flash` |

它们**会出现在模型列表里**（Trae 的目录列出了它们），但插件侧暂时没有可调用它们的通道。选中后发送消息会得到一条**明确的错误**，例如：

```
Trae does not serve this model under the SOLO function the request used
(config_name rejected) · Trae code 4001 · upstream: We're sorry, the param is invalid…
```

即「上游不提供该模型」被如实说明，而不是静默失败或像网络故障。**官方把它们开放到 SOLO 通道后，插件会自动可用**（判据就是能不能拿到调用 id），无需升级插件。

> **为什么现在会显示（2026-10-02 起的策略）**：此前这类「目录里有、但拿不到调用 id」的模型会被**直接隐藏**，理由是「放出来只会报错」。但可调用名单是**按账号档位**下发的——在免费账号上测不到，不等于付费账号用不了（issue #19 的报告人就是 Pro：他的账号能调用本机免费账号被门禁挡住的模型）。**隐藏用户自己 Trae IDE 里有的模型，比让他看到一条明确的错误更糟**，所以改为：全部呈现 + 如实报错。

> `deepseek-v4.1-flash` 曾在此列——`docs/DS41_CALLABILITY.md`（2026-09-15 取证）实测 8 个 SOLO function
> 全部返回 `4001 param is invalid`。**上游后来把它开放到了 SOLO 通道**：当前实时目录里它带
> `wireFunction: solo_work_remote`，可正常调用（已实测刷新确认）。文档此前未同步，现已从表中移除。

> 注意区分：**`GLM-5.3` 是支持的**（走 SOLO 通道），但 **`glm-5.3-flash` 不支持**——两者是不同的模型。

如果你现在就要用这 3 个模型，请直接在 **Trae IDE 本体**中使用。

## 安装

推荐使用 DSH 插件命令安装 npm 已发布版本：

```sh
dsh plugin --profile desktop add dsh-connect-trae
```

或直接通过 npm 安装：

```sh
npm install dsh-connect-trae
```

安装、更新或卸载 bundle 后，需要重启对应的 DSH 进程。

## DSH 版本兼容

**要求 DSH 0.1.7-rc.1 及以上**（2.3.0 起不再支持 0.1.7 之前的宿主；peer 依赖范围已按此收窄）。
**peer 上界为 `<0.3.0-0`：0.1.7 与 0.2 两条线均受支持。**

0.2.0 线对本插件**没有契约破坏**——逐符号核对确认插件消费的 API 全部未变（[完整的 0.2.0-rc.1 影响面核对](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/DSH_0.2.0_RC1_IMPACT_CHECK.md)）。但 0.1.7 起 DSH 有一道**bundle 级 peer 门禁**：
peer 范围不满足的 bundle 会被**整体跳过**，只往 stderr 写一行，界面上表现为「插件凭空消失」。

### peer 上界为什么不写 `<0.2.0`

2.3.1 曾写 `<0.2.0-0`，意图是「先不支持 0.2.0 正式版」。这个写法**是错的**：
SemVer 里 `0.2.0-rc.1 < 0.2.0-0`，于是它把**整个 0.2.0 预发布线**也一并排除，
用户装上第一个 0.2.0 预发布版后插件立即整体失效（2.3.1 的实际故障）。

| 写法 | 0.1.7 线 | 0.2.0 alpha/rc | 0.2.0 正式 | 0.3.0 |
| --- | --- | --- | --- | --- |
| `>=0.1.7-rc.1 <0.2.0-0` ❌ | ✅ | ❌ | ❌ | ❌ |
| `>=0.1.7-rc.1 <0.2.0` | ✅ | ✅ | ❌ | ❌ |
| `>=0.1.7-rc.1 <0.3.0-0` ✅ | ✅ | ✅ | ✅ | ❌ |

`tests/dsh-peer-range.spec.ts` 钉住这条不变式：逐条断言每个 peer 范围**必须**放行
0.1.7 与 0.2 两条线、**必须**挡住 0.3 线，并禁止 `<0.2.0-0` 这种写法回归。

> **为什么需要专门的测试**：范围写错时 `tsc` 通过、全部单测通过、`pnpm install` 通过、
> CI 全绿——只有真实宿主会拒绝加载。这正是 2.3.1 一路绿着上线的原因。

0.1.7 把设置体系整体重建，插件按 0.1.7 的契约工作：

- **宿主端注册**：`SettingsForms.configure({auto}, owner)`（0.1.7 起 `installSection` 已删除），命名空间取**宿主实际服务的 Loader 条目 id**（`ctx.fiber.entry?.options.id`，回落到 `trae`）——harness 按精确匹配查找 provider 的命名空间，写死 `trae` 会让 provider 被判「未配置」。
- **客户端设置面**：`configForms`（0.1.7 起 `settingsScope` 已移除）。`inject` 只声明 `slots` / `locale`，设置面用 `ctx.get()` 软探测——Cordis 的依赖闸门是硬闸，`inject` 里任一服务在运行线上不存在，`apply()` 就永远不会执行（这正是 2.2.0 及更早版本在 0.1.7 上卡在 `pending (waiting for service: settingsScope)` 的原因）。
- **配置卡片槽位**：`plugins.bundle.config` / `plugins.row.config`（`settings.plugin.item` 已删除）。
- **schema 可写声明**：可写字段必须标 `volatile()`（`asVolatile`），否则写入被 0.1.7 的写入门直接拒绝；0.1.7 以 `{get(): T}` 活引用交付配置值，所有读取与合并路径都先解包（`unwrapVolatile` / `unwrapVolatileDeep`）。
- **折叠箭头用纯 CSS**，不静态导入任何 primitives 图标——图标命名族随版本变动，静态导入不是稳定契约。

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| **macOS** | ✅ 完全支持 | 开发与验证环境；目录名均经真机确认 |
| **Windows** | ✅ 支持 | CI 跑 `windows-latest`；账号目录、应用版本头、锁行为均有专门处理。**已在一台真机（Windows 10.0.22621 + TRAE SOLO CN）通过验证**，见下方 |
| **Linux** | ✅ 支持 | 含 WSL2 + Trae CLI 场景（issue #5）；目录名按多候选探测 |

三个平台共享同一套逻辑：账号读取、解密、区域判定、签到与用量查询均与平台无关，平台差异只集中在**路径解析**（`src/paths.ts`）与**设备指纹**（`src/identity.ts`）两处。

## Windows 说明

- **账号数据目录**：插件读取 `%APPDATA%\<目录名>\User\globalStorage\storage.json`（与**安装目录无关**——Electron 系应用的用户数据固定放 `%APPDATA%`，装到 D 盘也一样）。插件会**并列探测**多个目录拼写（`Trae CN` 与 `trae-cn`、`TRAE SOLO CN` 与 `trae-solo-cn`），命中任一即可；Windows 文件名不区分大小写，因此不会重复探测同一目录。
- **应用版本头**：插件从安装目录 `<LOCALAPPDATA>\Programs\<安装目录名>\resources\app\product.json` 读取 `appVersion`（`LOCALAPPDATA` 缺失时回退 `<home>\AppData\Local`），随请求发送 `x-app-version` / `x-ide-version`；读不到时这些头不发送，不影响登录与聊天。
- **设备指纹**：`x-device-type` 发 `windows`，`x-os-version` 为 `Windows <版本>`。机器 ID 取自数据目录的 `telemetry.machineId`（或同目录 `machineid`），该推导在 Windows 上成立。
- **文件锁**：宿主 `dsh-atomic-write` 原生处理 Windows 的独占创建语义（`EPERM` / `EBUSY` 重试），无需插件侧适配。
- **Raw Chat 探测（已知限制）**：`model-cache` 依赖 `sqlite3` 命令行，Windows 默认未安装，该探测会失败并**安全回退**。Raw Chat 默认关闭，不影响主流程。
- **权限位**：写凭据副本时传 `mode: 0o600` / `dirMode: 0o700`，Windows 忽略 POSIX 权限位——不报错，属已知且无害。

### 真机验证结果（2026-09-26，Windows 10.0.22621 + TRAE SOLO CN）

`node scripts/verify-windows.mjs` 实测**全部通过**（退出码 0）：

| 检查项 | 实测结果 |
| --- | --- |
| 目录探测 | 命中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json`（其余候选为 missing） |
| 账号解析 | 解出 1 个账号，`solo` / `cn` 区域 |
| `x-device-type` | `windows` ✅ |
| `x-os-version` | `Windows 10.0.22621` ✅ |
| `x-device-id` | 16 位纯数字（来自数据目录，非兜底哈希）✅ |
| `x-app-version` | `0.1.56`，取自 `%LOCALAPPDATA%\Programs\TRAE SOLO CN\resources\app\product.json` ✅ |

**这确认了什么**：`win32DirName` 作依据是**正确**的——`TRAE SOLO CN` 这个拼写确实是 Windows 真机上的实际目录名，且 `product.json` 的安装路径推导与设备指纹各字段都成立。即「Windows 上插件读得到 Trae 登录」已由真机证据支持，不再是推断。

#### 脚本之外的运行路径（同一台真机，2026-09-26）

上表四项只覆盖**路径探测与设备指纹**，不等于「整个插件在 Windows 上跑得通」。因此另外单独实测了插件的主流程（直接调用 `lib/` 的导出，即产品代码本身）：

| 运行路径 | 实测结果 |
| --- | --- |
| `TraeCredentialStore.resolve()` | ✅ 返回凭据，host `https://api.trae.cn`，token 有效期正常解析 |
| `identityHeaders()` 全部请求头 | ✅ 10 个头全部生成（`x-device-id` / `x-machine-id` / `x-device-cpu` / `x-ide-version-code` 等） |
| 用量查询（只读，不消耗积分） | ✅ 拿到 9 个积分包，总额 2050 / 已用 1522.85 |
| 模型目录拉取（只读） | ✅ 拉到 **42 个模型** |
| 原子写 `writeFileAtomic` | ✅ 写入 + 回读一致 |
| 并发文件锁 `withFileLock` | ✅ 8 个并发写串行化正确，**无丢失更新**（Windows 独占创建语义由宿主处理，验证成立） |
| `SSE` 解码 | ✅ 代码按 `\r?\n` 切分，CRLF 与分块均支持 |

也就是说：登录、身份、用量、模型目录、并发写入这些**主流程在 Windows 上均实测可用**。

> **已知限制（本机实测确认其行为）**：`model-cache` 依赖 `sqlite3` 命令行，本机未安装，实测抛 `ENOENT`（`spawn sqlite3 ENOENT`），调用方 `.catch(() => undefined)` 正确兜底——**不影响主流程**，Raw Chat 默认关闭。
>
> **该模块的目录拼写缺口已修复**（同轮发现并修掉）：它原先把 `state.vscdb` 路径**硬编码为 `Trae CN` 单一拼写**，而 `paths.ts` 是多候选，且它自己重算了一遍目录而没复用 `traeStorageCandidates`。在本机（真实目录名为 `TRAE SOLO CN`）上，旧代码指向的 `...\Trae CN\...\state.vscdb` **根本不存在**；只因 `sqlite3` 缺失、该调用必然失败并兜底，才把一个**错误的路径**藏在了另一个看似合理的错误（依赖缺失）后面。
>
> 修法是让缓存路径**从凭据路径推导**——`state.vscdb` 与 `storage.json` 同在 `globalStorage`，因而同一个候选目录既管登录也管缓存；`raw-resolver` 现在把命中的候选传下去，多版本共存时不会读到另一个安装的模型表。真机复测：新代码正确选中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\state.vscdb`（存在），旧代码只找 `Trae CN`（不存在）。

> **仍然未验证的部分**：本机只装了 TRAE SOLO CN，因此 `Trae CN` / `trae-cn` 这两个拼写**仍未经真机确认**——但它们在此机器上不存在只反映「本机没装这个版本」，不代表拼写有误。装了 Trae 中国版的 Windows 用户仍欢迎跑一次上面的命令回报。

> **安装 Trae 中国版或别的情形？一条命令即可回报**：`node scripts/verify-windows.mjs` —— 它用插件自身的构建产物列出在这台机器上探测的每条路径、能否解出账号、以及设备指纹，输出**已脱敏**（用户名替换为 `<user>`，账号名与设备号只给长度），可直接贴进 issue。**完整的验证步骤与结论判读见 [`docs/WINDOWS_VERIFY_GUIDE.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/WINDOWS_VERIFY_GUIDE.md)**；手工逐步排查见 [`docs/WINDOWS_TOKEN_PROBE.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/WINDOWS_TOKEN_PROBE.md)（**只要目录名与 key 名，不要 token**）。若目录名仍对不上，可用 `authFile` + `edition` 直接指定完整路径救急。

## 开发

```sh
pnpm install
pnpm run check   # typecheck + test + build
```

本地开发用 `link:` 安装到 desktop profile（改码后重启 DSH Desktop 生效）：

```sh
dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-connect-trae
```

## 致谢

- [Wang-JQ77/dsh-trae-api](https://github.com/Wang-JQ77/dsh-trae-api)（MIT）— Trae 认证、会话和模型协议研究的参照实现。

## 第三方开源依赖

本项目参考的与 Trae 接入直接相关的开源项目，以及它们的许可证与合规说明，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。引入新的 Trae 相关外部依赖或复用其他项目代码时，请同步更新该文件并遵守对应许可证要求。

## 许可证

本项目采用 [MIT](LICENSE) 许可证，版权归属：**Copyright (c) 2026 LaoDing**。
