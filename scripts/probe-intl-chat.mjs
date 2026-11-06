#!/usr/bin/env node
/**
 * End-to-end international (ai) chat probe — ONE minimal request.
 *
 * Verifies the full chain the plugin would use for an international account:
 *   decrypt -> identity -> prepareSoloBody (plugin's own) -> buildTraeCnHeaders
 *   (plugin's own) -> REGION_GATEWAYS.ai.chat + /api/agent/v3/llm_utils_chat
 *   -> SSE decoded by the plugin's own SseDecoder.
 *
 * Cost discipline: exactly one chat request, one short user turn, the model is
 * asked to reply with a single word, no reasoning effort is sent (the ai roster
 * advertises none). Tokens are never printed; only statuses, event-type
 * sequences, and a short excerpt of the final text.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'

const INTL_SOLO_STORAGE = '/Users/<user>/Library/Application Support/TRAE SOLO/User/globalStorage/storage.json'
const INTL_SOLO_PRODUCT = '/Applications/TRAE SOLO.app/Contents/Resources/app/product.json'
const PROBE_MODEL = 'gpt-5.4'

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
  return decrypted.subarray(64).toString('utf8')
}

// The plugin's own published building blocks.
const {
  prepareSoloBody, buildTraeCnHeaders, traeEndpoint, REGION_GATEWAYS,
  regionOfCredential, SseDecoder, decodeTraeEvent,
} = await import('../lib/index.js')

// --- credential + identity (never printed) ---
const storage = JSON.parse(await readFile(INTL_SOLO_STORAGE, 'utf8'))
const credential = JSON.parse(decryptTraeStorageValue(storage['iCubeAuthInfo://icube.cloudide']))
if (!credential.token) throw new Error('intl SOLO credential has no token')
const machineId = storage['telemetry.machineId']
const dcKey = Object.keys(storage).find(key => key.startsWith('iCubeAuthInfo://icube-dc:'))
const deviceId = dcKey.slice('iCubeAuthInfo://icube-dc:'.length)
const buildVersion = storage['iCubeLastVersion']
const product = JSON.parse(await readFile(INTL_SOLO_PRODUCT, 'utf8'))
const identity = {
  edition: 'solo-sg', machineId, deviceId,
  ...product.appVersion ? { appVersion: product.appVersion } : {},
  ...buildVersion ? { buildVersion } : {},
  osVersion: 'macOS probe', platform: 'darwin',
}
const region = regionOfCredential(credential)
console.log(`credential: region=${region} host=${credential.host} expires=${credential.expiredAt}`)
console.log(`identity: app=${product.appVersion ?? '?'} build=${buildVersion ?? '?'} machineId=${machineId ? 'ok' : 'MISSING'} deviceId=${deviceId ? 'ok' : 'MISSING'}`)
if (region !== 'ai') throw new Error('expected an ai-region credential for this probe')
console.log(`gateway: ${REGION_GATEWAYS.ai.chat} · model: ${PROBE_MODEL}`)

// --- ONE minimal chat request through the plugin's own body/header builders ---
const body = prepareSoloBody(JSON.stringify({
  model: PROBE_MODEL,
  messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
}))
const headers = buildTraeCnHeaders(credential, identity)
const url = traeEndpoint(REGION_GATEWAYS.ai.chat, '/api/agent/v3/llm_utils_chat')
console.log(`\nPOST ${url}`)
const started = Date.now()
let response
try {
  response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, Authorization: `Cloud-IDE-JWT ${credential.token}` },
    body,
    signal: AbortSignal.timeout(120_000),
  })
} catch (error) {
  console.log(`TRANSPORT FAILED: ${String(error).slice(0, 300)}`)
  process.exit(1)
}
console.log(`HTTP ${response.status} ${response.headers.get('content-type') ?? ''} (${Date.now() - started}ms)`)
if (!response.ok) {
  console.log(`body: ${(await response.text()).slice(0, 600)}`)
  process.exit(1)
}

// --- decode the SSE stream with the plugin's own decoder ---
// Raw bytes are captured too, so a silent/empty stream is diagnosable
// without burning another request.
const raw = []
const decoder = new SseDecoder()
const events = []
const textChunks = []
const handle = (event) => {
  const decoded = decodeTraeEvent(event)
  events.push(decoded.type)
  if (decoded.type === 'delta' && decoded.text !== '') textChunks.push(decoded.text)
}
for await (const chunk of response.body) {
  // The web-stream chunk is a Uint8Array: toString() would yield a comma
  // digit list, not UTF-8 text. Decode explicitly.
  const piece = new TextDecoder().decode(chunk)
  raw.push(piece)
  for (const event of decoder.push(piece)) handle(event)
}
for (const event of decoder.finish()) handle(event)
console.log(`\nraw stream (${raw.join('').length}B): ${JSON.stringify(raw.join('').slice(0, 1200))}`)
console.log(`\nevent sequence (${events.length}): ${events.join(' → ')}`)
const finalText = textChunks.join('')
console.log(`\noutput text: ${JSON.stringify(finalText.slice(0, 200))}`)
console.log(finalText.length > 0 ? '\n✅ END-TO-END OK: international llm_utils_chat streams through the plugin path' : '\n⚠️ stream completed with no output text (inspect the raw stream above)')
