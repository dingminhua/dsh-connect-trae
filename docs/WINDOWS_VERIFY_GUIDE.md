# Windows 真机验证指引

> 给需要在 Windows 上确认「dsh-connect-trae 到底能不能读到 Trae 登录」的人。
> 对应 README 的「Windows 说明」与 `docs/WINDOWS_TOKEN_PROBE.md`。

## 状态：已有一台真机通过（2026-09-26）

本项**不再完全没有真机证据**。一台 Windows 10.0.22621（装 TRAE SOLO CN）上跑
`node scripts/verify-windows.mjs` 结果是**全部通过**（退出码 0）：

| 检查项 | 实测结果 |
| --- | --- |
| 目录候选 | 命中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json` |
| 账号解析 | 解出 1 个账号（`solo` / `cn`） |
| `x-device-type` | `windows` |
| `x-os-version` | `Windows 10.0.22621` |
| `x-device-id` | 16 位纯数字（来自数据目录，非兜底哈希） |
| `x-app-version` | `0.1.56`（取自安装目录的 `product.json`） |

**结论**：`product.json` 的 `win32DirName` 作为目录名依据是对的；安装路径推导与
设备指纹各字段在真机上也成立。也就是「Windows 上插件读得到 Trae 登录」已有真机
证据，不再是推断。

### 脚本检查范围之外的实测（同一台真机）

上表六项**只覆盖路径探测与设备指纹**，所以另外单独跑了主流程（直接调用 `lib/`
导出，即产品代码本身）：

| 运行路径 | 实测结果 |
| --- | --- |
| `TraeCredentialStore.resolve()` | ✅ 返回凭据，host `https://api.trae.cn` |
| `identityHeaders()` | ✅ 10 个请求头全部生成 |
| 用量查询（只读） | ✅ 9 个积分包，总额 2050 / 已用 1522.85 |
| 模型目录（只读） | ✅ 42 个模型 |
| `writeFileAtomic` | ✅ 写入回读一致 |
| 并发 `withFileLock` | ✅ 8 并发串行化，无丢失更新 |
| `SSE` 解码 | ✅ 按 `\r?\n` 切分，CRLF 支持 |

**已知限制**：`model-cache` 依赖 `sqlite3`（本机没有），实测抛 `ENOENT` 并正确
兜底，不影响主流程。

**同轮发现并修掉的一处缺口**：该模块原先把 `state.vscdb` 路径**硬编码为 `Trae CN`
单一拼写**，而 `paths.ts` 是多候选；且它自行重算目录而未复用
`traeStorageCandidates`。本机真实目录名是 `TRAE SOLO CN`，旧代码指向的
`...\Trae CN\...\state.vscdb` **并不存在**——只因 `sqlite3` 缺失、该调用必然失败
兜底，才把一个错误的路径藏在「依赖缺失」这个看似合理的错误后面。
现改为**从凭据路径推导**（`state.vscdb` 与 `storage.json` 同在 `globalStorage`），
真机复测已能正确选中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\state.vscdb`。

**仍然缺的**：那台机器只装了 TRAE SOLO CN，所以 `Trae CN` / `trae-cn` 两个拼写
**仍未经真机确认**。如果你装的是 **Trae 中国版**（或国际版 / CLI），非常欢迎照下面
跑一遍并把输出贴到 issue。

## 为什么真机验证不可省

三件事各自成立，但合起来**仍然不等于**「Windows 上可用」：

| 已有证据 | 它证明了什么 | 它**不能**证明什么 |
| --- | --- | --- |
| CI 在 `windows-latest` 上全绿 | 代码在 Windows 上不崩、路径拼接正确 | CI 上**没装 Trae**，跑的是单测桩 |
| 单元测试覆盖 win32 分支 | 给定输入时逻辑正确 | 输入来自真实文件系统 |
| `win32DirName` 给出目录名依据 | 拼写有出处，不是猜的 | 安装器**实际**写了哪个名字 |

所以关键的一环始终是：**把真机上的真实文件交给真代码**。

---

## 一条命令（推荐）

在**装好插件**或**clone 了本仓**的 Windows 机器上：

```powershell
node scripts/verify-windows.mjs
```

**从 npm 装的插件**（README 的 `dsh plugin add dsh-connect-trae`）脚本在 DSH
profile 的 `node_modules` 里，路径取决于 `$DSH_HOME`（默认 `~\.dsh`）：

```powershell
# 脚本随包分发，所以从已安装的包目录里跑即可
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-connect-trae\scripts\verify-windows.mjs"
```

若你的 profile 名不是 `desktop`，或设了 `DSH_HOME`，用这条定位（列出现装版本）：

```powershell
Get-ChildItem -Path "$env:USERPROFILE\.dsh\profiles" -Directory |
  ForEach-Object { Join-Path $_.FullName 'node_modules\dsh-connect-trae\scripts\verify-windows.mjs' } |
  Where-Object { Test-Path $_ }
```

> 最省事的替代：直接 clone 本仓后 `pnpm install && pnpm run build`，在仓库根目录
> 跑 `node scripts/verify-windows.mjs`——脚本优先使用同级的 `lib/`。

### 它会输出什么

下面是**真机实测**（2026-09-26，Windows 10.0.22621 + TRAE SOLO CN）的完整形态，
顺序与措辞都按实际输出：

```text
[1] 插件在 Windows 上会探测哪些路径
    [  ] cn       C:\Users\<user>\AppData\Roaming\Trae CN\User\globalStorage\storage.json
    [  ] cn       C:\Users\<user>\AppData\Roaming\trae-cn\User\globalStorage\storage.json
    [  ] sg       C:\Users\<user>\AppData\Roaming\Trae\User\globalStorage\storage.json
    [有] solo     C:\Users\<user>\AppData\Roaming\TRAE SOLO CN\User\globalStorage\storage.json
    [  ] solo     C:\Users\<user>\AppData\Roaming\trae-solo-cn\User\globalStorage\storage.json
    [  ] solo-sg  C:\Users\<user>\AppData\Roaming\TRAE SOLO\User\globalStorage\storage.json
    [  ] cn       C:\Users\<user>\.trae-cn\trae-jwt-token  (CLI)
    [  ] sg       C:\Users\<user>\.trae\trae-jwt-token  (CLI)
  [OK  ] 至少找到一个 storage.json 或 CLI token — 1 个桌面 + 0 个 CLI

[2] 插件能否从中解出账号（跑真代码的诊断路径）
      missing    [cn] C:\Users\<user>\AppData\Roaming\Trae CN\User\globalStorage\storage.json  (桌面)
      ...
      已解出        [solo] C:\Users\<user>\AppData\Roaming\TRAE SOLO CN\User\globalStorage\storage.json  (桌面)
      ...
  [OK  ] 解出至少一个账号 — 12 字符 (solo/cn)  ← C:\Users\<user>\AppData\Roaming\TRAE SOLO CN\...\storage.json

[3] 设备指纹（这些会作为请求头发给 Trae）
    x-device-type : windows
    x-os-version  : Windows 10.0.22621
    x-device-id   : 16 位，纯数字
    x-app-version : 0.1.56
  [OK  ] x-device-type 为 windows — windows
  [OK  ] x-os-version 以 Windows 开头 — Windows 10.0.22621
  [OK  ] x-device-id 非空 — 16 位，纯数字
  [OK  ] 读到了 x-app-version — 0.1.56

结论：全部通过 ✅
```

`[2]` 的**每条路径只出现一行**，且真正解出账号的那条会标成「已解出」。
（早先的版本会把同一路径打印两遍，并把**已经成功解出账号的那个文件**同时报成
`invalid`——因为它把它既当 `storage.json` 又当 CLI token 各探了一次。现已合并为
一行一个结论。）

### 怎么读结论

- **全部通过** → 这台机器上插件能正常读到登录。**请把输出贴到 issue**（见下）。
- **`[1]` 找到 0 个** → 目录名与插件的假设不符。这是**最有价值的一种失败**：
  把输出贴出来，我们就能按真实目录名补上探测。
  临时可用 `authFile` + `edition` 指定完整路径救急（见文末）。
- **`[1]` 找到了但 `[2]` 解不出** → 多半是加密 header 变了或文件结构改了。
  请按 `docs/WINDOWS_TOKEN_PROBE.md` 的「第五步」补一次 header 字节验证。
- **只有 `x-app-version` 一行显示「未发送」** → 安装目录名不在探测列表里。
  **不影响登录与聊天**，但请贴出来，我们会补上这个名字。

退出码也参与判定，便于自动化：`0` = 全部通过，`1` = 有真实失败，
`2` = 未通过但**全部失败都只是「不是在 Windows 上跑」**（在 macOS / Linux 上跑脚本
时的必然结果，不算机器的错）。

---

## 输出可以直接贴到公开 issue 吗

**可以。**脚本的输出是脱敏的：

| 内容 | 处理方式 |
| --- | --- |
| Windows 用户名（`C:\Users\你的名字\`） | 替换为 `<user>` |
| 账号名（可能是真名或手机号） | 只报「几个字符、是否纯数字」 |
| 设备号 `x-device-id` | 只报「几位、是否纯数字」 |
| token / refreshToken / 密文 | **从不读取、从不打印** |
| Trae 目录名（`Trae CN` / `trae-cn`） | **保留**——这正是要查的东西 |

脱敏规则有 11 条单元测试（`tests/redact.spec.ts`），同时断言「敏感值必须消失」
与「诊断信息必须保留」。

贴的地方：<https://github.com/dingminhua/dsh-connect-trae/issues>

> 走手动流程（`docs/WINDOWS_TOKEN_PROBE.md` 的五步）时**没有**自动脱敏，
> 贴之前请自己把 `C:\Users\<你的名字>\` 改成 `C:\Users\<user>\`。

---

## 为什么这件事必须由人来做

不能自动化：CI 的 Windows runner 上不会安装 Trae，也不会有人登录 Trae 账号。
一个「未登录」的 Windows CI 上，插件的每一条路径探测都会失败——那恰好是
「没有 Trae 的机器」的正常表现，与「目录名猜错」无法区分。

所以这一环只能由**有一台装着 Trae 并已登录的 Windows 机器**的人完成。

---

## 临时绕过（不等修复也能用）

若 `[1]` 没找到，或名字不在列表里，可让插件直接读指定文件：

```yaml
# 插件配置
authFile: C:\Users\<你的用户名>\AppData\Roaming\<实际目录名>\User\globalStorage\storage.json
edition: cn        # 或 solo
```

`authFile` 指向的必须是 `storage.json` 那种加密文档；若你是用 `traecli` 登录的，
插件会自动探测 `~\.trae-cn\trae-jwt-token`（CLI 的裸 JWT），无需手配。

---

## 附：手工逐步核对（脚本跑不起来时）

见 `docs/WINDOWS_TOKEN_PROBE.md`，五个步骤覆盖同一套检查：
确认版本 → 确认目录名 → 确认文件存在 → 确认 key 存在 → 验证加密 header。
