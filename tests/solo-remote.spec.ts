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
