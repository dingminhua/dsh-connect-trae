import { describe, expect, it } from 'vitest'
import { bridgeTraeSoloStream, bridgeTraeSoloStreamOrFail, describeTraeFailure, TraeSoloBridge, wireTargetsOf } from '../src/solo-bridge.ts'
import type { TraeUpstreamClient } from '../src/upstream.ts'

function traeStream(events: string[]): Response {
  return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } })
}

/**
 * A Trae SSE body that arrives in SEPARATE network chunks. Needed where the
 * test depends on the peek seeing one event before another: a single `Response`
 * string is delivered as one chunk, so everything in it is decoded together.
 */
function traeStreamChunks(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

describe('TraeSoloBridge', () => {
  it('converts Trae function_call deltas into OpenAI tool_calls', async () => {
    const upstream: TraeUpstreamClient = {
      async chatStream() {
        return { ok: true, response: traeStream([
          'event: output\ndata: {"response":"","tool_calls":[{"index":0,"id":"call-1","type":"function","function_call":{"name":"read","arguments":"{\\"file_path\\":\\"README.md\\"}"}}]}\n\n',
          'event: done\ndata: {"finish_reason":"stop"}\n\n',
        ]) }
      },
    }
    const bridge = new TraeSoloBridge(upstream)
    const result = await bridge.chatStream(JSON.stringify({ model: 'glm-5.2', messages: [{ role: 'user', content: 'read' }] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = await result.response.text()
    expect(text).toContain('"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read","arguments":"{\\"file_path\\":\\"README.md\\"}"}}]')
    expect(text).toContain('"finish_reason":"tool_calls"')
    expect(text).toContain('data: [DONE]')
  })

  it('synthesizes one finish_reason before [DONE] when Trae ends at clean EOF', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      'event: output\ndata: {"response":"hello"}\n\n',
    ]), 'm')
    const text = await response.text()
    const finishChunks = text.split('\n\n').filter(line => line.includes('"finish_reason":"stop"'))
    expect(finishChunks).toHaveLength(1)
    expect(text.indexOf('"finish_reason":"stop"')).toBeLessThan(text.indexOf('data: [DONE]'))
  })

  it('emits only one finish_reason when Trae sends done and trailing [DONE]', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      'event: output\ndata: {"response":"hello"}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
      'data: [DONE]\n\n',
    ]), 'm')
    const text = await response.text()
    expect(text.match(/"finish_reason":"stop"/g)).toHaveLength(1)
    expect(text).toContain('data: [DONE]')
  })

  it('propagates an upstream error followed by done without emitting a finish chunk', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      'event: error\ndata: {"code":4008,"message":"quota exceeded"}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'm')
    const reader = response.body!.getReader()
    await expect(reader.read()).rejects.toThrow('quota exceeded')
  })

  it('synthesizes tool_calls finish_reason when a tool stream ends at EOF', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      'event: output\ndata: {"response":"","tool_calls":[{"index":0,"id":"call-eof","type":"function","function_call":{"name":"read","arguments":"{}"}}]}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(text).toContain('"finish_reason":"tool_calls"')
    expect(text.indexOf('"finish_reason":"tool_calls"')).toBeLessThan(text.indexOf('data: [DONE]'))
  })

  it('preserves split tool-call argument deltas', async () => {
    const event = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
    const response = bridgeTraeSoloStream(traeStream([
      event('output', { tool_calls: [{ index: 0, id: 'call-2', type: 'function', function_call: { name: 'edit', arguments: '{"file"' } }] }),
      event('output', { tool_calls: [{ index: 0, function_call: { name: '', arguments: ':"a"}' } }] }),
      event('done', { finish_reason: 'stop' }),
    ]), 'm')
    const text = await response.text()
    expect(text).toContain('"name":"edit"')
    expect(text).toContain('"arguments":"{\\"file\\""')
    expect(text).toContain('"arguments":":\\"a\\"}"')
  })

  it('strips a stale reasoning effort when the selected model does not advertise it', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    const catalog = {
      current: () => [{ id: 'Doubao-Seed-Code', name: 'Doubao-Seed-Code', input: ['text', 'image'] as ('text' | 'image')[] }],
    }
    const result = await new TraeSoloBridge(upstream, catalog).chatStream(JSON.stringify({
      model: 'Doubao-Seed-Code', reasoning_effort: 'high', messages: [{ role: 'user', content: 'hi' }],
    }))
    expect(result.ok).toBe(true)
    expect(JSON.parse(forwarded)).not.toHaveProperty('reasoning_effort')
  })

  it('maps canonical DSH reasoning effort to the selected model wire value', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    const catalog = {
      current: () => [{ id: 'qwen', name: 'Qwen', reasoningEfforts: { low: 'light', high: 'high', xhigh: 'extra_high' } }],
    }
    await new TraeSoloBridge(upstream, catalog).chatStream(JSON.stringify({
      model: 'qwen', reasoning_effort: 'low', messages: [{ role: 'user', content: 'hi' }],
    }))
    expect(JSON.parse(forwarded)).toHaveProperty('reasoning_effort', 'light')
    await new TraeSoloBridge(upstream, catalog).chatStream(JSON.stringify({
      model: 'qwen', reasoning_effort: 'xhigh', messages: [{ role: 'user', content: 'hi' }],
    }))
    expect(JSON.parse(forwarded)).toHaveProperty('reasoning_effort', 'extra_high')
  })

  it('resolves the display model id to its wire config_name for the upstream', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    const catalog = {
      current: () => [{ id: 'Doubao-Seed-Code', name: 'Seed-Code', input: ['text'] as ('text' | 'image')[], wireConfigName: 'Doubao_1_6' }],
    }
    const result = await new TraeSoloBridge(upstream, catalog).chatStream(JSON.stringify({
      model: 'Doubao-Seed-Code', messages: [{ role: 'user', content: '1+1' }],
    }))
    expect(result.ok).toBe(true)
    const forwardedBody = JSON.parse(forwarded) as Record<string, unknown>
    expect(forwardedBody['model']).toBe('Doubao_1_6')
    // The SSE chunk label stays the display id the caller requested.
    const response = result.ok ? result.response : undefined
    expect(await response?.text()).toContain('"model":"Doubao-Seed-Code"')
  })

  it('falls back to the startup wire resolver when the catalog lacks wireConfigName', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    // A persisted catalog that was saved before the schema kept wireConfigName.
    const catalog = {
      current: () => [{ id: 'Doubao-Seed-Code', name: 'Seed-Code', input: ['text'] as ('text' | 'image')[] }],
    }
    const resolver = (id: string): { configName: string } | undefined => (id === 'Doubao-Seed-Code' ? { configName: 'Doubao_1_6' } : undefined)
    const result = await new TraeSoloBridge(upstream, catalog, resolver).chatStream(JSON.stringify({
      model: 'Doubao-Seed-Code', messages: [{ role: 'user', content: '1+1' }],
    }))
    expect(result.ok).toBe(true)
    expect((JSON.parse(forwarded) as Record<string, unknown>)['model']).toBe('Doubao_1_6')
  })

  it('borrows the directory function when the catalog row carries only the config_name', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    // A row saved by a build whose settings schema kept the name mapping but
    // dropped `wireFunction`: the id is its own config_name, and the function
    // (`solo_agent_remote`) is the half that a `4001` is made of.
    const catalog = {
      current: () => [{ id: 'Doubao-Seed-Code', name: 'Seed-Code', input: ['text'] as ('text' | 'image')[], wireConfigName: 'Doubao-Seed-Code' }],
    }
    const resolver = (id: string): { configName: string; function: string } | undefined =>
      (id === 'Doubao-Seed-Code' || id === 'Seed-Code' ? { configName: 'Doubao-Seed-Code', function: 'solo_agent_remote' } : undefined)
    const result = await new TraeSoloBridge(upstream, catalog, resolver).chatStream(JSON.stringify({
      model: 'Doubao-Seed-Code', messages: [{ role: 'user', content: '1+1' }],
    }))
    expect(result.ok).toBe(true)
    const forwardedBody = JSON.parse(forwarded) as Record<string, unknown>
    expect(forwardedBody['model']).toBe('Doubao-Seed-Code')
    expect(forwardedBody['function']).toBe('solo_agent_remote')
  })

  it('keeps the catalog function when the resolver names a different config_name', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    // The resolver matched another row by display name; borrowing its function
    // would stamp the wrong roster entry, so the catalog's own answer stands.
    const catalog = {
      current: () => [{ id: 'Doubao-Seed-Code', name: 'Seed-Code', input: ['text'] as ('text' | 'image')[], wireConfigName: 'Doubao_1_6' }],
    }
    const resolver = (): { configName: string; function: string } => ({ configName: 'Doubao-Seed-2.0-Code', function: 'solo_work_remote' })
    const result = await new TraeSoloBridge(upstream, catalog, resolver).chatStream(JSON.stringify({
      model: 'Doubao-Seed-Code', messages: [{ role: 'user', content: '1+1' }],
    }))
    expect(result.ok).toBe(true)
    const forwardedBody = JSON.parse(forwarded) as Record<string, unknown>
    expect(forwardedBody['model']).toBe('Doubao_1_6')
    expect(forwardedBody).not.toHaveProperty('function')
  })

  it('uses the directory function when the catalog row carries only wireFunction', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    // The restricted-network shape: the directory group fallback attributed the
    // function, but the empty get_detail_param roster produced NO wireConfigName
    // (id is the config_name). The default solo_work_lite would 4001 for this
    // model, so the function alone must still reach the request.
    const catalog = {
      current: () => [{ id: 'glm-5.3', name: 'GLM-5.3', input: ['text'] as ('text' | 'image')[], wireFunction: 'solo_work_remote' }],
    }
    const result = await new TraeSoloBridge(upstream, catalog).chatStream(JSON.stringify({
      model: 'glm-5.3', messages: [{ role: 'user', content: '1+1' }],
    }))
    expect(result.ok).toBe(true)
    const forwardedBody = JSON.parse(forwarded) as Record<string, unknown>
    expect(forwardedBody['model']).toBe('glm-5.3')
    expect(forwardedBody['function']).toBe('solo_work_remote')
  })

  it('registers every discovered row, including the ones whose id is their config_name', () => {
    const { byId, byName } = wireTargetsOf([
      // The failing case: the pool targets a model the user never enabled for
      // chat, so the runtime catalog has no row for it. The function must still
      // reach the bridge, or the call answers 4001 under the default function.
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', wireFunction: 'solo_agent_remote' },
      { id: 'glm-5.3', name: 'GLM-5.3', wireFunction: 'solo_work_remote' },
      { id: 'Doubao-Seed-Code-2', name: 'Seed-Code', wireFunction: 'solo_work_remote' },
    ])
    expect(byId.get('Doubao-Seed-Code')).toEqual({ configName: 'Doubao-Seed-Code', function: 'solo_agent_remote' })
    expect(byId.get('glm-5.3')).toEqual({ configName: 'glm-5.3', function: 'solo_work_remote' })
    // The display name is the fallback lookup, so it keeps the FIRST row that
    // claimed it: answering with a later row's config_name would be a 4001.
    expect(byName.get('seed-code')).toEqual({ configName: 'Doubao-Seed-Code', function: 'solo_agent_remote' })
  })

  it('prefers the wire config_name over the identity mapping', () => {
    const { byId } = wireTargetsOf([{ id: 'Seed-Code', name: 'Seed-Code', wireConfigName: 'Doubao_1_6', wireFunction: 'solo_agent_remote' }])
    expect(byId.get('Seed-Code')).toEqual({ configName: 'Doubao_1_6', function: 'solo_agent_remote' })
  })

  it('preserves only a reasoning effort advertised by the selected model', async () => {
    let forwarded = ''
    const upstream: TraeUpstreamClient = {
      async chatStream(bodyJson) {
        forwarded = bodyJson
        return { ok: true, response: traeStream(['event: done\ndata: {"finish_reason":"stop"}\n\n']) }
      },
    }
    const catalog = {
      current: () => [{ id: 'qwen', name: 'Qwen', reasoningEfforts: { low: 'light', high: 'high', xhigh: 'extra_high' } }],
    }
    await new TraeSoloBridge(upstream, catalog).chatStream(JSON.stringify({
      model: 'qwen', reasoning_effort: 'high', messages: [{ role: 'user', content: 'hi' }],
    }))
    expect(JSON.parse(forwarded)).toHaveProperty('reasoning_effort', 'high')
    await new TraeSoloBridge(upstream, catalog).chatStream(JSON.stringify({
      model: 'qwen', reasoning_effort: 'medium', messages: [{ role: 'user', content: 'hi' }],
    }))
    expect(JSON.parse(forwarded)).not.toHaveProperty('reasoning_effort')
  })

  it('passes through upstream failures', async () => {
    const upstream: TraeUpstreamClient = { async chatStream() { return { ok: false, status: 402, kind: 'hard_credit', message: 'quota' } } }
    const result = await new TraeSoloBridge(upstream).chatStream('{}')
    expect(result).toEqual({ ok: false, status: 402, kind: 'hard_credit', message: 'quota' })
  })

  // Issue #10: Trae reports prompt-cache accounting on its `token_usage` event;
  // dropping it made every session show "0 cache" while Trae was in fact
  // serving a warm prefix cache. The payload below is a real captured event.
  it('forwards Trae cache tokens as OpenAI prompt_tokens_details', async () => {
    const upstream: TraeUpstreamClient = {
      async chatStream() {
        return { ok: true, response: traeStream([
          'event: token_usage\ndata: {"name":"","prompt_tokens":9224,"completion_tokens":173,"total_tokens":9397,"cache_creation_input_tokens":0,"cache_read_input_tokens":9216,"reasoning_tokens":171}\n\n',
          'event: output\ndata: {"response":"OK"}\n\n',
          'event: done\ndata: {"finish_reason":"stop"}\n\n',
        ]) }
      },
    }
    const result = await new TraeSoloBridge(upstream).chatStream(JSON.stringify({ model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = await result.response.text()
    const usageChunk = text.split('\n\n').find(line => line.includes('"usage"'))
    const usage = (JSON.parse(usageChunk!.replace(/^data: /, '')) as { usage: Record<string, unknown> }).usage
    expect(usage['prompt_tokens']).toBe(9224)
    expect(usage['prompt_tokens_details']).toEqual({ cached_tokens: 9216, cache_write_tokens: 0 })
  })

  it('omits prompt_tokens_details when Trae reports no cache fields', async () => {
    const upstream: TraeUpstreamClient = {
      async chatStream() {
        return { ok: true, response: traeStream([
          'event: token_usage\ndata: {"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}\n\n',
          'event: done\ndata: {"finish_reason":"stop"}\n\n',
        ]) }
      },
    }
    const result = await new TraeSoloBridge(upstream).chatStream(JSON.stringify({ model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = await result.response.text()
    expect(text).toContain('"prompt_tokens":10')
    expect(text).not.toContain('prompt_tokens_details')
  })
})

// Issue #19: Trae reports subscription and function-ownership refusals INSIDE a
// 200 SSE body as `event: error`. Relaying that as 200 and aborting mid-stream
// lost the code at the HTTP boundary — pi-ai only saw a truncated stream and
// reported `Stream ended without finish_reason`, which reads as a network
// fault and gets retried five times. The shapes below are the ones measured
// live on the SG gateway (docs/ISSUE19_DIAGNOSIS.md): `extra` is a JSON
// *string* on the wire.
//
// Issue #33 revised what 4011 IS. It had been read as "the request's function
// does not serve this model", with Trae's own "exceeded the rate limit" text
// dismissed as misleading. A 22-function × 6-model matrix on a live CN
// credential contradicted that: the wrong-function condition is `4001` on every
// function, `4011` never appeared for it, and `glm-5.3` streamed normally under
// the function that owns it. 4011 is the SOLO channel's THROTTLE, and Trae says
// so itself — so the text is now believed and the code is reported as a rate
// limit.
describe('describeTraeFailure: readable in-stream failure text (issue #19)', () => {
  it('keeps the subscription gate readable: 1005 names the plan and the code', () => {
    expect(describeTraeFailure({ code: 1005, message: '', extra: '{"plan":4}' }))
      .toBe("Trae requires a paid plan for this model; the current account's plan does not cover it · plan 4 · Trae code 1005")
  })

  it('reads the plan from an already-unwrapped extra object too', () => {
    expect(describeTraeFailure({ code: 1005, message: '', extra: { plan: 1 } })).toContain('plan 1')
  })

  it('reports 4011 as the throttle it is, and keeps Trae\'s own wording', () => {
    const message = describeTraeFailure({
      code: 4011,
      message: "We're sorry, your requests have exceeded the rate limit. Please wait and try again later.",
    })
    expect(message).toContain('Trae throttled the SOLO channel')
    expect(message).toContain('a rate limit, not the credit balance')
    expect(message).toContain('Trae code 4011')
    expect(message.endsWith("upstream: We're sorry, your requests have exceeded the rate limit. Please wait and try again later.")).toBe(true)
    // The claim that made issue #33 confusing must never come back.
    expect(message).not.toContain('refused this model under the SOLO function')
  })

  it('names an exhausted ENTERPRISE allowance (4222) even though Trae sends no text', () => {
    // Measured 2026-10-17 on a tenant account out of enterprise credit: the
    // gateway answered {"code":4222,"message":""}. An empty upstream message
    // must still produce a readable cause, and it must not be confused with
    // the consumer pool's quota (4008) — the two balances are separate.
    const message = describeTraeFailure({ code: 4222, message: '' })
    expect(message).toContain('enterprise tenant allowance is exhausted')
    expect(message).toContain('separate from the personal credit balance')
    expect(message).toContain('Trae code 4222')
    expect(message).not.toContain("SOLO quota is exhausted")
  })

  it('separates an exhausted quota (4008) from a throttle (4011)', () => {
    const quota = describeTraeFailure({ code: 4008, message: "Your requests have exceeded the quota." })
    expect(quota).toContain("Trae reports the account's SOLO quota is exhausted for this request")
    expect(quota).toContain('Trae code 4008')
    expect(quota).not.toContain('throttled')
  })

  it('names an unknown model name (4023) instead of calling it a bad request', () => {
    expect(describeTraeFailure({ code: 4023, message: "the model is unknown" }))
      .toContain('does not recognise this model name')
  })

  it('reads 2001 as an upstream-side missing function config, not a local fault (issue #39)', () => {
    // The real upstream text from issue #39: the CN roster came back EMPTY
    // (config_info_list: []) and every call failed this way, yet credentials and
    // the model directory were fine and the condition later self-resolved. The
    // wording must send the user to the UPSTREAM's missing config (retry), not
    // to their credentials / re-login / a broken account.
    const message = describeTraeFailure({
      code: 2001,
      message: 'no function config found for appId=6eefa01c-abc, function=solo_work_remote',
    })
    expect(message).toContain('has not published its function config for this route')
    expect(message).toContain('an upstream condition, not a local credential or config problem')
    expect(message).toContain('Trae code 2001')
    // The whole point of issue #39: never send the user hunting for a local fault.
    expect(message).not.toContain('sign in')
    expect(message).not.toContain('re-login')
  })

  it('falls back to a generic refusal for an unmeasured code, still naming it', () => {
    expect(describeTraeFailure({ code: 4955, message: 'quota exceeded' }))
      .toBe('Trae refused the request · Trae code 4955 · upstream: quota exceeded')
  })

  it('describes a codeless error event without inventing a code suffix', () => {
    expect(describeTraeFailure({ message: 'gone away' }))
      .toBe('Trae refused the request · upstream: gone away')
  })
})

describe('bridgeTraeSoloStreamOrFail: an early refusal becomes a real error result (issue #19)', () => {
  it('turns a 1005 subscription gate inside a 200 body into a 402 hard_credit', async () => {
    const result = await bridgeTraeSoloStreamOrFail(traeStream([
      'event: error\ndata: {"code":1005,"message":"","extra":"{\\"plan\\":4}"}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'gpt-6-sol')
    expect(result).toEqual({
      ok: false,
      status: 402,
      kind: 'hard_credit',
      message: "Trae requires a paid plan for this model; the current account's plan does not cover it · plan 4 · Trae code 1005",
    })
  })

  it('maps a 4011 throttle to 429 soft_rate so the status agrees with the message', async () => {
    const result = await bridgeTraeSoloStreamOrFail(traeStream([
      'event: error\ndata: {"code":4011,"message":"exceeded the rate limit"}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'glm-5.3')
    expect(result).toEqual({
      ok: false,
      status: 429,
      kind: 'soft_rate',
      message: 'Trae throttled the SOLO channel for this account (a rate limit, not the credit balance) · Trae code 4011 · upstream: exceeded the rate limit',
    })
  })

  it('recognises a failure hidden in an unnamed event via the error code band', async () => {
    const result = await bridgeTraeSoloStreamOrFail(traeStream([
      'data: {"code":4008,"message":"quota exceeded"}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'glm-5.2')
    expect(result).toEqual({
      ok: false,
      status: 400,
      kind: 'client',
      message: "Trae reports the account's SOLO quota is exhausted for this request · Trae code 4008 · upstream: quota exceeded",
    })
  })

  it('streams a healthy answer through untouched, replaying the peeked head verbatim', async () => {
    const result = await bridgeTraeSoloStreamOrFail(traeStream([
      'event: request_wait_in_queue\ndata: {"position":1}\n\n',
      'event: output\ndata: {"response":"hello"}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'glm-5.2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = await result.response.text()
    expect(text).toContain('"content":"hello"')
    expect(text).toContain('"finish_reason":"stop"')
    expect(text).toContain('data: [DONE]')
  })

  it('errors mid-stream with the readable message when output came first', async () => {
    // The refusal must arrive in a LATER network chunk than the first output,
    // or the peek itself resolves the stream to an error result.
    const result = await bridgeTraeSoloStreamOrFail(traeStreamChunks([
      'event: output\ndata: {"response":"partial"}\n\n',
      'event: error\ndata: {"code":1005,"message":"","extra":"{\\"plan\\":4}"}\n\n'
        + 'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'gpt-6-sol')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const reader = result.response.body!.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toContain('"content":"partial"')
    // The stream dies with the translated refusal, not a bare "truncated" error.
    await expect(reader.read()).rejects.toThrow('Trae code 1005')
  })
})

describe('TraeSoloBridge against the issue #19 refusal', () => {
  it('surfaces the subscription gate as an error result instead of a truncated 200 stream', async () => {
    const upstream: TraeUpstreamClient = {
      async chatStream() {
        return { ok: true, response: traeStream([
          'event: error\ndata: {"code":1005,"message":"","extra":"{\\"plan\\":4}"}\n\n',
          'event: done\ndata: {"finish_reason":"stop"}\n\n',
        ]) }
      },
    }
    const result = await new TraeSoloBridge(upstream).chatStream(JSON.stringify({
      model: 'gpt-6-sol', messages: [{ role: 'user', content: 'hi' }],
    }))
    expect(result).toEqual({
      ok: false,
      status: 402,
      kind: 'hard_credit',
      message: "Trae requires a paid plan for this model; the current account's plan does not cover it · plan 4 · Trae code 1005",
    })
  })
})
