import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { traeStorageCandidates, type TraeStorageCandidate } from './paths.ts'

const execFileAsync = promisify(execFile)

/** Basename of the SQLite cache sitting beside the credential document. */
export const TRAE_STATE_DB_FILENAME = 'state.vscdb'

export interface TraeCachedModelConfig {
  name: string
  customConfig?: Record<string, unknown>
  promptMaxTokens?: number
  maxTokens?: number
  maxTurn?: number
  multimodal?: boolean
  modelType?: string
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** Parse a safe subset of one cached model entry; credentials and endpoints are intentionally omitted. */
export function parseTraeCachedModel(value: unknown): TraeCachedModelConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw['name'] !== 'string' || raw['name'] === '') return undefined
  let customConfig: Record<string, unknown> | undefined
  if (typeof raw['custom_config'] === 'string' && raw['custom_config'] !== '') {
    try {
      const parsed = JSON.parse(raw['custom_config']) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) customConfig = parsed as Record<string, unknown>
    } catch {}
  }
  const promptMaxTokens = positive(raw['prompt_max_tokens'])
  const maxTokens = positive(raw['max_tokens'])
  const maxTurn = positive(raw['max_turn'])
  return {
    name: raw['name'],
    ...customConfig === undefined ? {} : { customConfig },
    ...promptMaxTokens === undefined ? {} : { promptMaxTokens },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...maxTurn === undefined ? {} : { maxTurn },
    ...typeof raw['multimodal'] === 'boolean' ? { multimodal: raw['multimodal'] } : {},
    ...typeof raw['model_type'] === 'string' ? { modelType: raw['model_type'] } : {},
  }
}

export interface TraeCachedModelReadOptions {
  /** Platform override for testing; defaults to process.platform. */
  platform?: NodeJS.Platform
  /** Home-directory override for testing; defaults to homedir(). */
  home?: string
  /** Environment override for testing; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  /**
   * The credential candidate whose account is being read. Supplying it pins the
   * lookup to the installation the credential actually came from, which is the
   * only way to stay correct when several editions are installed: `storage.json`
   * and `state.vscdb` live in the SAME `globalStorage` directory, so the cache
   * belongs to whichever candidate yielded the sign-in.
   */
  candidate?: TraeStorageCandidate
  /** Injectable for tests; defaults to node:fs existsSync. */
  exists?: (path: string) => boolean
  /**
   * Injectable `sqlite3` runner for tests; defaults to promisified `execFile`.
   * Mirrors the `fetchImpl` injection used elsewhere in this plugin, and exists
   * so a test can assert the exact argv — in particular WHICH database path was
   * chosen, which no assertion on the candidate list alone can prove.
   */
  runSqlite?: (database: string, sql: string) => Promise<{ stdout: string }>
}

/**
 * The cache paths to try, most-specific first.
 *
 * `state.vscdb` is a SIBLING of the credential document (both sit in
 * `globalStorage`), so a candidate's own path is the authority for its cache —
 * this is why the database is derived from {@link traeStorageCandidates} rather
 * than re-spelled here.
 *
 * It previously hardcoded the single macOS spelling `Trae CN`, which was wrong
 * in two ways on Windows: `paths.ts` probes `Trae CN` AND `trae-cn`, and the
 * edition actually installed is often SOLO (`TRAE SOLO CN`). This module would
 * then point at a directory that does not exist. That went unnoticed only
 * because the Windows `sqlite3` dependency is absent, so the lookup failed and
 * callers fell back — masking the wrong path behind a different error. Sharing
 * one path table means a spelling that works for sign-in also works for the
 * cache.
 */
export function traeStateDatabaseCandidates(options: TraeCachedModelReadOptions = {}): string[] {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const paths: string[] = []
  const push = (storagePath: string): void => {
    const database = join(dirname(storagePath), TRAE_STATE_DB_FILENAME)
    // Windows file systems are case-insensitive, so two spellings can be one
    // directory; probing it twice would be a wasted `stat` and a duplicated
    // entry in any diagnostic built from this list.
    if (!paths.some(existing => existing.toLowerCase() === database.toLowerCase())) paths.push(database)
  }
  // The candidate behind the credential wins outright: it is the installation
  // the account came from, not a guess.
  if (options.candidate !== undefined && options.candidate.source === 'desktop') push(options.candidate.path)
  for (const candidate of traeStorageCandidates(platform, home, env)) {
    if (candidate.source !== 'desktop') continue
    // A pinned candidate restricts the scan to its own edition: mixing in the
    // other editions' directories could read a DIFFERENT account's model map.
    if (options.candidate !== undefined && candidate.edition !== options.candidate.edition) continue
    push(candidate.path)
  }
  return paths
}

/**
 * Read Trae's own current user's model map via sqlite3 without exposing
 * secrets. The sqlite3 command line is a macOS prerequisite; on Windows it is
 * typically absent, so the call fails and callers fall back gracefully.
 *
 * Every candidate database is tried in order and the first that EXISTS is
 * queried. Existence is checked before spawning because a missing file and a
 * missing `sqlite3` binary are different problems: choosing the wrong directory
 * would otherwise surface as a confusing `sqlite3` failure, hiding a path bug
 * behind a dependency error.
 */
export async function readTraeCachedModel(
  functionName: string,
  modelName: string,
  userId: string,
  options: TraeCachedModelReadOptions = {},
): Promise<TraeCachedModelConfig | undefined> {
  const exists = options.exists ?? existsSync
  const databases = traeStateDatabaseCandidates(options)
  // Destructure rather than indexing twice: `noUncheckedIndexedAccess` types
  // `databases[0]` as `string | undefined`, so the emptiness check and the
  // fallback have to be expressed through one narrowing the compiler accepts.
  const fallback = databases[0]
  if (fallback === undefined) throw new Error('trae: no desktop storage candidate to locate the model cache from')
  // Prefer a database that exists; when none does, query the most likely path so
  // the caller sees the real `sqlite3` failure rather than a guessed one.
  const database = databases.find(candidate => exists(candidate)) ?? fallback
  const key = `${userId}_AI.agent.model.model_list_map`
  const sql = `select value from ItemTable where key=${JSON.stringify(key)} limit 1;`
  const runSqlite = options.runSqlite
    ?? ((db: string, statement: string) => execFileAsync('sqlite3', [db, statement], { maxBuffer: 8 * 1024 * 1024 }))
  const { stdout } = await runSqlite(database, sql)
  const document = JSON.parse(stdout) as Record<string, unknown>
  const list = Array.isArray(document[functionName]) ? document[functionName] as unknown[] : []
  return parseTraeCachedModel(list.find(item => typeof item === 'object' && item !== null && (item as { name?: unknown }).name === modelName))
}
