import { copyFile, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  encryptTraeStorageValue,
  parseTraeAuthValue,
  parseTraeCliToken,
  parseTraeStorageDocument,
  traeStorageValueType,
  TRAE_AUTH_STORAGE_KEY,
} from './decrypt.ts'
import { traeStorageCandidates, type TraeCredentialSource, type TraeEdition, type TraeStorageCandidate } from './paths.ts'
import { assertSupportedRegion, isSupportedRegion, regionOfCredential, regionOfEdition, TraeUnsupportedRegionError, type TraeRegion, type TraeServiceRegion } from './region.ts'
import { probeRunningTraeApps, type RunningProbe } from './trae-process.ts'

export interface TraeCredential {
  accessToken: string
  refreshToken?: string
  userId: string
  accountName?: string
  /**
   * Trae tenant this account belongs to (`account.tenant_id`, e.g. `272193024`
   * for a `tob_online` enterprise), absent for a personal account.
   *
   * This is what decides whether the ENTERPRISE pool can serve the account at
   * all. The tenant gateway accepts any CN token for its DIRECTORY read — a
   * personal account gets the full 49-model roster back — so "the roster
   * loaded" proves nothing about billing rights. Its chat endpoint is what
   * refuses: a personal account answers `4019` (risk control), a tenant account
   * streams normally. Because the two are indistinguishable from the roster,
   * the account list itself has to carry the flag.
   */
  tenantId?: string
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
  /**
   * Only consider credentials that belong to a Trae tenant.
   *
   * The enterprise panel's store runs with this on: a personal account cannot
   * bill that pool, and because the tenant gateway still serves it a directory,
   * binding it here would fail only at the first chat (`4019`). With the flag
   * set, an explicit binding to a personal account falls through to the preferred
   * TENANT account instead of being silently honoured.
   */
  requireTenant?: boolean
  /**
   * Withhold TENANT (enterprise) accounts from this store's account list.
   *
   * Set on the consumer panels: an enterprise login belongs to the enterprise
   * panel, and offering it here would let a tenant account be bound to the
   * personal pool without the user ever seeing which pool they picked. A
   * machine that has ONLY a tenant login still resolves it — an empty list must
   * not turn a working install into "signed out" — so the filter is applied to
   * the OFFERED list, never to the resolved credential.
   */
  hideTenantAccounts?: boolean
  /** Legacy single-copy path read as a migration source; injectable for tests. */
  legacyOwnPath?: string
  refresh: (credential: TraeCredential) => Promise<TraeRefreshOutcome>
  refreshMarginMs?: number
  /**
   * Which Trae desktop apps are running right now. Injectable so the deletion
   * tests never depend on the machine they run on; defaults to the real probe.
   */
  runningApps?: RunningProbe
}

export interface TraeAccountChoice {
  id: string
  accountName: string
  edition: TraeEdition
  /**
   * Whether this account may bill the CN ENTERPRISE pool.
   *
   * Derived from the credential's own tenant claim, because nothing else can
   * tell: the tenant gateway answers a directory read for ANY CN token, so a
   * personal account looks perfectly serviceable right up to its first chat,
   * which it answers with `4019`. The enterprise panel filters its account list
   * and its default binding on this flag.
   */
  enterprise: boolean
  /** Routing bucket of this account (`cn` | `ai`), derived from its credential. */
  region: TraeRegion
  source: 'desktop' | 'dsh' | 'cli'
  tokenExpiresAtMs: number
  /**
   * When this account's refresh token lapses, when the credential carries one.
   * The access token above renews itself automatically until this expires; see
   * the mirror field on `TraeWebAccount` in status-paths.ts for why the card
   * needs it.
   */
  refreshExpiresAtMs?: number
  selected: boolean
}

/**
 * A credential on this machine that names a region this build cannot serve yet
 * (issue #66: the US cluster).
 *
 * Reported so the card can explain a signed-out panel that a user knows is
 * signed in. It is never selectable and never billed: `readAll()` skips these,
 * so they cannot reach a gateway at all.
 */
export interface TraeUnsupportedCredential {
  region: Exclude<TraeServiceRegion, TraeRegion>
  /** Display identity of the credential — never token material. */
  accountName: string
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

/**
 * A plugin-owned copy that was found UNREADABLE and therefore moved aside.
 *
 * Since 4.4.6 a copy this build cannot parse is never merged over: it is
 * renamed to `<file>.corrupt-<stamp>` (bytes intact, recoverable) and the merge
 * restarts from a clean file. That trade — a quarantined copy instead of a
 * silently emptied one — is only fair if the USER can see it happened, because
 * the accounts the copy carried are, from that moment on, only in the
 * quarantine file.
 *
 * This notice is what makes that visible: the card's diagnostics panel shows
 * it, and so does the signed-out screen — which is exactly the state a user
 * lands in after the loss (issue #56).
 */
export interface TraeQuarantineNotice {
  /** The live path the copy had before it was moved aside. */
  file: string
  /** The quarantine copy's full path; its name carries the moment it was taken. */
  quarantinedAs: string
  /** Size of the quarantined copy in bytes (`0` when it could not be read). */
  bytes: number
  /**
   * How many accounts the quarantined copy held, when it could still be read
   * as JSON. A copy quarantined for being TORN cannot be counted, and this is
   * then absent rather than guessed.
   */
  accounts?: number
}

/** Host used for CLI tokens, which carry no host claim of their own. */
const CLI_DEFAULT_HOST = 'https://api.trae.cn'

/**
 * On-disk format of the plugin-owned per-region file.
 *
 * Version 1 held exactly ONE credential (`{ version, credential }`), which was
 * enough while every account came from a Trae install the plugin can discover
 * itself. Import (issue #37) breaks that assumption: a user can hold several
 * accounts as transferable files, and they have to live somewhere. Version 2
 * keeps the same per-region file but stores `{ version, credentials: [...] }`
 * instead, so the file stays the unit of region isolation (see
 * {@link traeOwnAuthPath}) while holding as many accounts as were imported.
 *
 * Version 1 remains READ (see {@link parseOwn}), so an existing install keeps
 * working and upgrades itself the next time a credential is written; it is
 * never written again.
 */
/**
 * How long a FAILED per-account refresh is remembered.
 *
 * Long enough that a revoked refresh token costs one exchange per five minutes
 * instead of two per card poll, short enough that a transient network failure is
 * retried on the next screen the user opens.
 */
const REFRESH_RETRY_MS = 5 * 60_000

const OWN_VERSION = 2
/** The superseded single-credential layout, still read for migration. */
const OWN_VERSION_SINGLE = 1
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

/**
 * Where the "this copy was deleted on purpose" tombstones live.
 *
 * The store mirrors every local Trae login into its own copy on each refresh
 * (see `mirrorLocalLogins`). Without a tombstone the mirror would recreate a
 * copy the user just deleted on the very next poll — "delete" would look broken
 * again, which is the exact complaint this mechanism exists to fix. A tombstone
 * therefore suppresses the mirror for one account id, and is dropped as soon as
 * that id is no longer signed in to the app: a later sign-in is a NEW login and
 * is mirrored again.
 */
export function traeDeletedAccountsPath(region?: TraeRegion): string {
  return join(resolveDshHome(), region === undefined ? '.trae-deleted.json' : `${TRAE_OWN_PREFIX}.deleted.${region}.json`)
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
  // `tenant_id` is a number or a string depending on the client that wrote it.
  const tenantId = optionalString(account?.['tenant_id']) ?? (typeof account?.['tenant_id'] === 'number' ? String(account['tenant_id']) : undefined)
  return {
    accessToken,
    ...refreshToken === undefined ? {} : { refreshToken },
    userId: optionalString(value['userId']) ?? '',
    ...accountName === undefined ? {} : { accountName },
    ...tenantId === undefined ? {} : { tenantId },
    host: optionalString(value['host']) ?? '',
    ...userRegion === undefined ? {} : { userRegion },
    expiresAtMs,
    ...refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs },
    edition,
    source,
  }
}

/**
 * Whether this account belongs to a Trae tenant, i.e. may bill the enterprise
 * pool.
 *
 * Evidence (2026-10-17, live): the tenant's own account carries
 * `account.tenant_id` / `tenant_name` and `scope: 'saas'`; the personal SOLO
 * account carries neither and reports `scope: 'marscode'`. Only the tenant one
 * streams on the enterprise gateway — the other answers `4019` risk control.
 */
export function isEnterpriseAccount(credential: Pick<TraeCredential, 'tenantId'> | undefined): boolean {
  return credential?.tenantId !== undefined && credential.tenantId.trim() !== ''
}

export function traeAccountId(credential: Pick<TraeCredential, 'edition' | 'userId' | 'accountName'>): string {
  const stable = `${credential.edition}\0${credential.userId || credential.accountName || 'unknown'}`
  return createHash('sha256').update(stable).digest('hex').slice(0, 24)
}

/**
 * The exact shape of an account id — sha256 hex sliced to 24 characters, which is
 * what {@link traeAccountId} emits and therefore the only string a request may
 * legitimately name.
 *
 * This regex is a traversal guard as much as a validator: an id becomes part of a
 * path (`$DSH_HOME/.trae-pool.<panel>.json` uses it as a key, and a credential
 * lookup receives it), so `../../etc/passwd` has to fail here rather than fail
 * somewhere closer to the filesystem. Exported so an HTTP route can answer a bad
 * id with 400 instead of letting an exception surface as a 500.
 */
export const TRAE_ACCOUNT_ID_RE = /^[0-9a-f]{24}$/

/** Whether a request-supplied value is a well-formed Trae account id. */
export function isTraeAccountId(value: unknown): value is string {
  return typeof value === 'string' && TRAE_ACCOUNT_ID_RE.test(value)
}

/** One stored credential, validated. Returns undefined for a malformed row. */
function credentialOfStored(stored: unknown): TraeCredential | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined
  const record = stored as Record<string, unknown>
  const edition = record['edition']
  if (edition !== 'cn' && edition !== 'sg' && edition !== 'solo' && edition !== 'solo-sg') return undefined
  return normalizeTraeCredential({
    token: record['accessToken'], refreshToken: record['refreshToken'], userId: record['userId'], host: record['host'],
    userRegion: record['userRegion'],
    account: record['accountName'] === undefined && record['tenantId'] === undefined
      ? undefined
      : { ...record['accountName'] === undefined ? {} : { username: record['accountName'] }, ...record['tenantId'] === undefined ? {} : { tenant_id: record['tenantId'] } },
    expiredAt: record['expiresAtMs'], refreshExpiredAt: record['refreshExpiredAtMs'],
  }, edition, 'dsh')
}

/**
 * Read the plugin-owned file into its stored credentials.
 *
 * Accepts BOTH layouts: version 2 (`credentials: [...]`, the import-capable
 * shape) and the superseded version 1 (`credential: {...}`). A version-1 file
 * keeps working until the next write upgrades it, so no migration step is
 * needed and an older install's file is never rejected. A malformed row is
 * dropped rather than failing the whole file — one bad imported account must
 * not hide the rest.
 *
 * Returns `undefined` — NOT an empty array — for a file this build cannot parse
 * at all: a torn JSON write, a hand-edited document, or a version nothing here
 * knows. The distinction is load-bearing (see {@link readOwnForMerge}): every
 * merge writer treats `[]` as the merge base but `undefined` as "do not build
 * on this", because an unparseable file may still HOLD every account, and
 * merging onto "empty" would erase them on the very next refresh.
 */
function parseOwn(text: string): TraeCredential[] | undefined {
  let document: { version?: unknown; credential?: unknown, credentials?: unknown }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    document = parsed as { version?: unknown; credential?: unknown, credentials?: unknown }
  } catch { return undefined }
  if (document.version === OWN_VERSION) {
    if (!Array.isArray(document.credentials)) return undefined
    return document.credentials.map(credentialOfStored).filter((value): value is TraeCredential => value !== undefined)
  }
  if (document.version === OWN_VERSION_SINGLE) {
    const single = credentialOfStored(document.credential)
    return single === undefined ? undefined : [single]
  }
  return undefined
}

/**
 * Move a plugin-owned file this build can no longer parse out of the way, so
 * the next write starts from a clean file instead of building on — or being
 * refused by — the unreadable one.
 *
 * The rename is the data preservation: the bytes stay on disk beside the live
 * path (`.corrupt-<stamp>`), so a future build that understands the format (or
 * a user with a text editor) can still recover the accounts it carried. It is
 * best-effort on purpose: a quarantine that cannot happen must not fail the
 * user action that triggered it, and the merge writers refuse to overwrite a
 * file they could not quarantine (see {@link readOwnForMerge}).
 *
 * Must be called under the same lock the caller writes under: without the lock
 * the rename could interleave with a concurrent writer holding the pre-rename
 * content and write it right back.
 */
async function quarantineCorruptOwn(path: string): Promise<boolean> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try {
    await rename(path, `${path}.corrupt-${stamp}`)
    return true
  } catch {
    return false
  }
}

/**
 * Write the plugin-owned file: every credential of the region, in the version-2
 * array layout.
 *
 * One writer for both paths that persist to this file (a refresh, and an
 * import) so the read-modify-write in `refreshNow` and the additive write in
 * {@link TraeCredentialStore.importAccounts} cannot drift apart. Always writes
 * `OWN_VERSION`, which is what upgrades a version-1 file on its first write.
 */
async function writeOwn(path: string, credentials: readonly TraeCredential[]): Promise<void> {
  const document = { version: OWN_VERSION, credentials: credentials.map(credential => ({ ...credential })) }
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * How many accounts a quarantined copy still shows, when it can be read at all.
 *
 * A copy is quarantined because this build could not PARSE it — but not every
 * unparseable copy is unreadable: a file whose JSON is intact yet carries a
 * version this build does not know still parses as JSON, and its account rows
 * are then countable. That number is what tells the user whether one account
 * or five went missing, so it is worth the attempt.
 *
 * A torn copy yields nothing: the count is then ABSENT rather than guessed,
 * because a wrong count is worse than no count.
 */
function countStoredAccounts(text: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const document = parsed as { credential?: unknown, credentials?: unknown }
    if (Array.isArray(document.credentials)) return document.credentials.length
    if (document.credential !== undefined) return 1
    return undefined
  } catch {
    return undefined
  }
}

/** The key Trae stores the per-user region map under, beside the login itself. */
const TRAE_USERTAG_STORAGE_KEY = 'iCubeAuthInfo://usertag'

/**
 * Rewrites one Trae `storage.json` so it no longer carries the given login.
 *
 * Everything else in the document is preserved byte-for-byte at the JSON level:
 * only the auth value is dropped and the usertag map loses this one user. Both
 * the backup and the atomic write exist because this is the one operation in the
 * plugin that edits a file belonging to another application.
 */
async function eraseDesktopLogin(
  path: string,
  document: Record<string, unknown>,
  claims: Record<string, unknown>,
  encoded: string,
): Promise<boolean> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try {
    await copyFile(path, `${path}.dsh-backup-${stamp}`)
  } catch { return false }
  const next: Record<string, unknown> = { ...document }
  delete next[TRAE_AUTH_STORAGE_KEY]
  const userTag = document[TRAE_USERTAG_STORAGE_KEY]
  const userId = typeof claims['userId'] === 'string' || typeof claims['userId'] === 'number'
    ? String(claims['userId'])
    : undefined
  if (userId !== undefined && typeof userTag === 'string') {
    try {
      const decoded = parseTraeAuthValue(userTag)
      if (typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)) {
        const tags = { ...(decoded as Record<string, unknown>) }
        delete tags[userId]
        next[TRAE_USERTAG_STORAGE_KEY] = encryptTraeStorageValue(JSON.stringify(tags), traeStorageValueType(userTag))
      }
    } catch {
      // An unreadable usertag map is left untouched: dropping the login is the
      // point, and a map we cannot decode is not worth risking.
    }
  }
  try {
    await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    // Read back before claiming success: another writer (the app, if the probe
    // missed it) could have replaced the file between write and verify.
    const check = await readFile(path, 'utf8')
    return !check.includes(encoded)
  } catch { return false }
}

export class TraeCredentialStore {
  private storagePathOverride: string | undefined
  private edition: TraeEdition | 'auto'
  private accountId: string | undefined
  private readonly region: TraeRegion | undefined
  private readonly requireTenant: boolean
  private readonly hideTenantAccounts: boolean
  private readonly ownPathExplicit: string | undefined
  private readonly legacyOwnPath: string
  private readonly legacyOwnPathExplicit: string | undefined
  private readonly refresh: TraeCredentialStoreOptions['refresh']
  private readonly refreshMarginMs: number
  private readonly runningApps: RunningProbe
  private inflight: Promise<TraeCredential> | undefined
  /**
   * In-flight refreshes of individual accounts, one per account id.
   *
   * The card reads every member's balance in one poll and each balance can
   * decide to refresh, so without this dedupe the same account would exchange
   * its token several times in a second and the last writer would win over a
   * copy another read already holds.
   */
  private readonly inflightByAccount = new Map<string, Promise<TraeCredential>>()
  /**
   * When a per-account refresh last FAILED, so a dead refresh token is not
   * exchanged again on every poll.
   *
   * The card reads every member's balance on each refresh, and a revoked refresh
   * token fails forever: without this memo each poll would spend two upstream
   * calls (the current contract and the superseded one) on an account no retry
   * can fix. Five minutes keeps a transient network failure cheap to retry while
   * a revoked sign-in costs almost nothing.
   */
  private readonly refreshFailedAtMs = new Map<string, number>()
  /**
   * The account the NEXT request should bill, when a pool — not the user's
   * binding — is choosing (issue #44).
   *
   * Runtime only, never persisted: the binding in settings is what a save
   * writes and what the card's account table reports as selected, while this is
   * "who serves right now". Keeping them apart is what lets the pool rotate
   * without silently rewriting the user's choice, and what makes turning the
   * pool off restore the bound account with no rebind at all.
   */
  private rotatedAccountId: string | undefined

  constructor(options: TraeCredentialStoreOptions) {
    this.storagePathOverride = options.storagePath
    this.edition = options.edition ?? 'auto'
    this.accountId = options.accountId
    this.region = options.region
    this.requireTenant = options.requireTenant === true
    this.hideTenantAccounts = options.hideTenantAccounts === true
    this.ownPathExplicit = options.ownPath
    this.legacyOwnPath = options.legacyOwnPath ?? legacyTraeOwnAuthPath()
    this.legacyOwnPathExplicit = options.legacyOwnPath
    this.refresh = options.refresh
    this.refreshMarginMs = options.refreshMarginMs ?? 5 * 60_000
    this.runningApps = options.runningApps ?? probeRunningTraeApps
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

  /**
   * Where the "deleted copy" tombstones live for this store.
   *
   * Derived from the store's own copy path, so a test that pins `ownPath` also
   * pins the tombstones and can never touch the real `~/.dsh` file.
   */
  deletedPath(): string {
    if (this.ownPathExplicit !== undefined) return `${this.ownPathExplicit}.deleted`
    if (this.legacyOwnPathExplicit !== undefined) return `${this.legacyOwnPathExplicit}.deleted`
    return traeDeletedAccountsPath(this.region)
  }

  /**
   * The account ids whose copy the user deleted on purpose.
   *
   * Read defensively: a missing, unreadable, or hand-edited file means "no
   * tombstones", never a failing store — losing the list only re-mirrors an
   * account, it never locks the user out.
   */
  private async readTombstones(): Promise<Set<string>> {
    const text = await readFile(this.deletedPath(), 'utf8').catch(() => '')
    if (text.trim() === '') return new Set()
    try {
      const parsed = JSON.parse(text) as unknown
      const ids = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { ids?: unknown }).ids)
          ? (parsed as { ids: unknown[] }).ids
          : []
      return new Set(ids.filter((id): id is string => typeof id === 'string' && TRAE_ACCOUNT_ID_RE.test(id)))
    } catch { return new Set() }
  }

  /**
   * Read, mutate, and write the tombstone list under ONE lock.
   *
   * The tombstone file is read-modify-write state shared by two flows that run
   * concurrently: `mirrorLocalLogins` (drops tombstones whose logins are gone)
   * and `deleteAccount` (adds the id just deleted). A read OUTSIDE the write's
   * lock loses updates in both directions — a dropped-add resurrects a deleted
   * account on the next mirror, a dropped-drop keeps a tombstone forever and
   * hides every future sign-in of that account. The mutator therefore runs on
   * the freshly-read set INSIDE the lock, and what it returns is what gets
   * written, with no window in between.
   *
   * Fire-and-forget safe: a failed update only delays a tombstone change until
   * the next mirror or delete, so errors are swallowed like the readers'.
   */
  private async updateTombstones(mutator: (ids: Set<string>) => void): Promise<void> {
    const path = this.deletedPath()
    await withFileLock(path, async () => {
      const ids = await this.readTombstones()
      mutator(ids)
      await writeFileAtomic(path, `${JSON.stringify({ version: 1, ids: [...ids] }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
    }).catch(() => undefined)
  }

  /**
   * Read the plugin-owned file as the merge base for a read-modify-write.
   *
   * This is the fail-safe that keeps one unreadable file from erasing every
   * account: `parseOwn` now distinguishes a VALID empty file (`[]`) from one
   * this build cannot parse (`undefined`), and only the former may serve as a
   * merge base. For the latter the file is quarantined — renamed aside with
   * its bytes intact — and the merge then starts from nothing, so the action
   * the user pressed still succeeds and the lost entries are recoverable from
   * the quarantine copy instead of being overwritten silently. A quarantine
   * that fails (an exotic filesystem, a name collision) aborts the write
   * instead: losing one refresh is recoverable by pressing it again, losing
   * every account is not.
   *
   * Every caller must hold the {@link withFileLock} of `path` across BOTH the
   * read and the subsequent write — this does not lock by itself.
   */
  private async readOwnForMerge(path: string): Promise<TraeCredential[] | undefined> {
    const text = await readFile(path, 'utf8').catch(() => undefined)
    if (text === undefined) return []
    const parsed = parseOwn(text)
    if (parsed !== undefined) return parsed
    return (await quarantineCorruptOwn(path)) ? [] : undefined
  }

  /**
   * Copy every local Trae sign-in into this store's own file, once.
   *
   * The plugin presents COPIES, not the app's live login: the app has a single
   * sign-in slot that the next Trae login overwrites, so an account could only
   * ever be billed until the user switched apps. Keeping a copy per account is
   * what makes a multi-account pool survive those switches.
   *
   * This runs on every `accounts()` read — the card's refresh, the pool's member
   * read, the "detect accounts" press — and is additive:
   *   - an account that already has a copy is left exactly as it is (the copy
   *     may hold a token this plugin refreshed, which is fresher than the app's);
   *   - an account the user DELETED stays deleted while it is still signed in to
   *     the app, via a tombstone that is dropped once the app no longer holds it
   *     (so a later sign-in is mirrored again).
   */
  private async mirrorLocalLogins(): Promise<void> {
    const { credentials: discovered } = await this.readDesktopAll()
    const own = await this.readOwns()
    const ownIds = new Set(own.map(credential => traeAccountId(credential)))
    const liveIds = new Set(discovered.map(credential => traeAccountId(credential)))
    // The tombstone drop and the mirror write below run in that order but are
    // independent files; the drop is atomic here, under the tombstone lock.
    const tombstones = await this.readTombstones()
    const stale = [...tombstones].some(id => !liveIds.has(id))
    if (stale) await this.updateTombstones(ids => { for (const id of [...ids]) { if (!liveIds.has(id)) ids.delete(id) } })
    const missing = discovered.filter(credential =>
      this.matchesRegion(credential)
      && !ownIds.has(traeAccountId(credential))
      && !tombstones.has(traeAccountId(credential)))
    if (missing.length === 0) return
    const ownPath = this.ownAuthPath()
    await withFileLock(ownPath, async () => {
      const existing = await this.readOwnForMerge(ownPath)
      // A file we could not parse AND could not quarantine is not a base to
      // write over: skipping the mirror keeps the bytes on disk untouched.
      if (existing === undefined) return
      const byId = new Map(existing.map(credential => [traeAccountId(credential), credential]))
      for (const credential of missing) {
        const id = traeAccountId(credential)
        // Re-check under the lock: a concurrent refresh may have written the
        // copy between the read above and this write.
        if (byId.has(id)) continue
        byId.set(id, { ...credential, source: 'dsh' })
      }
      await writeOwn(ownPath, [...byId.values()])
    })
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
   * Deterministic default when no account is explicitly selected: the account
   * the Trae desktop app is signed in to RIGHT NOW, else the first discovered
   * one. This is NOT credit-seeking — it never reorders accounts to find one
   * with general credits. The plugin bills exactly the account the user
   * selected, the app's current sign-in when nothing has been selected, and
   * only then the first account.
   *
   * The app's live sign-in outranks the plugin's own refreshed copies (issue
   * #29): after the user switches accounts in Trae, the desktop storage file
   * holds the NEW login while the plugin's copy of the old one still resolves,
   * so a bare `credentials[0]` kept defaulting to a sign-in the app has
   * abandoned — and `dsh-connect-workbuddy`, whose `preferred()` ranks the live
   * file first, followed the app instead. Ordering only: the VALUE behind an
   * account id is still whichever copy expires later (`readAll`), so a refresh
   * the plugin performed is never discarded by this preference.
   */
  private preferred(credentials: TraeCredential[]): TraeCredential | undefined {
    const eligible = this.requireTenant
      ? credentials.filter(credential => isEnterpriseAccount(credential))
      : credentials
    if (eligible.length === 0) return undefined
    return eligible.find(credential => credential.source === 'desktop') ?? eligible[0]
  }

  /**
   * The accounts this store is willing to OFFER.
   *
   * Scoped to who this store may bill:
   *   - a consumer store withholds tenant accounts (the enterprise pool is a
   *     separate tab and a separate billing decision), and
   *   - a tenant store withholds personal accounts (they cannot bill that
   *     pool; the tenant gateway answers their chat with 4019).
   *
   * Either filter backs off when it would hide EVERYTHING, so a machine whose
   * only login is on the other side keeps working instead of reading as
   * "signed out".
   */
  private offered(discovered: TraeCredential[]): TraeCredential[] {
    const eligible = this.requireTenant
      ? discovered.filter(credential => isEnterpriseAccount(credential))
      : this.hideTenantAccounts
        ? discovered.filter(credential => !isEnterpriseAccount(credential))
        : discovered
    return eligible.length > 0 ? eligible : discovered
  }

  async accounts(): Promise<TraeAccountChoice[]> {
    // Every read of the account list is also the refresh point: a local Trae
    // login that has no plugin copy yet gets one here, so the card and the pool
    // only ever deal in copies the plugin can bill, refresh, and delete.
    await this.mirrorLocalLogins()
    const discovered = await this.readAll()
    // The list SHOWS the accounts this store holds a copy of. A local login that
    // is not mirrored (deleted on purpose, or still being written) must not
    // reappear as a row the user cannot act on. The rows themselves are
    // `discovered` entries so their ORDER — and with it the "the app's live
    // sign-in is the default" rule — is unchanged; `readAll` already prefers the
    // freshest copy behind each account id.
    const copyIds = new Set<string>()
    for (const credential of await this.readOwns()) {
      if (!this.matchesRegion(credential)) continue
      copyIds.add(traeAccountId(credential))
    }
    const visible = discovered.filter(credential => copyIds.has(traeAccountId(credential)))
    const offered = this.offered(visible)
    const inUse = this.inUse(discovered, offered)
    /**
     * Never hide the account we are actually billing.
     *
     * An explicit binding outranks the display filter (`inUse` honours it even
     * when the offered list withholds it), and a list whose active row is
     * invisible is worse than no list: the card's "save the selected account"
     * press reads `selected`, so a hidden binding would be rewritten to whichever
     * account merely happened to be DISPLAYED — silently moving the user's
     * billing to an account they never chose. Re-appending it costs one extra
     * row and makes the card tell the truth.
     */
    const credentials = inUse !== undefined && !offered.includes(inUse) ? [...offered, inUse] : offered
    const inUseId = inUse === undefined ? undefined : traeAccountId(inUse)
    return credentials.map(credential => ({
      id: traeAccountId(credential),
      accountName: credential.accountName ?? (credential.userId || `${credential.edition} account`),
      edition: credential.edition,
      enterprise: isEnterpriseAccount(credential),
      // Safe by construction: `readAll()` drops any credential whose claim is
      // a region this build does not serve.
      region: assertSupportedRegion(regionOfCredential(credential)),
      // Every listed row is backed by a plugin copy (that is what `visible`
      // filters on), so the card names it as one: this store bills, refreshes,
      // and deletes its copy, never the app's live login.
      source: 'dsh' as const,
      tokenExpiresAtMs: credential.expiresAtMs,
      ...credential.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
      // Exactly one row reads as `selected`, and it is the SAME account
      // `current()` bills. Deriving this flag any other way is how the card and
      // the chat came to disagree.
      selected: inUseId !== undefined && traeAccountId(credential) === inUseId,
    }))
  }

  /**
   * The credential this store bills, given every credential it can see.
   *
   * This is the ONE resolution rule, and it exists so that `current()` and
   * `accounts()` cannot disagree: `current()` applies it to `readAll()`, and
   * `accounts()` applies the SAME verdict to decide which row reads as
   * `selected`. Deriving that flag independently is exactly how the two drifted
   * apart — and a card that marks a different account than the one the chat
   * bills is worse than no card at all, because a press that "saves the
   * selected account" then rewrites the binding to the account that was only
   * ever DISPLAYED.
   *
   * Order of business:
   *   1. No binding — the detected default (`preferred`) is in use, chosen from
   *      the OFFERED list rather than from every login on the machine. A
   *      consumer store that withholds tenant accounts must not default its
   *      billing to the tenant pool merely because that login sorts first;
   *      withholding is a billing decision, not a display detail.
   *   2. A binding — honour it verbatim, even when the OFFERED list hides that
   *      account. Resolution is never scoped by `hideTenantAccounts`: the user's
   *      explicit choice outranks a display filter.
   *   3. A tenant-scoped store cannot bill through a personal account, and the
   *      tenant gateway only reveals that at the first chat (`4019`). Honour the
   *      binding when it is eligible; otherwise fall back to the preferred
   *      tenant account, which is the one the user's enterprise tab is meant to
   *      use.
   *   4. A saved account can disappear when Trae replaces its local login. Do
   *      NOT silently fall back to a different account: that would bill a
   *      different account than the one the user explicitly selected. Return
   *      undefined so the caller surfaces "no signed-in account" and the user
   *      can re-select, instead of the plugin quietly switching accounts behind
   *      their back.
   */
  private inUse(discovered: TraeCredential[], offered: TraeCredential[]): TraeCredential | undefined {
    if (this.accountId === undefined) return this.preferred(offered)
    const selected = discovered.find(credential => traeAccountId(credential) === this.accountId)
    if (this.requireTenant && !isEnterpriseAccount(selected)) return this.preferred(offered)
    return selected
  }

  /**
   * Point this store at one specific account for the NEXT request, without
   * touching the user's saved binding (issue #44).
   *
   * Called by the account pool before each chat request. `undefined` clears the
   * override, which is how switching the pool off immediately restores the
   * binding — no rebind, no settings write, nothing to undo.
   *
   * A rotation is a REQUEST, not an assertion: `current()` honours it only when
   * the account still exists locally and this store's own eligibility rules
   * allow it, and otherwise falls back to the binding. So a rotation can never
   * invent a credential that {@link current} would refuse.
   */
  setRotatedAccount(accountId: string | undefined): void {
    if (this.rotatedAccountId === accountId) return
    this.rotatedAccountId = accountId
    // A pending refresh belongs to the account that was being resolved when it
    // started. Serving it to a different account would hand out the wrong token,
    // so a rotation starts clean.
    this.inflight = undefined
  }

  /** The rotation currently in effect, for diagnostics and the pool's own card. */
  rotatedAccount(): string | undefined {
    return this.rotatedAccountId
  }

  /**
   * The credential a rotation points at, or `undefined` when it cannot be
   * honoured (the login was removed from this machine, or a tenant-scoped store
   * refuses a personal account).
   *
   * Never substitutes a different account here: the caller then applies the
   * user's binding, which is the honest answer when the pool's choice is gone.
   */
  private rotated(discovered: readonly TraeCredential[], offered: readonly TraeCredential[]): TraeCredential | undefined {
    const id = this.rotatedAccountId
    if (id === undefined) return undefined
    // The OFFERED list first, because that is the roster the pool enumerated; the
    // discovered list still honours an explicit id the display filter hides, the
    // same way a binding does.
    const credential = offered.find(item => traeAccountId(item) === id)
      ?? discovered.find(item => traeAccountId(item) === id)
    if (credential === undefined) return undefined
    if (this.requireTenant && !isEnterpriseAccount(credential)) return undefined
    return credential
  }

  async current(): Promise<TraeCredential | undefined> {
    const discovered = await this.readAll()
    const offered = this.offered(discovered)
    const rotated = this.rotated(discovered, offered)
    if (rotated !== undefined) return rotated
    return this.inUse(discovered, offered)
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

  /**
   * The PLUGIN'S OWN COPY of one account — never the Trae app's credential.
   *
   * {@link credentialOf} answers from the merged view (copies plus the app's
   * logins) and prefers whichever is fresher. That is right for placing a
   * request, but wrong for HANDING CREDENTIALS OUT: an export must carry the
   * copies this plugin owns and refreshes, not whatever the app happens to have
   * on disk. The two are normally identical — the copy is mirrored from the app
   * — but only the copy is ours, and an account with no copy is not ours to
   * export at all (undefined, no fallback to the app's login).
   */
  async copyOf(accountId: string): Promise<TraeCredential | undefined> {
    if (accountId === '') return undefined
    const owns = await this.readOwns()
    return owns.find(credential => traeAccountId(credential) === accountId)
  }

  /**
   * A SPECIFIC account's credential, refreshed when its access token is due.
   *
   * {@link credentialOf} is a pure lookup and hands back an expired token as-is,
   * which is right for the chat path (that request fails honestly) but wrong for
   * a READ of that account's own data: Trae's access token lives for days while
   * the refresh token lives for months, so a pooled account the user has not
   * used this week reads as "no balance" — the card showed a bare `—` for an
   * account whose refresh token was still good. Only the refresh margin decides
   * here, and a FAILED refresh still yields the stored credential so the caller
   * reports the failure it actually hit instead of inventing "not signed in".
   *
   * This never touches the binding or the rotation: refreshing account B must
   * not make B the account the next chat request bills.
   */
  async resolveCredentialOf(accountId: string): Promise<TraeCredential | undefined> {
    const credential = await this.credentialOf(accountId)
    if (credential === undefined) return undefined
    if (credential.expiresAtMs > Date.now() + this.refreshMarginMs) return credential
    const pending = this.inflightByAccount.get(accountId)
    if (pending !== undefined) return pending
    const failedAt = this.refreshFailedAtMs.get(accountId)
    if (failedAt !== undefined && Date.now() - failedAt < REFRESH_RETRY_MS) return credential
    const attempt = this.refreshNow(credential)
      .then((refreshed) => {
        this.refreshFailedAtMs.delete(accountId)
        return refreshed
      })
      .catch(() => {
        this.refreshFailedAtMs.set(accountId, Date.now())
        return credential
      })
      .finally(() => { this.inflightByAccount.delete(accountId) })
    this.inflightByAccount.set(accountId, attempt)
    return attempt
  }

  /**
   * Store imported credentials (issue #37), replacing any entry with the same
   * account id and leaving every other entry alone.
   *
   * Why an additive write rather than the refresh path: an imported credential
   * has NO desktop file behind it, so unlike a refresh result it cannot be
   * rediscovered from the machine. If it were written the way a refresh is —
   * as the whole document — importing account B would delete account A, and a
   * later refresh would delete both. `readAll`'s desktop-first preference is
   * therefore also not enough on its own: these entries survive only because
   * `readOwns` reads them back and the dedupe keeps the longest-lived copy.
   *
   * Returns the account ids actually written, so the caller can report how many
   * landed without re-reading the store.
   */
  async importAccounts(credentials: readonly Omit<TraeCredential, 'source'>[]): Promise<string[]> {
    if (credentials.length === 0) return []
    const ownPath = this.ownAuthPath()
    const written: string[] = []
    await withFileLock(ownPath, async () => {
      // Merge onto what is already stored, so this never drops an account the
      // user did not touch — including a refreshed copy this store wrote.
      const existing = await this.readOwnForMerge(ownPath)
      if (existing === undefined) return
      const byId = new Map<string, TraeCredential>()
      for (const item of existing) byId.set(traeAccountId(item), item)
      for (const credential of credentials) {
        const stored: TraeCredential = { ...credential, source: 'dsh' }
        const id = traeAccountId(stored)
        byId.set(id, stored)
        written.push(id)
      }
      await writeOwn(ownPath, [...byId.values()])
    })
    // A newly imported account is now the one the user wants to use; bind it so
    // the next request does not silently keep billing the previous account.
    if (written.length > 0) {
      this.accountId = written[written.length - 1]
      this.inflight = undefined
    }
    return written
  }

  async resolve(): Promise<TraeCredential> {
    const credential = await this.current()
    if (credential === undefined) {
      // Distinguish "nothing is signed in" from "the only login names a region
      // this build does not serve" (issue #66). Everything that bills reads a
      // credential through here — catalog, chat, usage — so this is the one
      // place that turns the exclusion into an explicit, pre-network verdict
      // instead of a generic "not found" or, worse, a request to the wrong
      // gateway.
      const unsupported = await this.unsupportedCredentials().catch(() => [])
      const first = unsupported[0]
      if (first !== undefined) throw new TraeUnsupportedRegionError(first.region)
      throw new Error(`trae: no signed-in account found (${this.candidates().map(item => item.path).join(' or ')})`)
    }
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

  /**
   * Credentials this machine holds for a region this build cannot serve yet.
   *
   * Issue #66: a US credential used to resolve to `ai`, so the panel billed it
   * against the SG gateway and every read answered 401. Now it is excluded from
   * resolution (see `readAll`), which would leave the panel saying "not signed
   * in" on a machine the user knows IS signed in — so the exclusion has to be
   * explainable. This reads exactly the credentials `readAll` refuses to
   * RESOLVE and reports their display identity; nothing here is selectable,
   * billable, or sent anywhere.
   *
   * Scoped to the international bucket: a US install is an international
   * install, so only the `ai` panel (and an unscoped diagnostic store) can be
   * the one missing an account because of it.
   */
  async unsupportedCredentials(): Promise<TraeUnsupportedCredential[]> {
    if (this.region !== undefined && this.region !== 'ai') return []
    const found = new Map<string, TraeUnsupportedCredential>()
    const consider = (credential: TraeCredential): void => {
      const region = regionOfCredential(credential)
      if (isSupportedRegion(region)) return
      const id = traeAccountId(credential)
      if (found.has(id)) return
      found.set(id, {
        region,
        accountName: credential.accountName ?? (credential.userId || `${credential.edition} account`),
      })
    }
    try {
      for (const credential of (await this.readDesktopAll()).credentials) consider(credential)
    } catch { /* a read failure must not hide the copies below */ }
    try {
      for (const credential of await this.readOwns()) consider(credential)
    } catch { /* best effort: this is a notice, not a source of truth */ }
    return [...found.values()]
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
   * Remove ONE account from the plugin-owned copy (per-region file, legacy
   * single file), where this store can rewrite the shape it wrote.
   *
   * The desktop storage files are deliberately untouched: their credential is
   * a Trae app login that only Trae can rewrite, so a plugin removing it would
   * corrupt an application state it does not own. `deleteAccount` therefore
   * only ever commits what this plugin persisted — the refreshed copy the
   * store owns — and reports what it did.
   *
   * `stillSignedIn` is true when the SAME account id still resolves to a
   * desktop storage copy, i.e. the account will keep appearing (from Trae's own
   * login) even after the plugin's copy is gone. The card then shows the user
   * where the account really lives instead of implying a deletion that did not
   * take: the account is still signed in Trae, and Trae is the only writer that
   * can remove it.
   *
   * @returns `{ deleted: boolean; stillSignedIn: boolean }` — `deleted` is
   * whether a plugin-owned copy of this account was actually removed;
   * `stillSignedIn` reports a TRAE-owned login that survives it.
   */
  /**
   * Erases this account's login from Trae's OWN storage files.
   *
   * Deleting only the plugin's copy of an account the app itself is signed in to
   * changes nothing the user can see: the app keeps reporting the account, the
   * row comes back on the next poll, and "delete" looks broken. The only real
   * deletion therefore has to rewrite the app's `storage.json`, which means
   * (a) re-encrypting the values that stay, with Trae's own scheme, and (b)
   * refusing while that app runs — its in-memory state would be flushed back
   * over the file and undo the edit.
   *
   * A backup of every rewritten file is left beside it (`.dsh-backup-<stamp>`),
   * because signing a user's editor out is not something to do without a way back.
   */
  async deleteDesktopLogins(accountId: string): Promise<{
    signedOut: TraeEdition[]
    blocked: TraeEdition[]
  }> {
    const signedOut: TraeEdition[] = []
    const blocked: TraeEdition[] = []
    const seen = new Set<string>()
    // `candidates()` (not the raw path list) so an injected storage path — the
    // tests' stand-in for the app's file, and the `--storage` override — is the
    // document this erases, exactly as the read path sees it.
    for (const candidate of this.candidates()) {
      if (candidate.source !== 'desktop' || seen.has(candidate.path)) continue
      seen.add(candidate.path)
      const document = await readFile(candidate.path, 'utf8')
        .then(text => JSON.parse(text) as Record<string, unknown>)
        .catch(() => undefined)
      if (document === undefined) continue
      const encoded = document[TRAE_AUTH_STORAGE_KEY]
      if (typeof encoded !== 'string') continue
      // An undecryptable value is not this account's login as far as we can tell;
      // rewriting the file blind would destroy a login we cannot read back.
      let claims: Record<string, unknown>
      try {
        const parsed = parseTraeAuthValue(encoded)
        if (typeof parsed !== 'object' || parsed === null) continue
        claims = parsed as Record<string, unknown>
      } catch { continue }
      const credential = normalizeTraeCredential(claims, candidate.edition, 'desktop')
      if (credential === undefined || traeAccountId(credential) !== accountId) continue
      const running = await this.runningApps().catch(() => new Set<TraeEdition>())
      if (running.has(candidate.edition)) {
        blocked.push(candidate.edition)
        continue
      }
      const erased = await eraseDesktopLogin(candidate.path, document, claims, encoded)
      if (erased) signedOut.push(candidate.edition)
      else blocked.push(candidate.edition)
    }
    return { signedOut: [...new Set(signedOut)], blocked: [...new Set(blocked)] }
  }

  /**
   * Delete this store's COPY of one account.
   *
   * What the plugin shows and bills is the copy, so that is the first thing
   * "delete" removes. The copy alone is not enough: the same login usually also
   * lives in the app's own `storage.json`, and the app keeps reporting it, so
   * the delete then erases that login too (see `deleteDesktopLogins`, which
   * refuses while the app runs and leaves a backup beside every file it
   * rewrites).
   *
   * The catch is the mirror: `accounts()` recreates a copy from any local login
   * that lacks one, so deleting the copy of an account still signed in to Trae
   * would resurrect it on the next poll. A TOMBSTONE records the deletion for
   * exactly that id; the mirror skips it while the app still holds the login and
   * drops the tombstone once it does not, so signing in again later mirrors it
   * again. That is why `stillSignedIn` is reported: it explains that the account
   * still lives in Trae even though the plugin no longer shows it.
   *
   * @returns `{ deleted, stillSignedIn, hadCopy, signedOutApps, blockedApps }` —
   * `deleted` is "this machine no longer carries the account anywhere" (true
   * even when there was never a copy, so a ghost member can be cleared);
   * `stillSignedIn` answers "is it still a live Trae login here?"; `hadCopy` is
   * "did a file actually change?"; `signedOutApps` names the apps whose login
   * was erased; `blockedApps` names the apps that were running, in which case
   * nothing was erased and `deleted` is false.
   */
  async deleteAccount(accountId: string): Promise<{
    deleted: boolean
    stillSignedIn: boolean
    hadCopy: boolean
    signedOutApps: TraeEdition[]
    blockedApps: TraeEdition[]
  }> {
    let mutated = false
    for (const path of this.ownCandidates()) {
      const dropped = await withFileLock(path, async () => {
        // `parseOwn`'s `undefined` (an unreadable file) is normalized to `null`
        // here: `null` is this call's "nothing to act on", and the comment below
        // applies to it unchanged.
        const existing = await readFile(path, 'utf8').then(text => parseOwn(text) ?? null, () => null)
        // A file we never wrote (or one with nothing to drop) is left alone.
        // `undefined` is the third case parseOwn now reports — an UNREADABLE
        // file — and it is left alone too: a delete must not quarantine (or
        // otherwise replace) bytes it could not read, it just declines.
        if (existing === null || !existing.some(credential => traeAccountId(credential) === accountId)) return false
        const next = existing.filter(credential => traeAccountId(credential) !== accountId)
        await writeOwn(path, next)
        return true
      }).catch(() => false)
      mutated = mutated || dropped
    }
    // Tombstone BEFORE the next mirror can run: a delete that is not remembered
    // is a delete the next refresh undoes. The add happens under the tombstone
    // lock so it cannot be lost to a concurrent mirror's drop.
    await this.updateTombstones(ids => { ids.add(accountId) })
    // If the id was this account's binding, forget it so `current()` falls back
    // to a real selection instead of pointing at a credential that is gone.
    if (this.accountId === accountId) {
      this.accountId = undefined
      this.inflight = undefined
    }
    // The app half. A copy is only half of the account's presence on this
    // machine: the same login usually also sits in Trae's own storage.json, and
    // Trae reports it again on the next read no matter what the plugin does to
    // its copy — which is exactly why "delete" kept looking broken. So the
    // delete also erases the app login, and a RUNNING app (whose in-memory
    // state would be flushed back over the file) is reported instead of faked.
    const { signedOut, blocked } = await this.deleteDesktopLogins(accountId)
    const stillInOwn = (await this.readOwns()).some(credential => traeAccountId(credential) === accountId)
    const { credentials: discovered } = await this.readDesktopAll()
    const stillSignedIn = discovered.some(credential => traeAccountId(credential) === accountId)
    // `deleted` means "this machine no longer carries the account anywhere":
    // the plugin's copy is gone AND no app login survived. A blocked app is a
    // non-delete — the file is unchanged, so claiming success would be a lie
    // the user discovers on the next poll.
    const deleted = !stillInOwn && !stillSignedIn
    return {
      deleted,
      stillSignedIn,
      // "Did a file actually change?" — signing the app out counts: it is the
      // rewrite that makes the row disappear.
      hadCopy: mutated || signedOut.length > 0,
      signedOutApps: signedOut,
      blockedApps: blocked,
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
    // One entry per ACCOUNT, holding the FRESHEST copy of it.
    //
    // Keeping the desktop copy whenever both exist looks harmless — the desktop
    // file is the Trae app's own login — but it silently discards every refresh
    // this plugin performs, because a refreshed credential is written to the
    // plugin's own file, not to the app's. The account then reads as "token
    // expired" forever while a valid token sits on disk one file over: the
    // composer table showed a dash for an account whose own copy was refreshed
    // minutes earlier (`.trae-auth.cn.json` valid to 10-14, desktop copy from
    // 09-27 winning the dedupe).
    //
    // Insertion order still follows the desktop list, so `preferred()` and the
    // default selection are unchanged; only the VALUE behind a duplicate id can
    // be replaced, and only by a copy that lives longer.
    const byAccount = new Map<string, TraeCredential>()
    const consider = (credential: TraeCredential): void => {
      // A region this build does not serve is never RESOLVABLE — not by a
      // scoped store (whose region it would never equal) and not by an
      // unscoped one either (issue #66: a US credential used to arrive here as
      // `ai` and every read then answered 401). It is still DISCOVERED, by
      // `unsupportedCredentials()`, so the card can say why it is unusable.
      if (!isSupportedRegion(regionOfCredential(credential))) return
      if (!this.matchesRegion(credential)) return
      const id = traeAccountId(credential)
      const incumbent = byAccount.get(id)
      if (incumbent === undefined || credential.expiresAtMs > incumbent.expiresAtMs) byAccount.set(id, credential)
    }
    for (const credential of desktop) consider(credential)
    // The own copies are accepted for every edition: they are refresh results
    // the plugin itself wrote, so an international account's refreshed
    // credential must not be dropped just because it is not a CN edition.
    for (const own of await this.readOwns()) consider(own)
    return [...byAccount.values()]
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
        // A v2 file can hold several accounts, so this spreads rather than
        // pushing the single credential a v1 file carried. `undefined` — a
        // file this build cannot parse — is skipped like the absent and the
        // unreadable: the accounts it may still carry must not read as "no
        // accounts", which would re-mirror them and re-aggregate their rows.
        const parsed = parseOwn(await readFile(path, 'utf8'))
        if (parsed !== undefined) copies.push(...parsed)
      } catch {
        // absent or unreadable — the next candidate is tried
      }
    }
    return copies
  }

  /**
   * The copies that were found unreadable and moved aside.
   *
   * SCANNED, not remembered: the quarantine file is itself the durable
   * record (its name carries the moment it was taken), so the plugin does not
   * keep a second, parallel ledger that could disagree with the disk. The
   * notice therefore appears exactly as long as the evidence does — and
   * disappears when the user deletes the quarantined copy, which is what
   * "I have dealt with it" means.
   *
   * A notice is a FACT about the user's disk, never about their credentials:
   * it names a path, a size and a count, and the path is the one the plugin
   * owns (inside DSH's own home), never a Trae application directory.
   */
  async quarantinedCopies(): Promise<TraeQuarantineNotice[]> {
    const notices: TraeQuarantineNotice[] = []
    const seen = new Set<string>()
    for (const path of this.ownCandidates()) {
      const directory = dirname(path)
      const prefix = `${basename(path)}.corrupt-`
      let entries: string[]
      try {
        entries = await readdir(directory)
      } catch {
        // The directory is unreadable or gone: there is nothing to report.
        continue
      }
      for (const name of entries) {
        if (!name.startsWith(prefix)) continue
        const quarantinedAs = join(directory, name)
        if (seen.has(quarantinedAs)) continue
        seen.add(quarantinedAs)
        let bytes = 0
        let accounts: number | undefined
        try {
          const text = await readFile(quarantinedAs, 'utf8')
          bytes = Buffer.byteLength(text)
          accounts = countStoredAccounts(text)
        } catch {
          // Unreadable now (permissions, a race with the user's editor): the
          // path is still worth reporting, the size is not.
        }
        notices.push({
          file: path,
          quarantinedAs,
          bytes,
          ...accounts === undefined ? {} : { accounts },
        })
      }
    }
    return notices
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
        // Read-modify-write, NOT overwrite. Since version 2 this file holds
        // every account of the region — including imported ones that have no
        // desktop file behind them and could not be re-discovered — so writing
        // a single refreshed credential as the whole document would silently
        // delete the others. The account whose token was just refreshed
        // replaces its own entry; every other entry is carried over verbatim.
        const existing = await this.readOwnForMerge(ownPath)
        // A corrupt file we could not quarantine is not a base to write over:
        // the refreshed token is returned to this request but not persisted,
        // and the next refresh retries the merge against the intact bytes.
        if (existing === undefined) return
        const refreshedId = traeAccountId(refreshed)
        const entries = existing.filter(item => traeAccountId(item) !== refreshedId)
        entries.push(refreshed)
        await writeOwn(ownPath, entries)
      })
      return refreshed
    } catch (error: unknown) {
      if (credential.expiresAtMs > Date.now() + 30_000) return credential
      throw new Error(`trae: token refresh failed and access token is expired (${String(error)}); sign in again in Trae`)
    }
  }
}
