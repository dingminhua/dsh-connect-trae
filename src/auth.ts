import { readFile, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseTraeCliToken, parseTraeStorageDocument } from './decrypt.ts'
import { traeStorageCandidates, type TraeCredentialSource, type TraeEdition, type TraeStorageCandidate } from './paths.ts'
import { regionOfCredential, regionOfEdition, type TraeRegion } from './region.ts'

export interface TraeCredential {
  accessToken: string
  refreshToken?: string
  userId: string
  accountName?: string
  host: string
  /**
   * Region claim from the decrypted storage document (`userRegion.region`,
   * 'CN' | 'SG', possibly lowercase). Drives the routing bucket together with
   * `host`; see `regionOfCredential`.
   */
  userRegion?: string
  expiresAtMs: number
  refreshExpiresAtMs?: number
  edition: TraeEdition
  source: 'desktop' | 'dsh' | 'cli'
}

export interface TraeRefreshOutcome {
  accessToken: string
  refreshToken?: string
  expiresAtMs: number
  refreshExpiresAtMs?: number
  host?: string
}

export interface TraeCredentialStoreOptions {
  storagePath?: string
  edition?: TraeEdition | 'auto'
  accountId?: string
  ownPath?: string
  /**
   * Region this store serves. When set, only credentials whose own claim maps
   * to this region are discovered, selected, or refreshed — the two regions'
   * stores run side by side without seeing each other's accounts.
   */
  region?: TraeRegion
  /** Legacy single-copy path read as a migration source; injectable for tests. */
  legacyOwnPath?: string
  refresh: (credential: TraeCredential) => Promise<TraeRefreshOutcome>
  refreshMarginMs?: number
}

export interface TraeAccountChoice {
  id: string
  accountName: string
  edition: TraeEdition
  /** Routing bucket of this account (`cn` | `ai`), derived from its credential. */
  region: TraeRegion
  source: 'desktop' | 'dsh' | 'cli'
  tokenExpiresAtMs: number
  selected: boolean
}

/**
 * Why one candidate path did not yield an account. These are safe to surface:
 * they carry paths and error text, never token material.
 */
export interface TraeCandidateFailure {
  path: string
  edition: TraeEdition
  source: TraeCredentialSource
  reason: 'missing' | 'unreadable' | 'invalid'
  message?: string
}

/** Host used for CLI tokens, which carry no host claim of their own. */
const CLI_DEFAULT_HOST = 'https://api.trae.cn'

const OWN_VERSION = 1
export const TRAE_AUTH_FILENAME = '.trae-auth.json'

/** Prefix of the plugin-owned per-region credential copies. */
const TRAE_OWN_PREFIX = '.trae-auth'

/**
 * Plugin-owned copy path for one region. Each region's store refreshes into
 * its own file so two simultaneously signed-in regions never overwrite each
 * other's refreshed token.
 */
export function traeOwnAuthPath(region: TraeRegion): string {
  return join(resolveDshHome(), `${TRAE_OWN_PREFIX}.${region}.json`)
}

/**
 * Pre-dual-provider single-copy path. Still read as a migration source (a
 * legacy credential serves the region it belongs to until that region's own
 * first refresh writes the per-region file), and removed by `logout`.
 */
export function legacyTraeOwnAuthPath(): string {
  return join(resolveDshHome(), TRAE_AUTH_FILENAME)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function timeToMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value > 1e12 ? value : value * 1000
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Extract the `userRegion.region` string from either on-disk shape. */
function userRegionOf(value: unknown): string | undefined {
  const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)['region']
    : value
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

export function normalizeTraeCredential(raw: unknown, edition: TraeEdition, source: TraeCredential['source']): TraeCredential | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const accessToken = optionalString(value['token']) ?? optionalString(value['accessToken'])
  if (accessToken === undefined) return undefined
  const expiresAtMs = timeToMs(value['expiredAt'] ?? value['expiresAt']) ?? 0
  const refreshExpiresAtMs = timeToMs(value['refreshExpiredAt'] ?? value['refreshExpiresAt'])
  const refreshToken = optionalString(value['refreshToken'])
  const userRegion = userRegionOf(value['userRegion'])
  const account = typeof value['account'] === 'object' && value['account'] !== null && !Array.isArray(value['account'])
    ? value['account'] as Record<string, unknown>
    : undefined
  const accountName = optionalString(account?.['username'])
  return {
    accessToken,
    ...refreshToken === undefined ? {} : { refreshToken },
    userId: optionalString(value['userId']) ?? '',
    ...accountName === undefined ? {} : { accountName },
    host: optionalString(value['host']) ?? '',
    ...userRegion === undefined ? {} : { userRegion },
    expiresAtMs,
    ...refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs },
    edition,
    source,
  }
}

export function traeAccountId(credential: Pick<TraeCredential, 'edition' | 'userId' | 'accountName'>): string {
  const stable = `${credential.edition}\0${credential.userId || credential.accountName || 'unknown'}`
  return createHash('sha256').update(stable).digest('hex').slice(0, 24)
}

function parseOwn(text: string): TraeCredential | undefined {
  try {
    const document = JSON.parse(text) as { version?: unknown; credential?: unknown }
    if (document.version !== OWN_VERSION || typeof document.credential !== 'object' || document.credential === null) return undefined
    const stored = document.credential as Record<string, unknown>
    const edition = stored['edition']
    if (edition !== 'cn' && edition !== 'sg' && edition !== 'solo' && edition !== 'solo-sg') return undefined
    return normalizeTraeCredential({
      token: stored['accessToken'], refreshToken: stored['refreshToken'], userId: stored['userId'], host: stored['host'],
      userRegion: stored['userRegion'],
      account: stored['accountName'] === undefined ? undefined : { username: stored['accountName'] },
      expiredAt: stored['expiresAtMs'], refreshExpiredAt: stored['refreshExpiresAtMs'],
    }, edition, 'dsh')
  } catch { return undefined }
}

export class TraeCredentialStore {
  private storagePathOverride: string | undefined
  private edition: TraeEdition | 'auto'
  private accountId: string | undefined
  private readonly region: TraeRegion | undefined
  private readonly ownPathExplicit: string | undefined
  private readonly legacyOwnPath: string
  private readonly legacyOwnPathExplicit: string | undefined
  private readonly refresh: TraeCredentialStoreOptions['refresh']
  private readonly refreshMarginMs: number
  private inflight: Promise<TraeCredential> | undefined

  constructor(options: TraeCredentialStoreOptions) {
    this.storagePathOverride = options.storagePath
    this.edition = options.edition ?? 'auto'
    this.accountId = options.accountId
    this.region = options.region
    this.ownPathExplicit = options.ownPath
    this.legacyOwnPath = options.legacyOwnPath ?? legacyTraeOwnAuthPath()
    this.legacyOwnPathExplicit = options.legacyOwnPath
    this.refresh = options.refresh
    this.refreshMarginMs = options.refreshMarginMs ?? 5 * 60_000
  }

  /** Whether a credential's own claim belongs to this store's region. */
  private matchesRegion(credential: TraeCredential): boolean {
    return this.region === undefined || regionOfCredential(credential) === this.region
  }

  /**
   * The path this store refreshes into: the per-region file for a
   * region-scoped store, the legacy single file otherwise, or an explicitly
   * injected path in tests.
   */
  ownAuthPath(): string {
    if (this.ownPathExplicit !== undefined) return this.ownPathExplicit
    return this.region !== undefined ? traeOwnAuthPath(this.region) : this.legacyOwnPath
  }

  /**
   * Every plugin-owned copy to read, most preferred first. A region-scoped
   * store reads the legacy single copy as its migration source (readAll's
   * region filter drops it when it carries the other region's credential); an
   * unscoped store reads everything so diagnostics see both regions.
   *
   * With an explicitly injected own path the legacy source is read ONLY when
   * it was injected too — a test that pins one file must not accidentally see
   * the real machine's legacy copy.
   */
  private ownCandidates(): string[] {
    if (this.ownPathExplicit !== undefined) {
      return this.legacyOwnPathExplicit !== undefined
        ? [this.ownPathExplicit, this.legacyOwnPathExplicit]
        : [this.ownPathExplicit]
    }
    if (this.region !== undefined) {
      return [traeOwnAuthPath(this.region), this.legacyOwnPath]
    }
    return [this.legacyOwnPath, traeOwnAuthPath('cn'), traeOwnAuthPath('ai')]
  }

  setSource(storagePath: string | undefined, edition: TraeEdition | 'auto' = 'auto', accountId?: string): void {
    this.storagePathOverride = storagePath
    this.edition = edition
    this.accountId = accountId
    this.inflight = undefined
  }

  selectAccount(accountId: string | undefined): void {
    this.accountId = accountId
    this.inflight = undefined
  }

  candidates(): TraeStorageCandidate[] {
    if (this.storagePathOverride !== undefined) {
      const edition = this.edition === 'auto' ? 'cn' : this.edition
      // An explicit override points at a user-supplied file whose shape is not
      // known ahead of time, so it is probed as both a desktop storage document
      // and a CLI token file.
      return [
        { edition, path: this.storagePathOverride, source: 'desktop' },
        { edition, path: this.storagePathOverride, source: 'cli' },
      ]
    }
    const all = traeStorageCandidates()
    // Every desktop edition is discovered (the plugin routes by the
    // credential's own region, see region.ts); an explicit `edition` config
    // narrows the scan. The international CLI home (`~/.trae`) stays excluded:
    // its bare JWT carries no host claim and the SG default host has not been
    // verified (docs/INTL_SG_EVIDENCE.md §5), so only the CN CLI home
    // (`.trae-cn`) is probed.
    const cliEdition: TraeEdition = 'cn'
    return this.edition === 'auto'
      ? all.filter(candidate => candidate.source === 'desktop' || candidate.edition === cliEdition)
      : all.filter(candidate => candidate.edition === this.edition && (candidate.source === 'desktop' || candidate.edition === cliEdition))
  }

  /**
   * Deterministic default when no account is explicitly selected: the first
   * discovered account. This is NOT credit-seeking — it never reorders accounts
   * to find one with general credits. The plugin bills exactly the account the
   * user selected, or the first account when nothing has been selected yet.
   */
  private preferred(credentials: TraeCredential[]): TraeCredential | undefined {
    return credentials[0]
  }

  async accounts(): Promise<TraeAccountChoice[]> {
    const credentials = await this.readAll()
    const selectedExists = this.accountId !== undefined && credentials.some(credential => traeAccountId(credential) === this.accountId)
    const defaultSelected = this.preferred(credentials)
    return credentials.map(credential => ({
      id: traeAccountId(credential),
      accountName: credential.accountName ?? (credential.userId || `${credential.edition} account`),
      edition: credential.edition,
      region: regionOfCredential(credential),
      source: credential.source,
      tokenExpiresAtMs: credential.expiresAtMs,
      selected: selectedExists ? traeAccountId(credential) === this.accountId : credential === defaultSelected,
    }))
  }

  async current(): Promise<TraeCredential | undefined> {
    const credentials = await this.readAll()
    if (this.accountId === undefined) return this.preferred(credentials)
    const selected = credentials.find(credential => traeAccountId(credential) === this.accountId)
    // A saved account can disappear when Trae replaces its local login. Do NOT
    // silently fall back to a different account: that would bill a different
    // account than the one the user explicitly selected. Return undefined so the
    // caller surfaces "no signed-in account" and the user can re-select, instead
    // of the plugin quietly switching accounts behind their back.
    return selected
  }

  /**
   * The stored credential of one specific account, without changing which
   * account this store is bound to (issue #25).
   *
   * The card needs to answer "the account I am bound to has run out of credits
   * — is another account on this machine usable?" and {@link resolve} cannot
   * help: it always returns the BOUND account, and switching the bound account
   * just to read one number would race every in-flight chat request sharing
   * this store, and would persist a selection the user never made.
   *
   * So this is a pure lookup: read-only, no refresh side effects (a stale token
   * is returned as-is and the caller's request then fails honestly), and
   * `accountId` is left untouched. An unknown id yields undefined rather than a
   * fallback, for the same reason {@link current} refuses to fall back.
   */
  async credentialOf(accountId: string): Promise<TraeCredential | undefined> {
    if (accountId === '') return undefined
    const credentials = await this.readAll()
    return credentials.find(credential => traeAccountId(credential) === accountId)
  }

  async resolve(): Promise<TraeCredential> {
    const credential = await this.current()
    if (credential === undefined) throw new Error(`trae: no signed-in account found (${this.candidates().map(item => item.path).join(' or ')})`)
    if (credential.expiresAtMs > Date.now() + this.refreshMarginMs) return credential
    this.inflight ??= this.refreshNow(credential).finally(() => { this.inflight = undefined })
    return this.inflight
  }

  async status(): Promise<{ state: 'signed-in' | 'signed-out'; edition?: TraeEdition; expiresAtMs?: number; source?: TraeCredential['source'] }> {
    try {
      const value = await this.current()
      return value === undefined ? { state: 'signed-out' } : { state: 'signed-in', edition: value.edition, expiresAtMs: value.expiresAtMs, source: value.source }
    } catch { return { state: 'signed-out' } }
  }

  async desktopFilePresent(): Promise<boolean> {
    for (const candidate of this.candidates()) {
      try { if ((await stat(candidate.path)).isFile()) return true } catch {}
    }
    return false
  }

  /**
   * Remove every plugin-owned copy this store could read (per-region file,
   * legacy single file, and their lock siblings); the desktop storage files
   * are untouched. A region store's logout therefore also clears the legacy
   * migration source — deliberate: `logout` is the user's "forget what the
   * plugin stored" action, not a per-account toggle.
   */
  async logout(): Promise<void> {
    for (const path of this.ownCandidates()) {
      await rm(path, { force: true })
      await rm(`${path}.lock`, { force: true })
    }
  }

  /**
   * Every local credential of this store's region, deduplicated by account id.
   * A region-scoped store sees only its own region's credentials: the other
   * region's accounts are invisible to selection, refresh, and status alike,
   * which is what keeps the two regions' providers from cross-billing.
   */
  private async readAll(): Promise<TraeCredential[]> {
    const { credentials: desktop } = await this.readDesktopAll()
    const scoped = desktop.filter(credential => this.matchesRegion(credential))
    // The own copies are accepted for every edition: they are refresh results
    // the plugin itself wrote, so an international account's refreshed
    // credential must not be dropped just because it is not a CN edition.
    const credentials = [...scoped]
    for (const own of await this.readOwns()) {
      if (!this.matchesRegion(own)) continue
      if (credentials.some(credential => traeAccountId(credential) === traeAccountId(own))) continue
      credentials.push(own)
    }
    return credentials
  }

  /**
   * Which paths were tried and why each one failed. Read-only and token-free:
   * it exists so a signed-out card can explain itself instead of showing a bare
   * "not signed in", which is undiagnosable on a machine whose layout differs
   * from the ones the plugin was written against.
   */
  async diagnose(): Promise<{ tried: TraeStorageCandidate[]; failures: TraeCandidateFailure[] }> {
    const tried = this.candidates()
    const failures: TraeCandidateFailure[] = []
    for (const candidate of tried) {
      const raw = await readFile(candidate.path, 'utf8').then(
        text => ({ text }),
        (error: unknown) => ({ error }),
      )
      if ('error' in raw) {
        const code = typeof raw.error === 'object' && raw.error !== null && 'code' in raw.error
          ? (raw.error as { code?: unknown }).code
          : undefined
        failures.push({
          path: candidate.path,
          edition: candidate.edition,
          source: candidate.source,
          reason: code === 'ENOENT' ? 'missing' : 'unreadable',
          ...code === 'ENOENT' ? {} : { message: String(raw.error) },
        })
        continue
      }
      try {
        this.credentialFrom(candidate, raw.text)
      } catch (error: unknown) {
        failures.push({
          path: candidate.path,
          edition: candidate.edition,
          source: candidate.source,
          reason: 'invalid',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { tried, failures }
  }

  /** Parse one candidate file's text into a credential, or throw. */
  private credentialFrom(candidate: TraeStorageCandidate, text: string): TraeCredential {
    let credential: TraeCredential | undefined
    if (candidate.source === 'cli') {
      // The CLI token carries no host claim and no userRegion, so the CN host
      // is used rather than an empty string. Only the CN CLI home
      // (`.trae-cn`) is verified: an international CLI token cannot be routed
      // correctly yet (see docs/INTL_SG_EVIDENCE.md §5) and is rejected with
      // a diagnosable error instead of being silently misrouted to the CN
      // gateway.
      if (regionOfEdition(candidate.edition) !== 'cn') {
        throw new Error(`Trae CLI tokens are only verified for the CN region; ${candidate.edition} CLI homes are not supported yet`)
      }
      const claims = parseTraeCliToken(text)
      credential = normalizeTraeCredential({
        token: claims.accessToken,
        userId: claims.userId,
        host: CLI_DEFAULT_HOST,
        expiredAt: claims.expiresAtMs,
      }, candidate.edition, 'cli')
    } else {
      credential = normalizeTraeCredential(parseTraeStorageDocument(text), candidate.edition, 'desktop')
    }
    if (credential === undefined) throw new Error(`${candidate.source} candidate could not be normalized into a credential`)
    return credential
  }

  private async readDesktopAll(): Promise<{ credentials: TraeCredential[]; failures: TraeCandidateFailure[] }> {
    const credentials: TraeCredential[] = []
    const failures: TraeCandidateFailure[] = []
    for (const candidate of this.candidates()) {
      try {
        const credential = this.credentialFrom(candidate, await readFile(candidate.path, 'utf8'))
        if (!credentials.some(existing => traeAccountId(existing) === traeAccountId(credential))) credentials.push(credential)
      } catch (error: unknown) {
        // One stale, partially written, unsupported, or signed-out Trae
        // installation must not hide valid accounts from the others. The
        // failure is recorded rather than dropped so `diagnose()` can explain
        // an otherwise silent "not signed in".
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined
        failures.push({
          path: candidate.path,
          edition: candidate.edition,
          source: candidate.source,
          reason: code === 'ENOENT' ? 'missing' : code === undefined ? 'invalid' : 'unreadable',
          ...code === 'ENOENT' || (code === undefined && !(error instanceof Error)) ? {} : { message: error instanceof Error ? error.message : String(error) },
        })
        continue
      }
    }
    return { credentials, failures }
  }

  /**
   * Every readable plugin-owned copy, in candidate order; absent or corrupt
   * files are skipped rather than propagated.
   */
  private async readOwns(): Promise<TraeCredential[]> {
    const copies: TraeCredential[] = []
    for (const path of this.ownCandidates()) {
      try {
        const parsed = parseOwn(await readFile(path, 'utf8'))
        if (parsed !== undefined) copies.push(parsed)
      } catch {
        // absent or unreadable — the next candidate is tried
      }
    }
    return copies
  }

  private async refreshNow(credential: TraeCredential): Promise<TraeCredential> {
    if (credential.refreshToken === undefined || (credential.refreshExpiresAtMs !== undefined && credential.refreshExpiresAtMs <= Date.now())) {
      if (credential.expiresAtMs > Date.now() + 30_000) return credential
      throw new Error('trae: access token expired and no valid refresh token is available; sign in again in Trae')
    }
    try {
      const outcome = await this.refresh(credential)
      const refreshed: TraeCredential = {
        ...credential,
        accessToken: outcome.accessToken,
        ...outcome.refreshToken === undefined ? {} : { refreshToken: outcome.refreshToken },
        expiresAtMs: outcome.expiresAtMs,
        ...outcome.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: outcome.refreshExpiresAtMs },
        ...outcome.host === undefined ? {} : { host: outcome.host },
        source: 'dsh',
      }
      const ownPath = this.ownAuthPath()
      await withFileLock(ownPath, async () => {
        await writeFileAtomic(ownPath, `${JSON.stringify({ version: OWN_VERSION, credential: refreshed }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      })
      return refreshed
    } catch (error: unknown) {
      if (credential.expiresAtMs > Date.now() + 30_000) return credential
      throw new Error(`trae: token refresh failed and access token is expired (${String(error)}); sign in again in Trae`)
    }
  }
}
