import type { TraeDiscoveredModel, TraeDiscoveredReasoning } from './model-metadata.ts'
import type { TraeReasoningEffort } from './reasoning.ts'
import type { TraeReasoningCapability } from './reasoning.ts'
import type { TraeRegion } from './region.ts'

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
  /** The directory function this model must be called through (see {@link TraeWireModel.function}). */
  wireFunction?: string
}

/**
 * Bootstrap catalog: identity only where current Trae metadata has not been
 * fetched yet.
 *
 * Every id here must be a `config_name` that `llm_utils_chat` actually accepts,
 * because this list is served verbatim before the first live refresh lands and
 * it is NOT filtered against the wire map (the wire map can only confirm ids it
 * happens to know, so filtering would delete the safety net exactly when it is
 * needed — see `fallbackModels` in index.ts). The current CN roster was
 * verified against the live remote directory on 2026-09-15
 * (docs/DS41_CALLABILITY.md): `DeepSeek-V4-Flash-Official` and
 * `DeepSeek-V4-Pro-Official` carry the `-Official` suffix, and there is no
 * `auto` config_name — an `auto` row was previously served here and would have
 * failed on selection.
 *
 * Every row MUST also carry a positive-integer `contextWindow`. DSH rejects an
 * adapter whose model has no usable context (`INVALID_MODEL_CONTEXT`), and that
 * failure is per-provider — one bad row takes the whole region offline. These
 * rows are exactly the ones served when no live directory is available (no
 * install for that region, signed out, or a failed refresh), which is precisely
 * when the fallback is doing its job, so a missing field here is fatal rather
 * than cosmetic. See docs/ISSUE8_DIAGNOSIS.md.
 */
export const FALLBACK_TRAE_MODELS: readonly TraeModelInfo[] = [
  { id: 'DeepSeek-V4-Flash-Official', name: 'DeepSeek-V4-Flash', contextWindow: 200_000 },
  { id: 'DeepSeek-V4-Pro-Official', name: 'DeepSeek-V4-Pro', contextWindow: 200_000 },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 200_000 },
  { id: 'kimi-k2.6', name: 'Kimi-K2.6', contextWindow: 200_000 },
]

/**
 * Bootstrap catalog for the international (ai) region, captured from the
 * live `coresg-normal.trae.ai/api/remote/v1/models` directory on 2026-09-15
 * (docs/INTL_SG_EVIDENCE.md §3). The two rosters barely overlap (the CN list
 * has no Gemini/GPT/MiniMax entries), so an international account must never
 * be seeded with the CN list. Like the CN fallback it is replaced by the live
 * refresh; image input stays the user's explicit opt-in (`imageModelIds`).
 *
 * The `contextWindow` values are the measured ones from that same capture
 * (`docs/INTL_SG_EVIDENCE.md` §3) and are required for the same reason as the
 * CN fallback: without them the whole `trae-global` provider fails to load.
 */
export const FALLBACK_TRAE_MODELS_AI: readonly TraeModelInfo[] = [
  { id: 'gemini-3.1-pro', name: 'Gemini-3.1-Pro-Preview', contextWindow: 200_000 },
  { id: 'gemini-3-flash-solo', name: 'Gemini-3-Flash-Preview', contextWindow: 200_000 },
  { id: 'minimax-m3', name: 'MiniMax-M3', contextWindow: 200_000 },
  { id: 'minimax-m2.7', name: 'MiniMax-M2.7', contextWindow: 200_000 },
  { id: 'kimi-k2.5', name: 'Kimi-K2.5', contextWindow: 200_000 },
  { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 272_000 },
  { id: 'gpt-5.2', name: 'GPT-5.2', contextWindow: 272_000 },
]

/**
 * Static fallback directory for a region. Each region keeps its own model
 * slot in settings; the fallback must match the region so an account never
 * shows the other region's roster.
 */
export function fallbackModelsFor(region: TraeRegion): readonly TraeModelInfo[] {
  return region === 'ai' ? FALLBACK_TRAE_MODELS_AI : FALLBACK_TRAE_MODELS
}

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
  /**
   * Effective (post-discount) credit multiplier, read from the row's
   * `display_contact_config` — the figure the Trae IDE renders (see
   * `wireCreditMultiplier` in solo.ts). Wins over the Remote directory's own
   * `consumption_rate`, which reports the undiscounted value.
   */
  creditMultiplier?: number
  /**
   * The `get_detail_param` function this config_name came from. Trae splits its
   * callable roster across several functions (SOLO modes), and a model is only
   * callable through the function that actually lists it — glm-5.3 answers
   * `solo_work_remote` but rejects `solo_work_lite` with 4001. The chat call
   * therefore has to replay the directory's own function.
   */
  function?: string
}

/** Normalise a display name for cross-source joining. */
function displayKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Merge the two Trae model sources into one authoritative catalog.
 *
 * `remote` (the solo.trae.cn `/models` directory) is the authoritative model
 * skeleton: it supplies the display id, display name, context windows, credit
 * multiplier, reasoning and multimodal flags. `wire` (from `get_detail_param`)
 * supplies the real `llm_utils_chat` `config_name` — the only id the chat
 * endpoint actually accepts — plus the authoritative post-discount credit
 * multiplier when `display_contact_config` carries one. A remote row is only
 * callable when it maps to a wire `config_name`, so a remote row with no wire
 * match is DROPPED (it would otherwise be sent as an invalid `config_name` and
 * rejected with 4001 "param is invalid"). Verified 2026-08-30: the Remote
 * directory advertises `Doubao-Seed-Code` and `glm-5.3`, neither of which is a
 * current `config_name`; both fail every request, so they must not be exposed.
 *
 * Credit multiplier precedence: the wire's `display_contact_config` rate wins
 * whenever present (it is the post-discount figure the Trae IDE renders — the
 * Remote directory can report up to 10x the undiscounted value, see
 * `wireCreditMultiplier` in solo.ts); the Remote `consumption_rate` is the
 * fallback when the wire row carries none.
 *
 * Joining is two-tier, in priority order:
 *  1. `wire.id` (the `config_name`) equals the remote id — the model's display
 *     id is already its wire id (the common case: glm-5.2,
 *     DeepSeek-V4-Flash-Official, kimi-k3, …).
 *  2. `wire.name` (the `display_name`) equals the remote display name — for
 *     models whose display id differs from the wire id across Trae versions.
 * When the matched wire `config_name` differs from the remote id it is recorded
 * as `wireConfigName`; otherwise it is left undefined (id is already the wire id).
 */
export function mergeTraeModelSources(
  remote: readonly TraeDiscoveredModel[],
  wire: readonly TraeWireModel[],
): TraeModelInfo[] {
  const wireByName = new Map<string, TraeWireModel>()
  const wireById = new Map<string, TraeWireModel>()
  for (const model of wire) {
    wireByName.set(displayKey(model.name), model)
    wireById.set(displayKey(model.id), model)
  }
  const result: TraeModelInfo[] = []
  for (const model of remote) {
    const wireModel = wireById.get(displayKey(model.id)) ?? wireByName.get(displayKey(model.name))
    // No config_name maps to this display id → uncallable via llm_utils_chat.
    // Drop it rather than advertise a model that always fails with 4001.
    if (wireModel === undefined) continue
    // The wire rate wins whenever it is present — it is the post-discount
    // figure the Trae IDE renders (`display_contact_config`); the Remote
    // directory's own `consumption_rate` can report up to 10x the undiscounted
    // value under a live promotion (e.g. 0.80 vs the IDE's 0.08).
    const creditMultiplier = wireModel.creditMultiplier ?? model.creditMultiplier
    result.push({
      id: model.id,
      name: model.name,
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxContextWindow === undefined ? {} : { maxContextWindow: model.maxContextWindow },
      ...creditMultiplier === undefined ? {} : { creditMultiplier },
      input: ['text'],
      reasoningSupported: model.reasoningSupported,
      ...model.reasoning === undefined ? {} : {
        reasoning: model.reasoning,
        reasoningEfforts: Object.fromEntries(model.reasoning.supported.map(effort => [effort, effort === 'low' ? 'light' : effort === 'xhigh' ? 'extra_high' : 'high'])) as Partial<Record<TraeReasoningEffort, string>>,
      },
      ...wireModel.id !== '' && wireModel.id !== model.id ? { wireConfigName: wireModel.id } : {},
      ...wireModel.function === undefined ? {} : { wireFunction: wireModel.function },
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
  private models: readonly TraeModelInfo[]

  /**
   * @param region Seeds the static fallback for this region; each region's
   * provider must never serve the other region's roster before its first live
   * refresh lands.
   */
  constructor(region: TraeRegion = 'cn') {
    this.models = fallbackModelsFor(region)
  }

  current(): readonly TraeModelInfo[] {
    return this.models
  }

  set(models: readonly TraeModelInfo[]): void {
    if (models.length === 0) throw new Error('trae model catalog cannot be empty')
    this.models = models.map(model => ({ ...model, ...model.input === undefined ? {} : { input: [...model.input] } }))
  }
}
