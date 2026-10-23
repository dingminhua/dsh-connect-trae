/**
 * Node-free constants and types shared by the Host and browser halves.
 * Mirrors the `dsh-workbuddy-connect` status-route pattern so the plugin card
 * stays consistent with that project's external presentation.
 */
import type { TraeEdition } from './paths.ts'
import type { TraeActivityDiscount } from './promo.ts'
import { TRAE_PANELS, type TraePanel, type TraeRegion } from './region.ts'

/** Plugin-owned usage endpoint consumed by its browser half. */
export const TRAE_USAGE_PATH = '/plugins/dsh-connect-trae/usage'
/** Plugin-owned live model refresh endpoint. */
export const TRAE_MODELS_REFRESH_PATH = '/plugins/dsh-connect-trae/models/refresh'
/**
 * Plugin-owned availability probe: POST the model ids to test, get one verdict
 * per model. Unlike every read-only sibling this route SPENDS quota — a real
 * (minimal) chat call per model — so it is user-initiated only, and the card
 * labels the button as consuming a small amount.
 */
export const TRAE_MODELS_TEST_PATH = '/plugins/dsh-connect-trae/models/test'
/** Plugin-owned local account rescan endpoint. */
export const TRAE_ACCOUNTS_REFRESH_PATH = '/plugins/dsh-connect-trae/accounts/refresh'

/**
 * General balance of EVERY account in a region, for the composer panel's table.
 *
 * Separate from the usage route on purpose: the usage document backs the
 * 5-minute readout, and multiplying its upstream reads by the account count
 * would charge a healthy account for something it never looks at — the same
 * principle that keeps `creditAlternatives` firing only when a balance hits
 * zero. This one is paid when the panel is actually opened, which is the only
 * place the table is shown.
 */
export const TRAE_ACCOUNT_CREDITS_PATH = '/plugins/dsh-connect-trae/account-credits'
/**
 * Per-account status (check-in / credits / subscription) for the account table.
 *
 * Each row of the account table reads its OWN state through this route — a CN
 * row carries its check-in state and balance, an ai row its subscription.
 * POST with the accountId in the body: one upstream read per account, paid
 * only when the table is actually shown.
 */
export const TRAE_ACCOUNT_STATUS_PATH = '/plugins/dsh-connect-trae/account-status'
/**
 * Plugin-owned daily check-in claim endpoint. POST, loopback-only, and the only
 * route in this plugin that changes upstream account state. The accountId in
 * the body names WHICH account to claim for, so the button can sit in each
 * account row.
 */
export const TRAE_CHECKIN_PATH = '/plugins/dsh-connect-trae/checkin'
/**
 * Plugin-owned account-pool endpoint: one route for the pool's batch actions.
 *
 * 参考：`dsh-connect-workbuddy` 的 `WORKBUDDY_POOL_PATH`。本路由与该实现同形
 *   （同一 `?action=` 风格、POST、loopback-only、per-row `accountId`），这样同时
 *   装了两个插件的用户面对的是同一套交互。
 *
 * `?action=checkin` and `?action=test` run over the whole member set; `remove`
 * addresses ONE account (the body carries `accountId`) and is the only way a
 * measurement of an account the user no longer wants can leave the store — a
 * deleted member otherwise keeps its row in the file forever, and a re-added
 * member would silently inherit an old exclusion.
 *
 * POST + loopback-only because both batches SPEND something: check-in sends a
 * claim, and a test is a real chat call. A page that is not the Host's own
 * loopback must not be able to trigger either.
 */
export const TRAE_POOL_PATH = '/plugins/dsh-connect-trae/pool'
/** Query parameter selecting which pool batch action a request means. */
export const TRAE_POOL_ACTION_PARAM = 'action'
/** Query parameter naming ONE pool account a per-row request addresses. */
export const TRAE_POOL_ACCOUNT_PARAM = 'accountId'
/** The pool batch actions. `remove` and `delete` are per-account and never batch-wide. */
export type TraePoolAction = 'checkin' | 'test' | 'remove' | 'delete'
/** Read the pool action off a request URL; unknown/absent means undefined. */
export function poolActionOf(url: string): TraePoolAction | undefined {
  const at = url.indexOf('?')
  if (at === -1) return undefined
  const value = new URLSearchParams(url.slice(at + 1)).get(TRAE_POOL_ACTION_PARAM)
  return value === 'checkin' || value === 'test' || value === 'remove' || value === 'delete' ? value : undefined
}
/**
 * Read the ONE account a per-row pool request addresses, from the QUERY string.
 *
 * Unlike the transfer route, the pool's `accountId` rides the URL rather than the
 * body, so a row action and a batch action are distinguishable before any bytes
 * are read — which is what lets the route refuse a malformed request without ever
 * touching the store.
 */
export function poolAccountIdOf(url: string): string | undefined {
  const at = url.indexOf('?')
  if (at === -1) return undefined
  const value = new URLSearchParams(url.slice(at + 1)).get(TRAE_POOL_ACCOUNT_PARAM)
  return value === null || value === '' ? undefined : value
}
/**
 * Address one panel's pool route with its action.
 *
 * Kept as its own helper (rather than a `withTraeRegion` + hand-appended
 * `&action=`) because a missing action parameter means "no action", not a
 * default one — the typo has to be impossible rather than merely unlikely.
 */
export function withTraePoolAction(panel: TraePanel, action: TraePoolAction): string {
  return `${TRAE_POOL_PATH}?${TRAE_REGION_PARAM}=${panel}&${TRAE_POOL_ACTION_PARAM}=${action}`
}

/**
 * Address one panel's pool route for ONE account, e.g. a row's Test or Remove.
 *
 * Kept beside {@link withTraePoolAction} for the same reason that one exists: the
 * account id is a 24-char hex string, and hand-appending `&accountId=` at a call
 * site is one typo away from a request the route answers 400 to — or worse, from
 * one that addresses the wrong action. Both parameters are therefore spelled by
 * this module and nowhere else.
 */
export function withTraePoolAccount(panel: TraePanel, action: TraePoolAction, accountId: string): string {
  return `${withTraePoolAction(panel, action)}&${TRAE_POOL_ACCOUNT_PARAM}=${encodeURIComponent(accountId)}`
}

/**
 * Outcome vocabulary of one account probe, shared by the Host and the card.
 *
 * Mirrors `TraePoolOutcome` in `./account-pool.ts`, and is DECLARED again here
 * rather than imported for the same reason workbuddy repeats it: this module is
 * the node-free bridge for the browser build target and must not pull in the
 * Host-side pool module (which imports the credential type). The two lists must
 * stay in step — the card renders one label per value, and a value Host can send
 * that the card has no label for renders as the raw token.
 *
 * `plan-gated` is Trae-only (upstream `1005`: this ACCOUNT's plan does not cover
 * the model) and has no workbuddy counterpart.
 */
export type TraeWebPoolOutcome =
  | 'ok'
  | 'rate-limited'
  /**
   * The MODEL is loaded, not the account.
   *
   * Kept apart from `rate-limited` because the two need OPPOSITE advice:
   * `rate-limited` is this account's volume wall (wait, or bill another account),
   * while `model-busy` follows the model everywhere — every account hits the same
   * wall, so switching only spends a request per account to learn what the first
   * already said.
   */
  | 'model-busy'
  | 'out-of-credit'
  | 'credential-rejected'
  | 'policy-rejected'
  | 'plan-gated'
  | 'unavailable'
  | 'not-found'
  | 'failed'

/** Why one account is currently out of the pool. */
export type TraeWebPoolExclusion =
  | 'unusable'
  | 'rate-limited'
  | 'model-busy'
  | 'out-of-credit'
  | 'credential-rejected'
  | 'policy-rejected'
  | 'plan-gated'
  | 'not-found'
  | 'unavailable'
  | 'failed'

/**
 * One account's row in the pool, as the card renders it.
 *
 * Ties together the three facts the card shows per account — credits, the last
 * test, and whether it can serve right now — so the ranking the card displays
 * comes from ONE Host answer rather than being re-derived in the browser. The
 * browser re-deriving it is how a card ends up calling an excluded account "in
 * use", which is the inconsistency this document exists to prevent.
 */
export interface TraeWebPoolAccount {
  accountId: string
  accountName: string
  /** Total remaining credit, absent when this account's balance read failed. */
  credits?: number
  /**
   * The GENERAL bucket — the credit this plugin's chat can actually spend.
   *
   * Trae-only, because a Trae balance is TWO buckets and SOLO chat only drains
   * General (measured on the live `available_endpoint` split). A row whose total
   * looks rich but whose General reads zero cannot serve a request, which is the
   * same trap workbuddy hit with its expiry rule: a ranking keyed on a figure that
   * the billing path cannot reach is not a ranking. The card shows both.
   */
  generalAvailable?: number
  /** The WORK bucket, kept for display: this plugin's chat never spends it. */
  workAvailable?: number
  /** Credit lapsing inside 3 days. Zero means "measured, nothing at risk". */
  expiringSoon?: number
  /** When the nearest pack lapses, epoch ms. */
  nearestExpiryMs?: number
  /**
   * This account's stored access token has lapsed, so its balance cannot be read
   * until it is refreshed or the user signs in again.
   *
   * A reason for the dash, not a second dash: without it "0 credit" and "cannot
   * read the balance" look identical on the card, and only one of them is the
   * user's problem to fix.
   */
  tokenExpired?: boolean
  /**
   * The last test of this account, absent when never tested.
   *
   * `modelId` lives INSIDE the measurement rather than being assumed from the
   * row's current setting: the setting can change after the test, and a result
   * must keep naming what it actually measured.
   */
  probe?: {
    outcome: TraeWebPoolOutcome
    atMs: number
    /**
     * What wrote this measurement, so the card can explain a change the user
     * watched happen: `test-batch` is a deliberate test, `live-request` is a real
     * request that failed and overwrote it. ABSENT for records written before the
     * field existed — the card must then say "unknown", not guess.
     */
    source?: 'test-batch' | 'live-request'
    /** WHICH model this measurement is about; absent = unknown scope. */
    modelId?: string
    /** Only when the upstream named a time; never invented locally. */
    retryAtMs?: number
    /** Upstream's own words, already redacted. Absent on success. */
    message?: string
  }
  /** Set when this account cannot serve right now. */
  excludedBy?: TraeWebPoolExclusion
  /**
   * Whether this is the account billing traffic for this panel RIGHT NOW.
   *
   * The pool's runtime pick when enabled, else the saved selection. It is the
   * HOST's answer, not the card's guess: a card that derived "in use" from the
   * saved setting would contradict the pool after a rotation.
   */
  current: boolean
  /**
   * Whether the user checked this account into this panel's pool.
   *
   * Listed rows include UNCHECKED accounts so the card can offer them to check:
   * membership is an explicit opt-in and a user can only opt in to something they
   * can see. Only checked rows can bill or be batched.
   */
  member: boolean
  /**
   * Whether this machine still holds a usable sign-in for the account.
   *
   * `false` marks a GHOST: checked or listed, but no local credential resolves, so
   * a batch can neither test it nor check it in. It is kept as a row (rather than
   * filtered out) because the only way to stop carrying a broken entry is to see
   * it and remove it — a filtered row would leave the saved list permanently dirty
   * with nothing on screen to explain why the pool runs on fewer accounts than the
   * checkbox count says.
   */
  reachable?: boolean
  /**
   * Today's check-in state for this account.
   *
   * ABSENT means it was not read — the card must then say so rather than render a
   * definite "not checked in", which would contradict a claim the user just
   * watched succeed.
   */
  checkedInToday?: boolean
  /**
   * Whether today's check-in is spent on this MACHINE for this account.
   *
   * Trae-only, because Trae keys the daily claim to `x-device-id` (code `9095`).
   * `checkedInToday === false` together with this true is the "switched account"
   * case the check-in card already documents: this device has no claim left.
   */
  deviceCheckedIn?: boolean
}

/**
 * The pool's state for one panel.
 *
 * `targetModelId`/`targetModelSource` exist so the card can state WHICH model a
 * test would use and WHERE that choice came from. `none` is a real, common
 * answer for Trae — the CN static fallback catalog carries no `creditMultiplier`
 * at all until its first live refresh, and "missing multiplier ≠ free" means the
 * card must render "no free model" rather than silently substituting a paid one.
 */
export interface TraeWebPool {
  enabled: boolean
  /**
   * Whether this panel offers the daily check-in at all.
   *
   * Only `cn` does. The ai gateways answer 404 for the whole `/trae/api/v2/ug/*`
   * family (probed 2026-09-24) and the enterprise panel has no personal reward,
   * so the card hides the action entirely rather than rendering a button whose
   * only outcome is a refusal.
   */
  checkinSupported: boolean
  /**
   * Whether this panel offers the destructive per-row Delete at all.
   *
   * The client bundle updates on REFRESH but the Host only on RESTART, so a card
   * shipping before the Host gains `deleteAccountOf` must hide the button rather
   * than render one whose only outcome is a 503. Absent means the legacy Host
   * predates the feature, and the destructive Delete is not offered.
   */
  deleteSupported?: boolean
  /**
   * Where this panel's credential copies live, and how many the plugin holds.
   *
   * The user's recurring doubt is "there is no real copy file, it just follows
   * the app" — which no amount of prose answers. Reporting the path and the count
   * lets the card show the actual file, so "a copy exists" is something the user
   * can verify on disk. Absent means a Host that predates this report.
   */
  copies?: { path: string; count: number }
  /** The model a test would use right now; absent when none can be resolved. */
  targetModelId?: string
  /**
   * Where the target came from. `'stale'` means the SAVED id is no longer in the
   * catalog — a distinct state from `'none'` (no free model exists), because the
   * two need opposite advice (offer a way back to automatic / say there is no
   * free model at all).
   */
  targetModelSource: 'preferred' | 'free' | 'none' | 'stale'
  /**
   * How much text a pool test sends (0 = the minimal probe). Always a number so
   * the card's select has a value to show; the saved preference is the default.
   */
  probeInputTokens: number
  /** The saved target id that this panel's catalog no longer offers. */
  staleTargetModelId?: string
  /** The account ids the user has checked into this panel's pool. */
  memberAccountIds?: readonly string[]
  /**
   * The subset of {@link TraeWebPool.memberAccountIds} that resolves to a real
   * local credential — i.e. what a batch actually runs on.
   *
   * Sent so the card never re-derives it. Counting the raw saved list is what
   * lets a UI claim "1 of 1 selected" and enable both buttons while the Host ran
   * on ZERO accounts and reported success.
   */
  effectiveMemberAccountIds?: readonly string[]
  /**
   * Last measured display name per saved member id, including members that have
   * since stopped resolving.
   *
   * A member whose sign-in disappeared would otherwise be listed as a bare id
   * and an unexplained count, and the user could not tell WHICH one they unchecked.
   */
  memberNames?: Record<string, string>
  /** Rows in the Host's ranking order: candidates first, excluded rows last. */
  accounts: readonly TraeWebPoolAccount[]
  /**
   * Why the pool could not pick anybody, when it could not.
   *
   * Set when every member is excluded, so the card can explain that traffic is
   * going to the saved selection rather than leaving the user to assume the pool
   * is serving the top row.
   */
  noCandidate?: TraeWebPoolExclusion | 'empty'
}

/**
 * One check-in row of the pool batch answer, as the card sees it.
 *
 * The same fields the Host's batch runner produces (`TraePoolCheckinRow`),
 * restated here because this module is the node-free bridge and the browser must
 * not import the Host module. `message` crosses only after redaction.
 */
export interface TraePoolCheckinRowView {
  accountId: string
  accountName: string
  status: 'claimed' | 'already' | 'device-already' | 'disabled' | 'failed'
  credit?: number
  message?: string
}

/**
 * One test row of the pool batch answer, as the card sees it.
 *
 * `outcome` is the POOL vocabulary (see {@link TraeWebPoolOutcome}), not the
 * model-probe verdict the batch runner returns: the card must not have to know
 * that `gated` and `1005` are the same event, and translating here is what keeps
 * the pool table and the automatic routing reading one outcome set.
 */
export interface TraePoolTestRowView {
  accountId: string
  accountName: string
  modelId: string
  outcome: TraeWebPoolOutcome
  detail: string
  retryAtMs?: number
}

/** The answer to `?action=remove`: whether the measurement left the store. */
export interface TraeWebPoolRemoveAnswer {
  accountId: string
  removed: boolean
}

/**
 * The answer to `?action=delete`: what the Host could remove from its own
 * credential copy, and whether the account is STILL signed in to the Trae app
 * (a desktop login the plugin deliberately does not touch). The card renders
 * `stillSignedIn` as "sign out in Trae", never as a deletion that failed.
 */
export interface TraeWebPoolDeleteAnswer {
  accountId: string
  /**
   * Whether the plugin now holds NO copy of this account.
   *
   * True also when it held none to begin with (a ghost member): the question is
   * "does this plugin still carry it?", not "did a file change?".
   */
  deleted: boolean
  /**
   * Whether the machine STILL carries this account somewhere after the attempt.
   *
   * True when the app's own login survived: it was running (see `blockedApps`) or
   * the rewrite failed. The card must not claim success while this is true.
   */
  stillSignedIn: boolean
  /**
   * Trae apps whose own login was erased, so the account is really gone from this
   * machine. The app must be restarted for it to notice.
   */
  signedOutApps?: TraeEdition[]
  /**
   * Trae apps that still hold the login because the app was running, so its
   * in-memory state would have reverted the rewrite. The card says which app to
   * quit instead of reporting a generic failure the user cannot act on.
   */
  blockedApps?: TraeEdition[]
  /**
   * Whether a plugin-owned copy actually existed and was erased.
   *
   * `false` means the account lives ONLY in the Trae app's own login, so nothing
   * was deleted and the card must say so instead of claiming a copy was removed.
   * ABSENT for an older Host that predates the field: the card then falls back to
   * the generic "still signed in" wording rather than guessing.
   */
  hadCopy?: boolean
}

/**
 * The pool's saved preferences for one panel, as stored in `regions[panel].pool`.
 *
 * Declared in the node-free bridge because BOTH halves touch it: the Host reads
 * it to decide membership and ranking, the card drafts and saves it. Keeping one
 * declaration is what stops the card from writing a field the Host ignores (or
 * vice versa) — the failure workbuddy hit when its client and Host each had a
 * private copy of this shape.
 *
 * Every field is optional because this is a user-edited draft: a partially filled
 * slot must still load, and a missing `enabled` means OFF rather than ON.
 */
export interface TraePoolPreferences {
  /** Whether this panel bills through the pool at all. Default OFF. */
  enabled?: boolean
  /**
   * The model a test batch probes. Absent or `''` means "automatic": pick the
   * free model (see `pickFreeModel` in `./account-pool.ts`). An id this panel no
   * longer offers is PRESERVED so the user's choice survives a catalog blip, and
   * reported as `stale` rather than silently replaced.
   */
  targetModelId?: string
  /**
   * The accounts the user checked into this panel's pool, in the order they were
   * checked.
   *
   * Explicit opt-in with NO default: an account never joins the pool because it
   * exists. Order is only a display hint — the ranking is the Host's.
   *
   * A MUTABLE array, not `readonly`: this interface is also the shape the
   * settings schema declares (`z.array(z.string())`), and the schema rebuilds the
   * config document on every save — a readonly type there is a compile-time
   * mismatch that would take the whole Config schema down. Readers still treat it
   * as immutable; only the owner of a draft copies it.
   */
  memberAccountIds?: string[]
  /**
   * How much text a pool TEST sends, in tokens. `0` (the default) keeps the
   * minimal one-word probe.
   *
   * Exists because a verdict earned by a one-word request says nothing about the
   * long turn the user is about to send: an upstream that refuses large requests
   * answers the small one happily. Padding the probe therefore buys a truthful
   * "works at my size" answer at the cost of spending real credit per test.
   */
  probeInputTokens?: number
}

/**
 * Plugin-owned account transfer endpoint: batch export and import of a region's
 * stored credentials (issue #37).
 *
 * One route with an `action` query parameter (`export` | `preview` | `import`),
 * mirroring the sibling `dsh-connect-workbuddy` plugin's transfer route so the
 * two cards behave the same way for a user who has both installed. The vault
 * document never leaves the Host: the browser receives parsed answers, and a
 * preview carries display fields only — never token material.
 */
export const TRAE_TRANSFER_PATH = '/plugins/dsh-connect-trae/transfer'
/** The transfer endpoint's steps. */
export type TraeTransferAction = 'export' | 'preview' | 'import'
/** Read the transfer action off a request URL; unknown/absent means undefined. */
export function transferActionOf(url: string): TraeTransferAction | undefined {
  const at = url.indexOf('?')
  if (at === -1) return undefined
  const value = new URLSearchParams(url.slice(at + 1)).get('action')
  return value === 'export' || value === 'preview' || value === 'import' ? value : undefined
}

/** Query parameter naming the region a card request addresses. */
export const TRAE_REGION_PARAM = 'region'

/** Every region, in card tab order. */
export const TRAE_REGIONS: readonly TraeRegion[] = ['cn', 'ai']

/**
 * Every PANEL, in card tab order: the sections the card renders and the
 * settings slots it writes (see {@link TraePanel}).
 *
 * Re-exported here because the card is a separate build target and this module
 * is already its single source of routing/locale truth; `region.ts` stays the
 * definition site.
 */
export { TRAE_PANELS, type TraePanel }

/**
 * Address one region's status route. The two regions are separate provider
 * stacks; every card request carries the region whose tab the user is on.
 */
export function withTraeRegion(path: string, panel: TraePanel): string {
  return `${path}?${TRAE_REGION_PARAM}=${panel}`
}

/**
 * Address one region's transfer route with its step, e.g.
 * `/plugins/dsh-connect-trae/transfer?region=cn&action=export`.
 *
 * Separate from {@link withTraeRegion} because this route carries a second
 * query parameter: a caller that appended `&action=` by hand would be one typo
 * away from a 400, which is exactly the failure the sibling workbuddy plugin
 * hit (#42) when five requests dropped that parameter.
 */
export function withTraeTransferAction(path: string, panel: TraePanel, action: TraeTransferAction): string {
  return `${path}?${TRAE_REGION_PARAM}=${panel}&action=${action}`
}

/**
 * Read the region parameter off a status-route URL. Absent means the domestic
 * tab (`cn`); a present-but-unknown value returns undefined so the route can
 * answer 400 instead of guessing.
 */
export function regionOfTraeStatusUrl(url: string): TraePanel | undefined {
  const at = url.indexOf('?')
  const value = at === -1 ? null : new URLSearchParams(url.slice(at + 1)).get(TRAE_REGION_PARAM)
  if (value === null || value === '') return 'cn'
  // The query parameter is still spelled `region` for link compatibility, but
  // it now addresses a PANEL: `?region=enterprise` is the enterprise tab.
  return (TRAE_PANELS as readonly string[]).includes(value) ? value as TraePanel : undefined
}

/** Query parameter asking for a thinner first-paint document (issue #77). */
export const TRAE_DETAIL_PARAM = 'detail'

/** The only recognised `detail` value: local state only, no upstream read. */
export const TRAE_DETAIL_FAST = 'fast'

/**
 * Address one panel's usage route asking for the FAST document, e.g.
 * `/plugins/dsh-connect-trae/usage?region=cn&detail=fast`.
 *
 * Kept beside {@link withTraeRegion} for the same reason as
 * {@link withTraeTransferAction}: the region is already a parameter, so a caller
 * appending `&detail=` by hand is one typo away from a request that silently
 * asks for the wrong document.
 */
export function withTraeRegionFastDetail(path: string, panel: TraePanel): string {
  return `${withTraeRegion(path, panel)}&${TRAE_DETAIL_PARAM}=${TRAE_DETAIL_FAST}`
}

/**
 * Whether a request URL asks for the fast document.
 *
 * Only the exact value counts — a typo (`fastest`, `FAST`) degrades to the FULL
 * document, because a thinner panel is a worse failure than a slower one: the
 * caller that made the mistake is asking about an optimisation, so the safe
 * answer is the truthful one.
 */
export function fastDetailOf(url: string): boolean {
  const at = url.indexOf('?')
  if (at === -1) return false
  return new URLSearchParams(url.slice(at + 1)).get(TRAE_DETAIL_PARAM) === TRAE_DETAIL_FAST
}

/** One credit pack and its remaining credit. */
export interface TraeWebCreditAccount {
  displayDesc: string
  remain: number
  size: number
  /**
   * When this pack lapses, in epoch milliseconds, taken from the upstream's own
   * `end_time`. Absent when the upstream reported no usable time (0 / missing),
   * so a consumer can tell "no date" apart from "1970".
   */
  expiresAtMs?: number
  /**
   * Raw upstream `available_endpoint`: which bucket this pack lives in.
   *
   * Measured on the live response — `0` is the GENERAL bucket that SOLO chat
   * actually spends, `1` is the WORK bucket it cannot reach. The projection
   * dropped this field until the account pool needed it: the pool ranks accounts
   * by what they can SERVE, and credit lapsing in the WORK bucket is not a
   * reason to bill that account first, because nothing here can ever spend it.
   * Absent, not guessed, when the upstream omits it.
   */
  endpoint?: number
}

/** Credit lapsing inside one horizon, as the card reports it. */
export interface TraeWebExpiringCredits {
  /** Sum of the contributing packs' remaining credit. */
  total: number
  /** How many packs contribute. */
  packs: number
  /** Soonest expiry among them, epoch milliseconds. */
  earliestExpiresAtMs?: number
}

/**
 * Credit at risk, bucketed by how soon it lapses.
 *
 * Only present when at least one pack carried a usable `expiresAtMs` — a card
 * must never read "we were not told when anything expires" as "nothing is
 * about to lapse".
 */
export interface TraeWebCreditExpiry {
  within24h: TraeWebExpiringCredits
  within3d: TraeWebExpiringCredits
  within7d: TraeWebExpiringCredits
  /** Packs already past their end time but still carrying credit. */
  expired: TraeWebExpiringCredits
}

/** Aggregated usage/credit answer rendered by the plugin card. */
export interface TraeWebCredits {
  total: number
  consumed: number
  available: number
  workAvailable: number
  generalAvailable: number
  accounts: readonly TraeWebCreditAccount[]
  /**
   * Credit lapsing soon, for the card's warning banner.
   *
   * Derived from the per-pack {@link TraeWebCreditAccount.expiresAtMs} the
   * `/usage` route already carries, so it costs no extra upstream read.
   */
  expiry?: TraeWebCreditExpiry
}

/** Editable Trae model row rendered by the plugin-owned settings card. */
export interface TraeWebModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  input?: ('text' | 'image')[]
  creditMultiplier?: number
  reasoningSupported?: boolean
  reasoning?: {
    supported: string[]
    defaultEffort?: string
  }
  maxContextWindow?: number
  /**
   * Trae's own image-capability flag, as the runtime catalog carries it. The
   * card renders these rows with their image checkbox already ticked so the
   * control matches what DSH is actually told (issue #16); absent means the
   * directory did not declare it, which is not a capability claim either way.
   */
  multimodal?: boolean
  /**
   * The availability verdict from the one-click test, when this card session
   * has run one. Absent = not tested. Deliberately NOT persisted with the
   * settings: it describes one moment on one account, and a stale verdict shown
   * as current is worse than a blank field.
   */
  probe?: TraeModelProbeVerdict
  /** Upstream's own words for the verdict, when it gave any. */
  probeDetail?: string
  /**
   * Trae's discount rule for this row, straight from the directory that
   * advertised it (see src/promo.ts). The CARD decides whether it is live right
   * now: the rule carries weekday/time windows in an upstream-declared zone, so
   * a verdict baked in here would be stale by the next morning.
   */
  activityDiscount?: TraeActivityDiscount
}

/**
 * One model's availability verdict from the one-click test.
 *
 * `unknown` is a first-class outcome, not a failure: a timeout, a proxy drop or
 * a throttle says nothing about the model, and reporting it as unusable would
 * make the user delete a model that works. Only an upstream refusal is negative.
 */
export type TraeModelProbeVerdict =
  | 'available'
  | 'gated'
  | 'unsupported'
  | 'rate_limited'
  | 'auth'
  | 'unknown'

/** What the probe route answers with. */
export interface TraeModelsTestResponse {
  /** One entry per model tested, in the order they were sent. */
  results: { id: string; verdict: TraeModelProbeVerdict; detail: string }[]
  /** Models skipped because the region has no live catalog row for them. */
  skipped?: string[]
}

/**
 * Daily check-in state rendered below the credit stats.
 *
 * The two booleans answer DIFFERENT questions and must never be collapsed into
 * one "done" flag — doing that was a shipped bug (see CHANGELOG 2.3.1):
 *
 *  - `checkedIn` is ACCOUNT-level: today's reward pack exists for this account,
 *    so there is nothing left to claim and the balance already includes it.
 *  - `didCheckedIn` is DEVICE-level: this MACHINE already spent its one
 *    check-in for the day, whichever account spent it. The upstream keys it on
 *    the `x-device-id` in the request and answers it per device, not per
 *    account (measured 2026-09-26: the same account and Beijing day answered
 *    `false` with the header omitted, with a synthetic id, and with another
 *    install's id, and `true` for the device that actually claimed).
 *
 * So `didCheckedIn && !checkedIn` is the "switched account" case: the device's
 * daily check-in is used up, but THIS account was never rewarded. Claiming
 * again is refused upstream (business code 9095, "该设备今日已参与签到"), so
 * the card disables the button — but it must say that, not "claimed today".
 */
export interface TraeWebCheckin {
  checkedIn: boolean
  didCheckedIn: boolean
  credits: number
  enabled: boolean
  extraCredits?: number
}

/** The claim route's answer, so the card can report a business refusal verbatim. */
export interface TraeWebCheckinClaim {
  /** False when the upstream answered a non-zero business code (e.g. 9004). */
  claimed: boolean
  /**
   * True only when THIS ACCOUNT's reward for today already exists, so nothing
   * was sent upstream. Distinct from {@link TraeWebCheckinClaim.deviceCheckedIn}:
   * a device that already claimed for another account leaves this false.
   */
  alreadyCheckedIn: boolean
  /**
   * True when today's check-in was already spent on this DEVICE (by this or
   * another account), so no claim was sent or the upstream refused it with
   * 9095. Not an error: it is the truthful answer to "can this account claim
   * here today?" — no, and the reason is the machine, not the account.
   */
  deviceCheckedIn?: boolean
  code?: number
  message?: string
  /** The refreshed check-in state, present whenever the claim path ran. */
  checkin?: TraeWebCheckin
}

/** One reward activity rule (name + work/general credits when present). */
export interface TraeWebActivity {
  activityId: string
  enabled: boolean
  workCredits?: number
  generalCredits?: number
}

export interface TraeWebAccount {
  id: string
  accountName: string
  edition: 'cn' | 'sg' | 'solo' | 'solo-sg'
  /**
   * Whether this account belongs to a Trae tenant, i.e. may bill the enterprise
   * pool. The enterprise tab lists only these, because the tenant gateway
   * serves a directory to any CN token but refuses a personal account's chat
   * with `4019` — so nothing else reveals the difference until a turn fails.
   */
  enterprise: boolean
  /** Routing bucket of this account, derived from its credential. */
  region: TraeRegion
  source: 'desktop' | 'dsh' | 'cli'
  tokenExpiresAtMs: number
  /**
   * When this account's REFRESH token expires, when the credential carries one.
   *
   * The access token above is renewed automatically — the plugin refreshes it
   * five minutes before it lapses — so by itself it answers "when does this
   * need attention", which is "never, while the refresh token lives". The
   * refresh token is the real horizon: once IT expires the automatic renewal
   * stops working and the user must sign in to Trae again. Before this field the
   * card could only say "auto-renewal", which stays true right up to the moment
   * it silently stops being true.
   */
  refreshExpiresAtMs?: number
  selected: boolean
}

/**
 * Another account on this machine that still has credit, surfaced only while
 * the BOUND account is exhausted (issue #25).
 *
 * The account switch is persisted, so a user whose bound account ran out sees
 * a permanently zeroed card with no explanation. This carries just enough to
 * name the alternative in the UI — identity plus the two CN credit buckets —
 * and is only ever produced by a read-only upstream call.
 */
/**
 * One row of the composer panel's account table: the account and its general
 * balance.
 *
 * `generalAvailable` is optional because the host may not expose
 * `creditsOfAccount` (the table still lists the accounts, with no figure).
 * WORK credits are deliberately absent: the table's single figure is the
 * general bucket, the one the SOLO chat actually spends.
 */
export interface TraeWebAccountCredit {
  id: string
  accountName: string
  selected: boolean
  generalAvailable?: number
}

/**
 * The per-account state shown inside an account row of the card's table.
 *
 * Every locally detected account in a region is rendered as a row; the
 * interesting per-account facts differ by region, which is why this is a union
 * of the three surfaces the card previously showed only for the BOUND account:
 *
 *  - CN rows carry their own check-in state (Trae keys the daily reward per
 *    ACCOUNT, and the one-per-device tally per DEVICE, see {@link TraeWebCheckin})
 *    and their Work/General balances.
 *  - ai rows carry their own subscription / trial status.
 *
 * Each field is optional: a read that fails keeps the row visible (perhaps
 * without a figure) rather than dropping the account and its switch.
 */
export interface TraeWebAccountState {
  /** The account this state belongs to. */
  id: string
  /** CN: today's check-in state of this account (absent for ai rows). */
  checkin?: TraeWebCheckin
  /** CN: this account's Work/General balances (absent for ai rows). */
  credits?: TraeWebCredits
  /** ai: this account's subscription / trial status (absent for CN rows). */
  payStatus?: TraeWebPayStatus
}

export interface TraeWebCreditAlternative {
  id: string
  accountName: string
  edition: TraeWebAccount['edition']
  workAvailable: number
  generalAvailable: number
}

/**
 * One entry of the transfer PREVIEW: display fields only.
 *
 * `hasToken` is a boolean rather than the token itself because this crosses
 * into the browser. The card uses it to pre-select only records that can
 * actually be imported, so a credential-less row is visibly skipped instead of
 * silently counting as an import.
 */
export interface TraeTransferPreviewEntry {
  index: number
  uid: string
  nickname: string
  email: string
  hasToken: boolean
}

/** The parsed shape of an import file, as the card's confirmation step shows it. */
export interface TraeTransferPreview {
  accounts: TraeTransferPreviewEntry[]
  total: number
}

/** The answer to a transfer `import`: how many records landed and how many were skipped. */
export interface TraeTransferImportAnswer {
  imported: number
  skipped: number
}

/** One probed candidate path and why it did not yield an account. */
export interface TraeWebSearchPath {
  path: string
  edition: 'cn' | 'sg' | 'solo' | 'solo-sg'
  source: 'desktop' | 'cli'
  reason: 'missing' | 'unreadable' | 'invalid'
  message?: string
}

/**
 * Peel ONE `{get(): T}` live reference, the shape DSH 0.1.7 delivers a
 * volatile-marked settings field as (see {@link unwrapVolatileDeep}).
 */
export function unwrapVolatile<T>(value: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as unknown as { get: () => T }).get()
  }
  return value
}

/**
 * Deep copy of a value with every `{get(): T}` live reference replaced by the
 * value it resolves to.
 *
 * DSH 0.1.7 hands volatile-marked fields back as live references, and a live
 * reference is still `typeof === 'object'` — so it passes a naive object check
 * and every lookup on it is `undefined`. Worse, spreading one (`{ ...ref }`)
 * does NOT read the field: it produces `{ get: <function> }`. Any merge that
 * spreads a resolved field to preserve its siblings — the card's "write one
 * region, keep the other" write, or the account map's spread — would otherwise
 * DROP every sibling and leak a function into the document.
 *
 * Both halves therefore unwrap before touching a resolved field. This lives in
 * the node-free host↔client bridge because the browser half needs it too.
 *
 * Non-reference values are recursed into so a nested volatile field is caught
 * as well; arrays and objects are rebuilt rather than mutated, so the caller's
 * value is never touched.
 */
export function unwrapVolatileDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (typeof (value as { get?: unknown }).get === 'function') {
    return unwrapVolatileDeep((value as unknown as { get: () => unknown }).get()) as T
  }
  if (Array.isArray(value)) return value.map(entry => unwrapVolatileDeep(entry)) as T
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    out[key] = unwrapVolatileDeep(source[key])
  }
  return out as T
}

/**
 * Read the per-region account selections out of a settings value.
 *
 * SHARED because `accounts` now has TWO writers: the card, and the composer
 * panel's account table (2.14.0). Two writers of one field must use one merge
 * rule, or they drift — and the rule is not obvious.
 *
 * Deep-unwraps first: on DSH 0.1.7 a volatile field arrives as a `{get(): T}`
 * live reference, which passes the `typeof === 'object'` check and would be
 * returned as if it were the map. Every lookup on it is then `undefined`, and
 * the merge (`{ ...configured, [region]: id }`) would spread a reference into
 * `{get: <function>}` — dropping the other region's selection and leaking a
 * function into the settings document.
 */
export function configuredAccountsOf(configured: unknown): Record<string, string> {
  const accounts = (unwrapVolatileDeep(configured) as { accounts?: unknown } | undefined)?.accounts
  return typeof accounts === 'object' && accounts !== null ? accounts as Record<string, string> : {}
}

/**
 * Build the next `regions` settings value for the card's save. The write
 * targets ONLY the signed-in account's region slot; every other region's slot
 * is carried over untouched, so switching accounts never clobbers the other
 * region's picks. Tolerates any stored shape (absent, non-object) by starting
 * from an empty document.
 */
export function nextRegionSlots<Slot extends object>(
  regions: unknown,
  panel: TraePanel,
  slot: Slot,
): Record<string, unknown> {
  // Deep-unwrap first: on DSH 0.1.7 each slot is a `{get(): T}` live reference,
  // and spreading one produces `{get: <function>}` — dropping every field of
  // the sibling region it was meant to preserve.
  const unwrapped = unwrapVolatileDeep(regions)
  const base = typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)
    ? unwrapped as Record<string, unknown>
    : {}
  return { ...base, [panel]: slot }
}

/**
 * Narrow a settings value to the `regions` map. Accepts EITHER the whole
 * settings section (`{ regions: {...}, ... }`) or the `regions` map itself, and
 * unwraps the former. This tolerance is deliberate: passing the whole section
 * where the map was expected was a real shipped bug — the lookup then read
 * `section['cn']` (absent), so the card's checkbox reported `true` forever and
 * clicking it appeared to do nothing even though the write succeeded.
 *
 * Unwraps live references first: on DSH 0.1.7 the `regions` field arrives as a
 * `{get(): T}` reference, which passes the `typeof === 'object'` check below
 * and would otherwise be returned as if it were the map — making every region
 * read back as absent (and the enabled flag read as "on" forever).
 */
function regionsMapOf(value: unknown): Record<string, unknown> {
  const unwrapped = unwrapVolatileDeep(value)
  if (typeof unwrapped !== 'object' || unwrapped === null || Array.isArray(unwrapped)) return {}
  const record = unwrapped as Record<string, unknown>
  const nested = record['regions']
  if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return record
  // THE HOP IS CONDITIONAL, and that is the whole point (a saved manual pool
  // order "disappearing" — the same defect the sibling workbuddy plugin fixed
  // in its 5.5.x line). "Has a `regions` key" is NOT sufficient evidence that
  // the caller passed the whole section: the `regions` MAP can legitimately
  // carry a `regions` key of its own, because an earlier build could write a
  // sibling field name into it. Hopping there means reading a DIFFERENT, older
  // copy of the same panel — the measured symptom in the sibling plugin was the
  // same document returning `['c','a','b']` when read as a section and `[]` when
  // read as a map, so a manual order read back as empty and looked unsaved.
  //
  // A value therefore counts as the whole section only when it shows no key that
  // is a panel id: a map's keys ARE panel ids (possibly plus stray sibling names
  // left by an old writer). A plain (or dirty) `cn` / `enterprise` / `ai` map is
  // returned as-is.
  const panelIds = TRAE_PANELS as readonly string[]
  const outerIsMap = Object.keys(record).some(key => panelIds.includes(key))
  return outerIsMap ? record : nested as Record<string, unknown>
}

/** One region's stored slot as a plain object; any other shape reads as empty. */
function regionSlotOf(value: unknown, panel: TraePanel): Record<string, unknown> {
  const slot = unwrapVolatile(regionsMapOf(value)[panel])
  return typeof slot === 'object' && slot !== null && !Array.isArray(slot)
    ? slot as Record<string, unknown>
    : {}
}

/**
 * Whether one region's provider is switched on. Opt-out semantics: only an
 * explicit `false` disables it, so a config written before this switch existed
 * (and the pre-region-split flat fields, which never carry `enabled`) keep both
 * providers running exactly as before. The Host reads the same rule through
 * `regionStateOf`, so card and Host can never disagree about a region's state.
 *
 * `value` may be the whole settings section or the `regions` map (see
 * {@link regionsMapOf}).
 */
export function regionEnabledOf(value: unknown, panel: TraePanel): boolean {
  // Mirrors the Host's `regionEnabled` EXACTLY, including its one exception:
  // the enterprise panel defaults OFF (a consumer-only account cannot use that
  // pool). Card and Host disagreeing here would make the switch render one
  // state while the route is in the other.
  const stored = regionSlotOf(value, panel)['enabled']
  if (typeof stored === 'boolean') return stored
  return panel !== 'enterprise'
}

/**
 * Build the next `regions` settings value for a provider on/off toggle. ONLY
 * the target region's `enabled` flag changes: every other field of that slot
 * (its directory, selection, image opt-ins, context budgets) and every other
 * region's slot are carried over verbatim, so switching a provider off never
 * discards the user's model picks and switching it back on restores them.
 *
 * This is deliberately separate from {@link nextRegionSlots}: that helper
 * writes a whole slot from a signed-in tab's draft, while this one must work
 * for a region that is signed OUT — which is precisely the region a user wants
 * to switch off (no international install, no international account).
 *
 * `value` may be the whole settings section or the `regions` map; the RETURN
 * value is always the `regions` map, i.e. exactly what `settingsScope.set(
 * 'regions', ...)` needs.
 */
export function nextRegionEnabled(
  value: unknown,
  panel: TraePanel,
  enabled: boolean,
): Record<string, unknown> {
  return nextRegionSlots(regionsMapOf(value), panel, { ...regionSlotOf(value, panel), enabled })
}

/**
 * The two seats this region's credit readout can occupy.
 *
 * `composer` is the composer tool row (`conversation.input.left`); `stats` is
 * the ambient dock below the composer card (`conversation.composer.dock`),
 * beside the shell's own round/step/token pills.
 *
 * WHY THE SEAT IS A CHOICE AT ALL (learned from dsh-connect-workbuddy issue
 * #62): the composer tool row is a LIST seat, so it is shared not only with the
 * shell's own controls but with any other plugin that registers there — and a
 * list seat cannot promise that every occupant is visible. The report behind
 * that issue is exactly that: with a third-party plugin installed the readout
 * stopped appearing. A fixed seat therefore lets one plugin's presence decide
 * another's, so the seat belongs to the user.
 *
 * Named as a union rather than a boolean because a third seat is plausible and
 * a `showAtTop: boolean` would have to be MIGRATED rather than extended.
 */
export type TraeCreditPosition = 'composer' | 'stats'

/**
 * Which seat one region's readout uses, defaulting to the composer row.
 *
 * Anything other than an explicit `'stats'` reads as `'composer'`, which covers
 * the two cases that matter: a profile written BEFORE this setting existed (the
 * composer row was the only seat, so an upgrade moves nothing on screen), and a
 * hand-edited value the schema does not know. Falling back rather than
 * rendering nowhere is deliberate — an unrecognized value must not make the
 * readout disappear, which is the very defect this setting exists to fix.
 *
 * `value` may be the whole settings section or the `regions` map (see
 * {@link regionsMapOf}).
 */
export function regionCreditPositionOf(value: unknown, panel: TraePanel): TraeCreditPosition {
  return regionSlotOf(value, panel)['creditPosition'] === 'stats' ? 'stats' : 'composer'
}

/**
 * Build the next `regions` settings value for one region's credit seat.
 *
 * Same merge rule as every sibling region write: only the target region's
 * `creditPosition` changes, so a seat change cannot drop that slot's model
 * directory, selection, budgets or enabled flag, nor touch the other region.
 *
 * `value` may be the whole settings section or the `regions` map; the RETURN
 * value is always the `regions` map, i.e. exactly what `settingsScope.set(
 * 'regions', ...)` needs.
 */
export function nextRegionCreditPosition(
  value: unknown,
  panel: TraePanel,
  position: TraeCreditPosition,
): Record<string, unknown> {
  return nextRegionSlots(regionsMapOf(value), panel, { ...regionSlotOf(value, panel), creditPosition: position })
}

/**
 * One panel's saved pool PREFERENCES, as the card's settings block edits them.
 *
 * Read from the settings document rather than from the usage answer for the same
 * reason `regionCreditPositionOf` is: the card must paint its controls correctly
 * on the FIRST frame, before any fetch lands, and a control that starts on a
 * default and jumps when data arrives is the "looks like it did nothing" defect.
 *
 * Absent reads as `{}` — every field of {@link TraePoolPreferences} is optional
 * by design, and a profile written by an older build has no `pool` slot at all.
 * The caller applies the defaults it means (OFF, automatic model, no members);
 * this function never invents them, because `targetModelId: ''` and
 * `targetModelId: undefined` mean the same thing and only the CALLER may decide
 * to collapse them.
 *
 * `value` may be the whole settings section or the `regions` map (see
 * {@link regionsMapOf}).
 */
export function regionPoolOf(value: unknown, panel: TraePanel): TraePoolPreferences {
  const unwrapped = unwrapVolatileDeep(regionSlotOf(value, panel)['pool'])
  return typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)
    ? unwrapped as TraePoolPreferences
    : {}
}

/**
 * Build the next `regions` settings value for one panel's pool preferences.
 *
 * Same merge rule as every sibling region write: only the addressed panel's
 * `pool` slot changes, so saving the pool cannot drop that slot's model
 * directory, selection, budgets, enabled flag or credit seat, and cannot touch
 * the other panels. Panels are independent even where they share credentials
 * (`cn` and `enterprise` bill the same Trae CN account): membership is a choice
 * per panel, not per credential.
 *
 * `value` may be the whole settings section or the `regions` map; the RETURN
 * value is always the `regions` map, i.e. exactly what `settingsScope.set(
 * 'regions', ...)` needs.
 */
export function nextRegionPool(
  value: unknown,
  panel: TraePanel,
  pool: TraePoolPreferences,
): Record<string, unknown> {
  return nextRegionSlots(regionsMapOf(value), panel, { ...regionSlotOf(value, panel), pool })
}

/**
 * Build the next `regions` settings value for one panel's MODEL DIRECTORY.
 *
 * The model-directory save REPLACES the whole region slot, so every field of
 * that slot must be carried through — the ones the save does not name are
 * silently dropped. Two were being dropped this way:
 *
 *  - `pool` (issue #44): the account-pool preferences. Enabling the pool and
 *    then saving the model list turned the pool back OFF, and the card came
 *    back showing "not saved" — the switch looked broken.
 *  - `creditPosition`: which seat this region's credit readout occupies, so
 *    saving the model list silently moved the readout back.
 *
 * Both are the user's standing choices, not the model directory's business.
 * The stored slot is therefore SPREAD and the directory fields override it, so
 * the save owns exactly the five fields it knows about and inherits the rest.
 *
 * `value` may be the whole settings section or the `regions` map; the RETURN
 * value is always the `regions` map, i.e. exactly what `settingsScope.set(
 * 'regions', ...)` needs.
 */
export function nextRegionDirectory(
  value: unknown,
  panel: TraePanel,
  directory: {
    enabled: boolean
    lastCatalog: readonly unknown[]
    enabledModelIds: readonly string[]
    imageModelIds: readonly string[]
    contextBudgets: Record<string, number>
  },
): Record<string, unknown> {
  return nextRegionSlots(regionsMapOf(value), panel, { ...regionSlotOf(value, panel), ...directory })
}

/** Subscription status of an international (ai) account, rendered instead of the CN credit packs. */
export interface TraeWebPayStatus {
  isDollarUsageBilling: boolean
  hasPackage: boolean
  isPayFreshman: boolean
  inTrial: boolean
  trialEndTimeMs: number
  enableSoloLite: boolean
  enableSoloBuilder: boolean
  enableSoloCoder: boolean
  enableSoloWeb: boolean
  /** Trae's authoritative tier number (`user_pay_identity`); `0` means Free. */
  payIdentity?: number
  /** Trae's authoritative tier label (`user_pay_identity_str`), e.g. `Free`. */
  payIdentityStr?: string
  fission?: { startTimeMs: number; expireTimeMs: number; maxUsage: number }
}

/**
 * Whether Trae's plan identity says this account is on a paying plan.
 *
 * `has_package` alone is NOT that question — it reports whether a package
 * entitlement row exists, and a member can be on a plan without one (issue
 * #19: a Pro account rendered as "No active package"). Trae spells the plan in
 * `user_pay_identity_str`, so this reads that field, and only the exact word
 * `Free` counts as free: an unknown or future tier name is treated as paid,
 * because claiming "Free" for a tier we simply do not recognise is the more
 * damaging of the two errors.
 */
export function traePlanIsPaid(payIdentityStr: string | undefined): boolean {
  const tier = payIdentityStr?.trim()
  return tier !== undefined && tier !== '' && !/^free$/i.test(tier)
}

/** The JSON document the plugin card renders. */
export type TraeWebUsage =
  | {
    status: 'signed-out'
    accounts: readonly TraeWebAccount[]
    message?: string
    searched?: readonly TraeWebSearchPath[]
    enabled?: boolean
  }
  | {
    status: 'signed-in'
    accountId: string
    accountName: string
    tokenExpiresAtMs: number
    /**
     * When the BOUND account's refresh token expires (absent when the credential
     * carries none). See {@link TraeWebAccount.refreshExpiresAtMs} — this is the
     * horizon that actually matters, because the access token above renews
     * itself until this one lapses.
     */
    refreshExpiresAtMs?: number
    /** Which per-region model directory and selection this account owns. */
    region: TraeRegion
    /** Whether this region's provider is currently offered to DSH. */
    enabled?: boolean
    accounts: readonly TraeWebAccount[]
    models: readonly TraeWebModel[]
    enabledModelIds: readonly string[]
    rawChat?: {
      state: 'disabled' | 'unchecked' | 'available' | 'protocol-gated' | 'authentication' | 'credit' | 'rate' | 'transport' | 'server'
      checkedAtMs?: number
      status?: number
    }
    credits?: TraeWebCredits
    creditsError?: string
    /**
     * Set when this panel has no readable balance by design, rather than by
     * failure. Only `enterprise` does: a tenant's spend is not reported by any
     * endpoint the plugin can reach (every tenant quota path answers 404), so
     * the figure exists solely in the enterprise console. The card must say so
     * instead of rendering the consumer packs, which belong to the personal
     * balance and would be read as the tenant's.
     */
    creditsUnavailable?: 'enterprise'
    /**
     * Present only when the bound account is out of credit AND another account
     * on this machine has some (issue #25). The card then offers a one-click
     * switch instead of leaving a permanently empty panel. Absent in every
     * other case so a healthy account never pays for the extra read.
     */
    alternatives?: readonly TraeWebCreditAlternative[]
    /**
     * Daily check-in state (CN only). Absent on the international region,
     * whose check-in surface does not exist — probed 2026-09-24: the
     * `/trae/api/v2/ug/*` family answers 404 on every ai gateway, so the card
     * shows no claim button there rather than a button that cannot work.
     */
    checkin?: TraeWebCheckin
    checkinError?: string
    /** Subscription status of an international account (region ai only). */
    payStatus?: TraeWebPayStatus
    payStatusError?: string
    /**
     * This panel's account-pool state, when the Host build supports it.
     *
     * Absent on a Host without pool support, so the card renders no pool section
     * instead of an empty one. Assembled LAST in the status document and never
     * allowed to fail it: the pool reads per-account credit, and one dead account
     * must not blank out the panel the user is looking at.
     */
    pool?: TraeWebPool
  }
  | { status: 'error'; message: string }
