#!/usr/bin/env node
/**
 * Read-only credit balance, before/after the callability probe.
 *
 * The probe spends one minimal chat call per model; this records the balance
 * either side of it so the real cost is a measured number rather than an
 * estimate. Reads only — a usage read consumes nothing.
 */
import { readFile } from 'node:fs/promises'
import { decrypt } from './decrypt-block.js'

const mod = await import('../lib/index.js')
const { TraeUsageClient } = mod

const storage = JSON.parse(await readFile('/Users/dmh2002/Library/Application Support/Trae CN/User/globalStorage/storage.json', 'utf8'))
const raw = JSON.parse(decrypt(storage['iCubeAuthInfo://icube.cloudide']))
const product = JSON.parse(await readFile('/Applications/Trae CN.app/Contents/Resources/app/product.json', 'utf8'))
const dcKey = Object.keys(storage).find(key => key.startsWith('iCubeAuthInfo://icube-dc:'))
const identity = {
  edition: 'cn', machineId: storage['telemetry.machineId'],
  deviceId: dcKey.slice('iCubeAuthInfo://icube-dc:'.length),
  appVersion: product.appVersion, buildVersion: storage['iCubeLastVersion'],
  osVersion: 'macOS probe', platform: 'darwin',
}
const credential = { accessToken: raw.token, refreshToken: raw.refreshToken, userId: raw.userId, host: raw.host, userRegion: raw.userRegion, edition: 'cn' }

const client = new TraeUsageClient({
  credential: async () => credential,
  deviceId: async () => identity.deviceId,
})
try {
  const snap = await client.snapshot()
  console.log(JSON.stringify({
    summary: snap.summary,
    packs: (snap.packs ?? []).map(p => ({
      desc: p.displayDesc,
      currency: p.currency,
      creditsLimit: p.creditsLimit,
      consumedCredits: p.consumedCredits,
      endpoint: p.availableEndpoint,
    })),
  }, null, 2))
} catch (error) {
  console.log('usage read failed:', String(error).slice(0, 300))
}
