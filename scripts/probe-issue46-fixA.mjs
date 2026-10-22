#!/usr/bin/env node
/**
 * The two models fix A surfaced (the widened Remote query), plus the dated
 * snapshot the reporter asked about.
 *
 * Fix A widened the Remote directory query, which surfaced `kimi-k2` (already
 * measured) and `doubao_1_8` (`Doubao-Seed-1.8`). The reporter's own model is
 * `deepseek-v4.1-flash-1017`, which does not exist on THIS account's roster —
 * but its undated sibling does, and that is the row the plugin serves for it.
 *
 * COST: one minimal chat call per model.
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

const catalog = new TraeCatalog('cn')
catalog.set(merged)
const targets = mod.wireTargetsOf(merged)
const resolver = id => {
  const key = String(id ?? '').trim().toLowerCase()
  return targets.byId.get(key) ?? targets.byName.get(key)
}
const bridge = new TraeSoloBridge(upstream, catalog, resolver)

async function ask(model) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const started = Date.now()
  try {
    const result = await bridge.chatStream(
      JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }] }),
      controller.signal,
    )
    const ms = Date.now() - started
    if (!result.ok) return { verdict: `REFUSED(${result.status})`, detail: result.message.slice(0, 220), ms }
    const text = await result.response.text()
    const hasOutput = /"content"\s*:\s*"(?!")/.test(text) || /event:output/.test(text)
    return { verdict: hasOutput ? 'AVAILABLE' : 'EMPTY', detail: text.slice(0, 120).replace(/\s+/g, ' '), ms }
  } catch (error) {
    return { verdict: controller.signal.aborted ? 'TIMEOUT' : 'ERROR', detail: String(error).slice(0, 220), ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

const targetsToTest = [
  'doubao_1_8',                 // fix A, from the widened Remote query
  'deepseek-v4.1-flash',        // the reporter's model (its undated sibling)
  'kimi-k2-0905',               // the dated snapshot family
  'seed-code-pro-0430',         // the dated snapshot the fix promoted
]

console.log('=== the rows the plugin serves for these ===')
for (const id of targetsToTest) {
  const row = merged.find(m => m.id === id)
  console.log(`  ${id.padEnd(24)} ${row ? `${row.name} | fn=${row.wireFunction ?? '-'} | ctx=${row.contextWindow ?? '-'}` : 'NOT IN THE CATALOG'}`)
}

console.log('\n=== real calls ===')
for (const id of targetsToTest) {
  if (!merged.some(m => m.id === id)) {
    console.log(`\nSKIP        ${id.padEnd(24)} not in the catalog`)
    continue
  }
  const r = await ask(id)
  console.log(`\n${r.verdict.padEnd(12)} ${id.padEnd(24)} ${r.ms}ms`)
  if (r.detail) console.log(`             ${r.detail}`)
  await new Promise(res => setTimeout(res, 1200))
}
