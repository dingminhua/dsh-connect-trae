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
 *
 * Issue #98 added the second half of the same repair: a tool whose `parameters`
 * is a bare PROPERTY MAP rather than a schema gets an object root. See
 * `looksLikePropertyMap` below for why that shape reaches this function at all.
 */
export function normalizeTraeToolSchema(value: unknown): unknown {
  return normalizeSchemaNode(value, true)
}

/**
 * The recursive worker. `allowWrap` says "an object HERE may be a bare property
 * map", and it is set at exactly two places: the value this function was called
 * with (a `parameters` value handed in directly), and the value of any
 * `parameters` key met on the way down. It is NOT set for a `properties`
 * container — that object is also a map of name → schema, so guessing by shape
 * alone would rewrap every valid schema's properties and produce
 * `{ type: 'object', properties: { properties: … } }`.
 */
function normalizeSchemaNode(value: unknown, allowWrap: boolean): unknown {
  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item) => {
      // An array is never a property map; its elements are schemas or tool
      // records, and a tool record reaches its `parameters` by key below.
      const next = normalizeSchemaNode(item, false)
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
    result[key] = normalizeSchemaNode(entry, key === 'parameters')
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
  } else if (allowWrap && looksLikePropertyMap(source)) {
    // Issue #98: rewrap the bare map into the exact schema DSH's own
    // `defineTool()` would have produced, so the repair matches the first-party
    // compile pipeline rather than inventing a shape: `{ type: 'object',
    // properties, required }`, with NO `additionalProperties` — the DSL compiler
    // does not emit one, and adding it would forbid arguments the tool expects.
    //
    // `result` holds exactly the property entries here: `looksLikePropertyMap`
    // rejects the container keys, so nothing else survived the loop above.
    const declared: Record<string, unknown> = {}
    const promoted: string[] = []
    for (const [name, entry] of Object.entries(result)) {
      declared[name] = compileDslLeaf(entry)
      // Read the boolean off the SOURCE: the loop above already stripped it from
      // `entry` (which may even be the very same object identity).
      if ((source[name] as Record<string, unknown>)['required'] === true) promoted.push(name)
    }
    return {
      type: 'object',
      properties: declared,
      ...promoted.length > 0 ? { required: promoted } : {},
    }
  }
  return JSON.stringify(result) === JSON.stringify(value) ? value : result
}

/**
 * Keys that mean "this object is a SCHEMA or a TOOL RECORD", never a property
 * map. Issue #98's shape is a map with only property names as keys, so seeing
 * any of these means the object is not one.
 */
/**
 * Keys whose VALUE only makes sense as a schema keyword. Used together with a
 * shape check, never on its own — see `looksLikePropertyMap`.
 *
 * `type`, `name`, `description`, `title`, `enum`, `const`, `strict` and `items`
 * are deliberately NOT listed: a DSH parameter name is unconstrained, so
 * `{ type: { type: 'string' } }` is a perfectly ordinary one-parameter map, and
 * judging by key names alone made the repair skip exactly those tools (the
 * `400` this issue is about then survived). The decision therefore reads the
 * VALUE: a schema's `type` is a string, while a parameter called `type` maps to
 * an object. The keys kept here are the ones whose value shape overlaps too
 * little to tell apart, so they stay disqualifying.
 */
const SCHEMA_CONTAINER_KEYS = new Set(['properties', 'parameters'])

/**
 * Whether `value` is DSH's shorthand PARAMETER MAP — `{ field: schema, … }` —
 * rather than a JSON Schema (issue #98).
 *
 * This shape can only reach a Trae request through the raw `ctx.tools.register()`
 * seam: it validates `output.schema` but not `definition.parameters`, so a plugin
 * that passes the DSL map straight through ships it verbatim, while
 * `defineTool()` would have compiled it to `{ type: 'object', properties, … }`.
 * Trae's DeepSeek backend requires an object root and rejects the whole batch
 * otherwise: `400 tools.15.function.parameters must be a JSON Schema of type object`.
 *
 * An EMPTY object counts as a map here, not as "not a schema": at the parameters
 * position `{}` is what a no-argument tool compiles to, and there is no other
 * reading of it. (An empty object on its own is a valid unconstrained schema,
 * but only at a property position — which is why the caller, not this function,
 * decides whether wrapping is even allowed.)
 *
 * Everything else is judged by VALUE, not by key name: every entry must itself
 * look like a schema, and no entry may be a bare string/number/null. A tool
 * record (`function: {...}`) and a leaf (`type: 'string'`) both fail that.
 */
function looksLikePropertyMap(source: Record<string, unknown>): boolean {
  const names = Object.keys(source)
  if (names.length === 0) return true
  for (const name of names) if (SCHEMA_CONTAINER_KEYS.has(name)) return false
  return names.every((name) => isSchemaLike(source[name]))
}

/** A value that could be the right-hand side of a property entry. */
function isSchemaLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record['type'] === 'string') return true
  return ['properties', 'items', 'enum', 'oneOf', 'anyOf', 'allOf'].some((key) => Object.hasOwn(record, key))
}

/**
 * Compile one DSH DSL property schema to the JSON Schema the wire accepts.
 *
 * Only the one difference that breaks the request is handled: DSH's `type: 'json'`
 * means "any JSON value", which JSON Schema spells as a schema with NO `type`.
 * Shipping `type: 'json'` verbatim is rejected by the same strict backend that
 * rejects a missing object root (`4027 … must be a JSON Schema`), so it has to be
 * dropped here — `defineTool()` does the same via `compileValueSchema`.
 *
 * Everything else is left alone on purpose: this is a seam guard, not a schema
 * compiler. Rewriting more would silently change what a tool accepts.
 */
function compileDslLeaf(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (record['type'] !== 'json') return value
  const { type: _dropped, ...rest } = record
  return rest
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
