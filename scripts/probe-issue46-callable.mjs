#!/usr/bin/env node
/**
 * Is each NEWLY PROMOTED model actually callable?
 *
 * Issue #46's fix promoted 7 models the plugin previously hid. The promotion
 * rule is evidence-based (usage / config_source / a real display name), but
 * "the wire roster knows this config_name" is not the same as "the gateway
 * accepts it under the function the row carries" — the roster is issued per
 * account tier, and a config can be listed for a function that refuses it.
 *
 * So this asks upstream, ONCE per model, through the plugin's own bridge:
 * the same wire resolution, the same function stamping, the same error
 * translation a real turn goes through.
 *
 * COST: one minimal chat call per model ("ping", no tools). The prompt is the
 * smallest a call can be, and the model is not told to do anything.
 */
import { readFile } from 'node:fs/promises'
import { decrypt } from './decrypt-block.js'

const mod = await import('../lib/index.js')
const { TraeSoloBridge, TraeSoloUpstreamClient, TraeCatalog } = mod

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

const upstream = new TraeSoloUpstreamClient({
  credential: async () => credential,
  identity: async () => identity,
})

// The catalog the bridge resolves against: the real merged catalog.
const remote = await new mod.TraeSoloRemoteCatalogClient({
  credential: async () => credential, identity: async () => identity,
}).fetchModels()
const wire = await upstream.fetchModels()
const merged = mod.mergeTraeModelSources(remote, wire)
const catalog = new TraeCatalog('cn')
catalog.set(merged)

// The wire resolver, exactly as the plugin builds it (wireTargetsOf).
const targets = mod.wireTargetsOf ? mod.wireTargetsOf(merged) : undefined
const resolver = (idOrName) => {
  if (targets === undefined) return undefined
  const key = String(idOrName ?? '').trim().toLowerCase()
  return targets.byId.get(key) ?? targets.byName.get(key)
}

const bridge = new TraeSoloBridge(upstream, catalog, resolver)

// The models this fix promoted (the 7 that the merge added).
const remoteIds = new Set(remote.map(m => m.id))
const promoted = merged.filter(m => !remoteIds.has(m.id))
console.log(`promoted models to test: ${promoted.length}\n`)

const results = []
for (const model of promoted) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let verdict, detail
  try {
    const result = await bridge.chatStream(JSON.stringify({
      model: model.id,
      messages: [{ role: 'user', content: 'ping' }],
    }), controller.signal)
    if (!result.ok) {
      verdict = `REFUSED(${result.status})`
      detail = result.message.slice(0, 200)
    } else {
      // Read the stream far enough to know whether output actually arrived.
      const text = await result.response.text()
      const hasOutput = /"content"\s*:\s*"(?!")/.test(text) || /event:output/.test(text)
      verdict = hasOutput ? 'AVAILABLE' : 'EMPTY'
      detail = text.slice(0, 160).replace(/\s+/g, ' ')
    }
  } catch (error) {
    verdict = controller.signal.aborted ? 'TIMEOUT' : 'ERROR'
    detail = String(error).slice(0, 200)
  } finally {
    clearTimeout(timer)
  }
  const ms = Date.now() - started
  results.push({ id: model.id, name: model.name, fn: model.wireFunction, verdict, detail, ms })
  console.log(`${verdict.padEnd(12)} ${model.id.padEnd(24)} fn=${String(model.wireFunction).padEnd(18)} ${ms}ms`)
  if (detail) console.log(`             ${detail}`)
  // Sequential on purpose: Trae throttles bursts.
  await new Promise(r => setTimeout(r, 1200))
}

console.log('\n=== SUMMARY ===')
const byVerdict = {}
for (const r of results) (byVerdict[r.verdict] ??= []).push(r.id)
for (const [v, ids] of Object.entries(byVerdict)) {
  console.log(`  ${v.padEnd(12)} ${ids.length}  ${ids.join(' , ')}`)
}
