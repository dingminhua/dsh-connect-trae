#!/usr/bin/env node
/**
 * Iterative field-discovery probe for `create_agent_task`.
 *
 * The endpoint answers a missing required field with
 *   {"code":4001,"message":"bad request: binding: expr_path=<field>, cause=missing required parameter"}
 * and that happens in the parameter-binding layer — BEFORE any model work — so
 * each rejected attempt costs nothing. This probe therefore walks the required
 * field set by feeding back the named field with a plausible value, up to a
 * bounded number of rounds, stopping as soon as the endpoint either streams or
 * fails for a non-binding reason.
 *
 * Goal: learn (a) the minimum body, (b) whether the SSE vocabulary exposes
 * client-executable tool calls. Tokens are never printed.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash, randomUUID } from 'node:crypto'

const CN_STORAGE = '/Users/<user>/Library/Application Support/Trae CN/User/globalStorage/storage.json'
const CN_PRODUCT = '/Applications/Trae CN.app/Contents/Resources/app/product.json'
const ENDPOINT = 'https://trae-api-cn.mchost.guru/api/agent/v3/create_agent_task'
const MODEL = process.argv[2] ?? 'glm-5.3'
const MAX_ROUNDS = Number(process.argv[3] ?? 12)

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

function headers() {
  const requestId = randomUUID()
  const traceId = requestId.replaceAll('-', '')
  return {
    'Authorization': `Cloud-IDE-JWT ${credential.token}`,
    'X-Ide-Token': credential.token,
    'X-Cloudide-Token': credential.token,
    'x-plugin-channel': 'icube-ai',
    'User-Agent': `Trae/${product.appVersion}`,
    'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
    'x-machine-id': machineId, 'x-device-id': deviceId, 'x-device-type': 'mac',
    'x-app-version': product.appVersion, 'x-ide-version': product.appVersion,
    'x-app-version-code': '20260716', 'x-ide-version-code': '20260716',
    'x-ide-version-type': 'stable', 'x-uid': credential.userId,
    'x-request-id': requestId, 'x-trae-request-id': requestId,
    'x-custom-trace-id': traceId, 'x-flow-traceparent': `04-${traceId}-${traceId.slice(0, 16)}-01`,
    'request-traffic-type': 'prod', 'Content-Type': 'application/json', 'Accept': 'text/event-stream',
    requestId,
  }
}

/** Plausible values for the fields the binder names, in the shape the IDE sends. */
function valueFor(field) {
  const uuid = () => randomUUID()
  const table = {
    conversation_id: uuid(),
    session_id: uuid(),
    request_id: uuid(),
    task_id: uuid(),
    message_id: uuid(),
    trace_id: uuid(),
    // The Go binder declares these as strings, not numbers.
    agent_type: 'chat',
    mode_type: 'chat',
    user_id: credential.userId,
    device_id: deviceId,
    model_name: MODEL,
    ide_version: product.appVersion,
    // ideagent.UserInput is a struct, not a scalar: start with the plainest
    // text shape. NOTE: once the binder accepts it the request reaches the
    // business layer, so this probe stops at the first non-binding answer.
    user_input: { text: 'Reply with exactly: OK' },
    function: 'inline_chat',
    config_name: MODEL,
    model: MODEL,
    stream: true,
    memory: false,
    need_prompt: false,
  }
  return field in table ? table[field] : uuid()
}

const body = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
  model: MODEL,
  config_name: MODEL,
  function: 'inline_chat',
  stream: true,
}

console.log(`iterative field discovery → ${ENDPOINT} (model ${MODEL})\n`)
for (let round = 1; round <= MAX_ROUNDS; round += 1) {
  const requestHeaders = headers()
  const { requestId, ...wireHeaders } = requestHeaders
  body['request_id'] = body['request_id'] ?? requestId
  let response
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: wireHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) })
  } catch (error) {
    console.log(`round ${round}: TRANSPORT FAILED ${String(error).slice(0, 160)}`)
    break
  }
  const text = await response.text()
  const missing = /expr_path=([a-zA-Z0-9_]+)/.exec(text)?.[1]
  if (missing !== undefined) {
    const value = valueFor(missing)
    body[missing] = value
    console.log(`round ${round}: 400 missing "${missing}" → supplying ${JSON.stringify(value).slice(0, 40)} (body now ${Object.keys(body).length} keys)`)
    continue
  }
  console.log(`round ${round}: HTTP ${response.status} (${text.length}B) — no more binding errors`)
  console.log(`  body keys sent: ${JSON.stringify(Object.keys(body))}`)
  console.log(`  raw (first 1200B): ${JSON.stringify(text.slice(0, 1200))}`)
  const names = [...text.matchAll(/(?:^|\n)event:\s*([a-zA-Z_]+)/g)].map(m => m[1])
  if (names.length) console.log(`  event vocabulary: ${[...new Set(names)].join(', ')}`)
  console.log(`  tool-call vocabulary: ${/tool_call|function_call|commit_toolcall/i.test(text) ? 'YES' : 'no'}`)
  break
}
console.log(`\nfinal body shape: ${JSON.stringify(Object.keys(body))}`)
