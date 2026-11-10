import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TraeCredentialStore, type TraeCredential, type TraeRefreshOutcome } from '../src/auth.ts'
import { TraeCatalog } from '../src/catalog.ts'
import { createTraeShim, type TraeShim, type TraeShimPool } from '../src/shim.ts'
import { bridgeTraeSoloStreamOrFail } from '../src/solo-bridge.ts'
import type { TraeChatResult, TraeUpstreamClient } from '../src/upstream.ts'

/**
 * The runtime half of the account pool (issue #44): who bills the next request,
 * and what happens when that account cannot serve it.
 *
 * Both rules are invisible in the card until they are wrong — a rotation that
 * silently rewrote the binding, or a failover that replayed a bad model id on a
 * second account — so they are asserted at the seam (the credential store and
 * the shim) rather than through the UI.
 */

const cleanupDirs: string[] = []
const cleanupShims: TraeShim[] = []
afterEach(async () => {
  await Promise.all(cleanupShims.splice(0).map(shim => shim.close()))
  await Promise.all(cleanupDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'trae-pool-rotate-'))
  cleanupDirs.push(dir)
  return dir
}

/** A plugin-owned credential file holding two CN logins, in the version-2 layout. */
function ownDocument(entries: readonly { userId: string; token: string }[]): string {
  return JSON.stringify({
    version: 2,
    credentials: entries.map(entry => ({
      accessToken: entry.token,
      refreshToken: `rt-${entry.userId}`,
      userId: entry.userId,
      accountName: entry.userId,
      edition: 'cn',
      host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 3_600_000,
    })),
  })
}

/**
 * A store over two logins, optionally bound to one of them.
 *
 * The binding is what a settings save writes; the rotation is what the pool
 * decides per request. Every test here keeps them distinguishable.
 */
async function twoAccountStore(options: {
  bind?: 'alpha' | 'beta'
  requireTenant?: boolean
  expiredTokens?: readonly string[]
  refresh?: (credential: TraeCredential) => Promise<TraeRefreshOutcome>
}): Promise<{
  store: TraeCredentialStore
  idOf: (name: 'alpha' | 'beta') => string
}> {
  const dir = await temp()
  const own = join(dir, 'own.json')
  const expired = new Set(options.expiredTokens ?? [])
  const document = JSON.parse(ownDocument([{ userId: 'alpha', token: 'ta' }, { userId: 'beta', token: 'tb' }])) as {
    version: number
    credentials: Record<string, unknown>[]
  }
  for (const credential of document.credentials) {
    if (expired.has(String(credential['accountName']))) credential['expiresAtMs'] = Date.now() - 1_000
  }
  await writeFile(own, JSON.stringify(document))
  const discovery: TraeCredentialStore = new TraeCredentialStore({
    edition: 'cn',
    ownPath: own,
    storagePath: join(dir, 'none.json'),
    ...options.requireTenant === true ? { requireTenant: true } : {},
    refresh: async credential => {
      throw new Error(`unexpected refresh for ${credential.accountName}`)
    },
  })
  const listed = await discovery.accounts()
  const idOf = (name: 'alpha' | 'beta'): string => {
    const found = listed.find(account => account.accountName === name)
    if (found === undefined) throw new Error(`no account ${name} in the fixture`)
    return found.id
  }
  const store = new TraeCredentialStore({
    edition: 'cn',
    ownPath: own,
    storagePath: join(dir, 'none.json'),
    ...options.bind === undefined ? {} : { accountId: idOf(options.bind) },
    ...options.requireTenant === true ? { requireTenant: true } : {},
    refresh: options.refresh ?? (async credential => {
      throw new Error(`unexpected refresh for ${credential.accountName}`)
    }),
  })
  return { store, idOf }
}

describe('pool rotation in the credential store', () => {
  it('bills the rotated account while the saved binding stays untouched', async () => {
    const { store, idOf } = await twoAccountStore({ bind: 'alpha' })
    expect((await store.resolve()).accessToken).toBe('ta')

    store.setRotatedAccount(idOf('beta'))

    expect(store.rotatedAccount()).toBe(idOf('beta'))
    expect((await store.resolve()).accessToken).toBe('tb')
    // The card's account table reports the BINDING as selected: a rotation must
    // never look like a switch the user made.
    const listed = await store.accounts()
    expect(listed.filter(account => account.selected).map(account => account.accountName)).toEqual(['alpha'])
  })

  it('restores the binding the moment the rotation is cleared', async () => {
    const { store, idOf } = await twoAccountStore({ bind: 'alpha' })
    store.setRotatedAccount(idOf('beta'))
    expect((await store.resolve()).accessToken).toBe('tb')

    store.setRotatedAccount(undefined)

    expect(store.rotatedAccount()).toBeUndefined()
    expect((await store.resolve()).accessToken).toBe('ta')
  })

  it('ignores a rotation to an account this machine no longer has', async () => {
    const { store } = await twoAccountStore({ bind: 'alpha' })
    store.setRotatedAccount('0123456789abcdef01234567')
    expect((await store.resolve()).accessToken).toBe('ta')
  })

  it('rotates even when no account is bound, so the pool outranks the default pick', async () => {
    const { store, idOf } = await twoAccountStore({})
    const automatic = await store.resolve()
    const target = automatic.accountName === 'alpha' ? 'beta' : 'alpha'
    store.setRotatedAccount(idOf(target))
    expect((await store.resolve()).accountName).toBe(target)
  })

  it('refreshes the ROTATED account rather than the one that was being resolved before', async () => {
    const dir = await temp()
    const own = join(dir, 'own.json')
    await writeFile(own, ownDocument([{ userId: 'alpha', token: 'ta' }, { userId: 'beta', token: 'tb' }]))
    const discovery = new TraeCredentialStore({ edition: 'cn', ownPath: own, storagePath: join(dir, 'none.json'), refresh: async () => { throw new Error('unused') } })
    const listed = await discovery.accounts()
    const betaId = listed.find(account => account.accountName === 'beta')?.id
    expect(betaId).toBeDefined()
    const rotatedTo = betaId as string
    // Only beta's token is stale, and the refresh answers with beta's own token:
    // a rotation that inherited alpha's in-flight refresh would hand alpha back.
    const document = JSON.parse(ownDocument([{ userId: 'alpha', token: 'ta' }, { userId: 'beta', token: 'tb' }])) as {
      credentials: Record<string, unknown>[]
    }
    for (const credential of document.credentials) {
      if (credential['accountName'] === 'beta') credential['expiresAtMs'] = Date.now() - 1_000
    }
    await writeFile(own, JSON.stringify(document))
    const refreshes: string[] = []
    const store = new TraeCredentialStore({
      edition: 'cn',
      ownPath: own,
      storagePath: join(dir, 'none.json'),
      ...(listed.find(account => account.accountName === 'alpha')?.id === undefined ? {} : { accountId: listed.find(account => account.accountName === 'alpha')?.id as string }),
      refresh: async credential => {
        refreshes.push(credential.accountName ?? '')
        return { accessToken: `${credential.accessToken}-fresh`, refreshToken: 'rt2', expiresAtMs: Date.now() + 3_600_000 }
      },
    })
    store.setRotatedAccount(rotatedTo)
    const resolved = await store.resolve()
    expect(refreshes).toEqual(['beta'])
    expect(resolved.accessToken).toBe('tb-fresh')
  })

  it('refuses a personal account on a tenant-scoped store', async () => {
    const { store, idOf } = await twoAccountStore({ requireTenant: true })
    store.setRotatedAccount(idOf('alpha'))
    // A tenant store may not bill through a personal login, and the pool must not
    // be able to smuggle one in: the request falls back to the store's own rule.
    expect(await store.current()).toBeUndefined()
  })
})

/** A fresh success answer: a Response body can only be read once, so one instance per use. */
const ok = (): TraeChatResult => ({ ok: true, response: new Response('data: ok\n\n', { headers: { 'content-type': 'text/event-stream' } }) })
const rateLimited = (message = 'slow down'): TraeChatResult => ({ ok: false, status: 429, kind: 'soft_rate', message })

/** A client that answers from a script and counts how often it was asked. */
function scriptedClient(results: readonly TraeChatResult[]): { client: TraeUpstreamClient; state: { calls: number } } {
  const state = { calls: 0 }
  return {
    state,
    client: {
      chatStream: async () => {
        const result = results[Math.min(state.calls, results.length - 1)]
        state.calls += 1
        if (result === undefined) throw new Error('scripted client ran out of results')
        return result
      },
    },
  }
}

/** A pool that records every hook it was asked for. */
function recordingPool(overrides: Partial<TraeShimPool> = {}): { pool: TraeShimPool; log: string[] } {
  const log: string[] = []
  const pool: TraeShimPool = {
    prepare: async () => {
      log.push('prepare')
      return 'account-a'
    },
    next: async tried => {
      log.push(`next:${tried.join(',')}`)
      return undefined
    },
    failed: async (accountId, kind) => {
      log.push(`failed:${accountId}:${kind}`)
    },
    shortfall: async tried => {
      log.push(`shortfall:${tried.join(',')}`)
      return undefined
    },
    ...overrides,
  }
  return { pool, log }
}

async function startShim(client: TraeUpstreamClient, pool?: TraeShimPool): Promise<TraeShim> {
  const shim = createTraeShim({
    catalog: new TraeCatalog(),
    routes: [{ label: 'solo', client, ...pool === undefined ? {} : { pool } }],
  })
  await shim.ready
  cleanupShims.push(shim)
  return shim
}

function chat(shim: TraeShim): Promise<{ status: number; body: string }> {
  const url = new URL('/v1/chat/completions', shim.baseUrl())
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: Number(url.port),
      method: 'POST',
      path: url.pathname,
      headers: {
        host: `127.0.0.1:${url.port}`,
        authorization: `Bearer ${shim.tokenOf('solo')}`,
        'content-type': 'application/json',
      },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }))
  })
}

describe('shim failover across pooled accounts', () => {
  for (const [code, kind] of [[4008, 'hard_credit'], [4017, 'soft_rate']] as const) {
    it(`fails over an actual SOLO error event ${code} to the next pooled account`, async () => {
      const error = new Response(`event: error\ndata: ${JSON.stringify({ code, message: 'synthetic account refusal' })}\n\n`)
      const result = await bridgeTraeSoloStreamOrFail(error, 'glm-5.2')
      expect(result).toMatchObject({ ok: false, kind })
      const first = scriptedClient([result])
      const second = scriptedClient([ok()])
      const { pool, log } = recordingPool({ next: async tried => {
        log.push(`next:${tried.join(',')}`)
        return { accountId: 'account-b', client: second.client }
      } })
      const shim = await startShim(first.client, pool)
      const response = await chat(shim)
      expect(response.status).toBe(200)
      expect(response.body).toContain('ok')
      expect(first.state.calls).toBe(1)
      expect(second.state.calls).toBe(1)
      expect(log).toEqual(['prepare', `failed:account-a:${kind}`, 'next:account-a'])
    })
  }

  it('serves the first attempt and never asks for a failover', async () => {
    const route = scriptedClient([ok()])
    const { pool, log } = recordingPool()
    const shim = await startShim(route.client, pool)

    const response = await chat(shim)

    expect(response.status).toBe(200)
    expect(response.body).toContain('ok')
    expect(route.state.calls).toBe(1)
    expect(log).toEqual(['prepare'])
  })

  it('fails over on a rate limit and records it against the account that hit it', async () => {
    const first = scriptedClient([rateLimited()])
    const second = scriptedClient([ok()])
    const { pool, log } = recordingPool({ next: async tried => { log.push(`next:${tried.join(',')}`); return { accountId: 'account-b', client: second.client } } })
    const shim = await startShim(first.client, pool)

    const response = await chat(shim)

    expect(response.status).toBe(200)
    expect(response.body).toContain('ok')
    expect(first.state.calls).toBe(1)
    expect(second.state.calls).toBe(1)
    expect(log).toEqual(['prepare', 'failed:account-a:soft_rate', 'next:account-a'])
  })

  it('does not fail over a client error: a bad request is not an account problem', async () => {
    const route = scriptedClient([{ ok: false, status: 400, kind: 'client', message: 'bad model id' }])
    const { pool, log } = recordingPool()
    const shim = await startShim(route.client, pool)

    const response = await chat(shim)

    expect(response.status).toBe(400)
    expect(route.state.calls).toBe(1)
    // Neither a probe nor a failover: nothing here says the account cannot serve.
    expect(log).toEqual(['prepare'])
    expect(response.body).toContain('bad model id')
  })

  it('gives up after three attempts and reports why nothing else could serve', async () => {
    let handed = 0
    const { pool, log } = recordingPool({
      next: async tried => {
        log.push(`next:${tried.join(',')}`)
        handed += 1
        return { accountId: `account-${handed}`, client: scriptedClient([rateLimited()]).client }
      },
      shortfall: async () => {
        log.push('shortfall')
        return 'every remaining pooled account is excluded (rate-limited)'
      },
    })
    const shim = await startShim(scriptedClient([rateLimited()]).client, pool)

    const response = await chat(shim)

    expect(response.status).toBe(429)
    expect(handed).toBe(2)
    expect(response.body).toContain('every remaining pooled account is excluded (rate-limited)')
    expect(log.filter(entry => entry === 'shortfall')).toHaveLength(1)
  })

  it('still answers when the pool itself throws', async () => {
    const route = scriptedClient([ok()])
    const { pool } = recordingPool({
      prepare: async () => { throw new Error('ranking exploded') },
      next: async () => { throw new Error('ranking exploded') },
      failed: async () => { throw new Error('store unwritable') },
    })
    const shim = await startShim(route.client, pool)

    const response = await chat(shim)

    // A pool is an optimisation, never a dependency: the bound account still serves.
    expect(response.status).toBe(200)
    expect(route.state.calls).toBe(1)
  })

  it('keeps the pre-pool behaviour when a route has no pool at all', async () => {
    const route = scriptedClient([rateLimited('no credit left')])
    const shim = await startShim(route.client)

    const response = await chat(shim)

    expect(response.status).toBe(429)
    expect(route.state.calls).toBe(1)
    expect(response.body).toContain('no credit left')
  })
})

/**
 * Reading a POOLED account that the user did not bind.
 *
 * The card reads every member's balance, and a member's access token lapses
 * within days while its refresh token lives for months. `credentialOf` returns
 * that lapsed token as-is, which is right for a chat request but wrong for a
 * balance read: it turned a recoverable account into a bare dash.
 */
describe('per-account credential refresh', () => {
  it('refreshes a lapsed, unbound account and leaves the binding alone', async () => {
    const refreshed: string[] = []
    const { store, idOf } = await twoAccountStore({
      bind: 'alpha',
      expiredTokens: ['beta'],
      refresh: async credential => {
        refreshed.push(credential.accountName ?? '')
        return { accessToken: 'tb-fresh', expiresAtMs: Date.now() + 3_600_000 }
      },
    })

    const credential = await store.resolveCredentialOf(idOf('beta'))

    expect(credential?.accessToken).toBe('tb-fresh')
    expect(refreshed).toEqual(['beta'])
    // The read must not decide who bills: alpha is still bound, and no rotation
    // was invented just because beta was refreshed.
    expect((await store.resolve()).accessToken).toBe('ta')
    expect(store.rotatedAccount()).toBeUndefined()
    expect((await store.accounts()).find(account => account.accountName === 'alpha')?.selected).toBe(true)
  })

  it('returns a fresh credential untouched, without spending a refresh', async () => {
    let refreshes = 0
    const { store, idOf } = await twoAccountStore({
      bind: 'alpha',
      refresh: async () => {
        refreshes += 1
        return { accessToken: 'unused', expiresAtMs: Date.now() + 3_600_000 }
      },
    })

    expect((await store.resolveCredentialOf(idOf('beta')))?.accessToken).toBe('tb')
    expect(refreshes).toBe(0)
  })

  it('single-flights the refresh of one account', async () => {
    let refreshes = 0
    const { store, idOf } = await twoAccountStore({
      expiredTokens: ['beta'],
      refresh: async () => {
        refreshes += 1
        await new Promise(resolve => setTimeout(resolve, 10))
        return { accessToken: 'tb-fresh', expiresAtMs: Date.now() + 3_600_000 }
      },
    })

    const [first, second] = await Promise.all([
      store.resolveCredentialOf(idOf('beta')),
      store.resolveCredentialOf(idOf('beta')),
    ])

    expect(first?.accessToken).toBe('tb-fresh')
    expect(second?.accessToken).toBe('tb-fresh')
    expect(refreshes).toBe(1)
  })

  it('hands back the stored credential when the refresh fails', async () => {
    const { store, idOf } = await twoAccountStore({
      expiredTokens: ['beta'],
      refresh: async () => { throw new Error('exchange rejected') },
    })

    // Not a throw: the caller then reports the 401 it actually hit instead of
    // claiming the account does not exist.
    const credential = await store.resolveCredentialOf(idOf('beta'))
    expect(credential?.accessToken).toBe('tb')
  })

  it('stops retrying a refresh it already saw fail', async () => {
    // The card reads every member's balance on each poll; a revoked refresh token
    // fails forever, so an unmemoised retry would spend two upstream calls per
    // account per poll on something no retry can fix.
    let refreshes = 0
    const { store, idOf } = await twoAccountStore({
      expiredTokens: ['beta'],
      refresh: async () => {
        refreshes += 1
        throw new Error('exchange rejected')
      },
    })

    const first = await store.resolveCredentialOf(idOf('beta'))
    const second = await store.resolveCredentialOf(idOf('beta'))

    expect(first?.accessToken).toBe('tb')
    expect(second?.accessToken).toBe('tb')
    expect(refreshes).toBe(1)
    // Still a lookup, not a refusal: the row keeps rendering with its lapsed token.
    expect((await store.accounts()).find(account => account.accountName === 'beta')).toBeDefined()
  })

  it('does not invent an account for an unknown id', async () => {
    const { store } = await twoAccountStore({})
    expect(await store.resolveCredentialOf('000000000000000000000000')).toBeUndefined()
  })
})
