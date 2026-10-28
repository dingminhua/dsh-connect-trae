export interface SseEvent {
  event?: string
  data: string
  id?: string
  retry?: number
}

/** Incremental SSE decoder supporting CRLF, chunk splits and multi-line data. */
export class SseDecoder {
  private buffer = ''
  private event: string | undefined
  private id: string | undefined
  private retry: number | undefined
  private data: string[] = []

  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const events: SseEvent[] = []
    while (true) {
      const match = /\r?\n/.exec(this.buffer)
      if (match === null || match.index === undefined) break
      const line = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      const emitted = this.consumeLine(line)
      if (emitted !== undefined) events.push(emitted)
    }
    return events
  }

  finish(): SseEvent[] {
    const events: SseEvent[] = []
    if (this.buffer !== '') {
      const emitted = this.consumeLine(this.buffer)
      this.buffer = ''
      if (emitted !== undefined) events.push(emitted)
    }
    const final = this.dispatch()
    if (final !== undefined) events.push(final)
    return events
  }

  private consumeLine(line: string): SseEvent | undefined {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return undefined
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.event = value
    else if (field === 'data') this.data.push(value)
    else if (field === 'id' && !value.includes('\0')) this.id = value
    else if (field === 'retry' && /^\d+$/.test(value)) this.retry = Number(value)
    return undefined
  }

  private dispatch(): SseEvent | undefined {
    if (this.data.length === 0) {
      this.event = undefined
      this.retry = undefined
      return undefined
    }
    const result: SseEvent = {
      ...this.event === undefined || this.event === '' ? {} : { event: this.event },
      data: this.data.join('\n'),
      ...this.id === undefined ? {} : { id: this.id },
      ...this.retry === undefined ? {} : { retry: this.retry },
    }
    this.event = undefined
    this.retry = undefined
    this.data = []
    return result
  }
}

export type TraeStreamEvent =
  | { type: 'queue'; position?: number }
  | { type: 'progress'; notice: unknown }
  | { type: 'delta'; text: string; reasoning?: string; toolCalls?: unknown }
  | {
    type: 'usage'
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    /**
     * Trae's prompt-cache accounting (`cache_read_input_tokens` /
     * `cache_creation_input_tokens` on the `token_usage` event). Verified
     * 2026-09-22 (docs/ISSUE10_DIAGNOSIS.md): a byte-identical 9224-token
     * prompt reports `prompt_tokens: 9224` while `cache_read_input_tokens`
     * rises to 9216, so these are a *subset* of `prompt_tokens` — the OpenAI
     * convention, not Anthropic's exclusive one. Forwarding them as
     * `cached_tokens` is therefore arithmetically correct.
     */
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  | {
    /**
     * The upstream's own account of how the request was served: `metadata`
     * (acceptance, plus `prompt_cache_pool_record`) and `timing_cost` (the
     * pipeline and the backing provider model).
     *
     * These events were previously folded into `unknown` and dropped. That
     * mattered for issue #67: `prompt_cache_pool_record` is the ONLY upstream
     * signal that says whether a prompt-cache pool was even attached to the
     * request, so with it dropped a "0% cache" report could not be told apart
     * from a plugin that lost the numbers. See docs/ISSUE67_DIAGNOSIS.md.
     */
    type: 'diagnostic'
    /**
     * `metadata.prompt_cache_pool_record`. `null` is a real, observed value
     * (100% of measured requests on 2026-10-28) and means the upstream attached
     * no cache pool; it is kept distinct from "the field was absent".
     */
    promptCachePoolRecord?: unknown
    /** `timing_cost.name`, e.g. `llm_raw_chat_v2`. */
    pipeline?: string
    /** `timing_cost.provider_model_name` — the model that actually answered. */
    providerModelName?: string
  }
  | { type: 'done'; finishReason: string }
  | { type: 'unknown'; event?: string; data: unknown }

export function decodeTraeEvent(event: SseEvent): TraeStreamEvent {
  if (event.data === '[DONE]') return { type: 'done', finishReason: 'stop' }
  let payload: unknown
  try { payload = JSON.parse(event.data) as unknown } catch { return { type: 'unknown', ...event.event === undefined ? {} : { event: event.event }, data: event.data } }
  const record = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  if (event.event === 'request_wait_in_queue') {
    return { type: 'queue', ...typeof record['position'] === 'number' ? { position: record['position'] } : {} }
  }
  if (event.event === 'progress_notice') return { type: 'progress', notice: payload }
  if (event.event === 'token_usage') {
    return {
      type: 'usage',
      ...typeof record['prompt_tokens'] === 'number' ? { inputTokens: record['prompt_tokens'] } : {},
      ...typeof record['completion_tokens'] === 'number' ? { outputTokens: record['completion_tokens'] } : {},
      ...typeof record['total_tokens'] === 'number' ? { totalTokens: record['total_tokens'] } : {},
      ...typeof record['reasoning_tokens'] === 'number' ? { reasoningTokens: record['reasoning_tokens'] } : {},
      ...typeof record['cache_read_input_tokens'] === 'number' ? { cacheReadTokens: record['cache_read_input_tokens'] } : {},
      ...typeof record['cache_creation_input_tokens'] === 'number' ? { cacheWriteTokens: record['cache_creation_input_tokens'] } : {},
    }
  }
  if (event.event === 'metadata' || event.event === 'timing_cost') {
    // Both are pure diagnostics: they carry no answer text and no usage, so
    // they must not become `delta`/`usage`. Keeping them a distinct type lets
    // the bridge record the cache-pool fact without changing the wire shape.
    return {
      type: 'diagnostic',
      ...record['prompt_cache_pool_record'] === undefined ? {} : { promptCachePoolRecord: record['prompt_cache_pool_record'] },
      ...typeof record['name'] === 'string' ? { pipeline: record['name'] } : {},
      ...typeof record['provider_model_name'] === 'string' ? { providerModelName: record['provider_model_name'] } : {},
    }
  }
  if (event.event === 'done' || typeof record['finish_reason'] === 'string' && record['response'] === undefined) {
    return { type: 'done', finishReason: typeof record['finish_reason'] === 'string' ? record['finish_reason'] : 'stop' }
  }
  if (event.event === 'output' || record['response'] !== undefined || record['reasoning_content'] !== undefined) {
    return {
      type: 'delta',
      text: typeof record['response'] === 'string' ? record['response'] : '',
      ...typeof record['reasoning_content'] === 'string' ? { reasoning: record['reasoning_content'] } : {},
      ...record['tool_calls'] === undefined || record['tool_calls'] === null ? {} : { toolCalls: record['tool_calls'] },
    }
  }
  return { type: 'unknown', ...event.event === undefined ? {} : { event: event.event }, data: payload }
}
