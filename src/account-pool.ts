/**
 * The account pool: which local Trae account should be billed, and why.
 *
 * 参考：`dsh-connect-workbuddy` 的 `src/account-pool.ts`（同一套「打分 + 排序 +
 *   挑免费模型」的纯逻辑）。本文件的规则与该实现**逐条对齐**，只在 Trae 上游
 *   确实不同的地方分叉，分叉处都在注释里点名原因。
 * 改动： trae 侧的原料不是「一个积分数」而是 `workAvailable` / `generalAvailable`
 *   两个桶（SOLO 聊天只花 General），快到期原料来自 `TraeWebCredits.expiry`
 *   的分桶（24h/3d/7d），面板有三个（cn / enterprise / ai）而不是两个区域。
 *
 * 本模块只做**纯逻辑**（打分、排序、挑免费模型、判定出池原因），不碰网络、
 * 不碰文件系统，以便单测直接钉住这些规则 —— 它们包含四条猜不出来、必须显式
 * 表达的结论：
 *
 *   1. **`creditMultiplier` 缺失不等于免费。** Trae 国内版的静态 fallback 目录
 *      **整份都没有**该字段（`src/catalog.ts`），所以「没有倍率」在 cn 是常态。
 *      把 `undefined` 当作 0 会让批量测试在首次目录刷新前拿收费模型去跑真实
 *      chat 调用，直接产生用户没预期的开销。
 *   2. **没有免费模型时不回退到收费模型。** 宁可告知「本面板暂无免费模型」，
 *      也不静默换一个收费模型去跑批量测试。
 *   3. **`rate-limited` 只是暂时出池。** 它恰恰是本功能最想利用的状态（模型
 *      本身没问题），当成永久不可用剔除等于把好账号扔了。
 *   4. **快过期的额度排在额度多的前面**（workbuddy issue #70 的教训）：如果
 *      按额度总额优先，一个当天要清零的账号永远排不到，那笔额度必然作废。
 *
 * @module dsh-connect-trae/account-pool
 */

import type { TraeModelInfo } from './catalog.ts'
import type { TraePanel } from './region.ts'
import type { TraeWebCreditExpiry } from './status-paths.ts'

/**
 * Which of the pool's writers produced a measurement.
 *
 * `test-batch` — the user pressed "test" (or the check-in batch), so the outcome
 *   is a deliberate measurement of the target model.
 * `live-request` — a real chat request failed and its failure was recorded so the
 *   NEXT request starts from a measurement instead of rediscovering the same wall.
 *
 * The distinction is diagnostic, not behavioural: both feed the same routing and
 * cooling logic. It exists so a user who watched an account measure `ok` and
 * later saw it limited can tell whether that was a later live failure (expected)
 * or an older value winning (a bug).
 */
export type TraePoolProbeSource = 'test-batch' | 'live-request'

/** One account's pool entry: what the picker needs, plus its last measurement. */
export interface TraePoolAccount {
  /** Stable account id (the same one `TraeWebAccount` carries). */
  id: string
  /** Human name, or `''` when the desktop app recorded none. */
  accountName: string
}

/**
 * What the pool knows about ONE account's last test of the target model.
 *
 * `undefined` means "never tested", which is deliberately distinct from every
 * measured outcome: an untested account is a candidate (the user may want to use
 * it now) whereas a measured failure is not. Collapsing the two would make a
 * fresh pool look empty until the first test.
 */
export interface TraePoolProbe {
  outcome: TraePoolOutcome
  /** When this measurement was taken, in epoch ms. */
  atMs: number
  /** WHAT WROTE this measurement; absent for records written before it existed. */
  source?: TraePoolProbeSource
  /**
   * When this account may be usable again, when the upstream stated a time.
   *
   * Present for a `rate-limited` / `out-of-credit` outcome whose failure carried
   * a reset sentence. ABSENT when the upstream named no time — that absence is
   * meaningful and must never be turned into a locally invented countdown.
   */
  retryAtMs?: number
  /**
   * The upstream's own words on the failure, already redacted.
   *
   * Kept so the card can say WHY an account left the pool instead of repeating
   * one generic sentence for a DNS failure, a gateway 502 and a cancelled request
   * alike.
   */
  message?: string
  /**
   * WHICH MODEL this measurement is about.
   *
   * `1005` (plan gate), `4001` (no SOLO function serves this `config_name`) and
   * `4011` (throttle) are all ACCOUNT × MODEL conditions: the same credential
   * answers other models at the same second. A row rendered as plain "可用"
   * therefore claims more than the measurement says. Storing the model id is what
   * makes the claim checkable.
   *
   * Deliberately NOT inherited when an update omits it — the opposite of
   * `accountName` and `retryAtMs`. Those describe the ACCOUNT (still true when a
   * later writer cannot see them); the model describes THIS measurement, and
   * carrying an older id forward would relabel a fresh measurement with a model
   * it was not taken on.
   */
  modelId?: string
  /**
   * The account's display name AT THE MOMENT IT WAS MEASURED.
   *
   * Stored because a saved pool member can outlive its sign-in: once the desktop
   * app drops a login, that id resolves to no listed account and the card has
   * nothing left to render for it. The name was in hand at write time and nowhere
   * afterwards. Snapshots are never refreshed from a LISTING — only a real
   * measurement writes this.
   */
  accountName?: string
}

/** One account's live credit situation, as the pool ranks it. */
export interface TraePoolCredits {
  /** Remaining credit across every pack (`available` of the upstream snapshot). */
  total: number
  /** The Work bucket, kept for display: SOLO chat does NOT spend it. */
  workAvailable?: number
  /** The General bucket, kept for display: this is what SOLO chat spends. */
  generalAvailable?: number
  /** Credits expiring within the card's WIDEST forward window (7 days). */
  expiringSoon: number
  /** When the nearest at-risk pack expires, if any does. */
  nearestExpiryMs?: number
}

/**
 * Project one account's credits onto the pool's ranking shape.
 *
 * THE HORIZON IS 7 DAYS, NOT 3 (issue #102). The card's expiry notice reports
 * the tightest NON-EMPTY tier, which is often the 7-day one; using `within3d`
 * here made the ranking blind to exactly the credit the user was warned about.
 * Two accounts with nothing lapsing in 3 days but credit lapsing in 7 both
 * projected `expiringSoon: 0`, so the "spend what lapses first" rule —
 * the whole point of {@link rankPool}'s expiry key — never fired and ranking
 * fell through to total credits. The 7-day bucket is cumulative and nested, so
 * its `earliestExpiresAtMs` is also the 24-hour bucket's soonest time: reading
 * the wider bucket does not lose urgency, it only stops ignoring credit.
 */
export function poolCreditsOf(credits: {
  total: number
  generalAvailable: number
  workAvailable: number
  expiry?: TraeWebCreditExpiry
}): TraePoolCredits {
  const within7d = credits.expiry?.within7d
  return {
    total: credits.generalAvailable,
    generalAvailable: credits.generalAvailable,
    workAvailable: credits.workAvailable,
    expiringSoon: within7d?.total ?? 0,
    ...within7d?.earliestExpiresAtMs === undefined ? {} : { nearestExpiryMs: within7d.earliestExpiresAtMs },
  }
}

/**
 * Everything the ranking rule reads about one account. Assembled by the Host from
 * the credential store, the per-account credit read, and the runtime probe store
 * — this module only consumes it.
 */
export interface TraePoolMember {
  account: TraePoolAccount
  credits?: TraePoolCredits
  probe?: TraePoolProbe
  /** When the stored credential expires, used as the final tie-break. */
  tokenExpiresAtMs?: number
}

/**
 * How one account answered the target model.
 *
 * The first nine values are the workbuddy taxonomy verbatim so the two cards read
 * the same. The tenth, `plan-gated`, is Trae-only: upstream `1005` says THIS
 * account's plan does not cover this model while another account's plan may, and
 * no amount of waiting changes a plan — so it must not be folded into
 * `credential-rejected` (which would demand a re-login) nor into
 * `policy-rejected` (which means a content filter tripped on ONE request).
 */
export type TraePoolOutcome =
  | 'ok'
  | 'rate-limited'
  | 'model-busy'
  | 'out-of-credit'
  | 'credential-rejected'
  | 'policy-rejected'
  | 'plan-gated'
  | 'unavailable'
  | 'not-found'
  | 'failed'

/**
 * Why one account was excluded from being billed.
 *
 * Reported per account rather than collapsed into one "no candidate" answer,
 * because these reasons call for completely different actions (wait / re-auth /
 * top up / upgrade the plan / pick another model), and the card has to say which
 * one applies.
 */
export type TraePoolExclusion =
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

/** One ranked account: its score, and whether it can serve right now. */
export interface TraePoolRanked {
  account: TraePoolAccount
  /** Higher wins. Only comparable between rows of the same ranking call. */
  score: number
  /** Absent when the account is a candidate; set when it is excluded. */
  excludedBy?: TraePoolExclusion
}

/**
 * How long an account stays out of the pool when the upstream stated no time.
 *
 * A conservative FALLBACK, not a measurement: it applies whenever a failed
 * outcome carries no `retryAtMs` — every rate limit that came without a reset
 * sentence AND every transient failure (a transport error, a 5xx). In both cases
 * "when can I use this again" has no honest answer.
 *
 * The two failure directions it avoids: keeping the account in the pool would
 * re-bill it immediately and re-trip the same limit; dropping it FOREVER would
 * discard a working account over an event that said nothing about it. A short,
 * stated cooldown is the least-wrong of the two — and it is what lets the pool
 * heal itself, since nothing else re-probes an excluded member.
 */
export const POOL_UNKNOWN_COOLDOWN_MS = 30 * 60_000

/**
 * How long a MODEL-scoped throttle benches its account.
 *
 * Short on purpose. Trae's `4011` is its own rate limit on a ROUTE — its text
 * says so — and `src/model-probe.ts` records the lesson (issue #33): reporting a
 * throttle as "this model is dead" told users a working model was broken. Benching
 * the whole account for the generic half-hour fallback on a model-level wall would
 * idle every member at once, because failover walks the pool and each member hits
 * the same wall.
 */
export const MODEL_BUSY_COOLDOWN_MS = 2 * 60_000

/**
 * Whether one account can be billed at `nowMs`.
 *
 * Returns the exclusion reason, or undefined when the account is a candidate.
 * The order matters and is NOT arbitrary:
 *
 * - A `credential-rejected` account is excluded regardless of any cooldown: its
 *   token is not accepted, so waiting cannot help and the user must re-auth.
 *   (`401` / `403` from Trae, and the `ExchangeToken` rejection of an expired
 *   refresh token, land here.)
 * - A limited, unreachable or failed outcome is checked against its stated (or
 *   fallback) cooldown, so an account whose limit has already reset — or whose
 *   gateway blipped once — is back in the pool without needing another test.
 * - An `ok` measurement, and no measurement at all, are both candidates. The
 *   latter matters: a freshly discovered account has never been tested and must
 *   not be invisible.
 *
 * `not-found`, `credential-rejected` and `plan-gated` deliberately get NO
 * cooldown: one describes a model this channel does not serve (a catalog fact),
 * one needs the user to sign in again, and one needs a plan change. None is fixed
 * by waiting, and pretending otherwise would re-bill a state the upstream has
 * already refused.
 *
 * `policy-rejected` is NOT the `default` branch: a content-policy refusal is a
 * fact about ONE REQUEST, not about the account, so the account stays a candidate
 * exactly like `ok`. The measurement is still recorded so the card can explain
 * what happened.
 *
 * An outcome this build does not know becomes `unusable` rather than a candidate:
 * billing through a state we cannot interpret is worse than leaving the account
 * out until a later version explains it.
 */
export function exclusionOf(
  probe: TraePoolProbe | undefined,
  nowMs: number,
): TraePoolExclusion | undefined {
  if (probe === undefined) return undefined
  switch (probe.outcome) {
    case 'ok':
      return undefined
    case 'credential-rejected':
      return 'credential-rejected'
    case 'not-found':
      return 'not-found'
    case 'plan-gated':
      return 'plan-gated'
    case 'unavailable':
      return retryDue(probe, nowMs) ? undefined : 'unavailable'
    case 'failed':
      return retryDue(probe, nowMs) ? undefined : 'failed'
    case 'rate-limited':
      return retryDue(probe, nowMs) ? undefined : 'rate-limited'
    case 'model-busy':
      // The model is loaded, not the account. It STILL leaves the pool — a request
      // billed to it right now would hit the same wall — but on its own short
      // clock, never the half-hour fallback that turns one busy minute into a
      // pool-wide outage.
      return retryDue(probe, nowMs, MODEL_BUSY_COOLDOWN_MS) ? undefined : 'model-busy'
    case 'out-of-credit':
      return retryDue(probe, nowMs) ? undefined : 'out-of-credit'
    case 'policy-rejected':
      return undefined
    default:
      return 'unusable'
  }
}

/**
 * Whether an account's cooldown has elapsed (or was never stated).
 *
 * The fallback is the ONLY thing a transient outcome relies on: `retryAtMs` is
 * attached for a rate limit or a drained quota, never for a transport failure, so
 * `atMs + POOL_UNKNOWN_COOLDOWN_MS` is what brings those back.
 *
 * `fallbackMs` lets one outcome carry a SHORTER clock than the generic one. It is
 * a parameter rather than a second function so every outcome shares one definition
 * of "due".
 */
function retryDue(
  probe: TraePoolProbe,
  nowMs: number,
  fallbackMs: number = POOL_UNKNOWN_COOLDOWN_MS,
): boolean {
  const until = probe.retryAtMs ?? probe.atMs + fallbackMs
  return nowMs >= until
}

/**
 * Rank a pool's members best-first.
 *
 * The rule, in priority order — this is the whole feature:
 *
 * 1. **Usability.** Only accounts that can be billed right now are candidates;
 *    they always outrank every excluded one.
 * 2. **Expiring credits first, soonest first.** Points about to expire are worth
 *    exactly zero after they do, so spending them before they lapse is strictly
 *    better than saving them.
 * 3. **Largest expiring amount.** Between two accounts that both have expiring
 *    points, the one with more at risk goes first.
 * 4. **Credits, highest first.** Among accounts with nothing expiring, spend the
 *    one with the most, so a nearly-drained account is conserved.
 * 5. **Freshest credential.** Tie-break so a stale token never wins a draw.
 * 6. **Account id.** Final tie-break, making the order TOTAL: two accounts equal on
 *    every key would otherwise keep the caller's array order, so the same pool
 *    could rotate differently between two runs.
 *
 * WHY EXPIRY OUTRANKS SIZE (workbuddy issue #70). These used to be strict
 * lexicographic keys: total, THEN expiry. Since totals are almost never exactly
 * equal, the expiry rule was unreachable — an account with 196 points lapsing that
 * day ranked LAST behind accounts that expire weeks later, simply because it held
 * ~1,200 fewer points overall. It was never selected, so those points always
 * lapsed. A "use it or lose it" rule that another rule completely shadows is not a
 * tie-break, it is dead code.
 *
 * WHY SPENDING THE SMALL EXPIRING ACCOUNT IS STILL RIGHT. Credits are fungible, so
 * using the rich account instead does not preserve the 1 point — it spends the 1
 * point's chance and loses it. Using the expiring account spends a point that was
 * going to be lost anyway, and the rich account is still there for the next
 * request. The only real cost is a failover round-trip if the expiring account
 * cannot cover a whole request, which the exclusion/failover path already absorbs.
 *
 * Excluded accounts are still RETURNED (sorted after the candidates) so the card
 * can explain why each is out; they differ from candidates by `excludedBy` being
 * set, never by being silently dropped.
 *
 * Pure and total: the same input always yields the same order, and it never throws
 * on missing data (an account with no credits is ranked as 0, not crashed on).
 */
export function rankPool(
  members: readonly TraePoolMember[],
  nowMs: number,
): TraePoolRanked[] {
  const rows = members.map(member => {
    const excludedBy = exclusionOf(member.probe, nowMs)
    return {
      account: member.account,
      score: scoreOf(member),
      ...excludedBy === undefined ? {} : { excludedBy },
      // Ordering keys below the primary score; not part of the public row.
      _usable: excludedBy === undefined,
      // `expiringSoon` is an AMOUNT (credits) and `nearestExpiryMs` is a
      // TIMESTAMP. Comparing them directly would be a units error, so they stay
      // two separate keys.
      _atRisk: (member.credits?.expiringSoon ?? 0) > 0,
      _expiringAmount: member.credits?.expiringSoon ?? 0,
      _expiring: member.credits?.nearestExpiryMs ?? Number.POSITIVE_INFINITY,
      _tokenExpiresAtMs: member.tokenExpiresAtMs ?? 0,
    }
  })
  rows.sort((left, right) => {
    if (left._usable !== right._usable) return left._usable ? -1 : 1
    // Expiring credits before anything else among usable accounts.
    if (left._atRisk !== right._atRisk) return left._atRisk ? -1 : 1
    // Both at risk: whichever lapses FIRST goes first.
    if (left._atRisk && right._atRisk && left._expiring !== right._expiring) {
      return left._expiring - right._expiring
    }
    // Same expiry (or neither at risk): the larger amount at stake wins, which for
    // accounts with nothing expiring falls through to total credits.
    if (left._expiringAmount !== right._expiringAmount) {
      return right._expiringAmount - left._expiringAmount
    }
    if (left.score !== right.score) return right.score - left.score
    if (left._tokenExpiresAtMs !== right._tokenExpiresAtMs) {
      return right._tokenExpiresAtMs - left._tokenExpiresAtMs
    }
    // Ids are unique, so this makes the order TOTAL.
    return left.account.id < right.account.id ? -1 : left.account.id > right.account.id ? 1 : 0
  })
  return rows.map(({ account, score, excludedBy }) => ({
    account,
    score,
    ...excludedBy === undefined ? {} : { excludedBy },
  }))
}

/**
 * The checked ids that still resolve to a local sign-in, in the caller's order.
 *
 * This is THE definition of "effective members". It exists because the same
 * predicate wants to be written in several places (the status document, the batch
 * route's empty-pool guard, the host dependency the card reads) and "fixed one
 * end, missed the other" is this project's most productive bug shape, so the rule
 * has one home and every site delegates to it.
 *
 * ORDER IS THE CALLER'S: the answer preserves the order of `orderedIds`. Callers
 * pass whichever list's order they want to show — the saved list for the user's
 * own order, the store's roster for the account table's.
 */
export function effectiveMembersOf(
  orderedIds: readonly string[],
  listedIds: ReadonlySet<string>,
): string[] {
  return orderedIds.filter(id => listedIds.has(id))
}

/**
 * The members that may actually be billed, in the store's order.
 *
 * Three rules in one place, because a request path and a batch that each decide
 * "who counts" separately is how a pool ends up billing an account the user did
 * not opt into:
 *
 * - the SAVED opt-in list is the roster (`effectiveMembersOf` — an id the user
 *   never selected, or one this machine no longer has, is not a candidate);
 * - `triedIds` are the accounts that already failed THIS request, so a failover
 *   never walks back into the one that just refused it;
 * - a ghost (saved but not listed) is absent from `members`, so it drops out here
 *   without a second check.
 *
 * An EMPTY `savedIds` yields an empty result on purpose: an enabled pool with no
 * members bills nobody, rather than silently meaning "all of them".
 */
export function billableMembers(
  members: readonly TraePoolMember[],
  savedIds: readonly string[],
  triedIds: readonly string[] = [],
): TraePoolMember[] {
  const saved = new Set(effectiveMembersOf(savedIds, new Set(members.map(member => member.account.id))))
  const tried = new Set(triedIds)
  return members.filter(member => saved.has(member.account.id) && !tried.has(member.account.id))
}

/**
 * The account to bill, or undefined when the pool has no usable member.
 *
 * A thin selector over {@link rankPool} so the winner is decided in exactly one
 * place: every caller that needs "who serves now" gets the same answer.
 */
export function pickAccount(
  members: readonly TraePoolMember[],
  nowMs: number,
): TraePoolAccount | undefined {
  return rankPool(members, nowMs).find(row => row.excludedBy === undefined)?.account
}

/**
 * The credit figure used for ordering.
 *
 * Absent credits rank as zero. Deliberately NOT "unknown ranks first": an account
 * whose balance could not be read must never outrank one we positively know is
 * full, or a failing credit read would capture all the traffic.
 */
function scoreOf(member: TraePoolMember): number {
  return member.credits?.total ?? 0
}

/**
 * Pick the free model to test against, from one panel's catalog.
 *
 * "Free" means `creditMultiplier === 0` EXACTLY. An absent multiplier is NOT free:
 * the CN static fallback catalog carries no multiplier at all, so treating absence
 * as zero would silently bill real credits on a "free" probe.
 *
 * Among the free candidates the LARGEST context window wins, because the probe
 * sends a real payload and a long-conversation probe is the point.
 *
 * Returns undefined when the panel has no free model, which the caller must render
 * as "none available" — never as a fallback to a paid model.
 */
export function pickFreeModel(
  catalog: readonly TraeModelInfo[],
): TraeModelInfo | undefined {
  let best: TraeModelInfo | undefined
  for (const model of catalog) {
    if (model.creditMultiplier !== 0) continue
    if (best === undefined || (model.contextWindow ?? 0) > (best.contextWindow ?? 0)) best = model
  }
  return best
}

/**
 * Where the pool's target model came from.
 *
 * `stale` is its own state rather than being folded into `none`: "this panel has
 * no free model" and "the model you saved is no longer offered" need opposite
 * advice (refresh the catalog / pick another model), and collapsing them would make
 * the card say the wrong one.
 */
export type TraePoolTargetSource = 'preferred' | 'free' | 'none' | 'stale'

/** The resolved target model, and where the choice came from. */
export interface TraePoolTarget {
  /**
   * The model a batch may test, present ONLY when it is safe to run.
   *
   * Deliberately ABSENT for `stale`: every existing guard refuses on a missing id,
   * so omitting it means a caller that forgets to check `source` still fails safe
   * instead of spending credits on an unverifiable model.
   */
  modelId?: string
  /** The saved id that could not be resolved; present only for `stale`. */
  staleModelId?: string
  source: TraePoolTargetSource
}

/**
 * Resolve the model the pool should test against.
 *
 * A user-specified id always wins (it is a preference, not a computed default) and
 * is returned even when it is a PAID model: the card says so explicitly rather than
 * silently overriding the user's choice.
 *
 * The choice is VALIDATED against the panel's catalog, because the catalog changes:
 * the CN roster is empty until its first refresh, and models come and go. A saved
 * id that is no longer offered used to be returned as `preferred`, which let the
 * card enable its test button and the host run a batch against a model nobody
 * offers. It is reported as `stale` instead — never silently replaced by the free
 * model (that would test something the user did not choose) and never run.
 */
export function resolveTargetModel(
  catalog: readonly TraeModelInfo[],
  preferredId: string | undefined,
): TraePoolTarget {
  if (preferredId !== undefined && preferredId !== '') {
    return catalog.some(model => model.id === preferredId)
      ? { modelId: preferredId, source: 'preferred' }
      : { staleModelId: preferredId, source: 'stale' }
  }
  const free = pickFreeModel(catalog)
  return free === undefined ? { source: 'none' } : { modelId: free.id, source: 'free' }
}

/**
 * A latest-wins guard for one panel's asynchronous work.
 *
 * Exists because `applyPoolSelection` awaits (it fetches credits per member), so two
 * overlapping calls can interleave: a slow call that read "the pool is ON" can
 * resume AFTER a newer call cleared the override for "the pool is OFF" and write the
 * stale account back — leaving the card showing the pool switched off while a
 * rotated account is still billed.
 *
 * `begin()` claims a new generation and returns a probe; the caller must check it
 * after EVERY await and bail when it reports stale. Extracted as a pure factory
 * rather than inlined so the rule is unit-testable.
 */
export function createLatestWins<Key extends string>(): {
  begin(key: Key): () => boolean
} {
  const generations: Partial<Record<Key, number>> = {}
  return {
    begin(key: Key): () => boolean {
      const generation = (generations[key] ?? 0) + 1
      generations[key] = generation
      return () => generations[key] !== generation
    },
  }
}

/**
 * Map one Trae probe verdict onto the pool's outcome vocabulary.
 *
 * The mapping is the whole bridge between `src/model-probe.ts` (which answers a
 * QUESTION ABOUT A MODEL) and the pool (which must decide a FACT ABOUT AN ACCOUNT),
 * so every row states which side it is reading:
 *
 *  - `available`      → `ok`.
 *  - `auth`           → `credential-rejected`: 401/403 means THIS token is refused;
 *    waiting cannot help and the user must sign in again.
 *  - `gated` (`1005`) → `plan-gated`: the account's plan does not cover this model,
 *    which is an ACCOUNT fact (a paying account may pass) but not one that heals on
 *    a clock.
 *  - `rate_limited`   → `rate-limited`: `4011` or an honest 429 — transient by
 *    definition, so it cools down rather than leaving the pool forever.
 *  - `unsupported`    → `not-found`: `4001` says no SOLO function serves this
 *    `config_name`. It is MODEL-scoped, so the recorded `modelId` is what keeps the
 *    row honest, and nothing about the account changes by waiting.
 *  - `unknown`        → `failed`: a timeout, a transport error or a proxy problem.
 *    It cools down (it is not a statement about the account) and carries the
 *    upstream text so the user can retest.
 *
 * There is deliberately NO Trae source for `model-busy`, `out-of-credit` and
 * `policy-rejected` in this table — they are produced by the live-request path
 * (`src/account-pool.ts` has no network), from `4008` (quota exhausted) and from a
 * content refusal. A verdict NOT in this table falls through to `failed`, so a new
 * upstream verdict can never silently mean "healthy".
 */
export function outcomeOfVerdict(verdict: string): TraePoolOutcome {
  switch (verdict) {
    case 'available':
      return 'ok'
    case 'auth':
      return 'credential-rejected'
    case 'gated':
      return 'plan-gated'
    case 'rate_limited':
      return 'rate-limited'
    case 'unsupported':
      return 'not-found'
    default:
      return 'failed'
  }
}

/**
 * Whether this outcome means "the account is fine, the MODEL was the problem".
 *
 * The card uses it to caption a green/red row as a statement about the target model
 * rather than about the account — the reading workbuddy had to learn the hard way
 * (an `ok` for model X is not an `ok` for model Y).
 */
export function outcomeIsModelScoped(outcome: TraePoolOutcome): boolean {
  return outcome === 'not-found' || outcome === 'plan-gated' || outcome === 'model-busy'
}

/** Whether this outcome means "the credential itself is refused; sign in again". */
export function outcomeIsCredential(outcome: TraePoolOutcome): boolean {
  return outcome === 'credential-rejected'
}

/**
 * Which pool a panel's members belong to, for the on-disk probe store and the
 * `pool` settings slot.
 *
 * `enterprise` is its OWN bucket even though it shares the CN credential store:
 * an account that serves the personal SOLO channel says nothing about whether it
 * passes the tenant gate (`4019` is only revealed at the first chat), so measuring
 * one must not silently answer the other.
 */
export function poolKeyOfPanel(panel: TraePanel): TraePanel {
  return panel
}

/**
 * WHY THERE IS NO SCHEDULER HERE.
 *
 * Like the reference implementation, this module carries no timer: rotation is a
 * PERSISTENT change of who pays while failover is a PER-REQUEST borrow of another
 * account, and having both with an automatic re-test on a clock made "who is being
 * billed right now" unanswerable on one card. Recovery is expressed as the cooldown
 * in {@link exclusionOf} instead, which needs no timer: it is evaluated at ranking
 * time, so a cooled-down member simply becomes a candidate again on the next
 * request.
 */
