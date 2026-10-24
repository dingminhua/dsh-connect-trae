import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TraeCredential } from '../src/auth.ts'
import { TraeUsageClient, type TraeUsageOptions } from '../src/usage.ts'
import type { TraePanel, TraeRegion } from '../src/region.ts'
import type { TraeUsageRouteOptions } from '../src/web-status.ts'
import { toCredits, traeAccountCredits, traeWebUsage } from '../src/web-status.ts'
import { TRAE_ACCOUNT_STATUS_PATH, TRAE_CHECKIN_PATH, TRAE_MODELS_TEST_PATH, TRAE_USAGE_PATH } from '../src/status-paths.ts'

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
      async accounts() { return [{ id: 'account-1', accountName: 'LaoDing', edition: 'solo', enterprise: false, region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true }] },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs: Date.now() + 1000, source: 'desktop' } },
      async resolve() { return credential },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>,
    client: () => client,
    displayModels: (_panel: TraePanel) => [
      { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', contextWindow: 168_000, maxTokens: 32_000 },
    ],
    enabledModelIds: (_panel: TraePanel) => ['DeepSeek-V4-Flash'],
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
      async quarantinedCopies() { return [] },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(deps, 'cn')
    expect(result).toEqual({ status: 'signed-out', accounts: [], enabled: true, quarantined: [], searched: [] })
  })

  it('tells a signed-out user which copy was quarantined', async () => {
    // Issue #56: the state a user lands in after an account went missing is
    // "signed out", and the reason it went missing is a copy that was kept
    // aside rather than erased. The document must carry that reason, or the
    // only way to learn about it is to browse the DSH home directory.
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() { return [] },
      async status() { return { state: 'signed-out' } },
      async diagnose() { return { tried: [], failures: [] } },
      async quarantinedCopies() {
        return [{ file: '/home/u/.dsh/.trae-auth.cn.json', quarantinedAs: '/home/u/.dsh/.trae-auth.cn.json.corrupt-2026-10-24T06-12-33-456Z', bytes: 2048, accounts: 2 }]
      },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(deps, 'cn')
    expect(result).toMatchObject({
      status: 'signed-out',
      quarantined: [
        {
          file: '/home/u/.dsh/.trae-auth.cn.json',
          quarantinedAs: '/home/u/.dsh/.trae-auth.cn.json.corrupt-2026-10-24T06-12-33-456Z',
          bytes: 2048,
          accounts: 2,
        },
      ],
    })
  })

  it('carries the quarantine notice on a signed-in document too', async () => {
    // The notice is not a signed-out-only thing: a user can be signed in with
    // one account while ANOTHER account's copy was quarantined, and that is
    // exactly the "one account is missing" shape.
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() { return [{ id: 'account-1', accountName: 'LaoDing', edition: 'solo', enterprise: false, region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true }] },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs: Date.now() + 1000, source: 'desktop' } },
      async resolve() { return credential },
      async current() { return credential },
      async quarantinedCopies() {
        return [{ file: '/home/u/.dsh/.trae-auth.cn.json', quarantinedAs: '/home/u/.dsh/.trae-auth.cn.json.corrupt-2026-10-24T06-12-33-456Z', bytes: 512 }]
      },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(deps, 'cn')
    expect(result).toMatchObject({
      status: 'signed-in',
      quarantined: [{ quarantinedAs: '/home/u/.dsh/.trae-auth.cn.json.corrupt-2026-10-24T06-12-33-456Z', bytes: 512 }],
    })
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
      if (url.endsWith('/checkin_credits/status')) {
        return new Response(JSON.stringify({ checked_in: false, code: 0, credits: 150, did_checked_in: false, enable: true, extra_credits: 50 }), { status: 200 })
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
      checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 },
    })
    expect(result.credits).toEqual({
      total: 7500,
      consumed: 5879.63,
      available: 1620.37,
      workAvailable: 0,
      generalAvailable: 20.3712,
      accounts: [
        // `endpoint` is the pack's bucket (0 = General, what SOLO chat spends;
        // 1 = Work, unreachable from here). Carried through so the account pool
        // can rank by spendable credit instead of a total it cannot drain.
        { displayDesc: '老用户福利', remain: 0, size: 2000, expiresAtMs: 1788340660000, endpoint: 1 },
        { displayDesc: '签到奖励', remain: 20.3712, size: 200, expiresAtMs: 1789837484000, endpoint: 0 },
      ],
      // Both packs in this fixture lapsed before the assertion runs, and one of
      // them still carries 20.3712 credit — exactly the case the notice exists
      // for, since that balance is still counted in `total`.
      expiry: {
        within24h: { total: 0, packs: 0 },
        within3d: { total: 0, packs: 0 },
        within7d: { total: 0, packs: 0 },
        expired: { total: 20.3712, packs: 1, earliestExpiresAtMs: 1789837484000 },
      },
    })
    // Credits and check-in are two independent reads, so the card document
    // costs exactly two upstream calls.
    expect(call).toBe(2)
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
    const asked: TraePanel[] = []
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
    const seenRegions: TraePanel[] = []
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
    const seenRegions: TraePanel[] = []
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
    const seenRegions: TraePanel[] = []
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

  /**
   * The claim route is the only one that changes upstream account state, so it
   * carries the strictest guards in the plugin. Each one is asserted against
   * the CALL COUNT of the upstream claim: a guard that answers 200 without
   * having prevented the claim would be worse than no guard at all.
   */
  describe('daily check-in claim route', () => {
    /** Build a usage client whose check-in answers are scripted per call. */
    function checkinClient(options: {
      statuses: readonly Record<string, unknown>[]
      claim?: () => Promise<{ claimed: boolean; code: number; message: string }>
      onClaim?: () => void
    }): TraeUsageClient {
      let read = 0
      return new TraeUsageClient({
        credential: async () => credential,
        fetchImpl: async (input: string | URL | Request) => {
          const url = String(input)
          if (url.endsWith('/checkin_credits/status')) {
            const status = options.statuses[Math.min(read, options.statuses.length - 1)] ?? {}
            read += 1
            return new Response(JSON.stringify(status), { status: 200 })
          }
          if (url.endsWith('/checkin_credits/claim')) {
            options.onClaim?.()
            const claim = await options.claim?.() ?? { claimed: true, code: 0, message: 'success' }
            return new Response(JSON.stringify({ code: claim.code, message: claim.message }), { status: 200 })
          }
          throw new Error(`unexpected fetch: ${url}`)
        },
        baseUrl: 'https://api.trae.cn',
      })
    }

    async function mountCheckin(client: TraeUsageClient): Promise<CapturedEntry> {
      const captured = await mountRoutes({ client: () => client })
      const route = captured.find(entry => entry.path === TRAE_CHECKIN_PATH)
      if (route === undefined) throw new Error('check-in route was not registered')
      return route
    }

    it('claims exactly once and returns the refreshed state', async () => {
      const claims: number[] = []
      let read = 0
      const client = new TraeUsageClient({
        credential: async () => credential,
        fetchImpl: async (input: string | URL | Request) => {
          const url = String(input)
          if (url.endsWith('/checkin_credits/status')) {
            read += 1
            // First read is the guard (unclaimed); the post-claim refresh
            // reports the day as claimed, exactly like the upstream does.
            return new Response(JSON.stringify({
              checked_in: read > 1,
              code: 0,
              credits: 150,
              did_checked_in: read > 1,
              enable: true,
              extra_credits: 50,
            }), { status: 200 })
          }
          if (url.endsWith('/checkin_credits/claim')) {
            claims.push(1)
            return new Response(JSON.stringify({ code: 0, message: 'success' }), { status: 200 })
          }
          throw new Error(`unexpected fetch: ${url}`)
        },
        baseUrl: 'https://api.trae.cn',
      })
      const route = await mountCheckin(client)
      const { res, status, body } = response()
      await route.handler({ method: 'POST', url: `${TRAE_CHECKIN_PATH}?region=cn`, headers: {} }, res)
      expect(status()).toBe(200)
      expect(claims).toHaveLength(1)
      expect(body()).toMatchObject({
        claimed: true,
        alreadyCheckedIn: false,
        code: 0,
        checkin: { checkedIn: true, didCheckedIn: true, credits: 150, extraCredits: 50 },
      })
    })

    it('treats an ACCOUNT-claimed day as done and never reaches the claim', async () => {
      const claims: number[] = []
      const client = checkinClient({
        statuses: [{ checked_in: true, code: 0, credits: 150, did_checked_in: true, enable: true }],
        onClaim: () => { claims.push(1) },
      })
      const route = await mountCheckin(client)
      const { res, status, body } = response()
      await route.handler({ method: 'POST', url: TRAE_CHECKIN_PATH, headers: {} }, res)
      expect(status()).toBe(200)
      expect(claims).toEqual([])
      expect(body()).toMatchObject({ alreadyCheckedIn: true, checkin: { checkedIn: true, didCheckedIn: true } })
    })

    it('does NOT read a device-claimed day as "this account claimed"', async () => {
      // Measured 2026-09-26: `did_checked_in` is keyed on `x-device-id`, not on
      // the account. After switching accounts on one machine the status reads
      // `checked_in: false, did_checked_in: true` — the device spent its
      // check-in, the account was never rewarded. Answering
      // `alreadyCheckedIn: true` there was a shipped bug: it told the user
      // "claimed today" and hid that the new account got nothing.
      const claims: number[] = []
      const client = checkinClient({
        statuses: [{ checked_in: false, code: 0, credits: 150, did_checked_in: true, enable: true }],
        onClaim: () => { claims.push(1) },
      })
      const route = await mountCheckin(client)
      const { res, status, body } = response()
      await route.handler({ method: 'POST', url: TRAE_CHECKIN_PATH, headers: {} }, res)
      expect(status()).toBe(200)
      // No claim is sent — it could only be refused (9095) — but the answer
      // must say WHY, and it must not claim the account was already paid.
      expect(claims).toEqual([])
      expect(body()).toMatchObject({
        claimed: false,
        alreadyCheckedIn: false,
        deviceCheckedIn: true,
        code: 9095,
        checkin: { checkedIn: false, didCheckedIn: true },
      })
    })

    it('reports an upstream 9095 refusal as a spent device, not a failure', async () => {
      // The device raced us: another window or the Trae app itself claimed
      // between the guard read and the claim. 9095 is the upstream's own
      // "该设备今日已参与签到", so it must surface as `deviceCheckedIn` rather
      // than as a generic error the user would read as a plugin fault.
      const client = checkinClient({
        statuses: [{ checked_in: false, code: 0, credits: 150, did_checked_in: false, enable: true }],
        claim: async () => ({ claimed: false, code: 9095, message: '当前设备今日已经签到，请明日再来哦～' }),
      })
      const route = await mountCheckin(client)
      const { res, status, body } = response()
      await route.handler({ method: 'POST', url: TRAE_CHECKIN_PATH, headers: {} }, res)
      expect(status()).toBe(200)
      expect(body()).toMatchObject({ claimed: false, alreadyCheckedIn: false, deviceCheckedIn: true, code: 9095 })
    })

    it('refuses with 409 and never claims when the activity is disabled', async () => {
      const claims: number[] = []
      const client = checkinClient({
        statuses: [{ checked_in: false, code: 0, credits: 0, did_checked_in: false, enable: false }],
        onClaim: () => { claims.push(1) },
      })
      const route = await mountCheckin(client)
      const { res, status, body } = response()
      await route.handler({ method: 'POST', url: TRAE_CHECKIN_PATH, headers: {} }, res)
      expect(status()).toBe(409)
      expect(claims).toEqual([])
      expect(body()).toMatchObject({ error: 'check-in is not enabled for this account' })
    })

    it('surfaces a business refusal as claimed:false rather than a 500', async () => {
      // HTTP 200 + code 9004 is the upstream's answer when the claim is
      // rejected (observed live without `x-device-id`). Reporting it as a
      // transport failure would hide the one detail that explains it.
      const client = checkinClient({
        statuses: [{ checked_in: false, code: 0, credits: 150, did_checked_in: false, enable: true }],
        claim: async () => ({ claimed: false, code: 9004, message: 'The submitted order parameters are incorrect.' }),
      })
      const route = await mountCheckin(client)
      const { res, status, body } = response()
      await route.handler({ method: 'POST', url: TRAE_CHECKIN_PATH, headers: {} }, res)
      expect(status()).toBe(200)
      expect(body()).toMatchObject({ claimed: false, code: 9004 })
    })

    it('answers 404 for the international region instead of an upstream HTML 404', async () => {
      // The `/trae/api/v2/ug/*` family does not exist on the ai gateways, so
      // the route states that rather than letting an HTML 404 masquerade as a
      // network fault.
      const captured = await mountRoutes({ client: () => checkinClient({ statuses: [{}] }) })
      const route = captured.find(entry => entry.path === TRAE_CHECKIN_PATH)
      if (route === undefined) throw new Error('check-in route was not registered')
      const { res, status, body } = response()
      await route.handler({ method: 'POST', url: `${TRAE_CHECKIN_PATH}?region=ai`, headers: {} }, res)
      expect(status()).toBe(404)
      expect(body()).toMatchObject({ error: 'check-in is not available for the international region' })
    })

    it('refuses non-POST methods with 405 and non-loopback origins with 403', async () => {
      const route = await mountCheckin(checkinClient({ statuses: [{}] }))
      const wrongMethod = response()
      await route.handler({ method: 'GET', url: TRAE_CHECKIN_PATH, headers: {} }, wrongMethod.res)
      expect(wrongMethod.status()).toBe(405)

      const foreign = response()
      await route.handler({ method: 'POST', url: TRAE_CHECKIN_PATH, headers: { origin: 'https://evil.example.com' } }, foreign.res)
      expect(foreign.status()).toBe(403)
    })
  })

  /**
   * The availability probe is the only route besides the claim that spends
   * something (a real chat call per model), so its guards are asserted against
   * the PROBE CALL COUNT: a guard that answers without having prevented the
   * spend is worse than no guard.
   */
  describe('model availability test route', () => {
    /** A request whose body streams the given JSON, as the real POST does. */
    function request(body: unknown, url = `${TRAE_MODELS_TEST_PATH}?region=cn`, headers: Record<string, string> = {}): unknown {
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      return {
        method: 'POST',
        url,
        headers,
        async *[Symbol.asyncIterator]() { yield Buffer.from(text, 'utf8') },
      }
    }

    it("probes the requested ids through the active region's bridge and reports each verdict", async () => {
      const calls: string[][] = []
      const captured = await mountRoutes({
        probeModels: async (_region, ids) => {
          calls.push([...ids])
          return { results: ids.map(id => ({ id, verdict: 'available', detail: 'upstream answered' })) }
        },
      })
      const route = captured.find(entry => entry.path === TRAE_MODELS_TEST_PATH)
      if (route === undefined) throw new Error('test route was not registered')
      const { res, status, body } = response()
      await route.handler(request({ ids: ['glm-5.2', 'gpt-5.4'] }), res)
      expect(status()).toBe(200)
      expect(calls).toEqual([['glm-5.2', 'gpt-5.4']])
      expect(body()).toMatchObject({ results: [{ id: 'glm-5.2', verdict: 'available' }, { id: 'gpt-5.4', verdict: 'available' }] })
    })

    it('spends nothing when the method, the origin or the body is wrong', async () => {
      let spent = 0
      const captured = await mountRoutes({
        probeModels: async () => { spent += 1; return { results: [] } },
      })
      const route = captured.find(entry => entry.path === TRAE_MODELS_TEST_PATH)
      if (route === undefined) throw new Error('test route was not registered')

      const notPost = response()
      await route.handler({ method: 'GET', url: `${TRAE_MODELS_TEST_PATH}?region=cn`, headers: {} }, notPost.res)
      expect(notPost.status()).toBe(405)

      const foreign = response()
      await route.handler(request({ ids: ['x'] }, `${TRAE_MODELS_TEST_PATH}?region=cn`, { origin: 'https://evil.example.com' }), foreign.res)
      expect(foreign.status()).toBe(403)

      for (const bad of ['', '{', '{"ids":"glm-5.2"}', '{"ids":[]}']) {
        const badResponse = response()
        await route.handler(request(bad), badResponse.res)
        expect(badResponse.status()).toBe(400)
      }
      // A caller may not spend calls on an unbounded list.
      const tooMany = response()
      await route.handler(request({ ids: Array.from({ length: 65 }, (_, i) => `m${String(i)}`) }), tooMany.res)
      expect(tooMany.status()).toBe(400)
      expect(spent).toBe(0)
    })
  })

  describe('per-account row state (account-status + per-account claim)', () => {
    /** A GET request for the account-status route. */
    function statusRequest(url = TRAE_ACCOUNT_STATUS_PATH): unknown {
      return { method: 'GET', url, headers: {} }
    }

    /** A POST whose body streams JSON, exactly like the real claim POST. */
    function claimRequest(body: unknown, url = `${TRAE_CHECKIN_PATH}?region=cn`): unknown {
      return {
        method: 'POST',
        url,
        headers: {},
        async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body), 'utf8') },
      }
    }

    it('serves one account row its CN check-in + balance state through accountStateOf', async () => {
      const seen: { region: string; accountId: string }[] = []
      const captured = await mountRoutes({
        accountStateOf: async (region, accountId) => {
          seen.push({ region, accountId })
          return { id: accountId, credits: { total: 100, consumed: 0, available: 100, workAvailable: 0, generalAvailable: 50, accounts: [] } }
        },
      })
      const route = captured.find(entry => entry.path === TRAE_ACCOUNT_STATUS_PATH)
      if (route === undefined) throw new Error('account-status route was not registered')

      const { res, status, body } = response()
      await route.handler(statusRequest(`${TRAE_ACCOUNT_STATUS_PATH}?region=cn&accountId=account-1`), res)

      expect(status()).toBe(200)
      expect(seen).toEqual([{ region: 'cn', accountId: 'account-1' }])
      expect(body()).toMatchObject({ id: 'account-1', credits: { generalAvailable: 50 } })
    })

    it('routes the account-status read to its own region', async () => {
      const regions: string[] = []
      const captured = await mountRoutes({
        accountStateOf: async (region) => { regions.push(region); return { id: 'x' } },
      })
      const route = captured.find(entry => entry.path === TRAE_ACCOUNT_STATUS_PATH)
      if (route === undefined) throw new Error('account-status route was not registered')

      const { res, status } = response()
      await route.handler(statusRequest(`${TRAE_ACCOUNT_STATUS_PATH}?region=ai&accountId=account-1`), res)
      expect(status()).toBe(200)
      expect(regions).toEqual(['ai'])
    })

    it('answers 503 when the host exposes no per-account status', async () => {
      const captured = await mountRoutes() // no accountStateOf dependency
      const route = captured.find(entry => entry.path === TRAE_ACCOUNT_STATUS_PATH)
      if (route === undefined) throw new Error('account-status route was not registered')
      const { res, status } = response()
      await route.handler(statusRequest(`${TRAE_ACCOUNT_STATUS_PATH}?region=cn&accountId=account-1`), res)
      expect(status()).toBe(503)
    })

    it('claims FOR a named account, never moving the binding', async () => {
      const claimed: { region: string; accountId: string }[] = []
      const captured = await mountRoutes({
        claimCheckinOf: async (region, accountId) => {
          claimed.push({ region, accountId })
          return {
            claim: { claimed: true, code: 0, message: 'success' },
            checkin: { checkedIn: true, didCheckedIn: true, credits: 150, enabled: true, extraCredits: 50 },
          }
        },
      })
      const route = captured.find(entry => entry.path === TRAE_CHECKIN_PATH)
      if (route === undefined) throw new Error('check-in route was not registered')

      const { res, status, body } = response()
      await route.handler(claimRequest({ accountId: 'account-2' }), res)

      expect(status()).toBe(200)
      expect(claimed).toEqual([{ region: 'cn', accountId: 'account-2' }])
      expect(body()).toMatchObject({ claimed: true, alreadyCheckedIn: true, checkin: { checkedIn: true } })
    })

    it('reports an unknown account on the per-account claim', async () => {
      const captured = await mountRoutes({
        claimCheckinOf: async () => undefined,
      })
      const route = captured.find(entry => entry.path === TRAE_CHECKIN_PATH)
      if (route === undefined) throw new Error('check-in route was not registered')
      const { res, status } = response()
      await route.handler(claimRequest({ accountId: 'nope' }), res)
      expect(status()).toBe(404)
    })
  })
})

/**
 * Issue #25: the bound account is persisted, so a user whose account ran out of
 * credit sees a permanently empty panel with no explanation — and "refresh
 * accounts" re-answers 200 with the same selection, looking like a failure.
 */
describe('traeWebUsage: exhausted bound account (issue #25)', () => {
  const exhausted = (): Response => new Response(JSON.stringify({ code: 0, usage_summary: { total_amount: 100, consumed_amount: 100 }, user_entitlement_pack_list: [] }), { status: 200 })
  // A funded CN account: one Work pack (available_endpoint 1) with 300 left.
  // A factory, not a value: a Response body can only be read once and several
  // tests below need their own.
  const funded = (): Response => new Response(JSON.stringify({
    code: 0,
    usage_summary: { total_amount: 300, consumed_amount: 0 },
    user_entitlement_pack_list: [{
      display_desc: 'Work',
      entitlement_base_info: { available_endpoint: 1, product_extra: { package_extra: { quota: { credits_limit: 300 } } } },
      usage: { credits_amount: 0 },
    }],
  }), { status: 200 })
  const checkin = (): Response => new Response(JSON.stringify({ code: 0, data: { checked_in: false, credits: 0, enable: true, extra_credits: 0 } }), { status: 200 })

  function twoAccounts(): TraeUsageRouteOptions {
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() {
        return [
          { id: 'spent', accountName: 'LaoDing', edition: 'solo', region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true },
          { id: 'usable', accountName: 'DMH', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: false },
        ]
      },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs: expiresAtMs, source: 'desktop' } },
      async resolve() { return credential },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    return deps
  }

  it('offers the other funded account only while the bound one is empty', async () => {
    const deps = twoAccounts()
    const probed: string[] = []
    deps.creditsOfAccount = async (_region, id) => {
      probed.push(id)
      return { total: 500, consumed: 0, available: 500, workAvailable: 300, generalAvailable: 0, accounts: [] }
    }
    deps.client = () => new TraeUsageClient({
      credential: async () => credential,
      baseUrl: 'https://api.trae.cn',
      fetchImpl: (async (url: string) => String(url).includes('web_user_ent_usage') ? exhausted() : checkin()) as unknown as typeof fetch,
    })
    const result = await traeWebUsage(deps, 'cn')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result.credits?.workAvailable).toBe(0)
    expect(result.alternatives).toEqual([
      { id: 'usable', accountName: 'DMH', edition: 'cn', workAvailable: 300, generalAvailable: 0 },
    ])
    // Only the OTHER account is probed, never the bound one again.
    expect(probed).toEqual(['usable'])
  })

  it('does not probe other accounts while the bound one still has credit', async () => {
    const deps = twoAccounts()
    let probed = 0
    deps.creditsOfAccount = async () => { probed += 1; return undefined }
    deps.client = () => new TraeUsageClient({
      credential: async () => credential,
      baseUrl: 'https://api.trae.cn',
      fetchImpl: (async (url: string) => String(url).includes('web_user_ent_usage') ? funded() : checkin) as unknown as typeof fetch,
    })
    const result = await traeWebUsage(deps, 'cn')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result.credits?.workAvailable).toBe(300)
    expect(result.alternatives).toBeUndefined()
    expect(probed).toBe(0)
  })

  it('never offers an account that is empty as well, nor one from another region', async () => {
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() {
        return [
          { id: 'spent', accountName: 'LaoDing', edition: 'solo', region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true },
          // Empty too: must not be offered as a way out.
          { id: 'also-spent', accountName: 'Empty', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: false },
          // Funded but on the OTHER region: its CN packs are not this card's
          // business, and probing it would both waste a call and could report a
          // number that does not apply to the CN tab.
          { id: 'intl', accountName: 'Intl', edition: 'sg', region: 'ai', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: false },
        ]
      },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs: expiresAtMs, source: 'desktop' } },
      async resolve() { return credential },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const probed: string[] = []
    deps.creditsOfAccount = async (_region, id) => {
      probed.push(id)
      return id === 'also-spent'
        ? { total: 0, consumed: 0, available: 0, workAvailable: 0, generalAvailable: 0, accounts: [] }
        : { total: 900, consumed: 0, available: 900, workAvailable: 900, generalAvailable: 0, accounts: [] }
    }
    deps.client = () => new TraeUsageClient({
      credential: async () => credential,
      baseUrl: 'https://api.trae.cn',
      fetchImpl: (async (url: string) => String(url).includes('web_user_ent_usage') ? exhausted() : checkin()) as unknown as typeof fetch,
    })
    const result = await traeWebUsage(deps, 'cn')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    // The ai account must not even be probed; the empty one is probed but not offered.
    expect(probed).toEqual(['also-spent'])
    expect(result.alternatives).toBeUndefined()
  })

  it('omits an alternative that is also empty, and survives a failing probe', async () => {
    const deps = twoAccounts()
    deps.creditsOfAccount = async (_region, id) => {
      if (id === 'usable') throw new Error('stale token')
      return undefined
    }
    deps.client = () => new TraeUsageClient({
      credential: async () => credential,
      baseUrl: 'https://api.trae.cn',
      fetchImpl: (async (url: string) => String(url).includes('web_user_ent_usage') ? exhausted() : checkin()) as unknown as typeof fetch,
    })
    const result = await traeWebUsage(deps, 'cn')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result.alternatives).toBeUndefined()
  })
})

describe('traeAccountCredits: the composer panel table', () => {
  /** A minimal signed-in balance answer. */
  const balance = (general: number): Awaited<ReturnType<NonNullable<TraeUsageRouteOptions['creditsOfAccount']>>> => ({
    total: 7500, consumed: 0, available: general, workAvailable: 0, generalAvailable: general, accounts: [],
  } as Awaited<ReturnType<NonNullable<TraeUsageRouteOptions['creditsOfAccount']>>>)


  /** A client whose snapshot carries the given general balance. */
  const clientWith = (general: number) => ({
    snapshot: async () => ({
      summary: { totalAmount: general, consumedAmount: 0 },
      packs: [{ displayDesc: 'monthly', availableEndpoint: 0, consumedCredits: 0, creditsLimit: general }],
    }),
  }) as unknown as ReturnType<TraeUsageRouteOptions['client']>

  const twoAccounts = (): TraeUsageRouteOptions => {
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() {
        return [
          { id: 'account-1', accountName: 'LaoDing', edition: 'solo', region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true },
          { id: 'account-2', accountName: 'Backup', edition: 'solo', region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: false },
          { id: 'account-3', accountName: 'Empty', edition: 'solo', region: 'cn', source: 'cli', tokenExpiresAtMs: expiresAtMs, selected: false },
        ]
      },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs: Date.now() + 1000, source: 'desktop' } },
      async resolve() { return credential },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    return deps
  }

  it('lists EVERY account — including the bound one and a zero balance', async () => {
    // Both are differences from `creditAlternatives`, which excludes the
    // selected account (it is the one you already have) and drops zero balances
    // (they are the alternatives you would switch TO). The table is a list of
    // what exists, so neither exclusion applies.
    const deps = twoAccounts()
    // The bound account reads through the client (its stored token is the
    // expired one); the other two go through the per-account lookup.
    deps.client = () => clientWith(3392)
    deps.creditsOfAccount = async (_region, accountId) =>
      accountId === 'account-2' ? balance(1777) : balance(0)

    const rows = await traeAccountCredits(deps, 'cn')
    expect(rows.map(row => row.accountName)).toEqual(['LaoDing', 'Backup', 'Empty'])
    expect(rows.map(row => row.generalAvailable)).toEqual([3392, 1777, 0])
    expect(rows[0]?.selected).toBe(true)
    expect(rows[1]?.selected).toBe(false)
  })

  it('reads the BOUND account through the refreshing client, not the pure lookup', async () => {
    // The live failure behind "a credit figure is missing": a bound account's
    // STORED token is normally expired (its own usage read refreshes it), and
    // `creditsOfAccount` hands stale tokens back as-is by design — which is why
    // `creditAlternatives` excludes the selected account. The table does not
    // exclude it, so it must take the other path.
    const deps = twoAccounts()
    deps.creditsOfAccount = async (_region, accountId) => {
      if (accountId === 'account-1') throw new Error('token expired')
      return accountId === 'account-2' ? balance(1777) : balance(0)
    }
    deps.client = () => ({
      snapshot: async () => ({
        summary: { totalAmount: 3392, consumedAmount: 0 },
        packs: [{ displayDesc: 'monthly', availableEndpoint: 0, consumedCredits: 0, creditsLimit: 3392 }],
      }),
    }) as unknown as ReturnType<TraeUsageRouteOptions['client']>

    const rows = await traeAccountCredits(deps, 'cn')
    expect(rows[0]).toEqual({
      id: 'account-1', accountName: 'LaoDing', selected: true, generalAvailable: 3392,
    })
    // ...and the others still take the per-account lookup.
    expect(rows[1]?.generalAvailable).toBe(1777)
  })

  it('keeps an account whose balance read fails, without a figure', async () => {
    // A stale token on one account must not remove it from the table: the whole
    // point of the panel is to SEE which accounts exist and switch to one.
    const deps = twoAccounts()
    deps.client = () => clientWith(3392)
    deps.creditsOfAccount = async (_region, accountId) => {
      if (accountId === 'account-2') throw new Error('token expired')
      return balance(0)
    }

    const rows = await traeAccountCredits(deps, 'cn')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual({ id: 'account-2', accountName: 'Backup', selected: false })
    expect(rows[0]?.generalAvailable).toBe(3392)
  })

  it('still lists the accounts when the host exposes no per-account balance', async () => {
    const deps = twoAccounts()
    delete deps.creditsOfAccount
    deps.client = () => clientWith(3392)
    const rows = await traeAccountCredits(deps, 'cn')
    expect(rows.map(row => row.accountName)).toEqual(['LaoDing', 'Backup', 'Empty'])
    // The bound account's figure does not depend on the optional lookup, so it
    // survives on a host that exposes none; the other rows carry no number.
    expect(rows[0]?.generalAvailable).toBe(3392)
    expect(rows.slice(1).every(row => row.generalAvailable === undefined)).toBe(true)
  })

  it('does not offer accounts from another region', async () => {
    const deps = twoAccounts()
    deps.store = () => ({
      async accounts() {
        return [
          { id: 'cn-1', accountName: 'Domestic', edition: 'solo', region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true },
          { id: 'ai-1', accountName: 'International', edition: 'solo', region: 'ai', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: false },
        ]
      },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs: Date.now() + 1000, source: 'desktop' } },
      async resolve() { return credential },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    deps.creditsOfAccount = async () => balance(10)

    const rows = await traeAccountCredits(deps, 'cn')
    expect(rows.map(row => row.accountName)).toEqual(['Domestic'])
  })
})

describe('toCredits per-pack expiry', () => {
  const pack = (over: Record<string, unknown> = {}) => ({
    displayDesc: '签到奖励',
    creditsLimit: 200,
    consumedCredits: 0,
    ...over,
  })

  const creditsOf = (packs: ReturnType<typeof pack>[]) => toCredits({
    summary: { totalAmount: 200, consumedAmount: 0 },
    packs,
  })

  it('carries each pack expiry through as epoch milliseconds', () => {
    const result = creditsOf([pack({ endTimeMs: 1788340660000 })])
    expect(result.accounts[0]?.expiresAtMs).toBe(1788340660000)
  })

  it('omits the expiry when the upstream reported no usable time', () => {
    // `endTimeMs` is 0 for a pack the upstream gave no `end_time` for. It must be
    // ABSENT rather than 0: a zero epoch reads as 1970 and would sort ahead of
    // every real date, which is the opposite of what a "which lapses first"
    // consumer needs.
    const result = creditsOf([pack({ endTimeMs: 0 })])
    expect(result.accounts[0]).not.toHaveProperty('expiresAtMs')
  })

  it('omits the expiry for a pack that carries none at all', () => {
    const result = creditsOf([pack()])
    expect(result.accounts[0]).not.toHaveProperty('expiresAtMs')
  })

  /**
   * Bucketing. `toCredits` is the only place the card's expiry summary is
   * derived, so these pin the horizons, the soonest-expiry selection, and the
   * two states that must not be confused: "no end times reported" versus
   * "nothing about to lapse".
   */
  describe('expiry summary', () => {
    const HOUR = 3_600_000
    const DAY = 24 * HOUR
    // Fixed clock so a bucket edge cannot drift with the wall clock.
    const NOW = 1_700_000_000_000
    const at = (offsetMs: number): number => NOW + offsetMs
    /** `toCredits` takes the clock explicitly, so buckets are testable. */
    const creditsNow = (packs: ReturnType<typeof pack>[]) => toCredits({
      summary: { totalAmount: 200, consumedAmount: 0 },
      packs,
    }, NOW)

    it('reports no summary when not one pack carried an end time', () => {
      // Absence of data is not evidence of safety, so the field stays unset.
      const result = creditsNow([pack(), pack()])
      expect(result.expiry).toBeUndefined()
    })

    it('buckets credit by horizon and only counts positive balances', () => {
      const result = creditsNow([
        pack({ endTimeMs: at(2 * HOUR), creditsLimit: 100, consumedCredits: 90 }), // 10
        pack({ endTimeMs: at(2 * DAY), creditsLimit: 100, consumedCredits: 80 }), // 20
        pack({ endTimeMs: at(5 * DAY), creditsLimit: 100, consumedCredits: 70 }), // 30
        pack({ endTimeMs: at(20 * DAY), creditsLimit: 100, consumedCredits: 60 }), // 40, outside every window
        // Zero balance inside the window must not inflate the at-risk number.
        pack({ endTimeMs: at(1 * HOUR), creditsLimit: 100, consumedCredits: 100 }),
      ])
      const expiry = result.expiry
      expect(expiry).toBeDefined()
      expect(expiry!.within24h).toMatchObject({ total: 10, packs: 1 })
      expect(expiry!.within3d).toMatchObject({ total: 30, packs: 2 })
      expect(expiry!.within7d).toMatchObject({ total: 60, packs: 3 })
    })

    it('separates already-lapsed credit from credit still to come', () => {
      const result = creditsNow([
        pack({ endTimeMs: at(-1 * HOUR), creditsLimit: 100, consumedCredits: 75 }), // 25, lapsed
        pack({ endTimeMs: at(30 * DAY), creditsLimit: 100, consumedCredits: 95 }), // 5, far future
      ])
      expect(result.expiry!.expired).toMatchObject({ total: 25, packs: 1 })
      // A lapsed pack is still listed as credit, so it still counts toward the
      // total — which is exactly why the notice has to surface it separately.
      // It must NOT also satisfy the forward-looking horizons.
      expect(result.expiry!.within24h).toMatchObject({ total: 0, packs: 0 })
      expect(result.expiry!.within3d).toMatchObject({ total: 0, packs: 0 })
      expect(result.expiry!.within7d).toMatchObject({ total: 0, packs: 0 })
    })

    it('names the soonest expiry in each bucket', () => {
      const result = creditsNow([
        pack({ endTimeMs: at(4 * DAY), creditsLimit: 10, consumedCredits: 9 }),
        pack({ endTimeMs: at(3 * DAY), creditsLimit: 10, consumedCredits: 9 }),
      ])
      expect(result.expiry!.within7d.earliestExpiresAtMs).toBe(at(3 * DAY))
    })

    it('leaves an empty bucket without a soonest time', () => {
      const result = creditsNow([pack({ endTimeMs: at(30 * DAY), creditsLimit: 10, consumedCredits: 0 })])
      expect(result.expiry!.within24h).toEqual({ total: 0, packs: 0 })
      expect(result.expiry!.within24h).not.toHaveProperty('earliestExpiresAtMs')
    })

    it('ignores a non-finite expiry rather than bucketing it', () => {
      const result = creditsNow([
        pack({ endTimeMs: Number.NaN, creditsLimit: 100, consumedCredits: 0 }),
        pack({ endTimeMs: Number.POSITIVE_INFINITY, creditsLimit: 100, consumedCredits: 0 }),
      ])
      // Neither is a usable date, so the card carries no per-pack expiry and the
      // summary stays absent — "we were told nothing usable", not "nothing lapses".
      expect(result.accounts[0]).not.toHaveProperty('expiresAtMs')
      expect(result.expiry).toBeUndefined()
    })

    it('ignores a zero expiry, matching the per-pack projection', () => {
      // `endTimeMs === 0` means the upstream reported no time. The summary must
      // agree with the projection that this pack is undated, or the card would
      // warn about a pack it does not itself carry a date for.
      const result = creditsNow([pack({ endTimeMs: 0, creditsLimit: 100, consumedCredits: 0 })])
      expect(result.expiry).toBeUndefined()
    })
  })
})

describe('enterprise panel only offers accounts that can bill it', () => {
  /** Route whose store knows one tenant account and one personal one. */
  function twoAccounts(): TraeUsageRouteOptions {
    const deps = makeRoute()
    deps.store = () => ({
      async accounts() {
        return [
          { id: 'tenant-1', accountName: 'Tenant User', edition: 'cn', enterprise: true, region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true },
          { id: 'personal-1', accountName: 'Personal User', edition: 'solo', enterprise: false, region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: false },
        ]
      },
      async status() { return { state: 'signed-in', edition: 'cn', expiresAtMs: Date.now() + 1000, source: 'desktop' } },
      async resolve() { return { ...credential, edition: 'cn' } },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    return deps
  }

  it('lists only the tenant account on the enterprise tab', async () => {
    const result = await traeWebUsage(twoAccounts(), 'enterprise')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result.accounts.map(account => account.accountName)).toEqual(['Tenant User'])
  })

  it('still lists both accounts on the domestic tab', async () => {
    // The same credentials serve the consumer pool, so nothing is hidden there.
    const result = await traeWebUsage(twoAccounts(), 'cn')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result.accounts.map(account => account.accountName)).toEqual(['Tenant User', 'Personal User'])
  })

  it('filters the signed-OUT document too', async () => {
    // Regression guard: the account list is spliced into BOTH response shapes.
    // Filtering only the signed-in one is exactly the bug that left a personal
    // account visible on the enterprise tab after a restart.
    const deps = twoAccounts()
    deps.store = () => ({
      async accounts() {
        return [{ id: 'personal-1', accountName: 'Personal User', edition: 'solo', enterprise: false, region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: false }]
      },
      async status() { return { state: 'signed-out' } },
      async diagnose() { return { tried: [], failures: [] } },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(deps, 'enterprise')
    expect(result.status).toBe('signed-out')
    if (result.status !== 'signed-out') return
    expect(result.accounts).toEqual([])
  })
})

describe('enterprise panel exposes no credit figure', () => {
  it('reports the absence explicitly instead of the consumer packs', async () => {
    // The consumer snapshot is the PERSONAL balance. Rendering it under an
    // enterprise heading would be read as the tenant's spend, so the panel does
    // not read it at all and says why.
    const deps = makeRoute({ fetchImpl: async () => new Response(JSON.stringify({ summary: { total_amount: 999, consumed_amount: 1 }, packs: [] }), { status: 200 }) })
    deps.store = () => ({
      async accounts() { return [{ id: 'tenant-1', accountName: 'Tenant User', edition: 'cn', enterprise: true, region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true }] },
      async status() { return { state: 'signed-in', edition: 'cn', expiresAtMs: Date.now() + 1000, source: 'desktop' } },
      async resolve() { return { ...credential, edition: 'cn' } },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>
    const result = await traeWebUsage(deps, 'enterprise')
    expect(result.status).toBe('signed-in')
    if (result.status !== 'signed-in') return
    expect(result.creditsUnavailable).toBe('enterprise')
    expect(result.credits).toBeUndefined()
    expect(result.creditsError).toBeUndefined()
    expect(result.checkin).toBeUndefined()
  })
})
