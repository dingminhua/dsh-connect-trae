#!/usr/bin/env node
/**
 * TraeCode-channel probe (issue #7 follow-up / architecture decision).
 *
 * Question: can `create_agent_task` (the channel Trae IDE's own chat uses, and
 * the only channel whose config roster contains glm-5.3) carry DSH's tool loop?
 * Specifically: do its SSE events expose tool calls that a CLIENT can execute
 * (and a `commit_toolcall_result`-style回传), or does Trae execute tools itself
 * and only return prose?
 *
 * Strategy — cost-controlled:
 *   1. Send ONE deliberately minimal body first. A validation failure costs
 *      nothing and its error text tells us which fields the endpoint demands.
 *   2. Only if it streams do we inspect the event vocabulary.
 *
 * Tokens are never printed. Nothing here mutates account state.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash, randomUUID } from 'node:crypto'

const CN_STORAGE = '/Users/<user>/Library/Application Support/Trae CN/User/globalStorage/storage.json'
const CN_PRODUCT = '/Applications/Trae CN.app/Contents/Resources/app/product.json'
const ENDPOINT = 'https://trae-api-cn.mchost.guru/api/agent/v3/create_agent_task'
const MODEL = process.argv[2] ?? 'glm-5.3'

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

const storage = JSON.parse(await readFile(CN_STORAGE, 'utf8'))
const credential = JSON.parse(decrypt(storage['iCubeAuthInfo://icube.cloudide']))
const product = JSON.parse(await readFile(CN_PRODUCT, 'utf8'))
const machineId = storage['telemetry.machineId']
const deviceId = Object.keys(storage).find(k => k.startsWith('iCubeAuthInfo://icube-dc:')).slice('iCubeAuthInfo://icube-dc:'.length)
const requestId = randomUUID()
const traceId = requestId.replaceAll('-', '')

const headers = {
  'Authorization': `Cloud-IDE-JWT ${credential.token}`,
  'X-Ide-Token': credential.token,
  'X-Cloudide-Token': credential.token,
  'x-plugin-channel': 'icube-ai',
  'User-Agent': `Trae/${product.appVersion}`,
  'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
  'x-machine-id': machineId,
  'x-device-id': deviceId,
  'x-device-type': 'mac',
  'x-app-version': product.appVersion,
  'x-ide-version': product.appVersion,
  'x-app-version-code': '20260716',
  'x-ide-version-code': '20260716',
  'x-ide-version-type': 'stable',
  'x-uid': credential.userId,
  'x-request-id': requestId,
  'x-trae-request-id': requestId,
  'x-custom-trace-id': traceId,
  'x-flow-traceparent': `04-${traceId}-${traceId.slice(0, 16)}-01`,
  'request-traffic-type': 'prod',
  'Content-Type': 'application/json',
  'Accept': 'text/event-stream',
}

// Deliberately minimal: the plugin's own agent-task draft shape plus config_name.
const body = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
  model: MODEL,
  config_name: MODEL,
  function: 'inline_chat',
  stream: true,
  request_id: requestId,
  session_id: requestId,
}

console.log(`endpoint: ${ENDPOINT}`)
console.log(`model: ${MODEL} · function: inline_chat · minimal body (${Object.keys(body).length} keys)\n`)
const started = Date.now()
let response
try {
  response = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) })
} catch (error) {
  console.log(`TRANSPORT FAILED: ${String(error).slice(0, 200)}`)
  process.exit(1)
}
console.log(`HTTP ${response.status} ${response.headers.get('content-type') ?? ''} (${Date.now() - started}ms)`)
const text = await response.text()
console.log(`body bytes: ${text.length}`)
console.log(`--- raw (first 1500B) ---`)
console.log(JSON.stringify(text.slice(0, 1500)))
console.log(`--- event names seen ---`)
const names = [...text.matchAll(/(?:^|\n)event:\s*([a-zA-Z_]+)/g)].map(m => m[1])
console.log(names.length ? [...new Set(names)].join(', ') : '(none)')
const toolish = /tool_call|function_call|commit_toolcall|toolcall/i.test(text)
console.log(`\ntool-call vocabulary present: ${toolish ? 'YES — inspect below' : 'no'}`)
if (toolish) {
  for (const m of text.matchAll(/.{0,160}(?:tool_call|function_call|commit_toolcall).{0,160}/gi)) {
    console.log('  ' + JSON.stringify(m[0]))
  }
}
