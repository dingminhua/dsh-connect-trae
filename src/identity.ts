import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { cpus, homedir, release, userInfo } from 'node:os'
import type { TraeEdition, TraeStorageCandidate } from './paths.ts'
import { traeWindowsAppNames } from './paths.ts'
import { parseTraeAuthValue } from './decrypt.ts'

/**
 * The per-install ECDSA P-256 keypair the official client registers with the
 * device, and signs its token-refresh proof with.
 *
 * It lives in the same `storage.json` as the credential, under
 * `iCubeAuthInfo://icube-dc:<deviceId>`, encrypted with the same codec — so the
 * key that PROVES a device is the key stored beside the login it protects.
 * Without it the new refresh contract cannot be satisfied at all (the server
 * rejects a proof signed by any other key with `20403 Token device not match`).
 */
export interface TraeDeviceKeyPair {
  privateKeyPEM: string
  publicKeyPEM: string
}

export interface TraeIdentity {
  edition: TraeEdition
  machineId: string
  deviceId: string
  appVersion?: string
  buildVersion?: string
  deviceBrand?: string
  deviceCpu?: string
  osVersion?: string
  /**
   * Device display name; the official client sends the OS account's full name.
   * Optional because the new refresh contract does not read it.
   */
  deviceName?: string
  /** Device model, e.g. `MacBookPro18,2`. Optional; not required by the server. */
  deviceModel?: string
  /** The install's registered device keypair, when `storage.json` carries one. */
  deviceKeyPair?: TraeDeviceKeyPair
  platform: NodeJS.Platform
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const ICUBE_DC_PREFIX = 'iCubeAuthInfo://icube-dc:'

interface DeviceCenterEntry {
  /** Full storage key, whose VALUE holds this device's registration/keypair. */
  key: string
  /** The numeric did/rdid suffix — the value upstream keys check-in on. */
  deviceId: string
}

/**
 * The one canonical `iCubeAuthInfo://icube-dc:<id>` entry for this install.
 *
 * A real install can carry MORE THAN ONE such key at once (issue #92): besides
 * the numeric did/rdid there is an `aha-`-prefixed ldid. The ldid is NOT the
 * value upstream judges — official logs name the numeric suffix as did/rdid
 * (`[ICDRS] did:<D>, ldid:aha-…, rdid:<D>`), and sending the aha value returns
 * `did_checked_in:false` (docs/USAGE_API_RESEARCH.md). The old code required
 * EXACTLY one key, so with both present it returned undefined and the caller
 * silently fell back to the telemetry UUID — an id upstream does not know,
 * which is how a correct account gets 9074 on check-in.
 *
 * Selection is by SHAPE only (all digits), never by a guessed digit count: the
 * numeric id has been observed as 16 digits, not just 15/19. The rule is
 * deliberately conservative — it changes behaviour ONLY for the case that was
 * actually broken (several entries at once):
 *   - exactly one NUMERIC entry → use it (the did/rdid; an aha ldid beside it is
 *     ignored, which is the issue #92 fix);
 *   - otherwise, exactly one entry of ANY shape → preserve the old behaviour,
 *     so a machine carrying only one aha entry keeps its id AND its keypair and
 *     token refresh is not downgraded to the legacy contract;
 *   - zero or several entries with no single numeric winner → undefined, and
 *     the caller's existing fallback applies unchanged.
 */
function canonicalDeviceCenterEntry(storage: Record<string, unknown>): DeviceCenterEntry | undefined {
  const entries = Object.keys(storage)
    .filter(key => key.startsWith(ICUBE_DC_PREFIX))
    .map(key => ({ key, suffix: key.slice(ICUBE_DC_PREFIX.length) }))
    .filter(entry => entry.suffix !== '')
  const numeric = entries.filter(entry => /^\d+$/.test(entry.suffix))
  if (numeric.length === 1) return { key: numeric[0]!.key, deviceId: numeric[0]!.suffix }
  if (entries.length === 1) return { key: entries[0]!.key, deviceId: entries[0]!.suffix }
  return undefined
}

/**
 * Read the install's device keypair out of `storage.json`.
 *
 * Tolerant on purpose: an older install (or one that has never refreshed on the
 * new contract) simply has no keypair, and the caller must still be able to
 * resolve an identity for the chat/usage paths — only a refresh then degrades.
 * A malformed entry is treated as absent rather than failing the read.
 */
export function deviceKeyPairOf(
  storage: Record<string, unknown>,
  resolved?: DeviceCenterEntry,
): TraeDeviceKeyPair | undefined {
  // Use the SAME entry that supplies x-device-id. The refresh body carries
  // DeviceInfo.DeviceID and DevicePublicKey together, and upstream refuses a
  // proof from another device's key (20403 Token device not match); picking the
  // first key with `.find()` could pair the numeric id with the aha entry's key.
  // A caller that already resolved the entry (readTraeIdentity) passes it in so
  // the two reads can never diverge.
  const entry = resolved ?? canonicalDeviceCenterEntry(storage)
  if (entry === undefined) return undefined
  const encoded = storage[entry.key]
  if (typeof encoded !== 'string' || encoded.trim() === '') return undefined
  try {
    const plaintext = parseTraeAuthValue(encoded)
    if (typeof plaintext !== 'object' || plaintext === null || Array.isArray(plaintext)) return undefined
    const value = plaintext as Record<string, unknown>
    const privateKeyPEM = nonEmpty(value['privateKeyPEM'])
    const publicKeyPEM = nonEmpty(value['publicKeyPEM'])
    // Both halves are required: the proof needs the private key to sign, and the
    // public key is what the server bound the device to at registration.
    return privateKeyPEM === undefined || publicKeyPEM === undefined ? undefined : { privateKeyPEM, publicKeyPEM }
  } catch {
    return undefined
  }
}

export interface TraeIdentityReadOptions {
  /** Platform override for testing; defaults to process.platform. */
  platform?: NodeJS.Platform
  /** Home-directory override for testing; defaults to homedir(). */
  home?: string
  /** Environment override for testing; defaults to process.env. */
  env?: NodeJS.ProcessEnv
}

/** Read stable identity from Trae-owned files without generating impersonated IDs. */
export async function readTraeIdentity(candidate: TraeStorageCandidate, options: TraeIdentityReadOptions = {}): Promise<TraeIdentity> {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const storage = JSON.parse(await readFile(candidate.path, 'utf8')) as Record<string, unknown>
  const appRoot = dirname(dirname(dirname(candidate.path)))
  const machineFile = nonEmpty(await readFile(join(appRoot, 'machineid'), 'utf8').catch(() => ''))
  const telemetryMachine = nonEmpty(storage['telemetry.machineId'])
  const devDevice = nonEmpty(storage['telemetry.devDeviceId'])
  // Resolve the single canonical icube-dc entry ONCE: the device id and the
  // signing keypair must come from the same registration (issue #92).
  const dcEntry = canonicalDeviceCenterEntry(storage)
  // Historical official chat logs use the 64-char telemetry.machineId as
  // x-machine-id. The root machineid file remains a fallback only.
  const machineId = telemetryMachine ?? machineFile
  if (machineId === undefined) throw new Error(`Trae ${candidate.edition} has no stable machine identity`)
  // The numeric suffix of iCubeAuthInfo://icube-dc:<id> exactly matches the
  // x-device-id observed in official CN chat logs (did/rdid, NOT the aha ldid).
  // Telemetry remains fallback.
  const deviceId = dcEntry?.deviceId ?? devDevice ?? createHash('sha256').update(machineId).digest('hex').slice(0, 32)
  const buildVersion = nonEmpty(storage['iCubeLastVersion'])
  // product.json holds the app version that the real client sends as
  // x-app-version / x-ide-version. On macOS the file sits inside the `.app`
  // bundle, whose name is the product name; on Windows it sits under
  // `%LOCALAPPDATA%\Programs\<install dir>\resources\app`, where the install
  // directory name is the installer's choice and has never been confirmed on a
  // real host — hence the same spelling list the credential scanner uses
  // (`traeWindowsAppNames`), so both halves of one installation agree.
  // Failures here must not break identity resolution, so each path is tried in
  // order and non-existent candidates are simply skipped.
  const APP_NAMES_BY_EDITION: Readonly<Record<TraeEdition, string>> = {
    cn: 'Trae CN',
    sg: 'Trae',
    solo: 'TRAE SOLO CN',
    'solo-sg': 'TRAE SOLO',
  }
  const appName = APP_NAMES_BY_EDITION[candidate.edition]
  const productPaths: string[] = []
  if (appName !== undefined && (platform === 'darwin' || platform === 'win32')) {
    if (platform === 'darwin') {
      productPaths.push(join('/Applications', `${appName}.app`, 'Contents', 'Resources', 'app', 'product.json'))
    } else {
      const localRoots = [env.LOCALAPPDATA, join(home, 'AppData', 'Local')]
        .filter((value): value is string => typeof value === 'string' && value !== '')
        .filter((value, index, all) => all.indexOf(value) === index)
      for (const root of localRoots) {
        for (const spelling of traeWindowsAppNames(candidate.edition)) {
          productPaths.push(join(root, 'Programs', spelling, 'resources', 'app', 'product.json'))
        }
      }
    }
  }
  let product: Record<string, unknown> = {}
  for (const path of productPaths) {
    try { product = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; break } catch {}
  }
  const appVersion = nonEmpty(product['appVersion'])
  const deviceBrand = platform === 'darwin' ? nonEmpty(env['TRAE_DEVICE_BRAND']) : undefined
  const deviceCpu = cpus()[0]?.model.split(' ')[0]
  const osVersion = `${platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform} ${release()}`
  // The OS account's full name is what the official client sends as DeviceName,
  // and the host's hardware model is what it sends as DeviceModel. Both are
  // best-effort: neither is read by the server, and an unreadable user record
  // must not fail identity resolution.
  const deviceName = ((): string | undefined => {
    try { return nonEmpty(userInfo().username) } catch { return undefined }
  })()
  const deviceModel = nonEmpty(env['TRAE_DEVICE_MODEL'])
  const deviceKeyPair = deviceKeyPairOf(storage, dcEntry)
  return {
    edition: candidate.edition,
    machineId,
    deviceId,
    ...appVersion === undefined ? {} : { appVersion },
    ...buildVersion === undefined ? {} : { buildVersion },
    ...deviceBrand === undefined ? {} : { deviceBrand },
    ...deviceCpu === undefined ? {} : { deviceCpu },
    ...deviceName === undefined ? {} : { deviceName },
    ...deviceModel === undefined ? {} : { deviceModel },
    ...deviceKeyPair === undefined ? {} : { deviceKeyPair },
    osVersion,
    platform,
  }
}

/** Detect a missing storage file (as opposed to a parse/identity error). */
function isFileMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

/** Prefix of the "no candidate exists on disk" error; see {@link resolveTraeIdentity}. */
const STORAGE_MISSING_PREFIX = 'Trae storage was not found'

/**
 * Try candidates in order and return the first that yields a valid identity;
 * fail hard only when none do. Mirrors the credential store's skip-missing
 * semantics so a machine with only SOLO (no CN install) resolves correctly
 * instead of pinning the first candidate and throwing on a missing file.
 * When every candidate is absent from disk the error names all tried paths;
 * a candidate that exists but fails to parse still surfaces its own error.
 */
export async function pickTraeStorageIdentity(
  candidates: readonly TraeStorageCandidate[],
  options: TraeIdentityReadOptions = {},
): Promise<TraeIdentity> {
  let lastError: unknown
  let anyPresent = false
  for (const candidate of candidates) {
    try {
      return await readTraeIdentity(candidate, options)
    } catch (error) {
      lastError = error
      if (!isFileMissing(error)) anyPresent = true
    }
  }
  const tried = candidates.map(item => item.path).join(' or ')
  if (!anyPresent) throw new Error(`${STORAGE_MISSING_PREFIX} (${tried})`)
  throw lastError instanceof Error ? lastError : new Error(`Trae identity could not be resolved (${tried})`)
}

/** CLI dotfile home per edition; the CLI keeps its own home, not an Application Support entry. */
const CLI_HOME_BY_EDITION: Readonly<Record<TraeEdition, string>> = {
  cn: '.trae-cn',
  solo: '.trae-cn',
  sg: '.trae',
  'solo-sg': '.trae',
}

/**
 * Deterministic identity for a machine that only has the Trae CLI (`traecli`).
 *
 * A CLI-only machine has no desktop `storage.json`, so the desktop identity
 * reader has nothing to read — yet the request headers still need stable
 * machine/device ids. Everything here comes from identifiers the CLI itself
 * persists (never a per-request random value):
 *
 *   - `argv.json`'s `crash-reporter-id` — a stable per-install UUID the CLI
 *     writes on first run; used directly as the device id.
 *   - `builtin/ide_version.json`'s `version` — the CLI build, sent as
 *     `x-app-version` (the desktop reader gets this from `product.json`).
 *   - a SHA-256 over the device id, host name and user name for `machineId`,
 *     matching the 64-char hex shape the official clients send.
 *
 * When `crash-reporter-id` is absent the device id falls back to the same
 * hash (still deterministic). A machine with no CLI home at all keeps failing
 * loudly — a fabricated identity is worse than a visible "not signed in".
 */
export async function readTraeCliIdentity(
  edition: TraeEdition,
  options: TraeIdentityReadOptions = {},
): Promise<TraeIdentity> {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const cliHome = join(home, CLI_HOME_BY_EDITION[edition])
  const argv = await readJsonFile(join(cliHome, 'argv.json'))
  const version = await readJsonFile(join(cliHome, 'builtin', 'ide_version.json'))
  const crashReporterId = nonEmpty(argv?.['crash-reporter-id'])
  const host = nonEmpty(env['HOSTNAME']) ?? await readHostname() ?? 'unknown-host'
  const user = nonEmpty(env['USER']) ?? nonEmpty(env['USERNAME']) ?? 'unknown-user'
  const deviceId = crashReporterId ?? createHash('sha256').update(`trae-cli\0${host}\0${user}`).digest('hex').slice(0, 32)
  const machineId = createHash('sha256').update(`trae-cli-machine\0${deviceId}\0${host}`).digest('hex')
  const appVersion = nonEmpty(version?.['version'])
  const deviceCpu = cpus()[0]?.model.split(' ')[0]
  const osVersion = `${platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform} ${release()}`
  return {
    edition,
    machineId,
    deviceId,
    ...appVersion === undefined ? {} : { appVersion },
    ...deviceCpu === undefined ? {} : { deviceCpu },
    osVersion,
    platform,
  }
}

/** Read and parse a JSON file, tolerating absence and malformed content. */
async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** OS host name, or undefined when unavailable. */
async function readHostname(): Promise<string | undefined> {
  try {
    const { hostname } = await import('node:os')
    return nonEmpty(hostname())
  } catch {
    return undefined
  }
}

/**
 * Resolve the request identity for one region: the desktop storage identity
 * when any desktop install exists, otherwise the CLI home's deterministic
 * identity (see {@link readTraeCliIdentity}).
 *
 * This is the seam the WSL2 / CLI-only case needs: `traecli` writes its token
 * to `~/.trae-cn/trae-jwt-token` and no `storage.json` exists anywhere, so
 * desktop-only resolution used to fail every directory refresh and chat
 * request even though the account itself was found.
 */
export async function resolveTraeIdentity(
  candidates: readonly TraeStorageCandidate[],
  edition: TraeEdition,
  options: TraeIdentityReadOptions = {},
): Promise<TraeIdentity> {
  try {
    return await pickTraeStorageIdentity(candidates, options)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith(STORAGE_MISSING_PREFIX)) throw error
    return readTraeCliIdentity(edition, options)
  }
}

/**
 * Per-account check-in device id (opt-in, `pool.perAccountCheckinDevice`).
 *
 * Trae keys the daily check-in slot on `x-device-id`, and that id is a property
 * of the INSTALLATION, so a machine with several accounts in the pool pays only
 * the first one per day: the rest get business code `9095` (see
 * `src/account-pool-run.ts`). The fix users can opt into is to send a
 * per-account id derived from the real machine id and the account id, so each
 * account presents its own slot.
 *
 * Derived, never stored or random: an id that changed between runs would look
 * like a brand new device every day, and an id that ignored the machine id
 * would collide across machines. Same shape as the CLI fallback above
 * (`sha256(seed).slice(0, 32)`), and it is NOT the value used by the chat path —
 * only the two check-in routes are given this id.
 */
export function checkinDeviceIdOf(base: Pick<TraeIdentity, 'deviceId'>, accountId: string): string {
  return createHash('sha256').update(`trae-checkin\0${base.deviceId}\0${accountId}`).digest('hex').slice(0, 32)
}

/**
 * The id a RETRY of one account's check-in presents after a busy refusal (9074).
 *
 * `9074`「当前参与用户太多」is transient load, but measured behaviour is that the
 * exact id it just refused stays refused for the rest of the day: the same derived
 * id failed 20 times at 5s intervals, while a different id succeeded on the next
 * call. So a retry needs a different id — still derived from the machine id and
 * account id (cross-machine collisions stay impossible, nothing is stored), salted
 * with the attempt number so it is reproducible within the run.
 *
 * `round` is why this parameter exists. Salting with `attempt` ALONE made the id
 * a function of the machine, the account and the attempt — so every round of a day
 * produced the same `attempt 1` and `attempt 2` ids. The automatic check-in runs a
 * round every 30 minutes, so after one bad round (three ids refused) every later
 * round re-sent exactly those three refused ids: the retry only postponed the
 * original "structurally impossible" by one round. The round number is the day's
 * count of completed batches, which makes each round present ids upstream has not
 * seen. It is NOT a timestamp — a restart re-reads the same count from state, so
 * the ids stay reproducible within a round.
 *
 * `attempt` must be >= 1. Attempt 0 is always `checkinDeviceIdOf`, so the first
 * request of a day carries the same stable id it carried before this existed.
 * `round` 0 is byte-identical to the round-less form, so a day that never meets
 * `9074` twice behaves exactly as it did before rounds existed.
 */
export function checkinRetryDeviceIdOf(
  base: Pick<TraeIdentity, 'deviceId'>,
  accountId: string,
  attempt: number,
  round = 0,
): string {
  const suffix = round > 0 ? `\0round\0${String(Math.trunc(round))}` : ''
  return createHash('sha256')
    .update(`trae-checkin\0${base.deviceId}\0${accountId}\0retry\0${String(Math.trunc(attempt))}${suffix}`)
    .digest('hex')
    .slice(0, 32)
}

/** Headers derived from actual persisted identity, never a new random identity per request. */
export function identityHeaders(identity: TraeIdentity): Record<string, string> {
  return {
    'x-machine-id': identity.machineId,
    'x-device-id': identity.deviceId,
    'x-device-type': identity.platform === 'darwin' ? 'mac' : identity.platform === 'win32' ? 'windows' : identity.platform,
    ...identity.deviceBrand === undefined ? {} : { 'x-device-brand': identity.deviceBrand },
    ...identity.deviceCpu === undefined ? {} : { 'x-device-cpu': identity.deviceCpu },
    ...identity.osVersion === undefined ? {} : { 'x-os-version': identity.osVersion },
    ...identity.appVersion === undefined ? {} : { 'x-app-version': identity.appVersion, 'x-ide-version': identity.appVersion },
    ...identity.buildVersion === undefined ? {} : { 'x-app-version-code': identity.buildVersion, 'x-ide-version-code': identity.buildVersion },
    'x-ide-version-type': 'stable',
  }
}
