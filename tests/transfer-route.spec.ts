import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TRAE_TRANSFER_PATH } from '../src/status-paths.ts'
import type { TraeUsageRouteOptions } from '../src/web-status.ts'
import type { TraeCredential } from '../src/auth.ts'
import type { TraeRegion } from '../src/region.ts'

/**
 * The transfer route (issue #37): a request-driven body reader over an
 * async-iterable, a fake store, and a recorder response.
 *
 * The properties worth pinning at THIS level rather than in transfer.spec.ts:
 *  - a spoofed region is refused at the HTTP boundary, so the security gate
 *    holds even for a hand-crafted request that never went through the card;
 *  - `import` re-parses the FILE rather than trusting the preview, so a tampered
 *    browser cannot import a record the preview never showed;
 *  - `export` returns records for the requested accounts only, and the route
 *    never hands a token to the browser outside the export of an explicitly
 *    selected account.
 */

/** A request whose body is the JSON of `value`, as node's IncomingMessage streams it. */
function request(method: string, url: string, value?: unknown): {
  method: string
  url: string
  headers: Record<string, string>
  [Symbol.asyncIterator]: () => AsyncIterator<Buffer>
} {
  const chunks = value === undefined ? [] : [Buffer.from(JSON.stringify(value), 'utf8')]
  let index = 0
  return {
    method,
    url,
    headers: {},
    [Symbol.asyncIterator]: (): AsyncIterator<Buffer> => ({
      async next(): Promise<IteratorResult<Buffer>> {
        return index < chunks.length ? { done: false, value: chunks[index++] as Buffer } : { done: true, value: undefined }
      },
    }),
  }
}

/** Response recorder: json() only needs writeHead + end. */
function response(): {
  res: { writeHead: (status: number, headers?: Record<string, string>) => void, end: (payload?: string) => void }
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

const cnCredential = (over: Partial<TraeCredential> = {}): TraeCredential => ({
  accessToken: 'tok-cn', refreshToken: 'rt-cn', userId: 'user-1', accountName: 'demo-user',
  host: 'https://api.trae.cn', userRegion: 'CN', expiresAtMs: 1_893_456_000_000,
  edition: 'cn', source: 'dsh', ...over,
})

/** A stored-credential record shaped like an export from a sibling tool. */
const record = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  access_token: 'imported-tok',
  refresh_token: 'imported-rt',
  uid: 'user-9',
  nickname: 'Imported',
  domain: 'https://api.trae.cn',
  expiresAt: 1_893_456_000_000,
  ...over,
})

interface Harness {
  handler: (req: unknown, res: unknown) => Promise<void>
  imported: Omit<TraeCredential, 'source'>[][]
}

async function mount(credentials: TraeCredential[] = [cnCredential()], copies: TraeCredential[] = credentials): Promise<Harness> {
  const imported: Omit<TraeCredential, 'source'>[][] = []
  const store = {
    async accounts() {
      return credentials.map(credential => ({
        id: credential.userId, accountName: credential.accountName ?? '', edition: credential.edition,
        region: 'cn' as TraeRegion, source: credential.source, tokenExpiresAtMs: credential.expiresAtMs, selected: true,
      }))
    },
    async credentialOf(id: string) { return credentials.find(credential => credential.userId === id) },
    // The merged view (`credentialOf`) and the plugin's own copies differ in
    // exactly one way that matters here: an export must carry the COPY.
    async copyOf(id: string) { return copies.find(credential => credential.userId === id) },
    async importAccounts(values: Omit<TraeCredential, 'source'>[]) { imported.push([...values]); return values.map(value => value.userId) },
  }
  const deps = {
    store: () => store,
    client: () => ({ snapshot: async () => ({ workAvailable: 0, generalAvailable: 0 }) }),
    displayModels: () => [],
    enabledModelIds: () => [],
    regionEnabled: () => true,
  } as unknown as TraeUsageRouteOptions

  let captured: { path: string, handler: (req: unknown, res: unknown) => Promise<void> } | undefined
  const FakeWebServer = {
    name: 'webServer',
    inject: [] as const,
    apply(ctx: Context) {
      ctx.provide('webServer', {
        register: (entry: { path: string, handler: (req: unknown, res: unknown) => Promise<void> }) => {
          if (entry.path === TRAE_TRANSFER_PATH) captured = entry
          return () => {}
        },
      })
    },
  }
  const ctx = new Context()
  await ctx.plugin(FakeWebServer)
  const { registerTraeUsageRoute } = await import('../src/web-status.ts')
  registerTraeUsageRoute(ctx, deps)
  await ctx.fiber.dispose()
  if (captured === undefined) throw new Error('transfer route was not registered')
  return { handler: captured.handler, imported }
}

describe('transfer route', () => {
  it('previews an uploaded file without ever returning a token', async () => {
    const { handler } = await mount()
    const { res, status, body } = response()
    await handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=preview`, { text: JSON.stringify([record()]) }), res)
    expect(status()).toBe(200)
    expect(body()).toMatchObject({ total: 1, accounts: [{ index: 0, uid: 'user-9', nickname: 'Imported', hasToken: true }] })
    // The token must not reach the browser in ANY form.
    expect(JSON.stringify(body())).not.toContain('imported-tok')
  })

  it('imports a positively-identified cn record and reports the count', async () => {
    const harness = await mount()
    const { res, status, body } = response()
    await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=import`, { text: JSON.stringify([record()]), indexes: [0] }), res)
    expect(status()).toBe(200)
    expect(body()).toMatchObject({ imported: 1, skipped: 0 })
    expect(harness.imported).toHaveLength(1)
    expect(harness.imported[0]?.[0]?.edition).toBe('cn')
  })

  it('refuses a spoofed region at the HTTP boundary instead of importing it into cn', async () => {
    // The whole point of the positive-match gate: a hand-crafted request that
    // never went through the card must not smuggle a foreign credential in.
    const harness = await mount()
    for (const domain of ['https://trae.cn.evil.com', 'evil.com', '']) {
      const { res, status, body } = response()
      await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=import`, {
        text: JSON.stringify([record({ domain })]), indexes: [0],
      }), res)
      expect(status()).toBe(200)
      expect(body()).toMatchObject({ imported: 0, skipped: 1 })
    }
    expect(harness.imported).toHaveLength(0)
  })

  it('skips a record belonging to the other region', async () => {
    const harness = await mount()
    const { res, status, body } = response()
    await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=import`, {
      text: JSON.stringify([record({ domain: 'https://growsg-normal.trae.ai' })]), indexes: [0],
    }), res)
    expect(status()).toBe(200)
    expect(body()).toMatchObject({ imported: 0, skipped: 1 })
    expect(harness.imported).toHaveLength(0)
  })

  it('re-parses the file on import rather than trusting a previewed index', async () => {
    // index 1 is a record the preview never showed (the card only sends indexes
    // it did), but a tampered client could. The route re-parses and re-gates the
    // FILE, so the outcome is decided by the file, not by the claimed index.
    const harness = await mount()
    const { res, status, body } = response()
    await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=import`, {
      text: JSON.stringify([record(), record({ access_token: '' })]), indexes: [0, 1],
    }), res)
    expect(status()).toBe(200)
    expect(body()).toMatchObject({ imported: 1, skipped: 1 })
  })

  it('exports only the selected accounts, in the transfer file format', async () => {
    const harness = await mount([cnCredential(), cnCredential({ userId: 'user-2', accountName: 'Other', edition: 'sg', host: 'https://api.trae.ai' })])
    const { res, status, body } = response()
    await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=export`, { accountIds: ['user-1'] }), res)
    expect(status()).toBe(200)
    const payload = body() as { accounts: Record<string, unknown>[] }
    expect(payload.accounts).toHaveLength(1)
    expect(payload.accounts[0]?.['uid']).toBe('user-1')
    // Milliseconds, per the sibling contract (no rescale).
    expect(payload.accounts[0]?.['expiresAt']).toBe(1_893_456_000_000)
  })

  it("exports the plugin's own copy, not the merged view", async () => {
    // `credentialOf` answers from the merged view (copies + the app's logins,
    // whichever is fresher). The export route must not use it: what leaves the
    // machine is the copy this plugin owns. Here the two disagree on the token,
    // so the exported value names which one the route read.
    const harness = await mount(
      [cnCredential({ accessToken: 'tok-merged' })],
      [cnCredential({ accessToken: 'tok-copy' })],
    )
    const { res, status, body } = response()
    await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=export`, { accountIds: ['user-1'] }), res)
    expect(status()).toBe(200)
    const payload = body() as { accounts: Record<string, unknown>[] }
    expect(payload.accounts).toHaveLength(1)
    expect(payload.accounts[0]?.['access_token']).toBe('tok-copy')
  })

  it('skips an account that has no copy to export', async () => {
    const harness = await mount([cnCredential()], [])
    const { res, status, body } = response()
    await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=export`, { accountIds: ['user-1'] }), res)
    expect(status()).toBe(200)
    expect((body() as { accounts: unknown[] }).accounts).toHaveLength(0)
  })

  it('refuses an unknown action, a non-POST, and a non-loopback origin', async () => {
    const { handler } = await mount()
    const unknown = response()
    await handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=nope`, {}), unknown.res)
    expect(unknown.status()).toBe(400)

    const wrongMethod = response()
    await handler(request('GET', `${TRAE_TRANSFER_PATH}?region=cn&action=export`), wrongMethod.res)
    expect(wrongMethod.status()).toBe(405)

    const foreign = response()
    await handler({ method: 'POST', url: `${TRAE_TRANSFER_PATH}?region=cn&action=export`, headers: { origin: 'https://example.com' }, [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }, foreign.res)
    expect(foreign.status()).toBe(403)
  })

  it('reports a malformed file as 400 rather than a 500', async () => {
    const harness = await mount()
    const { res, status, body } = response()
    await harness.handler(request('POST', `${TRAE_TRANSFER_PATH}?region=cn&action=import`, { text: 'not json', indexes: [0] }), res)
    expect(status()).toBe(400)
    expect(JSON.stringify(body())).toContain('not valid JSON')
    expect(harness.imported).toHaveLength(0)
  })
})
