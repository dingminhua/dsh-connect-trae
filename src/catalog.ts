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
  /**
   * Trae's own `multimodal` flag for this model, carried through from the
   * directory that advertised it. It is the upstream's answer to "does this
   * model read images", and {@link applyImageSelection} unions it with the
   * user's explicit opt-ins.
   *
   * Deliberately NOT the same thing as `input`: `input` is what DSH is told
   * this route accepts, while this field records what Trae said. Keeping both
   * lets a future refresh re-derive `input` without losing the upstream fact,
   * and lets the card explain WHY a model is image-capable.
   *
   * Absent means the directory did not say (an older `lastCatalog` saved before
   * this field existed, a fallback row, or a directory entry that omitted the
   * key). Absent is treated as false, never as "assume capable": sending an
   * image to a model that cannot read one burns credits for a silent failure.
   */
  multimodal?: boolean
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
 *
 * `withRate` is false for the ENTERPRISE panel. The multiplier is a
 * consumer-pool figure — personal credits per token, read from the consumer
 * directory — and the tenant pool does not bill against it, so printing it in
 * the model picker would price a model the tenant is not charged for. The rate
 * is part of the NAME that reaches DSH, which is why this is a parameter here
 * and not a rendering decision downstream.
 */
export function traeModelDisplayName(
  model: Pick<TraeModelInfo, 'name' | 'creditMultiplier'>,
  withRate = true,
): string {
  return !withRate || model.creditMultiplier === undefined
    ? model.name
    : `${model.name} · x${model.creditMultiplier.toFixed(2)}`
}

/**
 * Whether one model should be offered image input.
 *
 * Two independent sources, unioned (issue #16):
 *
 *  - the user's explicit `imageModelIds` opt-in, which stays authoritative and
 *    can still switch an individual model on;
 *  - Trae's own `multimodal` flag, which is what makes "auto" work at all.
 *
 * Rationale: Trae's IDE enables its attach-image button purely from this flag
 * (`metadata.capabilities.vision`), with no user switch, so a model Trae itself
 * calls multimodal is one the vendor expects to receive images. Requiring a
 * manual tick for those made this plugin the only place where a vendor-declared
 * capability had to be re-enabled by hand.
 *
 * Why the flag alone is not enough, and the union is:
 *
 *  - the flag is advisory, not a contract. `llm_utils_chat` is a lightweight
 *    SOLO channel and this plugin has been burned by `4001 param is invalid`
 *    for ids that LOOKED valid, so the flag is not treated as proof of
 *    callability — a model still has to have survived the wire join to appear
 *    at all. The flag only decides image input, never model availability.
 *  - Users who already ticked a model keep that tick even after a refresh stops
 *    reporting the flag, so the union never silently revokes a working setup.
 *  - `input` remains the ONLY thing told to DSH: a model that ends up without
 *    `image` here is one DSH will degrade images to text for, which is the
 *    safe direction for a model whose capability we cannot confirm.
 *
 * `multimodal === true` is a strict test: absent, `false`, or any non-boolean
 * leaves the model text-only unless the user opted in.
 */
export function traeModelAcceptsImage(
  model: Pick<TraeModelInfo, 'id' | 'multimodal'>,
  selected: ReadonlySet<string>,
): boolean {
  return selected.has(model.id) || model.multimodal === true
}

/** Apply the user's explicit image opt-ins plus Trae's own multimodal flag. */
export function applyImageSelection(
  models: readonly TraeModelInfo[],
  selected: ReadonlySet<string>,
): TraeModelInfo[] {
  return models.map(model => ({
    ...model,
    input: traeModelAcceptsImage(model, selected) ? ['text', 'image'] : ['text'],
  }))
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
 * multiplier when `display_contact_config` carries one.
 *
 * A remote row with no wire match is STILL KEPT (decision 2026-10-02, issue
 * #19). It previously was dropped, on the reasoning that a row with no
 * `config_name` is sent as an invalid one and rejected with 4001. That
 * reasoning holds only for the accounts and functions we can measure, and
 * measuring is the problem: whether a roster contains a model is ACCOUNT-
 * SCOPED, so "no wire entry on a free account" cannot prove a paying account
 * cannot call it. Dropping on that evidence silently denied those users models
 * their own Trae IDE offers. The row therefore ships, and its call fails
 * honestly: the bridge now translates the in-stream refusal into a readable
 * error (`4001` → "Trae does not serve this model under the SOLO function the
 * request used", `4011` → "Trae throttled the SOLO channel for this account",
 * the second one corrected by issue #33 — 4011 is a rate limit, see
 * src/solo-bridge.ts), so a user who picks an unusable model is told why instead
 * of seeing nothing. This reverses the 2026-08-30 note about `Doubao-Seed-Code`,
 * which later turned out to be callable under `chat_v3`.
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
  // First write wins, per map (issue #38). The wire roster can list one display
  // name across several ids, and it may include a metadata-poor tail row whose
  // `id` AND `name` are the same lower-case string. A last-write-wins loop let
  // such a tail row overwrite the *display-name* key, after which the bridge
  // rewrote `config_name` to that lower-case spelling — a form the upstream can
  // reject with 4001, because the wire id is the only `llm_utils_chat` name it
  // publishes. The reporter's CN roster (in the #38 issue) carries that shape
  // for DeepSeek-V4-Flash/-Pro; keeping the FIRST row per key leaves the
  // canonical row in place, so no rewrite happens.
  //
  // Provenance of this guard, stated honestly (audited 2026-10-16):
  //  - CONFIRMED: the collision is real, and the old loop resolved it by
  //    arrival order; feeding one roster in forward vs reverse order flips the
  //    resolved `config_name` AND `wireFunction` for colliding names.
  //  - CONFIRMED: for the reporter's DeepSeek-V4 shape, first-wins restores the
  //    camel-case id the upstream publishes.
  //  - NOT VERIFIED LIVE: on the maintainer's own international account the wire
  //    carries no lower-case tail row at all (the family appears once, as
  //    `deepseek-v4-flash-0731`), so here first-wins and last-wins agree and
  //    this change is a no-op. Treat it as a precautionary determinism fix for
  //    the CN shape, not as a fix measured live on this account.
  //  - UNPROVEN: for collisions whose ids are semantically different (custom
  //    model vs paygo vs search-agent), first-wins is merely deterministic — it
  //    cannot be shown to pick the row the gateway accepts. Do not assume the
  //    winner is correct just because it is stable.
  for (const model of wire) {
    if (!wireById.has(displayKey(model.id))) wireById.set(displayKey(model.id), model)
  }
  for (const model of wire) {
    if (!wireByName.has(displayKey(model.name))) wireByName.set(displayKey(model.name), model)
  }
  const result: TraeModelInfo[] = []
  for (const model of remote) {
    const wireModel = wireById.get(displayKey(model.id)) ?? wireByName.get(displayKey(model.name))
    // A row with no wire match still ships (see the note above): the wire lists
    // are account-scoped, so their silence is not proof of uncallability. With
    // no `wireConfigName` the bridge sends the display id and the default
    // function, and an upstream refusal comes back as a readable message
    // rather than a silent absence.
    // The wire rate wins whenever it is present — it is the post-discount
    // figure the Trae IDE renders (`display_contact_config`); the Remote
    // directory's own `consumption_rate` can report up to 10x the undiscounted
    // value under a live promotion (e.g. 0.80 vs the IDE's 0.08).
    const creditMultiplier = wireModel?.creditMultiplier ?? model.creditMultiplier
    // The function `llm_utils_chat` must be asked through. The wire function
    // (`get_detail_param`'s opinion) wins whenever present; the Remote
    // directory's OWN group function backs it up. A restricted network often
    // returns an empty `config_info_list` for the chat functions, so without
    // the directory fallback every row would carry no `wireFunction` and the
    // bridge would send the default `solo_work_lite` — which 4001s for any
    // model that a non-default function serves (glm-5.3 lives on
    // `solo_work_remote`). Directory attribution itself never overrides a wire
    // answer: the roster knows the paid/entitled state the directory cannot.
    const wireFunction = wireModel?.function ?? model.function
    result.push({
      id: model.id,
      name: model.name,
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxContextWindow === undefined ? {} : { maxContextWindow: model.maxContextWindow },
      ...creditMultiplier === undefined ? {} : { creditMultiplier },
      input: ['text'],
      // The wire's `model_detail_list[].max_tokens` — the ONLY place upstream
      // publishes the max OUTPUT cap. The Remote directory has no such field, so
      // a row keeps `maxTokens` absent when it maps to no wire config. Dropped
      // here until issue #42: every CN model card read as blank "最大输出" even
      // though all 80 wire configs carry the value.
      ...wireModel?.maxTokens === undefined ? {} : { maxTokens: wireModel.maxTokens },
      // Trae's own answer to "does this model read images". Carried through so
      // `applyImageSelection` can union it with the user's opt-ins (issue #16);
      // `input` stays text here and is decided by that single later pass.
      ...model.multimodal === undefined ? {} : { multimodal: model.multimodal },
      reasoningSupported: model.reasoningSupported,
      ...model.reasoning === undefined ? {} : {
        reasoning: model.reasoning,
        reasoningEfforts: Object.fromEntries(model.reasoning.supported.map(effort => [effort, effort === 'low' ? 'light' : effort === 'xhigh' ? 'extra_high' : 'high'])) as Partial<Record<TraeReasoningEffort, string>>,
      },
      ...wireModel !== undefined && wireModel.id !== '' && wireModel.id !== model.id ? { wireConfigName: wireModel.id } : {},
      ...wireFunction === undefined ? {} : { wireFunction },
    })
  }
  return result
}

/**
 * Demote a NON-chat `wireFunction` to "no function", keeping the row.
 *
 * A row pinned to an IDE/Remote-agent roster — `solo_agent`, `builder_v3` — is
 * not callable through `llm_utils_chat` by THAT function: asking answers
 * 4011/4001 (measured 2026-10-01, issue #19). Dropping the row is not the fix,
 * though, and was a regression: a model can carry a non-chat function for a
 * reason that says nothing about its chat availability. The directory lists
 * `gpt-5.5`, `gpt-5.6-*`, `gpt-6-astra`, `glm-5.2`, `kimi-k2.7-code`,
 * `Dola-Seed-2.0-Code` and `deepseek-v4-flash-0731` under `solo_agent` ALONE
 * (docs/ISSUE19_DIAGNOSIS.md), yet the same models answer normally under
 * `solo_work_remote` / `solo_work_lite` / `solo_agent_remote` — they are
 * exactly the models issue #19's fix was opened to expose. Dropping them
 * re-hid the whole set on the restricted networks this fallback targets, where
 * the wire roster is empty and the directory group is the only attribution.
 *
 * Keeping the row with the function CLEARED preserves both facts: the model
 * stays visible (issue #19), and the bridge sends the region's DEFAULT chat
 * function instead of one that is guaranteed to refuse. That is the pre-change
 * behaviour for these rows — a genuinely unreachable model still fails with a
 * readable upstream message rather than a silent absence.
 *
 * `chatFunctions` must be the region's own `TRAE_DIRECTORY_FUNCTIONS` list —
 * the functions `llm_utils_chat` accepts. Callers should log the demoted rows:
 * "which function did it lose, and why" deserves an answer.
 */
export function withChatCallableFunctions(rows: readonly TraeModelInfo[], chatFunctions: readonly string[]): TraeModelInfo[] {
  return rows.map(model => {
    if (model.wireFunction === undefined || chatFunctions.includes(model.wireFunction)) return model
    const { wireFunction: _demoted, ...withoutFunction } = model
    return withoutFunction
  })
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

/** Convert Trae metadata into catalog rows; image input is decided by {@link applyImageSelection}. */
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
      // See mergeTraeModelSources: the upstream flag travels with the row so the
      // one later image pass can union it with the user's explicit opt-ins.
      ...model.multimodal === undefined ? {} : { multimodal: model.multimodal },
      // The directory group the model was discovered under (see
      // TraeDiscoveredModel.function) — carried as `wireFunction` so the bridge
      // replays the model's own function even without a wire roster.
      ...model.function === undefined ? {} : { wireFunction: model.function },
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
