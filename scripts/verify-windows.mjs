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

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))

/** 定位插件入口：优先脚本同级的构建产物，其次已安装的 npm 包。 */
function loadPlugin() {
  const local = join(here, '..', 'lib', 'index.js')
  if (existsSync(local)) return import(local)
  return import('dsh-connect-trae')
}

const ok = (yes) => (yes ? 'OK  ' : 'FAIL')
let failures = 0
function check(label, passed, detail = '') {
  if (!passed) failures += 1
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

const store = new plugin.TraeCredentialStore({
  refresh: async () => { throw new Error('verify-windows: refresh not needed') },
})
const diagnosed = await store.diagnose()
console.log(`    探测了 ${diagnosed.tried.length} 条候选，其中 ${diagnosed.failures.length} 条失败：`)
for (const failure of diagnosed.failures) {
  // 失败原因是安全信息（missing / unreadable / invalid），message 可能出现路径
  console.log(`      ${failure.reason.padEnd(10)} [${failure.edition}] ${maskUserPath(failure.path)}`)
  if (failure.message !== undefined) {
    // 只打印错误类型，避免把任何密文内容带出来
    console.log(`                 ${String(failure.message).slice(0, 120)}`)
  }
}

const accounts = await store.accounts()
// 账号名只报形态：本脚本的输出会被贴到公开 issue，而账号名往往含真实姓名或
// 手机号（实测本机就有真实姓名与「用户<手机号>」两类）。形态足以判断「解出来了」。
check('解出至少一个账号', accounts.length > 0,
  accounts.length === 0
    ? '目录找到了但解不出账号 —— 多半是加密 header 变了，见下'
    : accounts.map((a) => `${describeNameShape(a.accountName)} (${a.edition}/${a.region})`).join(', '))

// ---------------------------------------------------------------- 3. 身份头
console.log('\n[3] 设备指纹（这些会作为请求头发给 Trae）')

if (accounts.length > 0) {
  try {
    const { resolveTraeIdentity, identityHeaders } = plugin
    const first = candidates.find((item) => existsSync(item.path) && item.source === 'desktop')
    if (first !== undefined) {
      const identity = await resolveTraeIdentity([first], first.edition)
      const headers = identityHeaders(identity)
      console.log(`    x-device-type : ${headers['x-device-type']}`)
      console.log(`    x-os-version  : ${headers['x-os-version']}`)
      // 设备号完全不打印：它是这台机器的稳定标识，而本脚本的输出要被贴到
      // 公开 issue。形态就足以判断解析路径是否正确（真实 icube-dc 为 15 位
      // 数字，兜底哈希为 32 位十六进制）。
      const deviceId = String(headers['x-device-id'] ?? '')
      const deviceShape = describeIdShape(deviceId)
      console.log(`    x-device-id   : ${deviceShape}`)
      console.log(`    x-app-version : ${headers['x-app-version'] ?? '(未发送 —— product.json 没读到)'}`)
      // 这两条断言的是「本机就是 Windows」。在别的平台上跑脚本时它们必然失败，
      // 那是预期结果而非缺陷，故补一句说明，避免读者误判成兼容性问题。
      const onWindows = process.platform === 'win32'
      const platformNote = onWindows ? '' : `（当前平台是 ${process.platform}，非 Windows，此项预期失败）`
      check('x-device-type 为 windows', headers['x-device-type'] === 'windows', `${String(headers['x-device-type'])}${platformNote}`)
      check('x-os-version 以 Windows 开头', String(headers['x-os-version']).startsWith('Windows'), `${String(headers['x-os-version'])}${platformNote}`)
      check('x-device-id 非空', deviceId !== '', deviceId === '' ? '设备号为空，签到与聊天都会受影响' : deviceShape)
      check('读到了 x-app-version', headers['x-app-version'] !== undefined,
        headers['x-app-version'] === undefined ? 'product.json 路径可能不对（不影响主流程，但请回报）' : String(headers['x-app-version']))
    }
  } catch (error) {
    check('解析设备指纹', false, String(error).slice(0, 160))
  }
} else {
  console.log('    （跳过：上一步没有解出账号）')
}

// ---------------------------------------------------------------- 4. 结论
console.log(`\n${'='.repeat(72)}`)
if (failures === 0) {
  console.log('结论：全部通过 ✅')
  console.log('  这台机器上的插件路径与设备指纹均正常。')
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
