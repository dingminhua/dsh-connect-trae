# 待写入 CHANGELOG 的条目（下一个版本）

> **这份文件是一块暂存区，不是文档。** 发版时把下面的内容整段追加到
> `CHANGELOG.md` 顶部（`# Changelog` 之后、最新已发布版本之前），然后删除本文件。
>
> **为什么不能直接写进 `CHANGELOG.md`：** 它是**随包文件**（在 `package.json` 的
> `files` 里）。已发布的 tag `v4.4.5` 之后若改动任何随包文件，
> `pnpm run verify:release` 会（正确地）报出「tag 之后改动了发布内容」——
> 因为那意味着线上包不再等于「tag 指向的源码」。而未发布版本的条目本来就
> 不属于已发布的那份 CHANGELOG。
>
> 放在 `docs/` 下是安全的：`docs/*.md` 不进发布包（只有
> `docs/assets/dsh-connect-trae-usage-card.png` 随包），所以改它不会污染发布内容。
>
> 这个文件本身就是这条规则的一次应用：**未发布的说明写在不进包的地方。**

---

## 未发布

### 变更

- **对齐宿主 DSH 0.2.1-rc.3**：13 个 `@deepseek-ai/dsh-*` devDependency 从 `0.2.1-rc.2`
  推进到 `0.2.1-rc.3`。`cordis`（`4.0.5`）/ `schemastery`（`3.18.5`）/ `pi-ai`（仍 `1.1.0`）
  均未变——宿主 `app.asar` 实测随包的 pi-ai 仍是 1.1.0，3.4.2 起的双向适配结论原样成立。
- **peer 范围无需改动**：`0.2.1-rc.3` 对 `>=0.1.7-rc.1 <0.3.0-0` 已判通过（实测）。
- **插件代码零改动**：rc.3 对本插件消费的 13 个宿主包里，只有 `dsh-client-ui-primitives`
  存在代码变化，且全部是**新增**（`TooltipSide` 增加 `'left'` 并改用实测边框盒换边放置、
  `MenuItemButton` 增加 `current`、`Menu` 增加 `minWidthFromAnchor`、新增 `IconAppsAddOutline*`）。
  本插件对 `dsh-client-ui-primitives` 只有**类型层引用**（`import type {} from ...`），
  运行时不消费这些组件，故无需适配。

### 测试

- `tests/dsh-peer-range.spec.ts` 的 `MUST_ADMIT` 补入 `0.2.1-rc.3`——此前这份「必须放行的版本」
  清单里没有当前正在使用的版本，范围若被误收窄到当前宿主之外，测试仍会全绿。
- 全仓 **1080** 例通过（84 个测试文件）。

### 已核对确认无变化

- 逐字节比对 npm 上 `0.2.1-rc.2` 与 `0.2.1-rc.3` 两版的全量文件树：
  `dsh-llm`、`dsh-llm-pi-ai`、`dsh-settings`、`dsh-host-webserver`、`dsh-atomic-write`、
  `dsh-home-paths`、`dsh-attachment`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`、
  `dsh-client-ui-settings-plugins`、`dsh-client-ui-slots`、`dsh-client-locale`
  ——**除 package.json 的版本号与内部依赖号外逐字节相同**。
- 宿主 rc.3 的上游改动共 5 个提交：三个是「导航项自定义」（面板固定/取消固定、More 菜单、埋点），
  一个是 DeepSeek API-key 通道改走官方 `/models` 目录，一个是版本号——**均与本插件不相干**。
- 本插件注册的 5 个槽位（`plugins.bundle.config`、`plugins.row.config`、`conversation.input.left`、
  `conversation.composer.dock`、`conversation.input.model.label`）在 rc.3 中**仍然存在且契约未变**；
  宿主新增的 `conversation.session.header.views.actions` 等槽位与本插件无交集。

### 文档

- 新增 `docs/DSH_0.2.1_RC1_SYNC.md` 第十节：`0.2.1-rc.3` 复核记录（取证、依赖面、契约面、
  槽位核对、peer 门禁）。
- `README.md` / `README.en.md` 的宿主版本结论推进到 `0.2.1-rc.3`，并新增
  「`0.2.1-rc.3` 同步结论」小节。
