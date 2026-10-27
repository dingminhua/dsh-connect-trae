import type { TraeCredential } from './auth.ts'
import type { TraeIdentity } from './identity.ts'
import { TRAE_MODEL_DETAIL_FUNCTIONS, TRAE_MODEL_DETAIL_PATH, buildTraeModelDetailRequest } from './model-detail.ts'
import { buildTraeCnHeaders, traeEndpoint } from './protocol.ts'
import { assertSupportedRegion, REGION_GATEWAYS, TRAE_ENTERPRISE_HOST, regionOfCredential, type TraeRegion } from './region.ts'

/**
 * The IDE's own roster: what the Trae picker is WILLING TO SHOW, per function.
 *
 * Issue #52. The plugin lists the UNION of every directory function (46 rows on
 * a live CN credential, 2026-10-23) while the Trae client renders ONE function's
 * list at a time (14–24 rows). Two different questions were being answered by
 * one list, and the user saw the difference as "why are there so many models".
 *
 * This module answers the second question with the third upstream signal the
 * catalog was missing. `isPromotableWireModel` (src/catalog.ts) asks "can this
 * config be called"; this one asks "does the vendor's own picker offer it", read
 * from `is_invisible_to_user` on the SAME `batch_get_detail_param` document the
 * IDE renders. Both are upstream facts; neither is invented.
 *
 * The flag is PER (config, function), not per config — measured 2026-10-23:
 * `glm-4.7` is visible under `code_review_summary` and hidden under `solo_coder`
 * and `solo_work_remote`. A row's visibility therefore only means something
 * together with the function the chat call will replay, which is why the
 * decision below takes BOTH and why the answer cannot be merged as a bare field
 * the way `contextWindow` is.
 */

/** One (config, function) pair exactly as the IDE roster published it. */
export interface TraeOfficialChannel {
  /** The `function_configs[].function` this row was listed under. */
  function: string
  /**
   * Upstream's `usage` for the config under this function: `chat_completion`
   * for a real model, one value per built-in tool config (`summary`,
   * `fast_apply`, …), `custom_model` for the account's own model. Empty when
   * upstream did not say.
   */
  usage: string
  /** `config_switch`: false means upstream marked the config OFF on this function. */
  enabled: boolean
  /** `is_invisible_to_user`: true means the vendor's picker does not list it here. */
  invisible: boolean
}

/** What the IDE roster knows about one `config_name`. */
export interface TraeOfficialRoster {
  /** Lower-cased `config_name` → every (function, visibility) pair published. */
  channels: ReadonlyMap<string, readonly TraeOfficialChannel[]>
  /** Number of distinct configs and pairs, for diagnostics only. */
  size: { configs: number; pairs: number }
}

const CHAT_USAGE = 'chat_completion'

/**
 * Parse a `batch_get_detail_param` answer into a per-(config, function) index.
 *
 * Tolerant on purpose: this document is 1.8 MB of upstream-owned shape
 * (`function_configs[] → config_info_list[] → model_detail_list[]`), and the
 * plugin must not lose the whole refresh because one nested field changed
 * spelling. Rows that cannot be read are skipped; a document with no
 * `function_configs` at all yields an empty roster, which the filter reads as
 * "nothing to say" rather than "hide everything".
 *
 * Duplicate pairs are collapsed first-wins, matching the rest of the catalog's
 * convention (`mergeTraeModelSources`). Two functions can both list a config,
 * and those are DIFFERENT pairs, so both are kept.
 */
export function parseTraeOfficialRoster(payload: unknown): TraeOfficialRoster {
  const channels = new Map<string, TraeOfficialChannel[]>()
  const seen = new Set<string>()
  let pairs = 0
  const document = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
  const groups = Array.isArray(document['function_configs']) ? document['function_configs'] : []
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue
    const record = group as Record<string, unknown>
    const functionName = typeof record['function'] === 'string' ? record['function'] : ''
    if (functionName === '') continue
    const list = Array.isArray(record['config_info_list']) ? record['config_info_list'] : []
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue
      const config = item as Record<string, unknown>
      const configName = typeof config['config_name'] === 'string' ? config['config_name'].trim() : ''
      if (configName === '') continue
      const key = `${functionName}\u0000${configName.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const channel: TraeOfficialChannel = {
        function: functionName,
        usage: typeof config['usage'] === 'string' ? config['usage'] : '',
        // Absent `config_switch` is NOT "disabled": only an explicit `false`
        // counts, or a partially-parsed document would hide the whole roster.
        enabled: config['config_switch'] !== false,
        // Strictly `true`: `is_invisible_to_user` is sometimes absent, and
        // absent means "the vendor did not say", never "hidden".
        invisible: config['is_invisible_to_user'] === true,
      }
      pairs += 1
      const bucket = channels.get(configName.toLowerCase())
      if (bucket === undefined) channels.set(configName.toLowerCase(), [channel])
      else bucket.push(channel)
    }
  }
  return { channels, size: { configs: channels.size, pairs } }
}

/** The `config_name` a catalog row would actually send (see `wireConfigName`). */
function officialKeyOf(model: { id: string; wireConfigName?: string }): string {
  return (model.wireConfigName ?? model.id).trim().toLowerCase()
}

/**
 * What the roster says to do with one catalog row.
 *
 * `is_invisible_to_user` is a per-(config, function) MODE roster, not a
 * lifecycle flag. Measured 2026-10-23 on a live CN account: `DeepSeek-V4-Pro` is
 * hidden under `solo_work_remote` (where that mode's picker shows
 * `DeepSeek-V4-Pro-Official`) while `solo_coder`, `chat_v3` and `chat` all list
 * it as visible; `glm-5` is hidden under `solo_work_remote` and
 * `solo_agent_remote` and visible under `solo_work_lite` and `solo_coder`.
 *
 * Reading the flag as "this model is retired" would have deleted six models that
 * are in current use. Reading it as "this config is not the one THIS mode
 * offers" yields the two verdicts below: a config no chat function offers any
 * more is retired (hide), and a config offered somewhere else is mis-pinned
 * (re-pin to the function the vendor itself uses). Both replace a guess — the
 * union of twelve directories — with an upstream answer.
 */
export type TraeOfficialVerdict =
  /** Visible on the function it would be called through, or the roster says nothing. */
  | { kind: 'keep' }
  /** Invisible on EVERY chat function that lists it: the vendor retired it as a chat model. */
  | { kind: 'hide'; function: string | undefined; listedBy: string[] }
  /** Invisible on its own function while another chat function offers it. */
  | { kind: 'repin'; from: string | undefined; to: string; listedBy: string[] }

/**
 * Decide one row from the roster.
 *
 * `chatFunctions` is the region's own `TRAE_DIRECTORY_FUNCTIONS` list, in
 * priority order: only those functions can carry a VERDICT, because only those
 * are functions `llm_utils_chat` accepts. A config the vendor shows under
 * `code_review_summary` alone is not offered as a chat model at all — that is
 * exactly the `glm-4.7` case, and it is a "hide", not a "re-pin".
 *
 * The verdict is `keep` when the roster cannot speak: no entry for the config
 * (measured 2026-10-23: `kimi-k2.8-preview` and `qwen3.8-flash` exist only in
 * the Remote directory's `chat_v3` group), only tool rows (`usage: 'summary'`,
 * `fast_apply`, …), or no chat function at all. Silence is never a verdict.
 */
export function officialVerdictOf(
  model: { id: string; wireConfigName?: string; wireFunction?: string },
  roster: TraeOfficialRoster,
  chatFunctions: readonly string[],
): TraeOfficialVerdict {
  const entries = roster.channels.get(officialKeyOf(model))
  if (entries === undefined || entries.length === 0) return { kind: 'keep' }
  // A tool config (`usage: 'summary'`, `fast_apply`, …) is not a model, so a
  // channel that lists the id as a tool says nothing about whether it is offered
  // as a model there.
  const listed = entries.filter(entry => entry.usage === '' || entry.usage === CHAT_USAGE)
  const callable = listed.filter(entry => chatFunctions.includes(entry.function))
  if (callable.length === 0) return { kind: 'keep' }
  const listedBy = callable.map(entry => entry.function)
  // `enabled` is deliberately NOT part of the verdict: `config_switch` is
  // recorded faithfully but its semantics are unmeasured, and a flag we do not
  // understand must not delete a model.
  const shown = callable.filter(entry => !entry.invisible)
  if (shown.length === 0) return { kind: 'hide', function: model.wireFunction, listedBy }
  const own = model.wireFunction === undefined
    ? undefined
    : callable.find(entry => entry.function === model.wireFunction)
  // Its own channel shows it (or the roster never names that channel):
  // nothing to correct.
  if (own !== undefined && !own.invisible) return { kind: 'keep' }
  // Pick by the region's own channel priority rather than by document order, so
  // the same account gets the same function twice in a row.
  const to = chatFunctions.find(fn => shown.some(entry => entry.function === fn))
  if (to === undefined) return { kind: 'keep' }
  return { kind: 'repin', from: model.wireFunction, to, listedBy }
}

export interface TraeOfficialFilterResult<T> {
  /** Rows the catalog should keep, in their original order. */
  rows: T[]
  /** Rows removed, with the function that hid them, for the log and the tests. */
  hidden: Array<{ id: string; function: string | undefined }>
  /** Rows kept but moved to the chat function the vendor offers them on. */
  repinned: Array<{ id: string; from: string | undefined; to: string }>
}

/**
 * Apply the roster: retire what no chat function offers any more, and re-pin
 * what the vendor offers under a different channel.
 *
 * FAIL-OPEN BY CONSTRUCTION, which is the whole safety argument for applying
 * this by default:
 *
 *  - `undefined` roster (transport failure, restricted network, a credential
 *    that cannot read the IDE document) keeps EVERY row. A refresh must never
 *    lose models because a second, optional endpoint was unreachable.
 *  - `keep` covers every ambiguity — no entry, tool-only entries, a channel the
 *    roster does not name. Only an explicit "the vendor shows this nowhere we
 *    can call it" removes a row.
 *  - `config_switch === false` alone does NOT remove a row: the flag is
 *    recorded on {@link TraeOfficialChannel} but not used as a verdict, because
 *    its semantics are unmeasured and "disabled" there may describe a function
 *    override rather than the model itself.
 *
 * This is deliberately NOT "match the Trae client": the client renders one
 * function, the plugin serves the union, and issue #46's reporter wants the
 * dated snapshots the union carries. What changes here is only the class where
 * the union is provably wrong — twelve retired configs that made up the reported
 * "tail of old models", plus rows pinned to a channel their own vendor hides
 * them on (the "code model on a solo channel" risk of issue #52).
 */
export function applyOfficialRoster<T extends { id: string; wireConfigName?: string; wireFunction?: string }>(
  rows: readonly T[],
  roster: TraeOfficialRoster | undefined,
  chatFunctions: readonly string[],
): TraeOfficialFilterResult<T> {
  if (roster === undefined) return { rows: [...rows], hidden: [], repinned: [] }
  const kept: T[] = []
  const hidden: Array<{ id: string; function: string | undefined }> = []
  const repinned: Array<{ id: string; from: string | undefined; to: string }> = []
  for (const row of rows) {
    const verdict = officialVerdictOf(row, roster, chatFunctions)
    if (verdict.kind === 'hide') {
      hidden.push({ id: row.id, function: verdict.function })
      continue
    }
    if (verdict.kind === 'repin') {
      repinned.push({ id: row.id, from: verdict.from, to: verdict.to })
      kept.push({ ...row, wireFunction: verdict.to })
      continue
    }
    kept.push(row)
  }
  return { rows: kept, hidden, repinned }
}

/** How long one successful roster read stays usable, in milliseconds. */
const ROSTER_CACHE_MS = 10 * 60_000

/** Timeout for the roster read. It is an OPTIONAL signal; it must not stall a refresh. */
const ROSTER_TIMEOUT_MS = 20_000

export interface TraeOfficialRosterOptions {
  credential(): Promise<TraeCredential>
  identity(): Promise<TraeIdentity>
  fetchImpl?: typeof fetch
  /** Pins the host (tests, diagnostics). Defaults to the credential region's chat gateway. */
  baseUrl?: string
  /** Pin the tenant pool's gateway, exactly like `TraeSoloUpstreamClient`. */
  route?: 'solo' | 'enterprise'
  log?: (message: string, detail?: unknown) => void
  now?: () => number
}

/**
 * Reads the IDE's roster once per cache window and never throws.
 *
 * `undefined` is a first-class answer: it is what a caller sees when the
 * document could not be read, and {@link applyOfficialRoster} treats it as "no
 * opinion". Silence on failure is intentional — this is a refinement of a
 * refresh that already succeeded, so a strict error would turn a usable catalog
 * into a failed refresh.
 */
export class TraeOfficialRosterClient {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private cached: { at: number; roster: TraeOfficialRoster } | undefined
  /** The last failure, so a repeatedly-broken endpoint is not re-probed on every refresh. */
  private failedAt: number | undefined

  constructor(private readonly options: TraeOfficialRosterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
  }

  /** Cached roster, without any network I/O. */
  cachedRoster(): TraeOfficialRoster | undefined {
    return this.cached === undefined ? undefined : this.cached.roster
  }

  async fetch(signal?: AbortSignal): Promise<TraeOfficialRoster | undefined> {
    const now = this.now()
    if (this.cached !== undefined && now - this.cached.at < ROSTER_CACHE_MS) return this.cached.roster
    // A failed read is also cached (shorter): the endpoint needs the IDE's full
    // header set, and an account that cannot read it will not start being able
    // to read it one second later. Without this, every refresh pays the timeout.
    if (this.failedAt !== undefined && now - this.failedAt < ROSTER_CACHE_MS) return undefined
    try {
      const [credential, identity] = await Promise.all([this.options.credential(), this.options.identity()])
      // The roster is optional, so an unsupported region simply yields no
      // roster (the catalog keeps every row) — but it must not be asked for
      // one on a gateway that would answer 401 (issue #66).
      const region = assertSupportedRegion(regionOfCredential(credential))
      const base = this.options.baseUrl ?? (this.options.route === 'enterprise' ? TRAE_ENTERPRISE_HOST : REGION_GATEWAYS[region].chat)
      const response = await this.fetchImpl(traeEndpoint(base, TRAE_MODEL_DETAIL_PATH), {
        method: 'POST',
        headers: buildTraeCnHeaders(credential, identity, { profile: 'model-detail' }),
        body: JSON.stringify({ ...buildTraeModelDetailRequest(''), show_custom_model: true }),
        signal: signal ?? AbortSignal.timeout(ROSTER_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const roster = parseTraeOfficialRoster(await response.json())
      if (roster.size.configs === 0) throw new Error('roster document carried no config_name')
      this.cached = { at: now, roster }
      this.failedAt = undefined
      return roster
    } catch (error: unknown) {
      this.failedAt = now
      this.options.log?.('dsh-connect-trae: IDE model roster unavailable, keeping every discovered row', {
        reason: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }
}

/** Where the client asks for the roster; re-exported so diagnostics do not hard-code it. */
export const TRAE_OFFICIAL_ROSTER_PATH = TRAE_MODEL_DETAIL_PATH
/** The functions the roster request names, re-exported for the same reason. */
export const TRAE_OFFICIAL_ROSTER_FUNCTIONS = TRAE_MODEL_DETAIL_FUNCTIONS
export type { TraeRegion }
