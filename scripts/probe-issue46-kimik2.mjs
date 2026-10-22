#!/usr/bin/env node
/**
 * Is `kimi-k2` (the fix-A model) callable, and through WHICH function?
 *
 * It is the one promoted model whose owning function is `inline_chat` — a
 * function the plugin's callable list does NOT contain, so its callability was
 * explicitly left unproven. The plugin's bridge replays the row's own
 * function, so the question is whether the gateway serves that config_name
 * under `inline_chat` at all.
 *
 * The same model is ALSO listed under `chat_v3` in the wire roster, so it is
 * asked under both functions: that separates "the model is not served" from
 * "this particular function does not serve it".
 *
 * COST: two minimal chat calls.
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
  credential: async () => credential, identity: async () => identity,
})
const remote = await new mod.TraeSoloRemoteCatalogClient({
  credential: async () => credential, identity: async () => identity,
}).fetchModels()
const wire = await upstream.fetchModels()
const merged = mod.mergeTraeModelSources(remote, wire)

// The row the plugin would serve.
const row = merged.find(m => m.id === 'kimi-k2')
console.log('=== the catalog row for kimi-k2 ===')
console.log(JSON.stringify(row, null, 2))

// Which functions does the wire roster list it under?
console.log('\n=== the functions the wire roster lists kimi-k2 under ===')
console.log('  ', wire.filter(w => w.id === 'kimi-k2').map(w => `${w.function} (display=${w.name})`).join(' , '))

const catalog = new TraeCatalog('cn')
catalog.set(merged)
const targets = mod.wireTargetsOf(merged)
const resolver = id => {
  const key = String(id ?? '').trim().toLowerCase()
  return targets.byId.get(key) ?? targets.byName.get(key)
}
const bridge = new TraeSoloBridge(upstream, catalog, resolver)

async function ask(model, fn) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const started = Date.now()
  try {
    const result = await bridge.chatStream(
      JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }] }),
      controller.signal,
      fn,
    )
    const ms = Date.now() - started
    if (!result.ok) return { verdict: `REFUSED(${result.status})`, detail: result.message.slice(0, 220), ms }
    const text = await result.response.text()
    const hasOutput = /"content"\s*:\s*"(?!")/.test(text) || /event:output/.test(text)
    return { verdict: hasOutput ? 'AVAILABLE' : 'EMPTY', detail: text.slice(0, 140).replace(/\s+/g, ' '), ms }
  } catch (error) {
    return { verdict: controller.signal.aborted ? 'TIMEOUT' : 'ERROR', detail: String(error).slice(0, 220), ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

for (const fn of ['inline_chat', 'chat_v3', 'solo_work_remote']) {
  const r = await ask('kimi-k2', fn)
  console.log(`\n${r.verdict.padEnd(12)} fn=${fn.padEnd(18)} ${r.ms}ms`)
  if (r.detail) console.log(`             ${r.detail}`)
  await new Promise(r2 => setTimeout(r2, 1200))
}
