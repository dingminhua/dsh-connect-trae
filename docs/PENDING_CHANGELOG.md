# 待并入 CHANGELOG 的条目

> 上一个版本（4.18.8）发布之后积压的变更。发版时把下面的 `##` 一节整段并入
> `CHANGELOG.md` 顶部并把标题日期定稿，然后**删除本文件**。规则见 `RELEASING.md` 第 3 步。

## Features

### 多账号共用一个设备号时，可选「每个账号一个签到设备号」

Trae 把每日签到名额记在 `x-device-id` 上，而它是**安装级**的：一台机器上放了多个账号，
每天只有批里最前面的那个能领到，其余拿到业务码 `9095`。原来的行为到此为止——`9095`
被当作「本机今日已用完」，整批中止、当天封盘。这在「一台机器只有一个签到位」这个前提下
是正确的（文件头注释与 `checkinAllAccounts` 的 JSDoc 都写明了这条理由），但那个前提对
多账号用户不成立，而插件没有给用户改变它的入口（见 #64 / #92 的结论）。

新增账号池开关 `pool.perAccountCheckinDevice`，**默认关闭**。

- 打开并保存后，**只有签到这两条路由**（`checkin_credits/status`、`checkin_credits/claim`）
  改用一个按「本机号 + 账号 id」派生的稳定设备号：
  `sha256('trae-checkin\0' + 本机号 + '\0' + 账号 id)` 的前 32 位（`checkinDeviceIdOf`，
  与 `readTraeCliIdentity` 已有的派生形状一致）。聊天 / 用量 / 刷新路径一个字节都没变。
- 打开后 `9095` 的含义变成「**这个账号**今天的额度用掉了」：批量签到不再中止
  （`checkinAllAccounts` 的 `break` 加了 `deps.perAccountDevice !== true` 条件），
  该账号被记进当天的 `done`，其余账号照常签；自动签到的 `deviceBlocked` 不再因为它
  把整天封盘（`foldCheckin` 的第四参数）。
- 面板读数走同一条派生，卡片上「本机已签」与批量签到不会再各说各话。
- 关闭时：每个请求发的 `x-device-id` 与改动前**完全一致**，单账号用户零变化。

开关的 `TraeWebPool` 字段与 `probeInputTokens` 用同一套时钟错位处理：Host 的 schema 没
声明它时卡片隐藏整行，而不是渲染一个「保存即被 schema 丢掉、读回校验又失败」的开关。

## 测试

- `tests/account-pool.spec.ts`：新增「每账号独立设备号时，9095 不中止后续账号」——
  两个账号、第一次 claim 回 `9095`、第二次回 `code:0`，断言 `claims === 2` 且行状态是
  `['device-already', 'claimed']`。改动前该用例红（`claims` 为 1）。
- `tests/auto-checkin.spec.ts`：新增「per-account 模式下 9095 算这个账号做完，不是整机」——
  断言 `done` 含两个账号、`deviceBlocked` 保持 false。改动前红（只收 `claimed`）。
- `tests/identity.spec.ts`：新增 2 例覆盖 `checkinDeviceIdOf` 的稳定性、账号间互不相同、
  不等于机器号本身。改动前红（函数不存在）。
- `tests/card-pool.spec.tsx`：新增 3 例——Host 未声明该字段时整行隐藏；切换是草稿（不写设置）；
  保存后写入 `regions.cn.pool.perAccountCheckinDevice === true`；未保存时「放弃修改」回到
  已保存值。

**全量**：`pnpm test` 118 个文件 / 1531 例通过，两个 `tsc` 零错误，`pnpm run build` 通过，
`verify:privacy` 通过。

## Docs

- `README.md` / `README.en.md`：「每日自动签到」下新增「多账号共用一个设备号（可选）」一节，
  写清开关做了什么、默认关闭意味着什么，以及两条限制（同一账号每天仍只发一份——
  发放侧按「账号 × 自然日」去重，重复 claim 是幂等成功；`9074` 是频次限制，不是设备限制）。

## 背景数据（实测，2026-11-25，CN 面板）

同一台机器、3 个账号、真实设备号（16 位纯数字，`iCubeAuthInfo://icube-dc:` 那支）：

| 账号 | `checked_in` | `did_checked_in` |
| --- | --- | --- |
| 1 | `true` | `true` |
| 2 | `false` | `true` |
| 3 | `false` | `true` |

对账号 2 / 3 用同一真实设备号 `claim` → `{"code":9095,"message":"当前设备今日已经签到，请明日再来哦～"}`。
只把 `x-device-id` 换掉（UUID / 64 位 hex / 16 位数字都试过）→ 各自 `{"code":0,"message":"success"}`，
`status` 立刻翻成 `checked_in:true, did_checked_in:true`，`web_user_ent_usage` 各多一个
`checkin_<日期>_<账号 id>` 包（`credits_limit:100`、`duration:31` 天）。

同一账号同一天用两个不同设备号各 claim 一次：两次都是 `code:0`，但当天只产生**一个**签到包
⇒ 去重键是「账号 × 北京自然日」，不是设备号。这条边界是本开关的界：它让每个账号各拿自己
那一份，不能让人多领。
