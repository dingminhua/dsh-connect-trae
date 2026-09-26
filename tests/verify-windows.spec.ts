/**
 * The Windows verification script must describe the SAME machine the plugin
 * would use — and must never claim Trae was found where it was not.
 *
 * WHY THIS FILE EXISTS — read before weakening it:
 * `scripts/verify-windows.mjs` is the ONLY evidence path for the project's
 * outstanding "does this work on a real Windows machine?" question, and its
 * report is meant to be pasted into a public issue and believed. Two failure
 * modes make it worse than useless, and both were observed during development:
 *
 *  1. FALSE POSITIVE — a deliberately empty HOME reported "解出 1 个账号",
 *     because `TraeCredentialStore` with no pinned path scans the HOST's own
 *     directories by `process.platform`. On macOS that meant the report claimed
 *     a Windows machine had a Trae login it did not have.
 *  2. SILENT WRONG SOURCE — section [1] listed win32 candidate paths while
 *     section [2] scanned the host platform's paths, so the two sections could
 *     describe different machines.
 *
 * The assertions below therefore pin down both properties: an empty environment
 * yields NO account, and each candidate is resolved from its OWN path.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { TraeCredentialStore, traeStorageCandidates } from '../src/index.ts'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

/** A store pinned to one candidate, exactly as the script builds it. */
function storeFor(path: string, edition: string, ownPath: string): TraeCredentialStore {
  return new TraeCredentialStore({
    storagePath: path,
    edition: edition as never,
    ownPath,
    refresh: async () => { throw new Error('unused') },
  })
}

describe('Windows verification: candidate resolution', () => {
  it('finds no account when none of the candidate files exist', async () => {
    // The false-positive guard. A pinned store must answer from ITS path only:
    // if it ever falls back to scanning the host, this returns the developer's
    // own credentials and the report becomes a lie.
    const root = await mkdtemp(join(tmpdir(), 'trae-empty-')); cleanup.push(root)
    const candidates = traeStorageCandidates('win32', root, { APPDATA: join(root, 'Roaming') })
    for (const candidate of candidates) {
      const store = storeFor(candidate.path, candidate.edition, join(root, 'own.json'))
      await expect(store.accounts()).resolves.toEqual([])
    }
  })

  it('reports each candidate as missing, never as a resolved account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-empty-')); cleanup.push(root)
    const candidates = traeStorageCandidates('win32', root, { APPDATA: join(root, 'Roaming') })
    const first = candidates[0]
    if (first === undefined) throw new Error('win32 must yield at least one candidate')
    const store = storeFor(first.path, first.edition, join(root, 'own.json'))
    const { failures } = await store.diagnose()
    // Every probed path is absent; none may be reported as valid.
    expect(failures.length).toBeGreaterThan(0)
    expect(failures.every(failure => failure.reason === 'missing')).toBe(true)
  })

  it('resolves the alternate spelling a Windows machine may actually use', async () => {
    // This is the property the whole script exists to check: whichever spelling
    // the real machine has, a store pinned to THAT path must read it. The
    // fixture is synthetic — the point is that the lowercase spelling resolves.
    const root = await mkdtemp(join(tmpdir(), 'trae-win-')); cleanup.push(root)
    const storage = join(root, 'Roaming', 'trae-cn', 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'Roaming', 'trae-cn', 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, '{}')

    const candidates = traeStorageCandidates('win32', root, { APPDATA: join(root, 'Roaming') })
    const lowercase = candidates.find(item => item.path === storage)
    expect(lowercase, 'the lowercase spelling must be among the probed candidates').toBeDefined()

    const store = storeFor(storage, lowercase?.edition ?? 'cn', join(root, 'own.json'))
    // The file exists but holds no credential: the store must say "unreadable/
    // invalid", NOT invent an account and NOT reach for another path.
    await expect(store.accounts()).resolves.toEqual([])
  })

  it('never probes the same Windows directory twice under different casing', () => {
    // Windows file systems are case-insensitive, so a duplicate here would show
    // the same directory twice in the report and double every probe.
    const candidates = traeStorageCandidates('win32', 'C:/home', { APPDATA: 'C:/Roaming' })
    const paths = candidates.map(item => item.path.toLowerCase())
    expect(new Set(paths).size).toBe(paths.length)
  })
})

/**
 * The script must be RUNNABLE, which the tests above cannot show: they exercise
 * `src/` while the script is a separate `.mjs` entry point that CI never
 * executes (`.github/workflows/ci.yml` runs typecheck, tests, and build — not
 * this script). That gap is exactly how a fatal startup bug shipped in 2.3.1:
 * `loadPlugin()` did `import(join(here, '..', 'lib', 'index.js'))`, passing a
 * bare Windows path where a URL is required. Node parsed `C:\...` as the URL
 * scheme `c:` and threw ERR_UNSUPPORTED_ESM_URL_SCHEME — on Windows, the one
 * platform the script exists to verify, before a single check ran.
 *
 * WHY A CHILD PROCESS AND A FAKE `lib/`: the point is to execute the script's
 * REAL startup path on an ABSOLUTE path, so the test must not depend on this
 * checkout having been built (lib/ is gitignored, and CI builds *after*
 * testing). So the script is copied to a temp directory beside a stub
 * `lib/index.js`, which makes `existsSync(local)` true and forces exactly the
 * branch that crashed. A stub is sufficient because the failure happened at
 * module resolution, before any real logic was reached.
 */
describe('Windows verification: the script actually runs', () => {
  it('starts on an absolute script path instead of crashing in the ESM loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-script-')); cleanup.push(root)
    await mkdir(join(root, 'lib'), { recursive: true })
    await mkdir(join(root, 'scripts'), { recursive: true })

    // Minimal surface the script touches before it reaches its conclusion.
    // `traeStorageCandidates` returns nothing on purpose: an empty machine is
    // the simplest input that still walks the whole report path.
    await writeFile(join(root, 'lib', 'index.js'), [
      'export const maskUserPath = (p) => String(p)',
      "export const describeNameShape = (n) => `${String(n ?? '').length} 字符`",
      "export const describeIdShape = (v) => `${String(v ?? '').length} 位`",
      'export const traeStorageCandidates = () => []',
      'export class TraeCredentialStore {',
      '  async diagnose() { return { tried: [], failures: [] } }',
      '  async accounts() { return [] }',
      '}',
      'export const resolveTraeIdentity = async () => ({})',
      'export const readTraeCliIdentity = async () => ({})',
      'export const identityHeaders = () => ({})',
    ].join('\n'))

    // Resolved from this module's own URL rather than `__dirname`: the tests are
    // ESM, where `__dirname` does not exist.
    const scriptUrl = new URL('../scripts/verify-windows.mjs', import.meta.url)
    const script = await readFile(fileURLToPath(scriptUrl), 'utf8')
    const copied = join(root, 'scripts', 'verify-windows.mjs')
    await writeFile(copied, script)

    const run = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      // `stdio: ['ignore', 'pipe', 'pipe']` is stated explicitly: the default
      // `'pipe'` for all three streams makes the overload return a type whose
      // `stdin` conflicts across candidates, which tsc collapses to `never`.
      const child = spawn(process.execPath, [copied], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk) })
      child.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }))
    })

    // The regression's signature: the loader rejects the path instead of the
    // script reporting anything. Asserting on the code as well as the message
    // keeps this diagnostic if Node ever rewords the error.
    expect(run.stderr).not.toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME')
    expect(run.stderr).not.toContain('Only URLs with a scheme in')

    // It must get all the way to a verdict, not merely avoid that one error.
    expect(run.stdout).toContain('dsh-connect-trae · Windows 真机验证')
    expect(run.stdout).toContain('结论：')
    // An empty machine is a legitimate FAILURE (0 candidates found), so the
    // exit code is deliberately not asserted here — what matters is that the
    // run reached a conclusion rather than dying in the loader.
    expect(run.code).not.toBe(-1)
  })
})
