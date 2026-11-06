#!/usr/bin/env node
/**
 * Controlled chat probe for issue #7: is `glm-5.3` actually callable?
 *
 * CN evidence so far (read-only, already verified):
 *   - the remote directory lists glm-5.3 as a complete preset model
 *     (is_preset/config_source/pricing/reasoning identical to glm-5.2),
 *   - no get_detail_param function exposes a `glm-5.3` config_name.
 * The plugin therefore unions remote ∩ wire and silently drops it.
 *
 * This probe sends ONE minimal message per model through the plugin's OWN
 * request path (prepareSoloBody + buildTraeCnHeaders + SseDecoder) so the
 * verdict describes what the plugin itself would experience:
 *   - glm-5.3 (the questioned model)
 *   - glm-5.2 (known-good control: if this fails too, the probe is at fault)
 *
 * Cost: two short completions. Tokens are never printed.
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
function decrypt(encoded) {
  const buffer = Buffer.from(encoded, 'base64')
  const header = buffer.subarray(0, 6)
  const type = header.equals(Buffer.from([0x74, 0x63, 0x05, 0x10, 0x00, 0x00])) ? 'aes' : 'aes-private'
  const salt = type === 'aes-private' ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B)
  const first = createHash('sha512').update(buffer.subarray(6, 38)).digest()
  const derived = createHash('sha512').update(Buffer.concat([first, salt])).digest()
  const decipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32))
  return Buffer.concat([decipher.update(buffer.subarray(38)), decipher.final()]).subarray(64).toString('utf8')
}

const { prepareSoloBody, buildTraeCnHeaders, traeEndpoint, REGION_GATEWAYS, SseDecoder, decodeTraeEvent } = await import('../lib/index.js')

const storage = JSON.parse(await readFile(CN_STORAGE, 'utf8'))
const credential = JSON.parse(decrypt(storage['iCubeAuthInfo://icube.cloudide']))
const machineId = storage['telemetry.machineId']
const dcKey = Object.keys(storage).find(key => key.startsWith('iCubeAuthInfo://icube-dc:'))
const buildVersion = storage['iCubeLastVersion']
const product = JSON.parse(await readFile(CN_PRODUCT, 'utf8'))
const identity = {
  edition: 'cn', machineId, deviceId: dcKey.slice('iCubeAuthInfo://icube-dc:'.length),
  appVersion: product.appVersion, buildVersion, osVersion: 'macOS probe', platform: 'darwin',
}
console.log(`credential: edition=cn host=${credential.host} region=${credential.userRegion?.region}`)
console.log(`gateway: ${REGION_GATEWAYS.cn.chat} (the plugin's own CN base)\n`)

async function probe(model) {
  const body = prepareSoloBody(JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  }))
  const parsed = JSON.parse(body)
  const url = traeEndpoint(REGION_GATEWAYS.cn.chat, '/api/agent/v3/llm_utils_chat')
  const started = Date.now()
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { ...buildTraeCnHeaders(credential, identity), Authorization: `Cloud-IDE-JWT ${credential.token}` },
      body,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (error) {
    console.log(`[${model}] TRANSPORT FAILED: ${String(error).slice(0, 200)}`)
    return
  }
  const ms = Date.now() - started
  if (!response.ok) {
    const text = (await response.text()).slice(0, 400)
    console.log(`[${model}] HTTP ${response.status} (${ms}ms) → ${text}`)
    return
  }
  const decoder = new SseDecoder()
  const kinds = []
  const text = []
  const raw = []
  const handle = (event) => {
    const decoded = decodeTraeEvent(event)
    kinds.push(decoded.type)
    if (decoded.type === 'delta' && decoded.text !== '') text.push(decoded.text)
  }
  for await (const chunk of response.body) {
    const piece = new TextDecoder().decode(chunk)
    raw.push(piece)
    for (const event of decoder.push(piece)) handle(event)
  }
  for (const event of decoder.finish()) handle(event)
  console.log(`[${model}] HTTP ${response.status} (${ms}ms) events=${kinds.length} [${kinds.join(' → ')}]`)
  console.log(`        config_name sent: ${parsed.config_name} · function: ${parsed.function}`)
  console.log(`        output: ${JSON.stringify(text.join('').slice(0, 80))}`)
  if (text.join('') === '' && raw.join('').length > 0) {
    console.log(`        raw (first 400B): ${JSON.stringify(raw.join('').slice(0, 400))}`)
  }
}

console.log('=== control: glm-5.2 (known-good) ===')
await probe('glm-5.2')
console.log('\n=== questioned: glm-5.3 ===')
await probe('glm-5.3')
