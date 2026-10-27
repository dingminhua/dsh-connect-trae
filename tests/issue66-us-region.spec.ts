/**
 * Issue #66: a US-region Trae credential must never be treated as a Singapore
 * one.
 *
 * HOW THIS WAS BROKEN. `regionOfUserRegion` knew only `CN`/`SG` and
 * `regionOfHost` knew only `.trae.ai`/`.trae.cn`, so an international install
 * signed in to the US cluster (`userRegion: "US"`,
 * `host: https://grow-normal.traeapi.us`) fell through BOTH levels and was
 * classified by its edition label — `sg` → `ai`. Every read then went to
 * `*.trae.ai`, which answers a US token with 401, and the model-refresh route
 * wrapped that 401 into HTTP 500.
 *
 * WHAT IS PINNED HERE:
 *  1. the US claim and the `traeapi.us` host resolve to `us`, not `ai`;
 *  2. `us` is not a routing bucket: `assertSupportedRegion` refuses it BEFORE
 *     any gateway is chosen, and no client issues a request with it;
 *  3. the credential store neither selects nor bills such a credential, but
 *     CAN name it, so a signed-out panel is explainable;
 *  4. an upstream 401/403 crosses the HTTP boundary with its own status, and
 *     the local "unsupported region" verdict is 501 + `unsupported-region`,
 *     never a generic 500.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TraeCredentialStore } from '../src/auth.ts'
import type { TraeCredential } from '../src/auth.ts'
import { httpFailureOf, TraeHttpError } from '../src/failure.ts'
import type { TraeIdentity } from '../src/identity.ts'
import {
  assertSupportedRegion,
  regionOfCredential,
  regionOfHost,
  regionOfUserRegion,
  REGION_GATEWAYS,
  TraeUnsupportedRegionError,
  TRAE_UNSUPPORTED_REGION_CODE,
} from '../src/region.ts'
import { TraeRawChatUpstreamClient } from '../src/raw-upstream.ts'
import { TraeSoloRemoteCatalogClient } from '../src/solo-remote.ts'
import { TraeSoloUpstreamClient } from '../src/solo.ts'
import { TraeUsageClient } from '../src/usage.ts'
import type { TraeUsageRouteOptions } from '../src/web-status.ts'
import { traeWebUsage } from '../src/web-status.ts'
import { TRAE_MODELS_REFRESH_PATH } from '../src/status-paths.ts'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

/** The reporter's credential, verbatim in shape (issue #66). */
const usCredential = (over: Partial<TraeCredential> = {}): TraeCredential => ({
  accessToken: 'us-access-token',
  refreshToken: 'us-refresh-token',
  userId: 'us-user',
  accountName: 'US User',
  host: 'https://grow-normal.traeapi.us',
  userRegion: 'US',
  expiresAtMs: 1_893_456_000_000,
  edition: 'sg',
  source: 'desktop',
  ...over,
})

const identity: TraeIdentity = { edition: 'sg', machineId: 'machine', deviceId: 'device', platform: 'darwin' }

/** A fetch that records whether it was ever reached. */
function countingFetch(): { calls: () => number, fetchImpl: typeof fetch } {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { calls: () => calls, fetchImpl }
}

describe('US region resolution (issue #66)', () => {
  it('recognizes the US claim, in both the object and the bare-string shape', () => {
    expect(regionOfUserRegion('US')).toBe('us')
    expect(regionOfUserRegion(' us ')).toBe('us')
    expect(regionOfUserRegion({ region: 'US', _aiRegion: 'US' })).toBe('us')
  })

  it('recognizes the traeapi.us host suffix instead of ignoring it', () => {
    expect(regionOfHost('https://grow-normal.traeapi.us')).toBe('us')
    expect(regionOfHost('core-normal.traeapi.us')).toBe('us')
    expect(regionOfHost('https://icube-normal.traeapi.us/')).toBe('us')
    // The SG and CN verdicts are untouched.
    expect(regionOfHost('https://coresg-normal.trae.ai')).toBe('ai')
    expect(regionOfHost('https://api.trae.cn')).toBe('cn')
  })

  it('does not round the US credential down to ai through the edition label', () => {
    // The bug, exactly: every level above `regionOfEdition` used to miss, so
    // the `sg` edition decided the routing bucket.
    expect(regionOfCredential({ edition: 'sg', host: 'https://grow-normal.traeapi.us', userRegion: 'US' })).toBe('us')
    // Either claim alone is enough.
    expect(regionOfCredential({ edition: 'sg', host: 'https://grow-normal.traeapi.us' })).toBe('us')
    expect(regionOfCredential({ edition: 'sg', userRegion: 'US' })).toBe('us')
    // SG itself still resolves to the international bucket.
    expect(regionOfCredential({ edition: 'sg', host: 'https://growsg-normal.trae.ai', userRegion: 'SG' })).toBe('ai')
  })

  it('refuses us before any gateway lookup, and has no gateway entry for it', () => {
    expect(() => assertSupportedRegion('us')).toThrow(TraeUnsupportedRegionError)
    try {
      assertSupportedRegion('us')
    } catch (error) {
      expect(error).toBeInstanceOf(TraeUnsupportedRegionError)
      expect((error as TraeUnsupportedRegionError).code).toBe(TRAE_UNSUPPORTED_REGION_CODE)
      expect((error as Error).message).toMatch(/United States/)
    }
    // Two buckets only: indexing this map with `us` is precisely what produced
    // the wrong gateway.
    expect(Object.keys(REGION_GATEWAYS)).toEqual(['cn', 'ai'])
    expect(assertSupportedRegion('cn')).toBe('cn')
    expect(assertSupportedRegion('ai')).toBe('ai')
  })
})

describe('a US credential never reaches a gateway', () => {
  it('usage: payStatus refuses locally with zero fetch calls', async () => {
    const { calls, fetchImpl } = countingFetch()
    const client = new TraeUsageClient({ credential: async () => usCredential(), fetchImpl })
    await expect(client.payStatus()).rejects.toBeInstanceOf(TraeUnsupportedRegionError)
    expect(calls()).toBe(0)
  })

  it('directory: fetchModels refuses locally with zero fetch calls', async () => {
    const { calls, fetchImpl } = countingFetch()
    const catalog = new TraeSoloRemoteCatalogClient({ credential: async () => usCredential(), fetchImpl })
    await expect(catalog.fetchModels()).rejects.toBeInstanceOf(TraeUnsupportedRegionError)
    expect(calls()).toBe(0)
  })

  it('wire roster: fetchModels refuses locally with zero fetch calls', async () => {
    const { calls, fetchImpl } = countingFetch()
    const solo = new TraeSoloUpstreamClient({ credential: async () => usCredential(), identity: async () => identity, fetchImpl })
    await expect(solo.fetchModels()).rejects.toBeInstanceOf(TraeUnsupportedRegionError)
    expect(calls()).toBe(0)
  })

  it('directory: still refuses when a test/diagnostic base URL is injected', async () => {
    // `baseUrl` pins the endpoint, so a guard placed AFTER it is chosen would
    // be bypassed. The check runs first on purpose.
    const { calls, fetchImpl } = countingFetch()
    const catalog = new TraeSoloRemoteCatalogClient({ credential: async () => usCredential(), fetchImpl, baseUrl: 'https://example.test/api/remote/v1' })
    await expect(catalog.fetchModels()).rejects.toBeInstanceOf(TraeUnsupportedRegionError)
    expect(calls()).toBe(0)
  })

  it('chat: answers the explicit verdict instead of posting', async () => {
    const { calls, fetchImpl } = countingFetch()
    const solo = new TraeSoloUpstreamClient({ credential: async () => usCredential(), identity: async () => identity, fetchImpl })
    const result = await solo.chatStream(JSON.stringify({ model: 'gpt-5.5', messages: [{ role: 'user', content: 'hi' }] }))
    expect(result).toMatchObject({ ok: false, kind: 'unconfigured' })
    if (!result.ok) expect(result.message).toMatch(/United States/)
    expect(calls()).toBe(0)
  })

  it('chat: still refuses when a test/diagnostic base URL is injected', async () => {
    const { calls, fetchImpl } = countingFetch()
    const solo = new TraeSoloUpstreamClient({ credential: async () => usCredential(), identity: async () => identity, fetchImpl, baseUrl: 'https://example.test' })
    const result = await solo.chatStream(JSON.stringify({ model: 'gpt-5.5', messages: [{ role: 'user', content: 'hi' }] }))
    expect(result.ok).toBe(false)
    expect(calls()).toBe(0)
  })

  it('raw chat: reports an unsupported-region failure instead of posting', async () => {
    const { calls, fetchImpl } = countingFetch()
    const raw = new TraeRawChatUpstreamClient({
      credential: async () => usCredential(),
      identity: async () => identity,
      config: { model: 'm', configName: 'm', passBackReasoning: false },
      fetchImpl,
    })
    const result = await raw.chatStream(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toMatch(/United States/)
    expect(calls()).toBe(0)
  })
})

describe('the credential store neither bills nor hides a US credential', () => {
  async function usStore(): Promise<TraeCredentialStore> {
    const dir = await mkdtemp(join(tmpdir(), 'trae-us-'))
    cleanup.push(dir)
    // A desktop path that holds nothing: this test is about the plugin's own
    // copy, and it must never read the developer's real Trae install.
    const storagePath = join(dir, 'storage.json')
    await writeFile(storagePath, '{}')
    const store = new TraeCredentialStore({
      region: 'ai',
      storagePath,
      ownPath: join(dir, 'own.json'),
      edition: 'sg',
      refresh: async () => { throw new Error('a US credential must never be refreshed into a bucket') },
    })
    await store.importAccounts([usCredential()])
    return store
  }

  it('is never selected, listed, or refreshed', async () => {
    const store = await usStore()
    await expect(store.resolve()).rejects.toBeInstanceOf(TraeUnsupportedRegionError)
    await expect(store.accounts()).resolves.toEqual([])
    expect((await store.status()).state).toBe('signed-out')
  })

  it('an UNSCOPED store (diagnostics, tests) refuses it too', async () => {
    // The region-scoped store above would exclude the credential from billing
    // even without the `readAll` guard, because its claim never equals `ai`.
    // An unscoped store has no such comparison, so this is the case that pins
    // the guard itself: without it, `current()` hands the US credential out.
    const dir = await mkdtemp(join(tmpdir(), 'trae-us-unscoped-'))
    cleanup.push(dir)
    const storagePath = join(dir, 'storage.json')
    await writeFile(storagePath, '{}')
    const store = new TraeCredentialStore({
      storagePath,
      ownPath: join(dir, 'own.json'),
      edition: 'sg',
      refresh: async () => { throw new Error('unused') },
    })
    await store.importAccounts([usCredential()])
    await expect(store.current()).resolves.toBeUndefined()
    await expect(store.accounts()).resolves.toEqual([])
    await expect(store.resolve()).rejects.toBeInstanceOf(TraeUnsupportedRegionError)
  })

  it('is still NAMEABLE, so the signed-out panel can explain itself', async () => {
    const store = await usStore()
    expect(await store.unsupportedCredentials()).toEqual([{ region: 'us', accountName: 'US User' }])
  })

  it('says "no signed-in account" when the machine has no US credential', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trae-empty-'))
    cleanup.push(dir)
    const storagePath = join(dir, 'storage.json')
    await writeFile(storagePath, '{}')
    const store = new TraeCredentialStore({
      region: 'ai',
      storagePath,
      ownPath: join(dir, 'own.json'),
      edition: 'sg',
      refresh: async () => { throw new Error('unused') },
    })
    await expect(store.resolve()).rejects.toThrow(/no signed-in account found/)
    expect(await store.unsupportedCredentials()).toEqual([])
  })
})

describe('failure status crosses the route boundary unchanged', () => {
  it('keeps an upstream 401/403 as authentication, not 500', () => {
    expect(httpFailureOf(new TraeHttpError(401, 'SOLO remote models returned HTTP 401'))).toEqual({ status: 401, code: 'authentication' })
    expect(httpFailureOf(new TraeHttpError(403, 'forbidden'))).toEqual({ status: 403, code: 'authentication' })
    expect(httpFailureOf(new TraeHttpError(404, 'missing'))).toEqual({ status: 404, code: 'upstream' })
  })

  it('maps the local unsupported-region verdict to 501', () => {
    expect(httpFailureOf(new TraeUnsupportedRegionError('us'))).toEqual({ status: 501, code: TRAE_UNSUPPORTED_REGION_CODE })
  })

  it('leaves a plain error at 500, because it carries no upstream verdict', () => {
    expect(httpFailureOf(new Error('boom'))).toEqual({ status: 500 })
  })
})

/** Minimal response recorder: the handlers only need writeHead + end. */
function response(): { res: { writeHead: (status: number, headers?: Record<string, string>) => void, end: (payload?: string) => void }, status: () => number, body: () => unknown } {
  let statusCode = 0
  let payload = ''
  return {
    res: {
      writeHead: (status: number) => { statusCode = status },
      end: (body?: string) => { payload = body ?? '' },
    },
    status: () => statusCode,
    body: () => JSON.parse(payload) as unknown,
  }
}

async function mountRefresh(discover: () => Promise<readonly unknown[]>): Promise<(req: unknown, res: unknown) => Promise<void>> {
  const deps = {
    store: () => ({
      async accounts() { return [] },
      async status() { return { state: 'signed-out' } },
      async diagnose() { return { tried: [], failures: [] } },
      async quarantinedCopies() { return [] },
      async unsupportedCredentials() { return [] },
    }),
    client: () => ({ snapshot: async () => ({ workAvailable: 0, generalAvailable: 0 }) }),
    displayModels: () => [],
    enabledModelIds: () => [],
    regionEnabled: () => true,
    discoverModels: discover,
  } as unknown as TraeUsageRouteOptions
  let captured: { path: string, handler: (req: unknown, res: unknown) => Promise<void> } | undefined
  const FakeWebServer = {
    name: 'webServer',
    inject: [] as const,
    apply(ctx: Context) {
      ctx.provide('webServer', {
        register: (entry: { path: string, handler: (req: unknown, res: unknown) => Promise<void> }) => {
          if (entry.path === TRAE_MODELS_REFRESH_PATH) captured = entry
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
  if (captured === undefined) throw new Error('models refresh route was not registered')
  return captured.handler
}

function refreshRequest(): { method: string, url: string, headers: Record<string, string> } {
  return { method: 'POST', url: `${TRAE_MODELS_REFRESH_PATH}?region=ai`, headers: {} }
}

describe('models refresh route (the 500 in the report)', () => {
  it('answers the upstream 401 as 401 with its own message', async () => {
    const handler = await mountRefresh(async () => { throw new TraeHttpError(401, 'SOLO remote models returned HTTP 401') })
    const { res, status, body } = response()
    await handler(refreshRequest(), res)
    expect(status()).toBe(401)
    expect(body()).toMatchObject({ error: 'SOLO remote models returned HTTP 401', code: 'authentication' })
  })

  it('answers an unsupported region as 501 + unsupported-region', async () => {
    const handler = await mountRefresh(async () => { throw new TraeUnsupportedRegionError('us') })
    const { res, status, body } = response()
    await handler(refreshRequest(), res)
    expect(status()).toBe(501)
    expect(body()).toMatchObject({ code: TRAE_UNSUPPORTED_REGION_CODE })
    expect((body() as { error: string }).error).toMatch(/United States/)
  })

  it('still answers 500 for a failure with no status of its own', async () => {
    const handler = await mountRefresh(async () => { throw new Error('unexpected') })
    const { res, status, body } = response()
    await handler(refreshRequest(), res)
    expect(status()).toBe(500)
    expect(body()).toEqual({ error: 'unexpected' })
  })
})

describe('the status document carries the notice', () => {
  function depsWith(store: unknown): TraeUsageRouteOptions {
    return {
      store: () => store,
      client: () => ({ snapshot: async () => ({ workAvailable: 0, generalAvailable: 0 }), payStatus: async () => { throw new Error('unused') } }),
      displayModels: () => [],
      enabledModelIds: () => [],
      regionEnabled: () => true,
    } as unknown as TraeUsageRouteOptions
  }

  it('reports the US credential on the signed-out document without repeating the English exception', async () => {
    const store = {
      async accounts() { return [] },
      async status() { return { state: 'signed-out' } },
      async diagnose() { return { tried: [], failures: [] } },
      async quarantinedCopies() { return [] },
      async current() { return undefined },
      async resolve() { throw new TraeUnsupportedRegionError('us') },
      async unsupportedCredentials() { return [{ region: 'us', accountName: 'US User' }] },
    }
    const document = await traeWebUsage(depsWith(store), 'ai')
    expect(document).toMatchObject({
      status: 'signed-out',
      unsupportedRegion: { region: 'us', accounts: ['US User'] },
    })
    // The localized notice says it; the raw English exception would be a second
    // copy of the same fact.
    expect(document.status === 'signed-out' ? document.message : undefined).toBeUndefined()
  })

  it('carries no notice when nothing on the machine is unsupported', async () => {
    const store = {
      async accounts() { return [] },
      async status() { return { state: 'signed-out' } },
      async diagnose() { return { tried: [], failures: [] } },
      async quarantinedCopies() { return [] },
      async unsupportedCredentials() { return [] },
    }
    const document = await traeWebUsage(depsWith(store), 'ai')
    expect(document).not.toHaveProperty('unsupportedRegion')
  })
})
