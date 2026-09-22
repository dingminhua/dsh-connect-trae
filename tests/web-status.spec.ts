import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TraeCredential } from '../src/auth.ts'
import { TraeUsageClient, type TraeUsageOptions } from '../src/usage.ts'
import type { TraeRegion } from '../src/region.ts'
import type { TraeUsageRouteOptions } from '../src/web-status.ts'
import { traeWebUsage } from '../src/web-status.ts'
import { TRAE_USAGE_PATH } from '../src/status-paths.ts'

const expiresAtMs = Date.now() + 60_000
const credential: TraeCredential = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.signature',
  userId: 'uid',
  accountName: 'LaoDing',
  host: 'https://api.trae.cn',
  expiresAtMs,
  edition: 'solo',
  source: 'desktop',
}

function makeRoute(options: { fetchImpl?: typeof fetch } = {}): TraeUsageRouteOptions {
  const fetchImpl = options.fetchImpl ?? (async () => new Response('{}', { status: 200 }))
  const client = new TraeUsageClient({ credential: async () => credential, fetchImpl, baseUrl: 'https://api.trae.cn' })
  return {
    store: () => ({
      async accounts() { return [{ id: 'account-1', accountName: 'LaoDing', edition: 'solo', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true }] },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs: Date.now() + 1000, source: 'desktop' } },
      async resolve() { return credential },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>,
    client: () => client,
    displayModels: (_region: TraeRegion) => [
      { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', contextWindow: 168_000, maxTokens: 32_000 },
    ],
    enabledModelIds: (_region: TraeRegion) => ['DeepSeek-V4-Flash'],
    regionEnabled: () => true,
    rawDiagnostic: () => ({ state: 'protocol-gated', status: 400, checkedAtMs: 123 }),
  }
}

describe('traeWebUsage', () => {
  it('reports signed-out when no credential is present', async () => {
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() { return [] },
      async status() { return { state: 'signed-out' } },
      async diagnose() { return { tried: [], failures: [] } },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(deps, 'cn')
    expect(result).toEqual({ status: 'signed-out', accounts: [], enabled: true, searched: [] })
  })

  it('explains which paths were probed when a machine has no recognizable sign-in', async () => {
    // Issue #5: a CLI-only or wrong-layout machine used to show a bare
    // "not signed in" with no way to tell why. The card must list the probed
    // paths and their failure reasons so the user can report the real layout.
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() { return [] },
      async status() { return { state: 'signed-out' } },
      async diagnose() {
        return {
          tried: [],
          failures: [
            { path: '/home/u/.config/Trae CN/User/globalStorage/storage.json', edition: 'cn' as const, source: 'desktop' as const, reason: 'missing' as const },
            { path: '/home/u/.trae-cn/trae-jwt-token', edition: 'cn' as const, source: 'cli' as const, reason: 'invalid' as const, message: 'Trae CLI token is not a three-part JWT' },
          ],
        }
      },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(deps, 'cn')
    expect(result).toMatchObject({
      status: 'signed-out',
      searched: [
        { path: '/home/u/.config/Trae CN/User/globalStorage/storage.json', source: 'desktop', reason: 'missing' },
        { path: '/home/u/.trae-cn/trae-jwt-token', source: 'cli', reason: 'invalid' },
      ],
    })
  })

  it('maps a signed-in view to the compact card document', async () => {
    let call = 0
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input)
      call += 1
      if (url.endsWith('/web_user_ent_usage')) {
        return new Response(JSON.stringify({
          is_credits_billing: true,
          is_dollar_usage_billing: false,
          is_pay_freshman: true,
          trial_status: { is_in_trial: false, trial_end_time: 0 },
          usage_summary: { total_amount: 7500, consumed_amount: 5879.63, consumption_ratio: 0.7839506666666667 },
          user_entitlement_pack_list: [
            { display_desc: '老用户福利', entitlement_base_info: { end_time: 1788340660, currency: 1, available_endpoint: 1, product_extra: { package_extra: { quota: { credits_limit: 2000 } } } }, usage: { credits_amount: 2000 } },
            { display_desc: '签到奖励', entitlement_base_info: { end_time: 1789837484, currency: 1, available_endpoint: 0, product_extra: { package_extra: { quota: { credits_limit: 200 } } } }, usage: { credits_amount: 179.6288 } },
          ],
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }
    const deps = makeRoute({ fetchImpl })
    const result = await traeWebUsage(deps, 'cn')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result).toMatchObject({
      accountId: 'account-1',
      accountName: 'LaoDing',
      tokenExpiresAtMs: expiresAtMs,
      region: 'cn',
      accounts: [{ id: 'account-1', accountName: 'LaoDing', edition: 'solo', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true }],
      models: [{ id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', contextWindow: 168_000, maxTokens: 32_000 }],
      rawChat: { state: 'protocol-gated', status: 400, checkedAtMs: 123 },
      enabledModelIds: ['DeepSeek-V4-Flash'],
    })
    expect(result.credits).toEqual({
      total: 7500,
      consumed: 5879.63,
      available: 1620.37,
      workAvailable: 0,
      generalAvailable: 20.3712,
      accounts: [
        { displayDesc: '老用户福利', remain: 0, size: 2000 },
        { displayDesc: '签到奖励', remain: 20.3712, size: 200 },
      ],
    })
    expect(call).toBe(1)
  })

  it('keeps discovered candidates separate from the saved runtime list', async () => {
    const deps = makeRoute()
    deps.discoverModels = async () => [{ id: 'new-model', name: 'New Model', contextWindow: 200_000 }]
    const before = deps.displayModels('cn')
    await expect(deps.discoverModels?.('cn')).resolves.toEqual([{ id: 'new-model', name: 'New Model', contextWindow: 200_000 }])
    expect(deps.displayModels('cn')).toEqual(before)
  })

  it('keeps account choices available when the selected credential cannot resolve', async () => {
    const deps = makeRoute()
    const base = deps.store('cn')
    deps.store = () => Object.assign(Object.create(base) as typeof base, {
      resolve: async () => { throw new Error('expired selected account') },
    })
    const result = await traeWebUsage(deps, 'cn')
    expect(result).toMatchObject({ status: 'signed-out', message: 'expired selected account', accounts: [{ id: 'account-1' }] })
  })

  it('degrades a failing credit fetch to creditsError', async () => {
    const fetchImpl = async () => { throw new Error('network down') }
    const deps = makeRoute({ fetchImpl })
    const result = await traeWebUsage(deps, 'cn')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result.creditsError).toContain('network down')
  })

  /**
   * Issue #11: the card renders the on/off checkbox from the Host's committed
   * answer rather than local state, so the switch cannot drift from what the
   * Host actually registered. It must be reported on BOTH branches — a
   * signed-OUT region is precisely the one a user wants to switch off.
   */
  it('reports the region on/off switch on signed-in and signed-out documents', async () => {
    const on = await traeWebUsage(makeRoute(), 'cn')
    if (on.status !== 'signed-in') throw new Error('expected signed-in')
    expect(on.enabled).toBe(true)

    const off = await traeWebUsage({ ...makeRoute(), regionEnabled: () => false }, 'cn')
    if (off.status !== 'signed-in') throw new Error('expected signed-in')
    expect(off.enabled).toBe(false)

    const signedOut = makeRoute()
    signedOut.regionEnabled = () => false
    signedOut.store = () => ({
      async accounts() { return [] },
      async status() { return { state: 'signed-out' } },
      async diagnose() { return { tried: [], failures: [] } },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(signedOut, 'ai')
    expect(result).toMatchObject({ status: 'signed-out', enabled: false })
  })

  it('asks the switch for the requested region only', async () => {
    const asked: TraeRegion[] = []
    const deps = makeRoute()
    deps.regionEnabled = region => { asked.push(region); return region === 'cn' }
    await traeWebUsage(deps, 'cn')
    await traeWebUsage(deps, 'ai')
    expect(asked).toEqual(['cn', 'ai'])
  })
})

describe('traeWebUsage region routing', () => {
  const intlCredential: TraeCredential = {
    accessToken: 'eyJhbGciOiJSUzI1NiJ9.signature',
    userId: 'intl-uid',
    accountName: 'IntlLaoDing',
    host: 'https://growsg-normal.trae.ai',
    userRegion: 'SG',
    expiresAtMs,
    edition: 'solo-sg',
    source: 'desktop',
  }

  function makeIntlRoute(payAnswer: () => Response): TraeUsageRouteOptions {
    const client = new TraeUsageClient({ credential: async () => intlCredential, fetchImpl: async () => payAnswer() })
    const seenRegions: TraeRegion[] = []
    return {
      store: () => ({
        async accounts() { return [{ id: 'account-intl', accountName: 'IntlLaoDing', edition: 'solo-sg', region: 'ai', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true }] },
        async status() { return { state: 'signed-in', edition: 'solo-sg', expiresAtMs, source: 'desktop' } },
        async resolve() { return intlCredential },
      }) as unknown as ReturnType<TraeUsageRouteOptions['store']>,
      client: () => client,
      displayModels: region => {
        seenRegions.push(region)
        return region === 'ai'
          ? [{ id: 'gemini-3.1-pro', name: 'Gemini-3.1-Pro-Preview', contextWindow: 200_000 }]
          : []
      },
      enabledModelIds: region => region === 'ai' ? ['gemini-3.1-pro'] : [],
      regionEnabled: () => true,
    }
  }

  it('serves the ai region its own directory and subscription status', async () => {
    let payCalls = 0
    const deps = makeIntlRoute(() => {
      payCalls += 1
      return new Response(JSON.stringify({
        is_dollar_usage_billing: true, has_package: true,
        trial_status: { is_in_trial: false },
        enable_solo_lite: true,
      }), { status: 200 })
    })
    const result = await traeWebUsage(deps, 'ai')
    if (result.status !== 'signed-in') throw new Error('expected signed-in')
    expect(result.region).toBe('ai')
    expect(result.models.map(model => model.id)).toEqual(['gemini-3.1-pro'])
    expect(result.enabledModelIds).toEqual(['gemini-3.1-pro'])
    expect(result.credits).toBeUndefined()
    expect(result.payStatus).toMatchObject({ isDollarUsageBilling: true, hasPackage: true, enableSoloLite: true })
    expect(payCalls).toBe(1)
  })

  it('degrades an ai pay-status failure instead of failing the document', async () => {
    const deps = makeIntlRoute(() => new Response('nope', { status: 500 }))
    const result = await traeWebUsage(deps, 'ai')
    if (result.status !== 'signed-in') throw new Error('expected signed-in')
    expect(result.region).toBe('ai')
    expect(result.payStatus).toBeUndefined()
    expect(result.payStatusError).toContain('HTTP 500')
  })
})

describe('registerTraeUsageRoute region dispatch', () => {
  /** A captured route entry: the path plus its HTTP handler. */
  interface CapturedEntry {
    path: string
    handler: (req: unknown, res: unknown) => Promise<void> | void
  }

  /** Mount the routes against a fake webServer; return the captures. */
  async function mountRoutes(options: Partial<TraeUsageRouteOptions> = {}): Promise<CapturedEntry[]> {
    const captured: CapturedEntry[] = []
    const FakeWebServer = {
      name: 'webServer',
      inject: [] as const,
      apply(ctx: Context) {
        ctx.provide('webServer', {
          register: (entry: { path: string }) => {
            captured.push(entry as CapturedEntry)
            return () => {}
          },
        })
      },
    }
    const ctx = new Context()
    await ctx.plugin(FakeWebServer)
    const { registerTraeUsageRoute } = await import('../src/web-status.ts')
    registerTraeUsageRoute(ctx, { ...makeRoute(), ...options })
    await ctx.fiber.dispose()
    return captured
  }

  /** Response recorder: json() only needs writeHead + end. */
  function response(): {
    res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (payload?: string) => void }
    status: () => number
    body: () => unknown
  } {
    let statusCode = 0
    let payload = ''
    return {
      res: {
        writeHead: (status: number) => { statusCode = status },
        end: (body?: string) => { payload = body ?? '' },
      },
      status: () => statusCode,
      body: () => JSON.parse(payload),
    }
  }

  it('routes each region query to that region\'s store, defaulting to cn', async () => {
    const seenRegions: TraeRegion[] = []
    const captured = await mountRoutes({
      store: region => {
        seenRegions.push(region)
        return makeRoute().store(region)
      },
    })
    const usage = captured.find(entry => entry.path === TRAE_USAGE_PATH)
    if (usage === undefined) throw new Error('usage route was not registered')

    const first = response()
    await usage.handler({ method: 'GET', url: `${TRAE_USAGE_PATH}?region=ai`, headers: {} }, first.res)
    expect(first.status()).toBe(200)
    expect(first.body()).toMatchObject({ status: 'signed-in', region: 'ai' })
    expect(seenRegions).toEqual(['ai'])

    const second = response()
    await usage.handler({ method: 'GET', url: TRAE_USAGE_PATH, headers: {} }, second.res)
    expect(second.status()).toBe(200)
    expect(second.body()).toMatchObject({ region: 'cn' })
    expect(seenRegions).toEqual(['ai', 'cn'])
  })

  it('refuses an unknown region with 400 before touching the store', async () => {
    const seenRegions: TraeRegion[] = []
    const captured = await mountRoutes({
      store: region => {
        seenRegions.push(region)
        return makeRoute().store(region)
      },
    })
    const usage = captured.find(entry => entry.path === TRAE_USAGE_PATH)
    if (usage === undefined) throw new Error('usage route was not registered')

    const { res, status, body } = response()
    await usage.handler({ method: 'GET', url: `${TRAE_USAGE_PATH}?region=eu`, headers: {} }, res)
    expect(status()).toBe(400)
    expect(body()).toMatchObject({ error: 'unknown region' })
    expect(seenRegions).toEqual([])
  })

  it('refuses non-loopback origins with 403', async () => {
    const captured = await mountRoutes()
    const usage = captured.find(entry => entry.path === TRAE_USAGE_PATH)
    if (usage === undefined) throw new Error('usage route was not registered')
    const { res, status } = response()
    await usage.handler({ method: 'GET', url: TRAE_USAGE_PATH, headers: { origin: 'https://evil.example.com' } }, res)
    expect(status()).toBe(403)
  })
})
