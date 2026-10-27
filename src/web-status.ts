/**
 * Same-origin usage route for the Trae plugin card: sign-in state and the
 * read-only usage/credit summary, fetched by the browser half. The route
 * answers loopback browser requests only and never carries token material.
 *
 * Follows the `dsh-workbuddy-connect` status-route pattern so the plugin card
 * stays consistent with that project's external presentation.
 *
 * @module dsh-connect-trae/web-status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { isTraeAccountId, type TraeCredentialStore } from './auth.ts'
import type { TraeModelInfo } from './catalog.ts'
import type { TraeUsageClient } from './usage.ts'
import type { TraeRawDiagnostic } from './raw-diagnostic.ts'
import type { TraeWebQuarantine, TraeWebUnsupportedRegion } from './status-paths.ts'
import { httpFailureOf } from './failure.ts'
import { regionOfPanel, TraeUnsupportedRegionError, type TraePanel, type TraeRegion } from './region.ts'
import { effectiveMembersOf, outcomeOfVerdict, resolveTargetModel, rankPool, type TraePoolAccount, type TraePoolMember } from './account-pool.ts'
import type { TraePoolCheckinRow, TraePoolTestRow } from './account-pool-run.ts'
import {
  regionOfTraeStatusUrl,
  poolAccountIdOf,
  poolActionOf,
  TRAE_ACCOUNT_CREDITS_PATH,
  TRAE_ACCOUNT_STATUS_PATH,
  TRAE_ACCOUNTS_REFRESH_PATH,
  TRAE_CHECKIN_PATH,
  TRAE_MODELS_REFRESH_PATH,
  TRAE_MODELS_TEST_PATH,
  TRAE_POOL_ACTION_PARAM,
  TRAE_POOL_ACCOUNT_PARAM,
  TRAE_POOL_PATH,
  TRAE_REGION_PARAM,
  TRAE_TRANSFER_PATH,
  TRAE_USAGE_PATH,
  fastDetailOf,
  transferActionOf,
} from './status-paths.ts'
import { mergeTransferRecords, parseTransferFile, previewTransferFile, traeTransferRecordOf } from './transfer.ts'
import type { TraeTransferRecord } from './transfer.ts'
import type { TraePoolPreferences, TraeWebAccount, TraeWebAccountCredit, TraeWebAccountState, TraeWebCheckin, TraeWebCreditAlternative, TraeWebCreditExpiry, TraeWebCredits, TraeWebExpiringCredits, TraeWebPool, TraeWebPoolAccount, TraeWebPoolOutcome, TraeWebUsage, TraeWebPayStatus, TraePoolCheckinRowView, TraePoolTestRowView } from './status-paths.ts'
import type { TraeCheckinClaim, TraeCheckinStatus } from './usage.ts'

export { TRAE_USAGE_PATH, TRAE_ACCOUNT_CREDITS_PATH } from './status-paths.ts'
export type { TraeWebUsage, TraeWebPool } from './status-paths.ts'

/**
 * The upstream's business code for "该设备今日已参与签到" — this DEVICE already
 * used today's check-in (measured 2026-09-26 on a CN account whose claim was
 * refused with exactly this code after an account switch on the same machine).
 *
 * It arrives as HTTP 200 with a non-zero `code`, which is why it has to be
 * matched on the code rather than on the HTTP status: read as a transport
 * failure it looks like the plugin is broken, when the day is simply spent.
 */
const CHECKIN_DEVICE_ALREADY_CLAIMED = 9095

/**
 * Constructor dependencies. Everything panel-specific is addressed by the
 * panel the request names: the two regions are separate provider stacks, so
 * the card must be served the directory, selection, and credits of the tab the
 * user is on.
 */
export interface TraeUsageRouteOptions {
  /** The panel-scoped credential store backing each region's requests. */
  store(panel: TraePanel): TraeCredentialStore
  /** The panel-scoped usage client (CN work credits / international pay status). */
  client(panel: TraePanel): TraeUsageClient
  /**
   * CN credit balances of an account OTHER than the bound one, read without
   * changing which account is bound (issue #25). Optional: when absent the
   * exhausted-account hint is simply not offered.
   */
  creditsOfAccount?(panel: TraePanel, accountId: string): Promise<TraeWebCredits | undefined>
  /**
   * Remove ONE account's plugin-owned credential copy, leaving Trae's own login
   * untouched, and report whether the account still signed in to Trae (which the
   * card must echo as "sign out in Trae", not as a deletion that failed).
   * Optional: absent means the pool table's destructive action is not offered.
   */
  deleteAccountOf?(panel: TraePanel, accountId: string): Promise<{
    deleted: boolean
    stillSignedIn: boolean
    hadCopy?: boolean
    signedOutApps?: readonly string[]
    blockedApps?: readonly string[]
  }>
  /**
   * Where the panel's credential copies live and how many there are, so the card
   * can name the file instead of asserting "a copy exists". Optional: absent
   * means the card says nothing about the file.
   */
  copiesOf?(panel: TraePanel): Promise<{ path: string; count: number } | undefined>
  /**
   * Per-account status for one row of the card's account table: CN → check-in
   * + balances, ai → subscription. Read without changing which account is
   * bound. Optional: when absent the account rows show no check-in/credits/
   * subscription figures (the table still lists each account and its switch).
   */
  accountStateOf?(panel: TraePanel, accountId: string): Promise<TraeWebAccountState | undefined>
  /**
   * Claim today's check-in reward for ONE named account, without moving the
   * binding. Optional: absent means the per-row claim button is disabled (the
   * check-in surface simply is not offered).
   */
  claimCheckinOf?(panel: TraePanel, accountId: string): Promise<{ claim: TraeCheckinClaim; checkin: TraeCheckinStatus } | undefined>
  /** The requested region's last-refreshed raw directory (one entry per upstream model). */
  displayModels(panel: TraePanel): readonly TraeModelInfo[]
  /** The user's model selection in the requested panel, stored as model id (= Trae name). */
  enabledModelIds(panel: TraePanel): readonly string[]
  /**
   * Whether the requested region's provider is currently offered to DSH. The
   * card renders this as the tab's on/off checkbox, so the switch reflects the
   * committed settings value rather than a local guess.
   */
  regionEnabled(panel: TraePanel): boolean
  /** Re-read one region's live directory from the upstream. */
  discoverModels?(panel: TraePanel, signal?: AbortSignal): Promise<readonly TraeModelInfo[]>
  /**
   * Test the given model ids for availability, one real (minimal) chat call
   * each. Present only when the region's chat path is wired.
   */
  probeModels?(panel: TraePanel, ids: readonly string[]): Promise<{ results: { id: string; verdict: string; detail: string }[]; skipped?: string[] }>
  /** Raw-Chat capability state of the requested panel. */
  rawDiagnostic?(panel: TraePanel): TraeRawDiagnostic
  /**
   * The account pool's host side, when the panel can run one. Optional on
   * purpose: the pool is an add-on to the status document, and a harness without
   * it (a test host, or a panel stack that failed to build) must still get a
   * complete usage answer with no `pool` field.
   */
  pool?: TraePoolDeps
}

/**
 * What the pool surface needs from the Host, addressed by panel.
 *
 * The split is deliberate. The card never learns a credential and never writes a
 * measurement: it sends an ACTION (`checkin` / `test` / `remove`) and reads the
 * ranking back out of the status document. Everything here is therefore either a
 * cheap local read (preferences, roster, saved names) or an explicitly user-
 * triggered spend (the batches). The one thing that must never happen on a GET is
 * an upstream call made for every row on every poll — the card already lazy-loads
 * per-account state, so `checkedInToday` is cached and skippable by design.
 */
export interface TraePoolDeps {
  /** The panel's saved pool preferences, read from live settings. */
  preferences(panel: TraePanel): TraePoolPreferences
  /**
   * The full pool membership WITH live credit reads — the expensive version.
   * Only the status document's own assembly and an explicit batch call it.
   */
  members(panel: TraePanel): Promise<readonly TraePoolMember[]>
  /**
   * One panel's pool membership from LOCAL state only — the first-paint source
   * (issue #77).
   *
   * Cheap by contract in the strongest sense: no upstream read at all, so the
   * account table can be painted before any billing endpoint answers. A member
   * whose credit total has never been measured carries no `credits`, which the
   * card already renders as `—` rather than as a wrong figure; the follow-up
   * full document fills the real numbers in.
   *
   * A Host built without it degrades to omitting the pool block from a
   * first-paint document rather than paying {@link members} there — the card
   * then shows its single-account view for one refresh cycle.
   */
  localMembers?(panel: TraePanel): Promise<readonly TraePoolMember[]>
  /**
   * The panel's saved member names, from a local scan only.
   *
   * The first-paint counterpart of {@link memberNames}. The full document builds
   * these by walking {@link members} (which reads every balance), which is a
   * second full membership pass for a map of names; the fast document must not
   * pay that, and it does not need to: the saved-list rows it renders are the
   * ones {@link localMembers} already names.
   */
  localMemberNames?(panel: TraePanel): Promise<Record<string, string>>
  /**
   * The checked ids that still resolve to a local sign-in, from a local scan only.
   * The batch route's empty-pool guard runs this on every request, so it must not
   * cost an upstream call — {@link members} is not suitable there.
   */
  effectiveMemberAccountIds?(panel: TraePanel): Promise<readonly string[]>
  /** Last measured display name per saved id, for members whose sign-in is gone. */
  memberNames?(panel: TraePanel): Promise<Record<string, string>>
  /** Local sign-ins the pool does NOT cover, so the card can offer them to check. */
  otherAccounts?(panel: TraePanel): Promise<readonly TraePoolAccount[]>
  /** Which account the request path would bill right now, after applying the pool. */
  currentAccountId?(panel: TraePanel): Promise<string | undefined>
  /** Whether this panel's upstream rewards a daily check-in at all. */
  checkinSupported?(panel: TraePanel): boolean
  /**
   * Today's check-in state per account, from the cached per-account reads.
   *
   * A missing entry means "not read", which the card renders as unknown rather
   * than as a definite "not checked in". `deviceCheckedIn` is the Trae half of the
   * pair: the daily claim is keyed to `x-device-id`, so an account can be unpaid
   * TODAY because this machine already spent its claim on another account.
   */
  checkinState?(panel: TraePanel): Promise<Record<string, TraePoolCheckinState>>
  /**
   * Today's check-in state from the cells already measured this process — the
   * first-paint counterpart (issue #77) of {@link checkinState}.
   *
   * Synchronous by contract: it reads the Host's measurement cache and nothing
   * else, so it must never start a request. A Host without it degrades to an
   * unknown check-in column in the first paint, which the card already renders
   * as unknown; the full document fills the column in.
   */
  cachedCheckinState?(panel: TraePanel): Readonly<Record<string, TraePoolCheckinState>>
  /** Run the check-in batch. Persists nothing to settings; drops its own caches. */
  checkin?(panel: TraePanel): Promise<readonly TraePoolCheckinRow[]>
  /** Run the model-availability batch and persist its measurements. */
  test?(panel: TraePanel, modelId: string, onRow?: (row: TraePoolTestRow) => void): Promise<readonly TraePoolTestRow[]>
  /** Probe ONE account against the target model (the row's own test button). */
  testOne?(panel: TraePanel, accountId: string): Promise<TraePoolTestRow | undefined>
  /** Forget an account's measurement — used when the user removes it from the pool. */
  removeOne?(panel: TraePanel, accountId: string): Promise<boolean>
  /** The panel's catalog, the source of the free-model default and the stale check. */
  catalog?(panel: TraePanel): readonly TraeModelInfo[]
}

/** One row's cached check-in facts; see {@link TraePoolDeps.checkinState}. */
export interface TraePoolCheckinState {
  checkedIn: boolean
  deviceCheckedIn?: boolean
  /** Whether this account is offered the reward at all; false renders `disabled`. */
  enabled?: boolean
}

/**
 * Which usage document a request asked for (issue #77).
 *
 * `full` is the document every earlier caller has always received: live credit
 * figures, fresh check-in state, the ranked pool. `fast` is the same document
 * built from LOCAL state only — no upstream read at all — so the card can paint
 * the account table immediately and then upgrade it with the full document.
 *
 * The distinction lives in ONE optional query parameter (`detail`) so an old
 * caller, a hand-written curl and a browser refresh all keep working: an absent
 * or unrecognised value is `full`.
 */
export type TraeStatusDetail = 'full' | 'fast'

/** Redact token-like content before it crosses to the browser. */
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, '$1[redacted]')
    .slice(0, 500)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/**
 * Answer a failed route with the meaning the failure actually has (issue #66).
 *
 * The old rule was `json(res, 500, { error })` everywhere, so a US credential
 * sent to the Singapore gateway surfaced as `HTTP 500
 * {"error":"SOLO remote models returned HTTP 401"}`: the status said "the
 * plugin is broken" while the text said "the gateway refused you". The client
 * could not tell "sign in again" from "this region is unsupported", which is
 * exactly the loop the issue reports. `httpFailureOf` keeps an upstream 401/403
 * as 401/403 and turns the local "not served" verdict into 501 +
 * `unsupported-region`; everything else stays 500.
 */
function failJson(res: ServerResponse, error: unknown): void {
  const failure = httpFailureOf(error)
  json(res, failure.status, {
    error: safeMessage(error),
    ...failure.code === undefined ? {} : { code: failure.code },
  })
}

/**
 * How many models one test run may probe. Each one spends quota, so the cap is
 * a spending limit as much as a request-size limit; the card tests the enabled
 * models, which is a user-chosen set rather than the whole directory.
 */
export const TRAE_MODELS_TEST_LIMIT = 64
/** Bound on how many OTHER accounts one status read may probe (issue #25). */
const TRAE_CREDIT_ALTERNATIVE_LIMIT = 8

/**
 * Read the ids to test from a POST body.
 *
 * Only ids present in the region's live catalog are accepted downstream (see
 * index.ts), so this reader only has to produce a bounded, string-only list.
 */
async function readModelTestBody(req: IncomingMessage): Promise<string[]> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('invalid JSON body')
  }
  const raw = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['ids'] : undefined
  if (!Array.isArray(raw)) throw new Error('body must carry an ids array')
  const ids: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (id !== '' && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Read the accountId a per-account route needs from a POST body. A bounded,
 * single-string reader — the same families of guards the model-test body uses,
 * because the claim route here is a state-changing endpoint.
 */
async function readAccountBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > 16 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') throw new Error('empty body')
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('invalid JSON body')
  }
  const accountId = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['accountId'] : undefined
  if (typeof accountId !== 'string' || accountId.trim() === '') throw new Error('body must carry an accountId string')
  return accountId.trim()
}

/**
 * Read a transfer-file POST body: the raw file TEXT plus the record indexes the
 * user selected, or (for `export`) the account ids to include.
 *
 * The ceiling is much larger than the other readers' because this body IS a
 * user-chosen file rather than a couple of ids — a credential export from a
 * sibling tool can legitimately be hundreds of kilobytes. It is still bounded so
 * a malformed or hostile request cannot make the Host buffer without limit.
 */
async function readTransferBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > 4 * 1024 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('invalid JSON body')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('body must be a JSON object')
  return parsed as Record<string, unknown>
}

/** Loopback browser origins only; other devices are refused until trusted origins exist. */
function loopbackOrigin(req: IncomingMessage): boolean {  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

/**
 * Whether a pack's expiry is one the card can actually use.
 *
 * One predicate, shared by the per-pack projection and the bucket summary, so
 * the two can never disagree about which packs count as dated. `0` and the
 * non-finite values are excluded: a `0` here would read as 1970 and sort ahead
 * of every real date, and `NaN`/`Infinity` are not dates at all.
 */
function usableExpiry(endTimeMs: number | undefined): endTimeMs is number {
  return typeof endTimeMs === 'number' && Number.isFinite(endTimeMs) && endTimeMs > 0
}

/**
 * Map the credit snapshot to the card's compact credit document.
 *
 * Exported so the "is another account usable?" probe (issue #25) derives its
 * two buckets through the SAME endpoint classification the bound account uses
 * — a second implementation of the Work/general split would be free to disagree
 * with the number shown next to it.
 */
export function toCredits(snapshot: { summary: { totalAmount: number; consumedAmount: number }; packs: { displayDesc: string; availableEndpoint?: number; consumedCredits?: number; creditsLimit?: number; endTimeMs?: number }[] }, nowMs: number = Date.now()): TraeWebCredits {
  const { totalAmount, consumedAmount } = snapshot.summary
  const credit = (value: number): number => Math.round(value * 10_000) / 10_000
  const accounts = snapshot.packs.map(pack => ({
    displayDesc: pack.displayDesc,
    remain: credit(Math.max(0, (pack.creditsLimit ?? 0) - (pack.consumedCredits ?? 0))),
    size: pack.creditsLimit ?? 0,
    // Carried through because the pack's own expiry is what answers "which pack
    // lapses first" — the one question the remaining balance alone cannot. The
    // upstream already reports it per pack (`end_time`), so this is projection,
    // not a new read. Omitted rather than zeroed when there is no usable time:
    // a `0` here would read as 1970 and sort ahead of every real date.
    ...(usableExpiry(pack.endTimeMs) ? { expiresAtMs: pack.endTimeMs } : {}),
    // Which bucket this pack lives in, verbatim from upstream. The pool ranking
    // needs it to tell spendable credit from credit that only the Work surface
    // can reach; see {@link TraeWebCreditAccount.endpoint}.
    ...(pack.availableEndpoint === undefined ? {} : { endpoint: pack.availableEndpoint }),
  }))
  // `usage.credits_amount` is consumed credit, not remaining balance. Derive
  // each bucket's balance from its quota, matching total - consumed upstream.
  const remaining = (endpoint: number): number => snapshot.packs
    .filter(pack => pack.availableEndpoint === endpoint)
    .reduce((sum, pack) => credit(sum + Math.max(0, (pack.creditsLimit ?? 0) - (pack.consumedCredits ?? 0))), 0)
  return {
    total: totalAmount,
    consumed: consumedAmount,
    available: totalAmount - consumedAmount,
    workAvailable: remaining(1),
    generalAvailable: remaining(0),
    accounts,
    ...summarisePackExpiry(accounts, nowMs),
  }
}

/** Empty bucket, used whenever no pack qualifies. */
const NO_EXPIRING_CREDIT: TraeWebExpiringCredits = { total: 0, packs: 0 }

/**
 * Sum the credit lapsing inside `horizonMs` of `nowMs`.
 *
 * Only positive balances count: a lapsed pack with nothing left is not a loss,
 * and including it would make every long-lived account look permanently at
 * risk. Only *future* expiries count too — see {@link expiredPacks}.
 */
function expiringWithin(
  packs: readonly { remain: number; expiresAtMs?: number }[],
  nowMs: number,
  horizonMs: number,
): TraeWebExpiringCredits {
  return sumExpiring(packs, expiresAt => expiresAt > nowMs && expiresAt - nowMs <= horizonMs)
}

/**
 * Sum the credit whose pack has already lapsed but still carries a balance.
 *
 * Kept apart from {@link expiringWithin} because a lapsed pack satisfies every
 * forward-looking horizon at once (`expiresAt - now` is negative, hence "within
 * 24 hours"), which would make a long-dead pack look permanently imminent.
 */
function expiredPacks(
  packs: readonly { remain: number; expiresAtMs?: number }[],
  nowMs: number,
): TraeWebExpiringCredits {
  return sumExpiring(packs, expiresAt => expiresAt <= nowMs)
}

/** Shared accumulator over packs whose expiry passes `matches`. */
function sumExpiring(
  packs: readonly { remain: number; expiresAtMs?: number }[],
  matches: (expiresAtMs: number) => boolean,
): TraeWebExpiringCredits {
  let total = 0
  let count = 0
  let earliestExpiresAtMs: number | undefined
  for (const pack of packs) {
    const expiresAt = pack.expiresAtMs
    if (!usableExpiry(expiresAt) || pack.remain <= 0) continue
    if (!matches(expiresAt)) continue
    total += pack.remain
    count += 1
    if (earliestExpiresAtMs === undefined || expiresAt < earliestExpiresAtMs) earliestExpiresAtMs = expiresAt
  }
  if (count === 0) return NO_EXPIRING_CREDIT
  return {
    total,
    packs: count,
    ...(earliestExpiresAtMs === undefined ? {} : { earliestExpiresAtMs }),
  }
}

/**
 * Bucket the card's credit by how soon it lapses.
 *
 * Returns no `expiry` at all when not one pack carried a usable end time, so a
 * caller can tell "nothing is expiring" apart from "we were never told when
 * anything expires" — the second must not render as reassurance. Uses the same
 * {@link usableExpiry} predicate as the per-pack projection, so a summary is
 * never produced from a set of dates the card itself would not carry.
 */
function summarisePackExpiry(
  accounts: readonly { remain: number; expiresAtMs?: number }[],
  nowMs: number,
): { expiry?: TraeWebCreditExpiry } {
  if (!accounts.some(pack => usableExpiry(pack.expiresAtMs))) return {}
  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  return {
    expiry: {
      within24h: expiringWithin(accounts, nowMs, DAY),
      within3d: expiringWithin(accounts, nowMs, 3 * DAY),
      within7d: expiringWithin(accounts, nowMs, 7 * DAY),
      // Expiry in the past is worth surfacing too: the balance is still listed
      // as credit, so a reader watching only the total would over-count it.
      expired: expiredPacks(accounts, nowMs),
    },
  }
}

/** Map the check-in answer to the card's compact document. */
export function toCheckin(status: {
  checkedIn: boolean
  credits: number
  enabled: boolean
  didCheckedIn: boolean
  extraCredits?: number
}): TraeWebCheckin {
  return {
    checkedIn: status.checkedIn,
    didCheckedIn: status.didCheckedIn,
    credits: status.credits,
    enabled: status.enabled,
    ...status.extraCredits === undefined ? {} : { extraCredits: status.extraCredits },
  }
}

/**
 * Assemble one region's card document. `panel` is the tab the card is on; the
 * panel-scoped store already answers with only that region's accounts, so the
 * document's model slots and account list are that region's by construction.
 * Sign-in state is read-only; credit is a live billing answer whose failure
 * degrades to `creditsError` rather than failing the whole document.
 */
export async function traeWebUsage(
  deps: TraeUsageRouteOptions,
  panel: TraePanel,
  options: { detail?: TraeStatusDetail } = {},
): Promise<TraeWebUsage> {
  const fast = options.detail === 'fast'
  const store = deps.store(panel)
  const enabled = deps.regionEnabled(panel)
  /**
   * Accounts this panel may actually bill.
   *
   * Filtered ONCE, at the source, because this list is spliced into every
   * response shape below (`signed-out`, `signed-in`, the credits route). The
   * enterprise pool can only bill a tenant account, and the tenant gateway does
   * not make that obvious: it answers a personal token's DIRECTORY read in
   * full and only refuses its chat (`4019`). Listing a personal account there
   * would offer a binding that cannot work.
   */
  const accounts = (await store.accounts())
    .filter(account => panel !== 'enterprise' || account.enterprise)
  /**
   * Copies that were found unreadable and moved aside (4.4.6+).
   *
   * Read ONCE per document and never allowed to fail it: a notice is a fact
   * about the user's disk, and a card that failed to load would teach the user
   * nothing about it. It is also the one piece of the document that explains a
   * MISSING ACCOUNT, so it belongs on both shapes — the signed-out one
   * especially, because that is where a lost copy leaves the user (issue #56).
   *
   * The scan is a directory listing beside the plugin's OWN files: cheap, and
   * it reads nothing but file names and sizes.
   */
  const quarantined = await Promise.resolve()
    .then(() => store.quarantinedCopies())
    .catch(() => [] as readonly TraeWebQuarantine[])
  /**
   * A region this build recognizes but does not serve (issue #66).
   *
   * Read ONCE per document and never allowed to fail it: this is a notice about
   * the user's disk, and the panel it explains is usually the one that has just
   * been excluded from billing. It is also why the panel can say "a US account
   * is here, and it is not being used" instead of an undiagnosable "not signed
   * in" on a machine the user knows is signed in.
   */
  const unsupported = await Promise.resolve()
    .then(() => store.unsupportedCredentials())
    .catch(() => [])
  const firstUnsupported = unsupported[0]
  const unsupportedRegion: TraeWebUnsupportedRegion | undefined = firstUnsupported === undefined
    ? undefined
    : { region: firstUnsupported.region, accounts: unsupported.map(item => item.accountName) }
  const authStatus = await store.status()
  if (authStatus.state !== 'signed-in') {
    // A bare "signed out" is undiagnosable on a machine whose layout differs
    // from the ones this plugin was written against — the reported WSL2/CLI
    // case. The probed paths and their failure reasons are safe to surface:
    // they carry paths and error text, never token material.
    const { failures } = await store.diagnose()
    return {
      status: 'signed-out',
      accounts,
      enabled,
      quarantined,
      ...unsupportedRegion === undefined ? {} : { unsupportedRegion },
      searched: failures.map(failure => ({
        path: failure.path,
        edition: failure.edition,
        source: failure.source,
        reason: failure.reason,
        ...failure.message === undefined ? {} : { message: safeMessage(failure.message) },
      })),
    }
  }
  let credential
  try {
    // The first paint reads the credential that is ALREADY known locally.
    // `resolve()` is the right call for the full document — it makes sure the
    // tokens handed to the upstream are usable — but it can refresh them over
    // the network, and no token refresh may decide when the account list
    // appears. An expired token is fine here: the card only needs identity and
    // expiry to paint, and the follow-up full document still validates it.
    credential = fast ? await store.current() : await store.resolve()
    // With nothing known locally there is nothing to paint either; `resolve()`
    // then only classifies WHY (it makes no network call without a credential),
    // so the first paint still gets the same diagnosis as the full document.
    if (credential === undefined) credential = await store.resolve()
  } catch (error: unknown) {
    // Account selection must remain available even when the selected token is
    // expired or its refresh request fails. Report that as account-level status
    // instead of converting the entire route into HTTP 500.
    //
    // A US credential is the exception to "always carry the message": the
    // notice below already says, in the user's language, everything the English
    // exception text says — printing both would just repeat the same fact twice.
    const explained = error instanceof TraeUnsupportedRegionError && unsupportedRegion !== undefined
    return {
      status: 'signed-out',
      accounts,
      enabled,
      quarantined,
      ...unsupportedRegion === undefined ? {} : { unsupportedRegion },
      ...explained ? {} : { message: safeMessage(error) },
    }
  }
  // Only user-facing identity and expiry cross to the browser. Token material
  // and stable user IDs stay on the Host. The requested panel drives which
  // per-panel model directory and selection this document reports, and which
  // usage surface the credits block reads.
  //
  const account = {
    accountId: accounts.find(item => item.selected)?.id ?? '',
    accountName: credential.accountName ?? credential.userId,
    tokenExpiresAtMs: credential.expiresAtMs,
    // The horizon that matters: the access token above renews itself until the
    // refresh token lapses, so a card that only reports the former says
    // "auto-renewal" right up to the moment renewal silently stops working.
    ...credential.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
    region: regionOfPanel(panel),
    enabled,
    ...unsupportedRegion === undefined ? {} : { unsupportedRegion },
    accounts,
    models: deps.displayModels(panel).map(model => ({ ...model, ...model.input === undefined ? {} : { input: [...model.input] } })),
    enabledModelIds: [...deps.enabledModelIds(panel)],
    // The quarantine notice rides along with every signed-in document: it is
    // the one line that explains why an account the user remembers is gone.
    quarantined,
    ...deps.rawDiagnostic === undefined ? {} : { rawChat: deps.rawDiagnostic(panel) },
  }
  // The pool is assembled LAST and never allowed to fail this document: it is
  // the one section whose own reads touch every member account, and a member
  // with a broken balance must not take the sign-in panel down with it.
  //
  // ISSUE #77: on the first paint the pool comes from LOCAL state only, and the
  // live figures are skipped entirely. That is the whole point of this branch —
  // the account table used to wait on a billing read per account (several times
  // over, through the pool's member/name/other-account deps) before it could
  // appear, which is the 30–60 s the issue reports. Identity, expiry, the model
  // list and the pool rows are all known locally, so they are enough to paint.
  if (fast) {
    const poolSection = await poolSectionOf(deps, panel, true)
    return {
      status: 'signed-in',
      ...account,
      ...poolSection,
      // A CONSTANT, not a measurement: this panel has no reachable credit figure
      // by design, so saying so costs no upstream read and must not be withheld
      // from the first paint (the card explains where the real number lives).
      ...panel === 'enterprise' ? { creditsUnavailable: 'enterprise' as const } : {},
    }
  }
  const poolSection = await poolSectionOf(deps, panel, false)
  const client = deps.client(panel)
  if (regionOfPanel(panel) === 'ai') {
    // The international panel is subscription-based: read its pay status
    // instead of the CN Work-credit packs. A failure degrades to
    // payStatusError, exactly like creditsError on the CN side.
    try {
      const payStatus = await client.payStatus()
      return { status: 'signed-in', ...account, ...poolSection, payStatus }
    } catch (error: unknown) {
      return { status: 'signed-in', ...account, ...poolSection, payStatusError: safeMessage(error) }
    }
  }
  /**
   * The enterprise panel shows NO credit figure, deliberately.
   *
   * `client.snapshot()` reads the CONSUMER packs, and that is the personal
   * balance — not what a tenant turn spends. There is no enterprise counterpart
   * to read: every tenant quota endpoint answers 404 (probed 2026-10-17), and
   * the tenant console at console.enterprise.trae.cn is the only place the
   * enterprise balance exists. Showing the personal number under an enterprise
   * heading would be actively misleading, so the panel reports the absence
   * explicitly and the card explains where the real figure lives.
   */
  if (panel === 'enterprise') {
    return {
      status: 'signed-in',
      ...account,
      ...poolSection,
      creditsUnavailable: 'enterprise',
    }
  }
  // Credits and check-in are independent reads, so they settle independently:
  // a broken check-in endpoint still leaves the credit panel usable, and vice
  // versa. Each failure degrades to its own error field rather than taking the
  // whole document down.
  const [snapshotResult, checkinResult] = await Promise.allSettled([
    client.snapshot(),
    client.checkinStatus(),
  ])
  const credits = snapshotResult.status === 'fulfilled' ? toCredits(snapshotResult.value) : undefined
  // Only when the BOUND account is actually empty do the other accounts get
  // read (issue #25). A healthy account must not pay for extra upstream calls.
  const exhausted = credits !== undefined && credits.workAvailable <= 0 && credits.generalAvailable <= 0
  const alternatives = exhausted ? await creditAlternatives(deps, panel, accounts) : undefined
  return {
    status: 'signed-in',
    ...account,
    ...poolSection,
    ...credits === undefined
      ? { creditsError: snapshotResult.status === 'rejected' ? safeMessage(snapshotResult.reason) : 'unknown' }
      : { credits },
    ...checkinResult.status === 'fulfilled'
      ? { checkin: toCheckin(checkinResult.value) }
      : { checkinError: safeMessage(checkinResult.reason) },
    ...alternatives === undefined ? {} : { alternatives },
  }
}

/**
 * Other accounts on this machine that still have credit, when the bound one has
 * none (issue #25).
 *
 * Only ever called for a bound account whose own credits came back at zero, so
 * a healthy setup pays nothing for it. Each candidate is read through
 * `creditsOfAccount`, which must not disturb the bound account; a candidate
 * that fails is simply absent from the answer rather than reported as a broken
 * account, because a stale token on an unrelated login is not this card's
 * problem to explain. The list is capped so a machine with many stale
 * credentials cannot turn one status read into a burst of upstream calls.
 */
async function creditAlternatives(
  deps: TraeUsageRouteOptions,
  panel: TraePanel,
  accounts: readonly TraeWebAccount[],
): Promise<TraeWebCreditAlternative[] | undefined> {
  if (deps.creditsOfAccount === undefined) return undefined
  const candidates = accounts
    .filter(account => !account.selected && account.region === regionOfPanel(panel))
    .filter(account => panel !== 'enterprise' || account.enterprise)
    .slice(0, TRAE_CREDIT_ALTERNATIVE_LIMIT)
  if (candidates.length === 0) return undefined
  const found = await Promise.all(candidates.map(async account => {
    try {
      const credits = await deps.creditsOfAccount!(panel, account.id)
      if (credits === undefined) return undefined
      if (credits.workAvailable <= 0 && credits.generalAvailable <= 0) return undefined
      return {
        id: account.id,
        accountName: account.accountName,
        edition: account.edition,
        workAvailable: credits.workAvailable,
        generalAvailable: credits.generalAvailable,
      }
    } catch { return undefined }
  }))
  const alternatives = found.filter((entry): entry is TraeWebCreditAlternative => entry !== undefined)
  return alternatives.length === 0 ? undefined : alternatives
}

/**
 * The panel's pool section, or an empty standpoint when this Host cannot run one.
 *
 * THE rule of this file: the pool is an ADD-ON to the status document, so no
 * failure inside it may cost the user the sign-in panel. A member with a broken
 * balance read, a probe store that cannot be parsed, a clock — all of it degrades
 * to "no pool section" rather than to a 500 that hides the account table.
 *
 * What is deliberately NOT swallowed here: a `credential`-class failure of the
 * BOUND account, which `traeWebUsage` reports as `status: error` before the pool
 * is even assembled.
 */
export async function poolSectionOf(
  deps: TraeUsageRouteOptions,
  panel: TraePanel,
  fast = false,
): Promise<{ pool?: TraeWebPool }> {
  if (deps.pool === undefined) return {}
  try {
    const pool = await traeWebPool(deps, panel, fast)
    return pool === undefined ? {} : { pool }
  } catch {
    // The document is worth more than the section: the card then renders its
    // single-account view and offers no pool controls, which is a truthful
    // "this Host has no pool right now".
    return {}
  }
}

/**
 * Assemble one panel's pool document (see {@link TraeWebPool}).
 *
 * Rows come from TWO sources and are kept in the Host's ranking order: checked
 * members (ranked by {@link rankPool}) first, then the local sign-ins the pool
 * does NOT cover, so the card can offer them to check. Unchecked rows carry no
 * credits and no measurement — nothing has been read for an account the pool does
 * not bill, and printing a friendlier-looking zero would be a lie.
 *
 * Every per-row read is failure-tolerant on purpose: one account whose balance
 * read throws must not remove the other members from the table.
 */
export async function traeWebPool(
  deps: TraeUsageRouteOptions,
  panel: TraePanel,
  fast = false,
): Promise<TraeWebPool | undefined> {
  const pool = deps.pool
  if (pool === undefined) return undefined
  const preferences = pool.preferences(panel)
  // ISSUE #77: the first paint must not read every member's balance. `localMembers`
  // is the same roster from local state only; a Host without it omits the pool
  // block here rather than silently paying the expensive read it was told to skip.
  const members = fast ? await pool.localMembers?.(panel) : await pool.members(panel)
  if (members === undefined) return undefined
  const nowMs = Date.now()
  const ranked = rankPool(members, nowMs)
  const catalog = pool.catalog?.(panel) ?? []
  const target = resolveTargetModel(catalog, preferences.targetModelId)
  const byId = new Map(members.map(member => [member.account.id, member]))
  const excludedById = new Map(ranked.flatMap(row => row.excludedBy === undefined ? [] : [[row.account.id, row.excludedBy] as const]))
  const rankedIds = new Set(ranked.map(row => row.account.id))
  /**
   * ISSUE #77: every dep below is shaped so the first paint can avoid the
   * upstream. `otherAccounts`, `memberNames` and `checkinState` are all derived
   * from a FULL membership pass on this Host (one balance read per account), and
   * three of them in a row is most of the reported wait. The fast document
   * answers the same questions from the roster it already has:
   *
   * - `otherAccounts`: the local roster minus the members already ranked. The
   *   saved-but-unreachable ghosts are added below from `preferences` anyway, so
   *   nothing a row is built from goes missing.
   * - `memberNames`: only consulted for ghosts, whose rows the fast document
   *   carries from `localMemberNames` when the Host offers it.
   * - `checkinState`: the measurement cache, read synchronously.
   */
  const others = fast
    ? members
        .filter(member => !rankedIds.has(member.account.id))
        .map(member => member.account)
    : (await pool.otherAccounts?.(panel) ?? []).filter(account => !rankedIds.has(account.id))
  const checkinState: Record<string, TraePoolCheckinState> = fast
    ? { ...pool.cachedCheckinState?.(panel) ?? {} }
    : await pool.checkinState?.(panel).catch((): Record<string, TraePoolCheckinState> => ({})) ?? {}
  const memberNames: Record<string, string> = fast
    ? await pool.localMemberNames?.(panel).catch((): Record<string, string> => ({})) ?? {}
    : await pool.memberNames?.(panel).catch((): Record<string, string> => ({})) ?? {}
  const currentAccountId = await pool.currentAccountId?.(panel).catch((): undefined => undefined)
  /**
   * A row per listed account, members first.
   *
   * `member` is the membership source of truth: the saved list is what a batch
   * runs on, so a local sign-in that is not checked must not render as one —
   * otherwise the card would claim "N accounts will be tested" over a set the
   * Host never touches.
   */
  // Membership is the SAVED membership, not `ranked`: `ranked` holds every account
  // this machine can reach, which is a superset — the pool only runs on what the
  // user checked. Rows carry it so the card can render a ghost (saved, unreachable)
  // as a distinct thing rather than as a member that silently does nothing.
  const savedMembers = new Set(preferences.memberAccountIds ?? [])
  const rows: { account: TraePoolAccount; member: boolean }[] = []
  const rowIds = new Set<string>()
  for (const row of ranked) {
    rows.push({ account: row.account, member: savedMembers.has(row.account.id) })
    rowIds.add(row.account.id)
  }
  for (const account of others) {
    rows.push({ account, member: savedMembers.has(account.id) })
    rowIds.add(account.id)
  }
  // A saved id that NOBODY lists is still a row. It is the case where the sign-in
  // disappeared entirely (or `otherAccounts` does not know the account), and if it
  // were dropped the user could neither see nor remove the thing keeping it in the
  // saved list — it would just silently never run.
  for (const accountId of savedMembers) {
    if (rowIds.has(accountId)) continue
    rows.push({ account: { id: accountId, accountName: '' }, member: true })
    rowIds.add(accountId)
  }
  // `members` is the roster of accounts this machine can actually reach, so it is
  // also the reachability set — one definition, used by the row and by
  // `effectiveMemberAccountIds` alike.
  const reachableIds = new Set(members.map(member => member.account.id))
  // Which accounts' ACCESS token has lapsed. Their balance read fails for a
  // reason the user can act on, so the row says so instead of showing a bare dash
  // that reads like "zero credit".
  const tokenExpiresById = new Map<string, number>()
  for (const member of members) {
    if (member.tokenExpiresAtMs !== undefined) tokenExpiresById.set(member.account.id, member.tokenExpiresAtMs)
  }
  const accounts: TraeWebPoolAccount[] = rows.map(row => {
    const entry = byId.get(row.account.id)
    const measured = entry?.probe
    const credits = entry?.credits
    const checkin = checkinState[row.account.id]
    const excludedBy = excludedById.get(row.account.id)
    // A ghost member (saved, no live sign-in) keeps whatever name was measured
    // for it; a live row uses the store's current name. When NO name was ever
    // measured the id itself is the honest fallback — an empty string renders as
    // a nameless row that reads like a corrupt copy of an account.
    const accountName = row.account.accountName !== ''
      ? row.account.accountName
      : memberNames[row.account.id] ?? measured?.accountName ?? row.account.id
    return {
      accountId: row.account.id,
      accountName,
      ...credits === undefined ? {} : {
        credits: credits.total,
        ...credits.generalAvailable === undefined ? {} : { generalAvailable: credits.generalAvailable },
        ...credits.workAvailable === undefined ? {} : { workAvailable: credits.workAvailable },
        expiringSoon: credits.expiringSoon,
        ...credits.nearestExpiryMs === undefined ? {} : { nearestExpiryMs: credits.nearestExpiryMs },
      },
      ...measured === undefined ? {} : {
        probe: {
          outcome: measured.outcome,
          atMs: measured.atMs,
          ...measured.source === undefined ? {} : { source: measured.source },
          ...measured.modelId === undefined ? {} : { modelId: measured.modelId },
          ...measured.retryAtMs === undefined ? {} : { retryAtMs: measured.retryAtMs },
          ...measured.message === undefined ? {} : { message: safeMessage(measured.message) },
        },
      },
      ...excludedBy === undefined ? {} : { excludedBy },
      // Only as the REASON for a missing balance. A row that answered fine shows
      // its credits; if its stored token looked stale, the read refreshed it and
      // there is nothing for the user to fix — saying "sign-in expired" next to a
      // working balance would be noise at best.
      ...credits === undefined && (tokenExpiresById.get(row.account.id) ?? Infinity) <= nowMs
        ? { tokenExpired: true }
        : {},
      current: currentAccountId !== undefined && currentAccountId === row.account.id,
      member: row.member,
      reachable: reachableIds.has(row.account.id),
      ...checkin === undefined ? {} : {
        checkedInToday: checkin.checkedIn,
        ...checkin.deviceCheckedIn === undefined ? {} : { deviceCheckedIn: checkin.deviceCheckedIn },
      },
    }
  })
  /**
   * Why the pool cannot pick anybody, when it cannot.
   *
   * Only meaningful for an ENABLED pool: a disabled pool is not picking anybody by
   * design, and saying "no candidate" there would describe a fault that is not
   * one. Every member excluded is the case the card must explain, because traffic
   * then falls back to the saved selection while the table shows a full roster.
   */
  let noCandidate: TraeWebPool['noCandidate']
  if (preferences.enabled === true) {
    if (members.length === 0) {
      noCandidate = 'empty'
    } else if (ranked.every(row => row.excludedBy !== undefined)) {
      const reasons = new Set(ranked.map(row => row.excludedBy))
      // One shared reason is reported as itself (the useful case: "every account
      // is out of credit"). Mixed reasons have no single sentence, so the generic
      // "unusable" is used rather than picking one account's reason for all.
      noCandidate = reasons.size === 1 ? ranked[0]?.excludedBy ?? 'unusable' : 'unusable'
    }
  }
  const effectiveMemberAccountIds = effectiveMembersOf(
    rows.filter(row => row.member).map(row => row.account.id),
    new Set(members.map(member => member.account.id)),
  )
  const copies = await deps.copiesOf?.(panel).catch((): undefined => undefined)
  return {
    enabled: preferences.enabled === true,
    checkinSupported: pool.checkin !== undefined && regionOfPanel(panel) === 'cn',
    ...deps.deleteAccountOf === undefined ? {} : { deleteSupported: true },
    ...copies === undefined ? {} : { copies },
    ...target.modelId === undefined ? {} : { targetModelId: target.modelId },
    targetModelSource: target.source,
    probeInputTokens: Math.max(0, preferences.probeInputTokens ?? 0),
    ...target.staleModelId === undefined ? {} : { staleTargetModelId: target.staleModelId },
    ...preferences.memberAccountIds === undefined ? {} : { memberAccountIds: preferences.memberAccountIds },
    effectiveMemberAccountIds,
    ...Object.keys(memberNames).length === 0 ? {} : { memberNames },
    accounts,
    ...noCandidate === undefined ? {} : { noCandidate },
  }
}

/**
 * One test row, translated into the pool vocabulary the card renders.
 *
 * The runner answers in the model-probe verdicts (`available` / `auth` / `gated` /
 * `rate_limited` / `unsupported`); the card must not have to know that `gated` and
 * `1005` are the same event, so the translation happens here — once, for both the
 * batch and the single-row probe.
 */
function poolTestRowViewOf(row: TraePoolTestRow): TraePoolTestRowView {
  return {
    accountId: row.accountId,
    accountName: row.accountName,
    modelId: row.modelId,
    outcome: outcomeOfVerdict(row.outcome),
    detail: safeMessage(row.detail),
    ...row.retryAtMs === undefined ? {} : { retryAtMs: row.retryAtMs },
  }
}

/** One check-in row, redacted on the way out. */
function poolCheckinRowViewOf(row: TraePoolCheckinRow): TraePoolCheckinRowView {
  return {
    accountId: row.accountId,
    accountName: row.accountName,
    status: row.status,
    ...row.credit === undefined ? {} : { credit: row.credit },
    ...row.message === undefined ? {} : { message: safeMessage(row.message) },
  }
}

/**
 * The panel a request addresses, or a 400 answer. Absent parameter means the
 * domestic tab; an unknown value is refused rather than guessed.
 */
/**
 * The general balance of every account in one panel.
 *
 * One upstream read per account — the same call `creditsOfAccount` already
 * makes for the exhausted-balance alternatives, widened to every account and to
 * zero balances. Costs nothing until the composer panel is opened, so the
 * 5-minute readout never pays for it (see {@link TRAE_ACCOUNT_CREDITS_PATH}).
 *
 * An account whose read fails or is unavailable still appears, without a
 * figure: the table lists how many accounts exist even when one cannot be
 * quoted, rather than dropping it and making the switch unavailable.
 */
export async function traeAccountCredits(
  deps: TraeUsageRouteOptions,
  panel: TraePanel,
): Promise<TraeWebAccountCredit[]> {
  const accounts = (await deps.store(panel).accounts())
    .filter(account => account.region === regionOfPanel(panel))
    // A personal account cannot bill the tenant pool: the tenant gateway even
    // hands it a full directory, and only the first chat reveals that it will
    // answer `4019`. Listing it here would be an invitation to a dead end.
    .filter(account => panel !== 'enterprise' || account.enterprise)
  if (accounts.length === 0) return []
  return Promise.all(accounts.map(async account => {
    let generalAvailable: number | undefined
    if (account.selected) {
      // The BOUND account goes through the shared client, the same path
      // `traeWebUsage` uses, because its stored credential is normally EXPIRED:
      // `resolve()` refreshes it on read. `creditsOfAccount` is a pure lookup by
      // design and hands the stale token back as-is — which is fine for the
      // alternatives, where `creditAlternatives` excludes the selected account
      // for exactly this reason, but leaves this row with no figure.
      try {
        generalAvailable = toCredits(await deps.client(panel).snapshot()).generalAvailable
      } catch { /* keep the row, without a figure */ }
    } else if (deps.creditsOfAccount !== undefined) {
      try {
        const credits = await deps.creditsOfAccount(panel, account.id)
        generalAvailable = credits?.generalAvailable
      } catch { /* keep the row, without a figure */ }
    }
    return { id: account.id, accountName: account.accountName, selected: account.selected, ...generalAvailable === undefined ? {} : { generalAvailable } }
  }))
}

function requestRegion(req: IncomingMessage, res: ServerResponse): TraePanel | undefined {
  const panel = regionOfTraeStatusUrl(req.url ?? '/')
  if (panel === undefined) {
    json(res, 400, { error: 'unknown region' })
    return undefined
  }
  return panel
}

/** Mount the GET usage route on an optional webServer context. */
export function registerTraeUsageRoute(ctx: Context, deps: TraeUsageRouteOptions): void {
  ctx.effect(() => {
    const disposeUsage = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_USAGE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        if (!loopbackOrigin(req)) {
          json(res, 403, { error: 'origin-not-trusted' })
          return
        }
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        // ISSUE #77: `detail=fast` asks for the first-paint document (local state
        // only, no upstream read). Absent or unrecognised values mean the FULL
        // document, so an old client — or a typo — never gets a thinner panel.
        const detail: TraeStatusDetail = fastDetailOf(req.url ?? '') ? 'fast' : 'full'
        try {
          json(res, 200, await traeWebUsage(deps, panel, { detail }))
        } catch (error: unknown) {
          failJson(res, error)
        }
      },
    })
    /**
     * General balance of every account in the panel — read only when the
     * composer panel is opened. One upstream read per account, paid once per
     * open rather than on the 5-minute cycle (see
     * {@link TRAE_ACCOUNT_CREDITS_PATH}).
     */
    const disposeAccountCredits = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_ACCOUNT_CREDITS_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        try {
          json(res, 200, { accounts: await traeAccountCredits(deps, panel) })
        } catch (error: unknown) {
          failJson(res, error)
        }
      },
    })
    /**
     * Per-account status for one row of the card's account table (CN:
     * check-in + balances; ai: subscription). Read-only, one upstream call per
     * account, fetched once per table render. `accountId` rides in the query
     * (a GET, like every other read-only sibling). Absent `accountStateOf`
     * the route answers 503 so the table degrades to bare rows.
     */
    const disposeAccountStatus = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_ACCOUNT_STATUS_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.accountStateOf === undefined) return json(res, 503, { error: 'account status unavailable' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        const accountId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('accountId')
        if (accountId === null || accountId.trim() === '') return json(res, 400, { error: 'missing accountId' })
        try {
          const state = await deps.accountStateOf(panel, accountId)
          if (state === undefined) return json(res, 404, { error: 'unknown account' })
          json(res, 200, state)
        } catch (error: unknown) {
          failJson(res, error)
        }
      },
    })
    const disposeAccounts = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_ACCOUNTS_REFRESH_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        try {
          // Same tenant gate as the status document: a personal account in the
          // enterprise tab could only ever answer `4019`.
          const accounts = (await deps.store(panel).accounts())
            .filter(account => panel !== 'enterprise' || account.enterprise)
          json(res, 200, { accounts })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Batch credential export / import (issue #37).
     *
     * The Host owns every byte of the credential store; the browser only receives
     * parsed answers. `preview` necessarily returns identifiers the card shows
     * (uid / nickname / email) plus a `hasToken` boolean — never a token — and
     * `import` re-parses the file server-side rather than trusting the preview,
     * so a tampered browser cannot smuggle in a record the preview never showed.
     */
    const disposeTransfer = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_TRANSFER_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        const action = transferActionOf(req.url ?? '')
        if (action === undefined) return json(res, 400, { error: 'unknown transfer action' })
        try {
          const body = await readTransferBody(req)
          if (action === 'export') {
            const wanted = new Set(Array.isArray(body['accountIds']) ? body['accountIds'].filter((id): id is string => typeof id === 'string') : [])
            const store = deps.store(panel)
            const records: TraeTransferRecord[] = []
            for (const account of await store.accounts()) {
              if (!wanted.has(account.id)) continue
              // The COPY, not the merged view: what leaves the machine must be
              // what this plugin owns (and refreshes), never the Trae app's own
              // login file. `credentialOf` would happily answer from either.
              const credential = await store.copyOf(account.id).catch(() => undefined)
              if (credential === undefined) continue
              records.push(traeTransferRecordOf(credential, {
                auth: {
                  accessToken: credential.accessToken,
                  ...credential.refreshToken === undefined ? {} : { refreshToken: credential.refreshToken },
                  expiresAt: credential.expiresAtMs > 0 ? Math.floor(credential.expiresAtMs / 1000) : 0,
                  ...credential.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAt: Math.floor(credential.refreshExpiresAtMs / 1000) },
                  host: credential.host,
                  ...credential.userRegion === undefined ? {} : { userRegion: credential.userRegion },
                },
                account: {
                  userId: credential.userId,
                  ...credential.accountName === undefined ? {} : { username: credential.accountName },
                  edition: credential.edition,
                },
              }))
            }
            return json(res, 200, { accounts: records })
          }
          const text = typeof body['text'] === 'string' ? body['text'] : ''
          if (action === 'preview') return json(res, 200, previewTransferFile(text))
          const indexes = Array.isArray(body['indexes'])
            ? body['indexes'].filter((index): index is number => typeof index === 'number' && Number.isInteger(index))
            : []
          // Parse FIRST so a malformed file fails the request before any write,
          // and so the panel gate sees the same records the preview showed.
          const records = parseTransferFile(text)
          const { changes, imported, skipped } = mergeTransferRecords(records, indexes, regionOfPanel(panel))
          // Only touch the store when the gate accepted something: an import in
          // which every record was skipped must not rewrite the credential file
          // (and `importAccounts([])` deliberately returns early anyway, so this
          // keeps the route's intent explicit rather than relying on that).
          if (changes.size > 0) await deps.store(panel).importAccounts([...changes.values()])
          json(res, 200, { imported, skipped })
        } catch (error: unknown) {
          json(res, 400, { error: safeMessage(error) })
        }
      },
    })
    const disposeRefresh = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_MODELS_REFRESH_PATH,      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.discoverModels === undefined) return json(res, 503, { error: 'model refresh unavailable' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        try {
          const models = await deps.discoverModels(panel)
          json(res, 200, { models })
        } catch (error: unknown) {
          failJson(res, error)
        }
      },
    })
    /**
     * One-click availability test for the enabled models.
     *
     * This ROUTE COSTS QUOTA: each tested model gets a real, minimal chat call.
     * Every other plugin surface is read-only, so the guards here are tighter
     * than a GET's — POST only, loopback origin only, and the id list is taken
     * from the request body and validated against the region's live catalog, so
     * a caller cannot spend calls on arbitrary upstream config names. The count
     * is capped for the same reason.
     */
    const disposeModelsTest = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_MODELS_TEST_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.probeModels === undefined) return json(res, 503, { error: 'model test unavailable' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        let ids: string[]
        try {
          ids = await readModelTestBody(req)
        } catch (error: unknown) {
          return json(res, 400, { error: safeMessage(error) })
        }
        if (ids.length === 0) return json(res, 400, { error: 'no models to test' })
        if (ids.length > TRAE_MODELS_TEST_LIMIT) {
          return json(res, 400, { error: `too many models (limit ${String(TRAE_MODELS_TEST_LIMIT)})` })
        }
        try {
          json(res, 200, await deps.probeModels(panel, ids))
        } catch (error: unknown) {
          failJson(res, error)
        }
      },
    })
    /**
     * Daily check-in claim — the ONLY route in this plugin that mutates
     * upstream account state, so it is guarded more tightly than its siblings:
     * POST only, loopback origin only, and the status read runs FIRST so a day
     * the ACCOUNT has already been paid for never reaches the upstream claim.
     *
     * `alreadyCheckedIn` and `deviceCheckedIn` are deliberately separate
     * answers, because the two flags mean different things (see
     * {@link TraeWebCheckin}): `checkedIn` is the account's reward for today
     * existing, `didCheckedIn` is this MACHINE having spent its check-in —
     * possibly for a different account. Treating the latter as "claimed today"
     * was a shipped bug: after switching accounts the card said "claimed
     * today" and disabled the button, which is the right call for the wrong
     * reason and hides that the new account was never rewarded.
     *
     * The upstream is idempotent per Beijing day (verified 2026-09-24: a
     * repeat claim answers `code: 0` with the entitlement total unchanged), but
     * relying on that for correctness would put the guard in someone else's
     * hands.
     */
    const disposeCheckin = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_CHECKIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        // Judged by CREDENTIAL REGION: the enterprise panel is a CN pool and has
        // the same check-in endpoint as the domestic one.
        if (regionOfPanel(panel) !== 'cn') {
          // The `/trae/api/v2/ug/*` family does not exist on the ai gateways
          // (404, probed 2026-09-24); answering 404 here states that plainly
          // instead of surfacing an upstream HTML 404 as a network fault.
          return json(res, 404, { error: 'check-in is not available for the international region' })
        }
        try {
          // The route now claims FOR a named account (the row's button), so the
          // accountId travels in the body instead of always targeting the bound
          // account. The per-account path uses `claimCheckinOf`, which reaches
          // the account's own credential without moving the binding; absent
          // that dependency the route degrades to the bound client (tests,
          // hosts without the per-account seam).
          let accountId: string | undefined
          try {
            accountId = await readAccountBody(req)
          } catch {
            // A bodyless call is the legacy bound-account behaviour.
            accountId = undefined
          }
          if (accountId !== undefined) {
            if (deps.claimCheckinOf === undefined) return json(res, 503, { error: 'check-in by account unavailable' })
            const outcome = await deps.claimCheckinOf(panel, accountId)
            if (outcome === undefined) return json(res, 404, { error: 'unknown account' })
            const { claim, checkin: after } = outcome
            const deviceClaimed = claim.code === CHECKIN_DEVICE_ALREADY_CLAIMED
            return json(res, 200, {
              claimed: claim.claimed,
              alreadyCheckedIn: after.checkedIn,
              ...deviceClaimed ? { deviceCheckedIn: true } : {},
              code: claim.code,
              message: claim.message,
              checkin: toCheckin(after),
            })
          }
          const client = deps.client(panel)
          const current = await client.checkinStatus()
          if (!current.enabled) {
            return json(res, 409, { error: 'check-in is not enabled for this account' })
          }
          // Only the ACCOUNT-level flag stops a claim: this account's reward
          // for today already exists, so there is genuinely nothing to do and
          // no request is worth sending.
          if (current.checkedIn) {
            return json(res, 200, {
              claimed: false,
              alreadyCheckedIn: true,
              deviceCheckedIn: current.didCheckedIn,
              checkin: toCheckin(current),
            })
          }
          // The device is spent but this account is not: a claim can only be
          // refused (9095). Do not send it, and report the refusal truthfully.
          if (current.didCheckedIn) {
            return json(res, 200, {
              claimed: false,
              alreadyCheckedIn: false,
              deviceCheckedIn: true,
              code: CHECKIN_DEVICE_ALREADY_CLAIMED,
              message: 'this device already used today\'s check-in',
              checkin: toCheckin(current),
            })
          }
          const claim = await client.claimCheckin()
          const checkin = await client.checkinStatus()
          // 9095 is the upstream's own "该设备今日已参与签到": the device raced
          // us (another window, or the Trae app itself). It is a refusal, but a
          // benign one — reporting it as a hard error would tell the user
          // something is broken when the day is simply used up.
          const deviceClaimed = claim.code === CHECKIN_DEVICE_ALREADY_CLAIMED
          json(res, 200, {
            claimed: claim.claimed,
            alreadyCheckedIn: false,
            ...deviceClaimed ? { deviceCheckedIn: true } : {},
            code: claim.code,
            message: claim.message,
            checkin: toCheckin(checkin),
          })
        } catch (error: unknown) {
          failJson(res, error)
        }
      },
    })
    /**
     * The account pool's ONE mutation surface: `?action=checkin|test|remove`.
     *
     * Everything the pool does that costs something happens here and nowhere else —
     * `checkin` sends a claim, `test` spends a real chat call per member, `remove`
     * drops one account's measurement. The pool is therefore POST-only and
     * loopback-only, like the model test and the check-in it wraps.
     *
     * The empty-pool guard runs on `effectiveMemberAccountIds` — what this Host can
     * actually reach — rather than on the saved list. A saved id whose sign-in
     * disappeared would otherwise let a batch answer `200` with zero rows, which
     * the card reads as "全部正常".
     *
     * Answers are JSON except for a streaming test batch, which writes one NDJSON
     * line per account as it lands: the loop is serial, so without a stream a user
     * cannot tell a slow member from a dead button.
     */
    const disposePool = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_POOL_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const panel = requestRegion(req, res)
        if (panel === undefined) return
        const pool = deps.pool
        if (pool === undefined) return json(res, 503, { error: 'account pool unavailable' })
        const url = req.url ?? '/'
        const action = poolActionOf(url)
        if (action === undefined) {
          return json(res, 400, { error: `missing or unknown action parameter (${TRAE_POOL_ACTION_PARAM})` })
        }
        const accountId = poolAccountIdOf(url)
        // A malformed id is refused BEFORE any store write or upstream call: the id
        // becomes part of a file path in the probe store, so the check is the
        // traversal guard as much as a 400.
        if (accountId !== undefined && !isTraeAccountId(accountId)) {
          return json(res, 400, { error: 'malformed account id' })
        }
        if (action === 'remove') {
          if (accountId === undefined) return json(res, 400, { error: 'remove needs an accountId' })
          if (pool.removeOne === undefined) return json(res, 503, { error: 'pool removal unavailable' })
          try {
            json(res, 200, { accountId, removed: await pool.removeOne(panel, accountId) })
          } catch (error: unknown) {
            json(res, 500, { error: safeMessage(error) })
          }
          return
        }
        if (action === 'delete') {
          if (accountId === undefined) return json(res, 400, { error: 'delete needs an accountId' })
          if (deps.deleteAccountOf === undefined) return json(res, 503, { error: 'account deletion unavailable' })
          try {
            const outcome = await deps.deleteAccountOf(panel, accountId)
            json(res, 200, { accountId, ...outcome })
          } catch (error: unknown) {
            json(res, 500, { error: safeMessage(error) })
          }
          return
        }
        /**
         * Both remaining actions need a NON-EMPTY effective pool.
         *
         * `effectiveMemberAccountIds` is optional; when the Host does not supply it
         * the guard falls back to the saved list, which is weaker but never worse
         * than no guard at all. `no-live-members` and `no-members` are separate
         * reasons because the advice differs: re-check the accounts you lost versus
         * check some accounts in.
         */
        const saved = pool.preferences(panel).memberAccountIds ?? []
        let effective: readonly string[] = saved
        if (pool.effectiveMemberAccountIds !== undefined) {
          try {
            effective = await pool.effectiveMemberAccountIds(panel)
          } catch (error: unknown) {
            return json(res, 500, { error: safeMessage(error) })
          }
        }
        if (effective.length === 0) {
          return json(res, 409, {
            action,
            reason: saved.length === 0 ? 'no-members' : 'no-live-members',
            error: saved.length === 0 ? 'no accounts are checked into this pool' : 'none of the checked accounts can be reached on this machine',
          })
        }
        if (action === 'checkin') {
          // The PANEL is the gate, and it is checked before the call is attempted:
          // only the CN personal panel has a daily reward, and the other two would
          // answer 404 for the whole `/trae/api/v2/ug/*` family — so a refusal here
          // saves an upstream request that could only fail.
          const supported = pool.checkinSupported?.(panel) ?? true
          if (!supported || pool.checkin === undefined) {
            return json(res, 409, {
              action,
              reason: 'checkin-unsupported',
              error: supported ? 'check-in is unavailable in this build' : 'this panel has no daily check-in',
            })
          }
          try {
            const rows = await pool.checkin(panel)
            json(res, 200, { rows: rows.map(row => poolCheckinRowViewOf(row)) })
          } catch (error: unknown) {
            failJson(res, error)
          }
          return
        }
        // `test`: one model for the whole batch, resolved by the Host from the
        // panel's saved preference — never from the request, so a caller cannot
        // spend the pool's credits on a model the user did not choose.
        const targetModelId = pool.preferences(panel).targetModelId
        if (pool.test === undefined) {
          return json(res, 409, { action, reason: 'test-unsupported', error: 'the pool cannot test this panel' })
        }
        const single = accountId === undefined ? undefined : pool.testOne
        let modelId = ''
        if (single !== undefined && accountId !== undefined) {
          // The row's own test button names ONE account; it uses the same target
          // model the batch would, so the two answers stay comparable.
          const catalog = pool.catalog?.(panel) ?? []
          const resolved = resolveTargetModel(catalog, targetModelId)
          if (resolved.modelId === undefined) {
            return json(res, 409, {
              action,
              reason: resolved.source === 'stale' ? 'stale-target' : 'no-target-model',
              error: resolved.source === 'stale'
                ? 'the saved test model is no longer offered by this panel'
                : 'no free model is available to test against',
            })
          }
          modelId = resolved.modelId
        }
        if (single !== undefined && accountId !== undefined) {
          try {
            const row = await single(panel, accountId)
            if (row === undefined) return json(res, 404, { error: 'unknown account' })
            return json(res, 200, { rows: [poolTestRowViewOf(row)] })
          } catch (error: unknown) {
            return failJson(res, error)
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
        const writeLine = (value: unknown): void => { res.write(`${JSON.stringify(value)}\n`) }
        try {
          const rows = await pool.test(panel, targetModelId ?? '', row => { writeLine({ row: poolTestRowViewOf(row) }) })
          // The trailing summary line repeats what was already streamed: a client
          // that only reads the last line still gets the whole answer.
          writeLine({ rows: rows.map(row => poolTestRowViewOf(row)) })
        } catch (error: unknown) {
          writeLine({ reason: 'pool-failed', error: safeMessage(error) })
        }
        res.end()
      },
    })
    return () => {
      disposePool()
      disposeCheckin()
      disposeRefresh()
      disposeTransfer()
      disposeModelsTest()
      disposeAccounts()
      disposeAccountCredits()
      disposeAccountStatus()
      disposeUsage()
    }
  }, 'dsh-connect-trae: Web usage route')
}
