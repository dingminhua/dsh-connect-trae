import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { parseTraeCachedModel, readTraeCachedModel, traeStateDatabaseCandidates, TRAE_STATE_DB_FILENAME } from '../src/model-cache.ts'
import { traeStorageCandidates } from '../src/paths.ts'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('Trae cached model config', () => {
  it('keeps only safe prompt/model fields and parses custom_config', () => {
    expect(parseTraeCachedModel({
      name: 'qwen-3.7-plus', multimodal: true, model_type: 'reasoning_model',
      custom_config: '{"native_function_call":true,"use_v2_process":true}',
      prompt_max_tokens: 168000, max_tokens: 32000, max_turn: 500,
      ak: 'must-not-leak', base_url: 'must-not-leak', icon: { dark: 'must-not-leak' },
    })).toEqual({
      name: 'qwen-3.7-plus', multimodal: true, modelType: 'reasoning_model',
      customConfig: { native_function_call: true, use_v2_process: true },
      promptMaxTokens: 168000, maxTokens: 32000, maxTurn: 500,
    })
  })

  it('does not invent invalid or missing values', () => {
    expect(parseTraeCachedModel({ name: 'm', custom_config: '{bad', max_tokens: 0 })).toEqual({ name: 'm' })
    expect(parseTraeCachedModel({})).toBeUndefined()
  })
})

/**
 * The cached model map lives in the SAME `globalStorage` directory as the
 * credential document, so its path must be derived from the credential path
 * table rather than spelled out again.
 *
 * WHY THESE ASSERTIONS EXIST — this was a real defect, not a hypothetical:
 * `readTraeCachedModel` hardcoded the single macOS spelling `Trae CN` for its
 * `state.vscdb` path. On Windows that is wrong twice over — `paths.ts` probes
 * `Trae CN` AND `trae-cn`, and the installed edition is frequently SOLO
 * (`TRAE SOLO CN`). On a real SOLO machine the hardcoded path did not exist at
 * all. It went unnoticed because the Windows `sqlite3` dependency is absent, so
 * the lookup failed and callers fell back: one wrong path hidden behind a
 * different, plausible-looking error.
 *
 * The general lesson these tests encode: when a second path is derived from an
 * existing path, assert it against the ORIGINAL table. A test that hardcodes
 * the expected spelling too would have agreed with the bug.
 */
describe('Trae cached model database path', () => {
  it('is a sibling of the credential document, not a re-spelled path', () => {
    // The load-bearing property: for every credential candidate, the database
    // candidate is that same directory + state.vscdb. If this holds, a spelling
    // that works for sign-in works for the cache by construction.
    const storage = traeStorageCandidates('win32', 'C:/home', { APPDATA: 'C:/Roaming' })
    const databases = traeStateDatabaseCandidates({ platform: 'win32', home: 'C:/home', env: { APPDATA: 'C:/Roaming' } })
    const expected = storage
      .filter(candidate => candidate.source === 'desktop')
      .map(candidate => candidate.path.replace(/storage\.json$/, TRAE_STATE_DB_FILENAME))
    for (const path of expected) {
      expect(databases, `${path} must be probeable`).toContain(path)
    }
  })

  it('finds the SOLO edition directory on Windows, which the hardcoded spelling missed', () => {
    // The exact regression: `TRAE SOLO CN` is the measured real directory name
    // on a Windows host, and the old code could never address it.
    const databases = traeStateDatabaseCandidates({ platform: 'win32', home: 'C:/home', env: { APPDATA: 'C:/Roaming' } })
    expect(databases.some(path => path.includes('TRAE SOLO CN'))).toBe(true)
    // Both spellings of the CN edition, since the real one is unconfirmed.
    expect(databases.some(path => path.includes('Trae CN'))).toBe(true)
    expect(databases.some(path => path.includes('trae-cn'))).toBe(true)
  })

  it('probes a pinned candidate’s own database first and stays inside its edition', () => {
    // A pinned candidate IS the installation the account came from, so its
    // cache wins outright. Restricting to its edition matters: reading another
    // edition's database could return a different account's model map.
    const candidate = traeStorageCandidates('win32', 'C:/home', { APPDATA: 'C:/Roaming' })
      .find(item => item.source === 'desktop' && item.edition === 'solo')
    if (candidate === undefined) throw new Error('win32 must yield a solo desktop candidate')
    const databases = traeStateDatabaseCandidates({
      platform: 'win32', home: 'C:/home', env: { APPDATA: 'C:/Roaming' }, candidate,
    })
    expect(databases[0]).toBe(candidate.path.replace(/storage\.json$/, TRAE_STATE_DB_FILENAME))
    // Every remaining entry is still this edition's.
    const soloPaths = traeStorageCandidates('win32', 'C:/home', { APPDATA: 'C:/Roaming' })
      .filter(item => item.source === 'desktop' && item.edition === 'solo')
      .map(item => item.path.replace(/storage\.json$/, TRAE_STATE_DB_FILENAME))
    for (const path of databases) expect(soloPaths).toContain(path)
  })

  it('never lists the same database twice under different casing', () => {
    // Windows is case-insensitive, so `Trae CN` and `trae cn` are one directory.
    // A duplicate would waste a stat and duplicate any diagnostic built from it.
    const databases = traeStateDatabaseCandidates({ platform: 'win32', home: 'C:/home', env: { APPDATA: 'C:/Roaming' } })
    const lowered = databases.map(path => path.toLowerCase())
    expect(new Set(lowered).size).toBe(lowered.length)
  })

  it('derives macOS and Linux paths from their own credential tables', () => {
    // Cross-platform: the same sibling relation must hold where the credential
    // table differs, so this cannot be a Windows-only fix.
    //
    // Separators are normalised before asserting. `join()` emits the HOST's
    // separator, so on Windows these paths come back with backslashes even
    // though they describe macOS and Linux — comparing raw strings would make
    // this test pass on the author's machine and fail on CI's Windows runner
    // (which is how it was caught).
    const slashes = (value: string): string => value.replace(/\\/g, '/')
    const darwin = traeStateDatabaseCandidates({ platform: 'darwin', home: '/Users/x', env: {} }).map(slashes)
    expect(darwin.some(path => path.includes('Library/Application Support') && path.endsWith(TRAE_STATE_DB_FILENAME))).toBe(true)
    const linux = traeStateDatabaseCandidates({ platform: 'linux', home: '/home/x', env: {} }).map(slashes)
    expect(linux.some(path => path.startsWith('/home/x/.config') && path.endsWith(TRAE_STATE_DB_FILENAME))).toBe(true)
  })
})

/**
 * A candidate list that is merely CORRECT is not enough: the chosen path has to
 * be the one actually handed to `sqlite3`. Every test above would still pass if
 * `readTraeCachedModel` built a good list and then queried the wrong entry, so
 * this asserts on the argv that reaches the runner.
 */
describe('Trae cached model database selection', () => {
  it('queries the database that exists, not merely the first candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-db-')); cleanup.push(root)
    // A REAL file stands in for state.vscdb so `existsSync` sees it; the runner
    // is injected, so nothing ever tries to open it as a database.
    const exists = join(root, 'TRAE SOLO CN', 'User', 'globalStorage', TRAE_STATE_DB_FILENAME)
    await mkdir(dirname(exists), { recursive: true })
    await writeFile(exists, 'not-a-real-database')
    // The path the OLD implementation would have used: absent on this machine.
    const absent = join(root, 'Trae CN', 'User', 'globalStorage', TRAE_STATE_DB_FILENAME)

    const calls: { database: string; sql: string }[] = []
    const result = await readTraeCachedModel('solo_agent', 'qwen', 'u1', {
      platform: 'win32',
      home: root,
      env: { APPDATA: join(root, 'Roaming') },
      candidate: { edition: 'solo', source: 'desktop', path: join(root, 'TRAE SOLO CN', 'User', 'globalStorage', 'storage.json') },
      runSqlite: async (database, sql) => {
        calls.push({ database, sql })
        return { stdout: JSON.stringify({ solo_agent: [{ name: 'qwen', max_tokens: 32000 }] }) }
      },
    })

    expect(calls.length).toBe(1)
    expect(calls[0]?.database).toBe(exists)
    expect(calls[0]?.database).not.toBe(absent)
    // The key is account-scoped; a wrong key silently yields no rows.
    expect(calls[0]?.sql).toContain('u1_AI.agent.model.model_list_map')
    expect(result).toMatchObject({ name: 'qwen', maxTokens: 32000 })
  })

  it('falls back to the first candidate when none exists, rather than skipping the read', async () => {
    // When nothing exists the cause is the environment (absent install, or an
    // absent `sqlite3`), and the caller must still see that real failure — not
    // a silently empty result that would look like "model has no cache".
    const root = await mkdtemp(join(tmpdir(), 'trae-db-')); cleanup.push(root)
    const calls: string[] = []
    await expect(readTraeCachedModel('solo_agent', 'qwen', 'u1', {
      platform: 'win32',
      home: root,
      env: { APPDATA: join(root, 'Roaming') },
      runSqlite: async (database) => {
        calls.push(database)
        throw Object.assign(new Error('spawn sqlite3 ENOENT'), { code: 'ENOENT' })
      },
    })).rejects.toThrow(/ENOENT/)
    expect(calls.length).toBe(1)
  })
})
