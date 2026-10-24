/**
 * The account pool's RUNTIME store: measured facts, on disk, outside settings.
 *
 * 参考：`dsh-connect-workbuddy` 的 `src/account-pool-store.ts`，以及本仓库
 *   `src/auth.ts` 的插件自有文件约定（`$DSH_HOME` 下的 `.trae-auth.<region>.json`，
 *   `withFileLock` + `writeFileAtomic`，`mode: 0o600`）。
 * 改动：一份、按**面板**分文件（cn / enterprise / ai），因为 enterprise 与 cn 共用
 *   同一份凭据却走不同的网关 —— 一个账号在个人 SOLO 通道能用，完全不说明它过得了
 *   租户门（`4019` 只在第一次真实对话时暴露），所以两份测量必须分开落盘。
 *
 * 为什么这些事实不放 settings（`regions[panel].pool`）：
 *
 *   卡片对用户偏好用的是「草稿 → 保存 → 丢弃草稿」模式：保存成功会丢弃草稿。
 *   如果探测结果也住在那个槽里，用户手工点一次「保存」就会用**几分钟前的草稿**
 *   覆盖掉刚刚写进去的测量结果 —— 那等于把测量回退，测试白做。
 *   观测数据由插件高频写入、且不是用户偏好，所以它必须落在自己的文件里。
 *
 * 本模块的读写**从不抛异常给调用方**：池是增强功能，一个损坏的观测文件绝不能让
 * 卡片或 host 启动失败 —— 最坏情况是「回到未测试」，而不是整个插件不可用。
 *
 * @module dsh-connect-trae/account-pool-store
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome as resolveHome } from '@deepseek-ai/dsh-home-paths'
import { parseUpstreamResetAt } from './reset-time.ts'
import type { TraePoolProbe, TraePoolProbeSource } from './account-pool.ts'
import type { TraePanel } from './region.ts'

/** On-disk format version; readers reject anything else. */
const STORE_FORMAT_VERSION = 1

/** Filename prefix for one panel's measured pool facts. */
const POOL_STORE_PREFIX = '.trae-pool'

/** The document actually written to disk. */
interface PoolDocument {
  version: typeof STORE_FORMAT_VERSION
  /** Account id → its most recent measurement of the panel's target model. */
  probes: Record<string, TraePoolProbe>
}

/** Whether a parsed value looks like a stored probe. */
function isProbe(value: unknown): value is TraePoolProbe {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['outcome'] === 'string'
    && typeof candidate['atMs'] === 'number'
    && (candidate['retryAtMs'] === undefined || typeof candidate['retryAtMs'] === 'number')
    && (candidate['message'] === undefined || typeof candidate['message'] === 'string')
    // The display name a measurement observed. Accepted only as a string: it is
    // the one field here that reaches the card as a LABEL, so a non-string (a
    // number id, an object) must not survive into the UI as `[object Object]`.
    && (candidate['accountName'] === undefined || typeof candidate['accountName'] === 'string')
    // WHICH MODEL the measurement was taken on. Validated as a string for the
    // same reason as `accountName`. Its READ-BACK was the corruption bug in the
    // reference implementation: a field dropped on read is erased on the next
    // write, because write merges into what read returned.
    && (candidate['modelId'] === undefined || typeof candidate['modelId'] === 'string')
    // A source this build does not recognise is DROPPED, not rejected: refusing
    // the whole record would silently discard a real measurement written by a
    // newer build, whereas dropping only the label leaves the measurement intact
    // and reads as its documented "unknown".
    && (candidate['source'] === undefined || typeof candidate['source'] === 'string')
}

/**
 * One panel's path for measured pool facts.
 *
 * Panel-keyed for the same reason the credential copies are region-keyed: the
 * panels are parallel stacks and must never overwrite each other's measurements.
 */
export function traePoolStorePath(panel: TraePanel): string {
  return join(resolveHome(), `${POOL_STORE_PREFIX}.${panel}.json`)
}

/**
 * The recovery time a stored record implies — declared, or recoverable from its
 * own body.
 *
 * The field itself wins when present: it is what the writer computed with the
 * full input set, and re-deriving it could only lose information.
 *
 * The fallback exists because a record can state a time in its `message` and
 * still have no `retryAtMs`. Read-time healing is the only place this can be
 * repaired for EXISTING records: every consumer receives probes through
 * {@link readTraePoolProbes}, so healing here fixes all of them at once. Re-
 * deriving at each consumer instead would be several copies of one rule, and the
 * next consumer added would silently miss it.
 *
 * Not a permanent second derivation: {@link writeTraePoolProbes} reads through
 * this function before it writes, so the very next write persists the healed
 * value.
 *
 * Scoped to the two outcomes whose vocabulary HAS a stated time. Widening it
 * would let an incidental sentence in an `ok` body attach a countdown to a
 * healthy account — the card prints any present `retryAtMs` beside the outcome,
 * so that would render a waiting time on an account waiting for nothing.
 */
function retryAtMsOf(probe: TraePoolProbe): number | undefined {
  if (probe.retryAtMs !== undefined) return probe.retryAtMs
  if (probe.outcome !== 'rate-limited' && probe.outcome !== 'out-of-credit') return undefined
  if (probe.message === undefined) return undefined
  return parseUpstreamResetAt(probe.message)
}

/**
 * Read one panel's measured facts.
 *
 * Contains NO credentials. The one free-text field is `message`, and it is
 * REDACTED BY THE WRITER before it ever reaches this file, so a token-shaped
 * string cannot survive into storage.
 *
 * Returns an empty map for a missing, unreadable, malformed, or
 * version-mismatched file: all four mean "nothing measured yet", which is a valid
 * state the pool renders as "untested".
 */
export async function readTraePoolProbes(
  panel: TraePanel,
): Promise<Record<string, TraePoolProbe>> {
  let raw: string
  try {
    raw = await readFile(traePoolStorePath(panel), 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const document = parsed as Partial<PoolDocument>
  if (document.version !== STORE_FORMAT_VERSION) return {}
  if (typeof document.probes !== 'object' || document.probes === null) return {}
  const probes: Record<string, TraePoolProbe> = {}
  for (const [accountId, probe] of Object.entries(document.probes)) {
    if (accountId === '' || !isProbe(probe)) continue
    const retryAtMs = retryAtMsOf(probe)
    const source = knownProbeSource(probe.source)
    probes[accountId] = {
      outcome: probe.outcome,
      atMs: probe.atMs,
      ...source === undefined ? {} : { source },
      ...retryAtMs === undefined ? {} : { retryAtMs },
      ...probe.message === undefined ? {} : { message: probe.message },
      ...probe.accountName === undefined ? {} : { accountName: probe.accountName },
      ...probe.modelId === undefined ? {} : { modelId: probe.modelId },
    }
  }
  return probes
}

/**
 * A stored source string reduced to a source this build understands.
 *
 * `isProbe` accepts any string so a newer build's label cannot destroy the
 * measurement it describes; this narrows it at the point of use. An unknown value
 * becomes `undefined`, which the card renders as "unknown" — the honest answer,
 * rather than mislabelling it as one of the two kinds we do know.
 */
function knownProbeSource(value: unknown): TraePoolProbeSource | undefined {
  return value === 'test-batch' || value === 'live-request' ? value : undefined
}

/**
 * Merge ONE new measurement over the record already stored for that account.
 *
 * A plain `{ ...existing, ...update }` is wrong here, and the damage is silent.
 * The two writers describe the same account at different moments and carry
 * different fields:
 *
 *   - `test-batch` measures the TARGET MODEL deliberately, so it is the writer
 *     that can produce a reset point (`retryAtMs`) parsed out of the upstream's
 *     own failure body.
 *   - `live-request` reports what a real chat request just hit. It often carries
 *     no `retryAtMs` at all (a transport blip names no time), and a spread would
 *     therefore DELETE the reset point the probe had already resolved.
 *
 * Measured consequence of the spread (reference implementation, a real
 * quota-exhausted account): the probe recorded "quota refreshes 2026-11-01", the
 * next live failure rewrote the record without that field, and the pool then
 * reported "retry in about 30 minutes" — putting an exhausted account back into
 * rotation to be refused again. The correct value was in the file one write
 * earlier.
 *
 * So `retryAtMs` is INHERITED when the update does not state one, and every other
 * field is the update's (the newer measurement owns `outcome`, `atMs`, `source`
 * and `message`). Inheriting is only about the one field whose absence is not a
 * statement: an update that DOES carry a time still overrides, which is what lets
 * a fresh, shorter cooldown supersede a stale longer one.
 *
 * `accountName` is INHERITED for the same reason: its absence is not a statement.
 * A writer that could not see the account must not erase the name an earlier
 * measurement DID see — that name is the only thing that can identify a member
 * whose sign-in has gone.
 *
 * `modelId` is deliberately NOT inherited (see the field note in
 * `account-pool.ts`): it describes THIS measurement, not the account.
 *
 * Pure and exported so the rule is unit-testable without a filesystem — this is
 * exactly the kind of "two writers, one slot" rule that bites silently.
 */
export function mergePoolProbe(
  existing: TraePoolProbe | undefined,
  update: TraePoolProbe,
): TraePoolProbe {
  if (existing === undefined) return update
  const merged = update.accountName === undefined && existing.accountName !== undefined
    ? { ...update, accountName: existing.accountName }
    : update
  if (update.retryAtMs !== undefined) return merged
  // A stored time that has already PASSED is not worth inheriting: carrying it
  // forward would date the record to a moment in the past and make the row read
  // as "back after <a time that is already gone>".
  if (existing.retryAtMs === undefined || existing.retryAtMs <= update.atMs) return merged
  return { ...merged, retryAtMs: existing.retryAtMs }
}

/**
 * Merge measurements into one panel's store and write it atomically.
 *
 * A MERGE rather than a replace, because batches measure one account at a time and
 * a partial failure must not erase what earlier runs learned. An account absent
 * from `updates` keeps its previous measurement, and an account present in both is
 * combined by {@link mergePoolProbe} rather than overwritten.
 *
 * Never throws: a failed write loses only the newest measurements, and the
 * caller's results are still returned to the user. Surfacing a disk error here
 * would fail an operation that actually succeeded.
 */
export async function writeTraePoolProbes(
  panel: TraePanel,
  updates: Readonly<Record<string, TraePoolProbe>>,
): Promise<void> {
  if (Object.keys(updates).length === 0) return
  const path = traePoolStorePath(panel)
  try {
    await withFileLock(path, async () => {
      const existing = await readTraePoolProbes(panel)
      const merged: Record<string, TraePoolProbe> = { ...existing }
      for (const [accountId, update] of Object.entries(updates)) {
        merged[accountId] = mergePoolProbe(existing[accountId], update)
      }
      const document: PoolDocument = {
        version: STORE_FORMAT_VERSION,
        probes: merged,
      }
      await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, {
        mode: 0o600,
        dirMode: 0o700,
      })
    })
  } catch {
    // Deliberately swallowed; see the function note. The pool degrades to
    // "measured a moment ago, but not remembered", never to a failed action.
  }
}

/**
 * Forget one account's measurement, keeping every other row.
 *
 * Used when the user removes a pool member: its measurement is no longer about a
 * member, and leaving it in the file would resurrect a stale `rate-limited` row if
 * the account were added back later. Written through the same lock/atomic path so a
 * removal cannot interleave with a batch.
 *
 * The READ also sits inside the lock, like {@link writeTraePoolProbes}'s: a
 * delete is a read-modify-write, and a read taken outside the lock snapshots a
 * moment that a concurrent batch's write can then be older than — the delete
 * would write that stale snapshot back and silently discard the measurements
 * the batch had just learned.
 */
export async function dropTraePoolProbe(panel: TraePanel, accountId: string): Promise<void> {
  const path = traePoolStorePath(panel)
  await withFileLock(path, async () => {
    const existing = await readTraePoolProbes(panel)
    if (existing[accountId] === undefined) return
    const probes: Record<string, TraePoolProbe> = {}
    for (const [id, probe] of Object.entries(existing)) {
      if (id !== accountId) probes[id] = probe
    }
    await writeFileAtomic(path, `${JSON.stringify({ version: STORE_FORMAT_VERSION, probes }, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }).catch(() => {
    // Same swallow as the writer above: forgetting a measurement cannot fail a
    // user action that already happened in settings.
  })
}
