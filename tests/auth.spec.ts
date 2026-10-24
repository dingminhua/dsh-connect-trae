import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEnterpriseAccount, normalizeTraeCredential, traeAccountId, TraeCredentialStore } from '../src/auth.ts'
import type { TraeStorageCandidate } from '../src/paths.ts'
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
    // Version 2 (issue #37): the file now holds an ARRAY of the region's
    // credentials, so an imported account can coexist with a refreshed one.
    // Version 1 files are still READ; they simply upgrade on the next write.
    expect(JSON.parse(await readFile(own, 'utf8')).credentials[0].accessToken).toBe('fresh')
  })

  it('uses the FRESHER copy when the same account exists on both sides', async () => {
    // The live failure: the plugin refreshes the bound account and writes the
    // result to its OWN file, but the desktop file still holds the pre-refresh
    // token. Deduping by account id and keeping the desktop copy threw the
    // refresh away, so the account read as "token expired" while a valid token
    // sat one file over — the composer table showed a dash for it.
    const dir = await temp(); const file = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    const expiredAt = Date.now() - 86_400_000
    await writeFile(file, storage('stale-desktop', expiredAt, undefined, 'same-user'))
    await writeFile(own, JSON.stringify({ version: 1, credential: {
      accessToken: 'refreshed-own', refreshToken: 'rt', userId: 'same-user', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn',
    } }))
    const store = new TraeCredentialStore({ storagePath: file, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })

    // SAME account on both sides (edition + userId), so this is a choice between
    // two copies of one login — never between two logins.
    await expect(store.current()).resolves.toMatchObject({ accessToken: 'refreshed-own', source: 'dsh' })
    // ...and the account is still discoverable exactly once.
    await expect(store.accounts()).resolves.toHaveLength(1)
  })

  it('still keeps the desktop copy when IT is the fresher one', async () => {
    // The mirror case, so the rule is "freshest copy", not "own copies win".
    const dir = await temp(); const file = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(file, storage('fresh-desktop', Date.now() + 86_400_000, undefined, 'same-user'))
    await writeFile(own, JSON.stringify({ version: 1, credential: {
      accessToken: 'stale-own', refreshToken: 'rt', userId: 'same-user', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() - 86_400_000, source: 'dsh', edition: 'cn',
    } }))
    const store = new TraeCredentialStore({ storagePath: file, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })
    await expect(store.current()).resolves.toMatchObject({ accessToken: 'fresh-desktop', source: 'desktop' })
  })

  it('does not replace an account with a DIFFERENT one that expires later', async () => {
    // The rule is per ACCOUNT: two logins are two accounts, and which one is
    // current still follows the desktop order (see the test above this block).
    const dir = await temp(); const file = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(file, storage('desktop-login', Date.now() + 3_600_000, undefined, 'user-a'))
    await writeFile(own, JSON.stringify({ version: 1, credential: {
      accessToken: 'own-login', refreshToken: 'rt', userId: 'user-b', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn',
    } }))
    const store = new TraeCredentialStore({ storagePath: file, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })
    await expect(store.accounts()).resolves.toHaveLength(2)
    await expect(store.current()).resolves.toMatchObject({ accessToken: 'desktop-login' })
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

  it('prefers the APP\'S live sign-in over a stale own copy of the previous login (issue #29)', async () => {
    // The exact #29 report: Trae switched from A to B, so the desktop file
    // (source: 'desktop') now holds B while the plugin's own refreshed copy of
    // A (source: 'dsh', expires LATER) still resolves. The default and the
    // account list must follow the app, not the abandoned login.
    const dir = await temp(); const file = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(file, storage('app-b', Date.now() + 3_600_000, undefined, 'user-b'))
    await writeFile(own, JSON.stringify({ version: 1, credential: {
      accessToken: 'stale-a', refreshToken: 'rt', userId: 'user-a', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn',
    } }))
    const store = new TraeCredentialStore({ storagePath: file, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })
    await expect(store.current()).resolves.toMatchObject({ accessToken: 'app-b', source: 'desktop' })
    const accounts = await store.accounts()
    expect(accounts.find(account => account.selected)?.accountName).toBe('user-b')
    // The stale login is still LISTED (switchable), just not defaulted to.
    expect(accounts.map(account => account.accountName)).toEqual(['user-b', 'user-a'])
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
    // Remove the selected account EVERYWHERE: the app's file and the plugin's
    // copy of it. Selection must NOT silently switch to the remaining account;
    // it must surface as "not found".
    await rm(solo)
    await rm(join(dir, 'own'))
    await expect(store.current()).resolves.toBeUndefined()
  })

  it('mirrors every local login into its own copy on the first account read', async () => {
    // The app has ONE sign-in slot, so the plugin cannot count on finding a
    // previous login there later. Each read of the account list therefore copies
    // whatever the machine holds right now — the copy is what survives the next
    // app sign-in.
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const sg = join(dir, 'sg.json'); const own = join(dir, 'own.json')
    await writeFile(cn, storage('cn-token', Date.now() + 3_600_000, undefined, 'cn-user'))
    await writeFile(sg, intlStorage('sg-token', Date.now() + 3_600_000, 'sg-user'))
    const store = new TraeCredentialStore({ ownPath: own, refresh: async () => { throw new Error('unused') } })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }, { edition: 'sg', path: sg, source: 'desktop' }]
    await expect(store.accounts()).resolves.toHaveLength(2)
    const doc = JSON.parse(await readFile(own, 'utf8')) as { version: number; credentials: { userId: string; source: string }[] }
    expect(doc.version).toBe(2)
    expect(doc.credentials.map(entry => entry.userId).sort()).toEqual(['cn-user', 'sg-user'])
    expect(doc.credentials.every(entry => entry.source === 'dsh')).toBe(true)
    // A second refresh does not duplicate or rewrite anything.
    await expect(store.accounts()).resolves.toHaveLength(2)
    expect(JSON.parse(await readFile(own, 'utf8'))).toEqual(doc)
  })

  it('leaves an existing copy alone instead of overwriting it with the app login', async () => {
    // A copy may hold a token this plugin refreshed — fresher than the app's.
    // Re-copying on every refresh would throw that away.
    const dir = await temp()
    const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('from-app', Date.now() + 3_600_000, undefined, 'user-a'))
    await writeFile(own, JSON.stringify({ version: 2, credentials: [
      { accessToken: 'refreshed', refreshToken: 'rt', userId: 'user-a', host: 'https://api.trae.cn', expiresAtMs: Date.now() + 90_000_000, source: 'dsh', edition: 'cn' },
    ] }))
    const store = new TraeCredentialStore({ storagePath: desktop, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })
    await expect(store.accounts()).resolves.toHaveLength(1)
    expect(await readFile(own, 'utf8')).toContain('refreshed')
    expect(await readFile(own, 'utf8')).not.toContain('from-app')
  })

  it('keeps the earlier account when the app signs in to a different one', async () => {
    // The app has ONE sign-in slot and overwrites it. This is the whole point of
    // the copy: switching accounts inside Trae must not lose the previous one.
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('a-token', Date.now() + 3_600_000, undefined, 'user-a'))
    const store = new TraeCredentialStore({
      storagePath: desktop, edition: 'cn', ownPath: own,
      refresh: async () => { throw new Error('unused') },
    })
    expect((await store.accounts()).map(account => account.accountName)).toEqual(['user-a'])
    // The user signs in to a SECOND account in Trae; the app file now holds B only.
    await writeFile(desktop, storage('b-token', Date.now() + 3_600_000, undefined, 'user-b'))
    const after = await store.accounts()
    expect(after.map(account => account.accountName).sort()).toEqual(['user-a', 'user-b'])
    const doc = JSON.parse(await readFile(own, 'utf8')) as { credentials: { userId: string }[] }
    expect(doc.credentials.map(entry => entry.userId).sort()).toEqual(['user-a', 'user-b'])
  })

  it('answers copyOf from its own copy even when the app file is fresher', async () => {
    // Export hands credentials out. It must hand out the COPY this plugin owns
    // and refreshes, never whatever the Trae app has on disk — even when the
    // app's happens to be newer.
    const dir = await temp()
    const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('from-app', Date.now() + 9_000_000, undefined, 'user-a'))
    await writeFile(own, JSON.stringify({ version: 2, credentials: [
      { accessToken: 'copy-token', refreshToken: 'rt', userId: 'user-a', host: 'https://api.trae.cn', expiresAtMs: Date.now() + 3_600_000, source: 'dsh', edition: 'cn' },
    ] }))
    const store = new TraeCredentialStore({ storagePath: desktop, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })
    const id = (await store.accounts())[0]?.id
    expect(id).toBeDefined()
    // The merged view prefers whichever token is fresher — here the app's.
    await expect(store.credentialOf(id ?? '')).resolves.toMatchObject({ accessToken: 'from-app' })
    // Handing the credential out reads the plugin's own copy instead.
    await expect(store.copyOf(id ?? '')).resolves.toMatchObject({ accessToken: 'copy-token', source: 'dsh' })
    await expect(store.copyOf('unknown-id')).resolves.toBeUndefined()
    await expect(store.copyOf('')).resolves.toBeUndefined()
  })

  it('keeps billing its copy after the app signs that account out', async () => {
    // The point of the mirror: Trae has ONE sign-in slot, so switching accounts
    // in the app would otherwise lose the previous one. The copy is what keeps a
    // multi-account pool alive after the app moves on.
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, storage('cn-token', Date.now() + 3_600_000, undefined, 'cn-user'))
    await writeFile(solo, storage('solo-token', Date.now() + 3_600_000, undefined, 'solo-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }, { edition: 'solo', path: solo, source: 'desktop' }]
    const soloId = (await store.accounts()).find(account => account.accountName === 'solo-user')!.id
    store.selectAccount(soloId)
    await rm(solo)
    await expect(store.current()).resolves.toMatchObject({ userId: 'solo-user' })
    await expect(store.accounts()).resolves.toHaveLength(2)
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


  it('deletes the account from this machine: the copy AND the app login', async () => {
    // "Delete" has to remove BOTH halves. Dropping only the plugin's copy leaves
    // the same login in the app's storage.json, where the next read finds it and
    // the row the user just deleted comes straight back.
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('app-a', Date.now() + 3_600_000, undefined, 'user-a'))
    await writeFile(own, JSON.stringify({ version: 2, credentials: [{
      accessToken: 'own-a', refreshToken: 'rt', userId: 'user-a', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn',
    }] }))
    const store = new TraeCredentialStore({
      storagePath: desktop, edition: 'cn', ownPath: own,
      // The injected storage path is a stand-in for the app's file; the real
      // process probe would report the machine's own running Trae, which has
      // nothing to do with this fixture.
      runningApps: async () => new Set(),
      refresh: async () => { throw new Error('unused') },
    })
    const idA = traeAccountId({ userId: 'user-a', edition: 'cn' })!
    await expect(store.deleteAccount(idA)).resolves.toMatchObject({
      deleted: true, stillSignedIn: false, hadCopy: true, signedOutApps: ['cn'], blockedApps: [],
    })
    expect(await readFile(own, 'utf8')).not.toContain('own-a')
    // The app's login is gone too, and the rewrite left a way back beside it.
    expect(await readFile(desktop, 'utf8')).not.toContain('app-a')
    expect((await readdir(dir)).filter(name => name.includes('dsh-backup'))).toHaveLength(1)
    await expect(store.accounts()).resolves.toHaveLength(0)
    // Signing in again is a NEW login, so it is mirrored again — the tombstone
    // lapses once the app no longer holds the account.
    await writeFile(desktop, storage('app-a2', Date.now() + 3_600_000, undefined, 'user-a'))
    await expect(store.accounts()).resolves.toHaveLength(1)
    expect(await readFile(own, 'utf8')).toContain('app-a2')
  })

  it('refuses to sign the app out while it runs, and names the app', async () => {
    // A running Trae keeps its state in memory and flushes it back over the
    // file, so rewriting the login under it would be undone (or worse). The
    // honest outcome is "not deleted, quit this app and retry".
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('app-a', Date.now() + 3_600_000, undefined, 'user-a'))
    await writeFile(own, JSON.stringify({ version: 2, credentials: [{
      accessToken: 'own-a', refreshToken: 'rt', userId: 'user-a', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn',
    }] }))
    const store = new TraeCredentialStore({
      storagePath: desktop, edition: 'cn', ownPath: own,
      runningApps: async () => new Set(['cn']),
      refresh: async () => { throw new Error('unused') },
    })
    await expect(store.deleteAccount(traeAccountId({ userId: 'user-a', edition: 'cn' })!)).resolves.toMatchObject({
      deleted: false, stillSignedIn: true, signedOutApps: [], blockedApps: ['cn'],
    })
    // Nothing of the app's file was touched: no rewrite, so no backup either.
    expect(await readFile(desktop, 'utf8')).toContain('app-a')
    expect((await readdir(dir)).filter(name => name.includes('dsh-backup'))).toHaveLength(0)
    // The plugin's own copy is still dropped — that one it owns.
    expect(await readFile(own, 'utf8')).not.toContain('own-a')
  })

  it('remembers one deleted account without blocking the mirror of another', async () => {
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(own, JSON.stringify({ version: 2, credentials: [
      { accessToken: 'own-a', userId: 'user-a', host: 'https://api.trae.cn', expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn' },
      { accessToken: 'own-b', userId: 'user-b', host: 'https://api.trae.cn', expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn' },
    ] }))
    const store = new TraeCredentialStore({ ownPath: own, refresh: async () => { throw new Error('unused') } })
    store.candidates = () => [{ edition: 'cn', path: desktop, source: 'desktop' }]
    await expect(store.deleteAccount(traeAccountId({ userId: 'user-a', edition: 'cn' })!)).resolves.toMatchObject({ deleted: true, hadCopy: true })
    // A brand-new local login is still mirrored although another id is tombstoned.
    await writeFile(desktop, storage('app-c', Date.now() + 3_600_000, undefined, 'user-c'))
    const accounts = await store.accounts()
    expect(accounts.map(account => account.accountName).sort()).toEqual(['user-b', 'user-c'])
  })

  it('treats an account it never held a copy of as already deleted', async () => {
    // A ghost member (saved in settings, no local login) has nothing to erase;
    // "deleted" answers "does this plugin still hold a copy?", so it is complete
    // and the caller can drop the membership instead of reporting a failure.
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('app-b', Date.now() + 3_600_000, undefined, 'user-b'))
    const store = new TraeCredentialStore({ storagePath: desktop, edition: 'cn', ownPath: own, refresh: async () => { throw new Error('unused') } })
    const ghost = traeAccountId({ userId: 'ghost-user', edition: 'cn' })!
    await expect(store.deleteAccount(ghost)).resolves.toMatchObject({ deleted: true, stillSignedIn: false, hadCopy: false })
  })

  it('forgets the selection when the deleted copy was the bound account', async () => {
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('app-b', Date.now() + 3_600_000, undefined, 'user-b'))
    await writeFile(own, JSON.stringify({ version: 1, credential: {
      accessToken: 'own-a', refreshToken: 'rt', userId: 'user-a', host: 'https://api.trae.cn',
      expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn',
    } }))
    const idA = traeAccountId({ userId: 'user-a', edition: 'cn' })!
    const store = new TraeCredentialStore({ storagePath: desktop, edition: 'cn', accountId: idA, ownPath: own, refresh: async () => { throw new Error('unused') } })
    await store.deleteAccount(idA)
    // The binding no longer points at a credential that is gone: the app login is
    // the answer now, not a dangling id.
    await expect(store.current()).resolves.toMatchObject({ userId: 'user-b' })
  })
  it('quarantines an unparseable own file on refresh instead of overwriting its bytes', async () => {
    // The failure this guards against: a torn write once made the own file
    // unreadable, `parseOwn` reported "no accounts", and the next refresh
    // merged onto that empty base — silently erasing every other account from
    // the file. Now the unreadable file is renamed aside with its bytes intact
    // and the refresh starts from a clean file, so the lost entries stay
    // recoverable and the action the user pressed still succeeds.
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('stale', Date.now() - 1000))
    const torn = '{ "version": 2, "credentials": [ { "accessToken": "B-at"'
    await writeFile(own, torn)
    let refreshes = 0
    const store = new TraeCredentialStore({ storagePath: desktop, edition: 'cn', ownPath: own, refresh: async () => {
      refreshes += 1
      return { accessToken: 'fresh', refreshToken: 'rt2', expiresAtMs: Date.now() + 3_600_000 }
    } })
    await expect(store.resolve()).resolves.toMatchObject({ accessToken: 'fresh' })
    expect(refreshes).toBe(1)
    const files = await readdir(dir)
    const quarantine = files.find(name => name.startsWith('own.json.corrupt-'))
    expect(quarantine).toBeDefined()
    expect(await readFile(join(dir, quarantine!), 'utf8')).toBe(torn)
    // The refreshed copy landed in a fresh own file rather than being refused.
    expect(JSON.parse(await readFile(own, 'utf8')).credentials[0].accessToken).toBe('fresh')
  })

  it('keeps other accounts when the own file is valid but one row is malformed', async () => {
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('stale', Date.now() - 1000))
    const goodRow = { accessToken: 'good-at', refreshToken: 'rt', userId: 'good-user', host: 'https://api.trae.cn', expiresAtMs: Date.now() + 86_400_000, source: 'dsh', edition: 'cn' }
    await writeFile(own, JSON.stringify({ version: 2, credentials: [goodRow, { accessToken: 7 }] }))
    const store = new TraeCredentialStore({ storagePath: desktop, edition: 'cn', ownPath: own, refresh: async () => ({ accessToken: 'fresh', refreshToken: 'rt2', expiresAtMs: Date.now() + 3_600_000 }) })
    await store.resolve()
    const userIds = JSON.parse(await readFile(own, 'utf8')).credentials
      .map((row: { userId?: string }) => row.userId).sort()
    // A malformed ROW is dropped, not the file; the good copy survives its own
    // refresh alongside the refreshed desktop account.
    expect(userIds).toEqual(['good-user', 'uid'])
  })

  it('aborts the refresh write when the corrupt file cannot be quarantined', async () => {
    // A quarantine that fails must not turn into the very overwrite it exists
    // to prevent: the refreshed token is served to this request but the own
    // file is left untouched, so its bytes (and any accounts they carry) stay
    // intact for the next attempt.
    const dir = await temp(); const desktop = join(dir, 'storage.json'); const own = join(dir, 'own.json')
    await writeFile(desktop, storage('stale', Date.now() - 1000))
    const torn = '{ "version": 2, "credentials": [ { "accessToken": "B-at"'
    await writeFile(own, torn)
    // Freeze the clock so the quarantine's timestamped name is predictable,
    // then occupy that exact name with a non-empty directory — `rename` fails
    // with EPERM on every platform.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await mkdir(join(dir, `own.json.corrupt-${stamp}`))
      await writeFile(join(dir, `own.json.corrupt-${stamp}`, 'occupied.txt'), 'x')
      const store = new TraeCredentialStore({ storagePath: desktop, edition: 'cn', ownPath: own, refresh: async () => ({ accessToken: 'fresh', refreshToken: 'rt2', expiresAtMs: Date.now() + 3_600_000 }) })
      await expect(store.resolve()).resolves.toMatchObject({ accessToken: 'fresh' })
      expect(await readFile(own, 'utf8')).toBe(torn)
    } finally {
      vi.useRealTimers()
    }
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
    // Listed rows are the plugin's COPIES (the store mirrors a local login into
    // its own file on this very read), so the row reports `dsh` — the card names
    // it "plugin copy" rather than implying the app's live login is being billed.
    expect(accounts[0]).toMatchObject({ source: 'dsh', selected: true })
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
    const saved = JSON.parse(await readFile(regionFile, 'utf8')) as { credentials: { accessToken: string }[] }
    expect(saved.credentials[0]?.accessToken).toBe('ai-refreshed')
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

describe('tenant scoping for the enterprise panel', () => {
  /** A storage document for an account that belongs to a Trae tenant. */
  function tenantStorage(token: string, expiresAt: number, userId: string, tenantId = '272193024'): string {
    return JSON.stringify({ [TRAE_AUTH_STORAGE_KEY]: JSON.stringify({
      token, refreshToken: 'rt', userId,
      account: { username: userId, tenant_id: tenantId, tenant_name: 'Some Tenant Co.', scope: 'saas' },
      host: 'https://api.trae.cn', expiredAt: new Date(expiresAt).toISOString(), refreshExpiredAt: new Date(Date.now() + 86_400_000).toISOString(),
    }) })
  }

  it('reads the tenant claim off the credential, and reports none for a personal account', () => {
    const tenant = normalizeTraeCredential(
      { token: 'at', account: { username: 'tenant-user', tenant_id: 272193024 } }, 'cn', 'desktop')
    expect(tenant?.tenantId).toBe('272193024')
    expect(isEnterpriseAccount(tenant)).toBe(true)

    const personal = normalizeTraeCredential(
      { token: 'at', account: { username: 'personal-user', scope: 'marscode' } }, 'cn', 'desktop')
    expect(personal?.tenantId).toBeUndefined()
    expect(isEnterpriseAccount(personal)).toBe(false)
  })

  it('marks each account choice with whether it can bill the enterprise pool', async () => {
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, tenantStorage('tenant-token', Date.now() + 3_600_000, 'tenant-user'))
    await writeFile(solo, storage('personal-token', Date.now() + 3_600_000, undefined, 'personal-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }, { edition: 'solo', path: solo, source: 'desktop' }]
    const accounts = await store.accounts()
    expect(accounts.map(account => [account.accountName, account.enterprise])).toEqual([
      ['tenant-user', true],
      ['personal-user', false],
    ])
  })

  it('never resolves to a personal account when the store requires a tenant', async () => {
    // The desktop credential is the personal one, so a plain store prefers it —
    // exactly the binding that answers `4019` on the enterprise gateway.
    const dir = await temp()
    const personal = join(dir, 'personal.json'); const tenant = join(dir, 'tenant.json')
    await writeFile(personal, storage('personal-token', Date.now() + 3_600_000, undefined, 'personal-user'))
    await writeFile(tenant, tenantStorage('tenant-token', Date.now() + 3_600_000, 'tenant-user'))
    const candidates = (): TraeStorageCandidate[] => [
      { edition: 'solo', path: personal, source: 'desktop' },
      { edition: 'cn', path: tenant, source: 'desktop' },
    ]

    const plain = new TraeCredentialStore({ ownPath: join(dir, 'own-a'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    plain.candidates = candidates
    await expect(plain.current()).resolves.toMatchObject({ userId: 'personal-user' })

    const enterprise = new TraeCredentialStore({ ownPath: join(dir, 'own-b'), requireTenant: true, refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    enterprise.candidates = candidates
    await expect(enterprise.current()).resolves.toMatchObject({ userId: 'tenant-user' })
  })

  it('ignores an explicit binding to a personal account instead of honouring it', async () => {
    const dir = await temp()
    const personal = join(dir, 'personal.json'); const tenant = join(dir, 'tenant.json')
    await writeFile(personal, storage('personal-token', Date.now() + 3_600_000, undefined, 'personal-user'))
    await writeFile(tenant, tenantStorage('tenant-token', Date.now() + 3_600_000, 'tenant-user'))
    const candidates = (): TraeStorageCandidate[] => [
      { edition: 'solo', path: personal, source: 'desktop' },
      { edition: 'cn', path: tenant, source: 'desktop' },
    ]

    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), requireTenant: true, refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = candidates
    const personalId = traeAccountId({ edition: 'solo', userId: 'personal-user' })
    store.selectAccount(personalId)
    // Falls through to the tenant account: a personal binding could only ever
    // fail at the first chat, which is strictly worse than swapping it here.
    await expect(store.current()).resolves.toMatchObject({ userId: 'tenant-user' })
  })
})

describe('consumer panels withhold tenant logins', () => {
  function tenantStorageLocal(token: string, expiresAt: number, userId: string, tenantId = '272193024'): string {
    return JSON.stringify({ [TRAE_AUTH_STORAGE_KEY]: JSON.stringify({
      token, refreshToken: 'rt', userId,
      account: { username: userId, tenant_id: tenantId, scope: 'saas' },
      host: 'https://api.trae.cn', expiredAt: new Date(expiresAt).toISOString(), refreshExpiredAt: new Date(Date.now() + 86_400_000).toISOString(),
    }) })
  }

  it('offers only the personal account by default, and both when opted in', async () => {
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, tenantStorageLocal('tenant', Date.now() + 3_600_000, 'tenant-user'))
    await writeFile(solo, storage('personal', Date.now() + 3_600_000, undefined, 'personal-user'))
    const candidates = (): TraeStorageCandidate[] => [
      { edition: 'cn', path: cn, source: 'desktop' },
      { edition: 'solo', path: solo, source: 'desktop' },
    ]

    const filtered = new TraeCredentialStore({ ownPath: join(dir, 'own-a'), hideTenantAccounts: true, refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    filtered.candidates = candidates
    expect((await filtered.accounts()).map(account => account.accountName)).toEqual(['personal-user'])

    const optedIn = new TraeCredentialStore({ ownPath: join(dir, 'own-b'), refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    optedIn.candidates = candidates
    expect((await optedIn.accounts()).map(account => account.accountName)).toEqual(['tenant-user', 'personal-user'])
  })

  it('still resolves a tenant login when it is the only account on the machine', async () => {
    // Withholding every account would render a working install as "signed out",
    // so the filter backs off rather than emptying the list.
    const dir = await temp()
    const cn = join(dir, 'cn.json')
    await writeFile(cn, tenantStorageLocal('tenant', Date.now() + 3_600_000, 'tenant-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), hideTenantAccounts: true, refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [{ edition: 'cn', path: cn, source: 'desktop' }]
    expect((await store.accounts()).map(account => account.accountName)).toEqual(['tenant-user'])
    await expect(store.current()).resolves.toMatchObject({ userId: 'tenant-user' })
  })

  /**
   * The card offers a list, and the row marked `selected` is what it saves when
   * the user presses "use this account". So `selected` MUST name the account
   * `current()` bills — otherwise the card shows one account while the chat
   * spends another, and the next press rewrites the binding to the account that
   * was only ever DISPLAYED.
   */
  async function assertSelectionAgrees(store: TraeCredentialStore): Promise<string> {
    const accounts = await store.accounts()
    const current = await store.current()
    const marked = accounts.filter(account => account.selected)
    expect(marked).toHaveLength(1)
    const [only] = marked
    expect(only?.id).toBe(traeAccountId(current!))
    return only!.accountName!
  }

  it('marks the account it bills, not the first one the filter happens to keep', async () => {
    // The tenant login sorts FIRST on this machine. A consumer store defaults
    // its billing to `preferred(offered)`, so if `selected` were derived from
    // the filtered list independently it would land on whichever account came
    // first and the card would disagree with the chat.
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, tenantStorageLocal('tenant', Date.now() + 3_600_000, 'tenant-user'))
    await writeFile(solo, storage('personal', Date.now() + 3_600_000, undefined, 'personal-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), hideTenantAccounts: true, refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [
      { edition: 'cn', path: cn, source: 'desktop' },
      { edition: 'solo', path: solo, source: 'desktop' },
    ]
    await expect(assertSelectionAgrees(store)).resolves.toBe('personal-user')
  })

  it('keeps a hidden account on the list when it is the one being billed', async () => {
    // Withholding is a display filter; an explicit binding outranks it. Dropping
    // the bound account from the list would leave no row marked `selected` at
    // all, and the card reads that as "nothing is signed in".
    const dir = await temp()
    const cn = join(dir, 'cn.json'); const solo = join(dir, 'solo.json')
    await writeFile(cn, tenantStorageLocal('tenant', Date.now() + 3_600_000, 'tenant-user'))
    await writeFile(solo, storage('personal', Date.now() + 3_600_000, undefined, 'personal-user'))
    const store = new TraeCredentialStore({ ownPath: join(dir, 'own'), hideTenantAccounts: true, refresh: async c => ({ accessToken: c.accessToken, expiresAtMs: c.expiresAtMs }) })
    store.candidates = () => [
      { edition: 'cn', path: cn, source: 'desktop' },
      { edition: 'solo', path: solo, source: 'desktop' },
    ]
    store.selectAccount(traeAccountId({ edition: 'cn', userId: 'tenant-user' }))
    await expect(assertSelectionAgrees(store)).resolves.toBe('tenant-user')
    expect((await store.accounts()).map(account => account.accountName)).toEqual(['personal-user', 'tenant-user'])
  })
})
