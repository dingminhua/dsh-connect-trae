import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import * as Trae from '../src/index.ts'

/**
 * A `{get(): T}` live reference, exactly as DSH 0.1.7 delivers a
 * volatile-marked settings field to `apply()`. The getter must read the
 * backing field at CALL time — capturing the value would freeze it at mount
 * and no later settings write would ever be visible through `current()`.
 */
function liveOf<T>(field: () => T): { get: () => T } {
  return { get: field }
}

/**
 * The plugin's schema marks exactly these fields volatile — the only fields
 * the 0.1.7 settings write gate accepts (matches `asVolatile` in `src/index.ts`).
 */
const VOLATILE_FIELDS = new Set(['authFile', 'edition', 'accounts', 'regions'])

/**
 * 0.1.7-shaped in-memory settings service.
 *
 * `SettingsForms` (the real 0.1.7 service) dropped `installSection` and keys
 * namespaces by the Loader entry id; writes go through the profile patch and
 * announce themselves with `loader/volatile-update`, and volatile fields are
 * delivered as live references that resolve the updated document. This double
 * models that surface for the plugin and the tests:
 *
 * - `configure({auto}, owner)` is the sole host registration path;
 * - `update(ns, patch)` enforces the 0.1.7 write gate (only volatile fields),
 *   folds the patch into a SHARED document, then emits
 *   `loader/volatile-update` so the plugin re-applies over `current()` — whose
 *   volatile fields are live references INTO this document (see
 *   {@link isolatedPlugin}). That is exactly how a real host write reaches the
 *   plugin: the references resolve the updated document.
 */
class MemorySettings extends Service {
  readonly document: Record<string, unknown>
  readonly configureCalls: { auto?: boolean }[] = []
  constructor(owner: Context, document: Record<string, unknown> = {}) {
    super(owner, 'settings')
    this.document = document
  }
  configure(presentation: { auto?: boolean }): () => void {
    this.configureCalls.push(presentation)
    return () => {}
  }
  describe(): { ns: string; writable: boolean; value: unknown }[] {
    return [{ ns: 'trae', writable: true, value: this.document }]
  }
  async update(ns: string, patch: Record<string, unknown>): Promise<void> {
    for (const key of Object.keys(patch)) {
      if (!VOLATILE_FIELDS.has(key)) throw new Error(`Config field "${key}" is not volatile`)
    }
    Object.assign(this.document, structuredClone(patch))
    ;(this.ctx as unknown as { emit(name: string): void }).emit('loader/volatile-update')
    void ns
  }
}

let context: Context | undefined
afterEach(async () => { await context?.fiber.dispose(); context = undefined })

/**
 * Fully isolate a plugin instance from the host machine's real Trae state:
 * a nonexistent authFile detaches the desktop and CLI candidates, and a
 * temporary DSH_HOME detaches the plugin-owned credential copy. Without this
 * the startup seed — which now serves the LIVE directory whenever a
 * credential resolves, and converges the tracked region on it (workbuddy
 * semantics) — would surface the machine's real roster and region, making
 * every fallback assertion depend on who happens to be signed in.
 *
 * The plugin's config is handed over as live references INTO the settings
 * document (the 0.1.7 delivery shape), and the plugin is mounted WITHOUT its
 * Config schema so cordis does not re-validate and re-snapshot those
 * references — `apply` is the same function either way.
 */
async function isolatedPlugin(ctx: Context, config: Partial<Trae.Config> = {}): Promise<() => Promise<void>> {
  const settings = ctx.get('settings') as unknown as MemorySettings
  const document = settings.document
  document.authFile = config.authFile ?? '/nonexistent/dsh-connect-trae-test-storage.json'
  document.edition = config.edition ?? 'auto'
  document.accounts = config.accounts
  document.regions = config.regions
  const pluginConfig = {
    authFile: liveOf(() => document.authFile),
    edition: liveOf(() => document.edition),
    accounts: liveOf(() => document.accounts),
    regions: liveOf(() => document.regions),
    accountId: config.accountId,
    lastCatalog: config.lastCatalog,
    enabledModelIds: config.enabledModelIds,
    contextBudgets: config.contextBudgets,
    imageModelIds: config.imageModelIds,
    models: config.models,
  }
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-trae-test-home-'))
  await ctx.plugin({ name: Trae.name, inject: Trae.inject, apply: Trae.apply }, pluginConfig as unknown as Trae.Config)
  return async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
}

describe('Trae provider registration', () => {
  it('registers both regional providers, settings, and fallback models after shim startup', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')
      expect(ctx.llm.listConfigurableProviders()).toContainEqual({
        provider: 'trae', displayName: 'Trae', settingsNs: 'trae', settingsPath: [], declared: false,
      })
      expect(ctx.llm.listConfigurableProviders()).toContainEqual({
        provider: 'trae-global', displayName: 'Trae Global', settingsNs: 'trae', settingsPath: [], declared: false,
      })
      expect(ctx.settings.describe().some(entry => entry.ns === Trae.TRAE_SETTINGS_NS)).toBe(true)
      const models = await ctx.llm.listModels('trae')
      expect(models.map(model => model.id)).toContain('DeepSeek-V4-Flash-Official')
      expect(models.map(model => model.id)).toContain('DeepSeek-V4-Pro-Official')
      expect(models.find(model => model.id === 'glm-5.2')?.inputModalities).toEqual(['text'])
      expect(models.find(model => model.id === 'kimi-k2.6')?.inputModalities).toEqual(['text'])
      expect(models.find(model => model.id === 'DeepSeek-V4-Pro-Official')?.inputModalities).toEqual(['text'])
      // No `auto` row: it is not a Trae config_name, so it could never be called.
      expect(models.map(model => model.id)).not.toContain('auto')
      // The international provider serves its own fallback roster, not the CN one.
      const globalIds = (await ctx.llm.listModels('trae-global')).map(model => model.id)
      expect(globalIds.length).toBeGreaterThan(0)
      expect(globalIds).not.toContain('DeepSeek-V4-Pro-Official')
    } finally { await restore() }
  })

  it('applies the explicit image opt-in to the live adapter catalog', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

      // 0.1.7's write gate accepts volatile fields only, so the image opt-in is
      // written into the volatile `regions.cn` slot (the card's shape), not the
      // non-volatile legacy flat field.
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { regions: { cn: { imageModelIds: ['DeepSeek-V4-Pro-Official'] } } })

      const models = await ctx.llm.listModels('trae')
      expect(models.find(model => model.id === 'DeepSeek-V4-Pro-Official')?.inputModalities).toEqual(['text', 'image'])
      expect(models.find(model => model.id === 'DeepSeek-V4-Flash-Official')?.inputModalities).toEqual(['text'])
    } finally { await restore() }
  })

  it('embeds the saved credit multiplier into the registered model name', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

      // Saving the directory persists the multiplier; the adapter then exposes
      // the DSH-facing name `Name · x<rate>` while the model id stays pure.
      // The write goes into the volatile `regions.cn` slot (0.1.7 write gate).
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
        regions: {
          cn: {
            lastCatalog: [
              { id: 'glm-5.2', name: 'GLM-5.2', input: ['text'], creditMultiplier: 0.79 },
              { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', input: ['text'] },
            ],
            enabledModelIds: ['glm-5.2'],
          },
        },
      })

      const models = await ctx.llm.listModels('trae')
      const glm = models.find(model => model.id === 'glm-5.2')
      expect(glm?.name).toBe('GLM-5.2 · x0.79')
    } finally { await restore() }
  })
})

describe('per-region provider switch (issue #11)', () => {
  /**
   * The USER-visible claim of this feature: a switched-off provider must not be
   * selectable any more. The model picker builds its provider groups from
   * `ctx.llm.listProviders()` (mirroring `packages/api/session-controller/src/
   * catalog.ts`), so this walks the same two calls the picker makes and asserts
   * the group is gone — not merely that the id is missing from a list.
   */
  async function pickerGroups(ctx: Context): Promise<string[]> {
    const groups: string[] = []
    for (const provider of ctx.llm.listProviders()) {
      const models = await ctx.llm.listModels(provider.id)
      if (models.length > 0) groups.push(provider.id)
    }
    return groups
  }

  it('withdraws a switched-off region from the model picker and the provider directory', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')
      expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toContain('trae-global')
      // Both providers are selectable to begin with.
      expect(await pickerGroups(ctx)).toEqual(expect.arrayContaining(['trae', 'trae-global']))

      // The user switches the international side off.
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { regions: { ai: { enabled: false } } })

      // The ROUTE is gone: this is what actually removes its models from the
      // model picker. Hiding the card tab alone would leave them selectable.
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).not.toContain('trae-global')
      // And the provider has no group in the picker catalog any more.
      expect(await pickerGroups(ctx)).not.toContain('trae-global')
      // And the provider row is gone from the settings directory too.
      expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).not.toContain('trae-global')
      // A disabled region must not take its enabled sibling with it.
      expect(await pickerGroups(ctx)).toContain('trae')
      expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toContain('trae')

      // Switching it back on restores the route AND its picker group.
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { regions: { ai: { enabled: true } } })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')
      expect(await pickerGroups(ctx)).toContain('trae-global')
      expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toContain('trae-global')
    } finally { await restore() }
  })

  it('disables a region at startup without leaving the other side broken', async () => {
    // The saved state must be honoured before the plugin ever serves a request:
    // a region disabled while the harness was down must not register its route
    // on the next start, and the enabled sibling must still be fully wired.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    // The switch is already `false` in the plugin's configuration before it ever
    // loads — exactly the state left behind by a previous session.
    const restore = await isolatedPlugin(ctx, { regions: { ai: { enabled: false } } })
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      // Give the (no-op) ai registration path the same window the cn side got.
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(ctx.llm.listProviders().map(provider => provider.id)).not.toContain('trae-global')
      expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toEqual(['trae'])
      // The enabled side still serves models.
      expect((await ctx.llm.listModels('trae')).length).toBeGreaterThan(0)
    } finally { await restore() }
  })

  it('allows switching BOTH regions off, leaving a recoverable empty plugin', async () => {
    // "I don't use either side" is a legitimate state (it just parks the
    // plugin). It must not throw, and both routes must come back on request —
    // the card always renders both tabs, so there is no way to get locked out.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { regions: { cn: { enabled: false }, ai: { enabled: false } } })
      await expect.poll(() => ctx.llm.listProviders().length).toBe(0)
      expect(ctx.llm.listConfigurableProviders()).toEqual([])

      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { regions: { cn: { enabled: true }, ai: { enabled: true } } })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')
      expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toEqual(['trae', 'trae-global'])
    } finally { await restore() }
  })

  it('serves both providers when the config predates the switch', async () => {    // Opt-out semantics: a config with no `enabled` key at all keeps the old
    // behaviour, so upgrading the plugin never silently removes a provider.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx, { regions: { cn: { lastCatalog: [], enabledModelIds: [], imageModelIds: [], contextBudgets: {} } } })
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')
      expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toEqual(['trae', 'trae-global'])
    } finally { await restore() }
  })
})

describe('built-in fallback is a safety net, not a filter target', () => {
  it('serves every built-in fallback model when discovery yields nothing', async () => {
    // A machine with no Trae credentials (or a startup discovery failure) must
    // still expose the plugin's own fallback catalog. Regression guard: the
    // fallback list used to be run through the live-wire filter, so a *partial*
    // live catalog (a subset of ids) deleted every fallback model it did not
    // mention, leaving the plugin serving almost nothing on real installs.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

      const ids = (await ctx.llm.listModels('trae')).map(model => model.id)
      for (const fallback of ['DeepSeek-V4-Flash-Official', 'DeepSeek-V4-Pro-Official', 'glm-5.2', 'kimi-k2.6']) {
        expect(ids).toContain(fallback)
      }
    } finally { await restore() }
  })
})

describe('per-region model slots', () => {
  it('an explicit regions.cn slot wins over the deprecated flat fields', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

      // Both shapes present: the explicit slot must be what the runtime serves.
      // (The flat `lastCatalog` field is non-volatile, so only the `regions.cn`
      // slot is written — which is exactly the 0.1.7 write gate.)
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
        regions: {
          cn: {
            lastCatalog: [
              { id: 'kimi-k2.6', name: 'Kimi-K2.6', input: ['text'] },
              { id: 'glm-5.2', name: 'GLM-5.2', input: ['text'] },
            ],
            enabledModelIds: ['kimi-k2.6'],
          },
        },
      })

      const ids = (await ctx.llm.listModels('trae')).map(model => model.id)
      expect(ids).toContain('kimi-k2.6')
      // The flat-field-only selection is gone: the slot owns the runtime catalog.
      expect(ids).not.toContain('DeepSeek-V4-Flash')
    } finally { await restore() }
  })

  it('an ai slot feeds the international provider only, never the CN runtime', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')

      // An international directory saved into the ai slot: it is the
      // international provider's own state, so that provider serves it — while
      // the CN provider keeps serving the CN roster and never the ai one.
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
        regions: {
          ai: {
            lastCatalog: [
              { id: 'gemini-3.1-pro', name: 'Gemini-3.1-Pro-Preview', input: ['text'] },
              { id: 'gpt-5.4', name: 'GPT-5.4', input: ['text'] },
            ],
            enabledModelIds: ['gpt-5.4'],
          },
        },
      })

      const globalIds = (await ctx.llm.listModels('trae-global')).map(model => model.id)
      expect(globalIds).toContain('gpt-5.4')
      // The CN provider is untouched by the international slot's save.
      const cnIds = (await ctx.llm.listModels('trae')).map(model => model.id)
      expect(cnIds).not.toContain('gemini-3.1-pro')
      expect(cnIds).not.toContain('gpt-5.4')
      for (const fallback of ['DeepSeek-V4-Flash-Official', 'glm-5.2']) {
        expect(cnIds).toContain(fallback)
      }
    } finally { await restore() }
  })

  it('a CN-slot save leaves the international provider untouched', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')

      // The CN tab's save writes regions.cn (the flat fields stand in for a
      // pre-split CN config); that must never reach the international provider.
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
        regions: {
          cn: {
            lastCatalog: [{ id: 'kimi-k2.6', name: 'Kimi-K2.6', input: ['text'] }],
            enabledModelIds: ['kimi-k2.6'],
          },
        },
      })

      const cnIds = (await ctx.llm.listModels('trae')).map(model => model.id)
      expect(cnIds).toContain('kimi-k2.6')
      const globalIds = (await ctx.llm.listModels('trae-global')).map(model => model.id)
      expect(globalIds).not.toContain('kimi-k2.6')
    } finally { await restore() }
  })

  it('applies the image opt-in per region without cross-contamination', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae-global')

      // The image opt-in is CN-only state, written into the volatile
      // `regions.cn` slot (0.1.7 write gate).
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { regions: { cn: { imageModelIds: ['DeepSeek-V4-Pro-Official'] } } })

      const cnModels = await ctx.llm.listModels('trae')
      expect(cnModels.find(model => model.id === 'DeepSeek-V4-Pro-Official')?.inputModalities).toEqual(['text', 'image'])
      // The international provider's own directory carries no such opt-in.
      const globalModels = await ctx.llm.listModels('trae-global')
      expect(globalModels.find(model => model.id === 'DeepSeek-V4-Pro-Official')?.inputModalities ?? []).not.toContain('image')
    } finally { await restore() }
  })
})

describe('settingsNamespaceOf', () => {
  it('uses the Loader entry id when the host provides one', () => {
    expect(Trae.settingsNamespaceOf({ fiber: { entry: { options: { id: 'include:dsh-connect-trae' } } } }))
      .toBe('include:dsh-connect-trae')
  })

  it('falls back to the declared namespace when there is no Loader entry', () => {
    // A bare `ctx.plugin()` mount (as every test here does), or a host that
    // does not expose the entry.
    expect(Trae.settingsNamespaceOf({})).toBe(Trae.TRAE_SETTINGS_NS)
    expect(Trae.settingsNamespaceOf({ fiber: {} })).toBe(Trae.TRAE_SETTINGS_NS)
    expect(Trae.settingsNamespaceOf({ fiber: { entry: { options: {} } } })).toBe(Trae.TRAE_SETTINGS_NS)
  })

  it('never returns an empty or non-string id', () => {
    // An empty id would be a namespace nothing can address.
    expect(Trae.settingsNamespaceOf({ fiber: { entry: { options: { id: '' } } } }))
      .toBe(Trae.TRAE_SETTINGS_NS)
    expect(Trae.settingsNamespaceOf({ fiber: { entry: { options: { id: 42 } } } }))
      .toBe(Trae.TRAE_SETTINGS_NS)
  })

  it('advertises the resolved namespace to the provider directory, not the constant', async () => {
    // The regression this guards: the directory named `trae` while the host
    // served `include:...` made the lookup miss and the provider read as
    // unconfigured (workbuddy 2.0.16). `ctx.plugin` has no Loader entry, so
    // the fallback applies — the point is that whatever the host serves is
    // what gets advertised.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    const restore = await isolatedPlugin(ctx)
    try {
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      // Both regional entries must advertise the resolved namespace — asserting
      // the constant would pass either way, asserting the resolved value is the
      // point (the directory is what the harness looks up by EXACT match).
      await expect.poll(() => {
        const entries = ctx.llm.listConfigurableProviders()
        return entries.length === 2 && entries.every(entry => entry.settingsNs === Trae.settingsNamespaceOf(ctx))
      }).toBe(true)
    } finally { await restore() }
  })
})
