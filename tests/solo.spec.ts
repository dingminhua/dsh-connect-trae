import { describe, expect, it, vi } from 'vitest'
import { prepareSoloBody, TraeSoloUpstreamClient } from '../src/solo.ts'
import { decodeTraeEvent } from '../src/sse.ts'
import type { TraeCredential } from '../src/auth.ts'
import type { TraeIdentity } from '../src/identity.ts'

const credential: TraeCredential = { accessToken: 'at', userId: 'uid', host: 'https://host', expiresAtMs: Date.now() + 1000, edition: 'solo', source: 'desktop' }
const identity: TraeIdentity = { edition: 'solo', machineId: 'machine', deviceId: 'device', appVersion: '0.1.43', platform: 'darwin' }

describe('Trae SOLO protocol', () => {
  it('converts OpenAI messages, model and tools to the evidenced SOLO format', () => {
    const prepared = JSON.parse(prepareSoloBody(JSON.stringify({
      model: 'glm-5.2', messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', tool_calls: [{ id: '1', function: { name: 'read', arguments: '{}' } }] }],
      tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }], stream: false,
    })))
    expect(prepared).toMatchObject({ model: 'glm-5.2', config_name: 'glm-5.2', function: 'chat_v3', stream: true })
    expect(prepared.messages[0].content).toEqual([{ type: 'text', text: 'hello' }])
    expect(prepared.messages[1].tool_calls[0].function_call).toEqual({ name: 'read', arguments: '{}' })
    expect(prepared.messages[1].tool_calls[0].function).toBeUndefined()
    expect(prepared.tools[0].function.parameters).toBe('{"type":"object"}')
  })

  it('drops undeclared OpenAI parameters from minimal and tool-rich requests', () => {
    const prepared = JSON.parse(prepareSoloBody(JSON.stringify({
      model: 'Doubao-Seed-Code',
      messages: [{ role: 'developer', content: 'title' }, { role: 'user', content: 'name it' }],
      temperature: 0.2,
      max_tokens: 128,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      response_format: { type: 'json_object' },
      user: 'session',
    })))
    expect(prepared).toEqual({
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'title' }] },
        { role: 'user', content: [{ type: 'text', text: 'name it' }] },
      ],
      model: 'Doubao-Seed-Code',
      config_name: 'Doubao-Seed-Code',
      function: 'chat_v3',
      stream: true,
    })
  })

  it('keeps image content arrays unchanged while filtering the envelope', () => {
    const content = [
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ]
    const prepared = JSON.parse(prepareSoloBody(JSON.stringify({
      model: 'Doubao-Seed-Code', messages: [{ role: 'user', content }], temperature: 1,
    })))
    expect(prepared.messages[0].content).toEqual(content)
    expect(prepared).toMatchObject({ model: 'Doubao-Seed-Code', config_name: 'Doubao-Seed-Code' })
    expect(prepared).not.toHaveProperty('temperature')
  })

  it('passes the requested model id through unchanged as the llm_utils_chat wire id', () => {
    const prepared = JSON.parse(prepareSoloBody(JSON.stringify({ model: 'glm-5.2', messages: [] })))
    expect(prepared).toMatchObject({ model: 'glm-5.2', config_name: 'glm-5.2' })
  })

  it('normalises the DSH developer role to system for the Trae upstream', () => {
    const prepared = JSON.parse(prepareSoloBody(JSON.stringify({
      model: 'glm-5.2',
      messages: [
        { role: 'developer', content: 'You are a coding agent.' },
        { role: 'user', content: 'hi' },
      ],
    })))
    expect(prepared.messages[0]).toMatchObject({ role: 'system', content: [{ type: 'text', text: 'You are a coding agent.' }] })
  })

  it('preserves tool results for the next agent-loop turn', () => {
    const prepared = JSON.parse(prepareSoloBody(JSON.stringify({
      model: 'glm-5.2',
      messages: [
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{"file_path":"README.md"}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: 'file contents' },
      ],
    })))
    expect(prepared.messages[0].tool_calls[0].function_call.name).toBe('read')
    expect(prepared.messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: [{ type: 'text', text: 'file contents' }] })
  })

  it('rejects tool results without a call id', () => {
    expect(() => prepareSoloBody(JSON.stringify({ messages: [{ role: 'tool', content: 'orphan' }] })))
      .toThrow('tool_call_id')
  })

  it('parses model discovery from the real get_detail_param field names', async () => {
    // Verified 2026-08-30: get_detail_param uses `model_detail_list[].prompt_max_tokens`
    // and `max_tokens` (max output). There are no `max_input_tokens` /
    // `max_output_tokens` / `reasoning_effort_options` fields; reading those made
    // every row's context/maxTokens/reasoning undefined.
    //
    // The context window is `context_window_tokens.dev`, NOT `prompt_max_tokens`:
    // the latter caps one request's prompt and is smaller where both exist
    // (`Seed-2.1-Pro` carries dev 256000 beside prompt_max_tokens 100000, and the
    // Trae IDE shows 256K). Reading the prompt cap under-reported every model.
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ config_info_list: [{
      config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' },
      context_window_tokens: { dev: 232768 },
      model_detail_list: [{ model_name: 'glm-5.2__dev', prompt_max_tokens: 168000, max_tokens: 32000 }],
    }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new TraeSoloUpstreamClient({ credential: async () => credential, identity: async () => identity, fetchImpl })
    await expect(client.fetchModels()).resolves.toEqual([{ id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 232768, maxTokens: 32000 }])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://host/api/ide/v1/get_detail_param')
  })

  it('falls back to prompt_max_tokens when a row carries no context_window_tokens.dev', async () => {
    // Some rows omit `dev`; the prompt cap is then the only window-like figure,
    // and advertising it beats advertising none — DSH rejects a served model
    // whose context window is missing.
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ config_info_list: [{
      config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' },
      model_detail_list: [{ model_name: 'glm-5.2__dev', prompt_max_tokens: 168000, max_tokens: 32000 }],
    }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new TraeSoloUpstreamClient({ credential: async () => credential, identity: async () => identity, fetchImpl })
    await expect(client.fetchModels()).resolves.toEqual([{ id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 168000, maxTokens: 32000 }])
  })

  it('parses SOLO output, usage and reasoning tokens', () => {
    expect(decodeTraeEvent({ event: 'output', data: '{"response":"a","reasoning_content":"r","tool_calls":[{"index":0}]}' })).toEqual({ type: 'delta', text: 'a', reasoning: 'r', toolCalls: [{ index: 0 }] })
    expect(decodeTraeEvent({ event: 'token_usage', data: '{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5,"reasoning_tokens":2}' })).toEqual({ type: 'usage', inputTokens: 2, outputTokens: 3, totalTokens: 5, reasoningTokens: 2 })
  })

  it('calls only the evidenced llm_utils_chat endpoint with required headers', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('event: done\ndata: {"finish_reason":"stop"}\n\n', { status: 200 }))
    const client = new TraeSoloUpstreamClient({ credential: async () => credential, identity: async () => identity, fetchImpl })
    const result = await client.chatStream(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(result.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://host/api/agent/v3/llm_utils_chat')
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Ide-Token']).toBe('at')
    expect(headers['User-Agent']).toBe('Trae/0.1.43')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('wire credit multiplier', () => {
  const client = (body: unknown) => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200 }))
    return new TraeSoloUpstreamClient({
      credential: async () => credential, identity: async () => identity,
      baseUrl: 'https://host', fetchImpl: fetchImpl as unknown as typeof fetch,
    })
  }
  const row = (contactConfig: string) => ({
    config_info_list: [{
      config_name: 'Doubao-Seed-2.1-Pro',
      display_config: { display_name: 'Seed-2.1-Pro' },
      display_contact_config: contactConfig,
      context_window_tokens: { dev: 100000 },
      model_detail_list: [{ prompt_max_tokens: 100000, max_tokens: 16000 }],
    }],
  })
  const contact = (rate: number, before?: number) => JSON.stringify({
    activity_discount: before === undefined ? undefined : {
      enable: true, subKey: 'limited_discount',
      data: { current: { discount_type: 'limited', before_consumption_rate: before, consumption_rate: rate, discount: 10 } },
    },
    consumption_rate: { enable: true, data: { rate } },
  })

  it('reads the effective rate from display_contact_config, not the Remote directory', async () => {
    // 限时 1 折: the list price is 0.8 but the IDE renders 0.08. Only
    // `display_contact_config` carries the discounted figure; the Remote
    // `/models` payload reports 0.8 for the same model and must not win.
    const models = await client(row(contact(0.08, 0.8))).fetchModels()
    expect(models[0]?.creditMultiplier).toBe(0.08)
  })

  it('omits the rate when the contact config is absent or disabled', async () => {
    const absent = await client(row('')).fetchModels()
    expect(absent[0]?.creditMultiplier).toBeUndefined()
    const disabled = await client(row(JSON.stringify({ consumption_rate: { enable: false, data: { rate: 0.5 } } }))).fetchModels()
    expect(disabled[0]?.creditMultiplier).toBeUndefined()
  })

  it('survives a malformed contact config without dropping the model', async () => {
    const models = await client(row('{not json')).fetchModels()
    expect(models.map(model => model.id)).toEqual(['Doubao-Seed-2.1-Pro'])
    expect(models[0]?.creditMultiplier).toBeUndefined()
  })
})

describe('wire catalog de-duplication', () => {
  const contact = JSON.stringify({ consumption_rate: { enable: true, data: { rate: 0.5 } } })
  const row = (over: Record<string, unknown>) => ({
    config_name: 'x', display_config: { display_name: 'X' },
    display_contact_config: contact, config_source: 1,
    context_window_tokens: { dev: 100000 }, model_detail_list: [{ prompt_max_tokens: 100000, max_tokens: 8000 }],
    ...over,
  })
  const fetchWith = (rows: unknown[]) => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      new Response(JSON.stringify({ config_info_list: rows }), { status: 200 }))
    return new TraeSoloUpstreamClient({
      credential: async () => credential, identity: async () => identity,
      baseUrl: 'https://host', fetchImpl: fetchImpl as unknown as typeof fetch,
    })
  }

  it('drops config_source 3 rows that shadow a built-in of the same name', async () => {
    // `deepseek-v4-pro` (source 3) answers 4001 while `DeepSeek-V4-Pro` works.
    const models = await fetchWith([
      row({ config_name: 'DeepSeek-V4-Pro', display_config: { display_name: 'DeepSeek-V4-Pro' } }),
      row({ config_name: 'deepseek-v4-pro', display_config: { display_name: 'DeepSeek-V4-Pro' }, config_source: 3 }),
    ]).fetchModels()
    expect(models.map(m => m.id)).toEqual(['DeepSeek-V4-Pro'])
  })

  it('keeps the picker-visible variant, not Trae first-listed advisor one', async () => {
    // Trae lists `glm-5.2_advisor_doubao` first and flags it invisible; the
    // plain `glm-5.2` is what the IDE offers.
    const models = await fetchWith([
      row({ config_name: 'glm-5.2_advisor_doubao', display_config: { display_name: 'GLM-5.2' }, is_invisible_to_user: true }),
      row({ config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' }, is_invisible_to_user: false }),
    ]).fetchModels()
    expect(models.map(m => m.id)).toEqual(['glm-5.2'])
  })

  it('prefers the visible variant even when it advertises a larger window', async () => {
    // Seed-Code: `Doubao_1_6` (116k, invisible) is listed before
    // `Doubao-Seed-Code` (256k, visible). Keeping the first row lost 140k.
    const models = await fetchWith([
      row({ config_name: 'Doubao_1_6', display_config: { display_name: 'Seed-Code' }, is_invisible_to_user: true, context_window_tokens: { dev: 116000 }, model_detail_list: [{ prompt_max_tokens: 116000, max_tokens: 8000 }] }),
      row({ config_name: 'Doubao-Seed-Code', display_config: { display_name: 'Seed-Code' }, is_invisible_to_user: false, context_window_tokens: { dev: 256000 }, model_detail_list: [{ prompt_max_tokens: 256000, max_tokens: 8000 }] }),
    ]).fetchModels()
    expect(models.map(m => m.id)).toEqual(['Doubao-Seed-Code'])
    expect(models[0]?.contextWindow).toBe(256000)
  })

  it('matches display names case-insensitively and keeps Trae order', async () => {
    // `kimi-k3` (source 1) and `Kimi-k3` (source 3) share a name; distinct
    // names keep first-seen order.
    const models = await fetchWith([
      row({ config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' } }),
      row({ config_name: 'kimi-k3', display_config: { display_name: 'Kimi-K3' } }),
      row({ config_name: 'kimi-k3-custom', display_config: { display_name: 'Kimi-k3' }, config_source: 3 }),
    ]).fetchModels()
    expect(models.map(m => m.id)).toEqual(['glm-5.2', 'kimi-k3'])
  })
})
