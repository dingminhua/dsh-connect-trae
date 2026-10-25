/**
 * The DSH thinking levels this plugin can carry, in ascending order.
 *
 * `max` is the fifth level Trae's own client advertises — its bundle ships the
 * i18n keys `trae-chat-core.model.reasoning_effort.{low,medium,high,extra_high,max}`
 * and `ai.model.reasoning_effort.{low,medium,high,xhigh,max}`, and publishes the
 * per-model list from a remote config (`AI.agent.model.reasoning_effort_level_by_agent_model_v2`).
 * Leaving it out of this list meant a level the vendor could start serving was
 * filtered away at PARSE time, before anything downstream could decide (issue
 * #60). Listing it does not fabricate the level: `supported` is still built
 * only from what the upstream response actually contains, so a model that does
 * not advertise `max` never offers it.
 *
 * `minimal` is kept for the same reason in reverse — it is a DSH level, so the
 * type must be able to represent it even though no CN model has advertised it.
 */
export const TRAE_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type TraeReasoningEffort = typeof TRAE_REASONING_EFFORTS[number]

export interface TraeReasoningCapability {
  supported: readonly TraeReasoningEffort[]
  defaultEffort?: TraeReasoningEffort
}

export function parseReasoningCapability(value: unknown): TraeReasoningCapability | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const rawOptions = Array.isArray(record['reasoning_effort_options']) ? record['reasoning_effort_options'] : []
  const supported = rawOptions.filter((item): item is TraeReasoningEffort =>
    typeof item === 'string' && (TRAE_REASONING_EFFORTS as readonly string[]).includes(item))
  const rawDefault = record['default_reasoning_effort']
  const defaultEffort = typeof rawDefault === 'string' && supported.includes(rawDefault as TraeReasoningEffort)
    ? rawDefault as TraeReasoningEffort
    : undefined
  if (supported.length === 0 && defaultEffort === undefined) return undefined
  return { supported, ...defaultEffort === undefined ? {} : { defaultEffort } }
}

/** Add effort only when the selected model advertises that exact value. */
export function applyReasoningEffort<T extends Record<string, unknown>>(
  body: T,
  effort: TraeReasoningEffort | undefined,
  capability: TraeReasoningCapability | undefined,
): T & { reasoning_effort?: TraeReasoningEffort } {
  if (effort === undefined) return body
  if (capability === undefined || !capability.supported.includes(effort)) {
    throw new Error(`Trae model does not advertise reasoning effort ${effort}`)
  }
  return { ...body, reasoning_effort: effort }
}
