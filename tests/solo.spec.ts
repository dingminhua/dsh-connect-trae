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
    expect(prepared).toMatchObject({ model: 'glm-5.2', config_name: 'glm-5.2', function: 'solo_work_lite', stream: true })
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
      function: 'solo_work_lite',
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
    // (context) and `max_tokens` (max output). There are no `max_input_tokens` /
    // `max_output_tokens` / `reasoning_effort_options` fields; reading those made
    // every row's context/maxTokens/reasoning undefined.
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ config_info_list: [{
      config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' },
      context_window_tokens: { dev: 232768 },
      model_detail_list: [{ model_name: 'glm-5.2__dev', prompt_max_tokens: 168000, max_tokens: 32000 }],
    }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new TraeSoloUpstreamClient({ credential: async () => credential, identity: async () => identity, fetchImpl })
    // Every row carries the directory function it was found under: the chat
    // call replays it, because a model is only callable through that function.
    await expect(client.fetchModels()).resolves.toEqual([
      { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 168000, maxTokens: 32000, function: 'solo_work_remote' },
    ])
    // The gateway follows the credential's region: a solo (CN) credential routes
    // to the CN chat gateway even though its host field names a bare origin.
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://trae-api-cn.mchost.guru/api/ide/v1/get_detail_param')
  })

  it('reads the post-discount credit multiplier from display_contact_config', async () => {
    // The Trae IDE renders `consumption_rate.data.rate` from the second-layer
    // JSON in `display_contact_config` (commit 1.4.2). Restoring this parser
    // keeps the card's rate equal to what the IDE shows instead of the Remote
    // directory's 10x undiscounted figure (Seed-2.1-Pro: 0.08 vs 0.80).
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ config_info_list: [
      {
        config_name: 'Doubao-Seed-2.1-Pro', display_config: { display_name: 'Seed-2.1-Pro' },
        context_window_tokens: { dev: 1000000 },
        model_detail_list: [{ prompt_max_tokens: 1024000, max_tokens: 32000 }],
        // The wire's own discounted rate (the IDE shows 0.08, not 0.80).
        display_contact_config: JSON.stringify({ consumption_rate: { enable: true, data: { rate: 0.08 } } }),
      },
      {
        config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' },
        context_window_tokens: { dev: 232768 },
        model_detail_list: [{ prompt_max_tokens: 168000, max_tokens: 32000 }],
        // No display_contact_config at all → multiplier stays absent, not fabricated.
      },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new TraeSoloUpstreamClient({ credential: async () => credential, identity: async () => identity, fetchImpl })
    const models = await client.fetchModels()
    expect(models.find(m => m.id === 'Doubao-Seed-2.1-Pro')?.creditMultiplier).toBe(0.08)
    expect(models.find(m => m.id === 'glm-5.2')?.creditMultiplier).toBeUndefined()
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
    expect(url).toBe('https://trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat')
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Ide-Token']).toBe('at')
    expect(headers['User-Agent']).toBe('Trae/0.1.43')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('region-scoped gateways', () => {
  const intlCredential: TraeCredential = {
    accessToken: 'at', userId: 'uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
    expiresAtMs: Date.now() + 1000, edition: 'solo-sg', source: 'desktop',
  }

  it('routes an international credential to the coresg chat gateway', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ config_info_list: [
      { config_name: 'gpt-5.4', display_config: { display_name: 'GPT-5.4' }, model_detail_list: [{ prompt_max_tokens: 240000, max_tokens: 32000 }] },
    ] }), { status: 200 }))
    const client = new TraeSoloUpstreamClient({
      credential: async () => intlCredential,
      identity: async () => identity,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.fetchModels()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://coresg-normal.trae.ai/api/ide/v1/get_detail_param')
  })

  it('routes chat the same way and keeps an explicit baseUrl a pin', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('data: event', { status: 200 }))
    const client = new TraeSoloUpstreamClient({
      credential: async () => intlCredential,
      identity: async () => identity,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.chatStream(JSON.stringify({ model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] }))
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://coresg-normal.trae.ai/api/agent/v3/llm_utils_chat')
    const pinned = new TraeSoloUpstreamClient({
      credential: async () => intlCredential,
      identity: async () => identity,
      baseUrl: 'https://diagnostic.example',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await pinned.chatStream(JSON.stringify({ model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] }))
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://diagnostic.example/api/agent/v3/llm_utils_chat')
  })
})

describe('region-scoped model directory function', () => {
  const intlCredential: TraeCredential = {
    accessToken: 'at', userId: 'uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
    expiresAtMs: Date.now() + 1000, edition: 'solo-sg', source: 'desktop',
  }

  it('asks the ai gateway for the solo_agent directory', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({ config_info_list: [
      { config_name: 'minimax-m3', display_config: { display_name: 'MiniMax-M3' }, model_detail_list: [{ prompt_max_tokens: 200000, max_tokens: 32000 }] },
    ] }), { status: 200 }))
    const client = new TraeSoloUpstreamClient({
      credential: async () => intlCredential,
      identity: async () => identity,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.fetchModels()
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string)
    // The ai directory must come from solo_agent: solo_work_lite omits four of
    // the seven remote-roster models on the international gateway.
    expect(body['function']).toBe('solo_agent')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://coresg-normal.trae.ai/api/ide/v1/get_detail_param')
  })

  it('asks every CN directory function, remote variant first', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ config_info_list: [
      { config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' }, model_detail_list: [{ prompt_max_tokens: 116000, max_tokens: 32000 }] },
    ] }), { status: 200 }))
    const client = new TraeSoloUpstreamClient({
      credential: async () => credential,
      identity: async () => identity,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.fetchModels()
    const functions = fetchImpl.mock.calls.map(call => JSON.parse((call[1] as RequestInit).body as string)['function'])
    // solo_work_remote is asked FIRST: it is the only CN function that lists
    // glm-5.3, and precedence decides which function a shared config binds to.
    expect(functions).toEqual(['solo_work_remote', 'solo_work_lite'])
  })
})

describe('multi-function directory union (glm-5.3 regression, issue #7)', () => {
  const intlCredentialSg: TraeCredential = {
    accessToken: 'at', userId: 'uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
    expiresAtMs: Date.now() + 1000, edition: 'solo-sg', source: 'desktop',
  }

  /** A gateway answering solo_work_remote with an extra config the lite function lacks. */
  function stubDirectory(): ReturnType<typeof vi.fn> {
    return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const fn = JSON.parse(init?.body as string)['function']
      const entries = fn === 'solo_work_remote'
        ? [
            { config_name: 'glm-5.3', display_config: { display_name: 'GLM-5.3' }, model_detail_list: [{ prompt_max_tokens: 168000, max_tokens: 32000 }] },
            { config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' }, model_detail_list: [{ prompt_max_tokens: 168000, max_tokens: 32000 }] },
          ]
        : [
            { config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' }, model_detail_list: [{ prompt_max_tokens: 200000, max_tokens: 32000 }] },
          ]
      return new Response(JSON.stringify({ config_info_list: entries }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
  }

  it('surfaces a model that only one function lists, tagged with that function', async () => {
    const fetchImpl = stubDirectory()
    const client = new TraeSoloUpstreamClient({ credential: async () => credential, identity: async () => identity, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    // glm-5.3 exists ONLY under solo_work_remote — the old single-function scan
    // (solo_work_lite) never saw it, which is exactly issue #7.
    const glm53 = models.find(model => model.id === 'glm-5.3')
    expect(glm53).toMatchObject({ id: 'glm-5.3', name: 'GLM-5.3', function: 'solo_work_remote' })
    // A config listed by both keeps the higher-precedence function.
    expect(models.find(model => model.id === 'glm-5.2')?.function).toBe('solo_work_remote')
  })

  it('keeps the other functions working when one of them fails', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const fn = JSON.parse(init?.body as string)['function']
      if (fn === 'solo_work_remote') return new Response('nope', { status: 500 })
      return new Response(JSON.stringify({ config_info_list: [
        { config_name: 'glm-5.2', display_config: { display_name: 'GLM-5.2' }, model_detail_list: [{ prompt_max_tokens: 168000, max_tokens: 32000 }] },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = new TraeSoloUpstreamClient({ credential: async () => credential, identity: async () => identity, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toMatchObject([{ id: 'glm-5.2', function: 'solo_work_lite' }])
  })

  it('the ai region asks solo_agent first', async () => {
    const fetchImpl = stubDirectory()
    const client = new TraeSoloUpstreamClient({ credential: async () => intlCredentialSg, identity: async () => identity, fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.fetchModels()
    const functions = fetchImpl.mock.calls.map(call => JSON.parse((call[1] as RequestInit).body as string)['function'])
    expect(functions).toEqual(['solo_agent', 'solo_work_remote', 'solo_work_lite'])
  })

  it('an explicit body function wins over the default chat function', () => {
    // The bridge stamps the directory function onto the body; prepareSoloBody
    // must replay it verbatim, otherwise glm-5.3 would be sent as solo_work_lite
    // and rejected with 4001.
    const prepared = JSON.parse(prepareSoloBody(JSON.stringify({
      model: 'glm-5.3', messages: [{ role: 'user', content: 'hi' }], function: 'solo_work_remote',
    })))
    expect(prepared['function']).toBe('solo_work_remote')
    const fallback = JSON.parse(prepareSoloBody(JSON.stringify({ model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] })))
    expect(fallback['function']).toBe('solo_work_lite')
  })
})
