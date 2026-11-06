/**
 * The first-paint usage document (issue #77).
 *
 * WHY THIS FILE EXISTS: the settings card used to paint nothing until ONE
 * monolithic document landed, and that document's tail reads the upstream once
 * per account (the pool's member pass, then the name pass, then the other-account
 * pass, then a check-in read per account). A rate-limited or merely slow upstream
 * therefore stacked 30 s timeouts into the minute the issue reports.
 *
 * The fix is a second, thinner document (`detail=fast`) assembled from LOCAL
 * state only: the credential that is already known, the roster the store already
 * has, the credit totals already measured. It exists so the account rows can be
 * on screen before any billing endpoint answers.
 *
 * What these tests pin, and why each one is a way the fix could rot:
 *
 *  1. the fast document makes NO upstream call — if a later refactor moves a
 *     `client.snapshot()` into a shared helper, the whole point is lost;
 *  2. it STILL carries the pool block — the card's account table lives inside
 *     it (`AccountPool` renders nothing without a pool), so a "fast" document
 *     that omitted it would paint no rows at all;
 *  3. it reads `current()` (local) and never `resolve()` (may refresh tokens
 *     over the network) — except to DIAGNOSE a machine with no credential;
 *  4. absent or misspelled `detail` still answers the FULL document — a typo
 *     must never produce a thinner panel than the user had before.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TraeCredential } from '../src/auth.ts'
import type { TraePanel, TraeRegion } from '../src/region.ts'
import type { TraeUsageRouteOptions, TraePoolDeps } from '../src/web-status.ts'
import { traeWebUsage } from '../src/web-status.ts'
import {
  TRAE_USAGE_PATH,
  fastDetailOf,
  withTraeRegion,
  withTraeRegionFastDetail,
} from '../src/status-paths.ts'

const expiresAtMs = Date.now() + 60_000
const credential: TraeCredential = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.signature',
  userId: 'uid-1',
  accountName: 'demo-user',
  host: 'https://api.trae.cn',
  expiresAtMs,
  edition: 'solo',
  source: 'desktop',
}

/** A store double recording which reads the document made. */
function storeSpies(options: { resolveThrows?: boolean } = {}) {
  let currentCalls = 0
  let resolveCalls = 0
  const store = {
    async accounts() {
      return [{ id: 'account-1', accountName: 'demo-user', edition: 'solo' as const, enterprise: false, region: 'cn' as const, source: 'desktop' as const, tokenExpiresAtMs: expiresAtMs, selected: true }]
    },
    async status() { return { state: 'signed-in' as const, edition: 'solo' as const, expiresAtMs: Date.now() + 1000, source: 'desktop' as const } },
    async current() { currentCalls += 1; return credential },
    async resolve() {
      resolveCalls += 1
      if (options.resolveThrows === true) throw new Error('trae: no signed-in account found')
      return credential
    },
  }
  return {
    store,
    currentCalls: () => currentCalls,
    resolveCalls: () => resolveCalls,
  }
}

/** The client double: every method is a spy, and none may be called by a fast read. */
function clientSpies() {
  const snapshot = vi.fn(async () => ({ summary: { totalAmount: 20, consumedAmount: 0 }, packs: [] }))
  const checkinStatus = vi.fn(async () => ({ checkedIn: true, didCheckedIn: false, enabled: true }))
  const payStatus = vi.fn(async () => ({ plan: 'pro' }))
  return {
    snapshot,
    checkinStatus,
    payStatus,
    client: { snapshot, checkinStatus, payStatus } as unknown as ReturnType<TraeUsageRouteOptions['client']>,
  }
}

/**
 * A pool bag over LOCAL reads only, plus spies on the expensive ones.
 *
 * `localMembers` is what the fast document is allowed to use; `members`,
 * `memberNames`, `otherAccounts` and `checkinState` are the expensive quartet the
 * full document pays for, and every one of them must stay untouched.
 */
function poolSpies(overrides: Partial<Record<keyof TraePoolDeps, unknown>> = {}) {
  const members = vi.fn(async () => [
    { account: { id: 'account-1', accountName: 'demo-user' }, credits: { total: 20, expiringSoon: 0, generalAvailable: 20, workAvailable: 0 } },
  ])
  const localMembers = vi.fn(async () => [
    { account: { id: 'account-1', accountName: 'demo-user' } },
  ])
  const memberNames = vi.fn(async () => ({ 'account-1': 'demo-user' }))
  const localMemberNames = vi.fn(async () => ({ 'account-1': 'demo-user' }))
  const otherAccounts = vi.fn(async () => [{ id: 'account-1', accountName: 'demo-user' }])
  const checkinState = vi.fn(async () => ({ 'account-1': { checkedIn: true } }))
  const cachedCheckinState = vi.fn(() => ({ 'account-1': { checkedIn: true } }))
  const bag = {
    preferences: () => ({ enabled: true, memberAccountIds: ['account-1'] }),
    members,
    localMembers,
    memberNames,
    localMemberNames,
    otherAccounts,
    checkinState,
    cachedCheckinState,
    catalog: () => [],
    ...overrides,
  } as TraePoolDeps
  return { bag, members, localMembers, memberNames, localMemberNames, otherAccounts, checkinState, cachedCheckinState }
}

/** Route options around the doubles. */
function deps(options: {
  store?: ReturnType<typeof storeSpies>
  pool?: ReturnType<typeof poolSpies>
  client?: ReturnType<typeof clientSpies>
} = {}): TraeUsageRouteOptions {
  const store = options.store ?? storeSpies()
  const pool = options.pool ?? poolSpies()
  const client = options.client ?? clientSpies()
  return {
    store: () => store.store as unknown as ReturnType<TraeUsageRouteOptions['store']>,
    client: () => client.client,
    displayModels: (_panel: TraePanel) => [],
    enabledModelIds: (_panel: TraePanel) => [],
    regionEnabled: () => true,
    ...pool.bag === undefined ? {} : { pool: pool.bag },
  }
}

describe('the fast first-paint document (issue #77)', () => {
  it('builds a URL the route can parse, and one only a plain region query produces', () => {
    expect(withTraeRegionFastDetail(TRAE_USAGE_PATH, 'cn')).toBe(`${withTraeRegion(TRAE_USAGE_PATH, 'cn')}&detail=fast`)
    expect(withTraeRegionFastDetail(TRAE_USAGE_PATH, 'enterprise')).toContain('region=enterprise')
  })

  it('recognises ONLY the exact fast value', () => {
    for (const url of [`${TRAE_USAGE_PATH}?region=cn&detail=fast`, `${TRAE_USAGE_PATH}?detail=fast`, `${TRAE_USAGE_PATH}?detail=fast&region=cn`]) {
      expect(fastDetailOf(url), url).toBe(true)
    }
    // Everything else must degrade to the FULL document: a thinner panel is a
    // worse failure than a slower one.
    for (const url of [TRAE_USAGE_PATH, `${TRAE_USAGE_PATH}?region=cn`, `${TRAE_USAGE_PATH}?region=cn&detail=`, `${TRAE_USAGE_PATH}?region=cn&detail=FAST`, `${TRAE_USAGE_PATH}?region=cn&detail=fastest`, `${TRAE_USAGE_PATH}?region=cn&detail=slow`, `${TRAE_USAGE_PATH}#detail=fast`]) {
      expect(fastDetailOf(url), url).toBe(false)
    }
  })

  it('answers with the account rows while calling NO upstream read', async () => {
    const store = storeSpies()
    const client = clientSpies()
    const pool = poolSpies()
    const doc = await traeWebUsage(deps({ store, pool, client }), 'cn', { detail: 'fast' })

    // The rows are what the card paints, so they must be there.
    expect(doc.status).toBe('signed-in')
    if (doc.status !== 'signed-in') throw new Error('expected a signed-in document')
    expect(doc.accountName).toBe('demo-user')
    expect(doc.pool?.accounts.map(row => row.accountId)).toEqual(['account-1'])
    expect(doc.accounts).toHaveLength(1)
    // ...and nothing has touched the network.
    expect(client.snapshot).not.toHaveBeenCalled()
    expect(client.checkinStatus).not.toHaveBeenCalled()
    expect(client.payStatus).not.toHaveBeenCalled()
    expect(pool.members).not.toHaveBeenCalled()
    expect(pool.memberNames).not.toHaveBeenCalled()
    expect(pool.otherAccounts).not.toHaveBeenCalled()
    expect(pool.checkinState).not.toHaveBeenCalled()
    // The local sources it MAY read are the cheap ones.
    expect(pool.localMembers).toHaveBeenCalled()
    expect(pool.cachedCheckinState).toHaveBeenCalled()
  })

  it('reads the local credential instead of resolving (refreshing) it', async () => {
    const store = storeSpies()
    await traeWebUsage(deps({ store }), 'cn', { detail: 'fast' })
    expect(store.currentCalls()).toBe(1)
    expect(store.resolveCalls()).toBe(0)
  })

  it('still explains a credential that cannot be resolved', async () => {
    // The store says signed-in but nothing local resolves — the exact case
    // `resolve()` exists to describe ("trae: no signed-in account found (…)").
    // A first paint must not lose that message, and `resolve()` makes no network
    // call when there is no credential to refresh.
    let currentCalls = 0
    let resolveCalls = 0
    const store = {
      async accounts() { return [{ id: 'account-1', accountName: 'demo-user', edition: 'solo' as const, enterprise: false, region: 'cn' as const, source: 'desktop' as const, tokenExpiresAtMs: expiresAtMs, selected: true }] },
      async status() { return { state: 'signed-in' as const, edition: 'solo' as const, expiresAtMs: Date.now() + 1000, source: 'desktop' as const } },
      async diagnose() { return { tried: [], failures: [] } },
      async current() { currentCalls += 1; return undefined },
      async resolve() { resolveCalls += 1; throw new Error('trae: no signed-in account found (/home/u/.trae-cn)') },
    }
    const doc = await traeWebUsage({
      store: () => store as unknown as ReturnType<TraeUsageRouteOptions['store']>,
      client: () => clientSpies().client,
      displayModels: () => [],
      enabledModelIds: () => [],
      regionEnabled: () => true,
    }, 'cn', { detail: 'fast' })
    expect(doc.status).toBe('signed-out')
    if (doc.status !== 'signed-out') throw new Error('expected signed-out')
    expect(doc.message).toContain('no signed-in account found')
    expect(currentCalls).toBe(1)
    expect(resolveCalls).toBe(1)
  })

  it('takes the check-in column from the measurement cache', async () => {
    const pool = poolSpies()
    const doc = await traeWebUsage(deps({ pool }), 'cn', { detail: 'fast' })
    if (doc.status !== 'signed-in') throw new Error('expected a signed-in document')
    expect(doc.pool?.accounts[0]?.checkedInToday).toBe(true)
    expect(pool.checkinState).not.toHaveBeenCalled()
  })

  it('omits the pool block when the Host exposes no local membership', async () => {
    // A first paint must NOT fall back to the expensive read it was told to skip.
    const pool = poolSpies({ localMembers: undefined })
    const doc = await traeWebUsage(deps({ pool }), 'cn', { detail: 'fast' })
    if (doc.status !== 'signed-in') throw new Error('expected a signed-in document')
    expect(doc.pool).toBeUndefined()
    expect(pool.members).not.toHaveBeenCalled()
  })

  it('answers the FULL document when detail is absent', async () => {
    const pool = poolSpies()
    const client = clientSpies()
    await traeWebUsage(deps({ pool, client }), 'cn')
    expect(pool.members).toHaveBeenCalled()
    expect(client.snapshot).toHaveBeenCalled()
    expect(client.checkinStatus).toHaveBeenCalled()
  })

  it('answers the FULL document for a detail value it does not recognise', async () => {
    // The route maps anything but `fast` to full; the document function must
    // treat a hand-built call the same way.
    for (const detail of ['slow', 'FAST', 'fastest'] as const) {
      const pool = poolSpies()
      const client = clientSpies()
      await traeWebUsage(deps({ pool, client }), 'cn', { detail: detail as never })
      expect(pool.members).toHaveBeenCalled()
      expect(client.snapshot).toHaveBeenCalled()
    }
  })
})

describe('the usage route detail switch (issue #77)', () => {
  /** A captured route entry: the path plus its HTTP handler. */
  interface Captured {
    path: string
    handler: (req: unknown, res: unknown) => Promise<void> | void
  }

  async function mount(route: TraeUsageRouteOptions): Promise<Captured[]> {
    const captured: Captured[] = []
    const FakeWebServer = {
      name: 'webServer',
      inject: [] as const,
      apply(ctx: Context) {
        ctx.provide('webServer', {
          register: (entry: { path: string }) => {
            captured.push(entry as Captured)
            return () => {}
          },
        })
      },
    }
    const ctx = new Context()
    await ctx.plugin(FakeWebServer)
    const { registerTraeUsageRoute } = await import('../src/web-status.ts')
    registerTraeUsageRoute(ctx, route)
    await ctx.fiber.dispose()
    return captured
  }

  function response() {
    let statusCode = 0
    let payload = ''
    return {
      res: {
        writeHead: (status: number) => { statusCode = status },
        end: (body?: string) => { payload = body ?? '' },
      },
      status: () => statusCode,
      body: () => JSON.parse(payload) as { pool?: { accounts: unknown[] } },
    }
  }

  async function call(route: TraeUsageRouteOptions, url: string) {
    const captured = await mount(route)
    const usage = captured.find(entry => entry.path === TRAE_USAGE_PATH)
    if (usage === undefined) throw new Error('usage route was not registered')
    const recorder = response()
    await usage.handler({ method: 'GET', url, headers: { host: '127.0.0.1:1234', origin: 'http://127.0.0.1:1234' } }, recorder.res)
    return recorder
  }

  it('serves the first-paint document for detail=fast and the full one otherwise', async () => {
    const pool = poolSpies()
    const client = clientSpies()
    const route = deps({ pool, client })

    const fast = await call(route, withTraeRegionFastDetail(TRAE_USAGE_PATH, 'cn'))
    expect(fast.status()).toBe(200)
    expect(fast.body().pool?.accounts).toHaveLength(1)
    expect(client.snapshot).not.toHaveBeenCalled()
    expect(pool.members).not.toHaveBeenCalled()

    const full = await call(route, withTraeRegion(TRAE_USAGE_PATH, 'cn'))
    expect(full.status()).toBe(200)
    expect(client.snapshot).toHaveBeenCalled()
    expect(pool.members).toHaveBeenCalled()
  })

  it('treats an unknown detail value as the full document', async () => {
    const pool = poolSpies()
    const client = clientSpies()
    const recorder = await call(deps({ pool, client }), `${withTraeRegion(TRAE_USAGE_PATH, 'cn')}&detail=slow`)
    expect(recorder.status()).toBe(200)
    expect(client.snapshot).toHaveBeenCalled()
    expect(pool.members).toHaveBeenCalled()
  })
})

// The unused-import lint of this repo is the typechecker; keep `TraePanel` and
// `TraeRegion` referenced so the import list documents the wire types it uses.
export type _WireTypes = readonly [TraePanel, TraeRegion]
