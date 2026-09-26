import { homedir } from 'node:os'
import { join } from 'node:path'

export type TraeEdition = 'cn' | 'sg' | 'solo' | 'solo-sg'

/**
 * Where a local sign-in was persisted. `desktop` candidates hold an Electron
 * `globalStorage/storage.json` whose auth value is encrypted; `cli` candidates
 * hold a bare JWT written by the Trae CLI, which needs no decryption.
 */
export type TraeCredentialSource = 'desktop' | 'cli'

export interface TraeStorageCandidate {
  edition: TraeEdition
  path: string
  source: TraeCredentialSource
}

const APP_NAMES: Readonly<Record<TraeEdition, string>> = {
  cn: 'Trae CN',
  sg: 'Trae',
  solo: 'TRAE SOLO CN',
  'solo-sg': 'TRAE SOLO',
}

/**
 * Directory names the Trae CLI uses for its own home. These are deliberately
 * separate from the Electron app-support names above: the CLI keeps a dotfile
 * home (observed on macOS as `~/.trae-cn`) rather than an `Application Support`
 * entry, so a machine with only the CLI installed has no `storage.json` at all.
 */
const CLI_HOME_NAMES: readonly string[] = ['.trae-cn', '.trae']

/** Basename of the CLI's persisted bare JWT. */
export const TRAE_CLI_TOKEN_FILENAME = 'trae-jwt-token'

/**
 * Linux desktop config directory names. Electron apps on Linux normally use a
 * lowercase, space-free name rather than the macOS `Trae CN` spelling, so both
 * are probed: guessing only the macOS spelling would silently miss a real
 * install, and guessing only the Linux spelling would break every existing
 * user. The actual name is unverified on a real Linux host.
 */
const LINUX_APP_NAMES: Readonly<Record<TraeEdition, readonly string[]>> = {
  cn: ['trae-cn', 'Trae CN', 'trae', 'Trae'],
  sg: ['trae', 'Trae'],
  solo: ['trae-solo-cn', 'TRAE SOLO CN'],
  'solo-sg': ['trae-solo', 'TRAE SOLO'],
}

/**
 * Windows desktop config directory names.
 *
 * Trae is a VS Code-family Electron app, and that family names its per-user
 * data directory from the installer-registered product name — which on Windows
 * is `product.json`'s `win32DirName`, NOT the macOS bundle spelling. Measured
 * from the shipped bundles (2026-09-26):
 *
 *   Trae CN      -> win32DirName = "Trae CN"       (applicationName trae-cn)
 *   TRAE SOLO CN -> win32DirName = "TRAE SOLO CN"  (applicationName trae-solo-cn)
 *
 * So the macOS spellings happen to be right here, and `win32DirName` is the
 * authority that says so. The lowercase `applicationName` spellings
 * (`trae-cn`, `trae-solo-cn`) are probed as well because the same family uses
 * them for the Linux config directory, and which of the two a given installer
 * writes has never been confirmed on a real Windows host
 * (docs/WINDOWS_TOKEN_PROBE.md). Windows file systems are case-insensitive, so
 * listing `trae cn` beside `Trae CN` would be the same directory twice — only
 * genuinely different spellings are listed.
 */
const WINDOWS_APP_NAMES: Readonly<Record<TraeEdition, readonly string[]>> = {
  cn: ['Trae CN', 'trae-cn'],
  sg: ['Trae'],
  solo: ['TRAE SOLO CN', 'trae-solo-cn'],
  'solo-sg': ['TRAE SOLO'],
}

/**
 * One edition's plausible Windows directory spellings, in probe order.
 *
 * Exported so the identity reader and the credential scanner probe the SAME
 * names: the two resolve different files (the install's `product.json` vs the
 * per-user `storage.json`) but they describe one installation, and a spelling
 * that works for one but not the other is a bug rather than a preference.
 */
export function traeWindowsAppNames(edition: TraeEdition): readonly string[] {
  return WINDOWS_APP_NAMES[edition]
}

export function traeStorageCandidates(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): TraeStorageCandidate[] {
  const result: TraeStorageCandidate[] = []
  for (const edition of ['cn', 'sg', 'solo', 'solo-sg'] as const) {
    const app = APP_NAMES[edition]
    let roots: string[]
    let appNames: readonly string[]
    if (platform === 'darwin') {
      roots = [join(home, 'Library', 'Application Support')]
      appNames = [app]
    } else if (platform === 'win32') {
      roots = [env.APPDATA, join(home, 'AppData', 'Roaming')].filter((value, index, all): value is string =>
        typeof value === 'string' && value !== '' && all.indexOf(value) === index)
      appNames = WINDOWS_APP_NAMES[edition]
    } else if (platform === 'linux') {
      roots = [env.XDG_CONFIG_HOME || join(home, '.config')]
      appNames = LINUX_APP_NAMES[edition]
    } else {
      roots = []
      appNames = [app]
    }
    for (const root of roots) {
      for (const appName of appNames) {
        result.push({ edition, path: join(root, appName, 'User', 'globalStorage', 'storage.json'), source: 'desktop' })
      }
    }
  }
  return [...result, ...traeCliCandidates(platform, home, env)]
}

/**
 * Candidate CLI token paths. Only CN/SOLO editions are targeted here for the
 * same reason the store ignores SG desktop installs, and `.trae-cn` is mapped
 * to `cn` while `.trae` is the CLI's international home and is therefore
 * skipped by the store's edition filter.
 *
 * The CLI home is a dotfile directory directly under `$HOME` on every platform
 * observed so far, but this is only verified on macOS; the Windows and Linux
 * spellings are probed speculatively and a miss is harmless because every
 * candidate is tried in order.
 */
export function traeCliCandidates(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): TraeStorageCandidate[] {
  const roots: string[] = []
  if (platform === 'win32') {
    for (const value of [env.USERPROFILE, home]) {
      if (typeof value === 'string' && value !== '' && !roots.includes(value)) roots.push(value)
    }
  } else {
    roots.push(home)
  }
  const result: TraeStorageCandidate[] = []
  for (const root of roots) {
    for (const name of CLI_HOME_NAMES) {
      // `.trae-cn` is the CN CLI home. `.trae` is kept as a low-priority
      // fallback so a renamed CN home is still discovered on a machine that has
      // no international install; the store filters by edition afterwards.
      const edition: TraeEdition = name === '.trae-cn' ? 'cn' : 'sg'
      result.push({ edition, path: join(root, name, TRAE_CLI_TOKEN_FILENAME), source: 'cli' })
    }
  }
  return result
}
