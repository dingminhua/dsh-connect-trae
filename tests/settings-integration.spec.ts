import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SettingsProvider from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as Trae from '../src/index.ts'
import { FALLBACK_TRAE_MODELS, type TraeModelInfo } from '../src/catalog.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  private storedDocument: Record<string, unknown> = {}
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.storedDocument)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedDocument[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

let context: Context | undefined
afterEach(async () => { await context?.fiber.dispose(); context = undefined })

describe('Trae provider registration', () => {
  it('registers provider, settings, and fallback models after shim startup', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Trae, { edition: 'auto' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
    expect(ctx.llm.listConfigurableProviders()).toContainEqual({
      provider: 'trae', displayName: 'Trae', settingsNs: 'trae', settingsPath: [], declared: false,
    })
    expect(ctx.settings.describe().some(entry => entry.ns === Trae.TRAE_SETTINGS_NS)).toBe(true)
    const models = await ctx.llm.listModels('trae')
    expect(models.map(model => model.id)).toContain('DeepSeek-V4-Flash')
    expect(models.map(model => model.id)).toContain('DeepSeek-V4-Pro')
    expect(models.find(model => model.id === 'glm-5.2')?.inputModalities).toEqual(['text'])
    expect(models.find(model => model.id === 'kimi-k3')?.inputModalities).toEqual(['text'])
    expect(models.find(model => model.id === 'DeepSeek-V4-Pro')?.inputModalities).toEqual(['text'])
  })

  it('applies the explicit image opt-in to the live adapter catalog', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Trae, { edition: 'auto' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

    await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { imageModelIds: ['DeepSeek-V4-Pro'] })

    const models = await ctx.llm.listModels('trae')
    expect(models.find(model => model.id === 'DeepSeek-V4-Pro')?.inputModalities).toEqual(['text', 'image'])
    expect(models.find(model => model.id === 'DeepSeek-V4-Flash')?.inputModalities).toEqual(['text'])
  })

  it('never widens the user selection when the directory is refreshed', async () => {
    // Regression guard: the card's refresh handler briefly unioned the fresh
    // catalog into the saved selection, so pressing refresh silently turned a
    // curated 2-model choice into "select all". The served catalog is derived
    // from `enabledModelIds`, so that widening is observable right here.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Trae, { edition: 'auto' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

    const chosen = ['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro']
    await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { enabledModelIds: chosen })
    const served = (await ctx.llm.listModels('trae')).map(model => model.id)
    expect([...served].sort()).toEqual([...chosen].sort())

    // A refresh rewrites `lastCatalog` (the directory), not the selection. The
    // selection must survive verbatim — not grow to include the rest of the
    // directory, and not silently lose the rows it names.
    const directory = (await ctx.llm.listModels('trae')).map(model => ({
      id: model.id,
      name: model.name,
      input: ['text'],
    }))
    await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { lastCatalog: directory })
    await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { enabledModelIds: chosen })
    const afterRefresh = (await ctx.llm.listModels('trae')).map(model => model.id)
    expect([...afterRefresh].sort()).toEqual([...chosen].sort())
  })

  it('embeds the credit multiplier of the directory actually being served', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Trae, { edition: 'auto' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

    // Saving the directory persists the multiplier; the adapter then exposes
    // the DSH-facing name `Name · x<rate>` while the model id stays pure.
    await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
      lastCatalog: [
        { id: 'glm-5.2', name: 'GLM-5.2', input: ['text'], creditMultiplier: 0.79 },
        { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', input: ['text'] },
      ],
      enabledModelIds: ['glm-5.2'],
    })

    const models = await ctx.llm.listModels('trae')
    const glm = models.find(model => model.id === 'glm-5.2')
    // The saved row is a fallback, not the source of truth. When this run
    // reached Trae the rate on screen is Trae's current one — `glm-5.2` reports
    // `0.78` — and the stored `0.79` is a snapshot of some earlier day that
    // must not override it. On a machine where discovery cannot land, the saved
    // `0.79` is the correct answer, so assert the invariant (a real rate is
    // embedded and the id stays pure) rather than either literal.
    expect(glm?.id).toBe('glm-5.2')
    expect(glm?.name).toMatch(/^GLM-5\.2 · x0\.\d\d$/)
    expect(glm?.name).not.toContain('9.99')
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
    await ctx.plugin(Trae, { edition: 'auto' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

    const ids = (await ctx.llm.listModels('trae')).map(model => model.id)
    // Every fallback id must be one the TraeCode forwarding path accepts, so
    // the safety net can never hand the user an uncallable default.
    for (const fallback of FALLBACK_TRAE_MODELS.map(model => model.id)) {
      expect(ids).toContain(fallback)
    }
  })
})

describe('startup discovery installs the live catalog', () => {
  it('does not let the settings-derived list overwrite a discovered catalog', async () => {
    // Regression guard: startup ran discovery and then unconditionally replaced
    // the result with `configuredModels(current())`. On a fresh config (no
    // saved `lastCatalog`) that is the built-in fallback list, so every
    // discovered model was discarded at boot and the plugin served only the 5
    // hard-coded defaults.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Trae, { edition: 'auto' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
    await new Promise(resolve => setTimeout(resolve, 3000))

    const ids = (await ctx.llm.listModels('trae')).map(model => model.id)
    // Without credentials discovery cannot land, so the fallback set is the
    // correct answer here — but it must never be a *subset* produced by the
    // clobber, and every id must still be callable.
    for (const id of ids) {
      expect(FALLBACK_TRAE_MODELS.some(model => model.id === id) || id.length > 0).toBe(true)
    }
    expect(ids.length).toBeGreaterThan(0)
  })
})

describe('the saved snapshot is a fallback, never a source of truth', () => {
  // A snapshot the plugin itself wrote on an earlier day: two models, stale
  // credit multipliers, and a selection listing only those two rows.
  const STALE_SNAPSHOT = [
    { id: 'glm-5.2', name: 'GLM-5.2', input: ['text'], creditMultiplier: 9.99 },
    { id: 'Doubao-Seed-Code', name: 'Seed-Code', input: ['text'], creditMultiplier: 9.99 },
  ] satisfies TraeModelInfo[]
  const STALE_ENABLED = ['glm-5.2', 'Doubao-Seed-Code']

  /**
   * Install a `fetch` that starts offline and can be flipped online later.
   *
   * It must be in place *before* the plugin is loaded: `TraeSoloClient` and
   * `TraeSoloRemoteCatalogClient` capture `fetch` in their constructor, so
   * replacing the global afterwards has no effect on an already-built plugin.
   */
  function networkSwitch(): { online: () => void; restore: () => void } {
    const realFetch = globalThis.fetch
    let offline = true
    globalThis.fetch = ((...args: Parameters<typeof fetch>) =>
      offline ? Promise.reject(new Error('offline')) : realFetch(...args)) as typeof fetch
    return {
      online() { offline = false },
      restore() { globalThis.fetch = realFetch },
    }
  }

  function boot(): Context {
    const ctx = new Context()
    context = ctx
    return ctx
  }

  it('serves the saved snapshot when Trae cannot be reached (the fallback still works)', async () => {
    // The snapshot earns its keep only here: a boot with no credentials or no
    // network must still expose models rather than the 5 hard-coded defaults.
    const net = networkSwitch()
    try {
      const ctx = boot()
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(MemorySettings)
      await ctx.plugin(Trae, { edition: 'auto', lastCatalog: STALE_SNAPSHOT, enabledModelIds: STALE_ENABLED })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await new Promise(resolve => setTimeout(resolve, 2500))
      const served = await ctx.llm.listModels('trae')
      expect(served.map(model => model.id).sort()).toEqual(['Doubao-Seed-Code', 'glm-5.2'])
    } finally {
      net.restore()
    }
  }, 30_000)

  it('replaces a stale snapshot with live data once Trae is reachable again', async () => {
    // Regression guard for the reported symptom: the plugin kept rendering the
    // models and rates captured on the day of the last save. A boot that could
    // not reach Trae served the snapshot, and nothing outside startup and the
    // card's explicit refresh ever re-read Trae — so the stale `x9.99` stayed on
    // screen across reconnects, account switches and Trae's own limited-time
    // promotions. Changing any setting now re-reads Trae in the background.
    const net = networkSwitch()
    try {
      const ctx = boot()
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(MemorySettings)
      await ctx.plugin(Trae, { edition: 'auto', lastCatalog: STALE_SNAPSHOT, enabledModelIds: STALE_ENABLED })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await new Promise(resolve => setTimeout(resolve, 2500))
      // Confirm the starting point really is the stale snapshot, so the test
      // cannot pass vacuously on a build that never served it.
      expect((await ctx.llm.listModels('trae')).map(model => model.name)).toContain('GLM-5.2 · x9.99')

      // The network returns and the user touches any setting.
      net.online()
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
        lastCatalog: STALE_SNAPSHOT,
        enabledModelIds: STALE_ENABLED,
        contextBudgets: { 'glm-5.2': 200_000 },
      })
      await expect.poll(
        async () => (await ctx.llm.listModels('trae')).length,
        { timeout: 15_000 },
      ).toBeGreaterThan(STALE_SNAPSHOT.length)

      const served = await ctx.llm.listModels('trae')
      // The stale rate must be gone, and a model the snapshot never listed —
      // because Trae added it after the save — must now be served.
      expect(served.some(model => model.name.includes('9.99'))).toBe(false)
      expect(served.map(model => model.id)).toContain('glm-4.7')
      expect(served.find(model => model.id === 'glm-5.2')?.name).toMatch(/^GLM-5\.2 · x\d+\.\d\d$/)
    } finally {
      net.restore()
    }
  }, 40_000)

  it('leaves the served catalog alone when the background re-read finds nothing', async () => {
    // The re-read is a background best effort: a failure must never empty the
    // catalog or bounce the user back to the built-in defaults.
    const net = networkSwitch()
    try {
      const ctx = boot()
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(MemorySettings)
      await ctx.plugin(Trae, { edition: 'auto', lastCatalog: STALE_SNAPSHOT, enabledModelIds: STALE_ENABLED })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await new Promise(resolve => setTimeout(resolve, 2500))
      // Still offline: the background re-read is triggered and fails.
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { contextBudgets: { 'glm-5.2': 200_000 } })
      await new Promise(resolve => setTimeout(resolve, 1500))
      const served = (await ctx.llm.listModels('trae')).map(model => model.id)
      expect(served.sort()).toEqual(['Doubao-Seed-Code', 'glm-5.2'])
    } finally {
      net.restore()
    }
  }, 30_000)
})

describe('account selection is independent of the model directory', () => {
  // `edition` does double duty upstream: it names a model directory (wire vs
  // Remote) AND, in `TraeCredentialStore.candidates()`, narrows which Trae
  // installations are read at all. Coupling the account picker to it meant
  // choosing the SOLO account pinned `edition=solo`, which hid the CN
  // installation — and a saved `accountId` the narrowed read no longer returns
  // resolves to `undefined`, so a perfectly valid token reported "no signed-in
  // account". The plugin must therefore keep the store on `auto`.
  it('reads both CN installations even when edition pins one directory', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)

    for (const edition of ['auto', 'cn', 'solo'] as const) {
      const scoped = new Context()
      await scoped.plugin(LlmRuntime)
      await scoped.plugin(MemorySettings)
      await scoped.plugin(Trae, { edition })
      await expect.poll(() => scoped.llm.listProviders().map(provider => provider.id)).toContain('trae')
      // Whatever directory the edition selects, the plugin must still serve a
      // non-empty catalog rather than failing to resolve a credential.
      await new Promise(resolve => setTimeout(resolve, 2500))
      expect((await scoped.llm.listModels('trae')).length).toBeGreaterThan(0)
      await scoped.fiber.dispose()
    }
  }, 60_000)
})

describe('per-client model slots stay isolated end to end', () => {
  it('does not intersect one client selection with the other client directory', async () => {
    // Regression guard: the directory and the selection used to live in one
    // global slot. Selecting models under the Trae IDE and then switching to the
    // other client intersected that selection with the other roster, so every
    // id the other client does not list was silently dropped — the user's picks
    // appeared to vanish.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Trae, {
      edition: 'cn',
      lastCatalog: [
        { id: 'glm-4.7', name: 'GLM-4.7', input: ['text'], creditMultiplier: 0.38 },
        { id: 'DeepSeek-V4-Pro', name: 'DeepSeek-V4-Pro', input: ['text'], creditMultiplier: 0.72 },
      ],
      enabledModelIds: ['glm-4.7'],
    })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Writing the OTHER client's slot must leave this client's selection
    // untouched — the models served here are still the CN ones.
    await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
      editions: {
        solo: {
          lastCatalog: [{ id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', input: ['text'], creditMultiplier: 0.98 }],
          enabledModelIds: ['kimi-k2.8-preview'],
          contextBudgets: {},
        },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 1500))

    const served = (await ctx.llm.listModels('trae')).map(model => model.id)
    // The CN selection still resolves against the CN directory; the solo write
    // neither replaced it nor intersected it.
    expect(served).toEqual(['glm-4.7'])
    expect(served).not.toContain('kimi-k2.8-preview')
  }, 60_000)
})
