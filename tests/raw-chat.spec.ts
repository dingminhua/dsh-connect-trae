import { describe, expect, it } from 'vitest'
import { buildTraeRawChatDraft, decodeRawChatChunk, normalizeTraeToolSchema, TRAE_RAW_CHAT_V1_PATH, TRAE_RAW_CHAT_V2_PATH } from '../src/raw-chat.ts'

describe('Trae raw-chat evidence model', () => {
  it('keeps v1 and v2 explicit instead of blind fallback', () => {
    expect(TRAE_RAW_CHAT_V2_PATH).toBe('/api/ide/v2/llm_raw_chat')
    expect(TRAE_RAW_CHAT_V1_PATH).toBe('/api/ide/v1/llm_raw_chat')
  })

  it('builds an offline OpenAI-like draft without mutating inputs', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }]
    const body = buildTraeRawChatDraft({ model: 'glm-5.2', messages, maxTokens: 100, temperature: 0.2 })
    expect(body).toEqual({ model: 'glm-5.2', messages, stream: true, max_tokens: 100, temperature: 0.2 })
    expect(() => buildTraeRawChatDraft({ model: '', messages })).toThrow(/model/)
    expect(() => buildTraeRawChatDraft({ model: 'm', messages: [] })).toThrow(/messages/)
  })

  it('adds only explicit reasoning and safe runtime extra info', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }]
    const body = buildTraeRawChatDraft({
      model: 'qwen-3.7-plus', messages, reasoningEffort: 'high',
      extraInfo: { native_function_call: true, use_v2_process: true, max_mode_enabled: false },
    })
    expect(body).toMatchObject({
      reasoning_effort: 'high',
      extra_info: { native_function_call: true, use_v2_process: true, max_mode_enabled: false },
    })
  })

  it('decodes text, reasoning, tool calls, usage and finish reason', () => {
    expect(decodeRawChatChunk({
      choices: [{ delta: {
        reasoning_content: 'think', content: 'answer',
        tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read', arguments: '{"path":"a"}' } }],
      }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    })).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'answer' },
      { type: 'tool-call', index: 0, id: 'call-1', name: 'read', arguments: '{"path":"a"}' },
      { type: 'done', finishReason: 'tool_calls' },
      { type: 'usage', inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    ])
  })

  it('handles DONE and preserves unknown payloads', () => {
    expect(decodeRawChatChunk('[DONE]')).toEqual([{ type: 'done', finishReason: 'stop' }])
    expect(decodeRawChatChunk({ strange: true })).toEqual([{ type: 'unknown', value: { strange: true } }])
  })

  it('decodes cache accounting from both nesting conventions', () => {
    // Canonical OpenAI nesting, as pi-ai reads it.
    expect(decodeRawChatChunk({
      usage: { prompt_tokens: 9224, completion_tokens: 173, total_tokens: 9397, prompt_tokens_details: { cached_tokens: 9216, cache_write_tokens: 8 } },
    })).toEqual([
      { type: 'usage', inputTokens: 9224, outputTokens: 173, totalTokens: 9397, cacheReadTokens: 9216, cacheWriteTokens: 8 },
    ])
    // DeepSeek/Kimi top-level spelling.
    expect(decodeRawChatChunk({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 64 } })).toEqual([
      { type: 'usage', inputTokens: 100, cacheReadTokens: 64 },
    ])
  })
})

// Issue #49: the deepseek-v4.1-flash backend validates tools batch-wide and
// rejects the whole request with `4027 … invalid JSON Schema` when any tool
// carries draft-3 `required: true` inside a property schema, while the
// glm-5.2 backend tolerates it. Every draft must therefore be draft-4 clean.
describe('JSON Schema draft-3 required normalisation (issue #49)', () => {
  it('promotes per-property boolean required to the parent required array', () => {
    expect(normalizeTraeToolSchema({ type: 'object', properties: { tool: { type: 'string', required: true } } }))
      .toEqual({ type: 'object', properties: { tool: { type: 'string' } }, required: ['tool'] })
  })

  it('recurses through items/anyOf/oneOf/allOf and merges with an existing parent array', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'array', items: { type: 'object', properties: { b: { type: 'number', required: true } } } },
        c: { anyOf: [{ type: 'object', properties: { d: { type: 'string', required: true } } }, { type: 'null' }] },
      },
      required: ['a'],
    }
    expect(normalizeTraeToolSchema(schema)).toEqual({
      type: 'object',
      properties: {
        a: { type: 'array', items: { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] } },
        c: { anyOf: [{ type: 'object', properties: { d: { type: 'string' } }, required: ['d'] }, { type: 'null' }] },
      },
      required: ['a'],
    })
  })

  it('is idempotent and leaves draft-4 schemas byte-identical (same object)', () => {
    const draft4 = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    const once = normalizeTraeToolSchema(draft4)
    expect(once).toBe(draft4)
    expect(normalizeTraeToolSchema(once)).toBe(draft4)
    // Plain leaves and empty objects are returned as-is too.
    expect(normalizeTraeToolSchema({ type: 'object' })).toEqual({ type: 'object' })
    expect(normalizeTraeToolSchema({ type: 'object', properties: {} })).toEqual({ type: 'object', properties: {} })
  })

  it('ignores boolean required outside a properties map and false values inside it', () => {
    expect(normalizeTraeToolSchema({ type: 'string', required: true })).toEqual({ type: 'string' })
    expect(normalizeTraeToolSchema({ type: 'object', properties: { x: { type: 'string', required: false } } }))
      .toEqual({ type: 'object', properties: { x: { type: 'string' } } })
  })

  it('normalises tools in a raw-chat draft without mutating the caller tools', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'read', parameters: { type: 'object', properties: { path: { type: 'string', required: true } } } },
    }]
    const body = buildTraeRawChatDraft({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }], tools })
    expect(body.tools?.[0]?.function.parameters).toEqual({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'] })
    // The caller's array still carries the draft-3 form.
    expect(tools[0]?.function.parameters).toEqual({ type: 'object', properties: { path: { type: 'string', required: true } } })
  })
})

// Issue #98: a third-party plugin registered a tool through the raw
// `ctx.tools.register()` seam and handed it DSH's shorthand parameter map —
// `{ mode: { type: 'string', required: true, enum: [...] }, … }` with NO root
// `type: "object"` and NO `properties`. `tools.register()` only validates
// `output.schema`, so that map reached the wire verbatim and Trae's DeepSeek
// backend answered `400`: `tools.15.function.parameters must be a JSON Schema
// of type object`. The draft-3 rewrite (issue #49) does not help here: it lifts
// per-property booleans but never adds a missing object root.
describe('object-root repair for shorthand parameter maps (issue #98)', () => {
  /** The exact `parameters` value issue #98 reported for `mode_prompt`. */
  const shorthand = {
    mode: { type: 'string', required: true, enum: ['project', 'creator-plus'] },
    action: { type: 'string', required: true, enum: ['read', 'write'] },
    text: { type: 'string' },
  }

  it('gives a bare property map an object root so the batch is not rejected', () => {
    expect(normalizeTraeToolSchema(shorthand)).toEqual({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['project', 'creator-plus'] },
        action: { type: 'string', enum: ['read', 'write'] },
        text: { type: 'string' },
      },
      required: ['mode', 'action'],
    })
  })

  it('carries the repair into the raw-chat draft, leaving valid schemas alone', () => {
    const valid = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    const tools = [
      { type: 'function' as const, function: { name: 'mode_prompt', parameters: shorthand } },
      { type: 'function' as const, function: { name: 'read', parameters: valid } },
    ]
    const body = buildTraeRawChatDraft({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }], tools })
    expect(body.tools?.[0]?.function.parameters).toMatchObject({ type: 'object' })
    expect((body.tools?.[0]?.function.parameters as Record<string, unknown>)['properties']).toBeDefined()
    // A schema that already had a root is untouched, byte for byte.
    expect(body.tools?.[1]?.function.parameters).toEqual(valid)
  })

  it('does not invent a root for things that are not property maps', () => {
    // Values that are not all schemas: a leaf, a tool record.
    expect(normalizeTraeToolSchema({ type: 'string' })).toEqual({ type: 'string' })
    expect(normalizeTraeToolSchema({ type: 'function', function: { name: 'x' } })).toEqual({ type: 'function', function: { name: 'x' } })
    // Already object-rooted, even without properties.
    expect(normalizeTraeToolSchema({ type: 'object' })).toEqual({ type: 'object' })
    // An empty object IS wrapped when handed in directly: at this entry point the
    // value is a `parameters`, and `{}` there is a no-argument tool. See the
    // "empty parameter map" case below; the position, not the shape, decides.
    expect(normalizeTraeToolSchema({})).toEqual({ type: 'object', properties: {} })
  })

  it('wraps a map whose parameter names collide with schema keywords', () => {
    // The FIRST version judged "is this a property map" by looking at KEY NAMES,
    // so a parameter named `type`, `name` or `description` made the whole map
    // look like a schema and the repair silently did nothing — the exact 400 this
    // issue is about, still there. A DSH parameter name is unconstrained, so the
    // decision has to read the VALUE: a schema's `type` is a string, while a
    // parameter called `type` maps to an object.
    for (const key of ['type', 'name', 'description', 'title', 'enum', 'const', 'strict']) {
      expect(normalizeTraeToolSchema({ [key]: { type: 'string', required: true } })).toEqual({
        type: 'object',
        properties: { [key]: { type: 'string' } },
        required: [key],
      })
    }
    // A parameter literally called `properties` maps to a schema OBJECT, which is
    // indistinguishable from a schema's own container — documented not to wrap.
    expect(normalizeTraeToolSchema({ properties: { type: 'object' } })).toEqual({ properties: { type: 'object' } })
  })

  it('gives an EMPTY parameter map an object root too', () => {
    // `parameters: {}` is what a no-argument tool compiles to, and `defineTool()`
    // turns it into `{ type: 'object', properties: {} }`. Left bare it is the same
    // missing-root 400. At the parameters position there is no other reading.
    const tools = [{ type: 'function' as const, function: { name: 'noop', parameters: {} } }]
    const body = buildTraeRawChatDraft({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }], tools })
    expect(body.tools?.[0]?.function.parameters).toEqual({ type: 'object', properties: {} })
  })

  it('compiles the DSH `json` leaf to an annotation-only schema', () => {
    // DSH's DSL has a `json` type meaning "any JSON value"; JSON Schema spells
    // that as a schema with no `type`. Shipping `type: "json"` verbatim is
    // rejected by the same strict backend, so the repair has to mirror
    // `defineTool()` here as well.
    expect(normalizeTraeToolSchema({ data: { type: 'json', required: true } })).toEqual({
      type: 'object',
      properties: { data: {} },
      required: ['data'],
    })
  })
})
