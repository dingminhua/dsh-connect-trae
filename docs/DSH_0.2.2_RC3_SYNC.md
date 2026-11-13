# DSH 0.2.2-rc.3 同步结论

> 调研对象：桌面端宿主 **0.2.2-rc.3**（随包 `cordis@4.1.0`、`schemastery@3.19.0`、
> `@earendil-works/pi-ai@1.3.0`、`@deepseek-ai/dsh-error@0.2.2-rc.3`）。
> 对照基线：`dsh-connect-trae` 4.18.2 / 宿主 0.2.2-rc.2。
> 结论一句话：**比 rc.2 更轻——13 个包的运行时文件逐字节相同，只有 primitives 多了两个图标；仍然只需挪版本锚点。**

## 一、结论摘要

| 判断 | 结果 |
| --- | --- |
| 4.18.2 能否直接在 0.2.2-rc.3 上运行 | **能**。本机桌面端实测：`GET /plugins/dsh-connect-trae/usage` 返回 200、`signed-in`、33 个模型、2 个账号 |
| 官方升级指南条目 | **没有 `v0.2.2-rc.2` / `v0.2.2-rc.3` 两节** —— 最新仍为 `v0.2.2-rc.1` 那 19 条 |
| 13 个宿主包的运行时 `lib/**/*.js` | **逐字节完全相同（0 个文件不同）**，全部 README 也未变 |
| 带 `.d.ts` 变化的包 | **只有 1 个**：`dsh-client-ui-primitives` 的 2 个图标文件 |
| 契约破坏 | **0 处**，`pnpm typecheck` 零报错 |
| 运行期行为破坏 | **0 处**，构建产物与已发布的 4.18.2 逐字节相同 |
| 槽位目录 | 114 → **116**，只增不减、**零 kind 变化** |
| 需要改 peer 范围 | **不需要**，`0.2.2-rc.3` 已被 `>=0.1.7-rc.1 <0.3.0-0` 放行 |
| 三大价值（双区域 / 用量积分 / 每日签到） | **不受影响**，1476 条测试全绿 |

## 二、宿主变了什么

### 2.1 随包依赖

| 包 | 0.2.2-rc.2 | 0.2.2-rc.3 | 说明 |
| --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 4.1.0 | 4.1.0 | 未变 |
| `@deepseek-ai/schemastery` | 3.19.0 | 3.19.0 | 未变 |
| `@earendil-works/pi-ai` | 1.3.0 | 1.3.0 | 未变 |
| `@deepseek-ai/dsh-error` | 0.2.2-rc.2 | 0.2.2-rc.3 | 只跟版本号 |

### 2.2 逐包核对（13 个插件消费的宿主包）

判据是两件事分开看：**运行时**（`lib/**/*.js`，逐字节）与**类型面**
（`lib/types/**/*.d.ts`，逐字节）。

| 包 | 运行时 | 类型面 | README |
| --- | --- | --- | --- |
| `dsh-llm` | 相同 | 相同 | 相同 |
| `dsh-llm-pi-ai` | 相同 | 相同 | 相同 |
| `dsh-attachment` | 相同 | 相同 | 相同 |
| `dsh-host-webserver` | 相同 | 相同 | 相同 |
| `dsh-settings` | 相同 | 相同 | 相同 |
| `dsh-atomic-write` | 相同 | 相同 | 相同 |
| `dsh-home-paths` | 相同 | 相同 | 相同 |
| `dsh-client-ui-renderer` | 相同 | 相同 | 相同 |
| `dsh-client-ui-slots` | 相同 | 相同 | 相同 |
| `dsh-client-ui-settings` | 相同 | 相同 | 相同 |
| `dsh-client-ui-settings-plugins` | 相同 | 相同 | 相同 |
| `dsh-client-locale` | 相同 | 相同 | 相同 |
| `dsh-client-ui-primitives` | **变了** | **变了（2 个图标）** | 相同 |

**唯一的实质变化**是 primitives 新增 `IconUploadOutlineRegular` /
`IconUploadOutlineMedium`（`icons/artwork.d.ts` 里多一个 `'upload-outline'` 条目）。

对本插件**没有影响**：`src/client/**` 不 import 该包——`src/client/popover.ts` 的模块注释
写明了「本插件自实现锚定与外点关闭，而不 import primitives」的原因（让组件能在 Node 测试
套件里渲染，不必 mock 一个自身依赖 `*.module.css` 的包）。`tsdown.config.ts` 的
`CLIENT_EXTERNALS` 里虽然有它，但构建产物里并不出现该符号，所以打包结果不变。

### 2.3 包内 `package.json` 的其余变化是纯版本引用

13 个包的 `package.json` 里，除 `version` 之外，只有对内部兄弟包的 `0.2.2-rc.2` →
`0.2.2-rc.3` 引用；`dependencies` / `peerDependencies` 的**结构与范围**都没有变
（`cordis: ~4.1.0`、`schemastery: ~3.19.0`、`pi-ai: ^1.3.0` 原样）。已用脚本剥掉版本与
依赖字段逐包比对，无其他字段变化。

### 2.4 槽位目录：114 → 116，只增不减

从 `@deepseek-ai/dsh-cordis-client-runner@0.2.2-rc.3` 的 `slot-catalog.ts` 解析出的
`key/kind/scope` 全表比对：

| 变化 | 槽 | kind / scope |
| --- | --- | --- |
| 新增 | `sidebar.session.action` | `hoc` / `root` —— 侧栏「新建会话」行内层的包装层 |
| 新增 | `workspace.picker.directoryFlow` | `single` / `root` |
| 移除 | **无** | |
| kind 变化 | **无** | |

本插件注册的 7 个槽不仅 kind 未变，连 `ownerProps` 都逐字相同（剥离 `source` 行号与
`occupants` 后比对）：

| 槽 | rc.2 | rc.3 |
| --- | --- | --- |
| `settings.section` | `list` / `root` | 相同 |
| `settings.section.icon` | `list` / `root` | 相同 |
| `conversation.input.right` | `list` / `session` | 相同 |
| `conversation.composer.dock` | `list` / `session` | 相同 |
| `conversation.input.model.label` | `single` / `session` | 相同 |
| `sidebar.panellist` | `list` / `root` | 相同 |
| `main` | `keyed` / `root` | 相同 |

`sidebar.session.action` 是 rc.3 里第二个 `hoc` 槽（rc.2 起 `hoc` 这个 kind 才存在）。
本插件不在侧栏「新建会话」行里加任何东西，**不注册**。

### 2.5 另外核对过的宿主包（不在 13 个 devDependency 里）

| 包 | 变化 | 对本插件 |
| --- | --- | --- |
| `dsh-client-ui-settings-general` | `lib/client.js` 唯一实质差异是把「当前版本」文案里的 `0.2.2-rc.2` 换成 `0.2.2-rc.3` | 无 |
| `dsh-client-ui-model-selection` | 只有 `package.json` | 无（本插件用的模型标签槽契约未变，见 2.4） |
| `dsh-plugin-manager` | 只有 `package.json` | 无（本插件不调 `listBundles`） |
| `dsh-deepseek-account` | 只有 `package.json` | 无 |
| `dsh-cordis-client-runner` | `slot-catalog.ts` 变化 = 上述 2 个新槽 + 源码行号漂移 | 无 |

## 三、官方升级指南：仍然没有新条目

`docs/upgrade-guide/` 的目录列表里，最新两个版本段是 `v0.2.2-alpha.3`（5 条）与
`v0.2.2-rc.1`（19 条），**没有 `v0.2.2-rc.2`、也没有 `v0.2.2-rc.3`**。也就是说 DSH 自己没有
把 rc.2 / rc.3 之间的任何变更登记为破坏性变更。这与 2.2/2.4 的实测结论一致：运行时逐字节
相同、槽表只增不减。

## 四、本次实际改动面

只碰版本锚点与文档，**源码零改动**：

| 文件 | 改动 |
| --- | --- |
| `package.json` | 13 个 `@deepseek-ai/dsh-*` devDependency → `0.2.2-rc.3` |
| `pnpm-lock.yaml` | 重新生成（rc.2 条目 242 处 → rc.3 242 处） |
| `tests/dsh-peer-range.spec.ts` | `MUST_ADMIT` 补 `0.2.2-rc.3`，「current host」注释挪到新版本 |
| `pnpm-workspace.yaml` | override 注释里的宿主版本号 rc.2 → rc.3（值本身不变） |
| `README.md` / `README.en.md` | 兼容表与「同步结论」补 rc.3 |
| `docs/PENDING_CHANGELOG.md` | 新增：本条的 CHANGELOG 措辞暂存，发版时并入 |

`peerDependencies` **零改动**：`cordis` 仍是 `>=4.0.4 <5.0.0`，13 个 `dsh-*` 仍是
`>=0.1.7-rc.1 <0.3.0-0`，`schemastery` 仍是 `>=3.18.4 <4.0.0`，`pi-ai` 仍是
`>=0.85.1 <2.0.0`。`0.2.2-rc.3` 与这些区间全部相容，已由 `tests/dsh-peer-range.spec.ts`
钉住（`MUST_ADMIT` 里现在有 rc.1 / rc.2 / rc.3 三个实测过的宿主）。

## 五、三大价值的回归核对

| 价值 | 承载链路 | 本次是否触碰 | 证据 |
| --- | --- | --- | --- |
| 国内版与国际版双供应商并行 | 三个 panel → `trae` / `trae-enterprise` / `trae-global` 注册、按区域目录与镜像选择 | 否 | `tests/settings-integration.spec.ts` 全绿 |
| 用量与积分概览 | `/plugins/dsh-connect-trae/usage` 与账号/积分路由、卡片轮询 | 否 | 路由与卡片测试全绿；本机 rc.3 实测该路由 200、`signed-in`、33 模型 / 2 账号 |
| 每日签到领取 | `/plugins/dsh-connect-trae/checkin`（CN）与卡片签到行 | 否 | `tests/card-checkin.spec.tsx` 等全绿 |

## 六、验证结果

先在**临时副本**里把 13 个 devDependency 升到 rc.3 跑了一遍（不碰主工作树），再在主工作树
完成版本锚点改动：

| 项目 | 结果 |
| --- | --- |
| `tsc -p tsconfig.json` | 0 错误 |
| `tsc -p tsconfig.client.json` | 0 错误 |
| `vitest run` | **115 文件 / 1476 用例全过** |
| `tsdown` 构建 | 通过，且 `lib/{index.js,index.d.ts,client.js}` 与**已发布的 4.18.2 逐字节相同** |
| 真实宿主 | 0.2.2-rc.3 桌面端，`GET /plugins/dsh-connect-trae/usage` → 200 / `signed-in` |
| 槽位契约 | 本次注册的 7 个槽 kind 与 `ownerProps` 全部未变（见 2.4） |

「构建产物与上个发布逐字节相同」是这次最强的证据：rc.3 没有任何一个被消费的类型或运行时
文件变过，所以连 dts 输出都不变。

## 七、明确不采纳

- **`sidebar.session.action`（`hoc`）**：rc.3 新增，是本插件不涉及的侧栏「新建会话」行。
- **`workspace.picker.directoryFlow`（`single`）**：本插件不注册工作区选择器。
- **`IconUploadOutline*`**：本插件不 import `dsh-client-ui-primitives`（理由见 2.2）。
- **`settings.launcher` 的带参 `openSettings(sectionId)`**：仍是 rc.2 起就存在、本次再确认
  未变的可选优化项，留待后续版本，理由见 `docs/DSH_0.2.2_RC2_SYNC.md` 第七节。
