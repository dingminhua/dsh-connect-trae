#!/usr/bin/env node
/**
 * Read-only CN probe for issue #42: does the CN upstream actually publish the
 * max OUTPUT cap (`model_detail_list[].max_tokens` in get_detail_param), and
 * where does the exposed catalog lose it?
 *
 * The reporter saw 32/32 CN models with maxTokens==null on /models/refresh and
 * asked whether upstream simply doesn't publish it. This probe replays the
 * plugin's OWN chain with the published lib bundle:
 *   1. get_detail_param per TRAE_DIRECTORY_FUNCTIONS.cn -> raw per-config
 *      `model_detail_list` capture (how MANY detail items exist, which keys
 *      carry output caps: max_tokens / max_completion_tokens / later items?)
 *   2. the plugin's remote /models directory -> parseTraeRemoteModel
 *   3. mergeTraeModelSources (the suspect) — showing maxTokens before/after
 * No chat calls, no quota, no token output. Safe to run.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'

const CN_STORAGE = '/Users/<user>/Library/Application Support/Trae CN/User/globalStorage/storage.json'
const CN_PRODUCT = '/Applications/Trae CN.app/Contents/Resources/app/product.json'

const SALT_A = Uint8Array.from([82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37])
const SALT_B = Uint8Array.from([31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125])
const SALT_C = Uint8Array.from([191,192,216,250,122,246,220,97,31,254,98,27,8,72,71,176,135,99,96,18,127,101,203,104,211,102,191,125,37,72,150,156,51,229,121,35,17,153,141,177,110,131,150,128,172,255,254,6,18,140,55,62,236,249,135,64,135,12,117,4,89,149,168,209])
const SALT_D = Uint8Array.from([246,204,26,232,232,70,129,109,223,146,169,242,23,241,105,145,50,196,165,42,254,120,3,54,244,207,209,85,53,6,138,106,175,148,31,204,186,186,165,182,87,142,49,10,39,110,26,154,86,56,173,125,18,64,198,225,99,99,83,82,191,134,76,170])
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ (b[i] ?? 0)))
function decryptTraeStorageValue(encoded) {
  const buffer = Buffer.from(encoded, 'base64')
  const header = buffer.subarray(0, 6)
  let type
  if (header.equals(Buffer.from([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]))) type = 'aes'
  else if (header.equals(Buffer.from([18, 57, 32, 32, 2, 3]))) type = 'aes-private'
  else throw new Error('unsupported header')
  const salt = type === 'aes-private' ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B)
  const first = createHash('sha512').update(buffer.subarray(6, 38)).digest()
  const derived = createHash('sha512').update(Buffer.concat([first, salt])).digest()
  const decipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32))
  const decrypted = Buffer.concat([decipher.update(buffer.subarray(38)), decipher.final()])
  return decrypted.subarray(64).toString('utf8')
}

const { parseTraeRemoteModel, mergeTraeModelSources } = await import('../lib/index.js')
// TRAE_DIRECTORY_FUNCTIONS.cn (src/solo.ts:75) is not in the public export
// surface; mirror the literal here — the probe only replays the same request
// shape the plugin itself sends.
const CN_FUNCTIONS = ['solo_work_remote', 'solo_work_lite', 'solo_agent_remote', 'chat_v3', 'solo_coder']

const storage = JSON.parse(await readFile(CN_STORAGE, 'utf8'))
const credential = JSON.parse(decryptTraeStorageValue(storage['iCubeAuthInfo://icube.cloudide']))
const machineId = storage['telemetry.machineId']
const dcKey = Object.keys(storage).find(key => key.startsWith('iCubeAuthInfo://icube-dc:'))
const deviceId = dcKey.slice('iCubeAuthInfo://icube-dc:'.length)
const buildVersion = String(storage['iCubeLastVersion'] ?? '')
const product = JSON.parse(await readFile(CN_PRODUCT, 'utf8'))
const versionCode = /^\d+$/.test(buildVersion) ? buildVersion : '20260716'

const CHAT_BASE = 'https://trae-api-cn.mchost.guru'
const headers = {
  'Authorization': `Cloud-IDE-JWT ${credential.token}`,
  'X-Ide-Token': credential.token,
  'X-Cloudide-Token': credential.token,
  'x-plugin-channel': 'icube-ai',
  'User-Agent': `Trae/${product.appVersion ?? 'unknown'}`,
  'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
  'x-machine-id': machineId,
  'x-device-id': deviceId,
  'x-device-type': 'mac',
  'x-app-version': product.appVersion,
  'x-ide-version': product.appVersion,
  'x-app-version-code': versionCode,
  'x-ide-version-code': versionCode,
  'x-ide-version-type': 'stable',
  'x-uid': credential.userId ?? '',
  'request-traffic-type': 'prod',
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

// 1. get_detail_param, CN account, every function the plugin asks.
const functions = CN_FUNCTIONS
console.log(`CN functions probed: ${functions.join(', ')}`)
const outputKeyCandidates = ['max_tokens', 'max_output_tokens', 'max_completion_tokens']
const wireRows = new Map()
let detailItemsObserved = 0
let multiDetailConfigs = 0
const unknownOutputishKeys = new Set()
for (const fn of functions) {
  let list
  try {
    const res = await fetch(`${CHAT_BASE}/api/ide/v1/get_detail_param`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ function: fn, config_names: null, need_prompt: false, current_config_info: null, poly_prompt: true, mode_type: null, agent_type: null }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) { console.log(`  ${fn}: HTTP ${res.status} (skipped)`); continue }
    const doc = await res.json()
    list = Array.isArray(doc?.config_info_list) ? doc.config_info_list : []
  } catch (error) { console.log(`  ${fn}: ${String(error).slice(0, 80)}`); continue }
  console.log(`  ${fn}: ${list.length} configs`)
  for (const config of list) {
    const id = config?.config_name
    if (typeof id !== 'string' || id === '') continue
    const details = Array.isArray(config.model_detail_list) ? config.model_detail_list : []
    if (details.length > 1) multiDetailConfigs += 1
    detailItemsObserved = Math.max(detailItemsObserved, details.length)
    // Scan EVERY detail item for output-cap keys, and every key name that
    // looks output-ish, to answer the reporter's "could the cap live in a
    // later item / different key?" question with data.
    let maxTokens
    for (const detail of details) {
      if (detail === null || typeof detail !== 'object') continue
      for (const key of Object.keys(detail)) {
        if (/max.*(token|completion)|(token|completion).*max/i.test(key) && !outputKeyCandidates.includes(key) && key !== 'prompt_max_tokens') unknownOutputishKeys.add(key)
      }
      const value = detail['max_tokens']
      if (typeof value === 'number' && Number.isFinite(value) && value > 0 && maxTokens === undefined) maxTokens = value
    }
    const name = config?.display_config?.display_name ?? id
    if (!wireRows.has(id)) wireRows.set(id, { id, name, ...maxTokens === undefined ? {} : { maxTokens }, function: fn })
  }
}
const withOutput = [...wireRows.values()].filter(row => row.maxTokens !== undefined)
console.log(`\nwire roster: ${wireRows.size} unique configs, ${withOutput.length} carry model_detail_list[].max_tokens`)
console.log(`detail items per config: max observed ${detailItemsObserved}, configs with >1 item: ${multiDetailConfigs}`)
console.log(`other output-ish keys seen: ${unknownOutputishKeys.size ? [...unknownOutputishKeys].join(', ') : '(none)'}`)
for (const row of wireRows.values()) {
  console.log(`  ${row.id.padEnd(28)} out=${row.maxTokens ?? '-'}`)
}

// 2. remote directory + the plugin's own merge, to show where the value dies.
const remoteResponse = await fetch('https://solo.trae.cn/api/remote/v1/models?functions=solo_agent,solo_agent_remote,solo_work_remote,solo_work_lite,chat_v3,solo_coder,builder_v3', {
  headers: {
    'Authorization': `Cloud-IDE-JWT ${credential.token}`,
    'Content-Type': 'application/json',
    'x-trae-client-type': 'web',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  signal: AbortSignal.timeout(30_000),
})
const remoteJson = await remoteResponse.json()
const groups = remoteJson?.data?.list ?? []
console.log(`\nremote models: HTTP ${remoteResponse.status}, groups: ${groups.map(g => `${g.function}(${(g.models ?? []).length})`).join(', ')}`)
const seen = new Map()
for (const group of groups) {
  for (const raw of group.models ?? []) {
    const model = parseTraeRemoteModel(raw)
    if (model !== undefined && !seen.has(model.id)) seen.set(model.id, model)
  }
}
console.log(`remote unique models: ${seen.size}`)
const merged = mergeTraeModelSources([...seen.values()], [...wireRows.values()])
const mergedWithMax = merged.filter(model => model.maxTokens !== undefined)
console.log(`\nmerged (current shipped code): ${merged.length} models, ${mergedWithMax.length} with maxTokens  <-- THE BUG if 0 while wire has ${withOutput.length}`)
const mergedMissing = merged.filter(model => model.maxTokens === undefined)
console.log('merged rows WITHOUT maxTokens: ' + (mergedMissing.map(model => `${model.id} (${model.name})`).join(', ') || 'none'))

// 4. For configs with TWO detail items, show each item's caps — answers the
// reporter's "could the output cap live in a later detail item?" question.
const twoItem = []
for (const fn of functions) {
  const res2 = await fetch(`${CHAT_BASE}/api/ide/v1/get_detail_param`, {
    method: 'POST', headers,
    body: JSON.stringify({ function: fn, config_names: null, need_prompt: false, current_config_info: null, poly_prompt: true, mode_type: null, agent_type: null }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res2.ok) continue
  const doc2 = await res2.json()
  for (const config of doc2?.config_info_list ?? []) {
    const details = Array.isArray(config?.model_detail_list) ? config.model_detail_list : []
    if (details.length > 1) twoItem.push({ fn, id: config.config_name, details: details.map(d => ({ model_name: d.model_name, prompt_max_tokens: d.prompt_max_tokens, max_tokens: d.max_tokens })) })
  }
  if (twoItem.length >= 8) break
}
console.log('\ntwo-item detail samples:')
for (const t of twoItem.slice(0, 8)) console.log(`  [${t.fn}] ${t.id}: ` + t.details.map(d => `${d.model_name} p=${d.prompt_max_tokens} m=${d.max_tokens}`).join(' | '))
