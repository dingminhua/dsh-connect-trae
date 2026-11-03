/**
 * Which thinking level a model runs at when the caller names none.
 *
 * ## Why this module exists
 *
 * Trae's directory already tells us each model's own default level
 * (`reasoning_effort_config.default_level`, parsed into `reasoning.defaultEffort`
 * by `model-metadata.ts`) — measured 2026-11-03 on a live CN credential:
 * `deepseek-v4.1-flash` says `high`, `glm-5.3` says `xhigh`. The card's meta row
 * names the tiers it accepts, so the fact is known.
 *
 * DSH's model picker nevertheless reads **Default**, because the adapter never
 * reports that level upward (`reasoning.defaultEffort` is absent from what
 * {@link toPiModel} hands the kernel). The picker therefore cannot say which
 * tier a request will run at, and the request itself carries no
 * `reasoning_effort` — the upstream falls back to the same level it already
 * published, so nothing is broken, but nothing is knowable either, and the user
 * has no way to say "always use high on this model, regardless of what Trae
 * ships as its default".
 *
 * ## The three seams that must agree (any one missing and the picker still says Default)
 *
 * 1. **The adapter** must report the level as `LlmResolvedModelInfo.reasoning.defaultEffort`.
 *    The kernel materialises that into every request that names no effort
 *    (`dsh-llm` `resolveCallWithInfo`: `const effective = requested ?? reasoning.defaultEffort`),
 *    and DSH's model picker takes its "current level" from the same metadata.
 * 2. **A per-model saved choice** must survive a settings save. The settings
 *    channel rebuilds the whole region document through its schema, so a field
 *    absent from that schema is dropped on every save — the failure that once
 *    reset `wireConfigName` (see the `modelConfig` schema).
 * 3. **The bridge** must translate the level it receives into Trae's wire name.
 *    `solo-bridge.ts` already does exactly that through the model's own
 *    `reasoningEfforts` table, and deletes the field when the model does not
 *    advertise it — so a level is never sent under a name the vendor never said.
 *
 * ## Precedence
 *
 * The user's explicit choice > the level upstream declares > this model's own
 * middle tier.
 *
 * @module dsh-connect-trae/default-effort
 */

import { TRAE_REASONING_EFFORTS, type TraeReasoningEffort } from './reasoning.ts'

/**
 * The tier to fall back to when a model publishes a tier list but names no
 * default of its own and the user has never chosen one.
 *
 * `medium` is tried first because it is the only middle tier shared by the
 * families seen so far. It is deliberately not the only fallback: a model that
 * publishes `low / high` (measured on `Doubao-Seed-2.1-Pro` and
 * `step-5-preview`) has no `medium` at all, and picking its weakest tier instead
 * would silently mean "thinking off" — that is not a fallback, that is the worst
 * possible default.
 */
export const TRAE_FALLBACK_EFFORT: TraeReasoningEffort = 'medium'

/**
 * The slice of a model description this module reads.
 *
 * Structural rather than the full `TraeModelInfo`: the same question is asked of
 * the live catalog, of a saved `lastCatalog` row, and of the client's view
 * document, and none of them should have to satisfy the whole type.
 */
export interface DefaultEffortSource {
  /** The model id, which is also the key a saved choice is stored under. */
  id: string
  /** The tiers this model declares, as the catalog carries them. */
  supported?: readonly string[] | undefined
  /** The tier upstream marks as its own default. */
  defaultEffort?: string | undefined
}

/**
 * The tiers a model actually declares, filtered to ones DSH can name.
 *
 * Upstream's vocabulary is not DSH's: Trae publishes `light / high / extra_high`
 * and the parser maps them to `low / high / xhigh` (`EFFORT_MAP`). Anything that
 * still fails to land in DSH's six names is dropped rather than passed through —
 * a level the kernel cannot name would be rejected with
 * `UNSUPPORTED_REASONING_EFFORT` and take the whole request with it.
 *
 * The result keeps `TRAE_REASONING_EFFORTS` order, so it reads weakest-first.
 */
export function declaredEfforts(model: DefaultEffortSource): TraeReasoningEffort[] {
  const supported = model.supported ?? []
  return TRAE_REASONING_EFFORTS.filter(level => supported.includes(level))
}

/**
 * The tier this model should run at when a request names none.
 *
 * @param model - the model, with the tiers it declares and its upstream default.
 * @param saved - the user's per-model choices (model id -> tier). A missing key
 *   means the user never chose, which is different from choosing the tier that
 *   happens to equal the upstream default.
 * @returns a tier **this model declares**, or `undefined` when it declares none.
 */
export function defaultEffortFor(
  model: DefaultEffortSource,
  saved: Readonly<Record<string, string | undefined>> = {},
): TraeReasoningEffort | undefined {
  const declared = declaredEfforts(model)
  // No tiers at all means this model offers no reasoning control. Returning a
  // tier anyway would make the kernel reject the request.
  if (declared.length === 0) return undefined

  // A choice the user made wins, but only while it is still something this model
  // offers: a directory refresh can withdraw a tier, and reporting a withdrawn
  // one would fail every request on that model.
  const asked = saved[model.id]
  const chosen = declared.find(level => level === asked)
  if (chosen !== undefined) return chosen

  // What upstream itself says it does. This is the level the request would
  // really run at today, which is why reporting it changes no behaviour — it
  // only makes the behaviour visible (and overridable).
  const upstream = declared.find(level => level === model.defaultEffort)
  if (upstream !== undefined) return upstream

  // A model with a tier list but no published default.
  if (declared.includes(TRAE_FALLBACK_EFFORT)) return TRAE_FALLBACK_EFFORT
  return declared[Math.floor((declared.length - 1) / 2)]
}

/**
 * The tiers the card should offer for this model.
 *
 * Exactly what the model declares — no localisation, no union across models.
 * The families genuinely differ (`low / high` vs `low / high / xhigh`), and
 * synthesising one shared ladder would list options that cannot be selected.
 */
export function selectableEfforts(model: DefaultEffortSource): TraeReasoningEffort[] {
  return declaredEfforts(model)
}
