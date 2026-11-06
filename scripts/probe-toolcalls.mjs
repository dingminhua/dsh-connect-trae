#!/usr/bin/env node
/**
 * Tool-calling comparison across SOLO directory functions.
 *
 * The product requirement is explicit: DSH needs models that can return
 * STRUCTURED TOOL CALLS (a plain chat model is useless to the plugin). This
 * probe therefore controls the variable — same model, same tools, same prompt —
 * and changes ONLY the `function`, then reads the decoded `tool_calls` field of
 * every output event rather than pattern-matching the raw text (a naive
 * `"tool_calls":null` match produced a false positive earlier).
 *
 * Cost: one short completion per row. Tokens are never printed.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'

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
const storage = JSON.parse(await readFile('/Users/<user>/Library/Application Support/Trae CN/User/globalStorage/storage.json', 'utf8'))
const credential = JSON.parse(decrypt(storage['iCubeAuthInfo://icube.cloudide']))
const product = JSON.parse(await readFile('/Applications/Trae CN.app/Contents/Resources/app/product.json', 'utf8'))
const dcKey = Object.keys(storage).find(key => key.startsWith('iCubeAuthInfo://icube-dc:'))
const identity = {
  edition: 'cn', machineId: storage['telemetry.machineId'],
  deviceId: dcKey.slice('iCubeAuthInfo://icube-dc:'.length),
  appVersion: product.appVersion, buildVersion: storage['iCubeLastVersion'],
  osVersion: 'macOS probe', platform: 'darwin',
}

const tools = [{
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read a text file from disk',
    parameters: JSON.stringify({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }),
  },
}]

async function probe(fn, model) {
  const body = prepareSoloBody(JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Call the read_file tool with path=/tmp/probe.txt. Do not answer in prose.' }],
    tools,
  }), undefined, fn)
  const url = traeEndpoint(REGION_GATEWAYS.cn.chat, '/api/agent/v3/llm_utils_chat')
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { ...buildTraeCnHeaders(credential, identity), Authorization: `Cloud-IDE-JWT ${credential.token}` },
      body, signal: AbortSignal.timeout(90_000),
    })
  } catch (error) {
    console.log(`  ${fn.padEnd(18)}${model.padEnd(12)}TRANSPORT ${String(error).slice(0, 80)}`)
    return
  }
  if (!response.ok) {
    console.log(`  ${fn.padEnd(18)}${model.padEnd(12)}HTTP ${response.status}`)
    return
  }
  const decoder = new SseDecoder()
  const toolCalls = []
  const text = []
  let errorCode
  const handle = (event) => {
    const decoded = decodeTraeEvent(event)
    if (decoded.type === 'delta') {
      if (decoded.text !== '') text.push(decoded.text)
      if (decoded.toolCalls !== undefined && decoded.toolCalls !== null) toolCalls.push(decoded.toolCalls)
    }
  }
  for await (const chunk of response.body) {
    const piece = new TextDecoder().decode(chunk)
    for (const event of decoder.push(piece)) handle(event)
  }
  for (const event of decoder.finish()) handle(event)
  if (errorCode === undefined && /"code":(\d+)/.test('')) { /* noop */ }
  const ok = toolCalls.length > 0
  console.log(`  ${fn.padEnd(18)}${model.padEnd(12)}HTTP ${response.status}  tool_calls=${ok ? 'YES (' + toolCalls.length + ')' : 'none'}  text=${JSON.stringify(text.join('').slice(0, 60))}`)
  if (ok) console.log(`     payload: ${JSON.stringify(toolCalls[0]).slice(0, 220)}`)
}

console.log('model = glm-5.2 held constant, only `function` changes:\n')
await probe('solo_agent', 'glm-5.2')
await probe('solo_agent_remote', 'glm-5.2')
await probe('solo_work_remote', 'glm-5.2')
await probe('solo_work_lite', 'glm-5.2')
console.log('\nglm-5.3 (only exists under solo_work_remote):\n')
await probe('solo_work_remote', 'glm-5.3')
