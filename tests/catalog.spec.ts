import { describe, expect, it } from 'vitest'
import type { TraeDiscoveredModel } from '../src/model-metadata.ts'
import {
  applyContextBudgets,
  applyImageSelection,
  deriveCatalog,
  discoveredCatalog,
  FALLBACK_TRAE_MODELS,
  mergeTraeModelSources,
  sanitizeCatalog,
  TraeCatalog,
  traeInputModalities,
  traeModelDisplayName,
} from '../src/catalog.ts'

const RAW = discoveredCatalog([{
  id: 'qwen3.8-max', name: 'Qwen3.8-Max', multimodal: true,
  contextWindow: 200_000, maxContextWindow: 1_000_000, creditMultiplier: 1.5,
  reasoningSupported: true,
  reasoning: { supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' },
}, {
  id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', multimodal: false,
  contextWindow: 200_000, reasoningSupported: false,
}])

describe('Trae catalog', () => {
  it('starts with identity-only fallback entries that default to text-only', () => {
    const catalog = new TraeCatalog()
    expect(catalog.current()).toEqual(FALLBACK_TRAE_MODELS)
    expect(catalog.current().some(model => model.id === 'DeepSeek-V4-Flash')).toBe(true)
    expect(catalog.current().every(model => model.contextWindow === undefined)).toBe(true)
    expect(traeInputModalities(FALLBACK_TRAE_MODELS.find(model => model.id === 'glm-5.2')!)).toEqual(['text'])
    expect(traeInputModalities(FALLBACK_TRAE_MODELS.find(model => model.id === 'kimi-k3')!)).toEqual(['text'])
    expect(traeInputModalities(FALLBACK_TRAE_MODELS.find(model => model.id === 'DeepSeek-V4-Pro')!)).toEqual(['text'])
  })

  it('carries only models the TraeCode forwarding path accepts', () => {
    // `auto` is a TraeWork-only entry: the TraeCode wire catalog omits it and
    // `chat_v3` rejects it with 4001, so it must not be offered as a bootstrap
    // default on a machine that has no fetched catalog yet.
    expect(FALLBACK_TRAE_MODELS.some(model => model.id === 'auto')).toBe(false)
  })

  it('ignores uncertain upstream multimodal flags and keeps one text-only entry per model', () => {
    expect(RAW).toEqual([
      expect.objectContaining({
        id: 'qwen3.8-max', contextWindow: 200_000, maxContextWindow: 1_000_000,
        creditMultiplier: 1.5, input: ['text'],
      }),
      expect.objectContaining({ id: 'deepseek-v4-pro', contextWindow: 200_000, input: ['text'] }),
    ])
    expect(RAW.some(model => model.id.includes('@1m'))).toBe(false)
  })

  it('uses only explicit image opt-ins and overwrites stale saved modalities', () => {
    const stale = RAW.map(model => ({ ...model, input: ['text', 'image'] as ('text' | 'image')[] }))
    expect(applyImageSelection(stale, new Set(['qwen3.8-max']))).toEqual([
      expect.objectContaining({ id: 'qwen3.8-max', input: ['text', 'image'] }),
      expect.objectContaining({ id: 'deepseek-v4-pro', input: ['text'] }),
    ])
    expect(applyImageSelection(stale, new Set()).every(model => model.input?.join(',') === 'text')).toBe(true)
  })

  it('serves the whole directory when nothing is enabled yet', () => {
    expect(deriveCatalog(RAW, new Set()).map(model => model.id)).toEqual([
      'qwen3.8-max',
      'deepseek-v4-pro',
    ])
  })

  it('applies the advertised Max budget without creating a variant model', () => {
    const derived = deriveCatalog(
      RAW,
      new Set(['qwen3.8-max']),
      { 'qwen3.8-max': 1_000_000 },
    )
    expect(derived).toEqual([
      expect.objectContaining({
        id: 'qwen3.8-max', contextWindow: 1_000_000,
        maxContextWindow: 1_000_000, input: ['text'],
      }),
    ])
    expect(derived.some(model => model.id.includes('@1m'))).toBe(false)
    expect(applyContextBudgets(RAW, { 'qwen3.8-max': 999_999 })[0]?.contextWindow).toBe(200_000)
  })

  it('drops legacy variant rows and rejects replacing the live catalog with an empty list', () => {
    const legacy = [
      RAW[0]!,
      { ...RAW[0]!, id: 'qwen3.8-max@1m', contextWindow: 1_000_000, baseModelId: 'qwen3.8-max', maxContext: true },
    ]
    expect(sanitizeCatalog(legacy).map(model => model.id)).toEqual(['qwen3.8-max'])
    expect(() => new TraeCatalog().set([])).toThrow(/cannot be empty/)
  })
})

describe('traeModelDisplayName', () => {
  it('embeds the credit multiplier into the DSH-facing name like Trae own model picker', () => {
    expect(traeModelDisplayName({ name: 'GLM-5.3', creditMultiplier: 0.79 })).toBe('GLM-5.3 · x0.79')
    expect(traeModelDisplayName({ name: 'Hy4 preview', creditMultiplier: 0 })).toBe('Hy4 preview · x0.00')
    expect(traeModelDisplayName({ name: 'Seed-Evolving', creditMultiplier: 0.77 })).toBe('Seed-Evolving · x0.77')
  })

  it('keeps the pure name when Trae advertises no multiplier', () => {
    expect(traeModelDisplayName({ name: 'GLM-5.3' })).toBe('GLM-5.3')
  })
})

describe('mergeTraeModelSources', () => {
  it('enumerates the wire catalog and enriches each row from the remote directory', () => {
    const remote: TraeDiscoveredModel[] = [
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', multimodal: true, contextWindow: 128_000, maxContextWindow: 256_000, creditMultiplier: 1.5, reasoningSupported: true, reasoning: { supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' } },
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, contextWindow: 168_000, reasoningSupported: false },
    ]
    const wire = [
      { id: 'Doubao-Seed-Code', name: 'Seed-Code' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    // The wire config_name is the id, so no display→wire translation is needed.
    expect(merged.map(model => model.id)).toEqual(['Doubao-Seed-Code', 'glm-5.2'])
    expect(merged[0]).toMatchObject({
      id: 'Doubao-Seed-Code',
      name: 'Seed-Code',
      contextWindow: 128_000,
      maxContextWindow: 256_000,
      creditMultiplier: 1.5,
      input: ['text'],
    })
    // Reasoning comes from the remote skeleton, mapped to Trae wire effort strings.
    expect(merged[0]?.reasoningEfforts).toEqual({ low: 'light', high: 'high', xhigh: 'extra_high' })
    // A wire row whose id equals its display name needs no wireConfigName.
    expect(merged[1]).toMatchObject({ id: 'glm-5.2', name: 'GLM-5.2', input: ['text'] })
    expect(merged[1]?.wireConfigName).toBeUndefined()
  })

  it('keeps every wire-callable row even when Remote never advertises it', () => {
    // The live TraeCode account exposes callable config_names the Remote
    // directory omits entirely (glm-4.7, glm-4.6, kimi-k2, qwen-3.5,
    // minimax-m2, qwen3-coder). Enumerating wire — not Remote — is what makes
    // those reachable; a remote-first merge silently dropped them.
    const remote: TraeDiscoveredModel[] = [
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
    ]
    const wire = [
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'glm-4.7', name: 'GLM-4.7' },
      { id: 'qwen-3.5', name: 'Qwen3.5-Plus' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['glm-5.2', 'glm-4.7', 'qwen-3.5'])
    // Remote knows nothing of glm-4.7, so its display name falls back to the
    // wire name — still a coherent row, and still callable.
    expect(merged[1]).toMatchObject({ id: 'glm-4.7', name: 'GLM-4.7' })
  })

  it('excludes Remote rows that are not current wire config_names (uncallable → would 4001)', () => {
    // Doubao-Seed-Evolving, glm-5.3, qwen3.8-max, kimi-k2.8-preview and
    // glm-5.3-flash are all advertised by the Remote TraeCode group yet absent
    // from get_detail_param; every one of them answers 4001 "param is
    // invalid". Serving them produced a list the forwarding call rejects.
    const remote: TraeDiscoveredModel[] = [
      { id: 'Doubao-Seed-Evolving', name: 'Seed-Evolving', multimodal: true, reasoningSupported: true },
      { id: 'glm-5.3', name: 'GLM-5.3', multimodal: false, reasoningSupported: false },
      { id: 'qwen3.8-max', name: 'Qwen3.8-Max', multimodal: false, reasoningSupported: false },
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
    ]
    const wire = [{ id: 'glm-5.2', name: 'GLM-5.2' }]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['glm-5.2'])
  })
})
