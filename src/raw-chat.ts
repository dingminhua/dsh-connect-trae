export const TRAE_RAW_CHAT_V2_PATH = '/api/ide/v2/llm_raw_chat'
export const TRAE_RAW_CHAT_V1_PATH = '/api/ide/v1/llm_raw_chat'

/**
 * Normalise a tool `parameters` schema from JSON Schema draft-3 style to
 * draft-4 style (issue #49).
 *
 * Draft-3 declared a required property by putting a boolean `required: true`
 * INSIDE the property schema:
 *
 *   { "type": "object", "properties": { "tool": { "type": "string", "required": true } } }
 *
 * Draft-4 removed the per-property boolean and uses a parent-level string
 * array instead: `{ "required": ["tool"] }`. The Trae backends disagree on how
 * strictly they check this: the Zhipu backend (glm-5.2) tolerates draft-3
 * `required: true`, but the DeepSeek backend (deepseek-v4.1-flash) rejects the
 * whole request with `4027 … tools.N.function.parameters/properties/X/required:
 * invalid JSON Schema` whenever ANY tool carries the boolean form — and
 * `tools.N` are validated as a batch, so one bad schema fails the entire turn
 * (issue #49, after #48). Since a model's backend is chosen by the upstream
 * router and can change per config, every tool-carrying request must be
 * draft-4 clean regardless of which backend the probe last saw.
 *
 * The rewrite is local, idempotent, and recursive: it lifts each boolean
 * `required` up to the enclosing schema's `required` array (merging with any
 * array already present), then drops the boolean. Non-object property entries
 * are left untouched — draft-4 forbids boolean schemas anyway, so no boolean
 * `required` can hide inside them.
 */
export function normalizeTraeToolSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item) => {
      const next = normalizeTraeToolSchema(item)
      if (next !== item) changed = true
      return next
    })
    return changed ? items : value
  }
  if (typeof value !== 'object' || value === null) return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (key === 'required' && typeof entry === 'boolean') continue
    result[key] = normalizeTraeToolSchema(entry)
  }
  const properties = source['properties']
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    // Read the booleans off the SOURCE properties: the recursion above already
    // stripped them from `result`, so scanning the copies would find nothing.
    const promoted: string[] = []
    if (Array.isArray(source['required'])) {
      for (const name of source['required']) if (typeof name === 'string' && !promoted.includes(name)) promoted.push(name)
    }
    for (const [name, property] of Object.entries(properties as Record<string, unknown>)) {
      if (typeof property === 'object' && property !== null && (property as Record<string, unknown>)['required'] === true && !promoted.includes(name)) {
        promoted.push(name)
      }
    }
    if (promoted.length > 0) result['required'] = promoted
  }
  return JSON.stringify(result) === JSON.stringify(value) ? value : result
}

/** Issue #49: apply `normalizeTraeToolSchema` to an OpenAI-style tool list. */
export function normalizeTraeToolSchemas<T>(tools: readonly T[]): T[] {
  return tools.map((tool) => normalizeTraeToolSchema(tool) as T)
}

export type RawChatRole = 'assistant' | 'system' | 'tool' | 'user'

export interface RawChatTextContent {
  type: 'text'
  text: string
}

export interface RawChatImageContent {
  type: 'image_url'
  image_url: { url: string }
}

export type RawChatContent = RawChatTextContent | RawChatImageContent

export interface RawChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface RawChatMessage {
  role: RawChatRole
  content: string | RawChatContent[]
  tool_call_id?: string
  tool_calls?: RawChatToolCall[]
}

export interface RawChatTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface TraeRawChatDraft {
  model: string
  messages: RawChatMessage[]
  stream: true
  tools?: RawChatTool[]
  max_tokens?: number
  temperature?: number
  reasoning_effort?: string
  extra_info?: Record<string, unknown>
}

/**
 * Evidence-bounded OpenAI-like draft inferred from Trae's LLMRaw* DTO symbols.
 * Pure/offline only: the upstream remains disabled until one controlled probe.
 */
export function buildTraeRawChatDraft(input: {
  model: string
  messages: readonly RawChatMessage[]
  tools?: readonly RawChatTool[]
  maxTokens?: number
  temperature?: number
  reasoningEffort?: string
  extraInfo?: Record<string, unknown>
}): TraeRawChatDraft {
  if (input.model.trim() === '') throw new Error('Trae raw chat requires a model')
  if (input.messages.length === 0) throw new Error('Trae raw chat requires messages')
  return {
    model: input.model,
    messages: structuredClone([...input.messages]),
    stream: true,
    // Issue #49: deepseek-v4.1-flash and other strict backends reject the
    // whole batch when any tool carries draft-3 `required: true`, so every
    // draft is normalised to draft-4 before it leaves the plugin.
    ...input.tools === undefined || input.tools.length === 0 ? {} : { tools: normalizeTraeToolSchemas(structuredClone([...input.tools])) },
    ...input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens },
    ...input.temperature === undefined ? {} : { temperature: input.temperature },
    ...input.reasoningEffort === undefined ? {} : { reasoning_effort: input.reasoningEffort },
    ...input.extraInfo === undefined ? {} : { extra_info: structuredClone(input.extraInfo) },
  }
}

export type RawChatDelta =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; index: number; id?: string; name?: string; arguments?: string }
  | {
    type: 'usage'
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    /** Cache-read tokens (`prompt_tokens_details.cached_tokens` / `cached_tokens`). */
    cacheReadTokens?: number
    /** Cache-write tokens (`prompt_tokens_details.cache_write_tokens`). */
    cacheWriteTokens?: number
  }
  | { type: 'done'; finishReason: string }
  | { type: 'unknown'; value: unknown }

/** Decode OpenAI-like raw-chat chunks while preserving unknown structures. */
export function decodeRawChatChunk(value: unknown): RawChatDelta[] {
  if (value === '[DONE]') return [{ type: 'done', finishReason: 'stop' }]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [{ type: 'unknown', value }]
  const record = value as Record<string, unknown>
  const result: RawChatDelta[] = []
  const choices = Array.isArray(record['choices']) ? record['choices'] : []
  for (const rawChoice of choices) {
    if (typeof rawChoice !== 'object' || rawChoice === null) continue
    const choice = rawChoice as Record<string, unknown>
    const delta = typeof choice['delta'] === 'object' && choice['delta'] !== null ? choice['delta'] as Record<string, unknown> : {}
    if (typeof delta['reasoning_content'] === 'string' && delta['reasoning_content'] !== '') result.push({ type: 'reasoning', text: delta['reasoning_content'] })
    if (typeof delta['content'] === 'string' && delta['content'] !== '') result.push({ type: 'text', text: delta['content'] })
    if (Array.isArray(delta['tool_calls'])) {
      for (const rawTool of delta['tool_calls']) {
        if (typeof rawTool !== 'object' || rawTool === null) continue
        const tool = rawTool as Record<string, unknown>
        const fn = typeof tool['function'] === 'object' && tool['function'] !== null ? tool['function'] as Record<string, unknown> : {}
        result.push({
          type: 'tool-call',
          index: typeof tool['index'] === 'number' ? tool['index'] : 0,
          ...typeof tool['id'] === 'string' ? { id: tool['id'] } : {},
          ...typeof fn['name'] === 'string' ? { name: fn['name'] } : {},
          ...typeof fn['arguments'] === 'string' ? { arguments: fn['arguments'] } : {},
        })
      }
    }
    if (typeof choice['finish_reason'] === 'string' && choice['finish_reason'] !== '') result.push({ type: 'done', finishReason: choice['finish_reason'] })
  }
  if (typeof record['usage'] === 'object' && record['usage'] !== null) {
    const usage = record['usage'] as Record<string, unknown>
    const details = typeof usage['prompt_tokens_details'] === 'object' && usage['prompt_tokens_details'] !== null
      ? usage['prompt_tokens_details'] as Record<string, unknown>
      : {}
    // Accept both the canonical OpenAI nesting and the top-level spellings that
    // providers such as DeepSeek/Kimi use, mirroring pi-ai's own resolution.
    const cacheRead = details['cached_tokens'] ?? usage['prompt_cache_hit_tokens'] ?? usage['cached_tokens']
    const cacheWrite = details['cache_write_tokens']
    result.push({
      type: 'usage',
      ...typeof usage['prompt_tokens'] === 'number' ? { inputTokens: usage['prompt_tokens'] } : {},
      ...typeof usage['completion_tokens'] === 'number' ? { outputTokens: usage['completion_tokens'] } : {},
      ...typeof usage['total_tokens'] === 'number' ? { totalTokens: usage['total_tokens'] } : {},
      ...typeof cacheRead === 'number' ? { cacheReadTokens: cacheRead } : {},
      ...typeof cacheWrite === 'number' ? { cacheWriteTokens: cacheWrite } : {},
    })
  }
  return result.length === 0 ? [{ type: 'unknown', value }] : result
}
