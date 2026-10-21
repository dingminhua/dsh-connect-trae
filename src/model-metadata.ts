import { parseTraeActivityDiscount } from './promo.ts'
import type { TraeActivityDiscount } from './promo.ts'
import type { TraeReasoningEffort } from './reasoning.ts'

export interface TraeModelContextWindows {
  dev?: number
  max?: number
}

export interface TraeDiscoveredReasoning {
  supported: TraeReasoningEffort[]
  defaultEffort?: TraeReasoningEffort
}

export interface TraeDiscoveredModel {
  id: string
  name: string
  multimodal: boolean
  contextWindow?: number
  maxContextWindow?: number
  creditMultiplier?: number
  reasoningSupported: boolean
  reasoning?: TraeDiscoveredReasoning
  /**
   * The directory group the model was seen under (`data.list[].function`).
   *
   * The Remote `/models` answer is grouped by SOLO function and the group is
   * the authoritative statement of which function the model belongs to — the
   * `config_name` the gateway accepts is isolated per function, so a model in
   * `solo_work_remote` answers 4001 when asked through `solo_work_lite`. The
   * wire join (see `mergeTraeModelSources`) prefers its own
   * `get_detail_param` function and uses this as the fallback when the roster
   * has nothing to say (restricted networks often return an empty
   * `config_info_list` for the chat functions).
   */
  function?: string
  /**
   * Trae's discount rule for this row (`features.activity_discount`), kept whole
   * so the card can judge it against the clock at paint time (src/promo.ts).
   */
  activityDiscount?: TraeActivityDiscount
}

interface RawTraeRemoteModel {
  name?: unknown
  display_name?: unknown
  multimodal?: unknown
  max_mode?: unknown
  context_window_tokens?: unknown
  reasoning_effort_config?: unknown
  features?: unknown
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseFeatures(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  try { return record(JSON.parse(value) as unknown) } catch { return undefined }
}

const EFFORT_MAP: Readonly<Record<string, TraeReasoningEffort>> = {
  light: 'low',
  high: 'high',
  extra_high: 'xhigh',
}

/**
 * Parse only capabilities explicitly advertised by Trae's remote model API.
 *
 * @param groupFunction The `data.list[].function` of the group this raw row
 * was read from; attached verbatim so downstream can replay the model's own
 * function instead of the `llm_utils_chat` default (see
 * {@link TraeDiscoveredModel.function}).
 */
export function parseTraeRemoteModel(value: unknown, groupFunction?: string): TraeDiscoveredModel | undefined {
  const raw = record(value) as RawTraeRemoteModel | undefined
  if (raw === undefined || typeof raw.name !== 'string' || raw.name === '') return undefined
  const context = record(raw.context_window_tokens)
  const dev = finitePositive(context?.['dev'])
  const max = raw.max_mode === true ? finitePositive(context?.['max']) : undefined
  const features = parseFeatures(raw.features)
  const consumption = record(features?.['consumption_rate'])
  const consumptionData = record(consumption?.['data'])
  const creditMultiplier = consumption?.['enable'] === true ? finitePositive(consumptionData?.['rate']) : undefined
  const reasoningFeature = record(features?.['reasoning'])
  const reasoningSupported = reasoningFeature?.['enable'] === true
  // Upstream publishes the promotion rule as a sibling of `consumption_rate` in
  // the SAME features document this parser already walks, so reading it costs
  // no extra request and no extra response field.
  const activityDiscount = parseTraeActivityDiscount(features?.['activity_discount'])
  const reasoningConfig = record(raw.reasoning_effort_config)
  const rawOptions = Array.isArray(reasoningConfig?.['options']) ? reasoningConfig['options'] : []
  const supported = rawOptions.flatMap(option => {
    if (typeof option !== 'string') return []
    const effort = EFFORT_MAP[option]
    return effort === undefined ? [] : [effort]
  })
  const rawDefault = reasoningConfig?.['default_level']
  const mappedDefault = typeof rawDefault === 'string' ? EFFORT_MAP[rawDefault] : undefined
  const defaultEffort = mappedDefault !== undefined && supported.includes(mappedDefault) ? mappedDefault : undefined
  return {
    id: raw.name,
    name: typeof raw.display_name === 'string' && raw.display_name !== '' ? raw.display_name : raw.name,
    multimodal: raw.multimodal === true,
    ...dev === undefined ? {} : { contextWindow: dev },
    ...max === undefined ? {} : { maxContextWindow: max },
    ...creditMultiplier === undefined ? {} : { creditMultiplier },
    ...activityDiscount === undefined ? {} : { activityDiscount },
    reasoningSupported,
    ...supported.length === 0 ? {} : { reasoning: { supported, ...defaultEffort === undefined ? {} : { defaultEffort } } },
    ...groupFunction === undefined || groupFunction === '' ? {} : { function: groupFunction },
  }
}
