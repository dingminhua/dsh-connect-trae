import { describe, expect, it, vi } from 'vitest'
import { preferStrongerRow, TraeSoloRemoteCatalogClient } from '../src/solo-remote.ts'
import type { TraeDiscoveredModel } from '../src/model-metadata.ts'
import type { TraeCredential } from '../src/auth.ts'

const credential: TraeCredential = { accessToken: 'token', userId: 'uid', host: 'https://host', expiresAtMs: Date.now() + 1000, edition: 'solo', source: 'desktop' }

describe('TraeSoloRemoteCatalogClient', () => {
  it('parses model capabilities and unions every advertised group', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent_remote', models: [{
        name: 'qwen3.8-max', display_name: 'Qwen3.8-Max', multimodal: true, max_mode: true,
        context_window_tokens: { dev: 200000, max: 1000000 },
        reasoning_effort_config: { support_thinking: true, options: ['light', 'high', 'extra_high'], default_level: 'high' },
        features: JSON.stringify({ consumption_rate: { enable: true, data: { rate: 1.5 } }, reasoning: { enable: true } }),
      }] },
      { function: 'solo_agent', models: [{ name: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol' }] },
      { function: 'solo_work_remote', models: [{ name: 'ignored' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    expect(models[0]).toEqual({
      id: 'qwen3.8-max', name: 'Qwen3.8-Max', multimodal: true,
      contextWindow: 200000, maxContextWindow: 1000000, creditMultiplier: 1.5,
      reasoningSupported: true,
      reasoning: { supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' },
    })
    // Every group is read, not just the preferred one (issue #19): `solo_agent`
    // is where gpt-5.6-* / gpt-6-astra / glm-5.2 live. Rows are passed through
    // as-is — callability is decided by the wire join in mergeTraeModelSources,
    // never here.
    expect(models.map(model => model.id)).toEqual(['qwen3.8-max', 'gpt-5.6-sol', 'ignored'])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://solo.trae.cn/api/remote/v1/models?functions=solo_agent,solo_agent_remote,solo_work_remote,solo_work_lite,chat_v3,solo_coder,builder_v3')
  })

  it('emits a model listed by two groups only once', async () => {
    const shared = { name: 'gpt-5.4', display_name: 'GPT-5.4' }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent_remote', models: [shared] },
      { function: 'solo_agent', models: [shared, { name: 'gpt-6-astra', display_name: 'GPT-6-Astra' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toMatchObject([
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
    ])
  })

  it('fails clearly when the catalog response contains no usable models', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).rejects.toThrow(/contained no models/)
  })

  it('does not expose a chat or session API', () => {
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential })
    expect('chat' in client).toBe(false)
  })
})

describe('region-scoped directory gateway', () => {
  it('routes an international credential to coresg with its portal headers', async () => {
    const intlCredential: TraeCredential = {
      accessToken: 'token', userId: 'uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
      expiresAtMs: Date.now() + 1000, edition: 'solo-sg', source: 'desktop',
    }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent_remote', models: [{ name: 'gpt-5.4', display_name: 'GPT-5.4', multimodal: true }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => intlCredential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toHaveLength(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://coresg-normal.trae.ai/api/remote/v1/models?functions=solo_agent,solo_agent_remote,solo_work_remote,solo_work_lite,chat_v3,solo_coder,builder_v3')
    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['Referer']).toBe('https://coresg-normal.trae.ai/')
    expect(headers['x-preferenced-language']).toBe('en')
    expect(headers['x-trae-user-timezone']).toBe('Asia/Singapore')
  })

  it('asks the ai directory for chat_v3, its only source of three callable models', async () => {
    // Measured 2026-10-01 (issue #19 follow-up): deepseek-v3.2,
    // gemini-3-flash-premium and gemini_2.5_flash_premium appear in NO other
    // group, and all three answer normally through llm_utils_chat under
    // chat_v3. Discovery alone does not expose them — the wire join does — but
    // without the group they could never be discovered at all.
    const intlCredential: TraeCredential = {
      accessToken: 'token', userId: 'uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
      expiresAtMs: Date.now() + 1000, edition: 'solo-sg', source: 'desktop',
    }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'chat_v3', models: [{ name: 'deepseek-v3.2', display_name: 'DeepSeek-V3.2' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => intlCredential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toMatchObject([{ id: 'deepseek-v3.2' }])
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('chat_v3')
  })

  it('leaves the CN discovery list alone', async () => {
    // CN had the same shape of miss as ai: its solo_coder group went unread, so
    // its models never appeared. Measured 2026-10-02: every model that group
    // contributes is callable (glm-5 / glm-5.1 / qwen-3.5 / doubao-seed-2.0-code
    // / deepseek-v4-pro / deepseek-v4-flash — each verified under a function
    // whose roster names it). The earlier note claiming three of them answered
    // 4001 everywhere was a probe bug: they had been called by display id.
    const cnCredential: TraeCredential = {
      accessToken: 'token', userId: 'uid', host: 'https://trae-api-cn.mchost.guru', userRegion: 'CN',
      expiresAtMs: Date.now() + 1000, edition: 'cn', source: 'desktop',
    }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_coder', models: [{ name: 'glm-5', display_name: 'GLM-5' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => cnCredential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toMatchObject([{ id: 'glm-5' }])
    const url = String(fetchImpl.mock.calls[0]?.[0])
    expect(url).toContain('solo_coder')
    expect(url).toContain('chat_v3')
    expect(url).toContain('solo_work_lite')
  })
})

/**
 * Issue #23: the gateway groups its directory by function, the SAME model id
 * appears in several groups with DIFFERENT capacity, and the group order varies
 * between calls (measured 2026-10-05: five calls, five orders). Dedupe must
 * therefore not depend on which group answered first, or the published window
 * becomes a coin flip and a configured 1M model silently caps at 256K.
 */
describe('cross-group dedupe keeps the most capable row (issue #23)', () => {
  const row = (over: Partial<TraeDiscoveredModel>): TraeDiscoveredModel => ({
    id: 'Doubao-Seed-2.1-Pro', name: 'Seed-2.1-Pro', multimodal: true, reasoningSupported: false, ...over,
  })

  it('prefers a Max tier over a row without one, whichever order they arrive in', () => {
    const withMax = row({ contextWindow: 256000, maxContextWindow: 1000000 })
    const withoutMax = row({ contextWindow: 116000 })
    expect(preferStrongerRow(withMax, withoutMax)).toBe(withMax)
    expect(preferStrongerRow(withoutMax, withMax)).toBe(withMax)
  })

  it('prefers the larger Max, and then the wider dev window', () => {
    const bigMax = row({ contextWindow: 200000, maxContextWindow: 1000000 })
    const smallMax = row({ contextWindow: 256000, maxContextWindow: 512000 })
    expect(preferStrongerRow(bigMax, smallMax)).toBe(bigMax)
    expect(preferStrongerRow(smallMax, bigMax)).toBe(bigMax)
    const wideDev = row({ contextWindow: 256000 })
    const narrowDev = row({ contextWindow: 116000 })
    expect(preferStrongerRow(wideDev, narrowDev)).toBe(wideDev)
    expect(preferStrongerRow(narrowDev, wideDev)).toBe(wideDev)
  })

  it('keeps the incumbent on an exact tie, so the gateway order still decides equal rows', () => {
    // Both the dev-window tie AND the equal-Max tie matter: with `>=` instead of
    // `>` the later row would win, which makes the picked row depend on arrival
    // order even when capacities are identical (the same class of bug as #23).
    const firstDev = row({ name: 'First', contextWindow: 256000 })
    const secondDev = row({ name: 'Second', contextWindow: 256000 })
    expect(preferStrongerRow(secondDev, firstDev)).toBe(firstDev)
    const firstMax = row({ name: 'FirstMax', contextWindow: 256000, maxContextWindow: 1000000 })
    const secondMax = row({ name: 'SecondMax', contextWindow: 256000, maxContextWindow: 1000000 })
    expect(preferStrongerRow(secondMax, firstMax)).toBe(firstMax)
  })

  it('produces the same catalog for every group order', async () => {
    // The three real disagreement shapes, in all six orders.
    const groups = {
      builder_v3: [{ name: 'Doubao-Seed-2.1-Pro', display_name: 'Seed-2.1-Pro', multimodal: true, max_mode: false, context_window_tokens: { dev: 116000, max: 0 } }],
      solo_work_remote: [{ name: 'Doubao-Seed-2.1-Pro', display_name: 'Seed-2.1-Pro-0915', multimodal: true, max_mode: false, context_window_tokens: { dev: 256000, max: 0 } }],
      chat_v3: [{ name: 'Doubao-Seed-2.1-Pro', display_name: 'Seed-2.1-Pro-0915', multimodal: true, max_mode: true, context_window_tokens: { dev: 256000, max: 1000000 } }],
    }
    const names = Object.keys(groups)
    const permutations: string[][] = []
    for (const a of names) for (const b of names) for (const c of names) {
      if (new Set([a, b, c]).size === 3) permutations.push([a, b, c])
    }
    const observed: string[] = []
    for (const order of permutations) {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        data: { list: order.map(fn => ({ function: fn, models: groups[fn as keyof typeof groups] })) },
      }), { status: 200 }))
      const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
      const models = await client.fetchModels()
      observed.push(`${String(models[0]?.contextWindow)}/${String(models[0]?.maxContextWindow)}`)
    }
    expect(permutations).toHaveLength(6)
    expect(new Set(observed)).toEqual(new Set(['256000/1000000']))
  })
})
