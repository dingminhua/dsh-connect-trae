import { describe, expect, it, vi } from 'vitest'
import { TraeSoloRemoteCatalogClient } from '../src/solo-remote.ts'
import type { TraeCredential } from '../src/auth.ts'

const credential: TraeCredential = { accessToken: 'token', userId: 'uid', host: 'https://host', expiresAtMs: Date.now() + 1000, edition: 'solo', source: 'desktop' }

describe('TraeSoloRemoteCatalogClient', () => {
  it('parses model capabilities from the TraeCode chat_v3 group', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'chat_v3', models: [{
        name: 'qwen3.8-max', display_name: 'Qwen3.8-Max', multimodal: true, max_mode: true,
        context_window_tokens: { dev: 200000, max: 1000000 },
        reasoning_effort_config: { support_thinking: true, options: ['light', 'high', 'extra_high'], default_level: 'high' },
        features: JSON.stringify({ consumption_rate: { enable: true, data: { rate: 1.5 } }, reasoning: { enable: true } }),
      }] },
      { function: 'builder_v3', models: [{ name: 'ignored' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toEqual([{
      id: 'qwen3.8-max', name: 'Qwen3.8-Max', multimodal: true,
      contextWindow: 200000, maxContextWindow: 1000000, creditMultiplier: 1.5,
      reasoningSupported: true,
      reasoning: { supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' },
    }])
    // Both product lines are requested: `chat_v3` alone omits the TraeWork-only
    // models (Kimi-K2.7-Code, Kimi-K2.6) that the product's own menu shows.
    const requested = String(fetchImpl.mock.calls[0]?.[0] ?? '')
    expect(requested).toContain('functions=')
    expect(requested).toContain('chat_v3')
    expect(decodeURIComponent(requested)).toContain('solo_work_lite')
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

describe('the Remote directory covers both product lines', () => {
  // `chat_v3` (TraeCode) and the `solo_*` groups (TraeWork) are NOT subsets of
  // each other: only chat_v3 carries Kimi-K2.8-Preview / GLM-5.3-Flash /
  // Qwen3.8-Flash, and only the solo_* groups carry Kimi-K2.7-Code / Kimi-K2.6 /
  // Seed-Code. Requesting a single group dropped the other product's models,
  // which is why the served list lacked rows the product's own menu shows.
  it('requests every product function and merges their groups', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url))
      return new Response(JSON.stringify({ code: 0, data: { list: [
        { function: 'chat_v3', models: [
          { name: 'kimi-k2.8-preview', display_name: 'Kimi-K2.8-Preview', context_window_tokens: { dev: 200000, max: 0 }, max_mode: false },
          { name: 'glm-5.2', display_name: 'GLM-5.2', context_window_tokens: { dev: 116000, max: 1000000 }, max_mode: true },
        ] },
        { function: 'solo_work_lite', models: [
          { name: 'kimi-k2.6', display_name: 'Kimi-K2.6', context_window_tokens: { dev: 200000, max: 0 }, max_mode: false },
          { name: 'glm-5.2', display_name: 'GLM-5.2', context_window_tokens: { dev: 116000, max: 1000000 }, max_mode: true },
        ] },
      ] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl })
    const models = await client.fetchModels()
    // The requested URL must name both products' functions.
    const url = seen[0] ?? ''
    expect(url).toContain('chat_v3')
    expect(url).toContain('solo_work_lite')
    // Both groups' rows are present, and the shared row is not duplicated.
    expect(models.map(model => model.id).sort()).toEqual(['glm-5.2', 'kimi-k2.6', 'kimi-k2.8-preview'])
    // The Max window from the chat_v3 group survives the merge.
    expect(models.find(model => model.id === 'glm-5.2')?.maxContextWindow).toBe(1_000_000)
  })
})
