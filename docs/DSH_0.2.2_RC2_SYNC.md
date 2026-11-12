# DSH 0.2.2-rc.2 同步结论

> 调研对象：桌面端宿主 **0.2.2-rc.2**（随包 `cordis@4.1.0`、`schemastery@3.19.0`、
> `@earendil-works/pi-ai@1.3.0`、新增 `@deepseek-ai/dsh-error@0.2.2-rc.2`）。
> 对照基线：`dsh-connect-trae` 4.18.1 / 宿主 0.2.2-rc.1。
> 结论一句话：**零代码适配、零契约破坏；只需要把版本锚点从 rc.1 挪到 rc.2。**

## 一、结论摘要

| 判断 | 结果 |
| --- | --- |
| 4.18.1 能否直接在 0.2.2-rc.2 上运行 | **能**。本机桌面端实测：`GET /plugins/dsh-connect-trae/usage` 返回 200 且 `signed-in`；Slot 检视器里本插件在用的 5 个槽全部 `active: true`（`sidebar.panellist` / `main` 两个是默认关闭的侧栏面板座位，`sidebarPanelEnabled: false` 时本就不注册渲染，属预期） |
| 官方升级指南条目 | **`v0.2.2-rc.2` 一节不存在** —— rc.2 之后没有登记在案的破坏性变更；rc.1→rc.2 之间发生的变更全部在 `v0.2.2-rc.1/` 那 19 条里 |
| 插件消费的 13 个宿主包中带 `.d.ts` 变化的 | **6 个**（llm 4 个文件 / llm-pi-ai 6 + 1 新增 / attachment 1 / client-ui-slots 2 / client-ui-settings 1 / client-ui-primitives 12）；其余 7 个**零文件变化** |
| 契约破坏 | **0 处**，`pnpm typecheck` 零报错（与 rc.1 那次缺 `maxRequestImages` 的 TS2739 不同） |
| 运行期行为破坏 | **0 处** |
| 需要改 peer 范围 | **不需要**，`0.2.2-rc.2` 已被 `>=0.1.7-rc.1 <0.3.0-0` 放行 |
| 三大价值（双区域 / 用量积分 / 每日签到） | **不受影响**，1476 条测试全绿 |

## 二、宿主变了什么

### 2.1 随包依赖

| 包 | 0.2.2-rc.1 | 0.2.2-rc.2 | 对本插件的意义 |
| --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 4.1.0 | 4.1.0 | 未变 |
| `@deepseek-ai/schemastery` | 3.19.0 | 3.19.0 | 未变 |
| `@earendil-works/pi-ai` | 1.3.0 | 1.3.0 | 未变 |
| `@deepseek-ai/dsh-error` | —（`HarnessError` 住在 `dsh-llm`） | **0.2.2-rc.2（新增包）** | 错误基类搬家，见 2.2 |

### 2.2 逐包核对（13 个插件消费的宿主包）

判据是 **`lib/types/**/*.d.ts` 的逐字节比对**：rc.2 的 npm 包里额外带上了 `src/` 与 `.map`，
那些不是契约面，只比 `.d.ts`。结果 6 个包有变化、7 个包逐字节相同
（`dsh-atomic-write` / `dsh-home-paths` / `dsh-host-webserver` / `dsh-settings` /
`dsh-client-ui-renderer` / `dsh-client-ui-settings-plugins` / `dsh-client-locale` 的类型面均未变）。

**有变化（6）**

- `dsh-llm`：`HarnessError` 迁到新包 `@deepseek-ai/dsh-error` 并由 `dsh-llm` **重新导出**
  （两条 import 路径仍是同一个类）；`LlmError` 构造器的 `code` 参数从 `string` **收窄为**
  `BuiltinLlmFailureCode`，非内置码改走新增的 `LlmError.fromFailure(failure)`；新增
  `LLM_FAILURE_CODES` / `RETRY_CODE_CHOICES` 两个导出；`AppIdentity` 新增可选 `suffix`；
  工具声明重放（`rebaseAdditionOnlyHistory`）的语义修正。
- `dsh-llm-pi-ai`：新增 `prefix-binding.ts` —— Anthropic Messages 的签名 thinking 现在
  **绑定到请求前缀摘要**，前缀变了（压缩、工具结果裁剪）就把签名 thinking 摘掉再发；
  `PiAiAdapterOptions` 新增可选 `onThinkingOmitted`；`toPiContext` / `toPiReplayState` /
  `toPiAssistant` / `toStreamChunks` 的**末尾**各加一个可选参数；模型发现支持 Gemini。
- `dsh-attachment`：`AttachmentError` 由「照抄 `HarnessError` 形状」改为**真的继承**它
  （避免环依赖的旧注释随 `dsh-error` 抽包而失效）；`code` 与 `name` 不变。
- `dsh-client-ui-slots`：`SlotKind` 新增 `'hoc'`，配套 `HocRenderOpts` / `HocKeysOf` /
  `HocShare`；`hoc` 的 cell 是 `(key|wildcard, id)`，按 `priority` + `order` 排序；
  崩溃退让规则里 `chain` 与 `hoc` 都不退让（`single` / `keyed` / `list` 仍退让）。
- `dsh-client-ui-settings`：`settings.launcher` 的 `openSettings` 从 `() => void` 变为
  `(sectionId?: string) => void`。
- `dsh-client-ui-primitives`：`Modal` 新增 `tone?: 'warning'`；`Menu` 的子菜单交互改为
  悬停 / 聚焦 / 点击 / 方向键都能开，新增 `isExternalTrigger`；`useAnchoredPosition` 从
  公开出口**移除**；新增 `FenceCodeBlock` / `FenceMathBlock` / `usePointerGrace`。

### 2.3 官方升级指南 19 条：逐条不击中

`docs/upgrade-guide/v0.2.2-rc.1/` 里 19 条，本插件涉及的**服务/API 一个都没碰**：

| 条目 | 为什么不击中 |
| --- | --- |
| account-notification-fields / account-remote-provider | 插件不导入 `dsh-deepseek-account`，也不读通知 API |
| archive-worktrees | 不使用 worktree 服务 |
| attachment-error-codes | 插件只用 `AttachmentStore` **类型**，从不构造或捕获 `AttachmentError` |
| cua-ax-read-limits / cua-hover-ax-only / cua-native-platform | 不使用 CUA |
| dsh-doc-skill | 不引用任何 skill 名称 |
| forge-* 三条 | 不使用 `ctx.forge` |
| plugin-update-method | 不调 `pluginManager.listBundles()`，也不对 `ManagementError['code']` 做穷举 |
| runtime-context-reminders | 只把 `source.sections` 当**文本**读，不按字面匹配提醒包装 |
| session-append-overloads | 全仓没有 `Session.append` 的替换实现 |
| subagent-interrupt-default | 不注册 subagent 工具 |
| terminal-backend-cleanup-error / terminal-bundle-sidebar-backend | 不使用 terminal |
| web-search-billing | 不构造 `DeepSeekSearchApiOptions` / `DeepSeekFetchApiOptions` |
| window-drag-regions | 见下 |

`window-drag-regions` 值得单独说一句，因为它看上去会击中「浮层」：这条只影响**覆盖
`data-window-drag` 页头行**的自定义浮层。本插件两个 `position: fixed` 的元素——积分弹出面板
（`z-index: 1100`，锚在 composer 或侧栏行上）与忙碌遮罩（`inset: 0`，`z-index: 60`）——
都不覆盖页头行，`src/client/**` 里也没有任何 `app-region` / `no-drag` 依赖。不击中。

## 三、为什么「零代码改动」是实测出来的，不是推断

在仓库的临时副本里做了完整一轮，**没有动主工作树**：

| 步骤 | 结果 |
| --- | --- |
| 13 个 devDependency rc.1 → rc.2 + `pnpm install` | 通过 |
| `pnpm run typecheck` | **0 错误** |
| `pnpm run test` | **115 文件 / 1476 条全过** |
| `pnpm run build` | 通过，产物 `lib/{index.js,index.d.ts,client.js}` 与 rc.1 开发树构建的**逐字节相同** |

最后一条是最强的证据：构建产物一个字节都没变，说明这次升级没有从任何被消费的 `.d.ts`
里带出可观察的差异（`tsdown` 的 dts 输出对类型变化是敏感的）。

### 3.1 一处需要注意的「类型收窄」

`LlmError` 的构造器现在只接受内置码。本插件**从不构造 `LlmError`**（`src/**` 里唯一的
`throw new Error(...)` 是 pi-ai 凭证生命周期占位），所以这一条只是记录在案，不是待办。
将来若要构造，非内置码必须走 `LlmError.fromFailure()`。

### 3.2 `prefix-binding` 为什么对本插件无影响

它只对 `api === 'anthropic-messages'` 的路由生效。本插件的 `toPiModel` 把每一行钉在
Trae 的 `openai-completions` 协议上，`bindThinkingToPrefix` 在入口就返回原样。
Trae 的 SOLO 通道也不产生 Anthropic 签名 thinking。

## 四、本次实际改动面

只碰版本锚点与文档，**源码零改动**：

| 文件 | 改动 |
| --- | --- |
| `package.json` | 13 个 `@deepseek-ai/dsh-*` devDependency → `0.2.2-rc.2` |
| `pnpm-lock.yaml` | 重新生成（rc.1 条目 200 处 → rc.2 242 处） |
| `tests/dsh-peer-range.spec.ts` | `MUST_ADMIT` 补 `0.2.2-rc.2`，「current host」注释挪到新版本 |
| `pnpm-workspace.yaml` | override 注释里的宿主版本号 rc.1 → rc.2（值本身不变） |
| `README.md` / `README.en.md` | 兼容表与「同步结论」指向本节 |
| `CHANGELOG.md` | 新增 `## 4.18.2 (2026-11-13)` 一节（条目先暂存在 `docs/PENDING_CHANGELOG.md`，发版时并入并删除该文件） |

`peerDependencies` **零改动**：`cordis` 仍是 `>=4.0.4 <5.0.0`，13 个 `dsh-*` 仍是
`>=0.1.7-rc.1 <0.3.0-0`，`schemastery` 仍是 `>=3.18.4 <4.0.0`，`pi-ai` 仍是
`>=0.85.1 <2.0.0`。rc.2 与这些区间全部相容，已由 `tests/dsh-peer-range.spec.ts` 钉住。

## 五、三大价值的回归核对

| 价值 | 承载链路 | 本次是否触碰 | 证据 |
| --- | --- | --- | --- |
| 国内版与国际版双供应商并行 | 三个 panel → `trae` / `trae-enterprise` / `trae-global` 注册、按区域目录与镜像选择 | 否 | `tests/settings-integration.spec.ts` 全绿 |
| 用量与积分概览 | `/plugins/dsh-connect-trae/usage` 与账号/积分路由、卡片轮询 | 否 | 路由与卡片测试全绿；本机 rc.2 实测该路由 200、`signed-in` |
| 每日签到领取 | `/plugins/dsh-connect-trae/checkin`（CN）与卡片签到行 | 否 | `tests/card-checkin.spec.tsx` 等全绿 |

## 六、验证结果

| 项目 | 结果 |
| --- | --- |
| `tsc -p tsconfig.json` | 0 错误 |
| `tsc -p tsconfig.client.json` | 0 错误 |
| `vitest run` | **115 文件 / 1476 用例全过** |
| `tsdown` 构建 | 通过，产物与 rc.1 开发树**逐字节相同** |
| 真实宿主 | 0.2.2-rc.2 桌面端，`GET /plugins/dsh-connect-trae/usage` → 200 / `signed-in` |
| 槽位契约 | 活宿主检视：本插件声明注册的 7 个槽 kind 全部与 rc.1 相同——`conversation.input.model.label` = `single`；`settings.section` / `settings.section.icon` / `conversation.input.right` / `conversation.composer.dock` / `sidebar.panellist` = `list`；`main` = `keyed`（`sidebar.panellist` / `main` 只在侧栏面板开关打开时注册，默认关闭） |
| 构建产物 require | 仍只有 `react` / `react-dom` / `react/jsx-runtime` |

## 七、明确不采纳 / 留待下一版

- **`settings.launcher` 的带参 `openSettings(sectionId)`**：rc.2 给了官方入口，本插件
  现在仍走「读 `sidebar.settings` 的 store seat 调 `openSection(id)`」（见
  `src/client/settings-route.ts`，那份注释里「No other id-targeted seam exists」的依据
  在 rc.2 已不成立）。换成官方入口可以去掉对别的 bundle 私有 store 形状的依赖，但要为
  0.1.7–0.2.2-rc.1 那批宿主保留能力探测，属于**下一版的可选优化**，不是本次同步的必需项。
- **`hoc` 槽**：rc.2 只有 `conversation.chat.markdown.fence` 与 `conversation.hero.frame`
  两处声明为 `hoc`，本插件不注册、也不消费任何 `conversation.chat.*` / `hero` 槽。
- 其余新增能力（`Modal.tone`、`Menu` 子菜单交互、`FenceCodeBlock`、Gemini 发现、
  `onThinkingOmitted` 观测点）本插件都用不到。
