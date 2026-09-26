import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { cpus, homedir, release } from 'node:os'
import type { TraeEdition, TraeStorageCandidate } from './paths.ts'
import { traeWindowsAppNames } from './paths.ts'

export interface TraeIdentity {
  edition: TraeEdition
  machineId: string
  deviceId: string
  appVersion?: string
  buildVersion?: string
  deviceBrand?: string
  deviceCpu?: string
  osVersion?: string
  platform: NodeJS.Platform
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function deviceCenterId(storage: Record<string, unknown>): string | undefined {
  const prefix = 'iCubeAuthInfo://icube-dc:'
  const ids = Object.keys(storage).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)).filter(Boolean)
  return ids.length === 1 ? ids[0] : undefined
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
  const dcDevice = deviceCenterId(storage)
  // Historical official chat logs use the 64-char telemetry.machineId as
  // x-machine-id. The root machineid file remains a fallback only.
  const machineId = telemetryMachine ?? machineFile
  if (machineId === undefined) throw new Error(`Trae ${candidate.edition} has no stable machine identity`)
  // The numeric suffix of iCubeAuthInfo://icube-dc:<id> exactly matches the
  // x-device-id observed in official CN chat logs. Telemetry remains fallback.
  const deviceId = dcDevice ?? devDevice ?? createHash('sha256').update(machineId).digest('hex').slice(0, 32)
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
  return {
    edition: candidate.edition,
    machineId,
    deviceId,
    ...appVersion === undefined ? {} : { appVersion },
    ...buildVersion === undefined ? {} : { buildVersion },
    ...deviceBrand === undefined ? {} : { deviceBrand },
    ...deviceCpu === undefined ? {} : { deviceCpu },
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
