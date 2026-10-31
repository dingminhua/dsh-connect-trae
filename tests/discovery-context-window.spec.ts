import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import * as Trae from '../src/index.ts'
import { TRAE_AUTH_STORAGE_KEY } from '../src/decrypt.ts'

/**
 * Issue #72, end to end through the REAL host service.
 *
 * #70 (v4.6.11) put the context-window fallback into the adapter's `toPiModel`,
 * but the plugin's OTHER exit toward DSH — the `registerModelDiscovery`
 * callback — passed `contextWindow` through raw, and the host hands discovery
 * rows to its callers UNVALIDATED. One malformed directory row was therefore
 * enough to bypass #70 entirely: a model-management surface adopts such a row
 * verbatim into a `models` entry whose schema demands `step(1).min(1)`, so the
 * malformed value either ships onward or (for a row that omitted the window)
 * reaches DSH unsized — the exact #70 failure with the adapter bypassed.
 *
 * This spec is the counterpart of tests/context-window-fallback.spec.ts (which
 * covers the adapter exit): it mounts the plugin with the same 0.1.7-shaped
 * harness as tests/settings-integration.spec.ts, stubs the upstream directory
 * with rows carrying every illegal shape #70 enumerated (fractional / omitted),
 * and drives `ctx.llm.discoverModels()` — the callback's own consumer. Revert
 * the guard and these rows go back to `200000.5` / missing, and the suite turns
 * red on its own, without editing any test.
 */

/**
 * A `{get(): T}` live reference, exactly as DSH 0.1.7 delivers a
 * volatile-marked settings field to `apply()` (see settings-integration.spec.ts
 * for why the getter must read at CALL time).
 */
function liveOf<T>(field: () => T): { get: () => T } {
  return { get: field }
}

const VOLATILE_FIELDS = new Set(['authFile', 'edition', 'accounts', 'regions', 'showPointsInMainUi'])

/** 0.1.7-shaped in-memory settings service (same contract as settings-integration.spec.ts). */
class MemorySettings extends Service {
  readonly document: Record<string, unknown>
  private revision = 0
  constructor(owner: Context, document: Record<string, unknown> = {}) {
    super(owner, 'settings')
    this.document = document
  }
  configure(_presentation: { auto?: boolean }): () => void {
    return () => {}
  }
  describe(): { ns: string; writable: boolean; value: unknown; revision: number }[] {
    return [{ ns: 'trae', writable: true, value: this.document, revision: this.revision }]
  }
  async update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void> {
    for (const key of Object.keys(patch)) {
      if (!VOLATILE_FIELDS.has(key)) throw new Error(`Config field "${key}" is not volatile`)
    }
    if (expectedRevision !== undefined && expectedRevision !== this.revision) {
      throw new Error(`SettingsConflictError: expected revision ${expectedRevision}, actual ${this.revision}`)
    }
    Object.assign(this.document, structuredClone(patch))
    this.revision += 1
    ;(this.ctx as unknown as { emit(name: string): void }).emit('loader/volatile-update')
    void ns
  }
}

/**
 * A personal CN storage document that satisfies BOTH readers: the credential
 * store (tests/auth.spec.ts shape) and `readTraeIdentity`, which requires
 * `telemetry.machineId` from the SAME file and throws (no CLI fallback) when
 * the file exists but carries no identity.
 */
function storageDocument(): string {
  const expiredAt = new Date(Date.now() + 3_600_000).toISOString()
  return JSON.stringify({
    [TRAE_AUTH_STORAGE_KEY]: JSON.stringify({
      token: 'discovery-test-token',
      refreshToken: 'rt',
      userId: 'uid',
      account: { username: 'uid' },
      host: 'https://api.trae.cn',
      expiredAt,
      refreshExpiredAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    'telemetry.machineId': 'a'.repeat(64),
    'telemetry.devDeviceId': 'device-1',
  })
}

/**
 * The upstream stub. Three endpoints matter, keyed by URL substring:
 *
 *  - `/api/remote/v1/models` (GET, the Remote directory skeleton): one row with
 *    a FRACTIONAL window (`context_window_tokens.dev: 200000.5` — `finitePositive`
 *    only checks `isFinite && > 0`, so it survives intact, the exact case #70
 *    added tests for), one row OMITTING the window (upstream field genuinely
 *    omittable), and one sane row whose 168000 must be KEPT (the guard is a
 *    backstop, not a clamp).
 *  - `get_detail_param` (POST, the wire roster): a wire-ONLY promotable config
 *    (`usage: chat_completion`, `config_source: 1`, a real display name) whose
 *    `prompt_max_tokens` is fractional too — proving the wire branch cannot be
 *    skipped the way issue #72's reporter assumed, because this value also
 *    reaches the catalog through `finitePositive`.
 *  - `batch_get_detail_param` (the IDE roster): `{}` parses to an empty roster,
 *    which the client collapses to `undefined` and `applyOfficialRoster` then
 *    keeps every row — the documented optional path.
 *
 * Anything else answers 500: a discovery path that needed an endpoint not
 * stubbed here must fail loudly, not hang on a real network call.
 */
function stubUpstream(): void {
  const remoteRows = [
    { name: 'frac-directory', display_name: 'Fractional Directory', context_window_tokens: { dev: 200_000.5 } },
    { name: 'unsized-directory', display_name: 'Unsized Directory' },
    { name: 'sane-directory', display_name: 'Sane Directory', context_window_tokens: { dev: 168_000 } },
  ]
  const wireRows = [{
    config_name: 'snapshot-kimi-k3',
    display_config: { display_name: 'Snapshot Kimi K3' },
    usage: 'chat_completion',
    config_source: 1,
    model_detail_list: [{ prompt_max_tokens: 300_000.5, max_tokens: 32_000 }],
  }]
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: { body?: string }) => {
    const url = String(input)
    if (url.includes('/api/remote/v1/models')) {
      return new Response(JSON.stringify({ code: 0, data: { list: [{ function: 'solo_work_remote', models: remoteRows }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('get_detail_param') && !url.includes('batch_get_detail_param')) {
      return new Response(JSON.stringify({ config_info_list: wireRows }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    void init
    return new Response('{}', { status: 500 })
  }))
}

let context: Context | undefined
const cleanup: string[] = []
const restores: (() => Promise<void>)[] = []
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllGlobals()
  for (const restore of restores.splice(0)) await restore()
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function isolatedPlugin(ctx: Context, authFile: string): Promise<() => Promise<void>> {
  const settings = ctx.get('settings') as unknown as MemorySettings
  const document = settings.document
  document.authFile = authFile
  document.edition = 'auto'
  const pluginConfig = {
    authFile: liveOf(() => document.authFile),
    edition: liveOf(() => document.edition),
  }
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-trae-discovery-home-'))
  await ctx.plugin({ name: Trae.name, inject: Trae.inject, apply: Trae.apply }, pluginConfig as unknown as Trae.Config)
  return async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
}

/**
 * Mount the plugin against a stubbed upstream + a real temp credential, wait
 * for the provider registration (the same `shim.ready` promise that precedes
 * `registerModelDiscovery`), and return the rows the HOST read back through
 * `ctx.llm.discoverModels` — the exact call a model-management surface makes.
 */
async function discoverRows(): Promise<{ id: string; contextWindow?: number }[]> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-trae-discovery-'))
  cleanup.push(dir)
  const authFile = join(dir, 'storage.json')
  await writeFile(authFile, storageDocument())
  stubUpstream()
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  const restore = await isolatedPlugin(ctx, authFile)
  restores.push(restore)
  await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
  return await ctx.llm.discoverModels(Trae.TRAE_SETTINGS_NS, { provider: 'trae' })
}

describe('model discovery context window (issue #72)', () => {
  it('every row the host reads back carries a positive INTEGER contextWindow', async () => {
    const rows = await discoverRows()
    expect(rows.length).toBeGreaterThanOrEqual(4)
    for (const row of rows) {
      expect(Number.isInteger(row.contextWindow), `${row.id} must never reach the host as ${String(row.contextWindow)}`).toBe(true)
      expect(row.contextWindow!, `${row.id} must carry a positive window`).toBeGreaterThan(0)
    }
  })

  it('backstops a fractional directory window with the fallback', async () => {
    const rows = await discoverRows()
    const fractional = rows.find(row => row.id === 'frac-directory')
    expect(fractional?.contextWindow).toBe(Trae.FALLBACK_CONTEXT_WINDOW)
  })

  it('sizes a row the directory omitted rather than passing the omission through', async () => {
    // The #70 failure mode with the adapter bypassed: an omitted window is not
    // an illegal value, but a surface adopting this row into a `models` entry
    // gets an unsized row. The callback therefore ALWAYS emits the field —
    // `Object.hasOwn` is what makes reverting ONLY the callback turn this red.
    const rows = await discoverRows()
    const unsized = rows.find(row => row.id === 'unsized-directory')
    expect(unsized).toBeDefined()
    expect(Object.hasOwn(unsized!, 'contextWindow')).toBe(true)
    expect(unsized!.contextWindow).toBe(Trae.FALLBACK_CONTEXT_WINDOW)
  })

  it('leaves a sane window untouched — the guard is a backstop, not a clamp', async () => {
    const rows = await discoverRows()
    expect(rows.find(row => row.id === 'sane-directory')?.contextWindow).toBe(168_000)
  })

  it('backstops a fractional WIRE-roster window too (the branch #72 proposed skipping)', async () => {
    // The promoted wire row reaches the catalog through the same
    // `finitePositive` (no integer check), so `prompt_max_tokens: 300000.5`
    // arrives intact — the reporter's premise that this branch structurally
    // cannot carry an illegal value does not hold for the fractional case.
    const rows = await discoverRows()
    const promoted = rows.find(row => row.id === 'snapshot-kimi-k3')
    expect(promoted, 'the promotable wire-only row must have survived the merge').toBeDefined()
    expect(promoted?.contextWindow).toBe(Trae.FALLBACK_CONTEXT_WINDOW)
  })
})
