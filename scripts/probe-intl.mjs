#!/usr/bin/env node
/**
 * Read-only international (SG) Trae endpoint probe.
 *
 * Evidence sources (offline, already verified):
 *   - credential host per edition  — storage.json decryption (host + userRegion)
 *   - chat gateway coresg-normal.trae.ai — Trae intl desktop logs (May 2026):
 *     create_agent_task x289, llm_raw_chat x69, llm_utils_chat x3
 *   - refresh ClientID en1oxy7wnw8j9n + path /trae/api/v3/oauth/ExchangeToken
 *     — TRAE SOLO intl logs (today): official app's own exchangeToken call
 *
 * This script ONLY issues read-only catalog/status queries:
 *   - /api/ide/v1/get_detail_param  (model directory; the CN plugin's own
 *     discovery call, no chat, no credits)
 *   - /api/remote/v1/models        (SOLO remote catalog, GET)
 *   - /trae/api/v1/pay/ide_user_pay_status (called by the intl app itself today)
 * It never calls chat endpoints (would consume credits) and never refreshes
 * tokens (would rotate the app's refresh token).
 *
 * Output is sanitized: tokens are never printed; responses are summarized as
 * counts, model names, and key names only.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'

const INTL_SOLO_STORAGE = '/Users/<user>/Library/Application Support/TRAE SOLO/User/globalStorage/storage.json'
const INTL_SOLO_PRODUCT = '/Applications/TRAE SOLO.app/Contents/Resources/app/product.json'
const CORESG = 'https://coresg-normal.trae.ai'
const GROWSG = 'https://growsg-normal.trae.ai'
const MCHOST_API16 = 'https://api16-normal-alisg.mchost.guru'

// --- decryption (mirrors src/decrypt.ts, verified against all 4 editions) ---
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
  else throw new Error('unsupported Trae auth encryption header')
  const salt = type === 'aes-private' ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B)
  const first = createHash('sha512').update(buffer.subarray(6, 38)).digest()
  const derived = createHash('sha512').update(Buffer.concat([first, salt])).digest()
  const decipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32))
  const decrypted = Buffer.concat([decipher.update(buffer.subarray(38)), decipher.final()])
  const expected = decrypted.subarray(0, 64)
  const plaintext = decrypted.subarray(64)
  const actual = createHash('sha512').update(plaintext).digest()
  if (!expected.equals(actual)) throw new Error('Trae auth integrity check failed')
  return plaintext.toString('utf8')
}

// --- load intl SOLO credential + identity (never printed) ---
const storage = JSON.parse(await readFile(INTL_SOLO_STORAGE, 'utf8'))
const authValue = storage['iCubeAuthInfo://icube.cloudide']
if (typeof authValue !== 'string') throw new Error('no auth key in intl SOLO storage')
const credential = JSON.parse(decryptTraeStorageValue(authValue))
if (!credential.token) throw new Error('intl SOLO credential has no token')
console.log(`credential: host=${credential.host} region=${credential.userRegion?.region} tokenExpires=${credential.expiredAt}`)

const machineId = storage['telemetry.machineId']
const dcKey = Object.keys(storage).find(key => key.startsWith('iCubeAuthInfo://icube-dc:'))
const deviceId = dcKey ? dcKey.slice('iCubeAuthInfo://icube-dc:'.length) : storage['telemetry.devDeviceId']
const buildVersion = storage['iCubeLastVersion']
let product = {}
try { product = JSON.parse(await readFile(INTL_SOLO_PRODUCT, 'utf8')) } catch { /* optional */ }
const appVersion = product.appVersion
console.log(`identity: app=${appVersion ?? '(unknown)'} build=${buildVersion ?? '(unknown)'} machineId=${machineId ? 'ok' : 'MISSING'} deviceId=${deviceId ? 'ok' : 'MISSING'}`)

// --- request headers: the CN plugin's own buildTraeCnHeaders shape ---
const numericVersionCode = /^\d+$/.test(String(buildVersion ?? '')) ? String(buildVersion) : '20260716'
function traeHeaders(extra = {}) {
  return {
    'Authorization': `Cloud-IDE-JWT ${credential.token}`,
    'X-Ide-Token': credential.token,
    'x-plugin-channel': 'icube-ai',
    'User-Agent': `Trae/${appVersion ?? buildVersion ?? 'unknown'}`,
    'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
    'x-machine-id': machineId,
    'x-device-id': deviceId,
    'x-device-type': 'mac',
    'x-app-version': appVersion,
    'x-ide-version': appVersion,
    'x-app-version-code': numericVersionCode,
    'x-ide-version-code': numericVersionCode,
    'x-ide-version-type': 'stable',
    'request-traffic-type': 'prod',
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function probe(name, url, init) {
  const started = Date.now()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), ...init })
    const text = await response.text()
    console.log(`\n[${name}] ${response.status} ${response.headers.get('content-type') ?? ''} (${Date.now() - started}ms, ${text.length}B)`)
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = undefined }
    if (parsed === undefined) {
      console.log(`  (non-JSON) ${text.slice(0, 200)}`)
      return
    }
    // sanitized structural summary only
    const summarize = (value, depth = 0) => {
      if (value === null || typeof value !== 'object') return typeof value
      if (Array.isArray(value)) return `array(${value.length})`
      if (depth >= 2) return '(object)'
      const out = {}
      for (const [k, v] of Object.entries(value)) out[k] = summarize(v, depth + 1)
      return out
    }
    if (Array.isArray(parsed?.config_info_list)) {
      console.log(`  code=${parsed.code} msg=${JSON.stringify(parsed.msg ?? '')} models=${parsed.config_info_list.length}`)
      for (const config of parsed.config_info_list.slice(0, 25)) {
        const detail = Array.isArray(config.model_detail_list) ? config.model_detail_list[0] : {}
        console.log(`    - ${config.config_name} | display=${config.display_config?.display_name ?? config.config_name} | ctx=${detail.prompt_max_tokens ?? config.context_window_tokens?.dev ?? '?'} out=${detail.max_tokens ?? '?'} | reasoning=${JSON.stringify(config.reasoning?.supported_efforts ?? config.supported_efforts ?? '?')}`)
      }
      return
    }
    if (Array.isArray(parsed?.data?.list)) {
      for (const group of parsed.data.list) {
        if (Array.isArray(group.models)) {
          console.log(`  group function=${group.function} models=${group.models.length}`)
          for (const model of group.models.slice(0, 25)) {
            const m = typeof model === 'object' ? model : { name: model }
            console.log(`    - ${m.name ?? m.model ?? JSON.stringify(m).slice(0, 60)} | ctx=${m.context_tokens ?? m.max_input_tokens ?? '?'} out=${m.max_output_tokens ?? '?'} | keys=${Object.keys(m).slice(0, 12).join(',')}`)
          }
        }
      }
      return
    }
    console.log(`  ${JSON.stringify(summarize(parsed)).slice(0, 900)}`)
  } catch (error) {
    console.log(`\n[${name}] FAILED: ${String(error).slice(0, 300)}`)
  }
}

// 1. Model directory on coresg (the intl gateway evidence says agent v3 + remote v1 live here)
await probe('coresg get_detail_param', `${CORESG}/api/ide/v1/get_detail_param`, {
  method: 'POST',
  headers: traeHeaders({ Accept: 'application/json' }),
  body: JSON.stringify({
    function: 'solo_work_lite',
    config_names: null,
    need_prompt: false,
    current_config_info: null,
    poly_prompt: true,
    mode_type: null,
    agent_type: null,
  }),
})

// 2. Same directory on the mchost shard the intl desktop app used (control comparison)
await probe('mchost api16 get_detail_param', `${MCHOST_API16}/api/ide/v1/get_detail_param`, {
  method: 'POST',
  headers: traeHeaders({ Accept: 'application/json' }),
  body: JSON.stringify({
    function: 'solo_work_lite',
    config_names: null,
    need_prompt: false,
    current_config_info: null,
    poly_prompt: true,
    mode_type: null,
    agent_type: null,
  }),
})

// 3. SOLO remote catalog on coresg (CN equivalent: solo.trae.cn/api/remote/v1)
await probe('coresg remote models', `${CORESG}/api/remote/v1/models?functions=solo_agent_remote,solo_work_remote`, {
  method: 'GET',
  headers: {
    'Authorization': `Cloud-IDE-JWT ${credential.token}`,
    'Content-Type': 'application/json',
    'x-trae-client-type': 'web',
    'x-trae-user-timezone': 'Asia/Singapore',
    'x-preferenced-language': 'en',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
})

// 4. Pay status on growsg (the endpoint the intl app itself called today)
await probe('growsg ide_user_pay_status', `${GROWSG}/trae/api/v1/pay/ide_user_pay_status`, {
  method: 'POST',
  headers: {
    'Authorization': `Cloud-IDE-JWT ${credential.token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
  },
  body: '{}',
})
