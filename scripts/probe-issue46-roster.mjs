#!/usr/bin/env node
/**
 * Issue #46 — "模型列表不对齐，无法获取 DeepSeek-V4.1-Flash-1017 模型ID".
 *
 * Read-only, zero completion cost. One script that answers every question the
 * issue raises, against the live account:
 *
 *   1. Where does the IDE's model list come from?      (the WIRE roster)
 *   2. Where does the plugin's model list come from?    (the REMOTE skeleton)
 *   3. Does upstream publish a "1017" id at all?
 *   4. Which upstream models does the plugin's join DROP?
 *   5. Where do the two lists' DISPLAY NAMES disagree?
 *
 * Usage: node scripts/probe-issue46-roster.mjs
 */
import { readFile } from 'node:fs/promises'
import { decrypt } from './decrypt-block.js'

const mod = await import('../lib/index.js')
const { buildTraeCnHeaders, mergeTraeModelSources, REGION_GATEWAYS } = mod

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
const credential = {
  accessToken: raw.token, refreshToken: raw.refreshToken, userId: raw.userId,
  host: raw.host, userRegion: raw.userRegion, edition: 'cn',
}

// The plugin's own remote-directory function list (src/solo-remote.ts)
const PLUGIN_REMOTE_FUNCTIONS = ['solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3']
// The IDE's own function list (src/model-detail.ts) — the "内置模型" picker
const IDE_FUNCTIONS = [
  'ui_builder_v2', 'solo_coder', 'chat_v3', 'solo_builder', 'builder_v3', 'builder', 'chat', 'inline_chat',
  'git_ai', 'custom_agent_generation', 'utils', 'code_reviewer', 'code_review_summary', 'solo_agent',
  'solo_agent_remote', 'solo_work_remote', 'solo_agent_lite', 'solo_work_lite', 'solo_design_lite',
  'solo_design_remote', 'multimodal', 'system_diagnosis',
]

const detailHeaders = buildTraeCnHeaders(credential, identity, { profile: 'model-detail' })
const remoteHeaders = {
  ...detailHeaders,
  'x-trae-client-type': 'web', 'x-trae-user-timezone': 'Asia/Shanghai',
  'x-preferred-language': 'zh-cn', Referer: 'https://solo.trae.cn/',
}

/** The IDE's wide roster: every IDE function, one call. */
async function ideRoster() {
  const res = await fetch(`${REGION_GATEWAYS.cn.chat}/api/ide/v1/batch_get_detail_param`, {
    method: 'POST', headers: detailHeaders,
    body: JSON.stringify({
      functions: IDE_FUNCTIONS, agent_type: '',
      current_config_info: { config_name: '', is_custom_model: false },
      mode_type: 0, access_type: 0, ab_force_vids: '', ab_autotest_advanced_mode: 0,
    }),
  })
  const text = await res.text()
  const json = JSON.parse(text)
  const rows = new Map()
  for (const entry of json?.function_configs ?? []) {
    for (const r of entry.config_info_list ?? []) {
      const id = r.config_name
      if (!rows.has(id)) {
        rows.set(id, {
          id,
          display: (r.display_config ?? {}).display_name ?? '',
          functions: new Set(),
          invisible: r.is_invisible_to_user === true,
        })
      }
      rows.get(id).functions.add(entry.function)
    }
  }
  return { status: res.status, bytes: text.length, text, rows }
}

/** The plugin's skeleton: the Remote /models directory. */
async function remoteSkeleton(fns) {
  const res = await fetch(`https://solo.trae.cn/api/remote/v1/models?functions=${fns.join(',')}`, { headers: remoteHeaders })
  const json = await res.json()
  const rows = new Map()
  for (const g of json?.data?.list ?? []) {
    for (const m of g.models ?? []) {
      if (!rows.has(m.name)) rows.set(m.name, { id: m.name, display: m.display_name ?? '', functions: new Set() })
      rows.get(m.name).functions.add(g.function)
    }
  }
  return rows
}

// ---------------------------------------------------------------- run
console.log('=== 1. IDE wide roster (the "内置模型" picker source) ===')
const ide = await ideRoster()
console.log(`  HTTP ${ide.status}, ${ide.bytes} bytes, ${ide.rows.size} unique config_names`)
console.log(`  contains "1017": ${ide.text.includes('1017')}`)

console.log('\n=== 2. Plugin Remote skeleton (the plugin\'s own skeleton) ===')
const skeleton = await remoteSkeleton(PLUGIN_REMOTE_FUNCTIONS)
console.log(`  ${skeleton.size} unique models`)

console.log('\n=== 3. Does upstream publish a "1017" id? ===')
const with1017 = [...ide.rows.values()].filter(r => /1017/.test(r.id) || /1017/.test(r.display))
console.log(`  IDE roster rows matching /1017/: ${with1017.length}${with1017.length ? ' -> ' + with1017.map(r => r.id).join(', ') : ''}`)
const remoteWith1017 = [...skeleton.values()].filter(r => /1017/.test(r.id) || /1017/.test(r.display))
console.log(`  Remote skeleton rows matching /1017/: ${remoteWith1017.length}`)

console.log('\n=== 4. What the plugin\'s join (mergeTraeModelSources) drops ===')
const wireClient = new mod.TraeSoloUpstreamClient({
  credential: async () => credential, identity: async () => identity,
})
const wire = await wireClient.fetchModels()
const dropped = wire.filter(w => !skeleton.has(w.id))
console.log(`  wire rows: ${wire.length} | remote skeleton rows: ${skeleton.size}`)
console.log(`  wire rows with NO remote-skeleton row (dropped by the join): ${dropped.length}`)
const NOISE = /^custom_model_|^search_agent|^(summary|title_generation|input_optimization|fast_apply|file_search_agent|explore_sub_agent_v2|browser_use_subagent|computer_use_grounding|computer_use_subagent|pull_request_generation|html_share_metadata|plugin_recommendation|context_selection|custom_agent_generation|aquila|sagitta|test|multimodal_image_)/
const interesting = dropped.filter(w => !NOISE.test(w.id))
console.log('  of those, the ones a USER would recognise:')
for (const w of interesting) console.log(`    ${w.id}  (wire fn ${w.function})`)

console.log('\n=== 5. Display-name disagreement between the two lists ===')
let mismatches = 0
for (const [id, r] of [...skeleton].sort()) {
  const w = ide.rows.get(id)
  if (w === undefined) continue
  if (String(w.display).trim() !== String(r.display).trim()) {
    mismatches++
    console.log(`  ${id}`)
    console.log(`      plugin shows : ${JSON.stringify(r.display)}`)
    console.log(`      IDE shows    : ${JSON.stringify(w.display)}`)
  }
}
console.log(`  mismatched rows: ${mismatches} / ${skeleton.size}`)

console.log('\n=== 6. Dated-snapshot display names (the "-MMDD" pattern the IDE renders) ===')
for (const r of [...ide.rows.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  if (!/-\d{4}$/.test(String(r.display))) continue
  console.log(`  ${r.id.padEnd(22)} IDE display=${String(r.display).padEnd(20)} in-plugin-skeleton=${skeleton.has(r.id)}`)
}

console.log('\n=== 7. The merge, run end to end on the live data ===')
const remoteForMerge = [...skeleton.values()].map(r => ({
  id: r.id, name: r.display, multimodal: false, reasoningSupported: false,
  function: [...r.functions][0],
}))
const merged = mergeTraeModelSources(remoteForMerge, wire)
console.log(`  merged rows: ${merged.length}`)
console.log('  the models a user sees in the plugin card:')
for (const m of merged) console.log(`    ${m.id.padEnd(28)} | ${m.name}`)
