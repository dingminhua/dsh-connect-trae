import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TraeCredential } from '../src/auth.ts'
import { TraeUsageClient } from '../src/usage.ts'
import type { TraePanel } from '../src/region.ts'
import { registerTraeUsageRoute, type TraePoolDeps, type TraeUsageRouteOptions } from '../src/web-status.ts'
import { TRAE_POOL_PATH, withTraePoolAction } from '../src/status-paths.ts'
import type { TraePoolCheckinRow, TraePoolTestRow } from '../src/account-pool-run.ts'

const A = 'a'.repeat(24)
const B = 'b'.repeat(24)
const expiresAtMs = Date.now() + 60_000
const credential: TraeCredential = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.signature',
  userId: 'uid',
  accountName: 'demo-user',
  host: 'https://api.trae.cn',
  expiresAtMs,
  edition: 'solo',
  source: 'desktop',
}

interface CapturedEntry {
  path: string
  handler: (req: unknown, res: unknown) => Promise<void>
}

/** Mount the routes against a fake web server and keep what was registered. */
async function mount(pool: TraePoolDeps | undefined): Promise<CapturedEntry[]> {
  const captured: CapturedEntry[] = []
  const FakeWebServer = {
    name: 'webServer',
    inject: [] as const,
    apply(ctx: Context) {
      ctx.provide('webServer', {
        register: (entry: CapturedEntry) => {
          captured.push(entry)
          return () => {}
        },
      })
    },
  }
  const ctx = new Context()
  await ctx.plugin(FakeWebServer)
  const client = new TraeUsageClient({ credential: async () => credential, fetchImpl: async () => new Response('{}'), baseUrl: 'https://api.trae.cn' })
  const options: TraeUsageRouteOptions = {
    store: () => ({
      async accounts() { return [{ id: A, accountName: 'demo-user', edition: 'solo', enterprise: false, region: 'cn', source: 'desktop', tokenExpiresAtMs: expiresAtMs, selected: true }] },
      async status() { return { state: 'signed-in', edition: 'solo', expiresAtMs, source: 'desktop' } },
      async resolve() { return credential },
    }) as unknown as ReturnType<TraeUsageRouteOptions['store']>,
    client: () => client,
    displayModels: (_panel: TraePanel) => [],
    enabledModelIds: () => [],
    regionEnabled: () => true,
    rawDiagnostic: () => ({ state: 'protocol-gated', status: 400, checkedAtMs: 1 }),
    ...pool === undefined ? {} : { pool },
  }
  registerTraeUsageRoute(ctx, options)
  await ctx.fiber.dispose()
  return captured
}

/** A recorder that collects both the head and every streamed chunk. */
function recorder(): {
  res: { writeHead: (status: number, headers?: Record<string, string>) => void; write: (chunk: string) => void; end: (payload?: string) => void }
  status: () => number
  headers: () => Record<string, string>
  chunks: () => string[]
  lines: () => unknown[]
} {
  let statusCode = 0
  let headers: Record<string, string> = {}
  const written: string[] = []
  return {
    res: {
      writeHead: (status: number, next?: Record<string, string>) => {
        statusCode = status
        headers = next ?? {}
      },
      write: (chunk: string) => { written.push(chunk) },
      end: (payload?: string) => { if (payload !== undefined) written.push(payload) },
    },
    status: () => statusCode,
    headers: () => headers,
    chunks: () => written,
    lines: () => written.join('').split('\n').filter(line => line !== '').map(line => JSON.parse(line)),
  }
}

function request(url: string, method = 'POST', headers: Record<string, string> = {}): unknown {
  return { method, url, headers }
}

function deps(overrides: Partial<TraePoolDeps> = {}): TraePoolDeps {
  return {
    preferences: () => ({ enabled: true, memberAccountIds: [A, B] }),
    members: async () => [
      { account: { id: A, accountName: 'A' }, credits: { total: 5, expiringSoon: 0 } },
      { account: { id: B, accountName: 'B' }, credits: { total: 9, expiringSoon: 0 } },
    ],
    effectiveMemberAccountIds: async () => [A, B],
    checkinSupported: stored => stored === 'cn',
    ...overrides,
  } as TraePoolDeps
}

async function route(pool: TraePoolDeps | undefined): Promise<CapturedEntry> {
  const captured = await mount(pool)
  const found = captured.find(entry => entry.path === TRAE_POOL_PATH)
  if (found === undefined) throw new Error('pool route was not registered')
  return found
}

describe('the account pool route', () => {
  it('is registered beside the other usage routes', async () => {
    expect((await route(deps())).path).toBe(TRAE_POOL_PATH)
  })

  it('answers 405 to anything but POST, so a link cannot spend credits', async () => {
    const handler = await route(deps())
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'test'), 'GET'), out.res)
    expect(out.status()).toBe(405)
  })

  it('answers 403 to a foreign origin', async () => {
    const handler = await route(deps())
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'test'), 'POST', { origin: 'https://evil.example.com' }), out.res)
    expect(out.status()).toBe(403)
  })

  it('answers 400 when the action is missing or unknown', async () => {
    const handler = await route(deps())
    const missing = recorder()
    await handler.handler(request(`${TRAE_POOL_PATH}?region=cn`), missing.res)
    expect(missing.status()).toBe(400)
    const unknown = recorder()
    await handler.handler(request(`${TRAE_POOL_PATH}?region=cn&action=explode`), unknown.res)
    expect(unknown.status()).toBe(400)
  })

  it('answers 503 when the Host supplied no pool at all', async () => {
    const handler = await route(undefined)
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'test')), out.res)
    expect(out.status()).toBe(503)
  })

  it('refuses a malformed account id with 400 before touching anything', async () => {
    // The id becomes part of a store path, so this is the traversal guard too.
    let tested = 0
    const handler = await route(deps({ test: async () => { tested += 1; return [] } }))
    const out = recorder()
    await handler.handler(request(`${TRAE_POOL_PATH}?region=cn&action=test&accountId=${encodeURIComponent('../../etc/passwd')}`), out.res)
    expect(out.status()).toBe(400)
    expect(tested).toBe(0)
  })

  it('refuses an EMPTY effective pool instead of succeeding over nothing', async () => {
    // The card would read an empty 200 as "all healthy".
    let tested = 0
    const handler = await route(deps({
      preferences: () => ({ enabled: true, memberAccountIds: [A] }),
      effectiveMemberAccountIds: async () => [],
      test: async () => { tested += 1; return [] },
    }))
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'test')), out.res)
    expect(out.status()).toBe(409)
    expect(out.lines()[0]).toMatchObject({ reason: 'no-live-members' })
    expect(tested).toBe(0)
  })

  it('distinguishes a never-filled pool from one whose accounts all vanished', async () => {
    const handler = await route(deps({
      preferences: () => ({ enabled: true, memberAccountIds: [] }),
      effectiveMemberAccountIds: async () => [],
    }))
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'checkin')), out.res)
    expect(out.status()).toBe(409)
    expect(out.lines()[0]).toMatchObject({ reason: 'no-members' })
  })

  it('refuses check-in on a panel that has no daily reward, before spending a request', async () => {
    let checked = 0
    const handler = await route(deps({
      checkin: async () => { checked += 1; return [] },
    }))
    const out = recorder()
    await handler.handler(request(withTraePoolAction('ai', 'checkin')), out.res)
    expect(out.status()).toBe(409)
    expect(out.lines()[0]).toMatchObject({ reason: 'checkin-unsupported' })
    expect(checked).toBe(0)
  })

  it('streams one NDJSON line per tested account, then the summary', async () => {
    const rows: TraePoolTestRow[] = [
      { accountId: A, accountName: 'A', modelId: 'free', outcome: 'available', detail: 'ok' },
      { accountId: B, accountName: 'B', modelId: 'free', outcome: 'rate_limited', detail: 'slow down' },
    ]
    const handler = await route(deps({
      async test(_panel, _modelId, onRow) {
        for (const row of rows) onRow?.(row)
        return rows
      },
    }))
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'test')), out.res)
    expect(out.status()).toBe(200)
    expect(out.headers()['Content-Type']).toBe('application/x-ndjson')
    const lines = out.lines()
    // Two streamed rows plus the trailing summary: a client that reads only the
    // last line still gets the whole answer.
    expect(lines).toHaveLength(3)
    // The row is projected onto the pool vocabulary on the way out.
    expect(lines[0]).toMatchObject({ row: { accountId: A, outcome: 'ok' } })
    expect(lines[2]).toMatchObject({ rows: [{ accountId: A }, { accountId: B }] })
  })

  it('reports a failed batch as a streamed reason rather than a broken response', async () => {
    const handler = await route(deps({
      test: async () => { throw new Error('upstream went away') },
    }))
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'test')), out.res)
    expect(out.lines().at(-1)).toMatchObject({ reason: 'pool-failed' })
  })

  it('answers a check-in batch as JSON', async () => {
    const rows: TraePoolCheckinRow[] = [{ accountId: A, accountName: 'A', status: 'claimed', credit: 100 }]
    const handler = await route(deps({ checkin: async () => rows }))
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'checkin')), out.res)
    expect(out.status()).toBe(200)
    expect(out.lines()[0]).toMatchObject({ rows: [{ accountId: A, status: 'claimed', credit: 100 }] })
  })

  it('removes one account and reports whether anything was removed', async () => {
    const handler = await route(deps({ removeOne: async (_panel, id) => id === A }))
    const out = recorder()
    await handler.handler(request(`${TRAE_POOL_PATH}?region=cn&action=remove&accountId=${A}`), out.res)
    expect(out.status()).toBe(200)
    expect(out.lines()[0]).toMatchObject({ accountId: A, removed: true })
  })

  it('refuses a removal without an account id', async () => {
    const handler = await route(deps({ removeOne: async () => true }))
    const out = recorder()
    await handler.handler(request(withTraePoolAction('cn', 'remove')), out.res)
    expect(out.status()).toBe(400)
  })
})
