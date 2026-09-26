# Windows 环境排查备忘：Trae 登录探测

> **这份文档是给在 Windows 机器上执行排查的人或 AI 看的。**
>
> **状态更新（2026-09-26）**：已有一台真机跑通验证——Windows 10.0.22621 装
> **TRAE SOLO CN**，`%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json`
> 确实存在且能解出账号，设备指纹四项全部正确。因此**「TRAE SOLO CN」这个目录名
> 已由真机确认**。仍未经真机确认的是 **`Trae CN` / `trae-cn`**（中国版）这两个
> 拼写——那台机器上没装中国版。详见 `docs/WINDOWS_VERIFY_GUIDE.md`。
>
> 下面第二～五步仍然适用于**其它情形**（装的是中国版、目录名仍对不上、
> 或加密 header 变化）。

## 先做这一步：跑验证脚本（推荐）

**一条命令给出结论，且输出已脱敏、可直接贴到公开 issue：**

```powershell
# 在插件目录下（或本仓 clone 后）
node scripts/verify-windows.mjs
```

脚本会：

1. 用**插件自己的构建产物**（不是重写一份逻辑）列出它在这台机器上会探测的
   每一条路径，并标注**文件是否存在**；
2. 跑真实的账号解析，报告解出了几个账号（账号名只给「几个字符」）；
3. 打印即将发给 Trae 的设备指纹（设备号只给「几位、是否纯数字」）；
4. 给出**全部通过 / 几项未通过**的结论。

**它不会打印 token、refreshToken、密文原文、真实账号名、设备号或你的 Windows
用户名**（用户名替换为 `<user>`，目录名保留——那正是要查的东西）。因此输出可以
直接贴进 issue，无需自己删改。

脚本报「全部通过」即说明：这台机器上的 Trae 登录文件，插件确实读得到。

> 若脚本因缺少导出而中止，说明用的是旧版本构建产物，先 `pnpm run build`。

---

## 若脚本报错，或你想手动逐步核对

以下五步覆盖脚本内部的同一套检查，适合**脚本本身跑不起来**（例如插件装不上、
node 版本不符）时使用。

## 第一步：确认你的 Trae 是哪个版本

| 版本 | 代码里的 edition | 插件是否使用 |
| --- | --- | --- |
| Trae 中国版 | `cn` | ✅ 使用 |
| TRAE SOLO 中国版 | `solo` | ✅ 使用 |
| Trae 国际版 | `sg` | ❌ **主动忽略** |
| TRAE SOLO 国际版 | `solo-sg` | ❌ **主动忽略** |

**如果你装的是国际版，不用往下查了** —— 插件在
`src/auth.ts` 的 `candidates()` 里主动过滤掉了 `sg` / `solo-sg`，
这个插件只对接中国区服务。

## 第二步：确认数据目录名（本次排查的核心）

插件在 Windows 上会**并列探测**这些路径（命中任一即可）：

```
%APPDATA%\Trae CN\User\globalStorage\storage.json
%APPDATA%\trae-cn\User\globalStorage\storage.json
%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json
%APPDATA%\trae-solo-cn\User\globalStorage\storage.json
```

其中 `%APPDATA%` 通常是 `C:\Users\<你的用户名>\AppData\Roaming`。
（另外还会回退探测 `<用户目录>\AppData\Roaming\...`，用于 `%APPDATA%` 未设置的场合。）

> ⚠️ **注意：这和 Trae 的安装目录无关。**
> Electron 应用（VS Code 系）的用户数据固定放 `%APPDATA%`，
> 无论你把程序装在 C 盘还是 D 盘。请不要去 `Program Files` 里找。

**为什么列出两种拼写**：Trae 是 VS Code 系 Electron 应用，其每用户数据目录由安装器
注册的产品名决定。macOS 包 `product.json` 里的 `win32DirName` 是 `Trae CN` /
`TRAE SOLO CN`，而同一产品族在 Linux 用的是小写 `applicationName`（`trae-cn` /
`trae-solo-cn`）。

**真机进度**：`TRAE SOLO CN` 这个拼写**已在真机确认**（2026-09-26，见文首状态更新），
说明 `win32DirName` 作依据是对的。`Trae CN` / `trae-cn`（中国版）**仍未经真机确认**。
多探一个的成本只是一次失败的 `readFile`，漏探则用户直接看不到登录。

### 操作

在资源管理器地址栏输入（或 Win+R）：

```
%APPDATA%
```

回车，然后**列出该目录下所有名字里带 `Trae` 或 `TRAE` 的文件夹**。

也可以在 PowerShell 里跑（这条命令不会输出 token，只列目录名，可以放心贴出来）：

```powershell
Get-ChildItem -Path $env:APPDATA -Directory |
  Where-Object { $_.Name -match 'trae' } |
  Select-Object -ExpandProperty FullName
```

## 第三步：如果找到目录，检查文件是否存在

把上一步拿到的实际目录名代入下面的路径，看文件在不在：

```powershell
# 把 "Trae CN" 换成第二步查到的实际目录名
$paths = @(
  "$env:APPDATA\Trae CN\User\globalStorage\storage.json",
  "$env:APPDATA\TRAE SOLO CN\User\globalStorage\storage.json"
)
foreach ($p in $paths) {
  if (Test-Path $p) { "FOUND: $p" } else { "MISSING: $p" }
}
```

## 第四步：检查文件里的 key 是否存在

**这一步只检查 key 存不存在，不要把 value 贴出来（value 就是加密的 token）。**

```powershell
$p = "$env:APPDATA\Trae CN\User\globalStorage\storage.json"  # 换成实际路径
$json = Get-Content $p -Raw | ConvertFrom-Json

# 只看 key 列表，不打印 value
$json.PSObject.Properties.Name

# 确认关键 key 是否存在（输出 True/False，安全）
$json.PSObject.Properties.Name -contains 'iCubeAuthInfo://icube.cloudide'
```

预期输出应该包含 `iCubeAuthInfo://icube.cloudide`。

顺便确认这几个 key 是否存在（插件会用到）：

```powershell
$keys = $json.PSObject.Properties.Name
'telemetry.machineId     : ' + ($keys -contains 'telemetry.machineId')
'telemetry.devDeviceId   : ' + ($keys -contains 'telemetry.devDeviceId')
'iCubeLastVersion        : ' + ($keys -contains 'iCubeLastVersion')
'icube-dc (device center): ' + (($keys | Where-Object { $_ -like 'iCubeAuthInfo://icube-dc:*' }) -join ', ')
```

## 第五步：验证加密 header（关键，且安全）

这是**最可能出问题、也最容易验证**的一环。

插件只认两种加密 header（`src/decrypt.ts`）：

| header 前 6 字节 | 类型 |
| --- | --- |
| `74 63 05 10 00 00` | `aes` |
| `12 39 20 20 02 03` | `aes-private` |

如果 Trae 新版本换了加密格式，解密会直接抛错，
而这个错误在 `src/auth.ts` 的 `readDesktopAll()` 里被 `catch` 静默吞掉，
用户只看到「未登录」，无从判断。

**验证方法（只输出 header，不输出 token）：**

```powershell
$p = "$env:APPDATA\Trae CN\User\globalStorage\storage.json"  # 换成实际路径
$v = (Get-Content $p -Raw | ConvertFrom-Json).'iCubeAuthInfo://icube.cloudide'

# 先看是密文还是明文 JSON
"starts with '{' (plaintext): " + $v.StartsWith('{')

# 取 base64 解码后的前 6 个字节
$bytes = [System.Convert]::FromBase64String($v)
'length: ' + $bytes.Length
'header: ' + (($bytes[0..5] | ForEach-Object { $_.ToString('X2') }) -join ' ')
```

把 `header:` 那一行报回来。预期是上面表格里的两种之一。

---

## 需要你回报的结果

**首选：直接贴 `node scripts/verify-windows.mjs` 的完整输出。**它已脱敏，无需删改。

若走手动流程，请贴回下面这些（**注意：不要贴
`iCubeAuthInfo://icube.cloudide` 的 value，那是 token。目录名、key 名、header
字节都可以贴**）：

1. 你的 Trae 版本：中国版 / 国际版 / SOLO 中国版 / 不知道
2. 第二步 PowerShell 的输出（`%APPDATA%` 下所有带 trae 的目录名）
   —— **这一条最关键**：它决定插件是否需要增加新的目录拼写
3. 第三步的输出（哪些 FOUND，哪些 MISSING）
4. 第四步：`iCubeAuthInfo://icube.cloudide` 是否为 True，以及那几个 key 的检查结果
5. 第五步：`length:` 和 `header:` 两行
6. 插件卡片上显示的具体状态（「未登录」？还是别的？）

**贴之前请自行删除路径里的 Windows 用户名**（`C:\Users\<你的名字>\` → 改为
`C:\Users\<user>\`）；`verify-windows.mjs` 已自动做这件事，手动流程需要你自己做。

---

## 已知的其他 Windows 问题

> **本节已于 2026-09-26 复核并更新。**此前列出的两条「已知问题」在代码里已经不存在，
> 留在文档里会把排查者引向错误方向，故改为「已处理」并附上当前实现。

- ~~`src/identity.ts` 读 `product.json` 时硬编码了 macOS 路径~~
  **已处理**：`product.json` 现按平台取路径，Windows 走
  `<LOCALAPPDATA>\Programs\<安装目录名>\resources\app\product.json`
  （`LOCALAPPDATA` 缺失时回退 `<home>\AppData\Local`）。读不到仍只是被 catch 掉、
  `appVersion` 为空，不影响登录与聊天。
  **且已在真机确认可用**：那台机器的 `TRAE SOLO CN\resources\app\product.json`
  被正确读到，`x-app-version: 0.1.56`。
- ~~`osVersion` 拼出来是 `win32 <release>` 而不是 `Windows <release>`~~
  **已处理**：现为 `Windows <release>`，`x-device-type` 也发 `windows`。
  **且已在真机确认**：实测发出 `x-device-type: windows`、`x-os-version: Windows 10.0.22621`。
- `src/paths.ts` 现在为 Windows 探测**多个目录拼写**（`Trae CN` 与 `trae-cn`、
  `TRAE SOLO CN` 与 `trae-solo-cn`）。依据是 `product.json` 的 `win32DirName`
  字段（macOS 包实测：`Trae CN` / `TRAE SOLO CN`），另一个是 VS Code 系在 Linux
  上的 `applicationName` 拼写。
  **真机进度**：`TRAE SOLO CN` 已在真机确认命中（2026-09-26），即 `win32DirName`
  作依据是对的；`Trae CN` / `trae-cn` **仍未经真机确认**（那台机器没装中国版）。
  多候选的意义在于：猜错只多一次失败的 `readFile`，漏猜则用户直接看不到登录。
- 机器 ID 是从数据目录里的 `telemetry.machineId` 或 `<数据目录>/machineid` 读的，
  这个推导在 Windows 上是成立的。**真机实测**：`x-device-id` 为 16 位纯数字，
  来自数据目录而非兜底哈希（兜底是 32 位十六进制）。
- `src/auth.ts` 写插件自有凭据副本时传 `mode: 0o600` / `dirMode: 0o700`。
  Windows 忽略 POSIX 权限位，该参数不报错也无效果，属已知且无害。

## 临时解决办法

如果确认是目录名对不上，可以用插件配置项 `authFile` 直接指定完整路径，
配合 `edition` 填 `cn` 或 `solo`：

```yaml
authFile: C:\Users\你的用户名\AppData\Roaming\<实际目录名>\User\globalStorage\storage.json
edition: cn
```
