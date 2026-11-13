# 待发版变更（暂存）

`CHANGELOG.md` 是随包文件：在已发布的 tag 之后改它，`scripts/verify-release.mjs` 会正确地
报「tag 之后改动了发布内容」。上一个版本发布之后积压的入口条目因此暂存在这里
（`docs/*.md` 不进发布包），发版时并入 `CHANGELOG.md` 的 `## X.Y.Z` 一节，然后删除本文件。
约定见 `RELEASING.md` 第 3 步。

---

## 未定版本

### 适配

- **DSH 0.2.2-rc.3 同步（零代码改动）**。宿主从 `0.2.2-rc.2` 推进到 `0.2.2-rc.3`，
  这一版比上次还要轻：插件消费的 **13 个宿主包的运行时 `lib/**/*.js` 逐字节完全相同**，
  全部 README 未变，随包的 `cordis@4.1.0` / `schemastery@3.19.0` / `ai-pi@1.3.0` 三个依赖
  也都没动。官方升级指南同样**没有为 rc.3 新增条目**（最新一节仍是 `v0.2.2-rc.1`）。
  - **唯一的类型面变化不击中**：只有 `dsh-client-ui-primitives` 多了
    `IconUploadOutlineRegular` / `IconUploadOutlineMedium` 两个图标。本插件不 import 该包
    （`src/client/popover.ts` 写明了自实现锚定与外点关闭的理由），只把它列在 `tsdown` 的
    externals 里，所以连打包产物都不受影响。
  - **槽位目录 114 → 116，只增不减**：新增 `sidebar.session.action`（`hoc`）与
    `workspace.picker.directoryFlow`（`single`），本插件都不注册。**零移除、零 kind 变化**；
    本插件注册的 7 个槽连 `ownerProps` 都逐字相同。
  - **构建产物与已发布的 4.18.2 逐字节相同**——这是本次最强的证据：没有任何一个被消费的
    类型或运行时文件变过，所以连 dts 输出都不变。1476 条测试全绿，typecheck 零报错。
  - **顺带核对过的仓包**：`dsh-client-ui-settings-general` 的唯一实质差异是把「当前版本」
    文案里的版本号换成 rc.3；`model-selection` / `plugin-manager` / `deepseek-account`
    只有 `package.json`；`cordis-client-runner` 的 `slot-catalog.ts` 变化 = 上述 2 个新槽
    + 源码行号漂移。
- **开发树同步**：13 个 `@deepseek-ai/dsh-*` devDependency → `0.2.2-rc.3`，
  `pnpm-lock.yaml` 重新生成（rc.2 条目 242 处 → rc.3 242 处）。`cordis` / `schemastery` /
  `pi-ai` 与 peerDependencies **零改动**：`0.2.2-rc.3` 已被 `>=0.1.7-rc.1 <0.3.0-0` 放行。
- `tests/dsh-peer-range.spec.ts` 的 `MUST_ADMIT` 补入 `0.2.2-rc.3`。现在这份「必须放行的
  版本」清单里同时有 rc.1 / rc.2 / rc.3 三个**实测过**的宿主，任何一次范围误收窄都会变红。

### 未采纳

- `sidebar.session.action`（`hoc`）：rc.3 新增的侧栏「新建会话」行包装层，本插件不涉及。
- `workspace.picker.directoryFlow`（`single`）：本插件不注册工作区选择器。
- `IconUploadOutline*`：本插件不 import `dsh-client-ui-primitives`。
- `settings.launcher` 的带参 `openSettings(sectionId)`：仍是 rc.2 起就存在的可选优化项，
  理由见 `docs/DSH_0.2.2_RC2_SYNC.md` 第七节。

### 文档

- 新增 `docs/DSH_0.2.2_RC3_SYNC.md`：结论、逐包运行时/类型面比对表、槽位目录增量、
  官方指南缺席的说明、验证结果。
- 中英 README 的兼容表与「同步结论」补 rc.3 一节。

### 验证

- `tsc -p tsconfig.json` / `tsc -p tsconfig.client.json`：0 错误。
- `vitest run`：**115 文件 / 1476 用例全过**。
- `tsdown` 构建：产物 `lib/{index.js,index.d.ts,client.js}` 与已发布的 4.18.2 逐字节相同。
- 真实宿主 0.2.2-rc.3：`GET /plugins/dsh-connect-trae/usage` → 200 / `signed-in` /
  33 个模型 / 2 个账号。
