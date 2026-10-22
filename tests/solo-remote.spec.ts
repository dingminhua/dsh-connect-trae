import { describe, expect, it, vi } from 'vitest'
import { preferStrongerRow, TRAE_REMOTE_DIRECTORY_FUNCTIONS, TraeSoloRemoteCatalogClient } from '../src/solo-remote.ts'
import { mergeTraeModelSources, withChatCallableFunctions } from '../src/catalog.ts'
import { TRAE_DIRECTORY_FUNCTIONS } from '../src/solo.ts'
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
    expect(models[1]).toEqual({
      id: 'qwen3.8-max', name: 'Qwen3.8-Max', multimodal: true,
      contextWindow: 200000, maxContextWindow: 1000000, creditMultiplier: 1.5,
      reasoningSupported: true,
      reasoning: { supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' },
      // The group function travels with the row so the wire join can replay the
      // model's own SOLO function instead of the default (see
      // mergeTraeModelSources / chatCallableModels).
      function: 'solo_agent_remote',
    })
    // Every group is read, not just the preferred one (issue #19): `solo_agent`
    // is where gpt-5.6-* / gpt-6-astra / glm-5.2 live. Rows are passed through
    // as-is — callability is decided by the wire join in mergeTraeModelSources,
    // never here. Rows are unioned in `TRAE_DIRECTORY_FUNCTIONS` precedence
    // order, NOT the gateway's group order — that one is unstable (issue #23
    // measured five different orders in five calls), so the catalog order is
    // deterministic and agrees with the wire roster's own precedence.
    expect(models.map(model => model.id)).toEqual(['ignored', 'qwen3.8-max', 'gpt-5.6-sol'])
    // Chat-capable groups are attributed; `solo_agent` (an IDE/agent roster,
    // 4011/4001 for llm_utils_chat) is NOT — a model that only it lists keeps
    // no function and is called through the default chat function, where it
    // actually answers (issue #19 / docs/ISSUE19_DIAGNOSIS.md).
    expect(models.map(model => model.function)).toEqual(['solo_work_remote', 'solo_agent_remote', undefined])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://solo.trae.cn/api/remote/v1/models?functions=${TRAE_REMOTE_DIRECTORY_FUNCTIONS.cn.join(',')}`)
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
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://coresg-normal.trae.ai/api/remote/v1/models?functions=${TRAE_REMOTE_DIRECTORY_FUNCTIONS.ai.join(',')}`)
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

describe('catalog host fallback', () => {
  it('falls back to the chat-gateway base when the official host fails to connect', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith('https://solo.trae.cn/')) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ code: 0, data: { list: [
        { function: 'solo_work_remote', models: [{ name: 'glm-5.3', display_name: 'GLM-5.3' }] },
      ] } }), { status: 200 })
    })
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    expect(models).toMatchObject([{ id: 'glm-5.3' }])
    // The backup request carries the SAME path and query as the official one.
    const urls = fetchImpl.mock.calls.map(([url]) => String(url))
    expect(urls[0]).toBe(`https://solo.trae.cn/api/remote/v1/models?functions=${TRAE_REMOTE_DIRECTORY_FUNCTIONS.cn.join(',')}`)
    expect(urls[1]).toBe(`https://trae-api-cn.mchost.guru/api/remote/v1/models?functions=${TRAE_REMOTE_DIRECTORY_FUNCTIONS.cn.join(',')}`)
  })

  it('does not fall back when the official host answers a semantic rejection', async () => {
    const fetchImpl = vi.fn(async () => new Response('Unauthorized', { status: 401 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).rejects.toThrow('SOLO remote models returned HTTP 401')
    expect(fetchImpl.mock.calls).toHaveLength(1)
  })

  it('falls back when the official host answers 5xx', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).startsWith('https://solo.trae.cn/')
      ? new Response('boom', { status: 500 })
      : new Response(JSON.stringify({ code: 0, data: { list: [{ function: 'solo_work_remote', models: [{ name: 'glm-5.3' }] }] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toMatchObject([{ id: 'glm-5.3' }])
    expect(fetchImpl.mock.calls).toHaveLength(2)
  })

  it('tries the next base on an empty catalog and remembers nothing', async () => {
    // A 200-but-empty answer is a statement about THAT host, not the end of the
    // chain: the official host may be served by a mirror that has not synced.
    // Both bases answer empty here, so the final error is the empty-catalog one.
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ code: 0, data: { list: [] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).rejects.toThrow(/contained no models/)
    expect(fetchImpl.mock.calls).toHaveLength(2)
    // Nothing was remembered: the next refresh starts from the official host.
    fetchImpl.mockClear()
    await expect(client.fetchModels()).rejects.toThrow(/contained no models/)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('https://solo.trae.cn/')
  })

  it('does not let an empty backup shadow a healthy official host', async () => {
    // Refresh 1: official blocked, backup answers 200-but-empty -> refresh
    // fails, but the backup must NOT be remembered as successful.
    let officialBlocked = true
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith('https://solo.trae.cn/')) {
        if (officialBlocked) throw new TypeError('fetch failed')
        return new Response(JSON.stringify({ code: 0, data: { list: [{ function: 'solo_work_remote', models: [{ name: 'glm-5.3' }] }] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 0, data: { list: [] } }), { status: 200 })
    })
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).rejects.toBeInstanceOf(Error)
    // The network heals. The next refresh must REACH the official host and take
    // its catalog. Before the fix the empty backup had been remembered as
    // successful, so it was tried first and its empty answer aborted the whole
    // refresh without the official host ever being asked.
    officialBlocked = false
    fetchImpl.mockClear()
    await expect(client.fetchModels()).resolves.toMatchObject([{ id: 'glm-5.3' }])
    const urls = fetchImpl.mock.calls.map(([url]) => String(url))
    expect(urls.some(url => url.startsWith('https://solo.trae.cn/'))).toBe(true)
  })

  it('remembers the last successful host and starts later refreshes from it', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).startsWith('https://solo.trae.cn/')
      ? (() => { throw new TypeError('fetch failed') })()
      : new Response(JSON.stringify({ code: 0, data: { list: [{ function: 'solo_work_remote', models: [{ name: 'glm-5.3' }] }] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.fetchModels()
    await client.fetchModels()
    const urls = fetchImpl.mock.calls.map(([url]) => String(url))
    // First refresh: official (blocked), then the backup succeeds. Second
    // refresh: the official host is in its post-failure cooldown, so the
    // remembered backup is tried FIRST and answers; the official host is
    // re-probed once the cooldown expires (see the cooldown test below), which
    // is what lets a healed network take over.
    expect(urls[0]).toContain('https://solo.trae.cn/')
    expect(urls[1]).toBe(`https://trae-api-cn.mchost.guru/api/remote/v1/models?functions=${TRAE_REMOTE_DIRECTORY_FUNCTIONS.cn.join(',')}`)
    expect(urls[2]).toBe(urls[1])
    expect(urls).toHaveLength(3)
  })

  it('re-probes the official host after the cooldown so a healed network takes over', async () => {
    let officialBlocked = true
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith('https://solo.trae.cn/')) {
        if (officialBlocked) throw new TypeError('fetch failed')
        return new Response(JSON.stringify({ code: 0, data: { list: [{ function: 'solo_work_remote', models: [{ name: 'glm-5.3' }] }] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 0, data: { list: [{ function: 'solo_work_remote', models: [{ name: 'glm-5.3' }] }] } }), { status: 200 })
    })
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.fetchModels()
    await client.fetchModels()
    // Still inside the 5-minute cooldown: the official host is skipped.
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).filter(url => url.startsWith('https://solo.trae.cn/'))).toHaveLength(1)
    // Jump past the cooldown with the network healed: the official host is
    // probed FIRST again and its catalog wins.
    officialBlocked = false
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000 })
    try {
      fetchImpl.mockClear()
      await expect(client.fetchModels()).resolves.toMatchObject([{ id: 'glm-5.3' }])
      expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('https://solo.trae.cn/')
      expect(fetchImpl.mock.calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps every model when the gateway repeats a function name', async () => {
    // Nothing documents a function appearing at most once; the old name->group
    // Map kept only the LAST one and silently lost the earlier models.
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_work_remote', models: [{ name: 'model-a' }] },
      { function: 'solo_work_remote', models: [{ name: 'model-b' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    expect(models.map(model => model.id).sort()).toEqual(['model-a', 'model-b'])
    expect(models.map(model => model.function)).toEqual(['solo_work_remote', 'solo_work_remote'])
  })

  it('pins a single host when an explicit baseUrl is given', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => { throw new TypeError('fetch failed') })
    const client = new TraeSoloRemoteCatalogClient({
      credential: async () => credential,
      baseUrl: 'https://custom.example/api/remote/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(client.fetchModels()).rejects.toThrow('fetch failed')
    expect(fetchImpl.mock.calls).toHaveLength(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('https://custom.example/api/remote/v1/models?functions=')
  })
})

describe('directory group function attribution', () => {
  it('attributes each model to the first chat-capable group in the request order', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { list: [
      // Response order deliberately differs from the request's functions= order.
      { function: 'chat_v3', models: [{ name: 'glm-5.2', display_name: 'GLM-5.2' }] },
      { function: 'solo_agent_remote', models: [
        { name: 'Doubao-Seed-Code', display_name: 'Seed-Code' },
        { name: 'glm-5.2', display_name: 'GLM-5.2' },
      ] },
      // An IDE/agent roster listed FIRST in the request must not claim a model
      // that a chat function also lists.
      { function: 'solo_agent', models: [{ name: 'Doubao-Seed-Code', display_name: 'Seed-Code' }] },
      { function: 'solo_work_remote', models: [{ name: 'glm-5.3', display_name: 'GLM-5.3' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    const byId = new Map(models.map(model => [model.id, model]))
    // solo_agent_remote comes before chat_v3 in the request's functions= order,
    // so glm-5.2 (listed by both) is attributed to the former.
    expect(byId.get('glm-5.2')?.function).toBe('solo_agent_remote')
    // Doubao-Seed-Code is listed by solo_agent AND solo_agent_remote; the chat
    // group wins, so the chat call replays solo_agent_remote — where it
    // answers — instead of the 4011/4001 IDE roster.
    expect(byId.get('Doubao-Seed-Code')?.function).toBe('solo_agent_remote')
    expect(byId.get('glm-5.3')?.function).toBe('solo_work_remote')
  })

  it('leaves models only a non-chat group lists with NO function (called through the default)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent', models: [{ name: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol' }] },
      { function: 'builder_v3', models: [{ name: 'studio-agent', display_name: 'Studio Agent' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    expect(models.map(model => model.function)).toEqual([undefined, undefined])
  })

  it('re-asserts the attributed function even when capacity comes from a later group', async () => {
    // The response lists Doubao-Seed-2.1-Pro under solo_agent (Max, widest dev),
    // solo_work_remote (no Max) and chat_v3 (Max, narrower dev). The capacity
    // winner is solo_agent's row — but the FUNCTION must stay the first CHAT
    // group (solo_work_remote precedes chat_v3 in the request order), or the
    // chat call would replay the IDE roster.
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent', models: [{ name: 'Doubao-Seed-2.1-Pro', display_name: 'Seed-2.1-Pro', max_mode: true, context_window_tokens: { dev: 256000, max: 1000000 } }] },
      { function: 'solo_work_remote', models: [{ name: 'Doubao-Seed-2.1-Pro', display_name: 'Seed-2.1-Pro-0915', max_mode: false, context_window_tokens: { dev: 256000, max: 0 } }] },
      { function: 'chat_v3', models: [{ name: 'Doubao-Seed-2.1-Pro', display_name: 'Seed-2.1-Pro-0915', max_mode: true, context_window_tokens: { dev: 116000, max: 1000000 } }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    expect(models[0]?.contextWindow).toBe(256000)
    expect(models[0]?.maxContextWindow).toBe(1000000)
    expect(models[0]?.function).toBe('solo_work_remote')
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

  it('breaks an equal-Max tie on the wider dev window, not on arrival order', () => {
    // Reported by JiewiW on Windows after 2.7.1: `glm-5.2` carries max=1000000
    // in several groups whose dev window differs (chat_v3 116000 vs
    // solo_agent_remote 200000). Stopping at "equal max → keep incumbent" left
    // the DEFAULT window of an unbudgeted model decided by whichever group
    // answered first. The rule must compare dev at that point too.
    const narrowDev = row({ contextWindow: 116000, maxContextWindow: 1000000 })
    const wideDev = row({ contextWindow: 200000, maxContextWindow: 1000000 })
    expect(preferStrongerRow(wideDev, narrowDev)).toBe(wideDev)
    expect(preferStrongerRow(narrowDev, wideDev)).toBe(wideDev)
  })

  it('still prefers a Max row over a wider dev row without one', () => {
    // The Max tier outranks raw dev width: a group that advertises no Max at
    // all must not win on a bigger dev number, or applying the user's 1M budget
    // becomes impossible for that model.
    const maxRow = row({ contextWindow: 116000, maxContextWindow: 1000000 })
    const wideNoMax = row({ contextWindow: 256000 })
    expect(preferStrongerRow(maxRow, wideNoMax)).toBe(maxRow)
    expect(preferStrongerRow(wideNoMax, maxRow)).toBe(maxRow)
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
      // Equal Max with a NARROWER dev window: with an equal-max tie broken on
      // arrival order the dev value leaked the group order back into the result.
      chat_v3: [{ name: 'Doubao-Seed-2.1-Pro', display_name: 'Seed-2.1-Pro-0915', multimodal: true, max_mode: true, context_window_tokens: { dev: 116000, max: 1000000 } }],
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
    // Every order must land on the SAME row: the Max tier wins over the wider
    // dev window of the no-Max group (116000/1000000 — chat_v3's row), because a
    // model without `maxContextWindow` can never honour the user's 1M budget.
    // The point of the assertion is the single-element set, not the value.
    expect(new Set(observed)).toEqual(new Set(['116000/1000000']))
  })
})

describe('restricted network end-to-end: issue #19 models survive', () => {
  it('keeps the nine solo_agent-only models visible and callable-ish', async () => {
    // The directory answers with the solo_agent group only — exactly the
    // restricted-network shape docs/ISSUE19_DIAGNOSIS.md describes.
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_work_remote', models: [{ name: 'glm-5.3', display_name: 'GLM-5.3' }] },
      { function: 'solo_agent', models: [
        { name: 'gpt-5.5' }, { name: 'gpt-5.6-sol' }, { name: 'gpt-6-astra' },
        { name: 'glm-5.2' }, { name: 'kimi-k2.7-code' }, { name: 'Dola-Seed-2.0-Code' },
        { name: 'deepseek-v4-flash-0731' }, { name: 'gpt-5.6-luna' }, { name: 'gpt-5.6-terra' },
      ] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const remote = await client.fetchModels()
    // The wire roster is empty in this scenario.
    const merged = mergeTraeModelSources(remote, [])
    const callable = withChatCallableFunctions(merged, TRAE_DIRECTORY_FUNCTIONS['cn'])
    // Before the fix: callable was 1 (only glm-5.3) — all nine vanished.
    expect(callable).toHaveLength(10)
    expect(callable.map(m => m.id)).toContain('gpt-5.5')
    expect(callable.map(m => m.id)).toContain('glm-5.2')
    // The chat group keeps its function; the solo_agent ones are demoted to
    // "no function" so the bridge uses the default chat function.
    expect(callable.find(m => m.id === 'glm-5.3')?.wireFunction).toBe('solo_work_remote')
    expect(callable.find(m => m.id === 'glm-5.2')?.wireFunction).toBeUndefined()
  })
})

/**
 * The same gateway also disagrees about the promotional rule: measured
 * 2026-10-21 on a live CN credential, `Doubao-Seed-2.1-Turbo` carried a
 * `subsidy` rule in some groups and no `features.activity_discount` at all in
 * others, while the group order varies between calls. Capacity-first dedupe
 * would then discard the only row able to paint a badge, so whether the row
 * advertised a 5折 subsidy would be decided by the gateway's mood.
 */
describe('cross-group dedupe keeps the row that carries the promotion', () => {
  const subsidy = { subsidy: { beforeRate: 0.4, rate: 0.2, discountPercent: 50 } }
  const row = (over: Partial<TraeDiscoveredModel>): TraeDiscoveredModel => ({
    id: 'Doubao-Seed-2.1-Turbo', name: 'Seed-2.1-Turbo', multimodal: true, reasoningSupported: false, ...over,
  })

  it('carries the rule onto the capacity winner instead of trading capacity for it', () => {
    const promoted = row({ contextWindow: 116000, activityDiscount: subsidy })
    const plain = row({ contextWindow: 256000, maxContextWindow: 1000000 })
    for (const [first, second] of [[promoted, plain], [plain, promoted]] as const) {
      const kept = preferStrongerRow(first, second)
      // The badge comes from the row that has the rule…
      expect(kept.activityDiscount).toBe(subsidy)
      // …and the window still comes from the row that advertises more, so
      // keeping a promotion can never cost the user their 1M budget.
      expect(kept.contextWindow).toBe(256000)
      expect(kept.maxContextWindow).toBe(1000000)
    }
  })

  it('ranks two rule-carrying rows by what they can say, not by arrival order', () => {
    const live = row({ activityDiscount: { ...subsidy, current: { discountType: 'subsidy', discountPercent: 50 } } })
    const windowed = row({
      activityDiscount: {
        offPeak: {
          timeZone: 'Asia/Shanghai',
          discountPercent: 50,
          windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 1080, endMinute: 1440 }],
        },
      },
    })
    expect(preferStrongerRow(live, windowed).activityDiscount).toBe(live.activityDiscount)
    expect(preferStrongerRow(windowed, live).activityDiscount).toBe(live.activityDiscount)
    const wide = row({
      activityDiscount: {
        offPeak: {
          timeZone: 'Asia/Shanghai',
          windows: [
            { weekdays: [1, 2, 3, 4, 5], startMinute: 0, endMinute: 540 },
            { weekdays: [1, 2, 3, 4, 5], startMinute: 1080, endMinute: 1440 },
          ],
        },
      },
    })
    expect(preferStrongerRow(wide, windowed).activityDiscount).toBe(wide.activityDiscount)
    expect(preferStrongerRow(windowed, wide).activityDiscount).toBe(wide.activityDiscount)
  })

  it('resolves two equally ranked rules by content, not by arrival order', () => {
    // Both rules have no live `current` and one window each, so the score cannot
    // separate them — yet one covers the morning and the other the evening, so
    // "whichever group answered first" would decide whether tonight's badge
    // appears at all (issue #23's nondeterminism, one layer down).
    const morning = row({
      activityDiscount: {
        offPeak: {
          timeZone: 'Asia/Shanghai',
          windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 0, endMinute: 540 }],
        },
      },
    })
    const evening = row({
      activityDiscount: {
        offPeak: {
          timeZone: 'Asia/Shanghai',
          windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 1080, endMinute: 1440 }],
        },
      },
    })
    const first = preferStrongerRow(morning, evening).activityDiscount
    const second = preferStrongerRow(evening, morning).activityDiscount
    expect(first).toBe(second)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('picks the same row for every group order when one group carries the rule', async () => {
    const groups = {
      builder_v3: [{ name: 'Doubao-Seed-2.1-Turbo', display_name: 'Seed-2.1-Turbo', multimodal: true, max_mode: false, context_window_tokens: { dev: 116000, max: 0 } }],
      chat_v3: [{
        name: 'Doubao-Seed-2.1-Turbo', display_name: 'Seed-2.1-Turbo', multimodal: true, max_mode: true,
        context_window_tokens: { dev: 256000, max: 1000000 },
        features: JSON.stringify({ activity_discount: { enable: true, subKey: 'subsidy_member_discount', data: { current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.2, discount: 50 } } } }),
      }],
    }
    const permutations: string[][] = []
    for (const a of Object.keys(groups)) for (const b of Object.keys(groups)) {
      if (a !== b) permutations.push([a, b])
    }
    const observed: string[] = []
    for (const order of permutations) {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        data: { list: order.map(fn => ({ function: fn, models: groups[fn as keyof typeof groups] })) },
      }), { status: 200 }))
      const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
      const models = await client.fetchModels()
      observed.push(`${String(models.length)}/${String(models[0]?.activityDiscount !== undefined)}`)
    }
    expect(permutations).toHaveLength(2)
    expect(new Set(observed)).toEqual(new Set(['1/true']))
  })
})
