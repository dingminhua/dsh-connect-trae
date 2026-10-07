## v2.13.6（2026-10-07）

> **输入框积分读数：字号 12px、颜色改为浅一级的 `label-tertiary`。**

### 变更

2.13.5 把触发器改成了纯文本外观，但用了 `font: inherit` / `color: inherit`——**继承了输入框正文自己的字号与正文色**，于是读数比旁边的权限/专家/模型控件更醒目（「字太大了，颜色也深」）。

积分是**次要信息**，不该抢眼。改成显式值：

| | 之前 | 现在 |
| --- | --- | --- |
| 字号 | `inherit`（输入框正文，约 14–15px） | **`12px`**（本插件 2.11.x 原设计值） |
| 颜色 | `inherit`（正文色，深） | **`--dsw-alias-label-tertiary`**（浅一级） |

参照 shell 自己的同排控件 `ContextMeter`——它用的正是 `label-tertiary`，本行读数与它并排，口径一致。顺带删掉多余的 `font: inherit`（一旦 `font-size`/`line-height` 显式，它既多余又会与后继声明争夺层叠）。

### 测试

- 全仓 472 保持通过；守卫测试补上 `font-size:12px` 与 `label-tertiary` 两条断言，使这次反馈不会被后续改动悄悄退回。
- **变异验证**：改回 `14px` + `inherit` → 1 例失败。

**完整比较**：[v2.13.5...v2.13.6](https://github.com/dingminhua/dsh-connect-trae/compare/v2.13.5...v2.13.6)
