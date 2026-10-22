import type { TraeCredential } from './auth.ts'
import { parseTraeRemoteModel, type TraeDiscoveredModel } from './model-metadata.ts'
import { REGION_GATEWAYS, regionOfCredential, type TraeRegion } from './region.ts'
import { TRAE_DIRECTORY_FUNCTIONS } from './solo.ts'

export const TRAE_SOLO_REMOTE_BASE = 'https://solo.trae.cn/api/remote/v1'

/**
 * Remote-directory functions to ask for, per region.
 *
 * The remote `/models` answer is **grouped by function** and the groups are not
 * interchangeable (measured 2026-10-01, issue #19):
 *
 * ```
 * solo_agent        : 19 models   ← superset; also the ONLY source of
 *                                   gpt-6-astra / gpt-5.6-sol|terra|luna /
 *                                   glm-5.2 / gpt-5.5 / Seed-2.1-Turbo
 * solo_agent_remote : 10 models   ← what this client used to read, and all it
 *                                   read: the preferred group only
 * ```
 *
 * `solo_agent` ⊇ `solo_agent_remote`, so reading just the latter hid nine
 * models that the Trae IDE does show — exactly what the reporter saw. Both
 * groups are therefore requested, and every returned group is unioned.
 *
 * Asking for a function the gateway does not serve is harmless: unknown names
 * are ignored rather than rejected (`solo_work_remote` returns no group on
 * `ai`, and the request still answers HTTP 200).
 *
 * `chat_v3` was added on 2026-10-01 (issue #19 follow-up) because it carries
 * three ai-region models that appear in NO other group — `deepseek-v3.2`,
 * `gemini-3-flash-premium`, `gemini_2.5_flash_premium` — and those three are
 * callable through it (see TRAE_DIRECTORY_FUNCTIONS in solo.ts).
 *
 * Both regions now ask the SAME group list (2026-10-02). CN previously asked
 * only `solo_agent_remote` + `solo_work_remote`, which left its `solo_coder`
 * group (12 models) unread — the same shape of miss as the ai one. Every group
 * below was measured to exist on both gateways; a region that does not serve a
 * name simply returns no group for it, which the union tolerates. Reading costs
 * one query and the merge no longer discards rows for lacking a wire match (see
 * mergeTraeModelSources), so an unread group is a model silently missing from
 * the user's own list — the failure this list exists to prevent.
 *
 * `builder_v3` is included for the same reason even though neither region's
 * current wire lists name it: its rows are real directory entries, and whether
 * a paying account can call one is not something this client can determine.
 *
 * The IDE's own function list is wider still, and issue #46 showed what the
 * gap costs. The Trae IDE asks for 22 functions (see TRAE_MODEL_DETAIL_FUNCTIONS
 * in model-detail.ts); the list below asked for 7, and the groups the plugin
 * did not ask about hid real models. Measured 2026-10-22 on a live CN
 * credential: asking the Remote directory for the IDE's list as well returned
 * **41** models instead of **33**, and the eight extra rows were real models
 * the plugin could not show — `kimi-k2` (the `Kimi-K2-0905` snapshot, which
 * lives under `inline_chat` ALONE), `doubao_1_8` (`Doubao-Seed-1.8`),
 * `deepseek-V3`, `deepseek-V3.1`, `doubao-2.0-mini`, `glm-4.7`,
 * `code-review-judge`, `multimodal_image_kimi-k2.5`.
 *
 * The five functions added here are the ones that carry a MODEL (as opposed to
 * a helper config): `chat`, `inline_chat`, `solo_agent_lite`,
 * `solo_design_lite`, `solo_design_remote`. The remaining IDE functions
 * (`ui_builder_v2`, `builder`, `solo_builder`, `git_ai`, `utils`,
 * `code_reviewer`, `code_review_summary`, `custom_agent_generation`,
 * `multimodal`, `system_diagnosis`) are asked too, for the same reason
 * `builder_v3` is: a row is a row, and the merge decides what to do with it.
 * Asking for a function the gateway does not serve is harmless — unknown
 * names are ignored rather than rejected.
 */
export const TRAE_REMOTE_DIRECTORY_FUNCTIONS: Readonly<Record<TraeRegion, readonly string[]>> = {
  cn: [
    'solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3',
    'chat', 'inline_chat', 'solo_agent_lite', 'solo_design_lite', 'solo_design_remote',
  ],
  ai: [
    'solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3',
    'chat', 'inline_chat', 'solo_agent_lite', 'solo_design_lite', 'solo_design_remote',
  ],
}

export interface TraeSoloRemoteCatalogOptions {
  credential(): Promise<TraeCredential>
  fetchImpl?: typeof fetch
  baseUrl?: string
  /**
   * Diagnostics sink (wired to `ctx.logger.warn` by the plugin). Called only
   * on the interesting path — when a NON-official host served the directory
   * or is reused as the remembered first candidate — never on the happy path
   * of official-host-first.
   */
  log?: (message: string, detail?: unknown) => void
}

/**
 * Backup bases for the model directory, in try order after the official base.
 *
 * In restricted (proxy-sandboxed) networks the official catalog host
 * `solo.trae.cn` is behind a CONNECT rejection while the region's chat gateway
 * stays reachable — and that gateway serves the SAME `/api/remote/v1/models`
 * endpoint with an identical response shape (verified against
 * `https://trae-api-cn.mchost.guru/api/remote/v1` 2026-10-20; `chat` already
 * carries `/api/remote/v1`'s parent in {@link REGION_GATEWAYS}). The backup is
 * therefore derived from the region's chat base, mirrored on the remote path;
 * `ai` shares a single host for chat and remote, so it yields no candidate and
 * keeps its single-host behavior. An explicit `baseUrl` disables the chain.
 */
export function traeSoloRemoteFallbackBases(region: TraeRegion, officialBase: string): string[] {
  const backupBase = `${REGION_GATEWAYS[region].chat}/api/remote/v1`
  return backupBase === officialBase ? [] : [backupBase]
}

/**
 * Of two rows for the SAME model id, the one the catalog should keep.
 *
 * The gateway groups its directory by function and reports a model's capacity
 * per group, with the group order varying between calls. Keeping the strongest
 * row makes the published window deterministic. The comparison is
 * LEXICOGRAPHIC and must be applied all the way down, or ordering leaks back in
 * at the next field:
 *
 *  0. the kept row must also carry the promotional rule, which the groups
 *     disagree about — the rule is copied onto the capacity winner, and of two
 *     rules the one that can say more wins (see the comment in the body);
 *  1. a row with a Max tier beats one without (`maxContextWindow` is only set
 *     when the group reported `max_mode: true` with a positive max);
 *  2. two Max rows: the larger max wins;
 *  3. max equal (or absent on both): the WIDER dev window wins;
 *  4. both equal: keep the incumbent, so the model order stays the gateway's.
 *
 * Step 3 is not an afterthought. With equal `max` the first version of this
 * function stopped and kept the incumbent, which left the dev window decided by
 * arrival order — measured 2026-10-05: `glm-5.2` came back as `dev=116000` when
 * `chat_v3` won and `dev=200000` when `solo_agent_remote` did, both with
 * `max=1000000` (9 of 30 CN models behaved that way, reported by JiewiW on
 * Windows). A budgeted model still resolved to 1M either way, but the DEFAULT
 * window of an unbudgeted model — what DSH shows and compresses against — was
 * a coin flip, which is the same defect this function exists to remove.
 */
export function preferStrongerRow(
  candidate: TraeDiscoveredModel,
  incumbent: TraeDiscoveredModel | undefined,
): TraeDiscoveredModel {
  if (incumbent === undefined) return candidate
  const winner = strongerCapacityRow(candidate, incumbent)
  // Capacity decides WHICH ROW, but the row it keeps is not necessarily the one
  // carrying the promotional rule: the groups disagree about
  // `features.activity_discount`. Measured 2026-10-21 on a live CN credential,
  // `Doubao-Seed-2.1-Turbo` advertises a `subsidy` rule (50% pay) in some groups
  // and none at all in others, while the group ORDER varies between calls
  // (issue #23). Choosing the rule-carrying row instead would throw away a
  // 1M Max tier, so the rule is carried ACROSS to the capacity winner: both
  // facts survive, and neither depends on the gateway's mood.
  const rule = richerRule(candidate.activityDiscount, incumbent.activityDiscount)
  if (rule === undefined || rule === winner.activityDiscount) return winner
  return { ...winner, activityDiscount: rule }
}

/**
 * Step 0's tie-break: of two rules for the same model id, the one that can say
 * more about this moment. Every parsed rule already passed `enable: true` (see
 * parseTraeActivityDiscount), so the ranking is: an upstream "right now"
 * discount first, then the rule covering more clock. Two rules that rank EQUAL
 * are compared by their canonical content, so the answer depends on the rule
 * documents and never on which group the gateway answered first (issue #23).
 */
function richerRule(
  candidate: TraeDiscoveredModel['activityDiscount'],
  incumbent: TraeDiscoveredModel['activityDiscount'],
): TraeDiscoveredModel['activityDiscount'] {
  if (candidate === undefined) return incumbent
  if (incumbent === undefined) return candidate
  const score = (rule: NonNullable<TraeDiscoveredModel['activityDiscount']>): number => {
    const live = rule.current !== undefined && (rule.current.discountType ?? 'none') !== 'none' ? 1 : 0
    return live * 1000 + (rule.offPeak?.windows.length ?? 0)
  }
  const candidateScore = score(candidate)
  const incumbentScore = score(incumbent)
  if (candidateScore !== incumbentScore) return candidateScore > incumbentScore ? candidate : incumbent
  return canonicalRule(candidate) < canonicalRule(incumbent) ? candidate : incumbent
}

/**
 * Content-only identity for two rules that scored the same.
 *
 * The score cannot distinguish, say, two `current: none` rules with two windows
 * each in different hours — and keeping "whichever arrived first" would let the
 * gateway's group order decide whether tonight's badge appears. Key order is
 * normalised (the objects are ours, but a caller may hand us a literal), so
 * equal documents compare equal and the incumbent is kept unchanged.
 */
function canonicalRule(rule: NonNullable<TraeDiscoveredModel['activityDiscount']>): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(item => canonical(item))
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return JSON.stringify(canonical(rule))
}

/** Steps 1–4 of the documented order: the row advertising the stronger capacity. */
function strongerCapacityRow(
  candidate: TraeDiscoveredModel,
  incumbent: TraeDiscoveredModel,
): TraeDiscoveredModel {
  const candidateMax = candidate.maxContextWindow
  const incumbentMax = incumbent.maxContextWindow
  if (candidateMax !== undefined && incumbentMax === undefined) return candidate
  if (candidateMax === undefined && incumbentMax !== undefined) return incumbent
  if (candidateMax !== undefined && incumbentMax !== undefined && candidateMax !== incumbentMax) {
    return candidateMax > incumbentMax ? candidate : incumbent
  }
  // Equal Max (or neither advertises one): the wider dev window wins.
  return (candidate.contextWindow ?? 0) > (incumbent.contextWindow ?? 0) ? candidate : incumbent
}

/**
 * Region-scoped request dressing. The CN portal is `solo.trae.cn` with the
 * CN locale headers; the international directory lives on the shared
 * `coresg-normal.trae.ai` gateway and was verified (2026-09-15) with the
 * English/Singapore headers — both forms are accepted, each region keeps the
 * shape its own portal sends.
 */
function remoteDressing(region: TraeRegion): { referer: string; timezone: string; language: string } {
  return region === 'ai'
    ? { referer: 'https://coresg-normal.trae.ai/', timezone: 'Asia/Singapore', language: 'en' }
    : { referer: 'https://solo.trae.cn/', timezone: 'Asia/Shanghai', language: 'zh-cn' }
}

/**
 * Read-only model catalog client for the SOLO Web API.
 *
 * This deliberately has no chat/session method: the Remote session protocol
 * only exposes a final answer and cannot preserve DSH's structured tool loop.
 */
export class TraeSoloRemoteCatalogClient {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string | undefined
  /**
   * The last base that answered the directory with a NON-EMPTY catalog in this
   * process.
   *
   * A proxy-blocked network pays the failing official attempt on EVERY refresh
   * otherwise, so a backup that has served the catalog is tried first on later
   * refreshes. Putting the official base "second" is NOT enough to re-probe it:
   * the loop returns on the first success, so a backup that keeps answering
   * means the official base is never asked again. The official host is
   * therefore re-probed on a COOLDOWN instead (see {@link OFFICIAL_RETRY_MS}):
   * while the cooldown runs the backup is used and the official host is
   * skipped; when it expires the official host is tried FIRST again, so a
   * healed network takes over within one cooldown window rather than never.
   */
  private lastSuccessfulBase: string | undefined
  /**
   * When the official base may be probed again after a transport/5xx failure,
   * as epoch milliseconds (0 = probe it on the next refresh).
   */
  private officialRetryAtMs = 0
  /**
   * How long a failing official host is skipped before it is re-probed.
   *
   * Long enough that a blocked network stops paying the failing attempt on
   * every refresh (the point of the fallback), short enough that a healed
   * network takes over without a restart. Each probe costs one connect timeout
   * (30 s) in the worst case, so 5 minutes bounds that to ~1 attempt per 5 min.
   */
  private static readonly OFFICIAL_RETRY_MS = 5 * 60_000

  constructor(private readonly options: TraeSoloRemoteCatalogOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl
  }

  private async headers(region: TraeRegion): Promise<Record<string, string>> {
    const credential = await this.options.credential()
    const dressing = remoteDressing(region)
    return {
      'Authorization': `Cloud-IDE-JWT ${credential.accessToken}`,
      'Content-Type': 'application/json',
      'x-trae-client-type': 'web',
      'x-trae-user-timezone': dressing.timezone,
      'x-preferenced-language': dressing.language,
      'Referer': dressing.referer,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  }

  async fetchModels(signal?: AbortSignal): Promise<TraeDiscoveredModel[]> {
    // The directory gateway follows the credential's own region; an explicit
    // baseUrl (tests, diagnostics) still pins the endpoint.
    const credential = await this.options.credential()
    const region = regionOfCredential(credential)
    const officialBase = this.baseUrl ?? REGION_GATEWAYS[region].remote
    const headers = await this.headers(region)
    const functions = TRAE_REMOTE_DIRECTORY_FUNCTIONS[region].join(',')
    // Try the bases in order. The default is official-first; a blocked network
    // (proxy CONNECT rejection of solo.trae.cn) falls through to the chat
    // gateway's mirrored /api/remote/v1 base. Fallback happens ONLY when the
    // attempt failed to connect or answered 5xx — a 401/403/404/429 is a
    // semantic verdict of the host being tried (token problem, proxy policy,
    // missing route) and must not be re-issued against another base.
    //
    // A 200 with an EMPTY catalog is NOT a host failure, but it is not the end
    // of the chain either: it is a statement about THAT host. Treating it as
    // final let a backup that answers 200-but-empty (a mirror that has not
    // synced, a proxy that strips the body) permanently shadow the official
    // host — the empty answer was remembered as "successful", the backup was
    // then tried first on every later refresh, and its empty answer aborted
    // before the official host was ever reached again. The chain therefore
    // continues past an empty answer, and a base is only remembered once it has
    // actually produced models.
    let lastError: unknown
    let emptyError: Error | undefined
    for (const base of this.candidateBases(region, officialBase)) {
      let response: Response
      try {
        response = await this.fetchImpl(`${base}/models?functions=${functions}`, { headers, signal: signal ?? AbortSignal.timeout(30_000) })
      } catch (error) {
        // Transport failure (proxy rejection, timeout, reset): the candidate is
        // unreachable, not answering — record it and try the next base. A
        // caller-aborted signal must propagate, though: that is the caller's
        // decision, not a host failure.
        if (signal?.aborted) throw error
        if (base === officialBase) this.officialRetryAtMs = Date.now() + TraeSoloRemoteCatalogClient.OFFICIAL_RETRY_MS
        lastError = error
        continue
      }
      if (!response.ok) {
        if (response.status < 500) throw new Error(`SOLO remote models returned HTTP ${response.status}`)
        if (base === officialBase) this.officialRetryAtMs = Date.now() + TraeSoloRemoteCatalogClient.OFFICIAL_RETRY_MS
        lastError = new Error(`SOLO remote models returned HTTP ${response.status}`)
        continue
      }
      const json = await response.json() as { code?: number; data?: { list?: { function?: string; models?: unknown[] }[] } }
      const models = this.collectModels(region, json.data?.list ?? [])
      if (models.length === 0) {
        // This host answered, but with nothing to serve: not a success (do not
        // remember it) and not a failure of the chain (try the next base).
        emptyError = new Error('SOLO remote models response contained no models')
        lastError = emptyError
        continue
      }
      if (base !== officialBase) {
        this.options.log?.(
          this.lastSuccessfulBase === base
            ? `model directory served by the remembered fallback host ${base}; the official host (${officialBase}) is re-probed every ${TraeSoloRemoteCatalogClient.OFFICIAL_RETRY_MS / 60_000} minutes`
            : `model directory served by fallback host ${base}; the official host (${officialBase}) failed this refresh`,
          { officialBase },
        )
      } else {
        // The official host answered: leave the cooldown state.
        this.officialRetryAtMs = 0
      }
      this.lastSuccessfulBase = base
      return models
    }
    // An empty answer is the more informative reason when every base that
    // answered said "nothing here"; otherwise report the transport/HTTP error.
    if (emptyError !== undefined) throw emptyError
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /**
   * Bases to try for one refresh, in order.
   *
   * While the official host is in its post-failure cooldown the backup hosts go
   * first and the official base is kept LAST as a final chance (so a still-down
   * backup does not fail the whole refresh while the official host happens to
   * be reachable). Once the cooldown expires the official base is first again:
   * that is what lets a healed network take over — the loop returns on the
   * first success, so simply placing the official base second never re-probes
   * it while a backup keeps answering.
   */
  private candidateBases(region: TraeRegion, officialBase: string): string[] {
    // An explicit baseUrl (tests, diagnostics) pins the endpoint: no fallback
    // chain, exactly the pre-fallback behavior.
    if (this.baseUrl !== undefined) return [officialBase]
    const fallbacks = traeSoloRemoteFallbackBases(region, officialBase)
    if (this.officialRetryAtMs <= Date.now()) return [officialBase, ...fallbacks]
    const remembered = this.lastSuccessfulBase
    return [
      ...remembered === undefined ? [] : [remembered],
      ...fallbacks.filter(base => base !== remembered),
      officialBase,
    ]
  }

  /**
   * Union every returned group into one deduplicated list, attributing each
   * model to the CHAT function the directory listed it under.
   *
   * Each group is a roster the gateway is willing to serve; a model listed by
   * any of them is a model the IDE can offer, and the wire join downstream (see
   * mergeTraeModelSources) is what decides whether it is actually callable.
   * Restricting this to `solo_agent_remote` dropped the nine models issue #19
   * was opened about.
   *
   * FUNCTION ATTRIBUTION (2026-10-20): a group is the authoritative statement
   * of which SOLO function a model belongs to — the accepted `config_name` is
   * isolated per function (glm-5.3 answers `solo_work_remote` and 4001s under
   * `solo_work_lite`). The wire join prefers its own `get_detail_param`
   * function and falls back to this one when the roster says nothing, which
   * restricted networks often do (measured: an empty `config_info_list` for
   * every chat function but `chat_v3`).
   *
   * ONLY CHAT-CAPABLE GROUPS ARE ATTRIBUTED. `solo_agent` and `builder_v3` are
   * IDE/Remote-agent rosters: asking `llm_utils_chat` with either answers
   * 4011/4001 (measured 2026-10-01 on a live credential, issue #19). A model
   * that appears ONLY there is still not uncallable, though — the SAME models
   * answered normally under `solo_work_remote` / `solo_work_lite` /
   * `solo_agent_remote` (measured the same day, see `TRAE_DIRECTORY_FUNCTIONS`
   * in solo.ts), and the default function is what has always reached them:
   * they are exactly the nine models issue #19's fix exposes (`gpt-5.5`,
   * `gpt-5.6-*`, `gpt-6-astra`, `glm-5.2`, `kimi-k2.7-code`,
   * `Dola-Seed-2.0-Code`, `deepseek-v4-flash-0731` — docs/ISSUE19_DIAGNOSIS.md).
   * Stamping `solo_agent` onto such a row makes every call 4011; DROPPING it
   * undoes issue #19 for exactly the restricted-network users this fallback
   * exists for. It therefore keeps NO function, the bridge falls back to the
   * default chat function exactly as before this change, and a refusal (if the
   * model really is unreachable) comes back as a readable upstream message
   * instead of a silent absence.
   *
   * CHAT GROUPS ARE WALKED IN `TRAE_DIRECTORY_FUNCTIONS` ORDER, not in the
   * request's `functions=` order. That list is the measured precedence of which
   * function serves a shared config, and it is the order the wire roster itself
   * collects in (`solo.ts`) — walking a different order would attribute the
   * same model differently depending on whether the roster answered, and the
   * difference is not cosmetic: `solo_agent_remote` sits after the two
   * `solo_work_*` functions because it is behind the Remote plan gate, so
   * preferring it can turn a free-tier model into a `1005 requires a paid
   * plan` refusal.
   *
   * A model appears in SEVERAL groups and the groups disagree about its
   * capacity, so dedupe keeps the MOST CAPABLE row rather than the first one
   * (issue #23). "First wins" assumed the group order was stable; measured
   * 2026-10-05 on a live CN credential it is not — five calls returned five
   * different orders — so the published window became a coin flip:
   * `Doubao-Seed-2.1-Pro` came back as `116000`/no-Max (`builder_v3`), or
   * `256000`/no-Max (`solo_work_*`), or `256000`/`1000000` (`chat_v3`,
   * `solo_agent*`) depending on which group answered first. The Max tier is
   * the one users enable in the IDE, and `applyContextBudgets` can only raise
   * a window to `maxContextWindow` — so losing that field silently capped
   * every configured 1M model at 256K or less, and DSH compressed far earlier
   * than the chosen budget implied.
   *
   * Ordering rule: a row advertising a Max tier beats one that does not, a
   * larger Max wins over a smaller one, and with no Max on either side the
   * wider dev window wins. Every row for one id carries the same
   * `multimodal` / `reasoning` / credit facts (verified the same day), so
   * choosing on capacity loses no capability. The result no longer depends on
   * the gateway's group order — and the FUNCTION does not either: the winning
   * row's capacity may come from a later group, but the separately-tracked
   * attribution is re-asserted on it.
   */
  private collectModels(region: TraeRegion, groups: { function?: string; models?: unknown[] }[]): TraeDiscoveredModel[] {
    const byId = new Map<string, TraeDiscoveredModel>()
    // First group (by walk order) to list an id owns its function; tracked
    // separately because preferStrongerRow may replace the row with one from a
    // LATER group.
    const attributedFunction = new Map<string, string>()
    /**
     * The function a row may be stamped with: only a CHAT function. A non-chat
     * roster is not "the function this model belongs to" in any sense the chat
     * route can use (see the method note above), so it is not recorded at all.
     */
    const chatFunctions = new Set(TRAE_DIRECTORY_FUNCTIONS[region])
    const attribution = (groupFunction: string | undefined): string | undefined =>
      groupFunction !== undefined && chatFunctions.has(groupFunction) ? groupFunction : undefined
    const addGroup = (groupFunction: string | undefined, raws: readonly unknown[]): void => {
      const fn = attribution(groupFunction)
      for (const raw of raws) {
        const model = parseTraeRemoteModel(raw, fn)
        if (model === undefined) continue
        if (fn !== undefined && !attributedFunction.has(model.id)) attributedFunction.set(model.id, fn)
        byId.set(model.id, preferStrongerRow(model, byId.get(model.id)))
      }
    }
    /**
     * Every group the gateway sent, bucketed BY FUNCTION NAME and kept as a
     * LIST.
     *
     * A name→group `Map` would keep only the LAST group of a name and silently
     * drop the models of every earlier one: nothing documents that the gateway
     * sends a function at most once, and the pre-change code unioned every
     * element of `data.list`, so a repeated name lost real models. Bucketing
     * keeps that union while the walk below still imposes a deterministic
     * order.
     */
    const byFunction = new Map<string, { function?: string; models?: unknown[] }[]>()
    for (const group of groups) {
      const key = group.function ?? ''
      const bucket = byFunction.get(key)
      if (bucket === undefined) byFunction.set(key, [group])
      else bucket.push(group)
    }
    // Pass 1: the chat-capable groups, in the wire roster's own precedence
    // order (see `TRAE_DIRECTORY_FUNCTIONS`), each bucket in response order.
    for (const name of TRAE_DIRECTORY_FUNCTIONS[region]) {
      for (const group of byFunction.get(name) ?? []) addGroup(name, group.models ?? [])
    }
    // Pass 2: every remaining group (IDE/agent rosters and anything the request
    // did not name). Their models are still unioned — "the IDE shows it" is a
    // fact about the account — but they carry no function, so the bridge asks
    // through the default chat function as it always has.
    for (const [name, bucket] of byFunction) {
      if (chatFunctions.has(name)) continue
      for (const group of bucket) addGroup(name, group.models ?? [])
    }
    return [...byId.values()].map(model => {
      const fn = attributedFunction.get(model.id)
      return fn === undefined || fn === model.function ? model : { ...model, function: fn }
    })
  }
}
