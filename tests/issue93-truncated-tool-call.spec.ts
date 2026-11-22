import { describe, expect, it } from 'vitest'
import { stream } from '@earendil-works/pi-ai/api/openai-completions'
import { bridgeTraeSoloStream, bridgeTraeSoloStreamOrFail } from '../src/solo-bridge.ts'

/**
 * Issue #93: the bridge reported `finish_reason: "tool_calls"` for every stream
 * that contained a tool call, so a call the upstream had CUT OFF looked like a
 * whole one.
 *
 * Downstream that is fatal: pi-ai parses the accumulated arguments as JSON, a
 * truncated argument string fails to parse, and dsh-llm-pi-ai only tolerates
 * that when the turn's stop reason is `length` — otherwise it raises
 * `MALFORMED_RESPONSE` and the whole turn dies (issue #93's log:
 * `Tool call "run_code": Unexpected end of JSON input`).
 */

/** A Trae SSE body. */
function traeStream(events: string[]): Response {
  return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } })
}

/** The event payload the bridge emitted, in order. */
function emitted(text: string): Record<string, unknown>[] {
  return text
    .split('\n\n')
    .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map(line => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
}

/** The `finish_reason` of every finish chunk the bridge emitted, in order. */
function finishReasons(text: string): string[] {
  return emitted(text)
    .map(chunk => chunk['choices'] as Array<{ finish_reason: string | null }> | undefined)
    .filter((choices): choices is Array<{ finish_reason: string | null }> => choices !== undefined)
    .map(choices => choices[0]?.finish_reason)
    .filter((reason): reason is string => reason !== null && reason !== undefined)
}

/** The tool call the upstream was writing when it stopped. */
function truncatedToolCall(): string {
  // The upstream cut the argument string in the middle of a value, exactly as
  // issue #93 recorded it: the JSON never closes.
  return 'event: output\ndata: {"response":"","tool_calls":[{"index":0,"id":"call-cut","type":"function","function_call":{"name":"run_code","arguments":"{\\"code\\": \\"// plan: one probe — all *Keyboard* class strings"}}]}\n\n'
}

/** The same tool call, written out in full. */
function wholeToolCall(): string {
  return 'event: output\ndata: {"response":"","tool_calls":[{"index":0,"id":"call-whole","type":"function","function_call":{"name":"run_code","arguments":"{\\"code\\": \\"print(1)\\"}"}}]}\n\n'
}

/**
 * Run a bridged OpenAI stream through the REAL pi-ai client, the way DSH does.
 *
 * This is where issue #93 became fatal: pi-ai parses the accumulated tool
 * arguments, and `dsh-llm-pi-ai` tolerates the resulting `argumentsError` ONLY
 * when the turn's stop reason is `length` — every other reason raises
 * `MALFORMED_RESPONSE` and kills the whole turn.
 */
async function piAiVerdict(text: string): Promise<{ stopReason: string, rawStopReason?: string, argumentsError?: string }> {
  const bridged = new Response(text, { headers: { 'content-type': 'text/event-stream' } })
  const events = stream(
    {
      id: 'demo-model',
      name: 'Demo Model',
      provider: 'trae',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:9/v1',
      input: ['text'],
      reasoning: false,
      contextWindow: 100000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as never,
    { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] } as never,
    { apiKey: 'test-key', fetch: async () => bridged } as never,
  )
  const message = await events.result()
  const call = message.content.find(block => block.type === 'toolCall')
  return {
    stopReason: message.stopReason,
    ...message.rawStopReason === undefined ? {} : { rawStopReason: message.rawStopReason },
    ...call !== undefined && 'argumentsError' in call && call.argumentsError !== undefined ? { argumentsError: call.argumentsError } : {},
  }
}

describe('issue #93: a tool call the upstream cut off', () => {
  it('keeps the upstream length reason instead of claiming tool_calls', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      truncatedToolCall(),
      'event: done\ndata: {"finish_reason":"length"}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['length'])
  })

  it('reports length when the stream ended without a done event', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      truncatedToolCall(),
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['length'])
  })

  it('reports length when the upstream claimed stop but the arguments do not close', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      truncatedToolCall(),
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['length'])
  })

  it('leaves a whole tool call as tool_calls', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      wholeToolCall(),
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['tool_calls'])
  })

  it('leaves a whole tool call that ended at EOF as tool_calls', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      wholeToolCall(),
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['tool_calls'])
  })

  it('leaves a whole tool call split across deltas as tool_calls', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      'event: output\ndata: {"response":"","tool_calls":[{"index":0,"id":"call-split","type":"function","function_call":{"name":"edit","arguments":"{\\"file\\""}}]}\n\n',
      'event: output\ndata: {"response":"","tool_calls":[{"index":0,"function_call":{"name":"","arguments":":\\"a\\"}"}}]}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['tool_calls'])
  })

  it('keeps the upstream length reason for a truncated answer with no tool call', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      'event: output\ndata: {"response":"half a sentence"}\n\n',
      'event: done\ndata: {"finish_reason":"length"}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['length'])
  })

  it('keeps the upstream length reason even when the tool call looks whole', async () => {
    // The upstream says it stopped on its output limit; that is its call to
    // make. The call is not executed — dsh-llm drops tool calls on a
    // `max-tokens` finish — so a half-written turn cannot run a tool.
    const response = bridgeTraeSoloStream(traeStream([
      wholeToolCall(),
      'event: done\ndata: {"finish_reason":"length"}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['length'])
  })

  it('treats a tool call that never named a tool as cut off', async () => {
    const response = bridgeTraeSoloStream(traeStream([
      'event: output\ndata: {"response":"","tool_calls":[{"index":0,"id":"call-nameless","type":"function","function_call":{"arguments":"{\\"file\\":\\"a\\"}"}}]}\n\n',
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'm')
    const text = await response.text()
    expect(finishReasons(text)).toEqual(['length'])
  })

  it('warns with the received argument length when a tool call is cut off', async () => {
    const logs: Array<{ message: string, detail: unknown }> = []
    const { bridgeTraeSoloStreamOrFail } = await import('../src/solo-bridge.ts')
    const result = await bridgeTraeSoloStreamOrFail(traeStream([
      truncatedToolCall(),
    ]), 'm', (message, detail) => { logs.push({ message, detail }) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The bridge streams lazily: the log line is written while the body is
    // read, so the body has to be consumed before the log can be seen.
    await result.response.text()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.message).toContain('tool call')
    expect(logs[0]?.detail).toMatchObject({
      finishReason: 'length',
      calls: [{ name: 'run_code', argumentsLength: expect.any(Number) }],
    })
  })

  it('does not warn when the tool call was whole', async () => {
    const logs: Array<{ message: string, detail: unknown }> = []
    const { bridgeTraeSoloStreamOrFail } = await import('../src/solo-bridge.ts')
    const result = await bridgeTraeSoloStreamOrFail(traeStream([
      wholeToolCall(),
      'event: done\ndata: {"finish_reason":"stop"}\n\n',
    ]), 'm', (message, detail) => { logs.push({ message, detail }) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    await result.response.text()
    expect(logs).toHaveLength(0)
  })

  it('reaches pi-ai as a length stop, the only reason the downstream tolerates', async () => {
    const text = await bridgeTraeSoloStream(traeStream([
      truncatedToolCall(),
      'event: done\ndata: {"finish_reason":"length"}\n\n',
    ]), 'demo-model').text()
    const verdict = await piAiVerdict(text)
    // The arguments really are broken — that is what pi-ai reports.
    expect(verdict.argumentsError).toContain('JSON')
    // And the stop reason is the one that keeps the turn alive: dsh-llm-pi-ai
    // drops the incomplete call instead of raising MALFORMED_RESPONSE.
    expect(verdict.stopReason).toBe('length')
    expect(verdict.rawStopReason).toBe('length')
  })

  it('shows what the old bridge output did downstream', async () => {
    // The output the bridge used to produce for the very same stream, spelled
    // out: the tool call plus a `tool_calls` finish reason. pi-ai maps
    // `tool_calls` to the stop reason `toolUse`, which is the shape that made
    // dsh-llm-pi-ai raise MALFORMED_RESPONSE and end the turn.
    const chunk = (delta: unknown, finishReason: string | null): string => `data: ${JSON.stringify({
      id: 'chatcmpl-demo',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'demo-model',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`
    const old = chunk({
      tool_calls: [{ index: 0, id: 'call-cut', type: 'function', function: { name: 'run_code', arguments: '{"code": "// plan: one probe' } }],
    }, null) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n'
    const verdict = await piAiVerdict(old)
    expect(verdict.argumentsError).toContain('JSON')
    expect(verdict.stopReason).toBe('toolUse')
  })
})
