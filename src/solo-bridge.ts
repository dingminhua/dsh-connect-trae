import { randomUUID } from 'node:crypto'
import { SseDecoder, decodeTraeEvent } from './sse.ts'
import type { TraeCatalog } from './catalog.ts'
import type { TraeChatResult, TraeUpstreamClient } from './upstream.ts'

interface OpenAIToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: { name?: string; arguments?: string }
}

function normalizeToolCalls(value: unknown): OpenAIToolCallDelta[] {
  if (!Array.isArray(value)) return []
  const calls: OpenAIToolCallDelta[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    const rawFunction = typeof record['function_call'] === 'object' && record['function_call'] !== null
      ? record['function_call'] as Record<string, unknown>
      : typeof record['function'] === 'object' && record['function'] !== null
        ? record['function'] as Record<string, unknown>
        : {}
    const fn = {
      ...typeof rawFunction['name'] === 'string' ? { name: rawFunction['name'] } : {},
      ...typeof rawFunction['arguments'] === 'string' ? { arguments: rawFunction['arguments'] } : {},
    }
    calls.push({
      index: typeof record['index'] === 'number' ? record['index'] : calls.length,
      ...typeof record['id'] === 'string' ? { id: record['id'] } : {},
      ...record['type'] === 'function' ? { type: 'function' as const } : {},
      ...Object.keys(fn).length === 0 ? {} : { function: fn },
    })
  }
  return calls
}

/** Convert Trae's named SSE events into OpenAI chat-completion SSE chunks. */
export function bridgeTraeSoloStream(response: Response, model: string): Response {
  const source = response.body
  if (source === null) return new Response(null, { status: 502 })
  const id = `chatcmpl-${randomUUID().replaceAll('-', '').slice(0, 24)}`
  const created = Math.floor(Date.now() / 1000)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const sse = new SseDecoder()
  let sawToolCalls = false
  let emittedFinishReason = false
  let upstreamEnded = false
  let upstreamError: Error | undefined
  // OpenAI-shaped usage object. It is mostly flat counters, but
  // `prompt_tokens_details` nests the cache breakdown, so the value type is
  // widened beyond `number` rather than narrowing the cache fields away.
  let usage: Record<string, number | Record<string, number>> | undefined

  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null): Uint8Array => encoder.encode(`data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...usage === undefined ? {} : { usage },
  })}\n\n`)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader()
      const consume = (event: ReturnType<SseDecoder['push']>[number]): void => {
        const decoded = decodeTraeEvent(event)
        if (decoded.type === 'unknown') {
          const payload = decoded.data as Record<string, unknown> | undefined
          const code = typeof payload?.['code'] === 'number' ? payload['code'] : undefined
          if (decoded.event === 'error' || (code !== undefined && code >= 4000)) {
            // Trae surfaces quota/authorisation failures as an `error` event.
            // Surface it as a real upstream failure instead of letting DSH see
            // a completed-but-empty response (EMPTY_RESPONSE).
            upstreamError = new Error(typeof payload?.['message'] === 'string' && payload['message'] !== ''
              ? payload['message']
              : `Trae upstream error (code ${code ?? '?'})`)
          }
          return
        }
        if (decoded.type === 'delta') {
          const delta: Record<string, unknown> = {}
          if (decoded.text !== '') delta['content'] = decoded.text
          if (decoded.reasoning !== undefined && decoded.reasoning !== '') delta['reasoning_content'] = decoded.reasoning
          const toolCalls = normalizeToolCalls(decoded.toolCalls)
          if (toolCalls.length > 0) {
            sawToolCalls = true
            delta['tool_calls'] = toolCalls
          }
          if (Object.keys(delta).length > 0) controller.enqueue(chunk(delta))
        } else if (decoded.type === 'usage') {
          // Trae reports cache accounting as `cache_read_input_tokens` /
          // `cache_creation_input_tokens`, a subset of `prompt_tokens` (OpenAI
          // convention, verified in docs/ISSUE10_DIAGNOSIS.md). Both are
          // forwarded under the canonical OpenAI spelling, which is what
          // pi-ai's parseChunkUsage reads (`prompt_tokens_details.cached_tokens`
          // / `.cache_write_tokens`); dropping them made every session report
          // "0 cache" even when Trae was serving a warm prefix cache.
          const cacheRead = decoded.cacheReadTokens
          const cacheWrite = decoded.cacheWriteTokens
          const details = {
            ...cacheRead === undefined ? {} : { cached_tokens: cacheRead },
            ...cacheWrite === undefined ? {} : { cache_write_tokens: cacheWrite },
          }
          usage = {
            ...decoded.inputTokens === undefined ? {} : { prompt_tokens: decoded.inputTokens },
            ...decoded.outputTokens === undefined ? {} : { completion_tokens: decoded.outputTokens },
            ...decoded.totalTokens === undefined ? {} : { total_tokens: decoded.totalTokens },
            // Omit the details object entirely when Trae sent neither field, so
            // a provider that never reports cache keeps its previous wire shape
            // instead of gaining `prompt_tokens_details: {}`.
            ...Object.keys(details).length === 0 ? {} : { prompt_tokens_details: details },
          }
        } else if (decoded.type === 'done') {
          upstreamEnded = true
          // Trae may send both `event: done` and a trailing `[DONE]`. Emit one
          // OpenAI finish chunk only; pi-ai requires a non-null finish_reason
          // before the stream closes.
          if (!emittedFinishReason) {
            // Mark the terminal state before erroring the controller so the
            // post-loop fallback never enqueues after controller.error().
            emittedFinishReason = true
            if (upstreamError !== undefined) {
              controller.error(upstreamError)
              return
            }
            controller.enqueue(chunk({}, sawToolCalls ? 'tool_calls' : decoded.finishReason || 'stop'))
          }
        }
      }
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          for (const event of sse.push(decoder.decode(next.value, { stream: true }))) consume(event)
        }
        for (const event of sse.finish()) consume(event)
        if (upstreamError !== undefined && !upstreamEnded) {
          controller.error(upstreamError)
          return
        }
        // A clean EOF is a valid Trae termination even when it omits an
        // explicit done event. Synthesize the required OpenAI finish chunk.
        if (!emittedFinishReason) {
          emittedFinishReason = true
          controller.enqueue(chunk({}, sawToolCalls ? 'tool_calls' : 'stop'))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
    cancel(reason) { return source.cancel(reason) },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/**
 * One resolved wire target: the `config_name` `llm_utils_chat` accepts, plus
 * the directory function that listed it. Trae's roster is split across several
 * SOLO-mode functions and a model is only callable through the one listing it
 * (glm-5.3 answers only under `solo_work_remote`), so the chat call replays it.
 */
export interface TraeWireTarget {
  configName: string
  function?: string
}

/** Resolves a display model id to its wire target (config_name + function). */
export type TraeWireResolver = (displayId: string) => TraeWireTarget | undefined

/** Native SOLO client wrapper used by the loopback OpenAI adapter. */
export class TraeSoloBridge implements TraeUpstreamClient {
  constructor(
    private readonly upstream: TraeUpstreamClient,
    private readonly catalog?: Pick<TraeCatalog, 'current'>,
    private readonly wireResolver?: TraeWireResolver,
  ) {}

  async chatStream(bodyJson: string, signal?: AbortSignal): Promise<TraeChatResult> {
    // The model id doubles as the SSE chunk label; one model = one id, so the
    // label is exactly what DSH requested. DSH may retain a reasoning selection
    // while switching models: strip that stale option unless this exact model
    // advertises the corresponding wire value.
    let model = 'glm-5.2'
    let prepared = bodyJson
    try {
      const input = JSON.parse(bodyJson) as Record<string, unknown>
      if (typeof input['model'] === 'string' && input['model'] !== '') model = input['model']
      // Resolve the display model id to the real llm_utils_chat config_name.
      // The Remote directory id may differ from the wire id (e.g. Seed-Code).
      // Prefer the persisted catalog's `wireConfigName` when present, then fall
      // back to the startup wire resolver keyed by display name/id; the resolver
      // never depends on a user-refreshed or re-saved directory.
      const entry = this.catalog?.current().find(item => item.id === model)
      // The catalog row carries both halves once discovery has run; the
      // resolver covers ids that came from elsewhere (startup wire map).
      const fromCatalog = entry?.wireConfigName === undefined
        ? undefined
        : { configName: entry.wireConfigName, ...entry.wireFunction === undefined ? {} : { function: entry.wireFunction } }
      const fromResolver = this.wireResolver?.(model) ?? this.wireResolver?.(entry?.name ?? '')
      const target = fromCatalog ?? fromResolver
      const wireModel = target?.configName ?? model
      const wireFunction = target?.function ?? entry?.wireFunction
      if (wireModel !== input['model']) {
        input['model'] = wireModel
      }
      // Stamp the directory function the model was discovered under, so the
      // upstream is asked through the function that actually lists it.
      if (wireFunction !== undefined && input['function'] !== wireFunction) {
        input['function'] = wireFunction
      }
      if (wireModel !== JSON.parse(bodyJson)['model'] || wireFunction !== undefined) {
        prepared = JSON.stringify(input)
      }
      if (typeof input['reasoning_effort'] === 'string') {
        const info = entry
        const efforts = info?.reasoningEfforts
        const requested = input['reasoning_effort']
        const mapped = efforts?.[requested as keyof typeof efforts]
        const allowed = efforts === undefined
          ? []
          : Object.values(efforts).filter((value): value is string => typeof value === 'string')
        if (typeof mapped === 'string') input['reasoning_effort'] = mapped
        else if (!allowed.includes(requested)) delete input['reasoning_effort']
        prepared = JSON.stringify(input)
      }
    } catch {
      return { ok: false, status: 400, kind: 'client', message: 'invalid JSON request' }
    }
    const result = await this.upstream.chatStream(prepared, signal)
    if (!result.ok) return result
    return { ok: true, response: bridgeTraeSoloStream(result.response, model) }
  }
}
