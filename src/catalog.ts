import type { TraeDiscoveredModel, TraeDiscoveredReasoning } from './model-metadata.ts'
import type { TraeActivityDiscount } from './promo.ts'
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
  /**
   * Trae's discount RULE for this model, exactly as published (see src/promo.ts).
   *
   * Kept unflattened and unjudged: whether a badge is painted depends on the
   * clock, so the card judges it at paint time rather than trusting a verdict
   * frozen into a saved catalog. Absent means the model carries no promotion
   * document — including every `ai` (international) row, whose subscription
   * models publish no `consumption_rate` at all.
   */
  activityDiscount?: TraeActivityDiscount
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
  /**
   * The row's own `activity_discount`, read from `display_contact_config`.
   *
   * The wire roster is the richer of the two directories (8 rows carrying a
   * discount vs the Remote directory's 4), and the same model can name a
   * different campaign on each side, so this value wins over the Remote one
   * during the merge — the precedence `creditMultiplier` already follows.
   */
  activityDiscount?: TraeActivityDiscount
  /**
   * Upstream's `usage` for this config — what the config is FOR.
   *
   * Read from `get_detail_param`'s top-level `usage` field (verified
   * 2026-10-22 on a live CN credential): `chat_completion` for a real model,
   * `custom_model` for a user's own custom model, and one value per built-in
   * tool config (`summary`, `title_generation`, `fast_apply`,
   * `input_optimization`, …).
   *
   * It is the discriminator that separates a MODEL from a TOOL, and
   * {@link mergeTraeModelSources} needs it to decide which wire-only rows may
   * be promoted into the catalog (issue #46). Absent means "upstream did not
   * say" — never "assume it is a tool", and never "assume it is a model".
   */
  usage?: string
  /**
   * Upstream's `config_source` for this config.
   *
   * `1` is a Trae preset; `3` is the account's own custom model (it carries a
   * `custom_config` with the user's own base_url and key). The plugin does not
   * serve a user's custom model, so a `3` row is never promoted (issue #46).
   * Absent means "upstream did not say".
   */
  configSource?: number
}

/**
 * Whether a wire row is a USER-FACING MODEL that the catalog may expose.
 *
 * Issue #46: the Remote directory is the catalog's SKELETON, but the wire
 * roster knows models the skeleton does not — and the skeleton systematically
 * omits one whole CLASS of them: the dated snapshot configs
 * (`kimi-k2-0905`, `seed-code-pro-0430`, …). Measured 2026-10-22 on a live
 * CN credential, the Remote skeleton carried **zero** dated config_names
 * while the wire roster carried three, so every one of them was dropped by
 * the join and the user could not reach the snapshot the IDE offered them.
 *
 * A row qualifies only when ALL of the following hold — each test is an
 * upstream signal, none of them invented:
 *
 *  - `usage === 'chat_completion'` — it is a model, not a tool config. The
 *    wire roster mixes models with the IDE's own helpers (`summary`,
 *    `title_generation`, `fast_apply`, `input_optimization`) and with the
 *    account's custom models (`usage: 'custom_model'`); none of those belong
 *    in a model picker. Measured: this one test removed 23 of 50 wire-only
 *    rows, and every row it removed was a tool or a custom model.
 *  - `config_source === 1` — a Trae preset, not the account's own custom
 *    model (source 3, which carries the user's own base_url and key). The
 *    plugin must not offer to bill a model it does not host.
 *  - a REAL display name — not empty, not the upstream placeholder `-`, not a
 *    bare config identifier (`search_agent_qwen_fast`,
 *    `computer_use_subagent`), and not the config's OWN id. A model with no
 *    name has nothing to show in the picker.
 *
 * The display-name-collision test lives in the merge itself (it needs the
 * Remote rows to compare against); see {@link mergeTraeModelSources}. It is a
 * CAPABILITY test there, not a name test: a collision only suppresses a row
 * when the equally-named row is at least as capable.
 *
 * The survivors are exactly the models a user would recognise and the IDE
 * offers but the plugin hid: `kimi-k2` / `kimi-k2-0905`, `glm-4.6`,
 * `glm-4.7`, `glm-5-turbo`, `minimax-m2`, `minimax-m2.1`, `qwen3-coder`,
 * `seed-code-pro-0430`.
 */
export function isPromotableWireModel(model: TraeWireModel): boolean {
  if (model.usage !== 'chat_completion') return false
  if (model.configSource !== 1) return false
  const name = model.name.trim()
  if (name === '' || name === '-') return false
  // The name is the config's OWN id: upstream published no display name for
  // it, and the wire client falls back to the id in that case. Measured: the
  // codename configs `sagitta` and `aquila` are published with the placeholder
  // `-` by some functions and with nothing at all by others, so their "name"
  // is just the id — a codename the user cannot act on, offered under a name
  // that says nothing about what the model is.
  if (name === model.id.trim()) return false
  // A bare identifier (`search_agent_qwen_fast`) is a config name wearing a
  // display-name hat, not a model name: it carries an underscore and no
  // space, which is how every upstream tool config spells itself.
  if (!name.includes(' ') && name.includes('_')) return false
  return true
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
 *
 * The DISPLAY NAME stays the Remote skeleton's (issue #46). The wire roster
 * was measured as a name source and REJECTED: it disagrees with the Trae
 * IDE's own roster on 32 of 81 ids, while the skeleton disagrees on 3 of 33.
 * The wire roster is function-scoped — the same id carries a different
 * `display_name` per function — and the plugin's wire client reads the CHAT
 * functions, so it can land on a name the IDE's picker never shows. The wire
 * keeps its own roles: the `config_name`, the function, the output cap, the
 * multiplier and the promotion rule.
 *
 * Rows the Remote skeleton does not know but the wire roster does are
 * PROMOTED (issue #46) — subject to {@link isPromotableWireModel}. The
 * skeleton systematically omits the dated snapshot configs, so without
 * promotion every snapshot the IDE offers is unreachable from the plugin.
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
    // Same precedence for the promotion rule: the wire row is the richer
    // directory, the Remote row is the fallback. Never merged field-by-field —
    // a half-merged rule (a wire `off_peak` with a Remote `current`) would
    // describe a campaign upstream never published.
    const activityDiscount = wireModel?.activityDiscount ?? model.activityDiscount
    result.push({
      id: model.id,
      // The DISPLAY NAME comes from the Remote skeleton (issue #46).
      //
      // The wire roster was tried here first and MEASURED WRONG, so the
      // reason is recorded rather than left as an assertion: measured
      // 2026-10-22 on a live CN credential, the wire roster
      // (`get_detail_param`) disagrees with the Trae IDE's own roster
      // (`batch_get_detail_param`, the source the IDE picker renders) on
      // **32** of 81 ids, while the Remote skeleton disagrees on only **3**
      // of 33. The wire roster is the FUNCTION-SCOPED view — the same id
      // carries a different `display_name` depending on which function asked
      // (measured: 10 of 102 ids carry more than one name across the IDE's
      // own functions — `DeepSeek-V4-Pro-Official` is both
      // `DeepSeek-V4-Pro` and `DeepSeek-V4-Pro 正式版`), and the plugin's
      // wire client reads the CHAT functions, so it can land on the name a
      // chat function publishes rather than the one the picker shows.
      //
      // So the skeleton stays the authority for the NAME, and the wire keeps
      // its own roles: it owns the `config_name`, the function, the output
      // cap, the multiplier and the promotion rule.
      name: model.name,
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxContextWindow === undefined ? {} : { maxContextWindow: model.maxContextWindow },
      ...creditMultiplier === undefined ? {} : { creditMultiplier },
      ...activityDiscount === undefined ? {} : { activityDiscount },
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
  // Rows the Remote skeleton does not know but the wire roster does (issue #46).
  //
  // The skeleton is the catalog's SKELETON, but it is not complete: measured
  // 2026-10-22 on a live CN credential it carried ZERO dated snapshot
  // config_names (`kimi-k2-0905`, `seed-code-pro-0430`, …) while the wire
  // roster carried three. Every dated snapshot was therefore dropped by the
  // join above, and the user could not reach the model the IDE offered them —
  // the report behind issue #46 ("the IDE lists DeepSeek-V4.1-Flash-1017, the
  // plugin does not").
  //
  // The same reasoning that made issue #19 keep a REMOTE row with no wire
  // match applies here with the sides swapped: a roster's silence is not
  // proof that a model is absent, it is proof that THIS directory does not
  // list it. The rosters are account-scoped and the two directories snapshot
  // different revisions, so a model present in one and absent from the other
  // is a normal state, not a contradiction.
  //
  // Promotion is NOT unconditional — see {@link isPromotableWireModel} for the
  // upstream signals a row must carry (a real model usage, a Trae preset
  // source, a real display name), plus the capability test below for rows whose
  // display name another row already claims.
  //
  // A promoted row is a full catalog row: it carries the wire's own id (which
  // IS its `config_name`, so no `wireConfigName` is needed), the wire's
  // function, its context window, its output cap, its multiplier and its
  // promotion rule — every field the wire roster already parsed.
  const remoteIds = new Set(remote.map(model => displayKey(model.id)))
  /**
   * Display name -> the LARGEST context window claimed under it.
   *
   * A name collision does NOT by itself mean "alias". Two rows sharing a
   * display name are sometimes genuinely different models, and the only
   * upstream signal that separates them is capability. Measured 2026-10-22 on
   * a live CN credential:
   *
   *  - `kimi-k2` (28000) and `kimi-k2-0905` (168000) BOTH display as
   *    `Kimi-K2-0905` — and both ANSWER (verified: `kimi-k2-0905` answers
   *    under `solo_coder` and `chat_v3`). Dropping the second one hid a real
   *    168k model behind an equally-named 28k one, which is exactly the
   *    "dated snapshot the IDE offers, the plugin does not" complaint of
   *    issue #46.
   *  - `minimax-m2` (100000, `chat_v3`) and `minimax-m2-auto` (168000,
   *    `solo_coder`) both display as `MiniMax-M2` — again a bigger config
   *    behind an equally-named smaller one.
   *  - `glm-4.7` and `glm-4.7-auto` both display as `GLM-4.7` with IDENTICAL
   *    metadata (100000/16000/`chat_v3`) — a true duplicate, and promoting it
   *    would list one model twice for no gain.
   *  - `glm-5.2_advisor_default` (168000) is SMALLER than the skeleton's
   *    `glm-5.2` (200000), so it is an internal re-routing of a model the user
   *    already has in full — not worth a second row.
   *
   * So the rule is: a collision skips the row UNLESS the new row carries a
   * STRICTLY LARGER context window, in which case the user is being offered
   * capability the equally-named row does not have and hiding it would cost
   * them something real. Names are tracked with their best context so the
   * comparison is always against the strongest claimant, whatever the order.
   */
  const claimedNames = new Map<string, number>()
  const claim = (name: string, contextWindow: number | undefined): void => {
    const key = displayKey(name)
    if (key === '') return
    claimedNames.set(key, Math.max(claimedNames.get(key) ?? 0, contextWindow ?? 0))
  }
  for (const model of remote) claim(model.name, model.contextWindow)
  for (const wireModel of wire) {
    if (remoteIds.has(displayKey(wireModel.id))) continue
    if (!isPromotableWireModel(wireModel)) continue
    // A display name already claimed means this row either aliases a model the
    // catalog exposes or duplicates it. It earns its own row only when it is
    // strictly more capable than the strongest claimant — see `claimedNames`.
    const collides = claimedNames.has(displayKey(wireModel.name))
    if (collides && (wireModel.contextWindow ?? 0) <= (claimedNames.get(displayKey(wireModel.name)) ?? 0)) continue
    /**
     * A surviving collision gets the id appended, because the whole point of
     * promoting it is that the user can TELL IT APART from the equally-named
     * row: two rows rendering as `MiniMax-M2` is a picker that lies about
     * having one model. The id is the `config_name` the bridge sends, so it is
     * also the most actionable disambiguator available.
     */
    const name = collides ? `${wireModel.name} (${wireModel.id})` : wireModel.name
    claim(wireModel.name, wireModel.contextWindow)
    // Register the disambiguated name too, so no later row can mint the same
    // one and produce a second indistinguishable pair.
    claim(name, wireModel.contextWindow)
    result.push({
      id: wireModel.id,
      name,
      ...wireModel.contextWindow === undefined ? {} : { contextWindow: wireModel.contextWindow },
      ...wireModel.maxTokens === undefined ? {} : { maxTokens: wireModel.maxTokens },
      ...wireModel.creditMultiplier === undefined ? {} : { creditMultiplier: wireModel.creditMultiplier },
      ...wireModel.activityDiscount === undefined ? {} : { activityDiscount: wireModel.activityDiscount },
      input: ['text'],
      // The wire roster does not publish a multimodal flag (the Remote
      // directory does), so a promoted row is text-only until the user
      // opts in — the same safe default as any row without that flag.
      reasoningSupported: wireModel.reasoning !== undefined,
      ...wireModel.reasoning === undefined ? {} : {
        // The wire's reasoning capability is a READ-ONLY list; the catalog row
        // carries a mutable one, so the list is copied rather than aliased.
        reasoning: {
          supported: [...wireModel.reasoning.supported],
          ...wireModel.reasoning.defaultEffort === undefined ? {} : { defaultEffort: wireModel.reasoning.defaultEffort },
        },
        reasoningEfforts: Object.fromEntries(wireModel.reasoning.supported.map(effort => [effort, effort === 'low' ? 'light' : effort === 'xhigh' ? 'extra_high' : 'high'])) as Partial<Record<TraeReasoningEffort, string>>,
      },
      // The row's own id IS its wire `config_name` (the roster's ids are the
      // names `llm_utils_chat` accepts), so no `wireConfigName` is emitted.
      ...wireModel.function === undefined ? {} : { wireFunction: wireModel.function },
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
      // A live refresh keeps the promotion rule on the row so the card can
      // judge it at paint time; it is display data only and never affects what
      // DSH is told about the model.
      ...model.activityDiscount === undefined ? {} : { activityDiscount: model.activityDiscount },
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
