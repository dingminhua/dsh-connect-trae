import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeTraeCredential, TraeCredentialStore } from '../src/auth.ts'
import { TRAE_AUTH_STORAGE_KEY } from '../src/decrypt.ts'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function storage(token: string, expiresAt: number, refreshExpiresAt = Date.now() + 86_400_000, userId = 'uid'): string {
  return JSON.stringify({ [TRAE_AUTH_STORAGE_KEY]: JSON.stringify({
    token, refreshToken: 'rt', userId, account: { username: userId }, host: 'https://api.trae.cn', expiredAt: new Date(expiresAt).toISOString(), refreshExpiredAt: new Date(refreshExpiresAt).toISOString(),
  }) })
}

/** An international install's storage document: SG host plus the userRegion claim. */
function intlStorage(token: string, expiresAt: number, userId = 'intl-user'): string {
  return JSON.stringify({ [TRAE_AUTH_STORAGE_KEY]: JSON.stringify({
    token, refreshToken: 'rt', userId, account: { username: userId }, host: 'https://growsg-normal.trae.ai', userRegion: { region: 'SG', _aiRegion: 'SG' }, expiredAt: new Date(expiresAt).toISOString(),
  }) })
}

async function temp(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'trae-auth-')); cleanup.push(dir); return dir }

/** A bare three-part JWT the way `traecli` persists it. */
const cliJwtContent = (userId: string, exp: number): string =>
  `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ data: { user_id: userId }, iss: 'trae', exp })).toString('base64url')}.sig`

describe('Trae credential normalization', () => {
  it('normalizes ISO and numeric expiries while exposing only the display username', () => {
    expect(normalizeTraeCredential({ token: 'at', expiredAt: '2030-01-01T00:00:00.000Z', account: { username: 'LaoDing', email: 'private@example.com' } }, 'cn', 'desktop')).toMatchObject({
      accessToken: 'at', accountName: 'LaoDing', edition: 'cn', source: 'desktop', expiresAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
    })
    expect(normalizeTraeCredential({}, 'cn', 'desktop')).toBeUndefined()
  })
})

describe('TraeCredentialStore', () => {
  it('reads desktop storage without modifying it', async () => {
    const dir = await temp(); const file = join(dir, 'storage.json'); const before = storage('desktop', Date.now() + 3_600_000)
    await writeFile(file, before)
    const store = new TraeCredentialStore({ storagePath: file, edition: 'cn', ownPath: join(dir, 'own.json'), refresh: async () => { throw new Error('unused') } })
    await expect(store.resolve()).resolves.toMatchObject({ accessToken: 'desktop', source: 'desktop', edition: 'cn' })
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('single-flights refresh, stores a 0600 copy, and serves it next', async () => {
    const dir = await temp(); const file = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(file, storage('old', Date.now() - 1000))
    let refreshes = 0
    const store = new TraeCredentialStore({ storagePath: file, edition: 'cn', ownPath: own, refresh: async () => {
      refreshes += 1; await new Promise(resolve => setTimeout(resolve, 10)); return { accessToken: 'fresh', refreshToken: 'rt2', expiresAtMs: Date.now() + 3_600_000 }
    } })
    const [a, b] = await Promise.all([store.resolve(), store.resolve()])
    expect(a.accessToken).toBe('fresh'); expect(b.accessToken).toBe('fresh'); expect(refreshes).toBe(1)
    // File permission bits are POSIX-only; Windows exposes no meaningful mode.
    if (process.platform !== 'win32') {
      expect((await stat(own)).mode & 0o777).toBe(0o600)
    }
    expect(JSON.parse(await readFile(own, 'utf8')).credential.accessToken).toBe('fresh')
  })

  it('prefers the desktop credential even when the own cache expires later', async () => {
    const dir = await temp(); const file = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(file, storage('desktop', Date.now() + 3_600_000))
    await writeFile(own, JSON.stringify({ version: 1, credential: {
      accessToken: 'stale-own', refreshToken: 'rt', userId: 'old', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn',
    } }))
    const store = new TraeCredentialStore({ storagePath: file, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })
    // The desktop credential (the account currently signed in to Trae) must win,
    // even though the own cache has a later expiry: the plugin should always
    // follow the account the user is logged into right now.
    await expect(store.current()).resolves.toMatchObject({ accessToken: 'desktop', source: 'desktop' })
  })

  it('uses a still-valid token when refresh fails and rejects an expired refresh token', async () => {
    const dir = await temp(); const fresh = join(dir, 'fresh.json'); const expired = join(dir, 'expired.json')
    await writeFile(fresh, storage('usable', Date.now() + 60_000))
    const fallback = new TraeCredentialStore({ storagePath: fresh, edition: 'cn', ownPath: join(dir, 'own-a'), refreshMarginMs: 300_000, refresh: async () => { throw new Error('down') } })
    await expect(fallback.resolve()).resolves.toMatchObject({ accessToken: 'usable' })
    await writeFile(expired, storage('dead', Date.now() - 1000, Date.now() - 1000))
    const rejected = new TraeCredentialStore({ storagePath: expired, edition: 'cn', ownPath: join(dir, 'own-b'), refresh: async () => ({ accessToken: 'never', expiresAtMs: Date.now() + 1000 }) })
    await expect(rejected.resolve()).rejects.toThrow(/no valid refresh token/)
  })

  it('discovers multiple local editions and selects by stable account id', async () => {
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, storage('cn-token', Date.now() + 3_600_000, undefined, 'cn-user'))
    await writeFile(solo, storage('solo-token', Date.now() + 3_600_000, undefined, 'solo-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }, { edition: 'solo', path: solo, source: 'desktop' }]
    const accounts = await store.accounts()
    expect(accounts).toHaveLength(2)
    expect(accounts.map(account => account.accountName)).toEqual(['cn-user', 'solo-user'])
    store.selectAccount(accounts[1]!.id)
    await expect(store.resolve()).resolves.toMatchObject({ userId: 'solo-user', accessToken: 'solo-token' })
    expect((await store.accounts())[1]?.selected).toBe(true)
  })

  it('defaults to the first discovered account, never credit-seeking, when none is selected', async () => {
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, storage('cn-token', Date.now() + 3_600_000, undefined, 'cn-user'))
    await writeFile(solo, storage('solo-token', Date.now() + 3_600_000, undefined, 'solo-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }, { edition: 'solo', path: solo, source: 'desktop' }]
    // No explicit selection: the FIRST account (cn-user) is used, regardless of
    // which account might have credits. The plugin must not hunt for credits.
    await expect(store.current()).resolves.toMatchObject({ userId: 'cn-user' })
    expect((await store.accounts()).find(account => account.accountName === 'cn-user')?.selected).toBe(true)
  })

  it('does not fall back to another account when the selected account disappears', async () => {
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, storage('cn-token', Date.now() + 3_600_000, undefined, 'cn-user'))
    await writeFile(solo, storage('solo-token', Date.now() + 3_600_000, undefined, 'solo-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }, { edition: 'solo', path: solo, source: 'desktop' }]
    const soloId = (await store.accounts()).find(account => account.accountName === 'solo-user')!.id
    store.selectAccount(soloId)
    await expect(store.current()).resolves.toMatchObject({ userId: 'solo-user' })
    // Remove the selected account's file: selection must NOT silently switch
    // to the remaining account; it must surface as "not found".
    await rm(solo)
    await expect(store.current()).resolves.toBeUndefined()
  })

  it('auto mode discovers every desktop edition but only the CN CLI home', () => {
    const store = new TraeCredentialStore({ ownPath: '/tmp/unused-trae-own', refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    const candidates = store.candidates()
    const editions = candidates.map(candidate => candidate.edition)
    // Every desktop install is discovered: the plugin routes by the
    // credential's own region, so international editions must be scanned too.
    expect(new Set(editions)).toEqual(new Set(['cn', 'sg', 'solo', 'solo-sg']))
    // The international CLI home (`~/.trae`) is NOT probed: its token carries
    // no host claim and the SG default host is unverified (INTL_SG_EVIDENCE.md §5).
    const cliEditions = candidates.filter(candidate => candidate.source === 'cli').map(candidate => candidate.edition)
    expect(cliEditions).toEqual(['cn'])
  })

  it('keeps an explicit edition config narrowing both desktop and CLI scans', () => {
    const soloStore = new TraeCredentialStore({ edition: 'solo', ownPath: '/tmp/unused-trae-own', refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    expect(soloStore.candidates().every(candidate => candidate.edition === 'solo')).toBe(true)
    const intlStore = new TraeCredentialStore({ edition: 'solo-sg', ownPath: '/tmp/unused-trae-own', refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    const intlCandidates = intlStore.candidates()
    // The candidate COUNT is platform-dependent by design: Linux probes several
    // directory spellings per edition (`trae-solo` and `TRAE SOLO` both name the
    // international SOLO install), while macOS and Windows resolve one. Assert
    // the narrowing itself — every candidate is this edition's desktop install —
    // rather than a host-specific count.
    expect(intlCandidates.length).toBeGreaterThan(0)
    expect(intlCandidates.every(candidate => candidate.edition === 'solo-sg' && candidate.source === 'desktop')).toBe(true)
  })

  it('normalizes the userRegion claim from the decrypted storage document', () => {
    expect(normalizeTraeCredential({
      token: 'at', userId: 'u', host: 'https://growsg-normal.trae.ai', userRegion: { region: 'SG', _aiRegion: 'SG' }, expiredAt: '2030-01-01T00:00:00.000Z',
    }, 'solo-sg', 'desktop')).toMatchObject({ userRegion: 'SG', edition: 'solo-sg' })
    expect(normalizeTraeCredential({ token: 'at', expiredAt: '2030-01-01T00:00:00.000Z' }, 'cn', 'desktop')?.userRegion).toBeUndefined()
  })

  it('skips a malformed edition instead of hiding valid accounts', async () => {
    const dir = await temp()
    const bad = join(dir, 'bad.json'); const good = join(dir, 'good.json')
    await writeFile(bad, '{broken')
    await writeFile(good, storage('good-token', Date.now() + 3_600_000, undefined, 'good-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: bad, source: 'desktop' }, { edition: 'solo', path: good, source: 'desktop' }]
    await expect(store.accounts()).resolves.toMatchObject([{ accountName: 'good-user', edition: 'solo' }])
  })

  it('does not fall back when the saved account no longer exists', async () => {
    const dir = await temp(); const file = join(dir, 'current.json')
    await writeFile(file, storage('current-token', Date.now() + 3_600_000, undefined, 'current-user'))
    const store = new TraeCredentialStore({ storagePath: file, edition: 'solo', accountId: 'removed-account', ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    // The explicitly selected account id is gone. The plugin must NOT silently
    // switch to another live account; it surfaces "no signed-in account" so the
    // user can re-select instead of being billed against a different account.
    await expect(store.resolve()).rejects.toThrow(/no signed-in account found/)
  })

  it('reports signed out for a missing explicit file', async () => {
    const dir = await temp()
    const store = new TraeCredentialStore({ storagePath: join(dir, 'missing.json'), edition: 'cn', ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    await expect(store.status()).resolves.toEqual({ state: 'signed-out' })
    await expect(store.desktopFilePresent()).resolves.toBe(false)
  })

  it('discovers an international account alongside CN ones and reports its region', async () => {
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const intl = join(dir, 'intl.json')
    await writeFile(cn, storage('cn-token', Date.now() + 3_600_000, undefined, 'cn-user'))
    await writeFile(intl, intlStorage('intl-token', Date.now() + 3_600_000))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }, { edition: 'solo-sg', path: intl, source: 'desktop' }]
    const accounts = await store.accounts()
    expect(accounts.map(account => account.accountName)).toEqual(['cn-user', 'intl-user'])
    // The routing bucket derives from the credential's own claim: the SG
    // credential (userRegion SG, growsg host) is `ai`, the CN one is `cn`.
    expect(accounts.map(account => account.region)).toEqual(['cn', 'ai'])
    store.selectAccount(accounts[1]!.id)
    await expect(store.resolve()).resolves.toMatchObject({ accessToken: 'intl-token', host: 'https://growsg-normal.trae.ai', userRegion: 'SG' })
  })

  it('keeps an international account refreshed in the own copy', async () => {
    const dir = await temp()
    const desktop = join(dir, 'cn.json'); const own = join(dir, 'own.json')
    // The desktop is currently signed in to a different (CN) account; the own
    // copy still holds the international account's refreshed credential.
    await writeFile(desktop, storage('cn-token', Date.now() + 3_600_000, undefined, 'cn-user'))
    await writeFile(own, JSON.stringify({ version: 1, credential: {
      accessToken: 'refreshed', refreshToken: 'rt', userId: 'intl-user', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'solo-sg',
    } }))
    const store = new TraeCredentialStore({ ownPath: own, refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: desktop, source: 'desktop' }]
    // Both accounts surface: the international edition's refreshed copy is no
    // longer dropped for not being a CN edition.
    const accounts = await store.accounts()
    expect(accounts.map(account => account.accountName)).toEqual(['cn-user', 'intl-user'])
    expect(accounts.map(account => account.region)).toEqual(['cn', 'ai'])
    store.selectAccount(accounts[1]!.id)
    await expect(store.current()).resolves.toMatchObject({ accessToken: 'refreshed', source: 'dsh', edition: 'solo-sg' })
  })

  it('rejects an international CLI token with a diagnosable error instead of misrouting it', async () => {
    const dir = await temp(); const token = join(dir, 'trae-jwt-token')
    await writeFile(token, cliJwtContent('intl-cli-user', Math.floor((Date.now() + 86_400_000) / 1000)))
    const store = new TraeCredentialStore({ storagePath: token, edition: 'solo-sg', ownPath: join(dir, 'own'), refresh: async () => { throw new Error('unused') } })
    await expect(store.status()).resolves.toEqual({ state: 'signed-out' })
    const { failures } = await store.diagnose()
    expect(failures.some(failure => failure.reason === 'invalid' && /only verified for the CN region/.test(failure.message ?? ''))).toBe(true)
  })
})

describe('TraeCredentialStore with a CLI-only sign-in', () => {
  it('resolves an account from a CLI token with no storage.json present', async () => {
    // Issue #5 regression: on WSL2 the user signs in with `traecli`, which never
    // writes a globalStorage/storage.json. Before CLI candidates existed the
    // store found nothing and the plugin reported "not signed in" forever.
    const dir = await temp(); const token = join(dir, 'trae-jwt-token')
    await writeFile(token, `${cliJwtContent('999000111222333', Math.floor((Date.now() + 86_400_000) / 1000))}\n`)
    const store = new TraeCredentialStore({ storagePath: token, edition: 'cn', ownPath: join(dir, 'own'), refresh: async () => { throw new Error('unused') } })
    const credential = await store.resolve()
    expect(credential).toMatchObject({ userId: '999000111222333', source: 'cli', edition: 'cn' })
    // The CLI token has no host claim, so the CN host is supplied rather than an
    // empty string that would become an unusable base URL.
    expect(credential.host).toBe('https://api.trae.cn')
    expect(credential.expiresAtMs).toBeGreaterThan(Date.now())
  })

  it('lets a CLI sign-in be selected as an account', async () => {
    const dir = await temp(); const token = join(dir, 'trae-jwt-token')
    await writeFile(token, cliJwtContent('cli-user', Math.floor((Date.now() + 86_400_000) / 1000)))
    const store = new TraeCredentialStore({ storagePath: token, edition: 'cn', ownPath: join(dir, 'own'), refresh: async () => { throw new Error('unused') } })
    const accounts = await store.accounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ source: 'cli', selected: true })
  })

  it('explains why every candidate failed instead of reporting a bare signed-out', async () => {
    // The original silent `catch { continue }` made a wrong-path machine
    // undiagnosable. `diagnose()` must name each tried path and its failure.
    const dir = await temp()
    const missing = join(dir, 'absent', 'trae-jwt-token')
    const broken = join(dir, 'broken', 'trae-jwt-token')
    await mkdir(join(dir, 'broken'), { recursive: true })
    await writeFile(broken, 'not-a-jwt')
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async () => { throw new Error('unused') } })
    store.candidates = () => [
      { edition: 'cn', path: missing, source: 'cli' },
      { edition: 'cn', path: broken, source: 'cli' },
    ]
    await expect(store.status()).resolves.toEqual({ state: 'signed-out' })
    const { tried, failures } = await store.diagnose()
    expect(tried.map(item => item.path)).toEqual([missing, broken])
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({ path: missing, reason: 'missing' })
    expect(failures[1]).toMatchObject({ path: broken, reason: 'invalid' })
    expect(failures[1]?.message).toMatch(/three-part/)
  })

  it('reports no failure for a candidate that yields an account', async () => {
    const dir = await temp(); const token = join(dir, 'trae-jwt-token')
    await writeFile(token, cliJwtContent('ok-user', Math.floor((Date.now() + 86_400_000) / 1000)))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async () => { throw new Error('unused') } })
    store.candidates = () => [{ edition: 'cn', path: token, source: 'cli' }]
    const { failures } = await store.diagnose()
    expect(failures).toEqual([])
  })

  it('never leaks token material through the diagnostic payload', async () => {
    // The diagnostic crosses to the browser, so it must carry paths and fixed
    // reason strings only. Parser errors are written to never echo their input.
    const dir = await temp()
    const secret = 'eyJhbGciOiJSUzI1NiJ9.SUPERSECRETPAYLOAD.signature'
    const file = join(dir, 'token')
    await writeFile(file, `${secret}.${secret}`)
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async () => { throw new Error('unused') } })
    store.candidates = () => [{ edition: 'cn', path: file, source: 'cli' }]
    const { failures } = await store.diagnose()
    const serialized = JSON.stringify(failures)
    expect(serialized).not.toContain('SUPERSECRETPAYLOAD')
    expect(serialized).not.toContain(secret)
    expect(failures[0]?.reason).toBe('invalid')
  })
})

describe('TraeCredentialStore region scoping', () => {
  /** One CN install and one international install, each with its own file. */
  async function mixedInstalls(dir: string): Promise<{ cn: string, ai: string }> {
    const cnFile = join(dir, 'cn-storage.json')
    const aiFile = join(dir, 'ai-storage.json')
    await writeFile(cnFile, storage('cn-token', Date.now() + 3_600_000, Date.now() + 86_400_000, 'cn-user'))
    await writeFile(aiFile, intlStorage('ai-token', Date.now() + 3_600_000, 'intl-user'))
    return { cn: cnFile, ai: aiFile }
  }

  /** A store pinned to one region, with both installs offered as candidates. */
  function regionStore(dir: string, region: 'cn' | 'ai', files: { cn: string, ai: string }): TraeCredentialStore {
    const store = new TraeCredentialStore({
      region,
      ownPath: join(dir, `own-${region}.json`),
      legacyOwnPath: join(dir, 'legacy-own.json'),
      refresh: async () => { throw new Error('unused') },
    })
    store.candidates = () => [
      { edition: 'cn', path: files.cn, source: 'desktop' },
      { edition: 'solo-sg', path: files.ai, source: 'desktop' },
    ]
    return store
  }

  it('a region-scoped store only sees its own region accounts', async () => {
    const dir = await temp()
    const files = await mixedInstalls(dir)
    const cn = regionStore(dir, 'cn', files)
    const ai = regionStore(dir, 'ai', files)

    expect((await cn.accounts()).map(account => account.region)).toEqual(['cn'])
    expect((await ai.accounts()).map(account => account.region)).toEqual(['ai'])
    expect((await cn.current())?.accessToken).toBe('cn-token')
    expect((await ai.current())?.accessToken).toBe('ai-token')
  })

  it('does not resolve the other region\'s explicitly selected account', async () => {
    const dir = await temp()
    const files = await mixedInstalls(dir)
    const cnAccountId = (await regionStore(dir, 'cn', files).accounts())[0]?.id
    const ai = regionStore(dir, 'ai', files)
    ai.selectAccount(cnAccountId)
    // A CN account id in the international store: not found → undefined, never
    // a silent fallback to the international account.
    await expect(ai.current()).resolves.toBeUndefined()
  })

  it('the legacy single own copy serves only the region it belongs to', async () => {
    const dir = await temp()
    const legacy = join(dir, 'legacy-own.json')
    // A legacy refreshed copy carrying a CN credential.
    await writeFile(legacy, JSON.stringify({ version: 1, credential: {
      accessToken: 'legacy-cn', userId: 'cn-user', accountName: 'cn-user',
      host: 'https://api.trae.cn', expiresAtMs: Date.now() + 86_400_000,
      edition: 'cn', source: 'desktop',
    } }))
    const cn = new TraeCredentialStore({
      region: 'cn',
      ownPath: join(dir, 'own-cn.json'),
      legacyOwnPath: legacy,
      refresh: async () => { throw new Error('unused') },
    })
    const ai = new TraeCredentialStore({
      region: 'ai',
      ownPath: join(dir, 'own-ai.json'),
      legacyOwnPath: legacy,
      refresh: async () => { throw new Error('unused') },
    })
    cn.candidates = () => []
    ai.candidates = () => []

    expect((await cn.current())?.accessToken).toBe('legacy-cn')
    // The international region never inherits the CN credential.
    await expect(ai.current()).resolves.toBeUndefined()
  })

  it('a region refresh persists into the region own file, leaving the legacy copy alone', async () => {
    const dir = await temp()
    const legacy = join(dir, 'legacy-own.json')
    const regionFile = join(dir, 'own-ai.json')
    const file = join(dir, 'ai-storage.json')
    await writeFile(file, intlStorage('ai-old', Date.now() - 1000, 'intl-user'))
    await writeFile(legacy, JSON.stringify({ version: 1, credential: {
      accessToken: 'legacy-cn', userId: 'cn-user', accountName: 'cn-user',
      host: 'https://api.trae.cn', expiresAtMs: Date.now() + 86_400_000,
      edition: 'cn', source: 'desktop',
    } }))
    const store = new TraeCredentialStore({
      region: 'ai',
      ownPath: regionFile,
      legacyOwnPath: legacy,
      refresh: async () => ({ accessToken: 'ai-refreshed', expiresAtMs: Date.now() + 3_600_000 }),
    })
    store.candidates = () => [{ edition: 'solo-sg', path: file, source: 'desktop' }]

    await expect(store.resolve()).resolves.toMatchObject({ accessToken: 'ai-refreshed', source: 'dsh' })
    const saved = JSON.parse(await readFile(regionFile, 'utf8')) as { credential: { accessToken: string } }
    expect(saved.credential.accessToken).toBe('ai-refreshed')
    // The legacy copy carried the other region and is untouched by this write.
    const untouched = JSON.parse(await readFile(legacy, 'utf8')) as { credential: { accessToken: string } }
    expect(untouched.credential.accessToken).toBe('legacy-cn')
  })

  it('logout removes every plugin-owned copy the store could read', async () => {
    const dir = await temp()
    const regionFile = join(dir, 'own-cn.json')
    const legacy = join(dir, 'legacy-own.json')
    await writeFile(regionFile, '{}')
    await writeFile(legacy, '{}')
    const store = new TraeCredentialStore({
      region: 'cn',
      ownPath: regionFile,
      legacyOwnPath: legacy,
      refresh: async () => { throw new Error('unused') },
    })
    await store.logout()
    await expect(readFile(regionFile, 'utf8')).rejects.toThrow()
    await expect(readFile(legacy, 'utf8')).rejects.toThrow()
  })
})
