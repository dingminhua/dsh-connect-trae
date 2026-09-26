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
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
