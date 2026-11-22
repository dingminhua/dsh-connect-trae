# DSH 0.2.2-rc.5 同步结论

> 调研对象：桌面端宿主 **0.2.2-rc.5**（随包 `cordis@4.1.0`、`schemastery@3.19.0`、
> `@earendil-works/pi-ai@1.3.0`、`@deepseek-ai/dsh-error@0.2.2-rc.5`）。
> 对照基线：`dsh-connect-trae` 4.18.5 / 宿主 0.2.2-rc.3（上一个同步锚点）。
> 结论一句话：**rc.4 只给 `dsh-llm` 加了一个错误码成员，rc.5 本身对插件消费面零改动；
> 两条新增官方指南都不击中本插件，仍然只需挪版本锚点、源码零改动。**

## 一、结论摘要

| 判断 | 结果 |
| --- | --- |
| 4.18.5 能否直接在 0.2.2-rc.5 上运行 | **能**。peer 范围实测放行；插件消费的 13 个宿主包类型面/运行时无破坏 |
| 官方升级指南 | rc.3 之后新增 **2 条**：`v0.2.2-rc.3`（拒答错误码）、`v0.2.2-rc.4`（搜索默认）。两条都**不击中**本插件 |
| 13 个宿主包的运行时 `lib/**/*.js` | rc.3 → rc.4 **仅 `dsh-llm` 3 个文件变**（新增错误码）；rc.4 → rc.5 **0 个文件变** |
| 类型面 `.d.ts` | 同上，只有 `dsh-llm` 的 `error.d.ts` 多一个成员；其余 12 包逐字节相同 |
| 契约破坏 | **0 处**，pnpm typecheck 零报错 |
| 槽位目录 | rc.3 / rc.4 / rc.5 均 **116**，新增/移除/kind 变化 **全为 0** |
| 需要改 peer 范围 | **不需要**，`0.2.2-rc.4` / `0.2.2-rc.5` 已被 `>=0.1.7-rc.1 <0.3.0-0` 放行（实测） |
| 三大价值（双区域 / 用量积分 / 每日签到） | **不受影响** |

## 二、宿主变了什么

### 2.1 随包依赖

| 包 | 0.2.2-rc.3 | 0.2.2-rc.5 | 说明 |
| --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 4.1.0 | 4.1.0 | 未变（各包声明 `~4.1.0`） |
| `@deepseek-ai/schemastery` | 3.19.0 | 3.19.0 | 未变（各包声明 `~3.19.0`） |
| `@earendil-works/pi-ai` | 1.3.0 | 1.3.0 | 未变 |
| `@deepseek-ai/dsh-error` | 0.2.2-rc.3 | 0.2.2-rc.5 | 只跟版本号 |

### 2.2 逐包核对（13 个插件消费的宿主包）

判据分两件事：**运行时**（`lib/**/*.js`）与**类型面**（`lib/types/**/*.d.ts`），
逐字节比对 npm 上 rc.3 / rc.4 / rc.5 三个 tag 的整包。

| 包 | rc.3 → rc.4 | rc.4 → rc.5 | README |
| --- | --- | --- | --- |
| `dsh-llm` | **变了（3 文件）** | 相同 | 相同 |
| 其余 12 个包 | 相同 | 相同 | 相同 |

`dsh-llm` 的唯一实质变化：错误码表新增 `CONTENT_REFUSED` 成员
（`lib/index.js`、`lib/types/error.d.ts` / `.js` 及对应 source map）。
这是官方 `v0.2.2-rc.3` 升级指南「DeepSeek 内容拒答错误码」那一条 —— 宿主现在把
`stop_reason: "refusal"` 终止的流报成 `CONTENT_REFUSED`，此前报 `MALFORMED_RESPONSE`。
它只是**新增一个错误码成员**，既不删除也不改类型，因此任何现有代码都不破。

**对本插件没有影响**：本仓库说的 "refusal" 全是 **Trae 上游的业务拒绝**
（HTTP 200 + 非零 `code`，如 `9074` / `9095`；见 `src/usage.ts`、`src/solo-bridge.ts`、
`src/client/checkin-error.ts`），由插件自己的 `classifyTraeFailure` 分类。插件既不消费
DSH 的 `LLMError` 错误终止块，也不读 `turn/end` 错误的 `code`，更没有
`MALFORMED_RESPONSE` 字面量。新增成员落在插件从未触及的类型上。

### 2.3 槽位目录：116 → 116 → 116，零变化

从 `dsh-cordis-client-runner` 的 `slot-catalog.ts` 解析 `key` 全表：

| 版本 | 槽位数 | 新增 | 移除 | kind 变化 |
| --- | --- | --- | --- | --- |
| rc.3 | 116 | — | — | — |
| rc.4 | 116 | 0 | 0 | 0 |
| rc.5 | 116 | 0 | 0 | 0 |

本插件注册的 7 个槽（`settings.section`、`settings.section.icon`、
`conversation.input.right`、`conversation.composer.dock`、
`conversation.input.model.label`、`sidebar.panellist`、`main`）契约全部未变。

### 2.4 另外核对过的宿主包（不在 13 个 devDependency 里）

| 包 | rc.3 → rc.5 变化 | 对本插件 |
| --- | --- | --- |
| `dsh-client-ui-settings-general` | `lib/client.js` 唯一实质差异是「当前版本」文案的版本号 rc.3 → rc.4 → rc.5 | 无 |
| `dsh-client-ui-model-selection` | 只有 `package.json` 的版本引用 | 无 |
| `dsh-plugin-manager` | 只有 `package.json` | 无（本插件不调 `listBundles`） |
| `dsh-deepseek-account` | 只有 `package.json` | 无 |

## 三、官方升级指南：两条，都不击中

rc.3 之后 `docs/upgrade-guide/` 新增两节。逐条核对：

### `v0.2.2-rc.3` — DeepSeek 内容拒答错误码

迁移要求是「对 LLM 错误终止块 / `turn/end` 错误分类的代码处理 `CONTENT_REFUSED`」。
本插件没有这类代码（见 2.2 的 refusal 区分）。**跳过**。

### `v0.2.2-rc.4` — DeepSeek 模型上的搜索默认使用旧版 Messages 搜索

变更是基础组合不再固定 `web.searchProvider`，改由 `dsh-web` 按模型路由。
迁移 Step 1「接受新默认值无需修改」，Step 2/3 是给**设置了网关或自定义 provider 的部署**
用的。本插件不设置 `web.searchProvider`、不提供搜索 provider、不读搜索事件，**跳过**。

> 注：`v0.2.2-rc.1` 的 19 条指南此前已逐条排除（见
> `docs/DSH_0.2.2_RC3_SYNC.md` 与 CHANGELOG 4.8.x 那几节），rc.3 → rc.5 没有新增条目重新打开它们。

## 四、本次实际改动面

只碰版本锚点与文档，**源码零改动**：

| 文件 | 改动 |
| --- | --- |
| `package.json` | 13 个 `@deepseek-ai/dsh-*` devDependency → `0.2.2-rc.5` |
| `pnpm-lock.yaml` | 重新生成（rc.3 条目 0 处 → rc.5 161 处） |
| `tests/dsh-peer-range.spec.ts` | `MUST_ADMIT` 补 `0.2.2-rc.4` / `0.2.2-rc.5`，更新「current host」注释 |
| `pnpm-workspace.yaml` | override 注释里的宿主版本号 rc.3 → rc.5（值本身不变） |
| `README.md` / `README.en.md` | 兼容表与「同步结论」补 rc.5 |
| `CHANGELOG.md` | 记 rc.5 同步结论；补 issue #92 的遗漏条目 |

`peerDependencies` **零改动**：`cordis` 仍是 `>=4.0.4 <5.0.0`，13 个 `dsh-*` 仍是
`>=0.1.7-rc.1 <0.3.0-0`，`schemastery` 仍是 `>=3.18.4 <4.0.0`，`pi-ai` 仍是
`>=0.85.1 <2.0.0`。rc.4 / rc.5 与这些区间全部相容，已由
`tests/dsh-peer-range.spec.ts` 钉住（`MUST_ADMIT` 里现在有 rc.1–rc.5 五个实测过的宿主）。

## 五、三大价值的回归核对

| 价值 | 承载链路 | 本次是否触碰 | 证据 |
| --- | --- | --- | --- |
| 国内版与国际版双供应商并行 | 三个 panel → `trae` / `trae-enterprise` / `trae-global` 注册、按区域目录与镜像选择 | 否 | 全仓测试全绿 |
| 用量与积分概览 | `/plugins/dsh-connect-trae/usage` 与账号/积分路由、卡片轮询 | 否 | 路由与卡片测试全绿 |
| 每日签到领取 | `/plugins/dsh-connect-trae/checkin`（CN）与卡片签到行 | 否 | `tests/card-checkin.spec.tsx` 等全绿 |

## 六、验证结果

| 项目 | 结果 |
| --- | --- |
| `pnpm run check`（typecheck + test + build） | 全绿 |
| `vitest run` | **116 文件 / 1497 例全过** |
| `tsdown` 构建 | 通过；`lib/index.js` / `index.d.ts` / `client.js` 与本节原始 4.18.5 产物 **SHA-256 逐一相同** |
| `DSH_STRICT_PRIVACY=1 verify:privacy` | 17 项无跳过 |
| peer 范围变异验证 | 把上界临时改成 `<0.2.2-rc.4`，`dsh-peer-range.spec.ts` 立刻 9 例变红；已还原 |
| 真实宿主 | 0.2.2-rc.5 桌面端，`GET /plugins/dsh-connect-trae/usage` → **200** / `signed-in` / 33 模型 / 2 账号 |
| 槽位契约 | 116 个槽零变化；插件注册的 7 个槽 kind 未变 |

「构建产物与上个发布逐字节相同」是最强的证据之一：rc.4/rc.5 唯一的类型面变化
（`CONTENT_REFUSED`）落在插件从未 import 的 `dsh-llm` 错误码表上，所以 dts 输出不变。

## 七、明确不采纳

- **`CONTENT_REFUSED` 处理**：本插件没有 LLM 错误终止块 / `turn/end` 分类代码，
  Trae 业务拒绝由自有 `classifyTraeFailure` 处理，两码不相交。
- **搜索 provider 的自动选择设置**：插件不提供搜索 provider，也不设置
  `web.searchProvider` / `DSH_WEB_SEARCH_PROVIDER`，无需跟进。
- **`settings.launcher` 的带参 `openSettings(sectionId)`**：rc.2 起就存在、每次再确认
  未变的可选优化项，留待后续版本，理由见 `docs/DSH_0.2.2_RC2_SYNC.md` 第七节。
