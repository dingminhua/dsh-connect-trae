#!/usr/bin/env node
/**
 * Is the dated-snapshot config ("-MMDD") a DISPLAY ALIAS, or a real,
 * separate config_name that upstream publishes?
 *
 * The reporter's IDE menu lists BOTH `DeepSeek-V4.1-Flash-1017` AND
 * `DeepSeek-V4.1-Flash` as separate rows. If they were the same model with
 * one alias, the IDE could not show both.
 *
 * This asks every directory for the dated names and reports, per directory,
 * whether dated config_names exist at all.
 */
import { readFile } from 'node:fs/promises'
import { decrypt } from './decrypt-block.js'

const mod = await import('../lib/index.js')
const { buildTraeCnHeaders, REGION_GATEWAYS } = mod

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
const detailHeaders = buildTraeCnHeaders(credential, identity, { profile: 'model-detail' })
const remoteHeaders = {
  ...detailHeaders, 'x-trae-client-type': 'web', 'x-trae-user-timezone': 'Asia/Shanghai',
  'x-preferred-language': 'zh-cn', Referer: 'https://solo.trae.cn/',
}

const DATED = /-\d{4}$/
const IDE_FUNCTIONS = [
  'ui_builder_v2', 'solo_coder', 'chat_v3', 'solo_builder', 'builder_v3', 'builder', 'chat', 'inline_chat',
  'git_ai', 'custom_agent_generation', 'utils', 'code_reviewer', 'code_review_summary', 'solo_agent',
  'solo_agent_remote', 'solo_work_remote', 'solo_agent_lite', 'solo_work_lite', 'solo_design_lite',
  'solo_design_remote', 'multimodal', 'system_diagnosis',
]
const ALL_REMOTE = [
  'solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3',
  'ui_builder_v2', 'solo_builder', 'builder', 'chat', 'inline_chat', 'git_ai', 'custom_agent_generation',
  'utils', 'code_reviewer', 'code_review_summary', 'solo_agent_lite', 'solo_design_lite', 'solo_design_remote',
  'multimodal', 'system_diagnosis',
]

// --- 1. the IDE wide roster ---
const ideRes = await fetch(`${REGION_GATEWAYS.cn.chat}/api/ide/v1/batch_get_detail_param`, {
  method: 'POST', headers: detailHeaders,
  body: JSON.stringify({
    functions: IDE_FUNCTIONS, agent_type: '',
    current_config_info: { config_name: '', is_custom_model: false },
    mode_type: 0, access_type: 0, ab_force_vids: '', ab_autotest_advanced_mode: 0,
  }),
})
const ideJson = await ideRes.json()
const ideRows = new Map()
for (const e of ideJson.function_configs ?? []) {
  for (const r of e.config_info_list ?? []) {
    const id = r.config_name
    const disp = (r.display_config ?? {}).display_name ?? ''
    if (!ideRows.has(id)) ideRows.set(id, { id, disp, fns: new Set() })
    ideRows.get(id).fns.add(e.function)
  }
}

console.log('=== 1. IDE roster: dated config_names (id itself ends in -MMDD) ===')
const ideDated = [...ideRows.values()].filter(r => DATED.test(r.id))
for (const r of ideDated) console.log(`  id=${r.id.padEnd(30)} display=${JSON.stringify(r.disp).padEnd(24)} fns=${[...r.fns].join(',')}`)

console.log('\n=== 2. IDE roster: rows whose DISPLAY name ends in -MMDD ===')
const ideDispDated = [...ideRows.values()].filter(r => DATED.test(String(r.disp)))
for (const r of ideDispDated) console.log(`  id=${r.id.padEnd(30)} display=${JSON.stringify(r.disp)}`)

console.log('\n=== 3. Do a dated id and its undated twin share ONE display name? ===')
for (const r of ideDispDated) {
  const twins = [...ideRows.values()].filter(o => o.disp === r.disp)
  console.log(`  display=${JSON.stringify(r.disp)} <- ids: ${twins.map(t => t.id).join(' , ')}`)
}

// --- 4. the Remote skeleton, with EVERY function asked ---
console.log('\n=== 4. Remote skeleton, EVERY function asked: are dated ids there? ===')
const rr = await fetch(`https://solo.trae.cn/api/remote/v1/models?functions=${ALL_REMOTE.join(',')}`, { headers: remoteHeaders })
const rj = await rr.json()
const remRows = new Map()
for (const g of rj?.data?.list ?? []) {
  for (const m of g.models ?? []) {
    if (!remRows.has(m.name)) remRows.set(m.name, { id: m.name, disp: m.display_name ?? '', fns: new Set() })
    remRows.get(m.name).fns.add(g.function)
  }
}
console.log(`  rows: ${remRows.size}`)
const remDated = [...remRows.values()].filter(r => DATED.test(r.id))
console.log(`  dated config_names in the Remote skeleton: ${remDated.length ? remDated.map(r => r.id).join(', ') : '(NONE)'}`)
const remDispDated = [...remRows.values()].filter(r => DATED.test(String(r.disp)))
console.log(`  rows whose DISPLAY ends in -MMDD: ${remDispDated.length ? remDispDated.map(r => `${r.id} -> ${r.disp}`).join(' , ') : '(NONE)'}`)

console.log('\n=== 5. Cross-check: for every dated id in the IDE roster, is it in the Remote skeleton? ===')
for (const r of ideDated) {
  console.log(`  ${r.id.padEnd(30)} in-Remote=${remRows.has(r.id)}`)
}
console.log('\n  (and the reverse: rows the Remote skeleton has that the IDE roster does not)')
for (const r of remRows.values()) {
  if (!ideRows.has(r.id)) console.log(`  ${r.id.padEnd(30)} display=${JSON.stringify(r.disp)}  <== REMOTE-ONLY`)
}
