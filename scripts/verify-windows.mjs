/**
 * Windows 真机验证脚本 —— 直接跑本插件的**构建产物**，不是重写一份逻辑。
 *
 * 为什么必须跑真产物：本仓库的单元测试只能证明「代码在 Windows 上不崩」，
 * 因为 CI 的 windows-latest 上并没有装 Trae。真机验证要回答的是另一个问题：
 * 「这台机器上的 Trae 登录文件，插件到底读不读得到」——只有把真机上的真实
 * 文件交给真代码才成立。
 *
 * 用法（在 Windows 上，装好插件或 clone 本仓后）：
 *
 *   node scripts/verify-windows.mjs
 *
 * 安全性：本脚本只输出**脱敏后的路径、形态描述与判定结果**。
 * 它不会打印 token、refreshToken、密文原文、真实账号名或设备号 —— 用户名
 * 一律替换为 `<user>`，账号名与设备号只给长度/是否纯数字。可以放心把输出
 * 贴到公开 issue。
 *
 * 脱敏助手来自 `src/redact.ts`（有单元测试），而不是本脚本自己实现一份：
 * 隐私逻辑最怕「两个地方各写一版，改了一处漏了另一处」。
 */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the plugin entry point: this checkout's build output first, then an
 * installed copy.
 *
 * `lib/` is gitignored, so a fresh clone has no build output at all. That is the
 * expected first state after `git clone`, and the failure it produces must be an
 * instruction rather than a raw `ERR_MODULE_NOT_FOUND` stack — a user following
 * the README should never have to read a Node resolution trace to learn they
 * need to build.
 */
async function loadPlugin() {
  const local = join(here, '..', 'lib', 'index.js')
  // `import()` takes a URL, not a path. A bare `C:\...\lib\index.js` is parsed as
  // the URL scheme `c:` and throws ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows —
  // i.e. exactly on the platform this script exists to verify, before a single
  // check runs. pathToFileURL is the conversion that makes the local hit work.
  if (existsSync(local)) return import(pathToFileURL(local).href)
  try {
    return await import('dsh-connect-trae')
  } catch (error) {
    const fromCheckout = existsSync(join(here, '..', 'src', 'index.ts'))
    console.error('')
    console.error('无法加载插件代码。')
    console.error('')
    if (fromCheckout) {
      console.error('当前目录看起来是一份源码 checkout，但缺少构建产物 lib/。')
      console.error('lib/ 不进版本库（见 .gitignore），所以拉取代码后必须先构建：')
      console.error('')
      console.error('    pnpm install')
      console.error('    pnpm run build      # 或 npm install && npm run build')
      console.error('')
      console.error('然后再运行本脚本。')
    } else {
      console.error('既没有找到同级的 lib/index.js，也无法从已安装的包解析 dsh-connect-trae。')
      console.error('请在本插件目录内运行，或先安装：dsh plugin --profile desktop add dsh-connect-trae')
    }
    console.error('')
    console.error(`（原始错误：${error instanceof Error ? error.message : String(error)}）`)
    process.exit(1)
  }
}

const ok = (yes) => (yes ? 'OK  ' : 'FAIL')
let failures = 0
const failedLabels = []
function check(label, passed, detail = '') {
  if (!passed) {
    failures += 1
    failedLabels.push(label)
  }
  console.log(`  [${ok(passed)}] ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

console.log('='.repeat(72))
console.log('dsh-connect-trae · Windows 真机验证')
console.log('='.repeat(72))
console.log(`  node        : ${process.version}`)
console.log(`  platform    : ${process.platform}`)
if (process.platform !== 'win32') {
  console.log('\n  ⚠ 当前不是 Windows（platform !== win32）。')
  console.log('    本脚本在其它平台上仍会运行，但只能验证「win32 分支的路径拼接」，')
  console.log('    无法验证真机上的目录名与登录文件。')
}

const plugin = await loadPlugin()

// 脱敏助手取自插件自身的导出（`src/redact.ts`，有单元测试覆盖），
// 保证脚本与产品代码用的是同一套规则。
const { maskUserPath, describeNameShape, describeIdShape } = plugin
for (const [name, fn] of [['maskUserPath', maskUserPath], ['describeNameShape', describeNameShape], ['describeIdShape', describeIdShape]]) {
  if (typeof fn !== 'function') {
    console.error(`\n  插件入口没有导出 ${name}（脱敏无法进行）。`)
    console.error('  请先构建：pnpm run build，或升级到包含 src/redact.ts 的版本。')
    console.error('  为避免泄露本机信息，脚本在此中止。')
    process.exit(1)
  }
}

// ---------------------------------------------------------------- 1. 探测清单
console.log('\n[1] 插件在 Windows 上会探测哪些路径')
console.log('    （这是 src/paths.ts 用 platform=win32 算出来的真实清单）')

const candidates = plugin.traeStorageCandidates('win32', undefined, process.env)
const desktop = candidates.filter((item) => item.source === 'desktop')
const cli = candidates.filter((item) => item.source === 'cli')

for (const item of desktop) {
  const exists = existsSync(item.path)
  console.log(`    [${exists ? '有' : '  '}] ${item.edition.padEnd(8)} ${maskUserPath(item.path)}`)
}
for (const item of cli) {
  const exists = existsSync(item.path)
  console.log(`    [${exists ? '有' : '  '}] ${item.edition.padEnd(8)} ${maskUserPath(item.path)}  (CLI)`)
}

const foundDesktop = desktop.filter((item) => existsSync(item.path))
const foundCli = cli.filter((item) => existsSync(item.path))
check('至少找到一个 storage.json 或 CLI token', foundDesktop.length + foundCli.length > 0,
  foundDesktop.length + foundCli.length === 0
    ? '这条最关键：一个都没找到，说明目录名或 %APPDATA% 位置与插件假设不符'
    : `${foundDesktop.length} 个桌面 + ${foundCli.length} 个 CLI`)

// ---------------------------------------------------------------- 2. 账号识别
console.log('\n[2] 插件能否从中解出账号（跑真代码的诊断路径）')

// Walk the candidates in the SAME order section [1] printed, and report the
// first that actually yields credentials.
//
// Every store is pinned to ONE explicit path. That is load-bearing, not tidiness:
// `TraeCredentialStore` with no `storagePath` scans the HOST's own directories
// by `process.platform`, so on a non-Windows host it would probe a different set
// than [1] listed and its `accounts()` could resolve a credential from the
// developer's OWN machine — which is exactly how a deliberately empty HOME once
// reported "解出 1 个账号". Claiming Trae was found where none exists is the most
// misleading output this script could produce, so each candidate is resolved
// from its own path and nothing else.
const OWN_SCRATCH = join(here, '..', '.verify-windows-unused.json')

// Walk the candidates in the SAME order section [1] printed, so the report
// explains every path that was tried. Going through the store per candidate —
// rather than rescanning with a bare store — keeps parsing and decryption
// identical to the plugin's real path AND keeps every probe pinned to ONE path.
//
// That pinning is load-bearing, not tidiness: `TraeCredentialStore` with no
// `storagePath` scans the HOST's own directories by `process.platform`, so on a
// non-Windows host it would probe a different set than [1] listed and its
// `accounts()` could resolve a credential from the developer's OWN machine —
// which is exactly how a deliberately empty HOME once reported "解出 1 个账号".
// Claiming Trae was found where none exists is the most misleading output this
// script could produce, so each candidate is resolved from its own path only.
//
// This is ONE pass over the candidates. `accounts()` and `diagnose()` read the
// same files, so probing twice would double the work for no extra information.
let accounts = []
let hitPath
for (const candidate of candidates) {
  const probe = new plugin.TraeCredentialStore({
    storagePath: candidate.path,
    edition: candidate.edition,
    ownPath: OWN_SCRATCH,
    refresh: async () => { throw new Error('verify-windows: refresh not needed') },
  })
  const found = await probe.accounts().catch(() => [])
  const { failures } = await probe.diagnose()

  // One line per CANDIDATE, not per failure. A store pinned to one path answers
  // with that path probed as BOTH a desktop document and a CLI token file (an
  // override's shape is not known ahead of time — see TraeCredentialStore
  // .candidates()), so printing `failures` verbatim would list every path twice
  // and, worse, would mark the very file that DID supply the account as
  // `invalid` — once as "not a storage document", once as "not a CLI token".
  // On a machine whose only credential was just found successfully, that reads
  // like a defect. So the shapes are merged into one verdict per path, and a
  // path that produced an account is reported as resolved.
  const own = failures.filter(failure => failure.path === candidate.path)
  const sourceLabel = candidate.source === 'cli' ? 'CLI' : '桌面'
  if (found.length > 0) {
    console.log(`      ${'已解出'.padEnd(10)} [${candidate.edition}] ${maskUserPath(candidate.path)}  (${sourceLabel})`)
    if (accounts.length === 0) { accounts = found; hitPath = candidate }
    continue
  }
  // Prefer the more specific reason: `missing` is what both shapes report for an
  // absent file, so a non-missing reason means at least one shape read the file
  // and rejected its contents — which is the informative case.
  const specific = own.find(failure => failure.reason !== 'missing')
  const reason = specific?.reason ?? own[0]?.reason ?? 'missing'
  console.log(`      ${reason.padEnd(10)} [${candidate.edition}] ${maskUserPath(candidate.path)}  (${sourceLabel})`)
  if (specific?.message !== undefined) {
    // 只打印错误类型，避免把任何密文内容带出来
    console.log(`                 ${String(specific.message).slice(0, 120)}`)
  }
}

// 账号名只报形态：本脚本的输出会被贴到公开 issue，而账号名往往含真实姓名或
// 手机号（实测本机就有真实姓名与「用户<手机号>」两类）。形态足以判断「解出来了」。
check('解出至少一个账号', accounts.length > 0,
  accounts.length === 0
    ? (foundDesktop.length + foundCli.length > 0
      ? '找到了登录文件但解不出账号 —— 多半是加密 header 变了，见下'
      : '没有任何登录文件，因而不可能解出账号（与上一项一致）')
    : `${accounts.map((a) => `${describeNameShape(a.accountName)} (${a.edition}/${a.region})`).join(', ')}  ← ${maskUserPath(hitPath.path)}`)

// ---------------------------------------------------------------- 3. 身份头
console.log('\n[3] 设备指纹（这些会作为请求头发给 Trae）')

if (accounts.length > 0) {
  try {
    const { resolveTraeIdentity, readTraeCliIdentity, identityHeaders } = plugin
    // 桌面候选优先；没有则回退 CLI 候选（WSL2 / traecli 的常见形态）。
    // 两条路都走 resolveTraeIdentity——它本来就把 CLI 兜底封装在内，这里只是
    // 把它指向正确的候选，而不是自己重写一遍回退逻辑。
    const desktopCandidate = candidates.find((item) => existsSync(item.path) && item.source === 'desktop')
    const cliCandidate = candidates.find((item) => existsSync(item.path) && item.source === 'cli')
    const picked = desktopCandidate ?? cliCandidate
    if (picked === undefined) {
      console.log('    （跳过：没有可读的候选文件）')
    } else {
      // 两条路必须分开调用，不能一律交给 resolveTraeIdentity：
      // 它的 CLI 兜底只在「桌面文件**不存在**」时触发，而这里的情况是「桌面候选
      // 存在但其实是 CLI token 文件」。把它当 storage.json 解析会抛 JSON 错，
      // 那个错误不是 STORAGE_MISSING_PREFIX，于是兜底不生效、直接冒出来。
      let identity
      if (desktopCandidate === undefined) {
        console.log('    （本机只命中 CLI 候选：设备指纹走 CLI 的确定性标识，属受支持场景）')
        identity = await readTraeCliIdentity(picked.edition)
      } else {
        identity = await resolveTraeIdentity([picked], picked.edition)
      }
      const headers = identityHeaders(identity)
      console.log(`    x-device-type : ${headers['x-device-type']}`)
      console.log(`    x-os-version  : ${headers['x-os-version']}`)
      // 设备号完全不打印：它是这台机器的稳定标识，而本脚本的输出要被贴到
      // 公开 issue。形态就足以判断解析路径是否正确（真实 icube-dc 为 15 位
      // 数字，兜底哈希为 32 位十六进制）。
      const deviceId = String(headers['x-device-id'] ?? '')
      const deviceShape = describeIdShape(deviceId)
      console.log(`    x-device-id   : ${deviceShape}`)
      console.log(`    x-app-version : ${headers['x-app-version'] ?? (desktopCandidate === undefined ? '(未发送 —— CLI 候选未提供)' : '(未发送 —— product.json 没读到)')}`)
      // 这两条断言的是「本机就是 Windows」。在别的平台上跑脚本时它们必然失败，
      // 那是预期结果而非缺陷，故补一句说明，避免读者误判成兼容性问题。
      const onWindows = process.platform === 'win32'
      const platformNote = onWindows ? '' : `（当前平台是 ${process.platform}，非 Windows，此项预期失败）`
      check('x-device-type 为 windows', headers['x-device-type'] === 'windows', `${String(headers['x-device-type'])}${platformNote}`)
      check('x-os-version 以 Windows 开头', String(headers['x-os-version']).startsWith('Windows'), `${String(headers['x-os-version'])}${platformNote}`)
      check('x-device-id 非空', deviceId !== '', deviceId === '' ? '设备号为空，签到与聊天都会受影响' : deviceShape)
      // 桌面版从 product.json 取 appVersion，CLI 从 ide_version.json 取。所以
      // 「没读到」对 CLI 候选是另一件事，不能按桌面版的结论去报——否则 CLI
      // 用户会被引去查一个根本不存在的 product.json。
      const appVersionNote = headers['x-app-version'] === undefined
        ? (desktopCandidate === undefined
          ? 'CLI 候选未提供版本，不影响主流程'
          : 'product.json 路径可能不对（不影响主流程，但请回报）')
        : String(headers['x-app-version'])
      // 这一项**不算失败**：缺 x-app-version 只是少一个请求头，登录、聊天与
      // 签到都不受影响（已在上游验证过）。把它计入 failures 会让一份完全可用
      // 的机器报「未通过」，那正是最容易被误读成「Windows 不支持」的结果。
      if (headers['x-app-version'] === undefined) {
        console.log(`    [INFO] 未发送 x-app-version — ${appVersionNote}`)
      } else {
        check('读到了 x-app-version', true, appVersionNote)
      }
    }
  } catch (error) {
    check('解析设备指纹', false, String(error).slice(0, 160))
  }
} else {
  console.log('    （跳过：上一步没有解出账号，无法解析设备指纹）')
  console.log('    这一节的结论取决于 [1] 和 [2]：先把登录文件找到并解出账号，再回来看这里。')
}

// ---------------------------------------------------------------- 4. 结论
//
// 退出码反映「这台机器是否真的可用」，以便脚本能进自动化：
//   0 = 全部通过
//   1 = 有真实失败
//   2 = 未通过，但失败全部来自「不是在 Windows 上跑」——不算机器的错
//
// 区分 0/2 很重要：本脚本检查的是「Windows 上能不能读到 Trae」，所以在
// macOS / Linux 上跑，失败是必然的——那里既没有 %APPDATA%\Trae CN，平台断言
// 也不成立。一律返回 1 会让 CI 或批量巡检把这种预期失败当成真问题；一律返回 0
// 又让脚本无法用于判断。故非 Windows 主机上的失败统一记为「不适用」(2)。
const platformOnly = failures > 0 && process.platform !== 'win32'

console.log(`\n${'='.repeat(72)}`)
if (failures === 0) {
  console.log('结论：全部通过 ✅')
  console.log('  这台机器上的插件路径与设备指纹均正常。')
  console.log('  请把上面完整输出贴到 issue，即可关闭「Windows 未验证」这一项：')
  console.log('  https://github.com/dingminhua/dsh-connect-trae/issues')
} else if (platformOnly) {
  console.log('结论：未通过，但只因为当前不是 Windows（预期）')
  console.log('  平台相关的断言在非 Windows 主机上必然失败，这不代表任何东西坏了。')
  console.log('  本报告只有在该脚本于 Windows 真机上运行时才具有验收意义。')
} else {
  console.log(`结论：${failures} 项未通过 ❌`)
  if (process.platform !== 'win32') {
    console.log('  注意：当前不是 Windows，其中「平台相关」的失败属预期。')
    console.log('  本报告只有在该脚本于 Windows 真机上运行时才具有验收意义。')
  }
  console.log('  请把上面完整输出贴到 issue（本脚本不打印 token，可安全粘贴）：')
  console.log('  https://github.com/dingminhua/dsh-connect-trae/issues')
}
console.log('='.repeat(72))
process.exit(failures === 0 ? 0 : platformOnly ? 2 : 1)
