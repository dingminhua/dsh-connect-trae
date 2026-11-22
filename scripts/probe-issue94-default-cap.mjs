#!/usr/bin/env node
/**
 * What output cap does the upstream apply when the request does NOT carry
 * `max_tokens`? (issue #94, question 3)
 *
 * The catalog publishes a per-config cap (`model_detail_list[].max_tokens`,
 * measured 2026-11-22: CN 738/780 rows, international 731/731), and the plugin
 * forwards the entry's `maxTokens` as `max_tokens`. But a row with no cap —
 * a join-miss row with no wire config — sends no `max_tokens`, and then the
 * UPSTREAM decides. This measures that default.
 *
 * Method: one chat call through the plugin's own bridge (same wire resolution,
 * same body), WITHOUT `max_tokens`, asking for a very long output. Whatever
 * the upstream truncates at IS the default cap:
 *   - finish_reason "length" + completion_tokens == N  → the default is N;
 *   - finish_reason "stop"                              → the default is above
 *     what was asked for (the request said 50000 lines).
 *
 * COST: one generation, bounded by the cap being measured (the model stops
 * there). The balance is read before and after so the cost is a measured
 * number, not an estimate.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

const LIB = new URL('../lib/index.js', import.meta.url).pathname
const mod = await import(LIB)
const { TraeSoloBridge, TraeSoloUpstreamClient, TraeSoloRemoteCatalogClient, TraeCatalog, TraeUsageClient, mergeTraeModelSources, wireTargetsOf, readTraeIdentity, refreshTraeCredential } = mod

const HOME = process.env.TRAE_PROBE_HOME ?? homedir()
const MODEL = process.env.TRAE_PROBE_MODEL ?? 'deepseek-v4.1-flash'
const LINES = 50_000

const storagePath = `${HOME}/Library/Application Support/Trae CN/User/globalStorage/storage.json`
const storage = JSON.parse(await readFile(storagePath, 'utf8'))
const stored = JSON.parse(mod.decryptTraeStorageValue(storage['iCubeAuthInfo://icube.cloudide']))
const identity = await readTraeIdentity({ edition: 'cn', path: storagePath, source: 'desktop' })
const credential = { accessToken: stored.token, refreshToken: stored.refreshToken, userId: stored.userId, host: stored.host, userRegion: stored.userRegion, edition: 'cn' }
const outcome = await refreshTraeCredential(credential, undefined, identity)
const fresh = { ...credential, accessToken: outcome.accessToken, refreshToken: outcome.refreshToken ?? credential.refreshToken }

const upstream = new TraeSoloUpstreamClient({ credential: async () => fresh, identity: async () => identity })
const remote = await new mod.TraeSoloRemoteCatalogClient({ credential: async () => fresh, identity: async () => identity }).fetchModels()
const wire = await upstream.fetchModels()
const merged = mergeTraeModelSources(remote, wire)
const catalog = new TraeCatalog('cn')
catalog.set(merged)
const targets = wireTargetsOf(merged)
const resolver = (idOrName) => {
  const key = String(idOrName ?? '').trim().toLowerCase()
  return targets.byId.get(key) ?? targets.byName.get(key)
}
const bridge = new TraeSoloBridge(upstream, catalog, resolver)

const row = merged.find(model => model.id === MODEL)
console.log(`model row: ${MODEL} → maxTokens=${row?.maxTokens ?? '-'} contextWindow=${row?.contextWindow ?? '-'} wire=${row?.wireConfigName ?? '-'}`)

const usage = new TraeUsageClient({ credential: async () => fresh, deviceId: async () => identity.deviceId })
const before = await usage.snapshot().catch(() => undefined)

async function probe(label, body) {
  const result = await bridge.chatStream(JSON.stringify(body))
  if (!result.ok) { console.log(`${label}: request failed — ${result.message}`); return undefined }
  const text = await result.response.text()
  const chunks = text.split('\n\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map(line => JSON.parse(line.slice('data: '.length)))
  const finish = chunks.map(chunk => chunk.choices?.[0]?.finish_reason).filter(Boolean)
  const usageChunk = chunks.find(chunk => chunk.usage)?.usage
  const body_ = chunks.map(chunk => chunk.choices?.[0]?.delta?.content ?? '').join('')
  const lines = body_.split('\n').filter(line => line.trim() !== '').length
  console.log(`${label}: finish_reason=${finish.join(',') || '-'} completion_tokens=${usageChunk?.completion_tokens ?? '-'} output_lines=${lines} last=${JSON.stringify(body_.slice(-60))}`)
  return { finish, usage: usageChunk, lines }
}

const messages = [{ role: 'user', content: `请从 1 开始连续输出整数，每行一个，一直输出到 ${LINES}，不要停，也不要加别的内容。` }]
const only = process.env.TRAE_PROBE_ONLY

if (only !== 'd') {
  console.log('\n--- A: no max_tokens (the upstream default) ---')
  await probe('A no max_tokens', { model: MODEL, messages, stream: true })

  console.log('\n--- B: explicit max_tokens = the published cap ---')
  const cap = row?.maxTokens
  if (typeof cap === 'number') {
    await probe(`B max_tokens=${cap}`, { model: MODEL, messages, stream: true, max_tokens: cap })
  } else {
    console.log('B: the row carries no cap — skipped')
  }

  console.log('\n--- C: max_tokens far above the cap (does the upstream validate?) ---')
  await probe('C max_tokens=999999', { model: MODEL, messages: [{ role: 'user', content: '回答 OK' }], stream: true, max_tokens: 999_999 })
}

if (only !== 'a' && only !== 'b' && only !== 'c') {
  // D1: is the REQUEST's cap honoured when it is BELOW the model's published
  // cap? (cheap: the answer is ~4000 tokens.) Together with "no request →
  // the published cap" this pins the semantics to min(requested, model cap).
  console.log('\n--- D1: max_tokens = 4000 (below the published cap) ---')
  await probe('D1 max_tokens=4000', { model: MODEL, messages, stream: true, max_tokens: 4_000 })

  // D2: can the REQUEST raise the model's own published cap? Twice the cap.
  // The model sometimes refuses a "count to 50000" request, so this is the
  // one probe whose result can be a refusal — which means nothing either way.
  console.log('\n--- D2: max_tokens = 2x the published cap ---')
  await probe('D2 max_tokens=64000', { model: MODEL, messages, stream: true, max_tokens: 64_000 })
}

const after = await usage.snapshot().catch(() => undefined)
if (before !== undefined && after !== undefined) {
  const pick = snapshot => snapshot.packs?.reduce((sum, pack) => sum + (pack.consumedCredits ?? 0), 0)
  console.log(`\ncredits consumed by this probe: ${((pick(after) ?? 0) - (pick(before) ?? 0)).toFixed(4)}`)
}
