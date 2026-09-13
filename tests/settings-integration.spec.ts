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
    // `auto` resolves a CN credential first, and the Trae CN client follows the
    // Remote directory — which lists `DeepSeek-V4-Pro 正式版` (id
    // `DeepSeek-V4-Pro-Official`) rather than the bare wire-only ids.
    expect(models.map(model => model.id)).toContain('DeepSeek-V4-Pro-Official')
    expect(models.map(model => model.id)).toContain('glm-5.2')
    expect(models.find(model => model.id === 'glm-5.2')?.inputModalities).toEqual(['text'])
    expect(models.find(model => model.id === 'kimi-k3')?.inputModalities).toEqual(['text'])
    expect(models.find(model => model.id === 'DeepSeek-V4-Pro-Official')?.inputModalities).toEqual(['text'])
  })

  it('applies the explicit image opt-in to the live adapter catalog', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Trae, { edition: 'auto' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')

    await ctx.settings.update(Trae.TRAE_SETTINGS_NS, { imageModelIds: ['DeepSeek-V4-Pro-Official'] })

    const models = await ctx.llm.listModels('trae')
    expect(models.find(model => model.id === 'DeepSeek-V4-Pro-Official')?.inputModalities).toEqual(['text', 'image'])
    expect(models.find(model => model.id === 'DeepSeek-V4-Flash-Official')?.inputModalities).toEqual(['text'])
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

    const chosen = ['DeepSeek-V4-Flash-Official', 'DeepSeek-V4-Pro-Official']
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
    //
    // The network is forced offline so discovery genuinely yields nothing —
    // otherwise this machine's live directory would be served and the fallback
    // path would never run.
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
    try {
      const ctx = new Context()
      context = ctx
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(MemorySettings)
      await ctx.plugin(Trae, { edition: 'auto' })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await new Promise(resolve => setTimeout(resolve, 2000))

      const ids = (await ctx.llm.listModels('trae')).map(model => model.id)
      // Every fallback id must be one the TraeCode forwarding path accepts, so
      // the safety net can never hand the user an uncallable default.
      for (const fallback of FALLBACK_TRAE_MODELS.map(model => model.id)) {
        expect(ids).toContain(fallback)
      }
    } finally {
      globalThis.fetch = realFetch
    }
  }, 30_000)
})

describe('startup discovery installs the live catalog', () => {
  it('does not let the settings-derived list overwrite a discovered catalog', async () => {
    // Regression guard: startup ran discovery and then unconditionally replaced
    // the result with `configuredModels(current())`. On a fresh config (no
    // saved `lastCatalog`) that is the built-in fallback list, so every
    // discovered model was discarded at boot and the plugin served only the 5
    // hard-coded defaults.
    //
    // The previous version of this test asserted
    // `FALLBACK.some(id) || id.length > 0`, which is true for every non-empty
    // id — a tautology. Fetch is now stubbed with a directory whose id is
    // deliberately NOT a fallback id, so serving it proves the discovered
    // catalog was installed.
    //
    // Honest limitation: re-introducing the literal clobber no longer fails
    // this test, because the clobber is now unreachable — `configuredModels`
    // reads the live directory first (`pickRaw` -> `liveCatalog`), so calling
    // it here returns the discovered rows rather than the fallback list. The
    // assertion below therefore guards the OUTCOME (discovered data is served)
    // rather than that one line; the line was removed because it became dead,
    // not because this test caught it.
    const DISCOVERED_ONLY = 'zz-synthetic-discovery-only-model'
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/models') && url.includes('trae')) {
        return new Response(JSON.stringify({ code: 0, data: { list: [{ function: 'chat_v3', models: [
          { name: DISCOVERED_ONLY, display_name: 'Synthetic Discovery Model', context_window_tokens: { dev: 200000, max: 0 }, max_mode: false },
        ] }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('get_detail_param')) {
        return new Response(JSON.stringify({ config_info_list: [{
          config_name: DISCOVERED_ONLY, display_config: { display_name: 'Synthetic Discovery Model' },
          context_window_tokens: { dev: 200000 },
          model_detail_list: [{ model_name: 'x', prompt_max_tokens: 100000, max_tokens: 16000 }],
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      const ctx = new Context()
      context = ctx
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(MemorySettings)
      await ctx.plugin(Trae, { edition: 'auto' })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await new Promise(resolve => setTimeout(resolve, 3000))

      const ids = (await ctx.llm.listModels('trae')).map(model => model.id)
      // The discovered catalog is served...
      expect(ids).toContain(DISCOVERED_ONLY)
      // ...and was not replaced by the settings-derived fallback list.
      expect(ids).not.toEqual(FALLBACK_TRAE_MODELS.map(model => model.id))
    } finally {
      globalThis.fetch = realFetch
    }
  }, 30_000)
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
      // No explicit selection: an empty selection serves the whole directory, so
      // the served list IS the directory and this test can observe it being
      // replaced. (With a selection saved, the served list is correctly narrowed
      // to it, and would rightly stay put.)
      await ctx.plugin(Trae, { edition: 'auto', lastCatalog: STALE_SNAPSHOT })
      await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
      await new Promise(resolve => setTimeout(resolve, 2500))
      // Confirm the starting point really is the stale snapshot, so the test
      // cannot pass vacuously on a build that never served it.
      expect((await ctx.llm.listModels('trae')).map(model => model.name)).toContain('GLM-5.2 · x9.99')

      // The network returns and the user touches any setting.
      net.online()
      await ctx.settings.update(Trae.TRAE_SETTINGS_NS, {
        lastCatalog: STALE_SNAPSHOT,
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
      expect(served.map(model => model.id)).toContain('glm-5.2')
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
        { id: 'glm-5.2', name: 'GLM-5.2', input: ['text'], creditMultiplier: 0.78 },
        { id: 'DeepSeek-V4-Pro-Official', name: 'DeepSeek-V4-Pro 正式版', input: ['text'], creditMultiplier: 0.72 },
      ],
      enabledModelIds: ['glm-5.2'],
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
    expect(served).toEqual(['glm-5.2'])
    expect(served).not.toContain('kimi-k2.8-preview')
  }, 60_000)
})

describe('the user selection governs every advertised list', () => {
  // Regression guard for the reported symptom: two models checked in the card,
  // but nearly the whole directory served. Two independent paths published the
  // raw directory and ignored `enabledModelIds` — `discoverModels`'s
  // `catalog.set`, and the `registerModelDiscovery` callback, which re-fetched
  // the directory and returned it unfiltered. Model management reads the
  // discovery channel, so the selection has to be applied there too.
  it('serves and advertises exactly the checked models', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    // Capture the discovery callback the plugin registers. It is a SEPARATE
    // path from the served catalog and is what model management reads, so the
    // test must invoke it rather than infer it from `listModels`.
    const llm = ctx.llm as unknown as {
      registerModelDiscovery: (ns: string, cb: (request: { provider: string }, signal?: AbortSignal) => Promise<{ id: string }[]>) => () => void
    }
    const realRegister = llm.registerModelDiscovery.bind(llm)
    let captured: ((request: { provider: string }, signal?: AbortSignal) => Promise<{ id: string }[]>) | undefined
    llm.registerModelDiscovery = (ns, cb) => { captured = cb; return realRegister(ns, cb) }

    await ctx.plugin(Trae, {
      edition: 'cn',
      enabledModelIds: ['glm-5.2', 'DeepSeek-V4-Pro-Official'],
    })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
    await new Promise(resolve => setTimeout(resolve, 3000))

    const served = (await ctx.llm.listModels('trae')).map(model => model.id).sort()
    expect(served).toEqual(['DeepSeek-V4-Pro-Official', 'glm-5.2'])

    // The advertised list must be the same selected subset — publishing the raw
    // directory here is the bug this guards.
    expect(captured).toBeDefined()
    const advertised = (await captured!({ provider: 'trae' })).map(model => model.id).sort()
    expect(advertised).toEqual(['DeepSeek-V4-Pro-Official', 'glm-5.2'])
  }, 60_000)
})

describe('the resolved client, not the setting alone, picks the directory', () => {
  // Regression guard: `discoverModels` derived the directory from a hard-coded
  // `active === 'solo' ? 'remote' : traeModelSourceMode(edition)`, so a solo
  // credential always got the Remote directory and the setting was read but
  // discarded. `traeModelSourceMode('solo') === 'wire'` was unreachable, making
  // the whole solo path dead code.
  it('a solo account serves the wire directory its client shows', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettings)
    // A real solo account, so `slotOfCredential` resolves the solo slot.
    await ctx.plugin(Trae, { edition: 'solo', accountId: 'cbec9cff4f4bed9b7f35685e' })
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
    await new Promise(resolve => setTimeout(resolve, 3000))

    const ids = (await ctx.llm.listModels('trae')).map(model => model.id)
    // Wire-only ids prove the wire directory was served...
    expect(ids).toContain('glm-4.7')
    expect(ids.some(id => id === 'kimi-k2-0905' || id === 'qwen3-coder')).toBe(true)
    // ...and Remote-only ids prove it was not.
    expect(ids).not.toContain('Doubao-Seed-Evolving')
    expect(ids).not.toContain('kimi-k2.8-preview')
  }, 60_000)
})
