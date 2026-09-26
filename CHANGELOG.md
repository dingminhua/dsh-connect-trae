# Changelog

## 2.3.1 (2026-09-26)

### Features

- **Windows 真机验证脚本 `scripts/verify-windows.mjs`**：把「Windows 上到底能不能读到 Trae 登录」从一串手工步骤变成**一条命令给出结论**。
  - **跑的是插件自己的构建产物**（`lib/`），不是重写一份逻辑——单元测试只能证明「代码在 Windows 上不崩」，因为 CI 的 windows-latest 上并没有装 Trae；真机验证要回答的是「这台机器上的 Trae 登录文件，插件读不读得到」，只有把真机文件交给真代码才成立。
  - 报告四项：① 它在这台机器上探测的**每条路径 + 文件是否存在**；② 真实账号解析解出了几个账号；③ 即将发给 Trae 的设备指纹（`x-device-type` / `x-os-version` / `x-device-id` / `x-app-version`）；④ 全部通过 / 几项未通过的结论。
  - **输出默认脱敏，可直接贴公开 issue**：Windows 用户名替换为 `<user>`（`C:\Users\<真名>\...`）、账号名与设备号只报**形态**（长度 / 是否纯数字）。脱敏而非全删是关键——`Trae CN` vs `trae-cn` 这个目录拼写正是报告唯一要查的东西，抹掉它报告就没价值。
  - 脱敏规则抽到 `src/redact.ts`（`maskUserPath` / `describeNameShape` / `describeIdShape`）并由脚本从插件导出中取用，避免「两处各写一版、改一处漏一处」。**+11 条单元测试**，既断言敏感值必须消失，也断言目录拼写/形态信息必须保留（只测「名字没了」的话，一个恒返回 `<redacted>` 的实现在测试下也会通过）。
  - 随 npm 包分发（`files` 白名单新增该单文件 8.8KB）：README 指引用户运行它，不随包则 npm 用户根本执行不了这一步。
  - **非 Windows 平台会显式说明**：脚本在 macOS / Linux 上也能跑，但会标注「当前平台非 Windows，平台相关的失败属预期」，避免被误读成兼容性缺陷。

### Bug Fixes

- **验证脚本在 Windows 上启动即崩，一条检查都跑不到**（在 Windows 真机上实测发现）：`scripts/verify-windows.mjs` 的 `loadPlugin()` 写的是 `import(join(here, '..', 'lib', 'index.js'))`，把**路径**当成 **URL** 传给了 `import()`。Node 把 `C:\...` 解析成 scheme 为 `c:` 的 URL，抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（"On Windows, absolute paths must be valid file:// URLs"）——**恰好在这个脚本唯一存在的目的平台上崩**。修法：改用 `pathToFileURL(local).href`。
  - **为什么 CI 没拦住**：`.github/workflows/ci.yml` 只跑 typecheck / test / build，**从不执行这个脚本**；而 `tests/verify-windows.spec.ts` 测的是 `src/`，脚本是个独立的 `.mjs` 入口——「代码正确」与「入口能跑起来」是两件事，这条缝隙正好够一个致命启动错误通过。这不是笔误而是覆盖盲区：对**以单文件入口形式交付**的产物，测它所调用的库不等于测它本身。
  - **回归测试**（+1 例，全仓 337 → 338）：把脚本**复制到临时目录**并配一个桩 `lib/index.js`（令 `existsSync(local)` 为真，从而精确命中崩掉的那个分支），再以**子进程**执行它，断言 ① 不出现 `ERR_UNSUPPORTED_ESM_URL_SCHEME`、② 输出走到了「结论：」而非死在加载器里。用桩而非本仓 `lib/` 是刻意的：`lib/` 不进版本库，且 CI 在**测试之后**才构建，测试不能依赖产物已存在。
  - **变异验证**：把脚本退回 `import(local)` → 该用例失败（`stdout` 为空）；确认两条 stderr 断言也真的有约束力（同一变异下 `stderr` 确实含该错误码），不是空转。
- **`[2]` 段把「已成功解出账号的那个文件」报成 `invalid`**（同一轮真机演练发现）：`TraeCredentialStore` 绑定单个 `storagePath` 时，会把该路径**同时当作桌面 `storage.json` 和 CLI token 文件各探一次**（覆盖路径的形态事先不可知，见 `candidates()`），因此直接打印 `diagnose()` 的 `failures` 会导致：① 每条路径重复出现两遍；② **刚刚成功解出账号的那个文件**被列为 `invalid`——一次按「不是存储文档」、一次按「不是 CLI token」。一台**唯一凭证已被成功找到**的机器，报告读起来却像有故障。修法：两段合并为**一次遍历**（`accounts()` 与 `diagnose()` 读同一批文件，探两遍纯属重复劳动），按路径**合并成一个结论**，命中账号的路径记为「已解出」；失败原因优先取更具体的一项（`missing` 是两种形态对不存在的文件的共同答案，非 `missing` 才说明读到了内容但被拒）。
  - 实测修正前后：`invalid [solo] ...TRAE SOLO CN\...` + 每行重复两遍 → `已解出 [solo] ...TRAE SOLO CN\...  (桌面)`，与「解出至少一个账号」的结论一致。

- **Windows 上只探测单一目录名，且这条路径从未在真机验证过**（"项目要支持 Windows"）。Trae 是 VS Code 系 Electron 应用，其每用户数据目录由安装器注册的产品名决定；插件此前在 Windows 上只按 macOS 的名字（`Trae CN` / `TRAE SOLO CN`）各探一条路径，猜错就直接「未登录」，而 `docs/WINDOWS_TOKEN_PROBE.md` 自己就写着「目录名是从 macOS 抄过来的，Windows 上实际名称未经确认」——即这条主路径从未验证，且失败时用户只看到「未登录」。
  - **依据（2026-09-26 实测 macOS 包）**：`product.json` 的 `win32DirName` 才是 Windows 侧目录名的权威字段——`Trae CN` 为 `Trae CN`（`applicationName: trae-cn`）、`TRAE SOLO CN` 为 `TRAE SOLO CN`（`applicationName: trae-solo-cn`）。因此 macOS 拼写大概率正确，但同一产品族在 Linux 用的是小写 `applicationName` 拼写，Windows 实际写哪个未验证。
  - **修法**：新增 `traeWindowsAppNames()`，Windows 侧改为**多候选并列探测**（`Trae CN` + `trae-cn`、`TRAE SOLO CN` + `trae-solo-cn`），与 Linux 侧既有的 `LINUX_APP_NAMES` 处理方式对齐；`src/identity.ts` 读 `product.json` 也共用同一份拼写表，避免「一个文件认这个名字、另一个不认」的不对称。**不再列出仅大小写不同的重复项**——Windows 文件系统不区分大小写，`trae cn` 与 `Trae CN` 是同一个目录，列两遍只会让探测清单和卡片上的「已检查的路径」重复一倍。
  - **明确未解决的部分**：Windows 真机上的实际目录名**仍然没有验证**（本机为 macOS，无 Windows 环境）。多候选只是把「猜错即失败」降级为「多一次失败的 `readFile`」，并不是验证。`docs/WINDOWS_TOKEN_PROBE.md` 保留为待真机回报的清单，并把「第二步：确认数据目录名」标为仍需执行。
  - **回归测试**（+2 例，全仓 319 → 322）：`paths.spec.ts`「探测 Windows 两种拼写」「不列出仅大小写不同的重复项」；`identity.spec.ts`「备用拼写（`trae-solo-cn`）下也能读到 `product.json`」。变异验证：`paths.ts` 退回单一目录名 → 1 条失败；`identity.ts` 退回单一拼写 → 1 条失败。

- **`src/model-cache.ts` 的缓存路径与凭据路径各自为政，在真机上指向一个不存在的目录**（Windows 真机适配检查时发现，属**潜伏缺陷**）：
  - **症状**：该模块把 `state.vscdb` 路径**硬编码为单一拼写 `Trae CN`**（macOS 与 Windows 两分支都写死这一个名字），而 `paths.ts` 早已是**多候选拼写**探测（`Trae CN` / `trae-cn`、`TRAE SOLO CN` / `trae-solo-cn`）。它**自己重算了一遍目录**，没有复用 `traeStorageCandidates`——即 2.3.1 修「多候选」时只修了登录路径，漏了这个兄弟模块。
  - **真机证据**（Windows 10.0.22621 + TRAE SOLO CN）：真实数据目录是 `TRAE SOLO CN`，而旧代码拼出的是 `%APPDATA%\Trae CN\User\globalStorage\state.vscdb` —— **该文件根本不存在**（实测 `existsSync` 为 false，而 `TRAE SOLO CN\...\state.vscdb` 存在）。**即便装了 `sqlite3` 也读不到**，与「装了 `sqlite3` 且小写拼写才失效」的初步判断相比，实际失效面**更大**：只要装的不是目录名恰好为 `Trae CN` 的版本就一定失败。
  - **为什么一直没被发现**：Windows 上 `sqlite3` 通常不存在，该调用**必然**先抛 `ENOENT`；调用方 `.catch(() => undefined)` 兜底后功能退化为「无缓存」，于是**一个错误的路径被另一个看似合理的错误（依赖缺失）掩盖**。这类「两个错误互相掩护」的情形，单看错误码永远排查不到——只有把期望的路径与磁盘实际路径对照才暴露。
  - **修法**：不再拼写目录，改为**从凭据路径推导**——`state.vscdb` 与 `storage.json` 同在 `globalStorage`，故同一个候选目录既管登录也管缓存；`traeStateDatabaseCandidates()` 复用 `traeStorageCandidates()`（单一事实来源），`raw-resolver.ts` 把命中的候选传下去。**明确带 `candidate` 时只看该 edition**：多版本共存时读另一个安装的数据库会拿到**别的账号**的模型表。选择顺序是「先看存在的，都不存在才用最可能的那条」，这样 `sqlite3` 缺失时调用方仍能看到**真实**失败，而不是被换成一个猜出来的错误。
  - **回归测试**（+7 例，全仓 338 → 345）：① 每个凭据候选的兄弟 `state.vscdb` 都必须可探测（**断言「与凭据表同源」而非硬编码期望字符串**——跟着写死拼写的测试会与 bug 一致地通过）；② Windows 上必须能找到 `TRAE SOLO CN`（旧的写死实现永远够不到）；③ 带 `candidate` 时它排第一且不越出自己的 edition；④ 大小写不同不重复列；⑤ macOS / Linux 也从各自凭据表推导；⑥ **选中的路径真的传给了执行器**（用注入的 `runSqlite` 断言 argv，否则「列表正确但查错条目」无法被发现）；⑦ 全都不存在时仍发起一次查询以暴露真实失败。
  - **变异验证**：把实现退回「硬编码单一拼写」→ **9 条中 5 条失败**；恢复后全绿。（首版变异脚本因文件是 CRLF 而静默未生效，导致测试「通过」——已加断言令变异未落地时**直接报错**，否则这种假阴性会被误读成「测试抓不到这个 bug」。）
  - **顺带修掉一个测试自身的问题**：⑥ 首版用 `path.includes('Library/Application Support')` 断言 macOS 路径，而 `join()` 在 Windows 上产出反斜杠——该测试在作者机器（macOS）通过而会在 CI 的 `windows-latest` 上失败。现先归一化分隔符再断言，这正是本项目「Windows 必须真机/win runner 验证」这条约定要防的错。

- **切换账号后无法领取签到：把「本机已签到」误判成「该账号已领取」**（用户上报）。2.3.0 的卡片与路由把 `checked_in` 与 `did_checked_in` **一并**当作「今日已领取」，于是切换账号后新账号显示「今日已领取」、按钮置灰、点不动。
  - **根因（2026-09-26 实测，两个 CN 账号 + 同一台机器 + 同一北京日）**：两个字段判定维度不同——`checked_in` 是**账号**口径（该账号今天的奖励包已存在），`did_checked_in` 是**设备**口径（这台机器的今日名额已用掉，由 `x-device-id` 决定，与是哪个账号用的无关）。切换账号后正是后者：设备名额已用，而当前账号**没有拿到任何奖励**——此时说「今日已领取」把「没领到」说成了「已领到」。（详见 `docs/USAGE_API_RESEARCH.md` 新增的「决定性修正」一节，含四组请求头对照表。）
  - **实测要点**：账号 A（当天已领取）与账号 B（当天未领取，无 `checkin_20260926_*` 奖励包）带**同一真实设备号**读状态，两者都返回 `did_checked_in:true`；不带该头、带合成号、或带本机另一安装的设备号，两者都返回 `false`；同一合成号连读三次也不会变 `true`（所以它不是「读过就算」的标记）。账号 B 带真实设备号 `claim` → `{"code":9095,"message":"当前设备今日已经签到，请明日再来哦～"}`，**未发放**，且 `total/consumed` 前后逐字节相同（`1900 / 1522.85`）。官方 NLS 文案 `2345 -> 该设备今日已参与签到` 亦为设备口径。
  - **修法**：`checked_in` 成为唯一的「今日已领取」（账号口径）判据——已领取才直接返回 `alreadyCheckedIn` 且不发请求；`did_checked_in` 且未领取时，路由返回新的 `deviceCheckedIn: true`（不再谎报 `alreadyCheckedIn`），卡片保持按钮禁用但改说「本机今日的签到已用掉」并说明可换设备 / 明天再来；上游以 `9095` 拒绝时（窗口竞争）同样按 `deviceCheckedIn` 处理，**不当成失败**——那是一条上游规则，不是插件故障。
  - **回归测试**（+4 例，全仓 316 → 319）：路由侧「设备已签但账号未领 → 不发请求且返回 `deviceCheckedIn:true` / `alreadyCheckedIn:false` / `code:9095`」「上游 9095 → 按设备已满上报而非错误」，卡片侧「设备已签不显示『今日已领取』且显示设备说明」「路由回 9095 时显示设备说明而非『签到失败』」。做过**变异验证**：把路由的 `checkedIn || didCheckedIn` 复原 → 1 条失败；把卡片的两个字段合并 → 1 条失败；删掉路由的设备守卫（照发请求）→ 1 条失败。

### Tests

- **Windows 真机验证脚本的三处可用性缺陷**（在真正按「Windows 用户拉代码 → 跑脚本」的流程演练时发现，全部是脚本自身的问题）：
  - **空机器误报「解出 1 个账号」**（最严重）：`TraeCredentialStore` 不传 `storagePath` 时会按 `process.platform` 扫描**宿主**目录，于是在一个刻意清空的 HOME 上，脚本从开发者本机解出了凭证——即「断言在一台没有任何 Trae 的机器上找到了 Trae」。这是本脚本可能产出的最误导性结果，因为它恰好会被读成「Windows 能用了」。修法：每个候选都**绑定到它自己的路径**，绝不回退到宿主扫描；并新增 4 条回归测试（`tests/verify-windows.spec.ts`）锁死该性质，变异验证：让 store 忽略固定路径 → 2 条失败。
  - **`[1]` 与 `[2]` 可能描述不同机器**：`[1]` 列的是 win32 候选，`[2]` 却扫宿主平台目录。现在两段同源，且 `[2]` 逐候选诊断并给出**命中路径**归属。
  - **未构建时的报错不可用**：`lib/` 不进版本库，拉代码后直接跑脚本会撞 `ERR_MODULE_NOT_FOUND` 堆栈。现在明确提示「这是源码 checkout、需要先 `pnpm install && pnpm run build`」，并以退出码 1 结束（实测）。
- **CLI-only 场景的两处误判**：① 身份解析误把 CLI token 当 `storage.json` 解析而抛 JSON 错——`resolveTraeIdentity` 的 CLI 兜底**只在文件不存在时**触发，故 CLI 候选改用 `readTraeCliIdentity` 直连；② `x-app-version` 缺失被计为失败，但那只是少一个请求头（登录/聊天/签到均不受影响），会让一台完全可用的机器报「未通过」，现改为 `[INFO]`，并对 CLI 候选改用不同措辞（CLI 从 `ide_version.json` 取版本，而非 `product.json`）。
- **修复 Windows CI 的冷启动超时抖动**（CI #60 失败，同一份代码在 #59 / #61 通过）。`windows-latest` 上每个测试文件的**第一个**用例会吃到一次性的模块转换成本，超过 vitest 默认的 5000ms：
  - 实测（#60，该次仅改 `.md`，代码与通过的那次逐字节相同）：`identity.spec.ts` 首个用例 5179ms 超时、同文件后续用例 6–60ms；`card-checkin.spec.tsx` 首个用例 9435ms 超时、后续 50–196ms；该次总计 `transform 17.71s / import 24.28s`。
  - **判定为抖动而非缺陷的依据**：只有每个文件的第一个用例受影响，同文件其余用例均在毫秒级；且同一份代码在前后两次 CI 均通过。
  - **修法**：`vitest.config.ts` 设 `testTimeout: 20_000`，**不动任何断言**。已验证超时机制仍生效（用一个必然挂起的探测用例确认仍会失败，探测文件随后删除）。
  - **明写在配置注释里**：不得用「放宽断言」的方式消除超时——若某个原本很快的用例在**所有**平台上都开始超时，那是真实回归，改这个数字不是答案。

### Docs

- **Windows 真机验证取得首个通过结果，README / 验证指引的「未验证项」措辞随之收敛**：此前 README（中英双语）与 `docs/WINDOWS_VERIFY_GUIDE.md` 都以「Windows 上 Trae 数据目录的实际名称尚未在真机确认过」为前提写成，而现在已有真机证据，把这句话留着就是反向的失真（本项目对「未验证项不得写成既成事实」有明确要求，反过来把**已验证项**写成未验证同样会误导）。
  - **实测结果**（Windows 10.0.22621 + TRAE SOLO CN，`node scripts/verify-windows.mjs` 退出码 0）：命中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json`；解出 1 个账号（`solo`/`cn`）；`x-device-type: windows`；`x-os-version: Windows 10.0.22621`；`x-device-id` 为 16 位纯数字（来自数据目录，**非**兜底哈希）；`x-app-version: 0.1.56`（取自 `%LOCALAPPDATA%\Programs\TRAE SOLO CN\resources\app\product.json`）。
  - **确认的是**：`product.json` 的 `win32DirName` 作为 Windows 目录名依据**是对的**——`TRAE SOLO CN` 确实是真机上的实际目录名；安装路径推导与设备指纹四个字段也都成立。即「Windows 上插件读得到 Trae 登录」由真机证据支持，不再是推断。
  - **仍然未验证的是**：`Trae CN` / `trae-cn`（中国版）两个拼写——那台机器只装了 SOLO 版。README 与验证指引都**明确保留**这一条并说明「它在此机器上不存在只反映本机没装该版本，不代表拼写有误」，避免读者把「本机没命中」误读成「拼写错了」。
  - 因此平台支持表的 Windows 行由「目录名见下方『未验证项』」改为「**已在一台真机通过验证**」，并新增「真机验证结果」小节逐项列出实测值；`docs/WINDOWS_VERIFY_GUIDE.md` 删去「本机（macOS）无法执行这一步」的旧前提，改为状态节 + 实测输出样例；`docs/WINDOWS_TOKEN_PROBE.md` 文首改用状态更新说明，并在第二节与「已知问题」逐条标注哪些已由真机确认。
  - `docs/WINDOWS_VERIFY_GUIDE.md` 的样例输出**改为真实输出的形态**（含 `[2]` 段一行一个候选的写法与退出码 0/1/2 的含义），此前的样例是示意性的，与实际输出格式已有偏差。
- **验证脚本的检查范围被明确划出，并补跑脚本之外的主流程实测**：`verify-windows.mjs` 的六项**只覆盖路径探测与设备指纹**，把它读成「整个插件在 Windows 上没问题」是过度外推。因此同一台真机上另外直接调用 `lib/` 导出跑了主流程：
  - `TraeCredentialStore.resolve()` ✅ 返回凭据（host `https://api.trae.cn`）；`identityHeaders()` ✅ 10 个请求头全部生成；只读用量查询 ✅ 9 个积分包（总额 2050 / 已用 1522.85）；只读模型目录 ✅ **42 个模型**；`writeFileAtomic` ✅ 写入回读一致；并发 `withFileLock` ✅ **8 并发串行化且无丢失更新**（此前 README 只写「宿主原生处理 Windows 独占创建语义」，现改为**实测成立**）；`SSE` 解码 ✅ 按 `\r?\n` 切分，CRLF 与分块均支持。
  - **实测确认了一处已知限制的真实行为**：`model-cache` 的 `sqlite3` 在本机不存在，抛 `ENOENT`（`spawn sqlite3 ENOENT`），调用方 `.catch(() => undefined)` 正确兜底，主流程不受影响——README 原写「会失败并安全回退」，现补上错误码作为依据。
  - **顺带发现并修掉一处真实精度缺口**（详见下方 Bug Fixes）：`src/model-cache.ts` 在 Windows 上把 `state.vscdb` 路径**硬编码为单一拼写 `Trae CN`**（`paths.ts` 是多候选 `Trae CN` / `trae-cn`），且该模块自己重算了一遍目录而没复用 `traeStorageCandidates`。本机真实目录名是 `TRAE SOLO CN`，旧代码指向的 `...\Trae CN\...\state.vscdb` **根本不存在**；只因 `sqlite3` 缺失、该调用必然失败并兜底，才把一个**错误的路径**藏在「依赖缺失」这个看似合理的错误后面。
  - 以上「脚本之外」的实测结果同时写入 README（中英）与 `docs/WINDOWS_VERIFY_GUIDE.md`，与脚本自身那六项**分表列出**，不让读者混淆两者的证据强度。
- **`docs/WINDOWS_TOKEN_PROBE.md` 的「已知的其他 Windows 问题」整节已过期**：其中两条（`product.json` 硬编码 macOS 路径、`osVersion` 拼成 `win32 <release>`）**在代码里早已修复**，文档却仍写成未解决的缺陷——按它排查会把 Windows 用户引向错误方向。已复核并改写为「已处理 + 当前实现」，同时补上「Windows 安装/数据目录名仍未验证」这一条真实缺口，以及 `mode: 0o600` 在 Windows 被忽略属已知无害。
  - 该文档**改为「先跑脚本」**：手工五步降级为「脚本跑不起来时的备选路径」，并把第二步（数据目录名）更新为当前的**多候选拼写**清单与依据，明确「这一条是本次要查的核心」。
- **README 明确 Windows 支持，并把「以后都要考虑 Windows」固化为开发约定**（"我们的项目要支持 Windows 的" / "之后都要考虑对 Windows 的影响"）。
  - README（中英双语）新增**平台支持表**（macOS ✅ 完全支持 / Windows ✅ 支持 / Linux ✅ 支持），并在开头段落明示「支持 macOS、Windows 与 Linux」+ CI 双平台矩阵，让 Windows 支持成为对外可见的承诺而非隐含行为。
  - 「Windows 说明」节**改写为与代码逐条对应**：账号目录（多候选拼写探测 + 与安装目录无关）、应用版本头（含 `LOCALAPPDATA` 回退）、设备指纹（`x-device-type: windows`、`Windows <release>`）、文件锁（宿主原生处理）、Raw Chat 的 `sqlite3` 限制、权限位被忽略。**每条都核对了代码位置后写入**。
  - **删掉一句未经验证的断言**：原文写「目录名与 macOS 一致，**无需额外配置**」——而 `docs/WINDOWS_TOKEN_PROBE.md` 自己就说该目录名从未在真机确认。这正是本项目反复强调的「不得把未验证项写成既成事实」，故改为「未验证项（欢迎回报）」小节，说明依据是 `product.json` 的 `win32DirName`、兜底是 `applicationName` 拼写，并给出回报路径与 `authFile` 临时绕法。
  - `DEVELOPMENT.md` 新增「**多平台要求（Windows 为长期支持目标）**」一节：给出平台相关面/无关面的分区表（路径解析与设备指纹为相关面，其余共用），以及 6 条改动强制检查项——新增路径必须带平台分支且多候选、不得用仅大小写不同的重复候选、新增外部命令依赖须确认 Windows 行为并登记限制、CI 必须在 `windows-latest` 通过、平台结论必须区分已验证/未验证、文档同步。这条约定使「考虑 Windows 影响」成为可执行的检查项而非口头要求。
  - **顺带修掉一处链接会在 npm 页 404 的问题**：本次新增的「未验证项」指引用户去看 `docs/WINDOWS_TOKEN_PROBE.md`，但 `package.json` 的 `files` 白名单（`RELEASING.md` 有明确记载，属有意的包体控制）只放行 `docs/assets/` 下那张截图，**所有 `docs/*.md` 都不进 npm 包**——写成相对 Markdown 链接会在 npm 页面上 404。既有引用（`docs/IMPLEMENTATION_PLAN.md` 等）用的是反引号纯文本故不受影响，本次改为指向 GitHub 的绝对链接（实测 HTTP 200）。
  - `RELEASING.md` 的打包内容清单同步更新（新增 `scripts/verify-windows.mjs`），并记下两条纪律：该脚本必须随包（否则用户无法执行验证步骤）、`docs/*.md` 不进包故 README 引用必须用绝对链接。


## 2.3.0 (2026-09-25)

### Breaking Changes

- **只支持 DSH 0.1.7-rc.1 及以上，不再支持 0.1.7 之前的宿主**。2.2.0 用「双线 + 运行期能力探测」同时服务 0.1.5 与 0.1.7；0.1.5 线的设置面（`installSection` / `settingsScope` / `settings.plugin.item` / 非 volatile 写入）与 0.1.7 的新模型**互不相交**，保留它意味着每条路径都要背两套契约。从本版起删除全部 0.1.5 分支，`peerDependencies` 与 `devDependencies` 一并收窄到 `>=0.1.7-rc.1` / `0.1.7-rc.1`（`cordis >=4.0.4`、`schemastery >=3.18.4`）。做法对齐同级 `dsh-connect-workbuddy`（其 2.1.0 起的 0.1.7-only 改造）。

### Bug Fixes

- **0.1.7 上 provider 被判「未配置」——命名空间必须用宿主服务的那个**（对齐 workbuddy 2.0.16 的实测）。0.1.7 的 `SettingsForms.describe()` 以 **Loader 条目 id** 为键，harness 对 provider 的命名空间做**精确匹配**查表（`namespaces.get(entry.settingsNs)`）。此前硬编码 `settingsNs: 'trae'`，而桌面宿主实际以 `dsh-connect-trae`（或 `include:dsh-connect-trae`）挂载条目，于是查表落空、provider 读作「未配置」，**配置入口与模型发现静默失效**、不报错。
  - **修法**：新增 `settingsNamespaceOf(ctx)`，采用一线插件（`dsh-llm-pi-ai`）的权威范式 `const settingsNs = ctx.fiber.entry?.options.id ?? TRAE_SETTINGS_NS`，`registerConfigurableProviders` 与 `registerModelDiscovery` 全部改用解析值；`ctx.fiber.entry` 由 Loader 注入（非 Cordis 公共类型），保留探测 + 回落到 `'trae'`。
  - **回归测试**（`tests/settings-integration.spec.ts`，+4 例）：采纳 Loader 条目 id、无条目/空 id/非字符串时回落、以及**目录实际宣告的就是解析值**（断言目录条目而非常量，否则恒过）。
- **移除宿主端 `installSection` 双路径，`configure({auto}, owner)` 成为唯一路径**（对齐 workbuddy 的 0.1.7-only 写法）。0.1.7 的 `SettingsForms` 删除了 `installSection`；2.2.0 按能力探测两条路径，本版起无条件调用 `configure`，且把返回的 disposer 挂进 `ctx.effect()`——否则展示策略泄漏到插件销毁之后（一线插件同款：`child.effect(() => child.settings.configure({ auto: false }, …))`）。随 `installSection` 一起删除 `legacyInstallSettingsSection` / `sectionHooks` 及其对 `@deepseek-ai/dsh-settings` 命名空间的依赖。
- **客户端设置面只走 `configForms`**（对齐 workbuddy 的 0.1.7-only 写法）：删除 `settingsScope.bind` 回退分支与 `settings.plugin.item` 槽位注册，只保留 `configForms.get(entryId)` + `plugins.bundle.config` / `plugins.row.config` 两个槽位。`inject` 维持 `['slots', 'locale']`，设置面仍经 `ctx.get()` 软探测。
- **卡片的 `view` 行为不再按双线区分**：`page` 视图默认展开、无 `view` 默认折叠；`set()` 契约收窄为 `Promise<boolean>`（0.1.7 表单返回显式布尔，`false` 即拒绝）。
- **区域开关等设置保存被宿主拒绝（`No configurable plugin entry "trae"`）——客户端命名空间绑定必须跟随 describe 镜像**。卡片此前在 `apply()` 时**一次性**解析命名空间：describe 镜像异步加载，且在运行中的 profile 里新增插件条目（本插件正是这种场景）时，镜像首次 describe 可能早于条目出现；`/trae/i` 匹配落空就**永久**回落到声明的 `'trae'`。`configForms.get('trae')` 把表单控制器永久绑到该 ns——宿主 `configEditor.entries()` 里没有 `options.id === 'trae'` 的条目，每次写入都抛 `No configurable plugin entry "trae"` 被拒；而控件仍可点（controller 对「ns 不在镜像」的派生沿用全局 `writable=true`），表现为「开关翻过去又弹回」。
  - **修法**：设置面改为**可重绑代理**——`getSnapshot` / `set` 转发到「当前」控制器；别名解析（`served.ns`，`/trae/i` 匹配）在 apply 时尝试一次，并订阅镜像（`describe().subscribe`）在每次变化后重绑；镜像已就绪但缺条目时**一次性**触发 `describe().load()` 补拉（此后宿主 `settings/document-updated` 事件保持新鲜）。绑定前代理返回 `writable: false`，卡片只读而非提供必定失败的控件。
  - **回归测试**（+3 例）：激活测试的镜像桩改为真实形状（`ns: 'dsh-connect-trae'`，即 patch id，非声明的 fallback），断言绑定到 `dsh-connect-trae`；新增「镜像在 apply 后才出现条目 → 重绑到正确 ns」与「一次性 nudge 补拉镜像」两例。测试桩此前的 `ns: 'trae'` 恰好把 fallback 当成了正解，是这条缺陷没被 CI 拦住的原因之一。
- **插件管理页 / 市场页的 logo 显示不对**（默认占位/空白，对齐 workbuddy 2.0.17 的实测）。0.1.7 的插件管理页从插件包 `package.json` 的 `icon` 字段读图标（`dsh-client-ui-plugin-manager` 渲染 `row.meta?.icon`），此前没有声明该字段 → 宿主无图可用。
  - **修法**（照同级 `dsh-connect-workbuddy` 的做法）：新增 `icons/` 目录（64px + 128px 真实 PNG，其中 64px 与既有卡片内嵌 base64 逐字节一致——同族 LD logo），`package.json` 声明 `"icon": "icons/dsh-connect-trae-128.png"`，并把 `icons` 加入 `files` 白名单随包分发。
  - **验证**：`npm pack --dry-run` 确认两个 PNG 进包（12 → 14 文件）。
- **模型倍率改回「wire 权威、Remote 兜底」，恢复折后价显示**（回归：b8f09bc 重构时误删 1.4.2 的 `display_contact_config` 解析）。`get_detail_param` 每行的 `display_contact_config`（第二层 JSON）里的 `consumption_rate.data.rate` 才是 Trae IDE 渲染的**折后价**；Remote 目录的 `consumption_rate` 在限时折扣下会报**未折价**（Seed-2.1-Pro：IDE `x0.08` vs Remote `0.80`，差 10 倍）。b8f09bc 改成多 function 并集时把这个解析连带删掉，倍率从此退化成 Remote 值。
  - **修法**：`solo.ts` 恢复 `wireCreditMultiplier()`（读 `display_contact_config.consumption_rate.data.rate`，`enable` 为真且为正有限数时取值，缺失/损坏留空不虚构），`TraeSoloModel` / `TraeWireModel` 增列 `creditMultiplier`；`mergeTraeModelSources` 合并时 **wire 优先、Remote 兜底**（wire 未提供才用 Remote）。
  - **国际版（ai）区域**：实测（2026-09-25 只读探测）国际版上游任何目录都不含 `consumption_rate`（订阅制，只有 `cost` 标签与 `manual_usage: 0|1`，官方 App 也只渲染「Lite-friendly」这类标签而非数值倍率），因此 ai 模型行按「解析不出则留空」保持不显示倍率——不虚构数值。
  - **回归测试**（+2 例）：`solo.spec.ts` 断言 wire 解析出折后价、缺失时不虚构；`catalog.spec.ts` 断言合并时 wire 优先、Remote 兜底、双缺留空。变异验证：把合并改回只读 Remote → 新用例立即失败。

### Dependencies

- `peerDependencies`：全部 `@deepseek-ai/dsh-*` 收窄为 `>=0.1.7-rc.1 <0.2.0-0`；`@deepseek-ai/cordis` 收窄为 `>=4.0.4 <5.0.0`；`@deepseek-ai/schemastery` 收窄为 `>=3.18.4 <4.0.0`（`volatile()` 自 3.18.3 起才有）。
- `devDependencies`：全部 `@deepseek-ai/dsh-*` 与 `cordis` / `schemastery` 升到 0.1.7-rc.1 线，开发树与用户解析一致。
- `tests/settings-integration.spec.ts` 的 settings 测试替身改为 **0.1.7 形状**（`SettingsForms` 语义的内存服务：`configure` + `describe` + 只写 volatile 字段的 `update` + `loader/volatile-update`），插件以**活引用配置**（volatile 字段 = `{get(): T}` 指向同一份文档）挂载，模拟真实宿主的写入→重放路径；原先写非 volatile 扁平字段（`lastCatalog` / `imageModelIds` / `enabledModelIds`）的用例改为写 `regions.cn` 槽位——正是 0.1.7 写入门接受且卡片实际采用的形状。

### Tests

- 310 → 316。移除 0.1.5 形态用例（client-activation 的 `settingsScope` 宿主、client-fallback 的 `settingsScope.bind` 回退、card-region-switch 的 void 返回契约），新增 4 例 `settingsNamespaceOf`、3 例命名空间重绑/补拉、2 例 wire 倍率解析与合并优先级。`pnpm run check`（typecheck + test + build）全绿。

## 2.2.0 (2026-09-24)

### Bug Fixes

- **支持 DSH 0.1.7 线，且同一个构建同时服务 0.1.5 与 0.1.7**（修复 [issue #13](https://github.com/dingminhua/dsh-connect-trae/issues/13)）。这不是「多支持一个版本」的可选增强——**在 0.1.7 上插件的浏览器半侧此前根本不激活**：

  ```
  web boot: 1 entry did not activate
  dsh-connect-trae: pending (waiting for service: settingsScope)
  ```

  - **根因：`settingsScope` 被整个移除，而 Cordis 的依赖闸门是硬闸。** DSH **0.1.7-alpha.1** 起客户端设置服务换成 `configForms`，`settingsScope` **不再存在**（不是弃用、没有兼容层；0.1.6-alpha.2 还有，0.1.7-alpha.1 起包内已无此符号）。插件 `inject` 里仍声明它，于是 fiber 永远停在 `PENDING`——**不是某个功能坏掉，是整个客户端插件不激活**，因此「重新登录」「重装插件」一概无效。修法与 workbuddy 一致：`inject` 收窄为两条线都有的 `['slots', 'locale']`，设置面改由 `ctx.get()` **按能力软探测**（属性访问会抛 `cannot get property X without inject`，`?.` 挡不住；`ctx.get` 对缺失服务返回 `undefined`）。
  - **0.1.7 上另有三处断裂，issue 只报了第一处。** 逐项对照 workbuddy 的实测（该仓库已用同一套适配跑通 0.1.7）：

    | # | 位置 | 0.1.5 | 0.1.7 |
    |---|---|---|---|
    | 1 | 客户端设置服务 | `settingsScope` | `configForms` |
    | 2 | 客户端槽位名 | `settings.plugin.item` | `plugins.bundle.config` / `plugins.row.config` |
    | 3 | 宿主端注册 | `installSection()` | `configure({auto}, owner)` |
    | 4 | schema 可写声明 | 无需 | 必须标 `volatile()` |
    | 5 | primitives 图标名 | `…Outline14` | `…OutlineRegular` |

  - **第 2 条（槽位名）最容易被漏掉**：两条线声明的槽位集合**互不相交**（0.1.5 只有 `settings.plugin.item`；0.1.7 只有 `plugins.*`）。就算设置服务改对了，槽位名不改卡片依然渲染不出来。现在三个槽位**各自独立 try/catch** 逐个注册——一条线上不存在的槽位不能把另一条线的注册一起带走。
  - **第 3 条（宿主端）在 0.1.7 上是静默失败**：`installSection` 被 `SettingsForms.configure()` 取代。由于该调用位于嵌套的 `ctx.inject` 回调内，抛出的 `installSection is not a function` 落在**那个子 fiber** 上——外层插件照常加载、两个 provider 照常注册，**但 `trae` 设置命名空间从未注册**，表现为卡片设置区无声消失。现在按能力探测：有 `configure` 走 `configure`，否则回落 `installSection`。
  - **第 4 条（易失声明）**：0.1.7 的 settings 写入门要求插件 schema 把可写字段标为 volatile，否则**写入被直接拒绝**（`Plugin entry "trae" has no volatile fields`），而 `scope.set()` 却正常 resolve——用户会看到开关翻过去又静默复原。新增 `asVolatile()`：运行时探测 `schema.volatile()`，**有则调用、无则退化为 identity no-op**（`volatile()` 自 schemastery 3.18.3 起才有，0.1.5 线锁在 3.18.2）。**故意不手写 `meta.volatile = true`**——那会绕过 schemastery 自身的 `validateVolatileSchema` 校验，产出一个它自己都不认的 schema。
  - **0.1.7 以「活引用」交付配置值。** 该线把 volatile 字段以 `{get(): T}` 形式交给消费方；不解包则 `config.regions`、`value.accounts[region]`、`config.authFile` 静默变成对象或 `undefined`，表现为「设置明明写了却读不到」。更隐蔽的是**展开一个活引用得到的是 `{get: <function>}` 而不是值**——卡片「写一个区域、保留另一个」的合并会因此**丢掉兄弟区域并把函数泄进设置文档**。新增 `unwrapVolatile()` / `unwrapVolatileDeep()` 并在所有读取与合并路径上解包，同时监听 `loader/volatile-update` 在每次写入后重读选择。
  - **第 5 条（图标）会让整个客户端包挂掉**：两条线 primitives 的图标名不重叠（`IconChevronDownOutline14` vs `IconChevronDownOutlineRegular`），**没有任何一个静态 import 能同时服务两边**——静态导入 0.1.5 的名字会让 0.1.7 上的客户端包解析失败，整个卡片随之消失。折叠箭头改为**纯 CSS caret**（`border` + `rotate`），与版本无关。
  - **设置写入改为「写入后回读校验」**：`set()` 的 promise resolve **不代表值已落盘**（0.1.7 上被拒绝的写入会重新加载 Host 状态然后正常返回，0.1.5 上则可能被文件占用丢弃）。四处写入（账号选择、账号重扫、区域开关、模型目录）统一走 `writeSettingsField()`：写入后回读，未落盘即抛错并在卡片上明确显示，而不是「点了没反应」。0.1.7 的 `set()` 还会返回显式布尔值，`false` 同样按拒绝处理。
  - **卡片的 `view` 属性**：0.1.7 的插件管理器通过 owner props 向每个配置条目索取两种视图（`summary` 一句话简介 / `page` 带保存控件的完整表单）。卡片接受该属性并在 `page` 下默认展开——否则在 0.1.7 的插件页里卡片会是折叠的一行。
  - **开发环境的 schemastery 从 3.18.2 提到 3.18.4**（`pnpm-workspace.yaml` 的 override，与 `devDependencies` 对齐）。此前 dev 树锁在 3.18.2，那里没有 `volatile()`，`asVolatile()` 退化为 no-op——**于是 volatile 真正生效的那条路径（每个 0.1.7 用户都会走的那条）在本地从未被执行过**，这类缺陷可以同时躲过评审与 CI。这与 workbuddy 记录的教训同源。

### Tests

测试总数 282 → 310。

- **新增 `tests/client-activation.spec.tsx`（3 例，本次最关键的一组）**：用真实的 cordis `Context` **启动真实的客户端入口模块**，分别对 0.1.7 形态（有 `configForms`、**无** `settingsScope`）、0.1.5 形态（有 `settingsScope`、无 `configForms`）、以及**两者都没有**的形态断言 fiber 到达 `ACTIVE`、槽位注册齐全、scope 取自正确的服务。之所以能直接导入真实入口，是因为它运行期只依赖 React 与本地文件，所有 DSH 包都是**类型导入**、构建时即被擦除。
  - 此前 `client-fallback.spec.ts` 抓不到这个缺陷：它**手工镜像**入口函数体，因此验证的是「思路」而**从不执行真实的 `inject` 数组**——而恰恰是那个数组让 fiber 卡在 PENDING。
  - **变异验证**：把 `inject` 改回 `['slots','locale','settingsScope']`，0.1.7 与「无设置面」两例立即变红（fiber 停在 0/1，永远到不了 `ACTIVE`），0.1.5 那例仍绿——精确复现了 issue 报的现象。
- **新增 `tests/dsh-017-compat.spec.ts`（13 例）**：活引用的单层/深层解包、数组与嵌套、**不就地改写调用方对象**；`regionEnabledOf` / `regionStateOf` / `regionEnabled` 穿透活引用读值；合并时**保留兄弟区域且不泄露函数**；`asVolatile()` 的两条分支按运行时能力确定性断言；以及**宿主端 `configure()` 优先于 `installSection()`**（用一个只有 `configure` 的真 Service 装配，断言走的是 `configure({auto:true})` 且没有 `installSection` 报错）。
  - **变异验证**：把 `configure` 探测改回无保护裸调 `installSection` → 1 条立即变红；把 `nextRegionSlots` 的深解包去掉 → 1 条立即变红。
- `client-fallback.spec.ts` 的镜像同步更新，并补 2 例：**两条线都提供时 `configForms` 优先**（0.1.7 的写入闸门只认它），以及 **`configForms` 缺席时回落 `settingsScope.bind()`**。
- **`card-region-switch.spec.tsx` 新增 8 例**（渲染真组件、点真按钮）：穿透活引用读区域开关；合并时**保留兄弟区域且不泄露函数**；Host 明确拒绝（`set()` 返回 `false`）与**「接受了但没落盘」**（`set()` 返回 `true` 而文档未变）两种失败都必须显式报错；0.1.5 的 `void` 返回视为成功；`view: 'page'` 时默认展开、无 `view` 时默认折叠；无设置面时渲染为只读。
  - **变异验证**：去掉 `regionsMapOf` 的解包 → 1 条失败；去掉 `view` 判断 → 1 条失败；去掉 `false` 判断 → 0 条失败（回读校验兜住了，说明两层防护确实互补）；去掉回读校验 → 1 条失败；**两层都去掉 → 1 条失败**。
  - 顺带移除了该文件对 `dsh-client-ui-primitives` 的整包 `vi.mock`：图标已改纯 CSS，不再需要这个桩。

**双版本验证**：同一份代码在 schemastery **3.18.4**（volatile 生效）与 **3.18.2**（no-op 分支）下**均为 310 通过**。

## 2.1.0 (2026-09-24)

### Features

- **新增「每日签到领取」**（对齐 `dsh-connect-workbuddy` 的签到能力）：
  - **交互**：国内版卡片在积分面板下方多一行签到：显示每日奖励（基础 + 额外，本机实测 `150 + 50`）与一个「立即领取」按钮；领取中显示「领取中…」，当日已领取显示「今日已领取」并禁用。国际版没有签到活动，因此**不显示该行**。
  - **这是插件里唯一的写操作**，也是唯一会改变账号状态的调用（`POST /trae/api/v2/ug/checkin_credits/claim`）；其余查询全部只读。README 顶部与特性列表都按此措辞改写，不再把整个用量面板称为「只读」。
  - **根因级发现：缺 `x-device-id` 会被静默拒绝**。同一份 Authorization，只加这一个头，结果从「HTTP 200 + 业务码 `9004`（The submitted order parameters are incorrect）」变成「`code: 0`，奖励到账」——**HTTP 状态始终是 200**，只看状态码会把它误判为成功。设备号取自本机 `iCubeAuthInfo://icube-dc:<id>`，即 `identity.ts` 里聊天通道同源的那个 `deviceId`（官方客户端在 `main.js` 的 `fb(headers)` 里给每个 ug 请求都补上它）。`deviceId` 由 `index.ts` 惰性注入；读不到时降级为不发该头——**只影响领取，不影响状态查询**（状态接口两种情况下都正常返回）。
  - **领取前的守卫比上游更强**：路由 `POST /plugins/dsh-connect-trae/checkin` 仅接受 POST、仅接受回环来源、仅服务 `cn` 区域，并且**先读状态**——已领取（`checked_in` 或 `did_checked_in` 任一为真）就直接返回 `alreadyCheckedIn` 且**根本不发领取请求**；活动关闭答 409。国际版直接答 404 并说明原因，而不是把上游的 HTML 404 当成网络故障抛给用户。
  - **已实测上游按北京自然日幂等**：重复领取仍回 `code: 0`，而权益总额（`total=1600, consumed=390.8`）逐字节不变，**不会重复发放**。插件仍然自行守卫——「不会重复发放」是上游的行为，不是插件可以依赖的保证。
  - **业务拒绝不当成故障**：`claimed: false` + 原始业务码与 message 原样回给卡片并显示出来，而不是包成 500。否则用户只会看到「领取失败」，而丢掉唯一能解释原因的 `9004`。
  - **对齐官方客户端的状态判定**：`checked_in` 与 `did_checked_in` 是两个独立字段，官方在「今日已领取」判定上也参考后者，插件据此保持按钮禁用。~~插件在卡片与路由两侧都按同一规则判定~~ —— **注：这里的口径在 2.3.1 被修正**。当时把两者一并当作「今日已领取」是**错的**：`did_checked_in` 实际是**设备**口径（`x-device-id`），不是账号口径，切换账号后会谎报「已领取」。以 2.3.1 为准；`extra_credits` 的展示（避免把当天实际到账的 200 说成 150）保持不变。
  - 卡片新增 8 条真实点击测试（`tests/card-checkin.spec.tsx`，渲染**真组件**、`fireEvent.click` 真按钮、断言真发出去的请求），`usage.spec.ts` 补 6 条、`web-status.spec.ts` 补 7 条，共 21 条新测试（全仓 261 → 282）。做过**变异验证**：去掉路由的 `did_checked_in` 守卫 → 2 条失败；去掉卡片的同款判定 → 1 条失败；把卡片的 `POST` 改成 `GET` → 1 条失败；删掉「已领取则不发请求」的守卫 → 2 条失败。（其中针对 `did_checked_in` 的两条断言在 2.3.1 按其真实语义重写。）
  - 取证与接口契约：`docs/USAGE_API_RESEARCH.md` 新增「每日签到领取」一节（含决定性请求头对照表、幂等性实测表、区域限制与官方字段语义）。

## 2.0.6 (2026-09-22)

### Features

- **新增「可单独关闭任一版本的供应商」**（issue #11：用户问「能禁用国际版或国内版吗，有没有配置的地方」——「比如说我根本用不到国际版」）：
  - **此前确实无解，而且最容易被误用的那条路走不通**：`edition` 配置只收窄**凭据扫描范围**（找账号用），不参与 provider 注册；`src/index.ts` 的注册循环对 `REGION_KEYS = ['cn','ai']` 是无条件注册的，所以设 `edition: "cn"` 之后 `trae-global` 依旧出现在模型选择器里。卸载国际版 App 同理——无账号时该区域回落到**插件内置的兜底目录**（Gemini / GPT / MiniMax / Kimi 共 7 条），这些模型一个都调不通，却和可用模型并排显示（这正是 issue #8 的成因）。DSH 侧也没有「停用某供应商」的入口。
  - **交互**：设置卡片两个 tab 各带一个勾选，**默认都勾选**（老用户零感知）；取消勾选即关闭该供应商，重新勾选即恢复。
  - **关闭是「真撤掉」，不是「藏 tab」**：抽掉 adapter 路由（`AdapterRegistrationHandle.replace([])`）——这是让模型**从 DSH 模型选择器消失**的那一步；同时抽掉供应商目录条目（`DirectoryRegistrationHandle.replace([])`），否则「设置 → 模型」仍会列出它。DSH 的类型契约明确允许持零路由而保持注册（"An empty array is legal here ... unlike an empty initial registration"），因此实现是**先正常注册、再 `replace([])`**，两步在同一同步段内完成，无可观测的路由空窗，且开关**立即生效、无需重启**。
  - **顺带消掉一个失败面**：关闭的区域连启动时的模型目录拉取都跳过，不再发任何 Remote/SOLO 请求——「没装国际版每次启动报一次错」那类噪音一并消失。
  - **状态不丢**：开关写入只改目标槽位的 `enabled` 一个字段，该区域的目录 / 勾选 / 图片开关 / 上下文预算与另一区域的整个槽位原样带过，所以「关掉 → 再打开」能完整恢复。配套地在卡片保存模型目录时**回写 `enabled`**——那次写入会替换整个槽位，漏掉它就会「保存一次模型列表 = 悄悄重新打开已关闭的供应商」。
  - **已知代价（明确提示而非静默失败）**：若某会话此前选中了被关闭供应商的模型，路由撤掉后再调用会报 `NO_ADAPTER`；这是「彻底移除」的必然结果，卡片在该 tab 上给出明确文案说明设置均已保留、勾选即可恢复。
  - **两侧读同一条规则**：Host 的 `regionEnabled()` 与卡片的 `regionEnabledOf()` 共用「仅显式 `false` 关闭」的判定，回归测试用 8 种正常/畸形形状交叉比对二者，锁定永不分歧；卡片另读 Host 随文档下发的 `enabled`（signed-in / signed-out 两个分支都带），因为**未登录的区域恰恰是用户最想关掉的那一个**。
  - **修复开发期发现的「勾选点了没反应」**：卡片把**整个 settings 段**传给了只接受 **`regions` 子对象**的判定函数，于是它去查 `section['cn']`（不存在）并**永远返回 `true`**——复选框恒定显示为勾选、点击看起来毫无变化；而**写入其实已经成功**（设置里确实落下了 `enabled: false`），Host 侧路由也确实撤掉了，问题只在卡片的读取。修复方式不是「把参数改对」了事，而是让 `regionsMapOf()` 统一收口、**同时接受整段与子对象两种入参**，使传错一半在结构上不再可能静默返回 `true`；并补 2 条回归测试覆盖「整段入参」与「返回值必须是 `regions` 子对象」（把拆包逻辑改回原样，这 2 条立刻失败，已实测）。
  - **补齐「真实点击」测试，堵住让该 bug 溜过的结构性缺口**：此前 `vitest.config.ts` 只收 `tests/**/*.spec.ts` 且 `environment: 'node'`，**根本无法渲染 React 组件**——仓库里唯一的客户端测试还是自己标注了 DRIFT WARNING 的「手工镜像副本」，不是产品代码，所以「点一下复选框」从来没有被自动化验证过（这正是 bug 能发布出去的原因）。现在 `tests/card-region-switch.spec.tsx` 在 jsdom 里渲染**真组件**、`fireEvent.click` 真实 `<input type="checkbox">`，断言 settings 落值与勾选态翻转，8 条用例覆盖空配置/已关闭/点击写入/重新启用保留选择/点第二个框/不切 tab/关闭态文案/不可写禁用。**变异验证**：把拆包逻辑改回出 bug 的样子，4 条立刻失败（含「存了 false 却显示已勾选」这一条，与用户症状一致）。配套：放开 `.spec.tsx`、`tsconfig` 分派、新增 `jsdom` / `@testing-library/react` / `@testing-library/dom` / `react-dom@18` 四个 devDependencies；`dsh-client-ui-primitives` 因带浏览器专用 CSS modules 在测试中整体 mock（产品依赖契约不变）。
  - 新增 10 条回归测试（区域开关判定与两侧一致性、整段/子对象双入参、开关往返不丢状态、关闭后 `listProviders()` 与目录条目同步消失且不影响另一侧、**模型选择器分组也消失**、重启后仍生效、两个都关仍可恢复、旧配置两边都开、`enabled` 在两种文档分支都下发）。开发中做过**变异验证**：把「抽掉路由」改成「照常注册」（即只隐藏 tab 的假实现），集成测试立刻失败；把目录 `replace` 改回按区域调用，4 条测试失败；把整段入参的拆包逻辑去掉，2 条测试失败——测试确实咬得住。
  - 取证与回复草稿：`docs/ISSUE11_DIAGNOSIS.md`、`docs/ISSUE11_REPLY_DRAFT.md`。

## 2.0.5 (2026-09-22)

### Fixes

- **修复「缓存统计一直是 0」**（issue #10：用户反馈「我测试了一下一直0缓存」，并猜测是接口原因或 Trae 本身不缓存）：
  - **根因在插件自己这一层**：Trae 上游**确实有前缀缓存、也确实在报**（实测逐字节相同的长 prompt 连发，第二次起 `cache_read_input_tokens` 从 0 升到 5248、9216），但插件解码 `token_usage` 事件时**只搬了 4 个计数器**（`prompt_tokens` / `completion_tokens` / `total_tokens` / `reasoning_tokens`），`cache_read_input_tokens` 与 `cache_creation_input_tokens` 被直接丢弃；`TraeStreamEvent.usage` 在**类型层就无法表达**这两个值，转发层自然也无从搬运。
  - **不是「放行」就够，必须做字段名映射**：`dsh-llm-pi-ai` 只在 `usage.cacheRead > 0` 时写入 `cacheReadTokens`，而 pi-ai 的 `parseChunkUsage` 只识别 `prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens` / `cached_tokens` 三种拼写——Trae 的原生字段名不在其中，原样透传依然读不到。现在映射为规范的 `prompt_tokens_details.cached_tokens` / `.cache_write_tokens`。
  - **先确认了语义再动手**：pi-ai 会做 `input = prompt_tokens - cacheRead - cacheWrite`，该减法仅在「`prompt_tokens` 包含缓存量」（OpenAI 口径）时成立。实测同一份 prompt 的 `prompt_tokens` 恒为 9224 而 `cache_read` 从 5248 涨到 9216，若为 Anthropic 的排除口径则同一输入的实际规模会在 14472 → 18440 之间跳变，不可能——据此确认 Trae 用包含口径。端到端复核账目守恒：`8 + 9216 + 0 = 9224`，与 `prompt_tokens` 完全相等，无重复扣减。
  - **`src/raw-chat.ts` 存在同一类缺口**（Raw Chat 通道将来启用时会踩同一个坑）：`RawChatDelta.usage` 补上缓存字段，并同时接受 OpenAI 嵌套拼写与 DeepSeek/Kimi 的顶层拼写。两个通道均保证「上游没报缓存时 wire 形状不变」，不产生空 `prompt_tokens_details`。
  - 新增 4 个回归测试，其中 bridge 用例直接以真机捕获的 `token_usage` 事件原文作为输入。
  - 取证与复现脚本：`docs/ISSUE10_DIAGNOSIS.md`、`scripts/probe-cache-convention.mjs`。
  - **说明**：修复只保证「上游报了缓存就如实上报」。新会话/新前缀的第一轮必然 `cache_read=0`（冷启动），第二轮起才有值；实测 Trae 当前只报读不报写（`cache_creation_input_tokens` 恒为 0）。

## 2.0.4 (2026-09-16)

### Fixes

- **修复「某个区域没有实时模型目录时，该区域的 provider 整个加载失败」**（issue #8：未安装国际版的用户看到 `Trae Global 加载失败：adapter returned invalid context metadata for provider "trae-global" model "gemini-3.1-pro"`）：
  - **根因**：两个区域的内置兜底目录里，每个模型都缺少 `contextWindow`。DSH 要求它必须是正整数（`INVALID_MODEL_CONTEXT`），而 `dsh-llm-pi-ai` 的回退链是 `entry.contextWindow → 已安装 catalog → request.defaultContextWindow`——本插件既没传 `defaultContextWindow`，兜底模型也不在已安装 catalog 里，三条全空，于是校验失败。
  - **失败粒度是 provider 级**：不是丢单个模型，而是**整个区域不可用**。触发场景包括未安装该区客户端、未登录、目录拉取失败（该端点有已知的间歇性 401）、以及首次安装尚未刷新过目录。因此这不是「没装国际版拖累国内版」，而是**两个区域各自独立地有这个缺陷**。
  - **修复**：(1) 兜底目录补上实测 `contextWindow`——国际版依据 2026-09-15 实测目录（`gemini-3.1-pro`/`gemini-3-flash-solo`/`minimax-m3`/`minimax-m2.7`/`kimi-k2.5` = 200000，`gpt-5.4`/`gpt-5.2` = 272000），国内版依据 SOLO 通道实测（200000）；(2) adapter 传 `defaultContextWindow` 作为最终防线，将来任何来源的条目不慎缺字段时降级为「一个保守尺寸的模型」而非「整区不可用」。
  - 新增不变量测试：**两个区域的兜底行都必须带正整数 `contextWindow`**。原先有一条测试断言「兜底条目没有 `contextWindow`」——它固化的正是这个 bug，已改正。

## 2.0.3 (2026-09-16)

### Fixes

- **修复内置兜底目录里存在「不可调用模型」的问题**——插件在首次实时刷新落地前会先提供一份内置兜底模型列表，且这份列表**故意不经过「死 config_name」过滤**（过滤依赖实时目录，会把兜底本身误删）。因此它的 id 必须在源头就是正确的 `llm_utils_chat` config_name，而它此前不是：
  - `auto` 不是任何 Trae 的 config_name，选中后会以 `4001` 失败——已移除。该条目会在「尚未刷新目录」时（未登录 / 网络抖动 / 卡片未刷新）被真正提供给用户，因此并非理论问题。
  - `DeepSeek-V4-Flash` / `DeepSeek-V4-Pro` 缺少 `-Official` 后缀，不是真实 wire id——已更正为 `DeepSeek-V4-Flash-Official` / `DeepSeek-V4-Pro-Official`（依据 2026-09-15 实测目录，`docs/DS41_CALLABILITY.md`）。
  - 新增回归测试锁定三条不变量：兜底 id 必须是真实 config_name（显式禁 `auto` 与裸名）、两个区域的兜底都不得出现 TraeCode 独占模型、`mergeTraeModelSources` 确实丢弃无 wire 匹配的目录行。

### Docs

- **README 新增「模型覆盖范围」一节（中英同步）**——说明插件提供的是 Trae SOLO 通道的模型，而 TraeCode 通道的 4 个模型（`deepseek-v4.1-flash`、`glm-5.3-flash`、`kimi-k2.8-preview`、`qwen3.8-flash`）尚未开放到 SOLO 通道，因此暂不支持，**需要等官方开放到 SOLO 后才能支持**；并区分了 `GLM-5.3`（支持）与 `glm-5.3-flash`（不支持）。
- 新增 TraeCode / agent-task 通道与 TraeCLI 的可行性取证（`docs/CODEC_CHANNEL_FEASIBILITY.md`、`docs/TRAECLI_FEASIBILITY.md`、`docs/TRAE_ECOSYSTEM_RESEARCH.md`）：四条路径逐一实测均不通，且阻塞原因互相独立（协议 / 配额 / 同机 / 登录态与 agent 归属），据此确认这批模型属上游授权边界而非插件可绕过的技术问题。

## 2.0.2 (2026-09-15)

### Fixes

- **修复「Trae 目录里有、插件列表里没有」的整类问题**（issue #7：GLM-5.3 缺失）——根因是**模型调用的 `function` 选错了**，不是目录读取有误：
  - Trae 把可调用目录**分散在多个 SOLO 模式 function 下**，且一个模型**只能通过列出它的那个 function 调用**。插件此前固定用 `solo_work_lite` 取目录与发请求，而 `glm-5.3` 只存在于 **`solo_work_remote`**：用前者调用会被上游拒绝（`4001 param is invalid`），用后者则正常流式返回（2026-09-15 受控实测，同一份请求体，仅 function 不同）。
  - **目录发现改为多 function 并集**：CN 依序请求 `solo_work_remote` → `solo_work_lite`，国际请求 `solo_agent` → `solo_work_remote` → `solo_work_lite`；同一个 config 由**先列出的 function 拥有**（顺序即优先级）。某个 function 失败不再影响其它 function 的目录。
  - **聊天请求按模型回放其来源 function**：每个模型随目录记下 `wireFunction`（并纳入设置 schema 持久化，重启后仍生效），调用时写回请求体——`glm-5.3` 因而会走 `solo_work_remote`。
  - 顺带确认：CN 的两个登录（Trae CN IDE 与 TRAE SOLO CN）在同一 function 下拿到**完全相同**的列表，因此该修复对两者一致生效；国际版覆盖最全的仍是 `solo_agent`。
  - 新增 4 个回归测试（多 function 并集、来源 function 标记、优先级归属、显式 function 覆盖默认值），230/230 全绿。
- **目录拉取失败时重试一次**——Trae 的目录端点存在间歇性 401/限流（实测同一凭证数秒前 200、随后 401）。启动时若恰好撞上，live 目录会拉取失败并**静默回退到上次保存的快照**，从而丢掉自那次保存以来的所有新模型（本版要放出的 glm-5.3 就在其中，实测复现）。现在合并骨架（remote 目录）失败会先重试一次（800ms 间隔）再降级。

## 2.0.1 (2026-09-15)

### Fixes

- **修复纯 CLI 环境（WSL2 等）下「账号已识别但模型目录拉不出来、聊天也全部失败」**（issue #5 后续反馈）——1.4.2 让凭据层认得了 `traecli` 的裸 JWT，但**身份层只认桌面版 `storage.json`**：只装 CLI 的机器上没有任何桌面安装，`x-machine-id` / `x-device-id` 的来源解析直接抛「Trae storage was not found」，而目录查询与聊天请求的构造都需要它，于是模型目录永远停在兜底列表、选中模型也无法对话。现在身份解析在「桌面安装全部不存在」时降级到 **CLI 家目录自身的持久化标识**：
  - `~/.trae-cn/argv.json` 的 `crash-reporter-id`（CLI 首次运行时写入的稳定 UUID）作为设备 ID；
  - `~/.trae-cn/builtin/ide_version.json` 的 `version` 作为 `x-app-version`；
  - 由设备 ID + 主机名 + 用户名做 SHA-256 得到 64 字符 `x-machine-id`（与官方客户端形态一致）。
  全部取自 CLI 自己写下的稳定值，**不是每次请求随机生成**（延续本项目既有红线）；有桌面安装时仍优先使用桌面 `machineid` / `telemetry.machineId`。文件存在但内容损坏时依旧暴露真实解析错误，不被降级掩盖。
- 修复 CI 在 ubuntu-latest 上的测试失败：`auth.spec.ts` 的 edition 收窄用例断言了候选数量为 1，而 Linux 会对每个 edition 并列探测多个目录拼写（`trae-solo` / `TRAE SOLO`），候选数为 2 —— 该多候选是 1.4.2 为 Linux 特意加的设计。测试改为断言收窄语义本身（候选数 > 0 且全部属于该 edition 的桌面安装），并已对 darwin / linux / win32 三平台逐一验证。

## 2.0.0 (2026-09-15)

### Breaking Changes

- **为什么是 2.0.0**：本版在「国际版支持」之上完成架构级变更——插件由「单 provider 单活区域」变为「双 provider 并行」，运行形态与外部可见契约均有变化，按语义化版本升主版本号：
  - **运行形态**：插件现在注册两个 provider 路由（`trae` + `trae-global`）并打开**两个**回环端口（原先各一个）。下游脚本若假定「只存在一个 trae provider」，需适配新增的 `trae-global`。
  - **设置 schema 扩展**：新增 `accounts.{cn,ai}` 每区域账号选择。旧的单 `accountId` 仍被读取并按其账号实际区域自动归位（软迁移，非硬破坏）；`regions` 分槽结构不变。
  - **CLI 不可见面**：卡片路由全部按 `?region=cn|ai` 参数化（未知区域 400）；这是 host↔卡片之间的私有契约，对用户透明。

### Features

- **🆕 国内版与国际版拆分为两个并行供应商，可同时使用**——此前一个 provider 一次只能活一个区域（选哪个账号整个 `trae` 就服务于哪个区域，切账号 = 翻转整个运行时目录）。现在两侧是两套完全独立的实例，**互不干扰**：

  - **双 provider 注册**：国内版保持 `trae`（老 id 不变，存量会话的默认模型与已保存选择全部继续有效），国际版新增 `trae-global`（displayName `Trae Global`）。**两边模型同时出现在 DSH 模型选择器里**——不同会话 / 子代理可以各选一边，互不干扰。
  - **每个区域一套完整运行时栈**：凭据 store、模型 catalog、wire 映射（display id/name → `llm_utils_chat` config_name）、Remote/SOLO 客户端、回环 shim、adapter 各一份。store 按凭据自带的区域声明过滤可见账号，两个区域的账号可同时在线。
  - **插件卡片 tab 化**：设置卡片顶部新增「国内版 / 国际版」tab 栏（带各自登录状态圆点）。每个 tab 有独立的账号选择、用量/订阅概览与模型管理；**切 tab 不丢另一侧未保存的草稿**（模型勾选 / 图片开关 / 上下文预算的草稿按区域隔离保存）。
  - **「减少刷新变化」**：一个 tab 里切账号、刷新模型、轮询用量，完全不触碰另一边的运行时目录——绑定另一边模型的进行中会话不受任何影响（单 provider 架构做不到这一点）。
  - **账号选择按区域独立**：配置新增 `accounts.{cn,ai}`，每个 tab 各选各的账号。旧的单 `accountId` 在启动时按其实际所属区域归位（另一区域保持「首个发现账号」的默认，绝不静默继承错区域的选中账号）。
  - **凭据刷新副本按区域分文件**：`$DSH_HOME/.trae-auth.cn.json` 与 `.trae-auth.ai.json`，双账号同时在线互不覆盖（此前单文件只存一个账号的刷新结果，后写者赢）；旧单文件 `.trae-auth.json` 作为迁移来源保留读取（只被其凭据所属的区域采纳），`logout` 清除全部。
  - **身份解析按区域收窄**：机器/设备 identity 的候选安装先按区域过滤，国内栈不会去读国际安装的 identity（反之亦然），避免跨安装取错 deviceId/machineId。
  - **Raw Chat 探测仅在国内栈**：探测模型 `qwen-3.7-plus` 仅国内可用，且该路径本就 `enabled: false`；国际栈固定报告 `disabled`，不再触碰 raw 端点。

- **国际版支持（国内与国际账号对等）**——沿用本版已完成的区域化工作，**零配置、零开关**：

  > **🆕 正式支持 Trae 国际版（www.trae.ai）**——国内版与国际版账号在本插件中获得完全对等的支持：

- **怎么用**：在插件卡片对应区域的 tab 里选账号（Trae / TRAE SOLO 国际版安装的登录即国际版；Trae CN / TRAE SOLO CN 即国内版）。区域判定完全跟随凭证自带的 `userRegion` 声明（`SG` → 国际，`CN` → 国内，host 后缀与 edition 标签兜底），无需任何手动设置。
- **国际账号可用的完整功能**（目录/网关/订阅状态均经 2026-09-15 实测取证，见 `docs/INTL_SG_EVIDENCE.md`）：
  - **模型接入**：聊天与目录请求自动走国际网关 `https://coresg-normal.trae.ai`；国际版 remote 目录（Gemini-3.1-Pro / Gemini-3-Flash / MiniMax-M3 / M2.7 / Kimi-K2.5 / GPT-5.4 / GPT-5.2）进入 DSH 模型选择器；CN 版解析器直通国际响应（`wireConfigName` 机制命中 `gemini-3.1-pro → custom_model_gemini`）。
  - **订阅状态**：国际账号无 Work 积分包（订阅制），卡片显示订阅/试用状态（`ide_user_pay_status`，官方 App 同款端点）。
  - **请求头零分叉**：CN 版整套请求头（`x-app-id`、identity 头、`Cloud-IDE-JWT`）被国际网关原样接受；`storage.json` 解密器四版通用。
- **目录与勾选按区域隔离（国内 / 国际各一套）**：`regions.cn` / `regions.ai` 两套独立槽位（目录、勾选、图片开关、上下文预算各一份），切换账号互不干扰；旧的扁平字段保留为**国内区域的迁移来源**（区域拆分前的配置一律来自国内端点），国际区域绝不继承。
- **凭证层**：四个桌面版安装（Trae CN / Trae / TRAE SOLO CN / TRAE SOLO）全部纳入账号扫描；国际 CLI（`~/.trae`）因默认 host 未验证暂不支持（给出可诊断错误而非静默误路由）。
- **refresh 契约按 edition 分叉**：TRAE SOLO 国际版走 `/trae/api/v3/oauth/ExchangeToken` + ClientID `en1oxy7wnw8j9n` + DeviceInfo（官方 App 日志直证）；其余三版维持 `/cloudide/api/v3/trae/oauth/ExchangeToken` + `ono9krqynydwx5`。
- **端到端实测（2026-09-15）**：SOLO 国际版有效凭证经本项目正式代码路径（`prepareSoloBody` + `buildTraeHeaders` + `REGION_GATEWAYS.ai.chat`）发最小 `solo_work_lite` 请求：`gpt-5.4` 走 `coresg-normal.trae.ai` 返回 HTTP 200 + 完整 SSE（`output("OK")` / `usage` / `done`），`SseDecoder` 原样可用。账号扫描实测：`edition: auto` 下四版安装共发现 5 个账号（含 2 个国际版，region 正确标 `ai`）。
- 测试：region 判定（userRegion 大小写不敏感/host 后缀/edition 三级兜底）、regionStateOf 迁移语义（扁平读作 cn、ai 绝不继承、显式槽优先）、fallback 目录区域隔离与实测快照、solo/remote/usage 的 ai 网关路由断言、refresh 四版契约断言、web-status 的 ai 分派与降级、nextRegionSlots 保存合并语义。220/220 全绿（含双 provider 注册、跨区域隔离、区域路由分派、区域化 store 与旧副本迁移）。

## 1.4.2 (2026-09-14)

> **版本号说明**：`v1.4.1` ~ `v1.4.4` 四个 git tag 曾推送到远端，但对应代码已整体回档到 `1.4.0`、
> 从未发布到 npm。发布前已删除这四个废弃 tag（备份见 `backup/abandoned-v1.4.1-v1.4.4` 分支
> 及 `abandoned-tags-v1.4.1-4.bundle`）。
>
> 本次实际使用 `1.4.2` 而非 `1.4.1`：`1.4.1` 在 npm 上处于 **staged 状态**
> （由一次未完成的发布预占，`npm view` 查不到该版本，但 `npm publish` 报
> `E409 Cannot publish over previously staged version`），该编号已无法复用。

### Fixes

- 修复 CLI 登录（`traecli`）不被识别、插件恒显「未登录」的问题（issue #5，WSL2 用户报告）。插件此前只认桌面版 Electron 的 `globalStorage/storage.json`（加密值 `iCubeAuthInfo://icube.cloudide`），而 `traecli` 把登录信息写在自己的家目录里、内容是**未加密的裸 JWT**（实测 macOS 上是 `~/.trae-cn/trae-jwt-token`）；纯 CLI 环境（WSL2 常见）根本没有 `storage.json`，因此永远解析不出账号。现在：
  - 凭据来源扩展为 `desktop` / `cli` 两类，`TraeStorageCandidate` 新增 `source` 字段；新增 `parseTraeCliToken()` 直接解析裸 JWT（取 `data.user_id` 与 `exp`），不走 AES 解密链路。CLI token 不含 host 声明，统一补 CN 主机 `https://api.trae.cn`，避免空字符串变成不可用的 base URL。
  - CLI 候选路径在 macOS / Windows / Linux 三平台都会探测（`~/.trae-cn/`、`~/.trae/`）。
  - Linux 桌面版目录名改为**多候选并列探测**（`trae-cn` 与 macOS 拼写 `Trae CN` 都试）。此前只认从 macOS 抄来的 `Trae CN`，而 Linux 上 Electron 应用通常用小写无空格目录名；该拼写从未在 Linux 真机验证过。多探测保证猜错也不会漏掉真实安装。
- 把 `readDesktopAll()` 里的静默 `catch { continue }` 改为记录失败原因，新增 `TraeCredentialStore.diagnose()`：返回探测过的每个路径及其失败类型（`missing` / `unreadable` / `invalid`）。未登录时卡片新增可折叠的「已检查的路径」列表。此前无论路径不存在、key 缺失还是加密头不支持，用户都只看到「未登录」三个字，无从自助定位——`docs/WINDOWS_TOKEN_PROBE.md` 整篇文档的存在本身就是这个可观测性缺口的补丁。诊断内容只含路径与固定原因文案（错误消息不回显输入），不携带任何 token 材料，并有专门测试守住这一点。

## 1.4.0 (2026-09-10)

### Changes

- 对齐 DSH 内核 `0.1.2-rc.1` → `0.1.5-rc.2`（桌面 `dsh-plugin-desktop` 2.0.9 所捆绑通道；`0.1.5-rc.1` 为 npm `latest`，`rc.2` 在 `next`）：
  - `ResolvedPiAiProviderProfile` 在 0.1.5 新增**必填**字段 `modelErrors`：`PiAiAdapter` 现在按模型查此表，命中即以 `INVALID_CONFIG` 拒绝请求；`piProvider` 同时由必填改为可选。本插件是手工构造 profile（不走内核目录解析，故该表不会被子系统填充），补 `modelErrors: new Map()` 表达「所服务的模型全部可用」这一事实。不补则本插件在 0.1.5 宿主上**无法通过类型检查**（`TS2741`）。
  - devDependencies 升级至 `@deepseek-ai/dsh-*@0.1.5-rc.2`，`@earendil-works/pi-ai` 由 `0.84.2` 升至 `^0.85.1`：`dsh-llm-pi-ai@0.1.5-rc.2` 要求 `pi-ai@^0.85.1`，版本不一致会在 `node_modules` 里留下两份互不兼容的 `pi-ai`，导致 `Provider<Api>` 结构不匹配的编译错误。
  - `peerDependencies` 的 `@deepseek-ai/dsh-*` 由 `>=0.1.2-0` 抬到 `>=0.1.5-0`（`modelErrors` 为编译期硬依赖，0.1.2 宿主无法满足），`@earendil-works/pi-ai` 抬到 `>=0.85.1`。仍按范围声明、不锁死补丁版本，与内核 `next` 通道继续前进保持一致。
  - 经核实本次不受文档列出的其余破坏项影响：未使用 `dsh-session` / `dsh-session-persistence` / `dsh-persona` / `dsh-system-prompt` / `dsh-message-feedback` / `dsh-subagent`；未读取 `DSH_SESSION_JSONL`、未调用已移除的 `locate()` / `readRaw()`；`AttachmentStore` 仅作类型引用，`IconChevronDownOutline14` 与客户端 `dsh.client.inject` 六个包在 0.1.5 均仍存在。会话格式 v3 与 persona 段改名对本插件不适用。

### Fixes

- 修复内置回退模型表被实时线路映射过滤、导致真实安装上模型几乎全部消失的问题：`FALLBACK_TRAE_MODELS` 是本插件自带的静态兜底表，其中每个 id 都**从未**由 Trae Remote 目录公布，因此永远不会出现在 `callableKeys` 里。此前 `configuredModels` / `derive` 把这张表也交给 `dropDeadModels` 过滤，只要实时目录只返回一部分模型（账号权限、版本或网络给出的子集），过滤就会把「这次没被提到的」回退模型一并删掉——本机实测在无凭据环境下只剩 `glm-5.2` / `kimi-k2.6` 两个模型可用。现在回退表不再参与线路过滤，并以 `wireResolved` 标志取代「`callableKeys` 非空」作为「线路目录已解析」的判据，避免空目录被误读为「没有模型可用」。新增回归测试覆盖该路径；该缺陷在本仓库 1.3.0 上本来就会失败（与内核升级无关），修复后 `pnpm run test` 首次达到 157/157 全绿（此前 154/156）。

## 1.3.0 (2026-09-08)

### Changes

- 模型名称内嵌积分倍率，与 Trae 自身模型菜单的显示格式一致（如 `GLM-5.2 · x0.79`）：DSH 模型选择器中由本插件注册的模型名在 Trae 公布 `consumption_rate` 时带上 `· x倍率` 后缀，倍率随目录刷新更新，未公布倍率的模型保持原名；模型 id 与内部目录仍用原始名称（不影响 wire 解析与已保存的选择）。插件设置卡片模型行的倍率同步改为 `· x0.79` 内联显示；`lastCatalog` 设置模式新增 `creditMultiplier` 字段声明，保证倍率跨重启持久化。

## 1.2.0 (2026-09-04)

### Changes

- 适配 DSH v0.1.2-rc.1 上游重构（`dsh-plugin-desktop` 2.0.5），同一份构建继续兼容 0.1.1 宿主：
  - `@deepseek-ai/dsh-settings` 在 0.1.2 的 npm 包中移除了 `settingsNamespace` / `installSettingsSection` 自由函数（桌面宿主内置兼容垫片，npm 安装没有；缺失导出会在 ESM 链接期直接报错）。设置接线改为双轨：从模块命名空间读取旧自由函数，存在则使用（0.1.1 宿主与带垫片的 0.1.2 桌面宿主），否则回退 `settings` 服务的 `installSection` 方法（无垫片的 0.1.2 npm 环境）；`TRAE_SETTINGS_NS` 改为字面量 `'trae'`。
  - `@deepseek-ai/dsh-client-runtime` 包在上游被拆分删除：客户端入口的 `ClientContext` 类型改从 `@deepseek-ai/cordis` 导入，`slots` / `settingsScope` / `locale` 服务类型分别通过 `dsh-client-ui-renderer/client`、`dsh-client-ui-settings/client`、`dsh-client-locale/client` 的类型增广获得；`package.json` 的 `dsh.client.inject` 相应把 `@deepseek-ai/dsh-client-runtime` 替换为 `@deepseek-ai/dsh-client-ui-renderer`（0.1.2 中 `slots` 服务的提供方，该包在 0.1.1 中同样存在）。
  - `llm.registerModelDiscovery` 的取消信号从 `request.signal` 移到回调第二个参数：发现回调改用 `(request, signal)` 签名并透传给 Trae 发现请求，修复 0.1.2 宿主下取消不再传播的问题；0.1.1 宿主回退读取 `request.signal`。
- devDependencies 升级至 `@deepseek-ai/dsh-*@0.1.2-rc.1`、`cordis@^4.0.2`、`schemastery@3.18.2`、`pi-ai@0.84.2`（新增 `dsh-client-ui-renderer`、`dsh-client-ui-settings`，移除已删除的 `dsh-client-runtime`），`pnpm run check` 现在直接面向 0.1.2 类型与运行时验证；`peerDependencies` 维持 `>=0.1.2-0 <0.2.0-0` 不变。

## 1.1.2 (2026-08-31)

### Fixes

- 对齐 DSH 宿主（`dsh-plugin-desktop`）实际提供的依赖版本，修正 `peerDependencies` 范围：`@deepseek-ai/dsh-*` 由 `^0.1.1-rc.2` 改为 `>=0.1.2-0 <0.2.0-0`（覆盖宿主 `0.1.2-alpha.1` 及 npm 预发布线），`@earendil-works/pi-ai` 由精确 `0.82.1` 放宽为 `>=0.82.1`（宿主为 `0.84.3`）。修复旧范围按 node-semver 预发布元组规则静默排除宿主版本、安装时报 `ERESOLVE` 的问题。

## 1.1.1 (2026-08-31)

### Fixes

- 修复身份解析在 Windows 等只安装部分 Trae 版本（如仅 SOLO）的机器上读取不存在的存储文件而抛 `ENOENT`、导致刷新与聊天请求全部失败的问题：现在按「第一个实际存在的 CN/SOLO 存储候选」解析 Trae identity，与凭据存储的跳过缺失语义保持一致。

## 1.1.0 (2026-08-30)

### Fixes

- 保持 `llm_utils_chat` / `solo_work_lite` 为模型调用主路径，继续保留 Trae 原生结构化 `tool_calls`，避免模型无法调用 DSH 本地 `read` / `write` / `bash` 工具。
- 删除只提取最终文本、无法返回 DSH `tool_calls` 的 `TraeSoloRemoteBridge` 及 Remote 会话调用逻辑；保留独立、只读的 `TraeSoloRemoteCatalogClient` 用于刷新完整模型能力目录，类型上不提供聊天方法，防止再次误接为模型调用主路径。
- 收紧 SOLO 请求为实证字段 allowlist，过滤会触发 `param is invalid` 的 OpenAI 可选字段；推理档位完成 DSH canonical → Trae wire 转换。
- 修复 `get_detail_param` 解析器字段名：上下文窗口改读 `model_detail_list[].prompt_max_tokens`（回退 `context_window_tokens.dev`）、最大输出改读 `model_detail_list[].max_tokens`。原代码读不存在的 `max_input_tokens` / `max_output_tokens`，导致每个模型的 contextWindow / maxTokens 恒为 undefined。
- 模型发现合并时剔除「Remote 目录有、但 `get_detail_param` 无对应 `config_name`」的不可调用模型（`Doubao-Seed-Code`、`glm-5.3` 均属此类，发往 `llm_utils_chat` 必返回 `4001 param is invalid`）；`FALLBACK_TRAE_MODELS` 移除已下线的 `Doubao-Seed-Code`。
- 账号选择改为严格绑定用户显式选择：删除启动时按通用积分自动挑选账号的逻辑，未选号时仅用第一个发现的账号；账号失效时不再静默切换到其他账号，而是报「未登录」让用户重新选择，避免账单落到用户未选择的账号上。

### Changes

- 模型管理体验与 `dsh-connect-workbuddy` 对齐：一个上游模型只对应一个 DSH 模型 id，移除运行时 `@1m` 变体，改用逐模型 `contextBudgets` 在 Trae 公布的默认 / Max 窗口之间选择。
- 未勾选任何模型时按完整目录提供模型，避免初次配置或旧设置迁移后 provider 目录为空；旧配置中的 `@1m` 行会被自动过滤。
- 模型卡片改为右侧上下文预算单选或固定窗口值，并统一显示多模态标记与原始推理档位 `low / high / xhigh`。
- 模型发现草稿补充与适配器目录一致的 `inputModalities`；当前 DSH 版本可能在核心规范化阶段丢弃该扩展字段，但正式 PiAiAdapter 模型元数据与图片请求链路保持完整。
- Trae SOLO 请求改为按已验证字段构造 `llm_utils_chat` envelope，过滤 OpenAI 可选参数以避免 `param is invalid`；同时将 DSH 推理档位映射为模型声明的 Trae wire value，并继续规范化 `developer` 为 `system`。
- 模型发现以 Remote `/models` 目录为骨架，用 `get_detail_param` 补充 `wireConfigName`（`llm_utils_chat` 真正接受的 `config_name`），按 `config_name == id` 优先、`display_name == name` 次之两级 join；join 不到 wire 行的 remote 模型（不可调用）会被剔除，修复 Seed-Code 等模型因展示名与 wire id 不一致导致的 `param is invalid`。

### Docs

- 更新 README 顶部插件卡片截图（账号选择、积分卡片与模型列表的当前界面）。
- 移除仓库内开发期的一次性探测脚本（`scripts/probe-*.mjs`、`scripts/inspect-raw-chat-log.mjs`）及其只读脚本内容断言测试，保持仓库与发布包聚焦产品代码；`lib/`、`tests/` 与 `node_modules/` 依旧不进入发布包。

## 1.0.1 (2026-08-31)

### Changes

- 将 Cordis 插件运行 ID 从 `llm-trae` 统一调整为 `dsh-connect-trae`，与 npm 包名保持一致。已有 1.0.0 本地安装升级后如保留旧配置条目，需移除旧的 `llm-trae` 实例，避免重复加载。

### Windows support

- `src/identity.ts` 现按平台读取 `product.json`：macOS 保持原路径，新增 Windows 路径 `<LOCALAPPDATA>\Programs\<AppName>\resources\app\product.json`（缺失时回退 `<home>\AppData\Local`），Windows 上 `appVersion` 不再恒为 `undefined`，会随请求头发送 `x-app-version` / `x-ide-version`。
- `src/identity.ts` 的 `osVersion` 在 Windows 上由 `win32 <release>` 规范化为 `Windows <release>`。
- `src/identity.ts` / `src/model-cache.ts` 路径推导参数化（`platform` / `home` / `env` 可选注入，默认取真实环境），便于跨平台测试；所有平台判断统一使用同一平台源，避免 `x-device-type` 与 `x-os-version` 自相矛盾。
- `src/model-cache.ts` 的 `state.vscdb` 路径按平台推导；该模块依赖 `sqlite3` 命令行，Windows 默认未安装，Raw Chat 探测会失败并安全回退（Raw Chat 默认关闭，不影响主流程），详见 README「Windows 说明」。
- 新增 Windows / Linux / `sg` / `solo-sg` 的 identity 测试用例；修复 `tests/identity.spec.ts` 中依赖测试机平台类型的断言（现显式注入平台，Windows 真机与 CI 均可通过）。

## 1.0.0 (2026-08-30)

### Features

- 首个稳定版本：将本机当前登录的 Trae 中国区模型接入 DSH，并通过安全 loopback shim 提供模型调用。
- 接入 `llm_utils_chat` 原生函数调用通道，将 Trae `function_call` 转换为 DSH 可执行的 OpenAI `tool_calls`，支持工具结果回传与连续 Agent 循环。
- 自动发现 Trae CN / TRAE SOLO CN 本地登录账号，支持刷新 Token 列表、选择账号，并优先使用具有通用积分的账号。
- 提供 DSH Connect Trae 插件卡片，分别展示 Work 积分与 DSH 可使用的通用积分，并支持模型目录刷新和启用选择。
- 支持 DeepSeek-V4-Flash 等 Trae 模型、只读用量接口及中英文界面。

### Fixes

- 凭据选择优先使用可供 `llm_utils_chat` 计费的通用积分账号；单个损坏、过期或已退出的本地凭据不会阻断其他账号。
- 规范化 DSH 的 `developer` 消息角色为 Trae 接受的 `system`，避免模型请求持续 400 重试。
- 正确处理 Trae 流式错误事件，配额错误不再被误报为 `EMPTY_RESPONSE`。

### Docs

- 发布元数据、双语 README、发布流程、第三方 Trae 相关项目声明与 npm 打包白名单均已补齐。
- 项目以 MIT 许可证发布，版权归属明确为 `Copyright (c) 2026 LaoDing`。

## 0.1.0-dev.1 (2026-08-28)

### Features

- **新版 SOLO 远程会话通道**：`TraeSoloRemoteClient` + `TraeSoloRemoteBridge`，把 `solo.trae.cn/api/remote/v1/chat_sessions` 的轮询结果转换为 OpenAI SSE，接入安全 loopback shim，成为第一可用上游路线。
- **本地模型目录**：`DeepSeek-V4-Flash` / `DeepSeek-V4-Pro` / `Doubao_1_6` / `kimi-k2.6` / `qwen-3.6-plus` / `glm-5.1` / `minimax-m2.7`。
- **只读用量概览**：`TraeUsageClient` 查询总可用额度、积分来源、每日签到与奖励活动（`web_user_ent_usage` / `checkin_credits/status` / `activity/info`），只读、不消耗积分。
- **插件设置卡片**（对齐 `dsh-subagent-default-model` 外部形象）：在 `settings.plugin.item` 注册折叠卡片（key `trae`），带 LD 品牌图标与 `dsm-plugin-card` 卡片外壳，展开后展示总可用/已消耗、各项积分进度条、每日签到与奖励活动；Host 侧通过 `webServer` 只读路由 `/plugins/dsh-connect-trae/usage` 提供脱敏数据。
- **SSE 扩展**：解析 `token_usage` 与 `tool_calls` 事件。
- **安全骨架**：随机 loopback 端口、进程内随机 secret、Host/Origin/Content-Type 校验、请求取消、body 上限。

### Docs

- 新增 `docs/SOLO_ROUTE_DECISION.md`、`docs/USAGE_API_RESEARCH.md`、`docs/HANDOFF.md`。
- README 中英双语双文件，对齐插件外部形象标准。
- 新增 `THIRD_PARTY_NOTICES.md` 第三方开源声明：只记录与 Trae 接入直接相关的架构/协议参考项目及其许可证与合规说明；README 增加对应章节，发布包 `files` 白名单纳入该文件。
