# 待发布变更

> 上一个版本（4.0.1）发布之后积压的条目。发版时把这里的内容并入 `CHANGELOG.md` 的
> `## X.Y.Z` 一节，然后删除本文件（见 `RELEASING.md` §3）。

## Features

- **模型行显示活动优惠徽标**（`feat(model)`）。Trae 在模型目录里发布促销**规则**
  （`features.activity_discount` / `display_contact_config.activity_discount`：折扣比例、原价、
  闲时时段与命名时区），但从不发布文案。插件按**渲染时刻的时钟**判定后，在模型名旁边画一枚胶囊：
  `5 折` / `闲时 5 折` / `限时 5 折`，悬停给出原价→现价与时段。
  - 解析层只留规则、不挑徽标；判定在渲染时做，所以夜间折扣不会在次日早晨继续挂着。
  - 先信上游的 `current`（服务端算的「此刻状态」），只有它报「没打折」时才用本地窗口补算。
  - 不从 `creditMultiplier` 反推促销；只有 `limited_discount` 敢写「限时」——其余活动上游没给结束时间。
  - 纯提示：不新增请求、不改计费语义；国际区（订阅制）没有这份数据，显示路径同一条、上游补齐即生效。
  - 详见 `docs/PROMO_BADGE.md`；复算脚本 `scripts/probe-promo.mjs`（只读，不消耗积分）。

## Fixes

- **跨 group 去重不再丢促销规则**（`fix(solo-remote)`）。同一次目录响应里，同一个模型在部分 group
  带 `activity_discount`、在部分 group 完全没有，而 group 顺序每次调用都可能不同（issue #23 的同一现象）。
  `preferStrongerRow` 原先只按容量选行，会把带规则的那一行丢掉，导致徽标一半时间消失；现在选行仍按容量，
  但会把另一行携带的规则**并到赢家身上**（`richerRule`：先比「当前是否真在打折」，再比窗口数量）。
  没有改成「选带规则的行」，因为那会丢掉 1M Max 档——徽标不能以用户失去上下文预算为代价。

## Docs

- 新增 `docs/PROMO_BADGE.md`（上游字段抓包、判定规则、与 WorkBuddy #91 的能力对照、实机复核输出）。
- README / README.en 功能列表各加一条「活动优惠徽标」。
