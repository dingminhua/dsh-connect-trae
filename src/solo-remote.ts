import type { TraeCredential } from './auth.ts'
import { parseTraeRemoteModel, type TraeDiscoveredModel } from './model-metadata.ts'
import { REGION_GATEWAYS, regionOfCredential, type TraeRegion } from './region.ts'

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
 */
export const TRAE_REMOTE_DIRECTORY_FUNCTIONS: Readonly<Record<TraeRegion, readonly string[]>> = {
  cn: ['solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3'],
  ai: ['solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3'],
}

export interface TraeSoloRemoteCatalogOptions {
  credential(): Promise<TraeCredential>
  fetchImpl?: typeof fetch
  baseUrl?: string
}

/**
 * Of two rows for the SAME model id, the one that advertises the stronger
 * capacity (issue #23).
 *
 * The gateway groups its directory by function and reports a model's capacity
 * per group, with the group order varying between calls. Keeping the strongest
 * row makes the published window deterministic. The comparison is
 * LEXICOGRAPHIC and must be applied all the way down, or ordering leaks back in
 * at the next field:
 *
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
    const base = this.baseUrl ?? REGION_GATEWAYS[region].remote
    const headers = await this.headers(region)
    const functions = TRAE_REMOTE_DIRECTORY_FUNCTIONS[region].join(',')
    const response = await this.fetchImpl(`${base}/models?functions=${functions}`, { headers, signal: signal ?? AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`SOLO remote models returned HTTP ${response.status}`)
    const json = await response.json() as { code?: number; data?: { list?: { function?: string; models?: unknown[] }[] } }
    const groups = json.data?.list ?? []
    // Union EVERY group, not just the preferred one. Each group is a roster the
    // gateway is willing to serve; a model listed by any of them is a model the
    // IDE can offer, and the wire join downstream (see mergeTraeModelSources)
    // is what decides whether it is actually callable. Restricting this to
    // `solo_agent_remote` dropped the nine models issue #19 was opened about.
    //
    // A model appears in SEVERAL groups and the groups disagree about its
    // capacity, so dedupe keeps the MOST CAPABLE row rather than the first one
    // (issue #23). "First wins" assumed the group order was stable; measured
    // 2026-10-05 on a live CN credential it is not — five calls returned five
    // different orders — so the published window became a coin flip:
    // `Doubao-Seed-2.1-Pro` came back as `116000`/no-Max (`builder_v3`), or
    // `256000`/no-Max (`solo_work_*`), or `256000`/`1000000` (`chat_v3`,
    // `solo_agent*`) depending on which group answered first. The Max tier is
    // the one users enable in the IDE, and `applyContextBudgets` can only raise
    // a window to `maxContextWindow` — so losing that field silently capped
    // every configured 1M model at 256K or less, and DSH compressed far earlier
    // than the chosen budget implied.
    //
    // Ordering rule: a row advertising a Max tier beats one that does not, a
    // larger Max wins over a smaller one, and with no Max on either side the
    // wider dev window wins. Every row for one id carries the same
    // `multimodal` / `reasoning` / credit facts (verified the same day), so
    // choosing on capacity loses no capability. The result no longer depends on
    // the gateway's group order.
    const byId = new Map<string, TraeDiscoveredModel>()
    for (const group of groups) {
      for (const raw of group.models ?? []) {
        const model = parseTraeRemoteModel(raw)
        if (model === undefined) continue
        byId.set(model.id, preferStrongerRow(model, byId.get(model.id)))
      }
    }
    const models = [...byId.values()]
    if (models.length === 0) throw new Error('SOLO remote models response contained no models')
    return models
  }
}
