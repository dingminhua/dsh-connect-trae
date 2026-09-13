import type { TraeDiscoveredModel, TraeDiscoveredReasoning } from './model-metadata.ts'
import type { TraeReasoningEffort } from './reasoning.ts'
import type { TraeReasoningCapability } from './reasoning.ts'

export type TraeInputModality = 'text' | 'image'

/**
 * One model the adapter exposes. `contextWindow` is the effective DSH context
 * after the user's budget; `maxContextWindow` is the native Max window Trae
 * advertises (capability display only — never a second model entry).
 */
export interface TraeModelInfo {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  input?: TraeInputModality[]
  creditMultiplier?: number
  reasoningSupported?: boolean
  reasoning?: TraeDiscoveredReasoning
  reasoningEfforts?: Partial<Record<TraeReasoningEffort, string | null>>
  maxContextWindow?: number
  /** The `config_name` `llm_utils_chat` accepts; absent means `id` is already the wire id. */
  wireConfigName?: string
}

/**
 * Bootstrap catalog: identity only, used before live Trae metadata has been
 * fetched. Every id here is verified callable through the TraeCode
 * `chat_v3` forwarding path; a row that is not would make the plugin's first
 * request fail with 4001 "param is invalid".
 *
 * `auto` was removed: the TraeCode wire catalog does not list it and `chat_v3`
 * rejects it, so advertising it in the bootstrap set only produced a failing
 * default on a machine with no credentials. `kimi-k2.6` is kept — it is absent
 * from the TraeCode wire list but the forwarding call accepts it.
 */
export const FALLBACK_TRAE_MODELS: readonly TraeModelInfo[] = [
  { id: 'glm-5.2', name: 'GLM-5.2' },
  { id: 'DeepSeek-V4-Pro', name: 'DeepSeek-V4-Pro' },
  { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash' },
  { id: 'kimi-k3', name: 'Kimi-K3' },
  { id: 'minimax-m3', name: 'MiniMax-M3' },
]

/** Exact DSH modalities for one catalog entry; absent metadata is text-only. */
export function traeInputModalities(model: Pick<TraeModelInfo, 'input'>): TraeInputModality[] {
  return [...(model.input ?? ['text'])]
}

/**
 * Compose the DSH-facing model name: Trae's own model picker renders each
 * entry as `Name · x<rate>`, so the credit multiplier is shown inside the
 * name. `TraeModelInfo.name` keeps the pure Trae display name — every join
 * (wire resolution, callable-key filtering) must keep matching the
 * undecorated name; only the model rows handed to DSH (adapter catalog and
 * model discovery) use this decorated name.
 */
export function traeModelDisplayName(model: Pick<TraeModelInfo, 'name' | 'creditMultiplier'>): string {
  return model.creditMultiplier === undefined
    ? model.name
    : `${model.name} · x${model.creditMultiplier.toFixed(2)}`
}

/** Apply the user's explicit image opt-ins; upstream and saved row hints are ignored. */
export function applyImageSelection(
  models: readonly TraeModelInfo[],
  selected: ReadonlySet<string>,
): TraeModelInfo[] {
  return models.map(model => ({ ...model, input: selected.has(model.id) ? ['text', 'image'] : ['text'] }))
}

/** One row from `get_detail_param`: the authoritative llm_utils_chat wire id + display name. */
export interface TraeWireModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: TraeReasoningCapability
  /** Effective (post-discount) credit multiplier the Trae IDE displays. */
  creditMultiplier?: number
}

/** Normalise a display name for cross-source joining. */
function displayKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Which of Trae's two model directories a run serves.
 *
 * The two are genuinely different lists, and the user's two Trae clients show
 * them side by side: the IDE's picker follows `get_detail_param` (`wire`) — 27
 * models with the current limited-time rates, e.g. `Seed-2.1-Pro · x0.08` —
 * while the other client follows the Remote `/models` directory (`remote`) —
 * 15 models including `Doubao-Seed-Evolving`, `Kimi-K2.8-Preview` and
 * `GLM-5.3-Flash`, but quoting `Seed-2.1-Pro` at its **undiscounted** `0.80`.
 *
 * Neither list is a subset of the other, so this plugin serves whichever
 * directory the selected client actually shows instead of inventing a union:
 *  - `wire`  — the `get_detail_param` directory (the Trae IDE / `chat_v3`).
 *  - `remote` — the Remote `/models` directory (the other client).
 *  - `merge` — both, wire-first; the historical behaviour, kept for callers
 *    that want the widest reachable set regardless of any client's menu.
 */
export type TraeModelSourceMode = 'wire' | 'remote' | 'merge'

/**
 * Select one source's rows without merging.
 *
 * `remote` rows are converted to catalog rows with their own rates and are
 * deliberately NOT enriched from `wire`: the whole point of choosing this
 * directory is to reproduce what the Remote-driven client shows, including its
 * undiscounted figures.
 */
export function selectTraeModelSource(
  remote: readonly TraeDiscoveredModel[],
  wire: readonly TraeWireModel[],
  mode: TraeModelSourceMode,
): TraeModelInfo[] {
  // `wire` mode supplies the MODEL SET and the RATES; Remote is still consulted
  // for metadata the wire rows do not carry. Passing no Remote at all dropped
  // every context window: `get_detail_param` advertises
  // `context_window_tokens.dev`/`max` inconsistently and never the Max window,
  // while the Remote directory carries both. Merging Remote in this direction
  // cannot add or remove a model (the wire list is enumerated) and cannot
  // override a rate (the wire rate wins in `mergeTraeModelSources`), so the
  // served set and prices stay exactly this client's.
  if (mode === 'wire') return mergeTraeModelSources(remote, wire)
  if (mode === 'remote') return discoveredCatalog(remote)
  return mergeTraeModelSources(remote, wire)
}

/**
 * Merge the two Trae model sources into one authoritative catalog.
 *
 * `wire` (from `get_detail_param`) is the authority: it is the exact set of
 * `llm_utils_chat` `config_name`s the forwarding call accepts, and it is
 * already scoped to this plugin's product line because the request names a
 * `function` (TraeCode `chat_v3`). `remote` (the solo.trae.cn `/models`
 * directory) is an advertisement, not a contract: for TraeCode it lists models
 * the call rejects and omits models it accepts (see the note in the body).
 * Remote is therefore consulted only to enrich a wire row with the metadata it
 * happens to carry (display name, context windows, credit multiplier,
 * reasoning, multimodal flags); it never adds or removes a row.
 *
 * Joining is two-tier, in priority order:
 *  1. `wire.id` (the `config_name`) equals the remote id — the model's display
 *     id is already its wire id (the common case: glm-5.2, DeepSeek-V4-Flash,
 *     kimi-k3, …).
 *  2. `wire.name` (the `display_name`) equals the remote display name — for
 *     models whose display id differs from the wire id across Trae versions.
 * A wire row is emitted with its `config_name` as the id, and the remote
 * display name when one is known. `wireConfigName` is therefore never set —
 * the id is already the callable `config_name`. The field remains declared so
 * a catalog saved by an older version still type-checks when read back, and
 * the bridge keeps honouring it on load.
 */
export function mergeTraeModelSources(
  remote: readonly TraeDiscoveredModel[],
  wire: readonly TraeWireModel[],
): TraeModelInfo[] {
  const remoteByName = new Map<string, TraeDiscoveredModel>()
  const remoteById = new Map<string, TraeDiscoveredModel>()
  for (const model of remote) {
    remoteByName.set(displayKey(model.name), model)
    remoteById.set(displayKey(model.id), model)
  }
  // The wire catalog is the authority, not the Remote directory. Remote is a
  // per-product advertisement whose TraeCode group names models `chat_v3`
  // rejects (`Doubao-Seed-Evolving`, `glm-5.3`, `qwen3.8-max`,
  // `kimi-k2.8-preview`, `glm-5.3-flash` — each returns 4001 "param is
  // invalid") while omitting callable ones it never lists (`glm-4.7`,
  // `glm-4.6`, `kimi-k2`, `qwen-3.5`, `minimax-m2`, `qwen3-coder`). Verified
  // against a live account: every remote-only row failed and every wire-only
  // row succeeded. Enumerating the wire list therefore guarantees the served
  // catalog is exactly the set the forwarding call accepts; Remote is consulted
  // only to enrich rows it happens to know.
  const result: TraeModelInfo[] = []
  const seen = new Set<string>()
  for (const wireModel of wire) {
    if (wireModel.id.trim() === '') continue
    // get_detail_param can list the same config_name twice (a live TraeCode
    // response carried `kimi-k3` in two rows). The adapter rejects a catalog
    // with duplicate ids outright ("invalid or duplicate model metadata"), so
    // the first row wins and later ones are dropped.
    const key = displayKey(wireModel.id)
    if (seen.has(key)) continue
    seen.add(key)
    const model = remoteById.get(key) ?? remoteByName.get(displayKey(wireModel.name))
    // The wire rate wins whenever it is present. It is the post-discount figure
    // the Trae IDE renders (see `wireCreditMultiplier`); the Remote directory's
    // own `consumption_rate` can disagree — it reports `0.8` for a model the IDE
    // shows as `0.08x` under a 限时 1 折 promotion.
    const creditMultiplier = wireModel.creditMultiplier ?? model?.creditMultiplier
    // Context windows come from the Remote row first. It is the directory Trae's
    // own clients display, and where the two disagree the wire value is the
    // understated one: `Seed-2.1-Pro` / `Seed-2.1-Turbo` report `context_window_tokens.dev
    // = 116000` in `get_detail_param` while the IDE and the Remote directory both
    // show 256000. (The wire's own `max` window is also absent, so the Max toggle
    // can only come from Remote.) The wire value stays as a fallback so a row the
    // Remote directory does not describe still advertises a window — DSH rejects a
    // served model whose window is missing, because `PiAiAdapter` always emits
    // `context: { contextWindow: resolvedModel.contextWindow }` and an undefined
    // value trips `INVALID_MODEL_CONTEXT`.
    const contextWindow = model?.contextWindow ?? wireModel.contextWindow
    result.push({
      id: wireModel.id,
      name: model?.name ?? wireModel.name,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...model?.maxContextWindow === undefined ? {} : { maxContextWindow: model.maxContextWindow },
      ...creditMultiplier === undefined ? {} : { creditMultiplier },
      input: ['text'],
      reasoningSupported: model?.reasoningSupported ?? false,
      ...model?.reasoning === undefined ? {} : {
        reasoning: model.reasoning,
        reasoningEfforts: Object.fromEntries(model.reasoning.supported.map(effort => [effort, effort === 'low' ? 'light' : effort === 'xhigh' ? 'extra_high' : 'high'])) as Partial<Record<TraeReasoningEffort, string>>,
      },
      // No `wireConfigName`: the row id IS the wire `config_name`, so the
      // display→wire translation the bridge performs is an identity mapping.
    })
  }
  return result
}

/** Local DSH context budget per model; a value may only select an advertised window. */
export type TraeContextBudget = number

/**
 * Apply the saved local budget. Trae advertises two windows per model (dev and
 * Max), so the budget may only switch a model to its own advertised Max value —
 * never to a fabricated number. Everything else keeps the dev window.
 */
export function applyContextBudgets(
  catalog: readonly TraeModelInfo[],
  budgets: Readonly<Record<string, TraeContextBudget | undefined>> = {},
): TraeModelInfo[] {
  return catalog.map(model => ({
    ...model,
    ...(model.maxContextWindow !== undefined && budgets[model.id] === model.maxContextWindow
      ? { contextWindow: model.maxContextWindow }
      : {}),
  }))
}

/** Convert Trae metadata into text-only model rows; image support is user-owned configuration. */
export function discoveredCatalog(models: readonly TraeDiscoveredModel[]): TraeModelInfo[] {
  const result: TraeModelInfo[] = []
  for (const model of models) {
    result.push({
      id: model.id,
      name: model.name,
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxContextWindow === undefined ? {} : { maxContextWindow: model.maxContextWindow },
      input: ['text'],
      ...model.creditMultiplier === undefined ? {} : { creditMultiplier: model.creditMultiplier },
      reasoningSupported: model.reasoningSupported,
      ...model.reasoning === undefined ? {} : {
        reasoning: model.reasoning,
        reasoningEfforts: Object.fromEntries(model.reasoning.supported.map(effort => [effort, effort === 'low' ? 'light' : effort === 'xhigh' ? 'extra_high' : 'high'])) as Partial<Record<TraeReasoningEffort, string>>,
      },
    })
  }
  return result
}

/**
 * Drop rows saved by older releases that generated `@1m` variant models, so a
 * stale configuration cannot resurrect a variant the runtime no longer builds.
 */
export function sanitizeCatalog(catalog: readonly TraeModelInfo[]): TraeModelInfo[] {
  return catalog.filter(model => {
    if (model.id.endsWith('@1m')) return false
    const legacy = model as Partial<{ baseModelId: unknown; maxContext: unknown }>
    return legacy.baseModelId === undefined && legacy.maxContext !== true
  })
}

/**
 * Derive the runtime catalog from the last refreshed Trae directory plus the
 * user's explicit selection and context budgets. An empty selection falls back
 * to the whole directory: a plugin that has never been configured must still
 * serve models rather than nothing. This is the single source of truth for
 * what DSH actually exposes, so saving only the selection and budgets is
 * enough to rebuild it after a restart.
 */
export function deriveCatalog(
  catalog: readonly TraeModelInfo[],
  enabled: ReadonlySet<string>,
  budgets: Readonly<Record<string, TraeContextBudget | undefined>> = {},
): TraeModelInfo[] {
  const selected = enabled.size === 0 ? catalog : catalog.filter(model => enabled.has(model.id))
  return applyContextBudgets(selected, budgets)
}

export class TraeCatalog {
  private models: readonly TraeModelInfo[] = FALLBACK_TRAE_MODELS

  current(): readonly TraeModelInfo[] {
    return this.models
  }

  set(models: readonly TraeModelInfo[]): void {
    if (models.length === 0) throw new Error('trae model catalog cannot be empty')
    this.models = models.map(model => ({ ...model, ...model.input === undefined ? {} : { input: [...model.input] } }))
  }
}
