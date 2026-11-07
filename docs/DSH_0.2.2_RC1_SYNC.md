# DSH 0.2.2-rc.1 同步结论

> 调研对象：桌面端宿主 **0.2.2-rc.1**（随包 `cordis@4.1.0`、`schemastery@3.19.0`、
> `@earendil-works/pi-ai@1.3.0`）。
> 对照基线：`dsh-connect-trae` 4.8.0 / 宿主 0.2.1-rc.5。
> 结论一句话：**运行期无需适配即可工作；工程上必须补 2 个字段才能把开发树升到 0.2.2。**

## 一、结论摘要

| 判断 | 结果 |
| --- | --- |
| 4.8.0 能否直接在 0.2.2-rc.1 上运行 | **能**。本机桌面端实测：插件已加载，`GET /plugins/dsh-connect-trae/usage` 返回 200 且 `signed-in` |
| 插件消费的 13 个宿主包中带实质变化的 | **8 个**（attachment / client-locale / client-ui-primitives / client-ui-settings / client-ui-settings-plugins / host-webserver / llm / llm-pi-ai） |
| 契约破坏 | **1 处**：`ResolvedPiAiProviderProfile` 新增两个必填字段，手工构造 profile 的类型检查失败 |
| 运行期行为破坏 | **0 处**（缺省值让旧 profile 继续工作） |
| 需要改 peer 范围 | **不需要**，`0.2.2-rc.1` 已被 `>=0.1.7-rc.1 <0.3.0-0` 放行 |
| 三大价值（双区域 / 用量积分 / 每日签到） | **不受影响**，对应测试全绿 |

## 二、宿主变了什么

### 2.1 随包依赖换代

| 包 | 0.2.1-rc.5 | 0.2.2-rc.1 | 对本插件的意义 |
| --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 4.0.5 | **4.1.0** | Fiber 配置模型重构（`rawConfig` / `effectiveConfig` / `resolveConfig`）、`LoggerLevel` 枚举数值重排、`Impl` 结构变化、`notify()` 改为返回 `void` |
| `@deepseek-ai/schemastery` | 3.18.5 | **3.19.0** | 代码与 3.18.5 逐字节相同，仅 `cosmokit` 依赖升到 `~1.9.0` |
| `@earendil-works/pi-ai` | 1.1.0 | **1.3.0** | 默认上下文 262,144 → **1,000,000**、默认 `maxTokens` 32,768 → **128,000**；新增请求级图片数量上限；工具参数非法时以 `MALFORMED_RESPONSE` 失败 |

### 2.2 逐包核对（13 个插件消费的宿主包）

**有实质变化（8）**

- `dsh-llm`：`LlmModelInfo` 新增可选 `badge`（`LocalizedText` + `neutral/info/success/warning`）；
  新增事件 `llm/models-updated(provider)`；`GenerateOptions` 增加 `Purpose` 泛型参数。
- `dsh-llm-pi-ai`：`ResolvedPiAiProviderProfile` **新增两个必填字段** `maxRequestImages` /
  `imageOffloadCountQuantum`；`PiAiAdapterOptions` 新增 `prepareHeaders`，并新增
  `llm-pi-ai/request-headers` waterfall；中间系统消息改为按 `supportsMidConvoSystemMessages`
  决定原生保留还是折成 `<system-reminder>`；Anthropic 兼容门禁新增 `supportsMidConvoEffort`。
- `dsh-host-webserver`：新增 `WebResource` / `WebResourceRoute`，`register()` 与
  `registerFallback()` 可以收资源路由，新增 `readResource(request, peer)`；
  `webserver/index-inject(table, peer)` 与 `renderIndex(html, peer)` 增加 Peer 参数。
  **handler 路由的签名与语义未变。**
- `dsh-client-locale`：新增 ja / es / fr / de / ru / pt 六种语言字典；typed `register()` 的
  参数类型扩为「基线语言 + 可选额外语言」，`{ zh, en }` 仍合法。
- `dsh-client-ui-settings`：新增 `settings.section.icon` 槽位。
- `dsh-client-ui-settings-plugins`：仅新增六种语言字典。
- `dsh-client-ui-primitives`：42 个文件变化（新增 `TooltipSide` 等）。本插件不 import 该包。
- `dsh-attachment`：`AttachmentAdmissionPart` 新增「已存储图片引用」变体；`admitPrompt`
  文档澄清；`readImage` 校验说明细化。全部为类型/文档层扩展。

**逐字节未变（5）**

`dsh-atomic-write`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`、`dsh-home-paths`、`dsh-settings`。

> `dsh-client-ui-slots` 与 `dsh-client-ui-renderer` 未变意味着本插件注册的全部槽位契约不变：
> `plugins.bundle.config`、`plugins.row.config`、`conversation.input.right`、
> `conversation.input.model.label`、`sidebar.panellist`、`main`。

## 三、唯一的必改项

### 3.1 现象

把 devDependencies 升到 0.2.2 后，`tsc -p tsconfig.json` 报：

```
src/adapter.ts(545,9): error TS2739: Type '{ … }' is missing the following properties from type
'ResolvedPiAiProviderProfile': maxRequestImages, imageOffloadCountQuantum
```

### 3.2 根因

本插件**不走** `dsh-llm-pi-ai` 的配置解析（`resolveProfiles`）——它从实时 Trae 目录手工构造
`ResolvedPiAiProviderProfile` 直接交给 `PiAiAdapter`。宿主新增的默认值只发生在配置解析路径，
所以：

- **类型层**：`ResolvedPiAiProviderProfile` 说这两个字段必填 → 编译失败；
- **运行层**：手写 profile 里没有这两个键，`toPiContext` 走「`undefined` = 不限制张数」分支
  → 不崩，只是 0.2.2 新增的「张数超限 → `IMAGE_OFFLOAD_REQUIRED`」流程对 Trae 路由不生效。

这正是 4.8.0 在 0.2.2 上照常工作的原因，也是为什么只升级依赖、不改代码会先红 typecheck 而不是
用户侧故障。

### 3.3 修法

在 `src/adapter.ts` 的 `REQUEST_IMAGE_BUDGETS`（会被 spread 进 profile）补上宿主默认值：

```diff
 const REQUEST_IMAGE_BUDGETS = {
   maxRequestImageBytes: 20_971_520,
   requestImagePixelBudget: 4_194_304,
   requestImageMaxBytes: 1_048_576,
+  maxRequestImages: 50,
+  imageOffloadCountQuantum: 10,
 } as const
```

`50 / 10` 是宿主对配置路由的默认值（50 张来自 Azure OpenAI 的图片上限；quantum 取
`min(10, maxRequestImages)`）。对 0.2.1 旧宿主：多出来的对象键会被忽略，**类型与运行都通过**
（已实测）。

## 四、新增能力的采纳情况

| 能力 | 是否采纳 | 理由 |
| --- | --- | --- |
| `llm/models-updated(provider)` | **采纳** | 本插件的目录变化是「同一路由换了 roster」，`llm/adapters-updated` 只在路由拓扑变化时发，覆盖不到。现在在 `invalidateAdapter`（所有 `catalog.set` 路径的唯一收口）按 provider 发一次，并用签名去重，避免每次设置写入都让选择器重读 |
| `model.badge` 渲染 | **采纳（补回别人的 + 发布自己的）** | `conversation.input.model.label` 是 `single` 槽，本插件占住后宿主的「名字 + badge」内置渲染对**所有** provider 都不再生效。现在非 Trae 行按宿主顺序补回 badge（trigger 在前、菜单在后），并做语言回退；本插件自己的行行为不变。反向的一半见 4.15.0：本插件也开始在**自己的** `listModels()` 里发布 `badge`（此刻正在跑的促销 → `5 折` / `闲时 5 折` / `限时 5 折`），因为槽的赢家只能画出别人**发布过**的东西——不发布，一旦别的插件赢了那格，本插件的行就什么装饰都没有 |
| 新语言 ja/es/fr/de/ru/pt | **不采纳（决定）** | 只维护 zh / en；其他语言的用户按宿主回退链读英文 |
| `settings.section.icon` | **不适用** | 插件注册的是 `plugins.bundle.config` / `plugins.row.config`，不拥有 `settings.section` |
| `llm-pi-ai/request-headers` / `prepareHeaders` | **不采纳** | 插件不附加自定义推理请求头 |
| `supportsMidConvoEffort` | **不采纳** | openai-completions 路线用不到 |

## 五、三大价值的回归核对

| 价值 | 承载链路 | 本次是否触碰 | 证据 |
| --- | --- | --- | --- |
| 国内版与国际版双供应商并行 | 三个 panel → `trae` / `trae-enterprise` / `trae-global` 注册、按区域目录与镜像选择 | 否 | `tests/settings-integration.spec.ts`（两个区域 provider、区域各自的 fallback roster、区域级 image opt-in）；本次新增用例仍断言 `trae` / `trae-global` 都在 |
| 用量与积分概览 | `/plugins/dsh-connect-trae/usage` 与账号/积分路由、卡片轮询 | 否 | 路由与卡片测试全绿；本机 0.2.2 实测该路由 200、`signed-in` |
| 每日签到领取 | `/plugins/dsh-connect-trae/checkin`（CN）与卡片签到行 | 否 | `tests/card-checkin.spec.tsx` 等全绿 |

本次改动只落在：图像预算字段、目录变更公告、非本插件模型的 badge 渲染。三条价值链路没有改动。

## 六、开发树对齐

- 13 个 `@deepseek-ai/dsh-*` devDependency → `0.2.2-rc.1`
- `@deepseek-ai/cordis` → `^4.1.0`
- `@deepseek-ai/schemastery` → `3.19.0`，并同步 `pnpm-workspace.yaml` 的 override
  （`dsh-llm-pi-ai@0.2.2-rc.1` 声明 `~3.19.0`；override 留在 3.18.5 就是该文件注释警告的
  「开发树与用户实际解析不一致」）
- `@earendil-works/pi-ai` → `1.3.0`（宿主随包就是 1.3.0，不是 `^1.3.0`）
- 重新生成 `pnpm-lock.yaml`（CI 使用 `--frozen-lockfile`）

peerDependencies **零改动**；`tests/dsh-peer-range.spec.ts` 的 `MUST_ADMIT` 补入
`0.2.2-rc.1`。

## 七、验证结果

| 项目 | 结果 |
| --- | --- |
| `tsc -p tsconfig.json` | 0 错误（修复前 1） |
| `tsc -p tsconfig.client.json` | 0 错误 |
| `vitest run` | **103 文件 / 1335 用例全过**（新增 3 条：目录公告 1、badge 2） |
| `tsdown` 构建 | 通过（`lib/index.js` 540.97 kB、`lib/client.js` 496.75 kB） |
| 旧宿主回归 | 同一份补丁在 0.2.1-rc.5 的依赖树上 typecheck 0 错误 |
| 真实宿主 | 0.2.2-rc.1 桌面端，插件 4.8.0（改动前构建）已加载，usage 路由 200 |
| 构建产物 require | 仍只有 `react` / `react-dom` / `react/jsx-runtime`，全部在宿主共享模块表内 |

## 八、发布

- 版本：4.8.0 → **4.8.1**
- 变更条目：见 `CHANGELOG.md` 4.8.1 一节
- 说明：`llm/models-updated` 在 0.2.2 之前的宿主上是无人监听的未知事件，发出无副作用；
  因此本次不需要按宿主版本分支。
