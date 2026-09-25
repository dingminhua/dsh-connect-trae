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

> 除每日签到领取外，插件的所有查询都是只读的、不消耗额度；签到领取也只在你点击按钮时才发生。

## 功能特性

- **双供应商并行接入** —— 国内版注册为 DSH 的 `trae` provider（`DeepSeek-V4-Flash`、`DeepSeek-V4-Pro` 等），国际版注册为 `trae-global`（Gemini / GPT / MiniMax 阵容），**两边模型同时出现在 DSH 模型选择器里**：不同会话可以各选一边，互不干扰。
- **可单独关闭任一版本** —— 两个 tab 各带一个勾选（默认都勾选）：取消勾选即把该版本的供应商**整个从 DSH 模型选择器撤掉**（不是只藏起 tab），并且不再发起任何请求；重新勾选即恢复，账号、目录、勾选与上下文预算全部保留。用不到国际版就把国际版关掉即可。
- **插件卡片 tab 切换** —— 设置卡片顶部为「国内版 / 国际版」两个 tab，各含独立的账号选择、用量概览与模型管理；每个 tab 的账号、目录、勾选与未保存草稿完全隔离——在一个 tab 里切账号或刷新模型，不会触碰另一边的运行时目录与会话。
- **倍率内嵌模型名** —— 模型名称按 Trae 自身菜单的格式显示积分倍率（如 `GLM-5.2 · x0.79`），倍率随目录刷新更新。
- **DSH 本地工具循环** —— 通过 Trae `llm_utils_chat` 获取待执行的结构化 `tool_calls`，交由 DSH 自带的本地工具执行，再将工具结果回传模型。
- **国内国际双区域自动识别** —— 自动发现 Trae CN / TRAE SOLO CN / Trae / TRAE SOLO 四个本地安装的登录账号；区域由凭证自带的 `userRegion` 声明自动判定（host 后缀与 edition 标签兜底），无需手动指定。
- **目录与勾选按区域隔离** —— 国内版与国际版各一套模型目录、勾选、图片开关与上下文预算，两个供应商各自读各自的槽位。
- **多账号切换** —— 支持重新读取 Token 列表并选择账号；Token 不写入 DSH 设置。
- **只读用量与模型管理** —— 国内版查看 Work 积分与通用积分，国际版查看订阅/试用状态；刷新/启用 Trae 模型；只读查询不消耗额度。
- **每日签到领取** —— 国内版卡片上一键领取当日签到积分（按钮显示每日奖励，已领取则显示「今日已领取」并禁用）；这是插件里**唯一会改变账号状态**的操作，由你主动点击触发。国际版没有签到活动，因此不显示该按钮。
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

用量概览走 `https://api.trae.cn/trae/api/v2/pay/*` 与 `/trae/api/v2/ug/*` 只读接口（国际账号走其自有网关的订阅状态端点）；每日签到领取是其中唯一的写操作，走 `POST /trae/api/v2/ug/checkin_credits/claim`，需要携带本机安装的设备号（`x-device-id`，与聊天通道同源）。刷新得到的 token 按区域存放在 `$DSH_HOME/.trae-auth.cn.json` 与 `$DSH_HOME/.trae-auth.ai.json`（两个账号同时在线互不覆盖；旧的单文件 `.trae-auth.json` 作为迁移来源保留读取）。

> 详见 `docs/IMPLEMENTATION_PLAN.md`、`docs/SOLO_ROUTE_DECISION.md`、`docs/USAGE_API_RESEARCH.md`。

## 模型覆盖范围

插件提供的是 Trae **SOLO 通道**的模型（`DeepSeek-V4-Flash-Official`、`DeepSeek-V4-Pro-Official`、`GLM-5.3`、`GLM-5.2`、`Kimi-K3`、`MiniMax-M3`、`Qwen3.8-Max`、`Doubao-Seed-*` 等），国内版与国际版均走这条通道。

以下 4 个模型目前来自 **TraeCode（Trae IDE）通道**，尚未开放到 SOLO 通道，因此本插件**暂不支持**：

| 模型 |
| --- |
| `deepseek-v4.1-flash` |
| `glm-5.3-flash` |
| `kimi-k2.8-preview` |
| `qwen3.8-flash` |

这 4 个模型只在 Trae IDE 客户端内可用，插件侧没有可调用的通道。**需要等官方把它们开放到 SOLO 通道后，插件才能支持。**

> 注意区分：**`GLM-5.3` 是支持的**（走 SOLO 通道），但 **`glm-5.3-flash` 不支持**——两者是不同的模型。

如果你现在就要用这 4 个模型，请直接在 **Trae IDE 本体**中使用。

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

0.1.7 把设置体系整体重建，插件按 0.1.7 的契约工作：

- **宿主端注册**：`SettingsForms.configure({auto}, owner)`（0.1.7 起 `installSection` 已删除），命名空间取**宿主实际服务的 Loader 条目 id**（`ctx.fiber.entry?.options.id`，回落到 `trae`）——harness 按精确匹配查找 provider 的命名空间，写死 `trae` 会让 provider 被判「未配置」。
- **客户端设置面**：`configForms`（0.1.7 起 `settingsScope` 已移除）。`inject` 只声明 `slots` / `locale`，设置面用 `ctx.get()` 软探测——Cordis 的依赖闸门是硬闸，`inject` 里任一服务在运行线上不存在，`apply()` 就永远不会执行（这正是 2.2.0 及更早版本在 0.1.7 上卡在 `pending (waiting for service: settingsScope)` 的原因）。
- **配置卡片槽位**：`plugins.bundle.config` / `plugins.row.config`（`settings.plugin.item` 已删除）。
- **schema 可写声明**：可写字段必须标 `volatile()`（`asVolatile`），否则写入被 0.1.7 的写入门直接拒绝；0.1.7 以 `{get(): T}` 活引用交付配置值，所有读取与合并路径都先解包（`unwrapVolatile` / `unwrapVolatileDeep`）。
- **折叠箭头用纯 CSS**，不静态导入任何 primitives 图标——图标命名族随版本变动，静态导入不是稳定契约。

## Windows 说明

- **账号数据目录**：插件读取 `%APPDATA%\Trae CN` / `%APPDATA%\TRAE SOLO CN` 下的 `User\globalStorage\storage.json`（与安装目录无关）。目录名与 macOS 一致，无需额外配置；若目录名对不上，可用插件配置项 `authFile` + `edition` 直接指定完整路径。
- **应用版本头**：插件从安装目录 `<LOCALAPPDATA>\Programs\<AppName>\resources\app\product.json` 读取 `appVersion`，随请求发送 `x-app-version` / `x-ide-version`；读不到时这些头不发送（与旧版行为一致）。
- **Raw Chat 探测（已知限制）**：`model-cache` 依赖 `sqlite3` 命令行，Windows 默认未安装，Raw Chat 能力探测会失败并安全回退。Raw Chat 默认关闭，不影响主流程。
- 排查指引见 `docs/WINDOWS_TOKEN_PROBE.md`。

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
