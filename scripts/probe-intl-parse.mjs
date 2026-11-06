#!/usr/bin/env node
/**
 * Feed the international (SG) responses through the plugin's OWN CN parsers
 * (the published lib bundle) to prove wire-format compatibility:
 *   - coresg remote models -> parseTraeRemoteModel (model-metadata.ts)
 *   - coresg get_detail_param -> the config_info_list shape solo.ts reads
 * Read-only GET/POST catalog queries; no chat, no refresh, no token output.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'

const INTL_SOLO_STORAGE = '/Users/<user>/Library/Application Support/TRAE SOLO/User/globalStorage/storage.json'
const CORESG = 'https://coresg-normal.trae.ai'

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

// The plugin's own published parsers.
const { parseTraeRemoteModel, mergeTraeModelSources } = await import('../lib/index.js')

const storage = JSON.parse(await readFile(INTL_SOLO_STORAGE, 'utf8'))
const credential = JSON.parse(decryptTraeStorageValue(storage['iCubeAuthInfo://icube.cloudide']))
const machineId = storage['telemetry.machineId']
const dcKey = Object.keys(storage).find(key => key.startsWith('iCubeAuthInfo://icube-dc:'))
const deviceId = dcKey.slice('iCubeAuthInfo://icube-dc:'.length)
const buildVersion = storage['iCubeLastVersion']
const product = JSON.parse(await readFile('/Applications/TRAE SOLO.app/Contents/Resources/app/product.json', 'utf8'))
const numericVersionCode = /^\d+$/.test(String(buildVersion ?? '')) ? String(buildVersion) : '20260716'

function traeHeaders(extra = {}) {
  return {
    'Authorization': `Cloud-IDE-JWT ${credential.token}`,
    'X-Ide-Token': credential.token,
    'x-plugin-channel': 'icube-ai',
    'User-Agent': `Trae/${product.appVersion ?? 'unknown'}`,
    'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
    'x-machine-id': machineId,
    'x-device-id': deviceId,
    'x-device-type': 'mac',
    'x-app-version': product.appVersion,
    'x-ide-version': product.appVersion,
    'x-app-version-code': numericVersionCode,
    'x-ide-version-code': numericVersionCode,
    'x-ide-version-type': 'stable',
    'request-traffic-type': 'prod',
    'Content-Type': 'application/json',
    ...extra,
  }
}

// 1. remote models through parseTraeRemoteModel (the CN plugin's own parser)
const remoteResponse = await fetch(`${CORESG}/api/remote/v1/models?functions=solo_agent_remote,solo_work_remote`, {
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
const parsedRemote = []
for (const group of groups) {
  for (const raw of group.models ?? []) {
    const model = parseTraeRemoteModel(raw)
    if (model === undefined) { console.log(`  !! unparsable entry: ${JSON.stringify(raw).slice(0, 120)}`); continue }
    parsedRemote.push(model)
    console.log(`  ok ${model.id.padEnd(22)} name=${model.name.padEnd(24)} ctx=${model.contextWindow ?? '-'} max=${model.maxContextWindow ?? '-'} mm=${model.multimodal} rate=${model.creditMultiplier ?? '-'} reasoning=${model.reasoning ? model.reasoning.supported.join('/') : model.reasoningSupported ? 'yes(no-levels)' : 'no'}`)
  }
}

// 2. get_detail_param through the solo.ts wire-directory shape
const detailResponse = await fetch(`${CORESG}/api/ide/v1/get_detail_param`, {
  method: 'POST',
  headers: traeHeaders({ Accept: 'application/json' }),
  body: JSON.stringify({ function: 'solo_work_lite', config_names: null, need_prompt: false, current_config_info: null, poly_prompt: true, mode_type: null, agent_type: null }),
  signal: AbortSignal.timeout(30_000),
})
const detailJson = await detailResponse.json()
console.log(`\nget_detail_param: HTTP ${detailResponse.status}, config_info_list=${(detailJson?.config_info_list ?? []).length}`)
const wire = []
for (const config of detailJson?.config_info_list ?? []) {
  const detail = Array.isArray(config.model_detail_list) ? config.model_detail_list[0] : {}
  const ctx = detail.prompt_max_tokens ?? config.context_window_tokens?.dev
  const out = detail.max_tokens
  const name = config.display_config?.display_name ?? config.config_name
  wire.push({ id: config.config_name, name, ...ctx !== undefined ? { contextWindow: ctx } : {}, ...out !== undefined ? { maxTokens: out } : {} })
  console.log(`  ok ${String(config.config_name).padEnd(30)} display=${String(name).padEnd(24)} ctx=${ctx ?? '-'} out=${out ?? '-'}`)
}

// 3. The plugin's own merge (remote skeleton + wire ids), exactly like discoverModels does
const merged = mergeTraeModelSources(parsedRemote, wire)
console.log(`\nmerged catalog (mergeTraeModelSources): ${merged.length} models`)
for (const model of merged) {
  console.log(`  ${model.id.padEnd(22)} name=${String(model.name).padEnd(24)} ctx=${model.contextWindow ?? '-'} maxTok=${model.maxTokens ?? '-'} wire=${model.wireConfigName ?? '(id)'}`)
}
