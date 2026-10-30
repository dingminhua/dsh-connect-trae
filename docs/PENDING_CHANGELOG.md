# 待写入 CHANGELOG 的条目（下一个版本）

> **这份文件是一块暂存区，不是文档。** 发版时把下面的内容整段追加到
> `CHANGELOG.md` 顶部（`# Changelog` 之后、最新已发布版本之前），然后删除本文件。
>
> **为什么不能直接写进 `CHANGELOG.md`：** 它是**随包文件**（在 `package.json` 的
> `files` 里）。已发布的 tag `v4.6.4` 之后若改动任何随包文件，
> `pnpm run verify:release` 会（正确地）报出「tag 之后改动了发布内容」——
> 因为那意味着线上包不再等于「tag 指向的源码」。而未发布版本的条目本来就
> 不属于已发布的那份 CHANGELOG。
>
> 放在 `docs/` 下是安全的：`docs/*.md` 不进发布包（只有
> `docs/assets/dsh-connect-trae-usage-card.png` 随包），所以改它不会污染发布内容。

---

## 未发布

### 修复

- **一条没带上下文窗口的目录行不再拖垮整个区域**（#70，贡献者
  [@beibing173](https://github.com/beibing173)）。
  - **现象**：模型选择器里 `trae` 整个区域加载失败，报
    `adapter returned invalid context metadata for provider "trae" model "doubao_1.8"`。
    失败粒度是 **provider 级**，不是单模型级。
  - **根因**：`FALLBACK_CONTEXT_WINDOW` 只被赋给 profile 的
    `defaultContextWindow`，而那个字段由**内核自己的目录解析步骤**读取——本插件
    从不走那条路径。它用 `createProvider({ models })` 手工装配 pi-ai provider，
    `Models.getModel()` 直接返回 `toPiModel` 产出的原始行，**不做任何补默认值**；
    而 `toPiModel` 在 `contextWindow === undefined` 时**省略**该字段。于是
    `PiAiAdapter.modelInfo()` 解析出 `context: { contextWindow: undefined }`，
    DSH 拒绝，且拒绝的是整条路由。常量写了，没有生效点。
  - **修法**：把回退**落到行本身**。新增 `servedContextWindow()`，`toPiModel`
    现在**总是**输出 `contextWindow`：行自己的正整数窗口原样保留，其余一切
    （缺失、`NaN`、`0`、负数、小数）回退到 `FALLBACK_CONTEXT_WINDOW`——因为
    DSH 只接受正整数。profile 上的 `defaultContextWindow` 保留（内核路径仍会读），
    但注释改成与事实一致：真正的保证在 `toPiModel`，那只是保险带。
  - **为什么小数也要回退**：目录解析器的 `finitePositive` 只校验 `isFinite` 与
    `> 0`，所以上游若发布 `context_window_tokens.dev = 200000.5`，它会原样进到
    适配器；DSH 对非整数的拒绝与缺失完全相同。这条此前没有任何用例锁住。
  - **测试**：`tests/context-window-fallback.spec.ts` 走宿主的真实路径
    （`adapter.current()` → `profiles` → `models.getModel()`，以及
    `adapter.resolveModel()`），覆盖未定尺寸行、混合目录逐行可解析、行自带窗口
    不被覆盖，以及小数/零/负数/NaN 四种畸形窗口一律回退。
    **变异验证**：把 `toPiModel` 的改动回退，8 例中 7 例转红。
  - **不变的部分**：不改变任何已有窗口的行；不改变名称、reasoning、图像能力、
    计费倍率等元数据；兜底目录本身仍然每行手写真实窗口（`tests/catalog.spec.ts`
    继续锁这个不变量）。本修复只是让「万一漏了一条」退化成一条保守尺寸的模型，
    而不是死掉一个区域。
