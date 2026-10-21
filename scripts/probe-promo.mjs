#!/usr/bin/env node
/**
 * Read-only CN probe: replay the plugin's OWN promotion chain against the live
 * directory and print the capsules the card would paint right now.
 *
 *  1. decrypt the desktop sign-in from Trae's own storage.json (same algorithm
 *     as src/decrypt.ts — no token is printed);
 *  2. GET the SOLO remote /models directory (read-only, no credits);
 *  3. parse each row with parseTraeRemoteModel, then judge it with
 *     selectTraePromoBadge against the current clock;
 *  4. re-judge the same rules at a few shifted clocks, to show the verdict is a
 *     function of time and not a value frozen at parse time.
 *
 * Safe to run: no chat calls, no writes, no quota.
 *
 * Usage: node --experimental-transform-types scripts/probe-promo.mjs [--shifts]
 * (`transform`, not `strip`: src/solo-remote.ts uses constructor parameter
 * properties, which strip-only mode rejects.)
 */
import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
  else throw new Error('unsupported header')
  const salt = type === 'aes-private' ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B)
  const first = createHash('sha512').update(buffer.subarray(6, 38)).digest()
  const derived = createHash('sha512').update(Buffer.concat([first, salt])).digest()
  const decipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32))
  const decrypted = Buffer.concat([decipher.update(buffer.subarray(38)), decipher.final()])
  return decrypted.subarray(64).toString('utf8')
}

const { parseTraeRemoteModel } = await import('../src/model-metadata.ts')
const { preferStrongerRow } = await import('../src/solo-remote.ts')
const { selectTraePromoBadge } = await import('../src/promo.ts')

const storagePath = process.env.TRAE_STORAGE
  ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Trae CN', 'User', 'globalStorage', 'storage.json')

const storage = JSON.parse(await readFile(storagePath, 'utf8'))
const credential = JSON.parse(decryptTraeStorageValue(storage['iCubeAuthInfo://icube.cloudide']))
const token = credential.accessToken ?? credential.token
if (typeof token !== 'string' || token === '') throw new Error('no access token in the decrypted sign-in')

const FUNCTIONS = ['solo_agent', 'solo_agent_remote', 'solo_work_remote', 'solo_work_lite', 'chat_v3', 'solo_coder', 'builder_v3']
const headers = {
  'Authorization': `Cloud-IDE-JWT ${token}`,
  'Content-Type': 'application/json',
  'x-trae-client-type': 'web',
  'x-trae-user-timezone': 'Asia/Shanghai',
  'x-preferenced-language': 'zh-cn',
  'Referer': 'https://solo.trae.cn/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}

const url = `https://solo.trae.cn/api/remote/v1/models?functions=${FUNCTIONS.join(',')}`
const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`remote directory returned HTTP ${response.status}`)
const json = await response.json()
const groups = json?.data?.list ?? []
// Dedupe exactly the way the plugin's own client does (preferStrongerRow), so
// this report paints what the card paints. Counting each appearance instead
// would claim four times the promotional coverage, and a "first wins" dedupe
// would hide the rule whenever a group without it answered first.
const byId = new Map()
for (const group of groups) {
  if (!Array.isArray(group?.models)) continue
  for (const raw of group.models) {
    const parsed = parseTraeRemoteModel(raw)
    if (parsed === undefined) continue
    byId.set(parsed.id, preferStrongerRow(parsed, byId.get(parsed.id)))
  }
}
const rows = [...byId.values()]

const withRule = rows.filter(row => row.activityDiscount !== undefined)
const now = new Date()
const withBadge = withRule.flatMap(row => {
  const badge = selectTraePromoBadge(row.activityDiscount, now)
  return badge === undefined ? [] : [{ id: row.id, badge }]
})

console.log(`remote groups: ${groups.length}   rows: ${rows.length}   rows carrying a rule: ${withRule.length}`)
console.log(`clock: ${now.toISOString()}  (Asia/Shanghai ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now)})`)
console.log('')
console.log(`== badges now (${withBadge.length}) ==`)
for (const { id, badge } of withBadge) {
  const window = badge.fromClock === undefined ? '' : ` window=${badge.fromClock}-${badge.untilClock} ${badge.timeZone}`
  console.log(`- ${id.padEnd(34)} ${badge.kind.padEnd(8)} ${badge.discountPercent}% pay (${badge.percentOff}% off)${window}`)
}
const silent = withRule.filter(row => !withBadge.some(entry => entry.id === row.id))
console.log('')
console.log(`== rule but no badge right now (${silent.length}) ==`)
for (const row of silent) {
  const keys = row.activityDiscount.offPeak?.windows.length ?? 0
  console.log(`- ${row.id.padEnd(34)} subKey=${row.activityDiscount.subKey ?? '-'} current=${row.activityDiscount.current?.discountType ?? '-'} windows=${keys}`)
}

if (process.argv.includes('--shifts')) {
  console.log('')
  console.log('== same rules, clock shifted (verdict is time-dependent, not frozen) ==')
  for (const hours of [0, 6, 12, 24, 36]) {
    const clock = new Date(now.getTime() + hours * 3_600_000)
    const ids = withRule
      .filter(row => selectTraePromoBadge(row.activityDiscount, clock) !== undefined)
      .map(row => row.id)
    console.log(`+${String(hours).padStart(2, ' ')}h (${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(clock)}): ${ids.length} badges ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}`)
  }
}
