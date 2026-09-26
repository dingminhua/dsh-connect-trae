import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { identityHeaders, pickTraeStorageIdentity, readTraeCliIdentity, readTraeIdentity, resolveTraeIdentity } from '../src/identity.ts'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('Trae persisted identity', () => {
  it('reads Trae-owned machine and telemetry IDs without random generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-id-')); cleanup.push(root)
    const storage = join(root, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'User', 'globalStorage'), { recursive: true })
    await writeFile(join(root, 'machineid'), 'machine-stable')
    // A synthetic 15-digit icube-dc id: the fixture must exercise the exact
    // shape Trae writes (`iCubeAuthInfo://icube-dc:<digits>` → digits become
    // x-device-id) without publishing a real machine's id. The real value this
    // test originally used is a stable installation identifier tied to the
    // author's Trae account, so it does not belong in a public repository.
    const deviceId = '999000111222333'
    await writeFile(storage, JSON.stringify({ 'telemetry.devDeviceId': 'device-stable', 'telemetry.machineId': 'telemetry-machine', [`iCubeAuthInfo://icube-dc:${deviceId}`]: 'encrypted', iCubeLastVersion: '2.3.1' }))
    const first = await readTraeIdentity({ edition: 'cn', path: storage, source: 'desktop' }, { platform: 'darwin', home: root, env: {} })
    const second = await readTraeIdentity({ edition: 'cn', path: storage, source: 'desktop' }, { platform: 'darwin', home: root, env: {} })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ machineId: 'telemetry-machine', deviceId, buildVersion: '2.3.1', platform: 'darwin' })
    // darwin install: no win32/windows-specific device type.
    expect(identityHeaders(first)['x-device-type']).toBe('mac')
  })

  it('falls back to root machineid and derives a deterministic device id only when telemetry IDs are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-id-')); cleanup.push(root)
    const storage = join(root, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'User', 'globalStorage'), { recursive: true })
    await writeFile(join(root, 'machineid'), 'machine-stable')
    await writeFile(storage, '{}')
    const value = await readTraeIdentity({ edition: 'cn', path: storage, source: 'desktop' }, { platform: 'darwin', home: root, env: {} })
    expect(value.deviceId).toMatch(/^[a-f0-9]{32}$/)
  })

  it('reads appVersion from the Windows install product.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-win-')); cleanup.push(root)
    const storage = join(root, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, JSON.stringify({ 'telemetry.devDeviceId': 'device-stable', 'telemetry.machineId': 'telemetry-machine' }))
    const productDir = join(root, 'local', 'Programs', 'TRAE SOLO CN', 'resources', 'app')
    await mkdir(productDir, { recursive: true })
    await writeFile(join(productDir, 'product.json'), JSON.stringify({ appVersion: '0.1.56', version: '1.107.1', buildId: '1207052290818' }))
    const value = await readTraeIdentity({ edition: 'solo', path: storage, source: 'desktop' }, { platform: 'win32', home: root, env: { LOCALAPPDATA: join(root, 'local') } })
    expect(value.appVersion).toBe('0.1.56')
    expect(value.platform).toBe('win32')
    expect(identityHeaders(value)['x-device-type']).toBe('windows')
    expect(value.osVersion).toMatch(/^Windows /)
  })

  it('falls back to <home>\\AppData\\Local when LOCALAPPDATA is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-win-')); cleanup.push(root)
    const storage = join(root, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, JSON.stringify({ 'telemetry.devDeviceId': 'device-stable', 'telemetry.machineId': 'telemetry-machine' }))
    const productDir = join(root, 'AppData', 'Local', 'Programs', 'TRAE SOLO CN', 'resources', 'app')
    await mkdir(productDir, { recursive: true })
    await writeFile(join(productDir, 'product.json'), JSON.stringify({ appVersion: '0.1.57' }))
    const value = await readTraeIdentity({ edition: 'solo', path: storage, source: 'desktop' }, { platform: 'win32', home: root, env: {} })
    expect(value.appVersion).toBe('0.1.57')
    expect(value.platform).toBe('win32')
  })

  it('finds product.json under the alternate Windows install spelling', async () => {
    // The install directory name on Windows has never been confirmed on a real
    // host, so both the `win32DirName` spelling from product.json ("TRAE SOLO
    // CN") and the lowercase `applicationName` spelling the same app family
    // uses on Linux ("trae-solo-cn") are probed. A machine whose installer
    // wrote the lowercase name must still resolve its app version — otherwise
    // x-app-version / x-ide-version silently go missing from every request.
    const root = await mkdtemp(join(tmpdir(), 'trae-win-')); cleanup.push(root)
    const storage = join(root, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, JSON.stringify({ 'telemetry.devDeviceId': 'device-stable', 'telemetry.machineId': 'telemetry-machine' }))
    const productDir = join(root, 'local', 'Programs', 'trae-solo-cn', 'resources', 'app')
    await mkdir(productDir, { recursive: true })
    await writeFile(join(productDir, 'product.json'), JSON.stringify({ appVersion: '0.1.99' }))
    const value = await readTraeIdentity({ edition: 'solo', path: storage, source: 'desktop' }, { platform: 'win32', home: root, env: { LOCALAPPDATA: join(root, 'local') } })
    expect(value.appVersion).toBe('0.1.99')
  })

  it('does not read product.json on linux and leaves appVersion undefined', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-linux-')); cleanup.push(root)
    const storage = join(root, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, JSON.stringify({ 'telemetry.devDeviceId': 'device-stable', 'telemetry.machineId': 'telemetry-machine' }))
    const value = await readTraeIdentity({ edition: 'cn', path: storage, source: 'desktop' }, { platform: 'linux', home: root, env: {} })
    expect(value.appVersion).toBeUndefined()
    expect(value.platform).toBe('linux')
  })

  it('resolves product.json for international editions too on win32', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-sg-')); cleanup.push(root)
    const storage = join(root, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, JSON.stringify({ 'telemetry.devDeviceId': 'device-stable', 'telemetry.machineId': 'telemetry-machine' }))
    const productDir = join(root, 'local', 'Programs', 'Trae', 'resources', 'app')
    await mkdir(productDir, { recursive: true })
    await writeFile(join(productDir, 'product.json'), JSON.stringify({ appVersion: '9.9.9' }))
    // The international desktop install's product.json is now read (it feeds
    // x-app-version on the SG gateway); an edition whose install dir has no
    // product.json still degrades to an absent appVersion.
    const sg = await readTraeIdentity({ edition: 'sg', path: storage, source: 'desktop' }, { platform: 'win32', home: root, env: { LOCALAPPDATA: join(root, 'local') } })
    expect(sg.appVersion).toBe('9.9.9')
    expect(sg.platform).toBe('win32')
    const soloSg = await readTraeIdentity({ edition: 'solo-sg', path: storage, source: 'desktop' }, { platform: 'win32', home: root, env: { LOCALAPPDATA: join(root, 'local') } })
    expect(soloSg.appVersion).toBeUndefined()
  })

  it('picks the first present candidate, skipping missing editions (Windows SOLO-only machine)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-pick-')); cleanup.push(root)
    // The cn install is absent on this machine; only the SOLO storage exists.
    const cnStorage = join(root, 'Trae CN', 'User', 'globalStorage', 'storage.json')
    const soloStorage = join(root, 'TRAE SOLO CN', 'User', 'globalStorage', 'storage.json')
    await mkdir(join(root, 'TRAE SOLO CN', 'User', 'globalStorage'), { recursive: true })
    await writeFile(soloStorage, JSON.stringify({ 'telemetry.devDeviceId': 'device-stable', 'telemetry.machineId': 'telemetry-machine' }))
    const value = await pickTraeStorageIdentity(
      [
        { edition: 'cn', path: cnStorage, source: 'desktop' },
        { edition: 'solo', path: soloStorage, source: 'desktop' },
      ],
      { platform: 'win32', home: root, env: {} },
    )
    expect(value.edition).toBe('solo')
    expect(value.machineId).toBe('telemetry-machine')
    expect(value.platform).toBe('win32')
  })

  it('throws a friendly error when every candidate storage is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-pick-')); cleanup.push(root)
    const cnStorage = join(root, 'Trae CN', 'User', 'globalStorage', 'storage.json')
    const soloStorage = join(root, 'TRAE SOLO CN', 'User', 'globalStorage', 'storage.json')
    await expect(pickTraeStorageIdentity(
      [
        { edition: 'cn', path: cnStorage, source: 'desktop' },
        { edition: 'solo', path: soloStorage, source: 'desktop' },
      ],
      { platform: 'win32', home: root, env: {} },
    )).rejects.toThrow(/Trae storage was not found/)
  })
})

describe('CLI-only identity (WSL2 / traecli machines)', () => {
  /** A machine with only the Trae CLI home: no storage.json anywhere. */
  async function cliOnlyHome(editionHome = '.trae-cn'): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'trae-cli-id-'))
    cleanup.push(root)
    await mkdir(join(root, editionHome, 'builtin'), { recursive: true })
    await writeFile(join(root, editionHome, 'argv.json'), JSON.stringify({ 'crash-reporter-id': '7ac9d0d8-0810-43bc-870b-ffe2b51a8333', locale: 'zh-cn' }))
    await writeFile(join(root, editionHome, 'builtin', 'ide_version.json'), JSON.stringify({ version: '1.0.31', releaseDate: '2026-07-06' }))
    return root
  }

  it('derives a stable identity from the CLI home when no desktop storage exists', async () => {
    const home = await cliOnlyHome()
    const candidates = [{ edition: 'cn' as const, path: join(home, '.config', 'trae-cn', 'User', 'globalStorage', 'storage.json'), source: 'desktop' as const }]
    const first = await resolveTraeIdentity(candidates, 'cn', { platform: 'linux', home, env: {} })
    const second = await resolveTraeIdentity(candidates, 'cn', { platform: 'linux', home, env: {} })
    // Deterministic: identical inputs never produce a new identity per request.
    expect(first).toEqual(second)
    // The device id is the CLI's own persisted crash-reporter UUID, and the
    // machine id keeps the 64-char hex shape the official clients send.
    expect(first.deviceId).toBe('7ac9d0d8-0810-43bc-870b-ffe2b51a8333')
    expect(first.machineId).toMatch(/^[0-9a-f]{64}$/)
    // The CLI build supplies the app version the desktop reader takes from product.json.
    expect(first.appVersion).toBe('1.0.31')
    expect(first.platform).toBe('linux')
  })

  it('still sends usable request headers for a CLI-only machine', async () => {
    const home = await cliOnlyHome()
    const identity = await readTraeCliIdentity('cn', { platform: 'linux', home, env: {} })
    const headers = identityHeaders(identity)
    expect(headers['x-machine-id']).toBe(identity.machineId)
    expect(headers['x-device-id']).toBe('7ac9d0d8-0810-43bc-870b-ffe2b51a8333')
    expect(headers['x-app-version']).toBe('1.0.31')
    expect(headers['x-device-type']).toBe('linux')
  })

  it('stays deterministic when the CLI home has no crash-reporter id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trae-cli-noid-')); cleanup.push(root)
    await mkdir(join(root, '.trae-cn'), { recursive: true })
    const a = await readTraeCliIdentity('cn', { platform: 'linux', home: root, env: { USER: 'wsl-user' } })
    const b = await readTraeCliIdentity('cn', { platform: 'linux', home: root, env: { USER: 'wsl-user' } })
    expect(a.deviceId).toBe(b.deviceId)
    expect(a.machineId).toBe(b.machineId)
  })

  it('prefers the desktop storage identity whenever one exists', async () => {
    const home = await cliOnlyHome()
    const storage = join(home, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(home, 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, JSON.stringify({ 'telemetry.devDeviceId': 'desktop-device', 'telemetry.machineId': 'desktop-machine' }))
    const identity = await resolveTraeIdentity([{ edition: 'cn', path: storage, source: 'desktop' }], 'cn', { platform: 'linux', home, env: {} })
    expect(identity.deviceId).toBe('desktop-device')
    expect(identity.machineId).toBe('desktop-machine')
  })

  it('reads the international CLI home for the ai region', async () => {
    const home = await cliOnlyHome('.trae')
    const identity = await readTraeCliIdentity('solo-sg', { platform: 'linux', home, env: {} })
    expect(identity.appVersion).toBe('1.0.31')
    expect(identity.deviceId).toBe('7ac9d0d8-0810-43bc-870b-ffe2b51a8333')
  })

  it('surfaces an existing-but-unparsable desktop file instead of masking it with the CLI identity', async () => {
    const home = await cliOnlyHome()
    const storage = join(home, 'User', 'globalStorage', 'storage.json')
    await mkdir(join(home, 'User', 'globalStorage'), { recursive: true })
    await writeFile(storage, '{broken')
    // A corrupt file surfaces its own parse error rather than being silently
    // replaced by the CLI identity (only a wholly ABSENT desktop install may
    // fall back).
    await expect(resolveTraeIdentity([{ edition: 'cn', path: storage, source: 'desktop' }], 'cn', { platform: 'linux', home, env: {} }))
      .rejects.toThrow(/JSON|identity could not be resolved|stable machine identity/)
  })
})
