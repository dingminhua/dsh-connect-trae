# Windows 真机验证指引

> 给需要在 Windows 上确认「dsh-connect-trae 到底能不能读到 Trae 登录」的人。
> 本机（macOS）无法执行这一步，所以这份指引的存在本身就是那个未验证项的产物。
>
> 对应 README 的「未验证项（欢迎回报）」与 `docs/WINDOWS_TOKEN_PROBE.md`。

## 为什么必须真机验证

三件事已经做到了，但它们合起来**仍然不等于**「Windows 上可用」：

| 已有证据 | 它证明了什么 | 它**不能**证明什么 |
| --- | --- | --- |
| CI 在 `windows-latest` 上全绿 | 代码在 Windows 上不崩、路径拼接正确 | CI 上**没装 Trae**，跑的是单测桩 |
| 单元测试覆盖 win32 分支 | 给定输入时逻辑正确 | 输入来自真实文件系统 |
| `win32DirName` 给出目录名依据 | 拼写有出处，不是猜的 | 安装器**实际**写了哪个名字 |

所以缺的只有一环：**把真机上的真实文件交给真代码**。下面这一步就是做这件事。

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

```text
[1] 插件在 Windows 上会探测哪些路径
    [有] cn       C:\Users\<user>\AppData\Roaming\Trae CN\User\globalStorage\storage.json
    [  ] cn       C:\Users\<user>\AppData\Roaming\trae-cn\User\globalStorage\storage.json
    ...
  [OK  ] 至少找到一个 storage.json 或 CLI token — 1 个桌面 + 0 个 CLI

[2] 插件能否从中解出账号
  [OK  ] 解出至少一个账号 — 7 字符 (cn/cn)

[3] 设备指纹（这些会作为请求头发给 Trae）
    x-device-type : windows
    x-os-version  : Windows 10.0.22631
    x-device-id   : 15 位，纯数字
    x-app-version : 3.3.100
  [OK  ] x-device-type 为 windows
  ...

结论：全部通过 ✅
```

### 怎么读结论

- **全部通过** → 这台机器上插件能正常读到登录。**请把输出贴到 issue**（见下），
  这条未验证项就可以关闭。
- **`[1]` 找到 0 个** → 目录名与插件的假设不符。这是**最有价值的一种失败**：
  把输出贴出来，我们就能按真实目录名补上探测。
  临时可用 `authFile` + `edition` 指定完整路径救急（见文末）。
- **`[1]` 找到了但 `[2]` 解不出** → 多半是加密 header 变了或文件结构改了。
  请按 `docs/WINDOWS_TOKEN_PROBE.md` 的「第五步」补一次 header 字节验证。
- **只有 `x-app-version` 一行显示「未发送」** → 安装目录名不在探测列表里。
  **不影响登录与聊天**，但请贴出来，我们会补上这个名字。

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
