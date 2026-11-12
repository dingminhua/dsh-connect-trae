## v4.18.2（2026-11-13）

> **只跟宿主的版本号，不动一行代码。** 4.18.1 在 DSH 0.2.2-rc.2 上运行正常；这一版把开发树与版本锚点对齐到 rc.2。

这次升级和上次（rc.1）完全不同。rc.1 那次必须补两个必填字段才编得过；rc.2 这一次**对插件没有任何接口破坏**，所以 `src/` 下一个字节都没改。

### 为什么可以确认「真的没坏」

不是「跑起来看着没事」，而是三条可复核的事实：

1. 随包的 `cordis@4.1.0` / `schemastery@3.19.0` / `@earendil-works/pi-ai@1.3.0` 三个都停在原版本，没有换代；
2. `docs/upgrade-guide/` 里**没有 `v0.2.2-rc.2` 一节**——rc.2 之后没有登记在案的破坏性变更。rc.1→rc.2 之间发生的变更全部在 `v0.2.2-rc.1` 那 19 条里，逐条对过，本插件涉及的服务与 API 一个都没碰；
3. **`pnpm run build` 的产物与 rc.1 开发树逐字节相同**。这比「类型能过」更强：`tsdown` 的 dts 输出对类型变化是敏感的，产物不变就意味着那 6 个包的 `.d.ts` 变化没有一个落进本插件的消费面。

### 三处语义级变化，逐条确认不击中

| 变化 | 为什么不影响本插件 |
| --- | --- |
| `HarnessError` 从 `dsh-llm` 搬进新包 `@deepseek-ai/dsh-error`，`AttachmentError` 改成真的继承它 | 本插件只用 `AttachmentStore` 的**类型**，从不构造、也不捕获这两类错误。`LlmError` 构造器同时收窄为只接受内置码（其余走新增的 `fromFailure()`），本插件从不构造 `LlmError` |
| `dsh-llm-pi-ai` 新增签名 thinking 的前缀绑定（`prefix-binding`） | 它只在 `api === 'anthropic-messages'` 时生效，而本插件每一行都钉在 Trae 的 `openai-completions` 上，进函数就原样返回。新增的 `prefixDigest` / `onThinkingOmitted` 都是可选的尾部参数，不传即旧行为 |
| `SlotKind` 多了 `'hoc'`，`dsh-client-ui-slots` 相应新增 `HocRenderOpts` 等 | 只有 `conversation.chat.markdown.fence` 与 `conversation.hero.frame` 两处声明为 `hoc`，本插件都不注册也不消费。活宿主检视确认本插件注册的 7 个槽 kind 一个没变 |

`window-drag-regions` 那条看上去会击中「浮层」，实则不：它只影响覆盖 `data-window-drag` 页头行的自定义浮层，而本插件两个 `position: fixed` 元素（积分弹出面板、忙碌遮罩）都不覆盖页头行，`src/client/**` 里也没有任何 `app-region` / `no-drag` 依赖。

### 未采纳（记下理由，免得下次重新讨论）

- **`settings.launcher` 的带参 `openSettings(sectionId)`**：rc.2 给了官方入口，本插件目前仍走「读 `sidebar.settings` 的 store seat 调 `openSection(id)`」。换过去可以去掉对别的 bundle 私有 store 形状的依赖（`src/client/settings-route.ts` 里「No other id-targeted seam exists」这句依据在 rc.2 已不成立），但要为 0.1.7–0.2.2-rc.1 那批宿主保留能力探测，属于下一版的可选优化。
- 其余新增能力（`Modal.tone`、`Menu` 子菜单交互、`FenceCodeBlock` / `FenceMathBlock`、Gemini 模型发现、`onThinkingOmitted` 观测点）本插件都用不到。

### 版本锚点

13 个 `@deepseek-ai/dsh-*` devDependency → `0.2.2-rc.2`，`pnpm-lock.yaml` 重新生成（rc.1 条目 200 处 → rc.2 242 处）。`peerDependencies` **零改动**：`0.2.2-rc.2` 已被 `>=0.1.7-rc.1 <0.3.0-0` 放行。

### 测试

- `tests/dsh-peer-range.spec.ts` 的 `MUST_ADMIT` 补入 `0.2.2-rc.2`，并把「current host」注释挪过去——这份清单此前漏过「当前正在使用的版本」，那样范围被误收窄也不会变红。**变异验证**：把上界临时改成 `<0.2.2-rc.2`，该文件立刻 9 例变红，报错原文正是「must admit DSH 0.2.2-rc.2, but the host would SKIP the whole bundle」。
- 全仓 **115 个文件 / 1476 条测试**通过，两个 tsconfig 分别 typecheck 通过，构建通过，`verify:privacy` 17 项无跳过。
- 真实宿主实测：桌面端 0.2.2-rc.2 上 `GET /plugins/dsh-connect-trae/usage` 返回 200 且 `signed-in`。

### 文档

- 新增 `docs/DSH_0.2.2_RC2_SYNC.md`：结论、逐包 `.d.ts` 变化、19 条官方指南的逐条排除理由、验证结果、未采纳项。
- 中英 README 的兼容表与「同步结论」补 rc.2 一节。

---

**完整变更**：[v4.18.1...v4.18.2](https://github.com/dingminhua/dsh-connect-trae/compare/v4.18.1...v4.18.2)
