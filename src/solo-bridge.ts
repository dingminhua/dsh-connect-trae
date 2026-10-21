import { randomUUID } from 'node:crypto'
import { SseDecoder, decodeTraeEvent } from './sse.ts'
import type { TraeCatalog } from './catalog.ts'
import type { TraeChatResult, TraeUpstreamClient, TraeUpstreamErrorKind } from './upstream.ts'

interface OpenAIToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: { name?: string; arguments?: string }
}

/**
 * One upstream failure as Trae reports it inside a 200 SSE body: an `error`
 * event, or any event carrying a `code` at or above Trae's error band.
 */
export interface TraeFailure {
  code?: number
  message: string
  extra?: unknown
}

/**
 * What Trae's in-stream error codes mean. Measured 2026-10-01 on live
 * credentials (issue #19), and re-measured 2026-10-12 on a live CN credential
 * (issue #33) with a 22-function × 6-model chat matrix:
 *
 *  - `1005` — the model needs a paid plan. Trae answers HTTP 200 with
 *    `event:error {"code":1005,"message":"","extra":"{\"plan\":1}"}`, so the
 *    gate is only visible in `extra.plan`; `gpt-6-sol` returned it under both
 *    `solo_work_remote` and `solo_agent_remote` on a free account.
 *  - `4011` — Trae throttled the SOLO route for this account. Trae's own text
 *    is `your requests have exceeded the rate limit. Please wait and try again
 *    later.`, and issue #33 is why that text is now taken at face value: the
 *    earlier reading of 4011 as "this function does not serve that model" is
 *    contradicted by measurement. On CN that condition is `4001`, and all 22
 *    functions answered `4001` — never `4011` — for a model absent from their
 *    roster, while `glm-5.3` streamed normally under its own function. Rate
 *    limiting is per account, route and moment, which is exactly the shape of
 *    that report: the same model through the same function was fine for days
 *    and then failed, with Trae's own text saying "rate limit".
 *  - `4001` — `config_name` is not one this function serves.
 *  - `4008` — the account's SOLO quota is exhausted. Deliberately a different
 *    code from `4011`: Trae words this one `your requests have exceeded the
 *    quota`, so "I still have plenty of credits" and "I am being throttled" are
 *    two different statements, and a user hits the second without touching the
 *    first (issue #33).
 *  - `4023` — the model name is unknown on the route that was asked.
 *  - `4222` — the ENTERPRISE tenant's allowance is exhausted. Measured
 *    2026-10-17 on a live tenant account whose enterprise credit ran out: the
 *    gateway answered HTTP 200 with `{"code":4222,"message":""}` for a model
 *    that streamed normally moments earlier (and still streams on the consumer
 *    gateway). Like `4008` it is a billing fact rather than a config one, but
 *    it is specific to the tenant pool -- the consumer balance is unaffected,
 *    which is why it must not be folded into the `4008` reading.
 *  - `2001` — the upstream has not published its function config for the route
 *    that was asked. Evidence is issue #39: on a live CN account every SOLO
 *    function's `get_detail_param` answered HTTP 200 with `config_info_list:
 *    []` (an empty directory), and each chat call failed with
 *    `{"code":2001,"message":"no function config found for appId=...,
 *    function=solo_work_remote"}` (and the variant `[LLMUtilsChat.resolveByUsage]
 *    function is empty, cannot resolve model by usage=`). The roster came back
 *    empty and then self-resolved later with rows per function, so this is a
 *    TRANSIENT server-side gap the user can wait out or retry — never a local
 *    credential, plugin or account fault, and not something to re-login for.
 */
const TRAE_ERROR_HINTS: Readonly<Record<number, string>> = {
  1005: 'Trae requires a paid plan for this model; the current account\'s plan does not cover it',
  2001: 'Trae has not published its function config for this route (an upstream condition, not a local credential or config problem)',
  4001: 'Trae does not serve this model under the SOLO function the request used (config_name rejected)',
  4008: 'Trae reports the account\'s SOLO quota is exhausted for this request',
  4011: 'Trae throttled the SOLO channel for this account (a rate limit, not the credit balance)',
  4023: 'Trae does not recognise this model name on the SOLO route that was asked',
  4222: 'The enterprise tenant allowance is exhausted (tenant spend is separate from the personal credit balance; the consumer gateway still has its own)',
}

/** `extra` is a JSON *string* on the wire; unwrap it to read `plan`. */
function traeErrorPlan(extra: unknown): number | undefined {
  let value = extra
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as unknown } catch { return undefined }
  }
  if (typeof value !== 'object' || value === null) return undefined
  const plan = (value as Record<string, unknown>)['plan']
  return typeof plan === 'number' ? plan : undefined
}

/** A readable message for an in-stream Trae failure, with its code preserved. */
export function describeTraeFailure(failure: TraeFailure): string {
  const plan = traeErrorPlan(failure.extra)
  const parts = [
    failure.code === undefined ? 'Trae refused the request' : TRAE_ERROR_HINTS[failure.code] ?? 'Trae refused the request',
    ...plan === undefined ? [] : [`plan ${plan}`],
    ...failure.code === undefined ? [] : [`Trae code ${failure.code}`],
  ]
  const detail = failure.message.trim()
  // Trae's own text is appended as detail rather than replacing the hint, so the
  // message carries both the plugin's reading of the code and the upstream's own
  // words. It is NOT dropped: the client classifies an error by this text (see
  // classifyTraeFailure), and upstream wording is evidence — issue #33 showed
  // the plugin's own 4011 hint asserting a cause Trae's text contradicted.
  return detail === '' ? parts.join(' · ') : `${parts.join(' · ')} · upstream: ${detail}`
}

/**
 * HTTP status + error kind for an in-stream failure, so the loopback shim can
 * answer with a real error instead of a truncated 200 stream.
 *
 * `1005` is a subscription gate: 402 is what makes clients stop rather than
 * retry, and it is truthful.
 *
 * `4011` is a rate limit and is reported as one — `429` / `soft_rate` (issue
 * #33). It previously answered `400` / `client`, which contradicted both its own
 * message and the client's own behaviour: pi-ai classifies an error by its text
 * (`/\b429\b|rate.?limit/i` → `RATE_LIMIT`), and `RATE_LIMIT` is retryable, so
 * the kernel retried five times with backoff while this function called the same
 * failure a non-retryable client error. Reporting the real status makes all
 * three agree, and `soft_rate` is already what `fallback-upstream` refuses to
 * replay — correct, since a throttled route is not a route-compatibility
 * problem.
 *
 * Everything else stays a client-side rejection.
 */
function classifyTraeFailure(failure: TraeFailure): { status: number; kind: TraeUpstreamErrorKind } {
  if (failure.code === 1005) return { status: 402, kind: 'hard_credit' }
  if (failure.code === 4011) return { status: 429, kind: 'soft_rate' }
  return { status: 400, kind: 'client' }
}

/** Recognise an in-stream failure event, or return undefined for anything else. */
function traeFailureOf(decoded: ReturnType<typeof decodeTraeEvent>): TraeFailure | undefined {
  if (decoded.type !== 'unknown') return undefined
  const payload = decoded.data as Record<string, unknown> | undefined
  const code = typeof payload?.['code'] === 'number' ? payload['code'] : undefined
  if (decoded.event !== 'error' && !(code !== undefined && code >= 4000)) return undefined
  return {
    ...code === undefined ? {} : { code },
    message: typeof payload?.['message'] === 'string' ? payload['message'] : '',
    ...payload?.['extra'] === undefined ? {} : { extra: payload['extra'] },
  }
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
  return bridgeTraeSource(source, model)
}

/** {@link bridgeTraeSoloStream} over an already-opened byte stream. */
function bridgeTraeSource(source: ReadableStream<Uint8Array>, model: string): Response {
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
          const failure = traeFailureOf(decoded)
          if (failure !== undefined) {
            // Trae surfaces quota/authorisation failures as an `error` event.
            // Surface it as a real upstream failure instead of letting DSH see
            // a completed-but-empty response (EMPTY_RESPONSE). Codes that arrive
            // before any output are turned into a real HTTP error by
            // {@link bridgeTraeSoloStreamOrFail}, which is the path the bridge
            // actually uses; this arm only covers a failure that interrupts an
            // already-streaming answer.
            upstreamError = new Error(describeTraeFailure(failure))
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
 * How far {@link openTraeSource} reads before giving up on finding a failure.
 * Trae opens a real answer with small `metadata` / `timing_cost` events, so a
 * healthy stream is recognised well inside these bounds; they exist only so a
 * pathological stream cannot stall the response headers.
 */
const PEEK_MAX_CHUNKS = 64
const PEEK_MAX_BYTES = 262_144

/** Replay the bytes the peek consumed, then drain the rest of the upstream. */
function replayTraeSource(
  buffered: readonly Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ended: boolean,
): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = buffered[index]
      if (chunk !== undefined) {
        index += 1
        controller.enqueue(chunk)
        return
      }
      if (ended) { controller.close(); return }
      const next = await reader.read()
      if (next.done) { controller.close(); return }
      controller.enqueue(next.value)
    },
    async cancel(reason) { await reader.cancel(reason).catch(() => {}) },
  })
}

/**
 * Open the upstream answer, failing fast when Trae refuses BEFORE producing any
 * output.
 *
 * This exists because Trae reports authorisation and subscription failures
 * inside a **200** SSE body. Relaying that as a 200 and aborting mid-stream
 * (what this bridge used to do) loses the code at the HTTP boundary: pi-ai only
 * sees a truncated stream and reports `Stream ended without finish_reason`,
 * which reads as a network fault and is retried five times — the exact symptom
 * in issue #19. Peeking until the first real output lets a refusal become a
 * normal error response with its code and plan intact.
 *
 * The peek is limited to the head of the stream and replayed verbatim, so a
 * healthy answer keeps streaming with no buffering beyond the first event.
 */
async function openTraeSource(response: Response): Promise<
  { ok: true; source: ReadableStream<Uint8Array> } | { ok: false; status: number; kind: TraeUpstreamErrorKind; message: string }
> {
  const body = response.body
  if (body === null) return { ok: false, status: 502, kind: 'server', message: 'Trae upstream returned no response body' }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const sse = new SseDecoder()
  const buffered: Uint8Array[] = []
  let bytes = 0
  let ended = false
  try {
    while (buffered.length < PEEK_MAX_CHUNKS && bytes < PEEK_MAX_BYTES) {
      const next = await reader.read()
      if (next.done) { ended = true; break }
      buffered.push(next.value)
      bytes += next.value.byteLength
      let answered = false
      for (const event of sse.push(decoder.decode(next.value, { stream: true }))) {
        const decoded = decodeTraeEvent(event)
        const failure = traeFailureOf(decoded)
        if (failure !== undefined) {
          await reader.cancel().catch(() => {})
          return { ok: false, ...classifyTraeFailure(failure), message: describeTraeFailure(failure) }
        }
        // Anything Trae itself recognises (`delta`, `usage`, `queue`,
        // `progress`, `done`) means it accepted the request; stop peeking and
        // stream from here.
        if (decoded.type !== 'unknown') answered = true
      }
      if (answered) break
    }
  } catch (error) {
    reader.releaseLock()
    return { ok: false, status: 0, kind: 'server', message: `transport error: ${String(error)}` }
  }
  return { ok: true, source: replayTraeSource(buffered, reader, ended) }
}

/**
 * Bridge an upstream answer, turning an early refusal into a real error result.
 *
 * The sibling {@link bridgeTraeSoloStream} stays synchronous and always answers
 * 200; it is the primitive, and this is the policy the bridge class uses.
 */
export async function bridgeTraeSoloStreamOrFail(response: Response, model: string): Promise<TraeChatResult> {
  const opened = await openTraeSource(response)
  if (!opened.ok) return opened
  return { ok: true, response: bridgeTraeSource(opened.source, model) }
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

/**
 * The startup wire map for one region's merged directory.
 *
 * EVERY row is registered, not only the ones whose wire config_name differs
 * from the display id. The runtime catalog is filtered by `enabledModelIds`, so
 * a pool that targets a model the user never enabled for chat would otherwise
 * reach the bridge with no catalog row AND no mapping — and the request would
 * carry the raw id under the DEFAULT function, which answers `4001 config_name
 * rejected` (Doubao-Seed-Code is served only by `solo_agent_remote`;
 * `solo_work_lite` rejects it). The identity mapping is what keeps the
 * discovered function alive for those ids.
 *
 * First row wins a display name: two directory ids can share one (`Seed-Code`),
 * and overwriting would answer with the later row's config_name. Ids are
 * unique, so `byId` needs no such guard.
 */
export function wireTargetsOf(models: readonly { id: string; name: string; wireConfigName?: string; wireFunction?: string }[]): {
  byId: Map<string, TraeWireTarget>
  byName: Map<string, TraeWireTarget>
} {
  const byId = new Map<string, TraeWireTarget>()
  const byName = new Map<string, TraeWireTarget>()
  for (const model of models) {
    const target: TraeWireTarget = {
      configName: model.wireConfigName ?? model.id,
      ...model.wireFunction === undefined ? {} : { function: model.wireFunction },
    }
    byId.set(model.id, target)
    const nameKey = model.name.trim().toLowerCase()
    if (!byName.has(nameKey)) byName.set(nameKey, target)
  }
  return { byId, byName }
}

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
      //
      // Case-blind, because the gateways are NOT: `deepseek-v4.1-flash` is the
      // Remote directory id while the gateway's `config_name` is
      // `DeepSeek-V4.1-Flash`, and sending the lowercase spelling answers
      // `4001 param is invalid`. A card saved before this was understood, or a
      // row whose casing drifted, therefore had no mapping at all and could
      // never be called.
      const entryKey = model.trim().toLowerCase()
      const entry = this.catalog?.current().find(item => item.id === model || item.id.trim().toLowerCase() === entryKey)
      // The catalog row carries both halves once discovery has run; the
      // resolver covers ids that came from elsewhere (startup wire map). A row
      // may carry ONLY the function — a restricted network whose
      // `get_detail_param` roster came back empty, plus the directory-group
      // fallback in mergeTraeModelSources — and that half alone must still
      // reach the request: without it the call goes out under the DEFAULT
      // function and every model a non-default function serves answers
      // `4001 config_name rejected`.
      //
      // The row's own id is only the DISPLAY id, and the gateway is
      // CASE-SENSITIVE about the `config_name` it accepts: the directory
      // spells `deepseek-v4.1-flash` while the wire publishes
      // `DeepSeek-V4.1-Flash` (issue #38 — the lowercase spelling answers
      // `4001 param is invalid`). So a row WITHOUT a `wireConfigName` must
      // NOT be treated as knowing its own wire spelling; the resolver is the
      // only source that does, and it is consulted below.
      const catalogConfigName = entry?.wireConfigName
      const fromCatalog = entry === undefined || (catalogConfigName === undefined && entry.wireFunction === undefined)
        ? undefined
        : { configName: catalogConfigName ?? entry.id, ...entry.wireFunction === undefined ? {} : { function: entry.wireFunction } }
      const fromResolver = this.wireResolver?.(model) ?? this.wireResolver?.(entry?.name ?? '')
      /**
       * The catalog row wins the config_name, but it may not know the function.
       *
       * A row persisted by an older build -- or one whose `wireFunction` the
       * settings schema dropped -- carries the name mapping only, and asking
       * without the function is a `4001 config_name rejected` for every model
       * that a non-default function serves (`Doubao-Seed-Code` lives on
       * `solo_agent_remote` alone). The resolver is built from the same
       * directory, so borrowing its function is safe exactly when both sources
       * agree on the wire config_name; a disagreement means the resolver found
       * a different row and its function would be wrong.
       *
       * The MIRROR case is equally load-bearing and is the reason the row's own
       * id is not accepted as its wire spelling: a row that carries only the
       * FUNCTION (`wireConfigName` absent) has no config_name of its own, and
       * its display id is the wrong-cased spelling of the wire name in exactly
       * the cases issue #38 is about. The resolver's config_name is then the
       * only correct one, so it must win for the NAME while the row keeps
       * winning for the FUNCTION.
       */
      const sameWireConfig = fromCatalog !== undefined && fromResolver !== undefined
        && fromCatalog.configName.toLowerCase() === fromResolver.configName.toLowerCase()
      /**
       * Whether the catalog row knows its own wire `config_name` (as opposed to
       * only carrying the display id plus a function). Only such a row may
       * decide the name on its own.
       */
      const catalogKnowsConfigName = catalogConfigName !== undefined
      const target = fromCatalog !== undefined && fromCatalog.function === undefined
        && sameWireConfig && fromResolver !== undefined
        ? {
            configName: fromCatalog.configName,
            ...fromResolver.function === undefined ? {} : { function: fromResolver.function },
          }
        // The row knows the function but not the name: the resolver's
        // config_name is authoritative (issue #38's casing), and the row's
        // function is authoritative (the directory group it was found under).
        : fromCatalog !== undefined && !catalogKnowsConfigName && fromResolver !== undefined
        ? {
            configName: fromResolver.configName,
            ...fromCatalog.function === undefined ? {} : { function: fromCatalog.function },
          }
        : fromCatalog ?? fromResolver
      /**
       * Last line of defence: the discovered row's own id.
       *
       * For models whose directory id IS the gateway `config_name` the merge
       * deliberately emits no `wireConfigName` (there is nothing to map), so a
       * requested id that differs only by case has neither mapping source —
       * and the row we just matched case-blindly is exactly the canonical
       * spelling. Sending it is what a correct mapping would have produced.
       *
       * Deliberately NOT derived from the row's `name`: the rosters spell most
       * ids in the opposite case of their display names (`glm-5.3` vs
       * `GLM-5.3`) and the gateway accepts the LOWERCASE id for those — a
       * name-derived rewrite answered `4001` for 4 of 5 probed models.
       */
      const wireModel = target?.configName ?? entry?.id ?? model
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
    return await bridgeTraeSoloStreamOrFail(result.response, model)
  }
}
