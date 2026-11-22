#!/usr/bin/env node
/**
 * Read-only probe for issue #94: does the upstream publish the max OUTPUT cap
 * (`model_detail_list[].max_tokens`), for which panels, and for which rows?
 *
 * Built ONLY from the plugin's shipped building blocks — `readTraeIdentity`,
 * `refreshTraeCredential`, `buildTraeCnHeaders`, `buildTraeModelDetailRequest`
 * — so the probe cannot drift from what the plugin actually sends (issue #42's
 * probe hand-rolled the header set, which is why it 401'd once the refresh
 * contract moved).
 *
 * Read-only endpoints: no chat call, no quota, no output tokens.
 *
 *   node scripts/probe-issue94-maxtokens.mjs
 *   TRAE_PROBE_HOME=/Users/<you> node scripts/probe-issue94-maxtokens.mjs
 *
 * The stored refresh token must still be alive; if the probe reports
 * `refresh failed: ... 401`, sign in to the Trae app once and re-run.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

const LIB = new URL('../lib/index.js', import.meta.url).pathname
const mod = await import(LIB)
const {
  readTraeIdentity, refreshTraeCredential, buildTraeCnHeaders, buildTraeModelDetailRequest,
  TRAE_MODEL_DETAIL_PATH, REGION_GATEWAYS, parseTraeRemoteModel, mergeTraeModelSources,
} = mod

const HOME = process.env.TRAE_PROBE_HOME ?? homedir()
const CASES = [
  {
    edition: 'cn',
    region: 'cn',
    storage: `${HOME}/Library/Application Support/Trae CN/User/globalStorage/storage.json`,
    base: 'https://trae-api-cn.mchost.guru',
  },
  {
    edition: 'sg',
    region: 'ai',
    storage: `${HOME}/Library/Application Support/Trae/User/globalStorage/storage.json`,
    base: 'https://trae-api-sg.mchost.guru',
  },
]

for (const { edition, region, storage: storagePath, base } of CASES) {
  console.log(`\n=== ${edition} ===`)
  let storage
  try {
    storage = JSON.parse(await readFile(storagePath, 'utf8'))
  } catch (error) {
    console.log(`storage unreadable: ${String(error).slice(0, 80)}`)
    continue
  }
  let stored
  try {
    stored = JSON.parse(mod.decryptTraeStorageValue(storage['iCubeAuthInfo://icube.cloudide']))
  } catch (error) {
    console.log(`credential unreadable: ${String(error).slice(0, 80)}`)
    continue
  }

  const identity = await readTraeIdentity({ edition, path: storagePath, source: 'desktop' })
  console.log(`device id: ${identity.deviceId.length} chars; keypair: ${identity.deviceKeyPair === undefined ? 'none' : 'present'}`)

  const credential = {
    accessToken: stored.token,
    refreshToken: stored.refreshToken,
    userId: stored.userId,
    host: stored.host,
    userRegion: stored.userRegion,
    edition,
  }
  let fresh = credential
  try {
    const outcome = await refreshTraeCredential(credential, undefined, identity)
    fresh = { ...credential, accessToken: outcome.accessToken, refreshToken: outcome.refreshToken ?? credential.refreshToken }
    console.log(`refresh: ok (expires ${new Date(outcome.expiresAtMs).toISOString()})`)
  } catch (error) {
    console.log(`refresh failed: ${String(error).slice(0, 140)}`)
  }

  const headers = buildTraeCnHeaders(fresh, identity, { profile: 'model-detail' })
  let doc
  try {
    const res = await fetch(`${base}${TRAE_MODEL_DETAIL_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildTraeModelDetailRequest()),
      signal: AbortSignal.timeout(30_000),
    })
    console.log(`batch_get_detail_param: HTTP ${res.status}`)
    if (!res.ok) {
      console.log(`  body: ${(await res.text()).slice(0, 200)}`)
      continue
    }
    doc = await res.json()
  } catch (error) {
    console.log(`detail request failed: ${String(error).slice(0, 100)}`)
    continue
  }

  // The batch answer is `function_configs[] → config_info_list[] →
  // model_detail_list[]` (see src/official-roster.ts) — NOT the flat
  // `config_info_list` the singular `get_detail_param` endpoint returns.
  const groups = Array.isArray(doc?.function_configs) ? doc.function_configs : []
  console.log(`function groups: ${groups.length}`)
  const configs = []
  for (const group of groups) {
    const list = Array.isArray(group?.config_info_list) ? group.config_info_list : []
    for (const config of list) configs.push({ ...config, function: group?.function })
  }
  console.log(`configs: ${configs.length}`)
  const rows = []
  for (const config of configs) {
    const id = config?.config_name
    if (typeof id !== 'string' || id === '') continue
    for (const detail of Array.isArray(config?.model_detail_list) ? config.model_detail_list : []) {
      if (detail === null || typeof detail !== 'object') continue
      rows.push({
        config: id,
        function: config.function ?? '-',
        model: detail.model_name ?? '-',
        promptMax: detail.prompt_max_tokens ?? '-',
        maxTokens: detail.max_tokens ?? '-',
      })
    }
  }
  const withCap = rows.filter(row => row.maxTokens !== '-')
  console.log(`detail rows: ${rows.length}; carrying max_tokens: ${withCap.length}`)
  console.log(`distinct output caps: ${[...new Set(withCap.map(row => row.maxTokens))].sort((a, b) => a - b).join(', ')}`)
  const perFunction = new Map()
  for (const row of rows) {
    const key = row.function
    const entry = perFunction.get(key) ?? { rows: 0, withCap: 0 }
    entry.rows += 1
    if (row.maxTokens !== '-') entry.withCap += 1
    perFunction.set(key, entry)
  }
  console.log('per function (rows / with max_tokens):')
  for (const [fn, entry] of perFunction) console.log(`  ${fn.padEnd(24)} ${entry.withCap}/${entry.rows}`)
  const deepseek = rows.filter(row => /deepseek/i.test(row.config) || /deepseek/i.test(String(row.model)))
  console.log('deepseek rows:')
  for (const row of deepseek) console.log(`  ${row.config.padEnd(26)} model=${String(row.model).padEnd(18)} p=${String(row.promptMax).padEnd(9)} out=${row.maxTokens}`)
  console.log('sample rows:')
  for (const row of rows.slice(0, 12)) console.log(`  ${row.config.padEnd(26)} model=${String(row.model).padEnd(18)} p=${String(row.promptMax).padEnd(9)} out=${row.maxTokens}`)

  // The wire roster alone is not what a user configures: the DISPLAYED row is
  // the Remote directory's, merged with the wire row (issue #42's merge). Show
  // the merged result for the deepseek family — that is the entry the user
  // picks, and the entry whose maxTokens reaches the request.
  const remoteBase = REGION_GATEWAYS[region].remote
  try {
    const res = await fetch(`${remoteBase}/models?functions=solo_agent,solo_agent_remote,solo_work_remote,solo_work_lite,chat_v3,solo_coder,builder_v3,chat,inline_chat,solo_agent_lite,solo_design_lite,solo_design_remote`, {
      headers: { ...buildTraeCnHeaders(fresh, identity, { profile: 'model-detail' }), 'x-trae-client-type': 'web' },
      signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json()
    const groups = json?.data?.list ?? []
    const seen = new Map()
    for (const group of groups) {
      for (const raw of group.models ?? []) {
        const model = parseTraeRemoteModel(raw)
        if (model !== undefined && !seen.has(model.id)) seen.set(model.id, model)
      }
    }
    const wireRows = []
    const wireSeen = new Set()
    for (const config of configs) {
      const id = config?.config_name
      if (typeof id !== 'string' || id === '' || wireSeen.has(id)) continue
      wireSeen.add(id)
      let maxTokens
      for (const detail of Array.isArray(config?.model_detail_list) ? config.model_detail_list : []) {
        const value = detail?.['max_tokens']
        if (typeof value === 'number' && Number.isFinite(value) && value > 0 && maxTokens === undefined) maxTokens = value
      }
      wireRows.push({ id, name: config?.display_config?.display_name ?? id, ...maxTokens === undefined ? {} : { maxTokens } })
    }
    const merged = mergeTraeModelSources([...seen.values()], wireRows)
    const withCap = merged.filter(model => model.maxTokens !== undefined)
    console.log(`\nremote directory: HTTP ${res.status}, groups ${groups.length}, unique models ${seen.size}`)
    console.log(`merged (the shipped catalog's own merge): ${merged.length} rows, ${withCap.length} carry maxTokens`)
    const missing = merged.filter(model => model.maxTokens === undefined)
    console.log(`merged rows WITHOUT maxTokens: ${missing.length ? missing.map(m => m.id).join(', ') : '(none)'}`)
    console.log('merged deepseek family:')
    for (const model of merged.filter(m => /deepseek/i.test(m.id) || /deepseek/i.test(m.name))) {
      console.log(`  ${model.id.padEnd(28)} wire=${String(model.wireConfigName ?? '-').padEnd(34)} ctx=${String(model.contextWindow ?? '-').padEnd(8)} out=${model.maxTokens ?? '-'}`)
    }
  } catch (error) {
    console.log(`remote directory failed: ${String(error).slice(0, 120)}`)
  }
}
