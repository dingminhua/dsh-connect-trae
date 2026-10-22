#!/usr/bin/env node
/**
 * Issue #46 — verify the three fixes against the LIVE upstream.
 *
 * Runs the plugin's OWN discovery pipeline (Remote skeleton + wire roster →
 * mergeTraeModelSources) and reports, per fix:
 *
 *   A. does the Remote skeleton now carry the groups it used to miss?
 *   B. are the wire-only models now in the catalog, and are the tool/custom
 *      rows still excluded?
 *   C. do the display names now match the IDE's?
 *
 * Read-only, zero completion cost.
 */
import { readFile } from 'node:fs/promises'
import { decrypt } from './decrypt-block.js'

const mod = await import('../lib/index.js')
const { TraeSoloRemoteCatalogClient, TraeSoloUpstreamClient, mergeTraeModelSources } = mod
const { withChatCallableFunctions } = await import('../src/catalog.ts')

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

const remote = await new TraeSoloRemoteCatalogClient({
  credential: async () => credential, identity: async () => identity,
}).fetchModels()
const wire = await new TraeSoloUpstreamClient({
  credential: async () => credential, identity: async () => identity,
}).fetchModels()

console.log('=== INPUTS ===')
console.log(`  Remote skeleton rows: ${remote.length}`)
console.log(`  wire roster rows    : ${wire.length}`)

const merged = mergeTraeModelSources(remote, wire)
const callable = withChatCallableFunctions(merged, ['solo_work_remote', 'solo_work_lite', 'solo_agent_remote', 'chat_v3', 'solo_coder'])
console.log(`  merged rows         : ${merged.length}`)
console.log(`  callable rows       : ${callable.length}`)

// ---- A: the groups the skeleton used to miss ----
console.log('\n=== A. Remote skeleton: the groups the plugin used to miss ===')
const before = new Set(['solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3'])
const now = new Set(remote.map(m => m.function).filter(Boolean))
for (const fn of [...now].sort()) console.log(`  ${before.has(fn) ? 'had  ' : 'NEW  '} ${fn}`)

const NEW_GROUPS = ['chat', 'inline_chat', 'solo_agent_lite', 'solo_design_lite', 'solo_design_remote']
const newRows = remote.filter(m => m.function && NEW_GROUPS.includes(m.function))
console.log(`  rows contributed by the NEW groups: ${newRows.length}`)
for (const m of newRows) console.log(`    ${m.id.padEnd(28)} | ${m.name.padEnd(24)} | fn=${m.function}`)

// ---- B: the promoted wire-only models ----
console.log('\n=== B. Models promoted from the wire roster (issue #46) ===')
const remoteIds = new Set(remote.map(m => m.id))
const promoted = merged.filter(m => !remoteIds.has(m.id))
console.log(`  promoted rows: ${promoted.length}`)
for (const m of promoted) {
  console.log(`    ${m.id.padEnd(28)} | ${m.name.padEnd(24)} | fn=${m.wireFunction ?? '-'} ctx=${m.contextWindow ?? '-'} maxTok=${m.maxTokens ?? '-'}`)
}
console.log('\n  dated snapshot configs the skeleton systematically omitted:')
for (const m of promoted.filter(m => /-\d{4}$/.test(m.id))) {
  console.log(`    ${m.id.padEnd(28)} | ${m.name}`)
}
console.log('\n  still excluded (tool / custom / alias / no real name):')
const stillOut = wire.filter(w => !merged.some(m => m.id === w.id))
const NOISE = /^custom_model_|^search_agent|^(summary|title_generation|input_optimization|fast_apply|file_search_agent|explore_sub_agent_v2|browser_use_subagent|computer_use_grounding|computer_use_subagent|pull_request_generation|html_share_metadata|plugin_recommendation|context_selection|custom_agent_generation|aquila|sagitta|test|multimodal_image_)/
const leaked = stillOut.filter(w => !NOISE.test(w.id))
console.log(`    excluded: ${stillOut.length} rows; user-recognisable ones still excluded: ${leaked.length ? leaked.map(w => w.id).join(', ') : '(none)'}`)

// ---- C: display names vs the IDE ----
console.log('\n=== C. Display names vs the IDE roster ===')
const ideRes = await fetch('https://trae-api-cn.mchost.guru/api/ide/v1/batch_get_detail_param', {
  method: 'POST', headers: mod.buildTraeCnHeaders(credential, identity, { profile: 'model-detail' }),
  body: JSON.stringify({
    functions: ['ui_builder_v2', 'solo_coder', 'chat_v3', 'solo_builder', 'builder_v3', 'builder', 'chat', 'inline_chat', 'git_ai', 'custom_agent_generation', 'utils', 'code_reviewer', 'code_review_summary', 'solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_agent_lite', 'solo_work_lite', 'solo_design_lite', 'solo_design_remote', 'multimodal', 'system_diagnosis'],
    agent_type: '', current_config_info: { config_name: '', is_custom_model: false },
    mode_type: 0, access_type: 0, ab_force_vids: '', ab_autotest_advanced_mode: 0,
  }),
})
const ideJson = await ideRes.json()
const ideNames = new Map()
for (const e of ideJson.function_configs ?? []) {
  for (const r of e.config_info_list ?? []) {
    const d = (r.display_config ?? {}).display_name
    if (!ideNames.has(r.config_name)) ideNames.set(r.config_name, d)
  }
}
let mismatches = 0
for (const m of merged) {
  const ide = ideNames.get(m.id)
  if (ide === undefined) continue
  if (String(ide).trim() !== m.name.trim()) {
    mismatches++
    console.log(`  ${m.id}: plugin=${JSON.stringify(m.name)} ide=${JSON.stringify(ide)}`)
  }
}
console.log(`  rows whose name still differs from the IDE's: ${mismatches} (of ${merged.length})`)

// ---- D: the models fix A was meant to surface ----
console.log('\n=== D. The models the widened Remote query was meant to surface ===')
for (const id of ['kimi-k2', 'doubao_1_8', 'deepseek-V3', 'glm-4.7', 'code-review-judge']) {
  const m = merged.find(x => x.id === id)
  console.log(`  ${id.padEnd(22)} ${m ? `IN CATALOG  | ${m.name} | fn=${m.wireFunction ?? '-'}` : 'not in the catalog'}`)
}
