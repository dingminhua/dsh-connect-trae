# 仓库守则（AGENTS.md）

> 给**在本仓库里干活的人（和 AI 助手）**看的一页。
> 只管两件事：**别把私货带进仓库**、**改完必须验证**。
> 隐私部分的完整说明见 [`SECURITY.md`](SECURITY.md)，发布流程见 [`RELEASING.md`](RELEASING.md)。

## 一、隐私：这是硬约束，不是建议

**动手前先读 [`SECURITY.md`](SECURITY.md)。** 一句话版本：

> 凡是会离开本机的字节，都按公开材料对待。发出去就收不回来。

本仓库有三条出口，任何一条都不受「这是内部文档」保护：GitHub 仓库（含
`raw.githubusercontent.com`）、npm 包（`files` 白名单）、第三方市场（dshfind 等
直接引用 GitHub 上的图片 URL，**改图即自动生效**）。

所以「只是测试夹具」「只是本地脚本」不是理由 —— 夹具会被渲染进截图，截图会进
README 与 npm 包。

### 写代码、写文档、拍截图时，一律用假值

| 类别 | 处置 |
| --- | --- |
| 账号名 / 昵称 | 用 `tools/demo-accounts.ts` 的 `DEMO_NICKNAME`，或 `demo-*` |
| 账号 id / 用户 id | 用 `DEMO_NUMERIC_ID`，保持长度形状但不保留真实值 |
| 真实余额 / 用量 | `DEMO_CREDITS` 里编造的值 |
| 凭据（token / cookie / `Authorization`） | **任何情况都不出现，连片段都不行** |
| 设备标识 | 只报**形状**（位数、是否纯数字），见 `src/redact.ts` |
| 本机路径 | `C:\Users\<real>`、`/Users/<real>` → `<user>` |
| 个人邮箱 | 不出现（`@dmh2002/` 这种**已公开的 npm scope** 除外） |

### 截图：必须先造数据再拍

- **马赛克 / 模糊 / 半透明色块都不算脱敏。** 它们保留字符宽度与亮暗分布，块数少于
  字符数时长度和数字构成仍可分辨。v4.10.0 的产品图就栽在这里：约 15 个 18px 方块
  覆盖一个约 270px 宽的名字，而同一张图里另外两个账号名是**完全明文**的。
- 正确做法只有两个：**用演示数据重出图**，或**整块不透明色块**覆盖。
- 出图脚本统一走 `tools/demo-accounts.ts`，不要各写一份常量。

### 例外：这两样必须保留

维护者的**版权署名**（见 `LICENSE` 版权行）与 `@dmh2002/` 这个**公开 npm scope**，
必须留在 `LICENSE`、`package.json` 的 `copyright`、双语 README 和
`RELEASING.md` 的核对命令里。**规则挡的是它们之外的账号数据**，
把版权署名一起「脱敏」掉是错误的。

> 署名原文不在本文件复述：`tests/privacy.spec.ts` 会把它当作泄露命中。
> 需要核对该值时看 `LICENSE` 或 `RELEASING.md` 的 `grep` 行。

### 提交前跑这两条

```sh
pnpm test                    # 含 tests/privacy.spec.ts：扫全仓库文本文件
pnpm run verify:privacy      # 只扫发布物：PNG 字节流 + OCR 渲染文本 + 随包文件
```

两道检查**分开跑**，覆盖范围不同，发布前两个都要绿。
`verify:privacy` 的 OCR 那一行必须是 `OK`，出现 `SKIP` 说明后端没起来，
在 `DSH_STRICT_PRIVACY=1` 或 `npm publish` 流程里会被判为失败。

> **CI 也会跑它**（`.github/workflows/ci.yml` 的 `Privacy gate` 步骤，双平台）。
> 所以「本地忘了跑」不等于它能溜过去；但反过来，**CI 绿也不等于图片没问题**——
> OCR 读的是渲染出来的像素，低对比度、异常字距、被裁切的部分它读不到。

**它们挡不住什么，心里要有数**：图片内容只能靠 OCR（会漏全角、插空格、低对比度），
文本扫描按值哈希（挡不住 Base64 编码后再写进去的身份信息）。
**新增或替换 `docs/assets/` 下的图，必须自己打开看一眼实际像素。**

## 二、验证：改完要证明它是对的

- `pnpm run check`（typecheck + test + build）必须绿。**本地绿不等于 CI 绿**：
  CI 跑 ubuntu 与 windows 两条线，Windows 上的路径分隔符和文件系统行为都栽过。
- 修 bug 时**先写一条会失败的测试**，确认它失败，再修到它通过。只加「修完之后能过」
  的断言，证明不了原来的 bug 存在过。
- 涉及 `lib/` 的改动跑一次 `pnpm run build`——这个插件是 `link:` 挂载源码树的，
  不重新构建，界面上跑的还是旧产物。

## 三、文档：写「为什么」，不只写「什么」

- **CHANGELOG** 记结论与依据（当时的实测数字、失败过的做法），不是 diff 的复述。
- 注释里解释**取舍**：试过什么、为什么没选它、哪条路是错的。
- **守卫文件自己不能带明文。** `tests/privacy.spec.ts` 与 `scripts/verify-privacy.mjs`
  只存 SHA-256，注释里也不要举真实值当例子——那等于把黑名单的原文摆在旁边。

## 四、发布

完整流程见 [`RELEASING.md`](RELEASING.md)，两条不能忘：

1. **`npm login` 与 `npm publish` 交给维护者跑**，AI 不代跑（2FA 授权窗口很短，
   转述链路赶不上）。AI 负责跑检查、改版本号、写 CHANGELOG、commit、打 tag、push。
2. **发包前必须有一次独立审查**，确认本次 diff 里没有私货，且 `npm pack --dry-run`
   的清单里没有 `tests/`、`scripts/`。
