import { describe, expect, it } from 'vitest'
import {
  applyOfficialRoster,
  officialVerdictOf,
  parseTraeOfficialRoster,
  TraeOfficialRosterClient,
} from '../src/official-roster.ts'
import { mergeTraeModelSources, withChatCallableFunctions } from '../src/catalog.ts'
import { TRAE_DIRECTORY_FUNCTIONS } from '../src/solo.ts'
import type { TraeCredential } from '../src/auth.ts'
import type { TraeIdentity } from '../src/identity.ts'
import type { TraeDiscoveredModel } from '../src/model-metadata.ts'
import type { TraeWireModel } from '../src/catalog.ts'

/**
 * Issue #52: the plugin listed the UNION of twelve directory functions (46 rows
 * on a live CN credential) while the Trae client renders ONE function at a time
 * (14–24 rows), so the tail of the list was a screen of models the vendor's own
 * picker hides.
 *
 * The fix is a fourth upstream signal — `is_invisible_to_user` on the
 * `batch_get_detail_param` document the IDE renders — read as a PER-MODE roster
 * rather than a lifecycle flag. These specs pin the three properties that make
 * it safe to run without a setting: it fails open, it never guesses, and it
 * prefers the vendor's channel over ours.
 */

const CN_CHAT_FUNCTIONS = TRAE_DIRECTORY_FUNCTIONS.cn

/** One `function_configs` group as the IDE publishes it; only the fields we read. */
function group(fn: string, configs: Array<{ name: string; usage?: string; invisible?: boolean; switch?: boolean }>): unknown {
  return {
    function: fn,
    config_info_list: configs.map(config => ({
      config_name: config.name,
      usage: config.usage ?? 'chat_completion',
      ...config.invisible === undefined ? {} : { is_invisible_to_user: config.invisible },
      ...config.switch === undefined ? {} : { config_switch: config.switch },
    })),
  }
}

describe('1. the roster parser keeps (config, function) pairs apart', () => {
  it('indexes one config once per function, not once overall', () => {
    const roster = parseTraeOfficialRoster({
      function_configs: [
        group('solo_work_remote', [{ name: 'glm-5.3' }]),
        group('chat_v3', [{ name: 'glm-5.3' }]),
      ],
    })
    expect(roster.size).toEqual({ configs: 1, pairs: 2 })
    expect(roster.channels.get('glm-5.3')?.map(entry => entry.function)).toEqual(['solo_work_remote', 'chat_v3'])
  })

  it('collapses a duplicated pair first-wins', () => {
    const roster = parseTraeOfficialRoster({
      function_configs: [
        group('solo_coder', [{ name: 'kimi-k2-0905', invisible: true }]),
        group('solo_coder', [{ name: 'kimi-k2-0905', invisible: false }]),
      ],
    })
    expect(roster.size.pairs).toBe(1)
    expect(roster.channels.get('kimi-k2-0905')?.[0]?.invisible).toBe(true)
  })

  it('treats absent flags as "did not say", never as hidden or off', () => {
    const roster = parseTraeOfficialRoster({ function_configs: [group('chat_v3', [{ name: 'glm-5.2' }])] })
    expect(roster.channels.get('glm-5.2')?.[0]).toMatchObject({ invisible: false, enabled: true })
  })

  it('survives a malformed document instead of throwing', () => {
    for (const payload of [undefined, null, {}, { function_configs: 'nope' }, { function_configs: [null, 7] }]) {
      expect(parseTraeOfficialRoster(payload).size.configs).toBe(0)
    }
    // A group without a function cannot be judged per channel, so nothing enters.
    const roster = parseTraeOfficialRoster({
      function_configs: [{ function: '', config_info_list: [{ config_name: 'x' }] }, { config_info_list: [{ config_name: 'y' }] }],
    })
    expect(roster.size.configs).toBe(0)
  })
})

describe('2. the flag is a per-mode roster, not a lifecycle flag', () => {
  /**
   * Measured 2026-10-23 on a live CN credential.
   *
   *  - `glm-4.7` is hidden under every chat function and visible only under
   *    `code_review_summary` — a code-review helper config, not a chat route.
   *    Nothing left to call it through, so it is retired.
   *  - `DeepSeek-V4-Pro` is hidden under `solo_work_remote` (that mode shows
   *    `DeepSeek-V4-Pro-Official`) but VISIBLE under `chat_v3` and `solo_coder`.
   *    It is in current use, so it is re-pinned rather than deleted.
   */
  const roster = parseTraeOfficialRoster({
    function_configs: [
      group('code_review_summary', [{ name: 'glm-4.7', invisible: false }]),
      group('chat_v3', [{ name: 'glm-4.7', invisible: true }]),
      group('solo_coder', [{ name: 'glm-4.7', invisible: true }]),
      group('solo_work_remote', [{ name: 'DeepSeek-V4-Pro', invisible: true }]),
      group('chat_v3', [{ name: 'DeepSeek-V4-Pro', invisible: false }]),
      group('solo_coder', [{ name: 'DeepSeek-V4-Pro', invisible: false }]),
      group('solo_work_remote', [{ name: 'glm-5.3', invisible: false }]),
    ],
  })

  it('retires a config no chat function offers any more', () => {
    // Visible under code_review_summary, but that is not a chat function, so
    // there is no route left for a chat turn.
    expect(officialVerdictOf({ id: 'glm-4.7', wireFunction: 'chat_v3' }, roster, CN_CHAT_FUNCTIONS)).toMatchObject({ kind: 'hide' })
  })

  it('re-pins a config the vendor shows on another chat function', () => {
    expect(officialVerdictOf({ id: 'DeepSeek-V4-Pro', wireFunction: 'solo_work_remote' }, roster, CN_CHAT_FUNCTIONS)).toMatchObject({
      kind: 'repin',
      from: 'solo_work_remote',
      // `chat_v3` precedes `solo_coder` in the region's own priority list, and
      // both show it, so the choice is deterministic.
      to: 'chat_v3',
    })
  })

  it('keeps a row whose own channel shows it', () => {
    expect(officialVerdictOf({ id: 'glm-5.3', wireFunction: 'solo_work_remote' }, roster, CN_CHAT_FUNCTIONS)).toEqual({ kind: 'keep' })
  })

  it('picks the re-pin target by channel priority, not by document order', () => {
    const glm5 = parseTraeOfficialRoster({
      function_configs: [
        group('solo_work_remote', [{ name: 'glm-5', invisible: true }]),
        group('solo_coder', [{ name: 'glm-5', invisible: false }]),
        group('solo_work_lite', [{ name: 'glm-5', invisible: false }]),
      ],
    })
    expect(officialVerdictOf({ id: 'glm-5', wireFunction: 'solo_work_remote' }, glm5, CN_CHAT_FUNCTIONS)).toMatchObject({ to: 'solo_work_lite' })
  })

  it('re-pins a channel-less row to a channel that offers it', () => {
    // `withChatCallableFunctions` clears a non-chat function; the bridge then
    // sends the region default, which may be a channel where it is hidden.
    expect(officialVerdictOf({ id: 'DeepSeek-V4-Pro' }, roster, CN_CHAT_FUNCTIONS)).toEqual({
      kind: 'repin',
      from: undefined,
      to: 'chat_v3',
      listedBy: ['solo_work_remote', 'chat_v3', 'solo_coder'],
    })
  })

  it('retires a channel-less row the vendor hides everywhere', () => {
    // The known `doubao_1_8` shape: no directory function, and the measured
    // 4001 on the default channel.
    const hiddenEverywhere = parseTraeOfficialRoster({
      function_configs: [
        group('solo_work_lite', [{ name: 'doubao_1_8', invisible: true }]),
        group('chat_v3', [{ name: 'doubao_1_8', invisible: true }]),
      ],
    })
    expect(officialVerdictOf({ id: 'doubao_1_8' }, hiddenEverywhere, CN_CHAT_FUNCTIONS)).toMatchObject({ kind: 'hide' })
  })

  it('judges by wireConfigName, because that is what the request sends', () => {
    expect(officialVerdictOf({ id: 'DeepSeek-V4-Pro-Official-Display', wireConfigName: 'DeepSeek-V4-Pro', wireFunction: 'solo_work_remote' }, roster, CN_CHAT_FUNCTIONS)).toMatchObject({ kind: 'repin' })
    expect(officialVerdictOf({ id: 'DeepSeek-V4-Pro-Official-Display', wireFunction: 'solo_work_remote' }, roster, CN_CHAT_FUNCTIONS)).toEqual({ kind: 'keep' })
  })

  it('is case-insensitive, because the two directories disagree on case', () => {
    expect(officialVerdictOf({ id: 'GLM-4.7', wireFunction: 'chat_v3' }, roster, CN_CHAT_FUNCTIONS)).toMatchObject({ kind: 'hide' })
  })
})

describe('3. the verdict keeps every ambiguity', () => {
  const roster = parseTraeOfficialRoster({
    function_configs: [
      group('chat_v3', [{ name: 'glm-5.2', invisible: false }]),
      group('chat_v3', [{ name: 'glm-5.3', usage: 'title_generation', invisible: true }]),
      group('solo_work_remote', [{ name: 'glm-4.7', invisible: true }]),
      group('code_review_summary', [{ name: 'qwen3-coder', invisible: false }]),
    ],
  })

  it('keeps a config the roster never mentions', () => {
    // Measured: `kimi-k2.8-preview` and `qwen3.8-flash` exist only in the Remote
    // directory's `chat_v3` group, so their absence here is not a verdict.
    expect(officialVerdictOf({ id: 'kimi-k2.8-preview', wireFunction: 'chat_v3' }, roster, CN_CHAT_FUNCTIONS)).toEqual({ kind: 'keep' })
  })

  it('does not read a tool config as a model verdict', () => {
    expect(officialVerdictOf({ id: 'glm-5.3', wireFunction: 'chat_v3' }, roster, CN_CHAT_FUNCTIONS)).toEqual({ kind: 'keep' })
  })

  it('keeps a config only a NON-chat function lists', () => {
    expect(officialVerdictOf({ id: 'qwen3-coder', wireFunction: 'solo_coder' }, roster, CN_CHAT_FUNCTIONS)).toEqual({ kind: 'keep' })
  })

  it('does NOT treat `config_switch: false` as a verdict', () => {
    const switches = parseTraeOfficialRoster({
      function_configs: [group('chat_v3', [{ name: 'glm-5.2', switch: false }])],
    })
    expect(officialVerdictOf({ id: 'glm-5.2', wireFunction: 'chat_v3' }, switches, CN_CHAT_FUNCTIONS)).toEqual({ kind: 'keep' })
    expect(applyOfficialRoster([{ id: 'glm-5.2', wireFunction: 'chat_v3' }], switches, CN_CHAT_FUNCTIONS).hidden).toEqual([])
  })
})

describe('4. the filter fails open and preserves order', () => {
  const rows = [
    { id: 'glm-5.3', wireFunction: 'solo_work_remote' },
    { id: 'glm-4.7', wireFunction: 'chat_v3' },
    { id: 'DeepSeek-V4-Pro', wireFunction: 'solo_work_remote' },
    { id: 'kimi-k2.8-preview', wireFunction: 'chat_v3' },
  ]
  const roster = parseTraeOfficialRoster({
    function_configs: [
      group('solo_work_remote', [{ name: 'glm-5.3', invisible: false }, { name: 'DeepSeek-V4-Pro', invisible: true }]),
      group('chat_v3', [{ name: 'glm-4.7', invisible: true }, { name: 'DeepSeek-V4-Pro', invisible: false }]),
    ],
  })

  it('keeps every row when the roster could not be read', () => {
    const result = applyOfficialRoster(rows, undefined, CN_CHAT_FUNCTIONS)
    expect(result.rows).toEqual(rows)
    expect(result.hidden).toEqual([])
    expect(result.repinned).toEqual([])
  })

  it('removes the retired row, re-pins the mis-pinned one, and keeps the order', () => {
    const result = applyOfficialRoster(rows, roster, CN_CHAT_FUNCTIONS)
    expect(result.rows.map(row => row.id)).toEqual(['glm-5.3', 'DeepSeek-V4-Pro', 'kimi-k2.8-preview'])
    expect(result.hidden).toEqual([{ id: 'glm-4.7', function: 'chat_v3' }])
    expect(result.repinned).toEqual([{ id: 'DeepSeek-V4-Pro', from: 'solo_work_remote', to: 'chat_v3' }])
    // The kept row carries the corrected function, which is what the chat call
    // replays.
    expect(result.rows[1]?.wireFunction).toBe('chat_v3')
  })
})

describe('5. end to end through the real merge (issue #52 shape)', () => {
  // The reported shape: the Remote skeleton carries the live roster, #46's
  // promotion adds a dated snapshot that is CALLABLE but hidden in the IDE, and
  // the roster is the only signal that separates the two.
  const remote: TraeDiscoveredModel[] = [
    { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 200_000, function: 'solo_work_remote', multimodal: false, reasoningSupported: false },
  ]
  const wire: TraeWireModel[] = [
    { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 200_000, usage: 'chat_completion', configSource: 1, function: 'solo_work_remote' },
    { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 100_000, usage: 'chat_completion', configSource: 1, function: 'chat_v3' },
    { id: 'glm-5', name: 'GLM-5', contextWindow: 200_000, usage: 'chat_completion', configSource: 1, function: 'solo_work_remote' },
  ]
  const roster = parseTraeOfficialRoster({
    function_configs: [
      group('solo_work_remote', [{ name: 'glm-5.3', invisible: false }, { name: 'glm-5', invisible: true }]),
      group('chat_v3', [{ name: 'glm-4.6', invisible: true }, { name: 'glm-5', invisible: false }]),
    ],
  })

  it('drops the promoted-but-retired row, keeps the live one, re-pins the third', () => {
    const merged = withChatCallableFunctions(mergeTraeModelSources(remote, wire), CN_CHAT_FUNCTIONS)
    // #46's promotion is what put `glm-4.6` and `glm-5` in the list at all.
    expect(merged.map(model => model.id)).toEqual(['glm-5.3', 'glm-4.6', 'glm-5'])
    const filtered = applyOfficialRoster(merged, roster, CN_CHAT_FUNCTIONS)
    expect(filtered.rows.map(model => model.id)).toEqual(['glm-5.3', 'glm-5'])
    expect(filtered.hidden.map(entry => entry.id)).toEqual(['glm-4.6'])
    expect(filtered.repinned).toEqual([{ id: 'glm-5', from: 'solo_work_remote', to: 'chat_v3' }])
  })

  it('changes nothing when the roster is unavailable', () => {
    const merged = withChatCallableFunctions(mergeTraeModelSources(remote, wire), CN_CHAT_FUNCTIONS)
    expect(applyOfficialRoster(merged, undefined, CN_CHAT_FUNCTIONS).rows.map(model => model.id)).toEqual(['glm-5.3', 'glm-4.6', 'glm-5'])
  })
})

describe('6. the client never fails a refresh', () => {
  const credential: TraeCredential = {
    accessToken: 'token', refreshToken: 'refresh', userId: 'user', host: 'https://api.trae.cn',
    userRegion: 'CN', expiresAtMs: 0, edition: 'cn', source: 'desktop',
  }

  const identity: TraeIdentity = {
    edition: 'cn', machineId: 'machine', deviceId: 'device', platform: 'win32',
  }

  function client(fetchImpl: typeof fetch, now = () => 1_000): TraeOfficialRosterClient {
    return new TraeOfficialRosterClient({
      credential: async () => credential,
      identity: async () => identity,
      fetchImpl,
      baseUrl: 'https://example.test',
      now,
    })
  }

  it('asks the IDE endpoint with the model-detail body and header profile', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ function_configs: [group('chat_v3', [{ name: 'glm-5.2' }])] }), { status: 200 })
    }) as unknown as typeof fetch
    const roster = await client(fetchImpl).fetch()
    expect(roster?.size.configs).toBe(1)
    expect(calls[0]?.url).toBe('https://example.test/api/ide/v1/batch_get_detail_param')
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body['show_custom_model']).toBe(true)
    expect(Array.isArray(body['functions'])).toBe(true)
    // `X-Ide-Token` is what the IDE sends and what the Remote directory's thin
    // header set lacks — without it the endpoint answers 200 with per-function
    // `2001 Config detail for function: … not found`, a false success.
    expect(Object.keys(calls[0]?.init.headers as Record<string, string>)).toContain('X-Ide-Token')
  })

  it('resolves undefined (not a throw) on a transport failure or a bad body', async () => {
    const failing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await client(failing).fetch()).toBeUndefined()
    const empty = (async () => new Response(JSON.stringify({ function_configs: [] }), { status: 200 })) as unknown as typeof fetch
    expect(await client(empty).fetch()).toBeUndefined()
    const rejected = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    expect(await client(rejected).fetch()).toBeUndefined()
  })

  it('reuses a successful read inside the cache window and re-probes after it', async () => {
    let clock = 0
    let requests = 0
    const fetchImpl = (async () => {
      requests += 1
      return new Response(JSON.stringify({ function_configs: [group('chat_v3', [{ name: 'glm-5.2' }])] }), { status: 200 })
    }) as unknown as typeof fetch
    const roster = client(fetchImpl, () => clock)
    await roster.fetch()
    clock += 60_000
    await roster.fetch()
    expect(requests).toBe(1)
    expect(roster.cachedRoster()?.size.configs).toBe(1)
    clock += 10 * 60_000
    await roster.fetch()
    expect(requests).toBe(2)
  })
})
