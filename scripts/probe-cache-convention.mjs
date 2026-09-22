#!/usr/bin/env node
/**
 * Issue #10 follow-up: does Trae's `prompt_tokens` INCLUDE cache_read tokens?
 *
 * pi-ai's parseChunkUsage computes `input = prompt_tokens - cacheRead - cacheWrite`,
 * which is only correct under the OpenAI convention (prompt_tokens = full input,
 * cached tokens are a subset). Under the Anthropic convention (input_tokens
 * EXCLUDES cache reads) that subtraction would double-discount.
 *
 * Method: warm a prefix, then send the SAME prefix plus a long unique suffix.
 *   - inclusive (OpenAI):      prompt_tokens ≈ prefix + suffix
 *   - exclusive (Anthropic):   prompt_tokens ≈ prefix - cached + suffix
 * Prints only usage events. Cost: two short completions.
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'

const CN_STORAGE = '/Users/dmh2002/Library/Application Support/Trae CN/User/globalStorage/storage.json'
const CN_PRODUCT = '/Applications/Trae CN.app/Contents/Resources/app/product.json'
const SALT_A = Uint8Array.from([82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37])
const SALT_B = Uint8Array.from([31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125])
const SALT_C = Uint8Array.from([191,192,216,250,122,246,220,97,31,254,98,27,8,72,71,176,135,99,96,18,127,101,203,104,211,102,191,125,37,72,150,156,51,229,121,35,17,153,141,177,110,131,150,128,172,255,254,6,18,140,55,62,236,249,135,64,135,12,117,4,89,149,168,209])
const SALT_D = Uint8Array.from([246,204,26,232,232,70,129,109,223,146,169,242,23,241,105,145,50,196,165,42,254,120,3,54,244,207,209,85,53,6,138,106,175,148,31,204,186,186,165,182,87,142,49,10,39,110,26,154,86,56,173,125,18,64,198,225,99,99,83,82,191,134,76,170])
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ (b[i] ?? 0)))
function decrypt(encoded) {
  const buffer = Buffer.from(encoded, 'base64')
  const type = buffer.subarray(0, 6).equals(Buffer.from([0x74,0x63,0x05,0x10,0x00,0x00])) ? 'aes' : 'aes-private'
  const salt = type === 'aes-private' ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B)
  const first = createHash('sha512').update(buffer.subarray(6, 38)).digest()
  const derived = createHash('sha512').update(Buffer.concat([first, salt])).digest()
  const decipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32))
  return Buffer.concat([decipher.update(buffer.subarray(38)), decipher.final()]).subarray(64).toString('utf8')
}

const { prepareSoloBody, buildTraeCnHeaders, traeEndpoint, REGION_GATEWAYS, SseDecoder, TRAE_SOLO_CHAT_PATH } = await import('../lib/index.js')
const storage = JSON.parse(await readFile(CN_STORAGE, 'utf8'))
const credential = JSON.parse(decrypt(storage['iCubeAuthInfo://icube.cloudide']))
const dcKey = Object.keys(storage).find(k => k.startsWith('iCubeAuthInfo://icube-dc:'))
const product = JSON.parse(await readFile(CN_PRODUCT, 'utf8'))
const identity = {
  edition: 'cn', machineId: storage['telemetry.machineId'],
  deviceId: dcKey.slice('iCubeAuthInfo://icube-dc:'.length),
  appVersion: product.appVersion, buildVersion: storage['iCubeLastVersion'],
  osVersion: 'macOS probe', platform: 'darwin',
}

const PREFIX = 'You are a careful assistant. ' + Array.from({ length: 260 }, (_, i) =>
  `Rule ${i + 1}: always answer concisely and never invent facts, and keep the tone neutral.`).join(' ')
// Long, stable, distinct suffix (~2000 tokens) — identical in turns 2 and 3.
const SUFFIX = Array.from({ length: 220 }, (_, i) =>
  `Appendix line ${i + 1}: the quick brown fox jumps over the lazy dog while reviewing code.`).join(' ')

async function turn(label, prompt) {
  const body = prepareSoloBody(JSON.stringify({ model: 'glm-5.2', messages: [{ role: 'user', content: prompt }] }))
  let response
  try {
    response = await fetch(traeEndpoint(REGION_GATEWAYS.cn.chat, TRAE_SOLO_CHAT_PATH), {
      method: 'POST',
      headers: { ...buildTraeCnHeaders(credential, identity), Authorization: `Cloud-IDE-JWT ${credential.token}` },
      body, signal: AbortSignal.timeout(120_000),
    })
  } catch (e) { console.log(`[${label}] TRANSPORT FAILED: ${String(e).slice(0,160)}`); return }
  if (!response.ok) { console.log(`[${label}] HTTP ${response.status}`); return }
  const decoder = new SseDecoder()
  const handle = (event) => {
    if (event.event === 'token_usage') {
      const u = JSON.parse(event.data)
      console.log(`   prompt_tokens=${u.prompt_tokens} cache_read=${u.cache_read_input_tokens} cache_creation=${u.cache_creation_input_tokens} completion=${u.completion_tokens} total=${u.total_tokens}`)
    }
  }
  for await (const chunk of response.body) for (const e of decoder.push(new TextDecoder().decode(chunk))) handle(e)
  for (const e of decoder.finish()) handle(e)
  console.log(`[${label}] done`)
}

console.log('=== turn 1: PREFIX only (warms cache) ===')
await turn('t1', `${PREFIX}\n\nQuestion: Reply with exactly: OK`)
console.log('\n=== turn 2: PREFIX + SUFFIX (prefix should hit cache) ===')
await turn('t2', `${PREFIX}\n\n${SUFFIX}\n\nQuestion: Reply with exactly: OK`)
console.log('\n=== turn 3: PREFIX + SUFFIX again (identical prompt) ===')
await turn('t3', `${PREFIX}\n\n${SUFFIX}\n\nQuestion: Reply with exactly: OK`)
