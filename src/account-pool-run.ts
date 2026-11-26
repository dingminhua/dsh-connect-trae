/**
 * The pool's two batch actions: check in every account, and test every account.
 *
 * 参考：`dsh-connect-workbuddy` 的 `src/account-pool-run.ts`（同样三条规则：串行、
 *   单账号失败不中断整批、签到先查状态）。本文件的编排与该实现逐条对齐。
 * 改动：Trae 的签到是**按设备**记账的（`did_checked_in` 键在 `x-device-id` 上，
 *   重复领取回业务码 `9095`「该设备今日已参与签到」，docs 实测 2026-09-26），
 *   WorkBuddy 没有这一层，所以这里多出一个 `device-already` 行状态，并且**一旦
 *   撞上 9095 就停止后续账号** —— 继续往下签只会让每个账号都撞上同一面墙，白
 *   发 N 次请求。这与 `probeModelsSequentially` 遇到 `auth` 即中止是同一条理由。
 *   **例外**：`deps.perAccountDevice`（`pool.perAccountCheckinDevice`，默认关）
 *   打开后，签到设备号按账号派生，9095 只说明「这个账号自己的额度用完了」，
 *   于是不再中止整批 —— 那面墙不再是全机共用的一面。
 *
 * 三条固化成代码的规则：
 *
 *   1. **串行，绝不并发。** Trae 的限流按请求体积触发且各账号独立计时；同时打
 *      整池正是把好账号打成 `4011` 的最快方式（`src/model-probe.ts` 已把这条
 *      写进注释：并行探测会制造出本功能最该避免的 `rate_limited`/`unknown`）。
 *   2. **一个账号失败不中断整批。** 批量结果**逐个账号**返回，而不是整体
 *      成功/失败 —— 一个坏账号不能把其余账号的结果一起藏起来。
 *   3. **签到先查状态，已签到就不再发写入请求。** 幂等，避免重复领取，也避免
 *      把一次「已经签过」当成失败。
 *
 * 本模块不持有定时器、不写盘：编排是纯的（依赖注入），因此可被单测直接驱动。
 *
 * @module dsh-connect-trae/account-pool-run
 */

import type { TraeCredential } from './auth.ts'
import type { TraeCheckinClaim, TraeCheckinStatus } from './usage.ts'
import type { TraeChatResult } from './upstream.ts'
import type { TraePoolProbe } from './account-pool.ts'
import { outcomeOfVerdict } from './account-pool.ts'
import type { TraeProbeResult } from './model-probe.ts'

/** One account's check-in outcome. */
export interface TraePoolCheckinRow {
  accountId: string
  accountName: string
  /**
   * - `claimed` — the upstream accepted today's claim for this account.
   * - `already` — this ACCOUNT's reward for today already exists, so nothing was sent.
   * - `device-already` — the MACHINE already spent today (9095). Not an account
   *   failure and not a success: a truthful "no, this device is used up".
   * - `disabled` — the upstream's check-in activity is not enabled/active for
   *   this account. Reported separately rather than as `failed`, because claiming
   *   is impossible by policy and calling it an error would read as a broken
   *   plugin.
   * - `failed` — the request never landed, or the credential could not be read.
   */
  status: 'claimed' | 'already' | 'device-already' | 'disabled' | 'failed'
  /** Credits the upstream says this claim carries, when it stated a figure. */
  credit?: number
  /** The upstream's own words on failure/refusal, redacted by the caller. */
  message?: string
}

/** One account's test outcome. */
export interface TraePoolTestRow {
  accountId: string
  accountName: string
  /** The model this row was probed on — one model per batch, recorded per row. */
  modelId: string
  outcome: TraeProbeResult['verdict']
  /** Upstream's own words / the plugin's reading of the code. */
  detail: string
  /** A time the upstream named, when it named one. */
  retryAtMs?: number
}

/** One pool member as the batch runner addresses it. */
export interface TraePoolTarget {
  accountId: string
  accountName: string
}

/** The upstream's business code for "this DEVICE already checked in today". */
const CHECKIN_DEVICE_ALREADY_CLAIMED = 9095

/** What the batch runner needs from the Host, injected so it stays testable. */
export interface TraePoolRunnerDeps {
  /**
   * The stored credential for one account, WITHOUT changing the panel's
   * selection. Reading through `credentialOf` is what lets a batch address every
   * account while the user's chosen account keeps serving traffic (issue #25's
   * rule: looking at a neighbour must never persist a switch).
   */
  credentialFor(accountId: string): Promise<TraeCredential | undefined>
  /** Today's check-in state for one credential (CN only). */
  checkinStatusOf(credential: TraeCredential): Promise<TraeCheckinStatus>
  /**
   * Claim one account's check-in (CN only).
   *
   * `attempt` is 0 for the first request of the day and grows by one per busy
   * retry, so the caller can present a different `x-device-id` for each attempt
   * (`checkinRetryDeviceIdOf`). Attempt 0 must stay the stable id, so a batch that
   * never meets `9074` sends exactly what it sent before this parameter existed.
   */
  claimCheckinOf(credential: TraeCredential, attempt?: number): Promise<TraeCheckinClaim>
  /**
   * One minimal real chat call for one credential.
   *
   * The Host builds this as a bridge bound to THAT credential (never
   * `store.resolve()`), so a batch cannot move billing.
   */
  chatFor(credential: TraeCredential): (body: string, signal?: AbortSignal) => Promise<TraeChatResult>
  /** Pause between accounts; injected so tests run without real delays. */
  wait?: (ms: number) => Promise<void>
  /** Clock, injected so a batch stamps one moment for the whole run. */
  nowMs?: () => number
  /**
   * Whether each account presents its own check-in device id
   * (`pool.perAccountCheckinDevice`). When true, `9095` is a fact about THAT
   * ACCOUNT's derived id — not about the machine — so a refusal must not end the
   * batch. Absent/false keeps the shared-device behaviour byte for byte.
   */
  perAccountDevice?: boolean
  /**
   * How many EXTRA attempts one account may make after `9074`「当前参与用户太多」,
   * and the gap between them. Absent means zero retries — one request per account,
   * exactly the behaviour before this existed.
   *
   * `9074` is transient load, not a refusal of the account, but the id it just
   * refused stays refused for the rest of the day (measured 2026-11-26: the same
   * id failed 20 times at 5s intervals, while a different id succeeded on the
   * next call). So a retry is only worth making together with a NEW device id —
   * that pairing is what the Host wires through `claimCheckinOf`'s `attempt`.
   */
  busyRetry?: { attempts: number; gapMs: number }
}

/**
 * Pause between accounts inside one batch.
 *
 * A small, fixed gap. Its purpose is to avoid firing the pool's requests back to
 * back — Trae's limit fires on request bursts, so the gap is modest politeness
 * rather than a rate-limit workaround.
 */
export const POOL_BATCH_GAP_MS = 400

/**
 * Trae's "too many participants" code for the daily check-in claim.
 *
 * Not a refusal of this account: the request lost a race for a limited slot. The
 * claim can succeed later — but only from an id the endpoint has not already
 * turned away today (see `TraePoolRunnerDeps.busyRetry`).
 */
const CHECKIN_BUSY = 9074

/**
 * Check in every account, one at a time.
 *
 * Idempotent by design (see the module note): an account already checked in today
 * is reported as `already` and NO write is attempted. A failure on one account is
 * recorded on that row and the batch continues — EXCEPT for the device-level
 * refusal (`9095`), which stops the run: it is a fact about this MACHINE, so every
 * later account would hit the same wall and each of those calls is a wasted
 * upstream request against an endpoint that just said "stop".
 *
 * That stop is only correct while every account shares the machine's id. With
 * `deps.perAccountDevice` the id is per ACCOUNT, so the same `9095` says "this
 * account already used its own slot" — the batch records it and keeps going,
 * exactly like the `already`/`failed` cases.
 *
 * Never throws: every problem becomes a row.
 */
export async function checkinAllAccounts(
  targets: readonly TraePoolTarget[],
  deps: TraePoolRunnerDeps,
): Promise<TraePoolCheckinRow[]> {
  const rows: TraePoolCheckinRow[] = []
  for (const [index, target] of targets.entries()) {
    if (index > 0) await (deps.wait ?? defaultWait)(POOL_BATCH_GAP_MS)
    const row = await checkinOne(target, deps)
    rows.push(row)
    if (row.status === 'device-already' && deps.perAccountDevice !== true) {
      // Say so on the remaining rows rather than leaving them blank: a user who
      // sees two rows and then nothing cannot tell "not attempted" from "broken".
      for (const skipped of targets.slice(index + 1)) {
        rows.push({
          accountId: skipped.accountId,
          accountName: skipped.accountName,
          status: 'device-already',
          message: 'skipped: this device has already claimed today',
        })
      }
      break
    }
  }
  return rows
}

/** One account's check-in, reduced to its row. */
async function checkinOne(
  target: TraePoolTarget,
  deps: TraePoolRunnerDeps,
): Promise<TraePoolCheckinRow> {
  const base = { accountId: target.accountId, accountName: target.accountName }
  let credential: TraeCredential | undefined
  try {
    credential = await deps.credentialFor(target.accountId)
  } catch (error: unknown) {
    return { ...base, status: 'failed', message: messageOf(error) }
  }
  if (credential === undefined) {
    return { ...base, status: 'failed', message: 'no stored credential for this account' }
  }
  let status: TraeCheckinStatus
  try {
    status = await deps.checkinStatusOf(credential)
  } catch (error: unknown) {
    return { ...base, status: 'failed', message: messageOf(error) }
  }
  if (!status.enabled) return { ...base, status: 'disabled', message: 'check-in is not enabled for this account' }
  // Only the ACCOUNT-level flag skips a claim: this account's reward for today
  // exists, so there is genuinely nothing to send. `didCheckedIn` is NOT used as a
  // skip — it keys on the device, and a `true` here for one account does not mean
  // another account has been paid (measured: it is per `x-device-id`).
  if (status.checkedIn) return { ...base, status: 'already', credit: status.credits }
  if (status.didCheckedIn) {
    // This device is accounted for but this account's own reward does not exist.
    // Still attempt the claim: the upstream is the authority on whether this
    // account may be paid from this machine, and a pre-emptive skip would be the
    // plugin deciding with a weaker signal than the one it can ask for.
  }
  try {
    const claim = await claimWithBusyRetry(credential, deps)
    if (claim.claimed) return { ...base, status: 'claimed', credit: status.credits, ...nonEmpty(claim.message) }
    if (claim.code === CHECKIN_DEVICE_ALREADY_CLAIMED) {
      return { ...base, status: 'device-already', message: claim.message }
    }
    return { ...base, status: 'failed', message: claim.message === '' ? `code ${String(claim.code)}` : claim.message }
  } catch (error: unknown) {
    return { ...base, status: 'failed', message: messageOf(error) }
  }
}

/**
 * One claim, plus the busy retries the caller opted into.
 *
 * Every retry carries its attempt number out to `claimCheckinOf`, because a retry
 * from the SAME device id is known not to work (see `busyRetry`). Stops at the
 * first non-`9074` answer, so a real refusal (`9095`) or a success is never
 * retried, and the caller's attempt budget is never spent on them.
 */
async function claimWithBusyRetry(credential: TraeCredential, deps: TraePoolRunnerDeps): Promise<TraeCheckinClaim> {
  const extra = Math.max(0, Math.trunc(deps.busyRetry?.attempts ?? 0))
  const gap = Math.max(0, deps.busyRetry?.gapMs ?? 0)
  const total = extra + 1
  let claim = await deps.claimCheckinOf(credential, 0)
  for (let attempt = 1; attempt < total; attempt += 1) {
    if (claim.claimed || claim.code !== CHECKIN_BUSY) return claim
    if (gap > 0) await (deps.wait ?? defaultWait)(gap)
    claim = await deps.claimCheckinOf(credential, attempt)
  }
  return claim
}

/**
 * Test every account against one model, one at a time.
 *
 * The model is resolved by the caller (see `resolveTargetModel`) so this function
 * never has to decide "free or not" — an unresolvable target is the caller's
 * problem to report, and testing against a model nobody chose would be exactly the
 * silent spend this feature forbids.
 *
 * ONE model for the whole batch, deliberately. Letting each row test a different
 * model makes a green batch UNCOMPARABLE — one account's `ok` on model X and
 * another's on model Y — which is the reading ("all green") that the reference
 * implementation removed its per-account override for. What stays is that every
 * measurement RECORDS the model it probed and each row displays it.
 *
 * Never throws: a failed probe is a ROW, not an aborted batch. A credential
 * rejection does NOT stop the run (unlike the region-wide model test, where every
 * later probe would fail the same way): here each account has its OWN credential,
 * so one account's bad token says nothing about its neighbours.
 *
 * `onRow` fires the moment one account's row exists, which is what lets a caller
 * report progress. The loop is SERIAL by design, so without this a caller cannot
 * say anything until the SLOWEST member answers: one stuck account made a working
 * batch look like a dead button.
 */
export async function testAllAccounts(
  targets: readonly TraePoolTarget[],
  modelId: string,
  probe: (
    chat: TraePoolRunnerDeps['chatFor'],
    credential: TraeCredential | undefined,
    modelId: string,
  ) => Promise<TraeProbeResult>,
  deps: TraePoolRunnerDeps,
  onRow?: (row: TraePoolTestRow) => void,
): Promise<TraePoolTestRow[]> {
  const rows: TraePoolTestRow[] = []
  for (const [index, target] of targets.entries()) {
    if (index > 0) await (deps.wait ?? defaultWait)(POOL_BATCH_GAP_MS)
    const row = await testOne(target, modelId, probe, deps)
    rows.push(row)
    // A throwing reporter must not lose the rows already collected, so it is
    // called outside any structure that would abort the loop.
    onRow?.(row)
  }
  return rows
}

/** One account's probe, reduced to its row. */
async function testOne(
  target: TraePoolTarget,
  modelId: string,
  probe: (
    chat: TraePoolRunnerDeps['chatFor'],
    credential: TraeCredential | undefined,
    modelId: string,
  ) => Promise<TraeProbeResult>,
  deps: TraePoolRunnerDeps,
): Promise<TraePoolTestRow> {
  const base = { accountId: target.accountId, accountName: target.accountName, modelId }
  let credential: TraeCredential | undefined
  try {
    credential = await deps.credentialFor(target.accountId)
  } catch (error: unknown) {
    return { ...base, outcome: 'auth', detail: messageOf(error) }
  }
  if (credential === undefined) {
    return { ...base, outcome: 'auth', detail: 'no stored credential for this account' }
  }
  const result = await probe(deps.chatFor, credential, modelId)
  return { ...base, outcome: result.verdict, detail: result.detail }
}

/**
 * Turn a test batch's rows into the per-account measurements to remember.
 *
 * A row is stored only when the probe actually measured the MODEL. A row that
 * failed because the credential could not even be read says nothing about the
 * model, and recording it would exclude a possibly-perfect account from the pool —
 * so those accounts keep their previous measurement instead.
 *
 * `atMs` is stamped here, once for the batch, so the card's "tested N minutes ago"
 * reflects when the batch finished rather than drifting per row.
 *
 * `detail` is carried through as `message`. It was already produced from the
 * upstream's own (translated) text, so persisting it cannot leak a token, and
 * without it the pool table could only repeat one generic sentence for a DNS
 * failure, a gateway 502 and a cancelled request alike.
 */
export function probeUpdatesOf(
  rows: readonly TraePoolTestRow[],
  nowMs: number = Date.now(),
): Record<string, TraePoolProbe> {
  const updates: Record<string, TraePoolProbe> = {}
  for (const row of rows) {
    if (isTransportFailure(row)) continue
    const outcome = outcomeOfVerdict(row.outcome)
    updates[row.accountId] = {
      outcome,
      atMs: nowMs,
      // 'test-batch' is what makes a later live failure VISIBLE as such: the record
      // now says this account was deliberately measured `ok`, so a subsequent
      // `live-request` entry is explainable rather than looking like the file
      // rolled back to an older value.
      source: 'test-batch',
      // The model this batch probed. Every row of one batch shares it, and without
      // it the record cannot say what the `ok` was about.
      modelId: row.modelId,
      // The name is written HERE, at the one moment it is certainly available: the
      // batch holds the account because it just resolved it. A member whose
      // sign-in later disappears can then still be named in the card, instead of
      // degrading to a bare id and a subjectless count.
      ...row.accountName === '' ? {} : { accountName: row.accountName },
      ...row.retryAtMs === undefined ? {} : { retryAtMs: row.retryAtMs },
      ...row.detail === '' ? {} : { message: row.detail },
    }
  }
  return updates
}

/**
 * Whether a row measures the transport rather than the account/model.
 *
 * `auth` carrying the pool's own "no stored credential" message is the one case we
 * can attribute to ourselves rather than the upstream: the request never left.
 * Every other rejection came from the upstream and IS a statement about this
 * account, so it is kept.
 */
function isTransportFailure(row: TraePoolTestRow): boolean {
  return row.outcome === 'auth' && row.detail.startsWith('no stored credential')
}

/** Carry an optional upstream sentence only when it says something. */
function nonEmpty(message: string): { message?: string } {
  return message === '' ? {} : { message }
}

/** The default inter-account pause. */
function defaultWait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** A safe message from an unknown throwable, bounded in length. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 300)
}
