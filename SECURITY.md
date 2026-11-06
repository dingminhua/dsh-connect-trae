# 隐私与凭据安全（Privacy & Credential Safety）

> **本文档是关于「什么东西不能进入本仓库与发布物」的权威说明。**
> 发布流程见 [`RELEASING.md`](RELEASING.md) 第 1.5 节；那里的门禁与本文档是同一份规则的
> 两个落点，改一处要同步另一处。

## 一条原则

**凡是会离开本机的字节，都按公开材料对待。**

本仓库的产物有三条出口，任何一条都不受「这是内部文档」的保护：

| 出口 | 包含什么 |
| --- | --- |
| GitHub 仓库（含 `raw.githubusercontent.com`） | 全部源码、`docs/`、`tools/`、测试夹具、图片 |
| npm 包（`package.json` 的 `files` 白名单） | `lib/`、`icons/`、三张产品图、双语 README、CHANGELOG、`scripts/verify-windows.mjs` |
| 第三方市场（dshfind 等） | 直接引用 GitHub 上的图片 URL，**改图即自动生效** |

所以「只是测试夹具」「只是本地脚本」不是理由：夹具数据会被渲染进截图，而截图会进 README
与 npm 包。

## 必须脱敏的东西

| 类别 | 例子 | 处置 |
| --- | --- | --- |
| 账号名 / 昵称 | Trae 的 `一个昵称`、`用户<n>` | 用 `tools/demo-accounts.ts` 的 `DEMO_*`，或 `demo-*` |
| 账号 id / 用户 id | 9 位数字 id、`userId`、`tenantId` | 同上，保持长度形状但不保留真实值 |
| 凭据 | 访问令牌、刷新令牌、`Authorization` 头、cookie | **任何情况都不出现**，连片段都不行 |
| 设备标识 | `x-device-id`、`telemetry.machineId`、`telemetry.devDeviceId` | 只报**形状**（位数、是否纯数字），见 `src/redact.ts` |
| 本机身份 | `C:\Users\<real name>`、`/Users/<real name>`、本机用户名 | `maskUserPath()` 换成 `<user>` |
| 真实余额 / 用量 | 具体积分数、积分包数与总额 | 编造的值 |
| 真实邮箱 | 个人邮箱 | 不出现（`@dmh2002/` 这种**已公开的 npm scope** 除外） |
| 时间 | 令牌到期时刻、刷新时刻、签到时刻 | 相对时间或编造值 |

`一个昵称` 有一处**例外且必须保留**：LICENSE 的版权行与 `package.json` 的 `copyright`
字段。它是许可证要求，不是泄露。注意区分二者——把版权署名一起「脱敏」掉是错误的。

## 为什么「打码」不算脱敏

v4.10.0 的产品图里，账号名被加了马赛克。它的问题是双重的：

1. **信息还在。** 马赛克是对原始像素做块平均，块数远少于字符数时，长度、数字/字母构成
   与部分笔画仍可分辨（那张图里约 15 个 18px 方块覆盖一个约 270px 宽的名字）。
2. **它让人跳过复核。** 「已经处理过了」比「没处理」更容易逃过审阅——同一张图里另外
   两个账号名是**完全明文**的，就因为注意力被那处马赛克带走了。

正确做法只有两个：**用演示数据重出图**，或**整块不透明色块**覆盖（不是模糊）。

## 已有的自动化

| 位置 | 作用 | 怎么跑 |
| --- | --- | --- |
| `tests/privacy.spec.ts` | 单测：扫描**整个仓库**的文本文件（夹具 `accountName` 字面量必须是 `DEMO_*` 或合成形状、不含真实账号标识、不含个人 home 路径），并确认版权署名仍在 | `pnpm test`（**不在** `verify:privacy` 里） |
| `scripts/verify-privacy.mjs` | 发布前：PNG 字节流与渲染文本、随包文本、版权署名仍在、版本与 CHANGELOG 一致 | `pnpm run verify:privacy` |
| `prepublishOnly` | 把上一行挂进 `npm publish`，失败即中止发布；OCR 缺席时直接拒绝而不是放行 | 自动，无需手动跑 |
| `src/redact.ts` | 运行期脱敏助手（`maskUserPath` / `describeNameShape` / `describeIdShape`），供 `scripts/verify-windows.mjs` 的公开回报使用 | 由该脚本调用 |

> 两道检查**分开跑**：`verify:privacy` 只看发布物，`pnpm test` 覆盖源码与文档。发布前两个都要绿。

`scripts/verify-windows.mjs` 的输出是**已脱敏**的：路径里的用户段换成 `<user>`，账号名与
设备号只报形状。用户可以把它的输出直接贴进 issue。新增任何「让用户回报本机状态」的脚本，
都必须走同一套 `src/redact.ts`，不要自己再写一份。

## 用户数据在本机如何存放

插件**不**把凭据写进 DSH 设置。刷新得到的 token 按区域落在
`$DSH_HOME/.trae-auth.cn.json` / `.trae-auth.ai.json`，以 `mode 0o600`（Windows 忽略
POSIX 权限位，属已知无害差异）写入；导出的账号 JSON 里是**有效 Token**，README 中已明确
提示「请当作密码保管」。这些文件都不在本仓库内，也不会被打包。

## 新增截图或示例时的检查清单

- [ ] 用的是 `tools/demo-accounts.ts` 的常量，不是真实账号
- [ ] 余额、时间、设备号是编造的
- [ ] 演示名长度与真实数据同量级（否则版式测量失真）
- [ ] 没有用马赛克当脱敏
- [ ] `pnpm run verify:privacy` 全绿，且 OCR 那一行是 `OK` 而不是 `SKIP`
