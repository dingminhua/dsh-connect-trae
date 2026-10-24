# DSH 0.2.1-rc.1 升级同步记录

> 调研日期：2026-10-17
> 宿主：DSH Desktop，随包 `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.1`（后追加 rc.2 复核，见第九节；rc.3 复核，见第十节）
> 插件：`dsh-connect-trae` 3.6.1 → **3.7.0**
> 参考：`dsh-connect-workbuddy/docs/DSH-0.2.1-RC1-FOLLOWUP.md`（同批升级的姊妹项目调研）
> 基线：升级前 660 例全绿（pi-ai 0.85.1 / dsh 0.2.0-rc.1）

---

## 零、结论摘要

| 层 | 结论 | 所需动作 |
|---|---|---|
| **pi-ai 0.85.1 → 1.1.0 请求体** | ✅ **无回归** ，原因是 3.4.2 的双向适配已经覆盖。**但这是实测出来的，不是推断** | 加测试钉住（P0） |
| **pi-ai 1.1.0 类型契约** | 🔴 `TranscriptContext` 新增 `unique symbol` 品牌，适配层两处调用点 `TS2345` | **必须改代码**（P0） |
| **peer 版本范围** | ✅ `0.2.1-rc.1` 对现范围 **已判通过**（宿主用 `includePrerelease: true`） | 无（但收窄 pi-ai 上界） |
| **宿主 API / 客户端外壳** | ✅ 消费点签名未变 | 无 |
| **开发树版本漂移** | 🟡 devDependency 仍钉 `0.2.0-rc.1` / pi-ai `^0.85.1` | 对齐宿主实际版本 |

**一句话**：workbuddy 那份文档里最吓人的 P0（请求静默丢掉 system prompt 与工具）在本插件**不成立**——因为 trae 早就在做双向适配；真正需要动手的是**类型面**（1.1.0 加的品牌类型）和**版本对齐**。

---

## 一、与 workbuddy 文档的差异（先读，避免照抄结论）

那份文档描述的问题在 workbuddy 上成立，在 trae 上**部分不成立**。逐条对照：

| workbuddy 文档条目 | trae 的实际情况 |
|---|---|
| §1 P0：modern 分支是空的，直通导致丢 prompt/tools | ❌ 不成立。trae 有 `adaptModernPiAiContext`（`src/adapter.ts`），把顶层 `systemPrompt`/`tools` 折成 transcript 的 system 消息 |
| §1.4 推荐「内联折叠」方案 A | 已被更完整的实现替代：除 `content` 外还搬 `sections`、`toolsAdded`/`toolsRemoved`（按 name 重放） |
| §2.2「没有任何静态范围能覆盖任意 0.2.x 预发布」 | ❌ 结论只在 **semver 默认选项**下成立。DSH 用 `includePrerelease: true`，悬崖不触发 |
| §2.3「守卫测试比较器写错了」 | ❌ 不成立。`tests/dsh-peer-range.spec.ts` 早就用真 `semver` + `includePrerelease` |
| §3 P2 `TS2353`（`systemPrompt` 不在 `TranscriptContext`） | ✅ **成立且更严重**：1.1.0 是 `TS2345`，`TranscriptContext` 带品牌 |
| §6 `canDisableThinking` 逻辑反了 | ❌ 不适用。trae 没有这段代码（workbuddy 特有） |

> 教训：同一批宿主的同一次升级，**两个插件需要的动作可以完全不同**。照抄姊妹项目的修法会改错地方。

---

## 二、P0：pi-ai 1.1.0 下的请求体（结论：无回归，已钉住）

### 2.1 宿主侧的错配真实存在

- `dsh-llm-pi-ai@0.2.1-rc.1` 依赖 `@earendil-works/pi-ai@^1.1.0`。
- 但它的 `piContext()`（`lib/index.js:1287`）仍然产出**旧代信封** `{ systemPrompt, tools, messages }`，全文件 `normalizeContext` 出现 **0** 次——与 workbuddy 文档 §1.2 描述一致。
- pi-ai 1.1.0 的 `openai-completions.js` 里 `context.systemPrompt` / `context.tools` 出现次数均为 **0**，只走 `resolveTranscript()`。

**所以**：任何把宿主信封原样透传给 api 的插件，在 0.2.1-rc.1 上都会静默丢 prompt 与工具。

### 2.2 trae 实测（真实 SSE 捕获线上 body）

真实 `createProvider` + 真实 `openAICompletionsApi()` + 本地 SSE 服务器，
喂**宿主实际产出的**旧代信封：

| 场景 | 线上 `roles` | 线上 system | 线上 `tools` |
|---|---|---|---|
| 套 `withContextAdaptation(…, 'modern')`（trae 生产路径） | `["system","user"]` | `SYS-PROMPT-MARKER` | `1` ✅ |
| **不**套适配器（假设直通） | `["user"]` | `null` | `0` ❌ |

第二行正是 workbuddy 文档 §1.1 的现象。trae 靠 3.4.2 的适配绕开了它。

### 2.3 已固化为测试

`tests/pi-ai-context.spec.ts` 新增 `describe('request body survives the resolved pi-ai copy')`：

1. **线上请求体矩阵**：`roles[0] === 'system'`、system 文本等于原提示、`tools.length === 1`。
2. **幂等性**：已归一化的输入不二次包裹（system 消息只有 1 条）。
3. **反向对照**：不套适配器时，现代副本把 prompt 与 tools 丢光（`roles: ["user"]`、`system: null`、`tools: 0`，**不报错**）。

第 3 条是「为什么适配器是承重的」的活证据；只写第 1 条的话，将来有人删掉适配器，测试仍可能因为别的原因绿着。

---

## 三、P0：pi-ai 1.1.0 的类型契约（本次唯一必须改的代码）

### 3.1 现象

`npx tsc -p tsconfig.json` 在升级后报 10 处 `TS2345`：

```
src/adapter.ts(315,60): error TS2345: Argument of type 'Context' is not assignable
  to parameter of type 'TranscriptContext'.
  Property '[transcriptContextBrand]' is missing in type 'Context'
  but required in type 'TranscriptContext'.
```

### 3.2 根因

1.1.0 把 `ProviderStreams` 的第二参改成：

```ts
declare const transcriptContextBrand: unique symbol
export type TranscriptContext = {
  messages: Message[]
  readonly [transcriptContextBrand]: true
}
```

「只有 `normalizeContext()` 能产出」——这是 1.1.0 有意加的类型护栏。
而 `Context`（带可选 `systemPrompt`/`tools`）就是**不**可赋值的，这正是护栏想拦的。

### 3.3 为什么不能在适配层「诚实地」拿到品牌

两个理由都是设计使然，不是妥协：

1. **适配层位于归一化器之下**。`Models.stream()/streamSimple()` 调 `normalizeContext()` 后把
   真 transcript 交给 provider；`createProvider()` 原样转发给 `api.stream`。所以在现代化的路径上
   `adapt()` 是恒等函数，运行时拿到的**本来就是**带品牌的 transcript，只是类型看不见。
2. **旧代路径必须产出无品牌形状**。pi-ai ≤0.85 既没有 `normalizeContext` 也没有 transcript 类型，
   它的 api 要的正是 `adapt()` 返回的 `{ systemPrompt, tools, messages }`。

也就是说，交给 `api` 的值是「**那一代 api 所消费的上下文**」，两边编译单元各自的类型名都没法表达它。

### 3.4 修法

在**唯一一条边界**上做显式转型，并把理由写在调用点（`src/adapter.ts` 的 `withContextAdaptation`）：

```ts
const forApi = (context: Parameters<typeof adapt>[0]): Parameters<ProviderStreams['stream']>[1] =>
  adapt(context) as Parameters<ProviderStreams['stream']>[1]
```

测试侧同理，收进一个具名的 `send()` helper，而不是散落 `as never`。

---

## 四、P1：peer 范围（结论：无需改动，但要收窄 pi-ai 上界）

### 4.1 「预发布悬崖」在 DSH 上不触发

DSH 的求值方式（`dsh-app-boot/lib/index.js:277`）：

```js
return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true })
```

且 `unmetRequirements()` 只遍历 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`。

实测：

```
satisfies('0.2.1-rc.1', '>=0.1.7-rc.1 <0.3.0-0')                        → false   ← 默认选项
satisfies('0.2.1-rc.1', '>=0.1.7-rc.1 <0.3.0-0', {includePrerelease}) → true   ← 宿主实际
```

**因此 workbuddy 文档 §2.2 的「没有任何静态范围能覆盖任意 0.2.x 预发布」对 trae 不适用**，
`0.2.1-rc.1` 交给现范围已判通过，无需为 rc 硬凑枚举。

### 4.2 真正该改的是 pi-ai 上界

原范围 `>=0.85.1` **没有上界**，`2.0.0` 也会被放行——而 2.x 的契约未审阅。收窄为：

```jsonc
"@earendil-works/pi-ai": ">=0.85.1 <2.0.0"
```

实测：`0.85.1` ✅ / `1.1.0` ✅ / `1.3.0` ✅ / `2.0.0` ❌。

> 注意 pi-ai 那条 peer **不参与宿主校验**（宿主只校验 `@deepseek-ai/dsh*`）。改它主要是
> npm 安装语义与文档正确性；真正保护用户的是 §二、§三。

---

## 五、开发树对齐（防「本地绿、用户红」）

| 包 | 升级前 | 升级后 | 依据 |
|---|---|---|---|
| 13 个 `@deepseek-ai/dsh-*` | `0.2.0-rc.1` | `0.2.1-rc.1` | 宿主 app.asar 实际随包版本 |
| `@deepseek-ai/cordis` | `^4.0.4` | `^4.0.5` | 同上 |
| `@deepseek-ai/schemastery` | `3.18.4`（override 锁死） | `3.18.5`（override 同步抬升） | `dsh-llm-pi-ai@0.2.1-rc.1` 声明 `~3.18.5` |
| `@earendil-works/pi-ai` | `^0.85.1` | **`1.1.0`（精确）** | 宿主随包 `^1.1.0` 实际解析到的版本 |

**为什么 pi-ai 用精确版本而不是 `^1.1.0`**：`^1.1.0` 会解析到 `1.3.0`（当前最新），
那样本地 typecheck 与测试就**不是**用户实际运行的那份契约了。钉在 `1.1.0` 才能让
§三 的品牌类型问题在本机复现。

---

## 六、已核对确认「无需改动」

- **宿主 API**：`dsh-llm`、`dsh-settings`、`dsh-host-webserver`、`dsh-llm-pi-ai` 的消费点签名未变。
- **客户端外壳**：构建产物 `lib/client.js` 仍只 `require` react / react-dom / react/jsx-runtime，
  全在宿主模块注册表内；槽位与主题令牌未变。
- **`canDisableThinking`**（workbuddy 文档 §6）：trae 无此代码，不适用。

---

## 七、验证结果

| 项目 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | ✅ 通过 |
| `npx tsc -p tsconfig.client.json --noEmit` | ✅ 通过 |
| `npx vitest run` | ✅ **663** 例全绿（63 文件；原 660 + 新增 3） |
| `npx tsdown`（构建） | ✅ `lib/index.js` 278 KB / `lib/client.js` 220 KB |
| 真实宿主栈线上请求体 | ✅ `roles: ["system","user"]`、system 完好、`tools: 1` |

### 证据来源

- 宿主版本：`app.asar` → `dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.1`
  （`~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json` 的 `desktopVersion: 0.2.0-rc.2` 是**外壳**版本，不是插件运行时）
- 随包版本：`@deepseek-ai/dsh-*@0.2.1-rc.1`、`cordis@4.0.5`、`schemastery@3.18.5`、`@earendil-works/pi-ai@1.1.0`
- 宿主 peer 求值：`dsh-app-boot/lib/index.js:277` + `unmetRequirements()`（只认 `@deepseek-ai/dsh*`）
- 宿主信封：`dsh-llm-pi-ai/lib/index.js:1287` `piContext()`；`normalizeContext` 计数 0
- pi-ai 契约：`dist/api/openai-completions.js` 中 `context.systemPrompt`/`context.tools` 计数 0；
  `resolveTranscript()` 为唯一读取路径

---

## 八、发布

本记录对应 **3.7.0**（minor —— 它补齐了类型契约并新增回归防线，虽无用户可见行为变化）。
面向用户的说明见 [`RELEASE_NOTES_v3.7.0.md`](RELEASE_NOTES_v3.7.0.md)。

---

## 九、0.2.1-rc.2 复核（2026-10-17 晚）

宿主随包版本从 `0.2.1-rc.1` 推进到 **`0.2.1-rc.2`**。逐项核对结果如下。

### 9.1 依赖面

| 包 | rc.1 | rc.2 |
| --- | --- | --- |
| 13 个 `@deepseek-ai/dsh-*` | `0.2.1-rc.1` | **`0.2.1-rc.2`** |
| `@deepseek-ai/cordis` | `4.0.5` | `4.0.5`（未变） |
| `@deepseek-ai/schemastery` | `3.18.5` | `3.18.5`（未变） |
| `@earendil-works/pi-ai` | `1.1.0` | **`1.1.0`（未变）** |
| `dsh-llm-pi-ai` 对 pi-ai 的声明 | `^1.1.0` | `^1.1.0`（未变） |

**关键点：pi-ai 仍钉在 1.1.0。** 上一轮那套「1.1.0 只读 transcript、不读顶层字段」的判断继续成立，
适配层无需任何改动。

### 9.2 契约面：逐字节比对，零变化

对插件消费的宿主包，比对 **`.d.ts` 类型声明**与 **`lib/*.js` 运行时实现**：

```
= dsh-llm / dsh-llm-pi-ai / dsh-settings / dsh-host-webserver
= dsh-atomic-write / dsh-home-paths / dsh-attachment
= dsh-client-ui-renderer                                （类型 + 实现）
= dsh-app-boot（peer 门禁逻辑）
```

全部**逐字节相同**，包括 `satisfies()` 用 `{ includePrerelease: true }` 的求值方式。
pi-ai 的 `openai-completions.js` 与 `utils/transcript.js` 也未变。

> 这说明 rc.1 → rc.2 对**本插件**而言是纯版本号推进：没有新增/删除导出，没有签名变化，
> 没有行为变化。上一轮的全部结论原样成立。

### 9.3 peer 门禁

```
0.2.1-rc.1  -> true
0.2.1-rc.2  -> true     ← 新增，已放行
0.3.0-rc.1  -> false
```

范围 `>=0.1.7-rc.1 <0.3.0-0` **无需改动**。

### 9.4 实测复核（真实 rc.2 栈）

重跑线上请求体探针（`dsh-llm-pi-ai@0.2.1-rc.2` + `pi-ai@1.1.0` + 本地 SSE 捕获）：

| 场景 | 线上 `roles` | 线上 system | 线上 `tools` |
| --- | --- | --- | --- |
| 走适配器（生产路径） | `["system","user"]` | 完好 | `1` ✅ |
| 不走适配器 | `["user"]` | `null` | `0` ❌ |

与 rc.1 时完全一致。

### 9.5 一处需要解释的「消失」

payload 的 `node_modules` 里**没有** `dsh-client-ui-primitives` 与 `dsh-client-ui-slots`。
这不是本次升级造成的：旧宿主里同样没有。原因是这两个包在本插件里**只作类型层引用**
（`import type {} from ...`，用于 augment 宿主已注册的 service 类型），运行时由宿主 shell 提供。
它们保留在 `dsh.client.inject` 名册与 devDependency 中是正确做法。

### 9.6 本次改动与验证

- devDependency 13 项 → `0.2.1-rc.2`（`cordis` / `schemastery` / `pi-ai` 不变）
- `tests/dsh-peer-range.spec.ts` 的 `MUST_ADMIT` 补入 `0.2.1-rc.1` / `0.2.1-rc.2` / `0.2.1`——
  此前这条清单里**没有当前正在使用的版本**，是本次复核暴露的测试盲点
- 变异验证：把 peer 上界收窄到 `<0.2.1-rc.2` → 多个包的对应用例立刻变红
- 双 tsconfig 类型检查通过，**670** 例测试全绿，构建通过

---

## 十、0.2.1-rc.3 复核（2026-10-24）

宿主随包版本从 `0.2.1-rc.2` 推进到 **`0.2.1-rc.3`**。逐项核对结果如下。

### 10.1 宿主版本取证

| 取证点 | 值 |
| --- | --- |
| `DeepSeek Harness.app` → `CFBundleShortVersionString` / `CFBundleVersion` | `0.2.1-rc.3` |
| `app.asar/dsh/package.json` → `@deepseek-ai/dsh-desktop-runtime` | `0.2.1-rc.3` |
| `app.asar/dsh/node_modules/@earendil-works/pi-ai` | **`1.1.0`**（未变） |
| `app.asar/dsh/package.json` → `cordis` / `schemastery` | `4.0.5` / `3.18.5`（均未变） |

### 10.2 上游这一版改了什么

以 DSH 源码仓的 tag 为准（`dsh-v0.2.1-rc.2..dsh-v0.2.1-rc.3`，共 6 个提交）：

| 提交 | 性质 | 对本插件 |
| --- | --- | --- |
| `feat(ui): add navigation entry customization (#6247)` | 新增「导航项自定义」：面板固定/取消固定、More 菜单 | 不相干 |
| `feat(analytics): track navigation entries and preset selections (#6600)` | 埋点 | 不相干 |
| `fix(ui): separate navigation pins from selection and show menu icons (#6883)` | 上一条的修正 | 不相干 |
| `feat(llm): follow the official /models listing on the DeepSeek API-key route (#6944)` | DeepSeek 官方 API-key 通道的模型目录 | 不相干（本插件自带 Trae 供应商） |
| `release(dsh): 0.2.1-rc.3` | 版本号 | —— |

宿主新增的客户端包 `@deepseek-ai/dsh-client-ui-entry-customization` 注册三个槽位：
`sidebar.panellist.actions`、`conversation.session.header.views.actions`、`sidebar.right.tab.guide.actions`。

### 10.3 依赖面

| 包 | rc.2 | rc.3 |
| --- | --- | --- |
| 13 个 `@deepseek-ai/dsh-*` | `0.2.1-rc.2` | **`0.2.1-rc.3`** |
| `@deepseek-ai/cordis` | `4.0.5` | `4.0.5`（未变） |
| `@deepseek-ai/schemastery` | `3.18.5` | `3.18.5`（未变） |
| `@earendil-works/pi-ai` | `1.1.0` | **`1.1.0`（未变）** |
| `dsh-llm-pi-ai` 对 pi-ai 的声明 | `^1.1.0` | `^1.1.0`（未变） |

pi-ai 仍钉在 1.1.0：3.4.2 起的双向适配结论原样成立，**适配层无需任何改动**。

### 10.4 契约面：13 个包里只有 1 个有代码变化，且全是新增

对插件消费的 13 个宿主包，比对 npm 上 `0.2.1-rc.2` 与 `0.2.1-rc.3` 两版的**全量文件树**：

```
= dsh-llm / dsh-llm-pi-ai / dsh-settings / dsh-host-webserver
= dsh-atomic-write / dsh-home-paths / dsh-attachment
= dsh-client-ui-renderer / dsh-client-ui-settings
= dsh-client-ui-settings-plugins / dsh-client-ui-slots / dsh-client-locale
    （除 package.json 的版本号与内部依赖号外，逐字节相同）
≠ dsh-client-ui-primitives
```

`dsh-client-ui-primitives` 的变化逐条列举：

| 变化 | 性质 |
| --- | --- |
| `TooltipSide` 增加 `'left'`；`Tooltip` 改用实测边框盒做「首选侧 → 对侧 → 垂直侧」换边放置，放不下时退回视口边界 | 新增能力 + 行为优化 |
| 新增 `lib/tooltip-placement.ts`（`placeTooltip()`，含 `overflow` 标记） | 新增导出 |
| `MenuItemButton` 增加 `current` prop | 新增可选 prop |
| `Menu` 增加 `minWidthFromAnchor` prop | 新增可选 prop |
| 图标新增 `IconAppsAddOutlineRegular` / `IconAppsAddOutlineMedium` | 新增导出 |

**为什么不需要适配**：本插件对 `dsh-client-ui-primitives` 只有**类型层引用**
（`import type {} from '@deepseek-ai/dsh-client-ui-primitives'`），运行时不导入它的任何组件，
因此这些新增 prop 与新的放置算法对本插件**不可见**。既没有签名被删改，也没有导出被移除。

### 10.5 槽位核对：本插件注册的 5 个槽位全部健在

| 槽位 | rc.2 | rc.3 |
| --- | --- | --- |
| `plugins.bundle.config` | 存在 | 存在（契约未变） |
| `plugins.row.config` | 存在 | 存在（契约未变） |
| `conversation.input.left` | 存在 | 存在（契约未变） |
| `conversation.composer.dock` | 存在 | 存在（契约未变） |
| `conversation.input.model.label` | 存在 | 存在（契约未变） |

宿主 rc.3 的 `dsh-client-ui-conversation` 只**新增**了一个槽位
（`conversation.session.header.views.actions`）与两处契约字段
（`MessageSubmission` 的 `newSession` / `agentPreset`；`DraftInitializationOptions.whenDraftExists`），
均为**可选新增**，本插件不消费。

### 10.6 peer 门禁

```
0.2.1-rc.2  -> true
0.2.1-rc.3  -> true     ← 新增，已放行
0.3.0-rc.1  -> false
```

范围 `>=0.1.7-rc.1 <0.3.0-0` **无需改动**。

### 10.7 本次改动与验证

- devDependency 13 项 → `0.2.1-rc.3`（`cordis` / `schemastery` / `pi-ai` 不变）
- `tests/dsh-peer-range.spec.ts` 的 `MUST_ADMIT` 补入 `0.2.1-rc.3`
- **代码零改动**：13 个宿主包里唯一有代码变化的 `dsh-client-ui-primitives` 对本插件只是类型层引用
- 双 tsconfig 类型检查通过，**1080** 例测试全绿，构建通过
