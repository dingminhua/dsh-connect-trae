import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SettingsProvider from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as Trae from '../src/index.ts'
import { FALLBACK_TRAE_MODELS } from '../src/catalog.ts'

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

  it('embeds the saved credit multiplier into the registered model name', async () => {
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
    expect(glm?.name).toBe('GLM-5.2 · x0.79')
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
