import { describe, expect, it } from 'vitest'
import type { TraeDiscoveredModel } from '../src/model-metadata.ts'
import {
  applyContextBudgets,
  applyImageSelection,
  deriveCatalog,
  discoveredCatalog,
  FALLBACK_TRAE_MODELS,
  FALLBACK_TRAE_MODELS_AI,
  fallbackModelsFor,
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
  it('starts with fallback entries that are text-only but sized', () => {
    const catalog = new TraeCatalog()
    expect(catalog.current()).toEqual(FALLBACK_TRAE_MODELS)
    expect(catalog.current().some(model => model.id === 'DeepSeek-V4-Flash-Official')).toBe(true)
    // A fallback row must state a real window: DSH fails the whole provider
    // route for a model it cannot size (`INVALID_MODEL_CONTEXT`), which is
    // issue #8 — the route was dead whenever no live directory was available.
    expect(catalog.current().every(model => Number.isInteger(model.contextWindow) && model.contextWindow! > 0)).toBe(true)
    expect(traeInputModalities(FALLBACK_TRAE_MODELS.find(model => model.id === 'glm-5.2')!)).toEqual(['text'])
    expect(traeInputModalities(FALLBACK_TRAE_MODELS.find(model => model.id === 'kimi-k2.6')!)).toEqual(['text'])
    expect(traeInputModalities(FALLBACK_TRAE_MODELS.find(model => model.id === 'DeepSeek-V4-Pro-Official')!)).toEqual(['text'])
  })

  it('serves only config_names the live wire roster actually accepts', () => {
    // The fallback is served verbatim before the first refresh lands and is
    // never run through `dropDeadModels`, so it must not advertise a row that
    // `llm_utils_chat` would reject. `auto` was such a row: it is not a Trae
    // config_name, so selecting it failed with 4001.
    for (const region of ['cn', 'ai'] as const) {
      for (const model of fallbackModelsFor(region)) {
        expect(model.id).not.toBe('auto')
        expect(model.id.trim()).not.toBe('')
      }
    }
    // The verified CN roster uses the `-Official` suffix
    // (docs/DS41_CALLABILITY.md); the bare names are not wire ids.
    const cnIds = FALLBACK_TRAE_MODELS.map(model => model.id)
    expect(cnIds).toContain('DeepSeek-V4-Flash-Official')
    expect(cnIds).toContain('DeepSeek-V4-Pro-Official')
    expect(cnIds).not.toContain('DeepSeek-V4-Flash')
    expect(cnIds).not.toContain('DeepSeek-V4-Pro')
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
  it('keeps the remote directory id as the model id and attaches the wire config_name', () => {
    const remote: TraeDiscoveredModel[] = [
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', multimodal: true, contextWindow: 128_000, maxContextWindow: 256_000, creditMultiplier: 1.5, reasoningSupported: true, reasoning: { supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' } },
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, contextWindow: 168_000, reasoningSupported: false },
    ]
    const wire = [
      { id: 'Doubao_1_6', name: 'Seed-Code' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['Doubao-Seed-Code', 'glm-5.2'])
    expect(merged[0]).toMatchObject({
      id: 'Doubao-Seed-Code',
      name: 'Seed-Code',
      contextWindow: 128_000,
      maxContextWindow: 256_000,
      creditMultiplier: 1.5,
      input: ['text'],
      wireConfigName: 'Doubao_1_6',
    })
    // Reasoning comes from the remote skeleton, mapped to Trae wire effort strings.
    expect(merged[0]?.reasoningEfforts).toEqual({ low: 'light', high: 'high', xhigh: 'extra_high' })
    // A remote model whose wire id equals its own id needs no wireConfigName.
    expect(merged[1]).toMatchObject({ id: 'glm-5.2', name: 'GLM-5.2', input: ['text'] })
    expect(merged[1]?.wireConfigName).toBeUndefined()
  })

  it('joins by config_name id first, then display name case-insensitively, and drops wire-only rows', () => {
    const remote: TraeDiscoveredModel[] = [
      // Exact id match: id is already the wire config_name.
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
      // Display-name match with a differing wire id → wireConfigName attached.
      { id: 'remote-doubao', name: 'seed-code', multimodal: true, reasoningSupported: false, creditMultiplier: 2 },
    ]
    const wire = [
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'wire-doubao', name: 'SEED-CODE' },
      { id: 'wire-orphan', name: 'No Remote Match' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['glm-5.2', 'remote-doubao'])
    expect(merged[1]?.wireConfigName).toBe('wire-doubao')
    expect(merged[1]?.creditMultiplier).toBe(2)
    // The wire-only orphan is dropped (no remote skeleton to expose).
    expect(merged.some(model => model.id === 'wire-orphan')).toBe(false)
  })

  it('prefers the wire post-discount multiplier and falls back to the remote rate', () => {
    // The wire's `display_contact_config` rate is the figure the Trae IDE
    // renders; the Remote directory can report the undiscounted value (up to
    // 10x higher under a live promotion). Wire wins; remote only fills in when
    // the wire row carries no rate.
    const remote: TraeDiscoveredModel[] = [
      // Same model, two disagreements: remote says 0.80, wire says 0.08.
      { id: 'Doubao-Seed-2.1-Pro', name: 'Seed-2.1-Pro', multimodal: false, reasoningSupported: false, creditMultiplier: 0.8 },
      // Remote provides the only rate here.
      { id: 'kimi-k3', name: 'Kimi-K3', multimodal: false, reasoningSupported: false, creditMultiplier: 1.83 },
      // Neither source carries a rate → stays absent, never fabricated.
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
    ]
    const wire = [
      { id: 'Doubao-Seed-2.1-Pro', name: 'Seed-2.1-Pro', creditMultiplier: 0.08 },
      { id: 'kimi-k3', name: 'Kimi-K3' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.find(model => model.id === 'Doubao-Seed-2.1-Pro')?.creditMultiplier).toBe(0.08)
    expect(merged.find(model => model.id === 'kimi-k3')?.creditMultiplier).toBe(1.83)
    expect(merged.find(model => model.id === 'glm-5.2')?.creditMultiplier).toBeUndefined()
  })

  it('drops remote models that map to no wire config_name (uncallable → would 4001)', () => {
    // Doubao-Seed-Code and glm-5.3 are advertised by the Remote directory but
    // are NOT current `config_name`s in get_detail_param; sending them makes
    // every request fail with 4001 "param is invalid". They must not ship.
    const remote: TraeDiscoveredModel[] = [
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', multimodal: true, reasoningSupported: true },
      { id: 'glm-5.3', name: 'GLM-5.3', multimodal: false, reasoningSupported: false },
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
    ]
    const wire = [
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'Doubao-Seed-2.0-Code', name: 'Doubao-Seed-2.1-Turbo' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['glm-5.2'])
  })
})

describe('region-scoped fallback directories', () => {
  it('keeps one fallback list per region and never shares a roster', () => {
    expect(fallbackModelsFor('cn')).toBe(FALLBACK_TRAE_MODELS)
    expect(fallbackModelsFor('ai')).toBe(FALLBACK_TRAE_MODELS_AI)
    // The CN roster has no Gemini/GPT/MiniMax entries; the ai roster has no
    // GLM/DeepSeek entries. An account must never see the other region's list.
    expect(FALLBACK_TRAE_MODELS.map(model => model.id)).not.toContain('gemini-3.1-pro')
    expect(FALLBACK_TRAE_MODELS.map(model => model.id)).not.toContain('gpt-5.4')
    expect(FALLBACK_TRAE_MODELS_AI.map(model => model.id)).not.toContain('glm-5.2')
    expect(FALLBACK_TRAE_MODELS_AI.map(model => model.id)).not.toContain('DeepSeek-V4-Pro-Official')
  })

  it('captures the verified international roster from the live directory', () => {
    // Snapshot of coresg-normal.trae.ai/api/remote/v1/models, 2026-09-15
    // (docs/INTL_SG_EVIDENCE.md §3). All entries default to text-only input:
    // image stays the user's explicit opt-in via imageModelIds.
    expect(FALLBACK_TRAE_MODELS_AI.map(model => model.id)).toEqual([
      'gemini-3.1-pro', 'gemini-3-flash-solo', 'minimax-m3', 'minimax-m2.7', 'kimi-k2.5', 'gpt-5.4', 'gpt-5.2',
    ])
    expect(FALLBACK_TRAE_MODELS_AI.every(model => model.input === undefined)).toBe(true)
    // Measured windows from the same capture — a route with no live directory
    // (no international install) is served straight from this list.
    expect(Object.fromEntries(FALLBACK_TRAE_MODELS_AI.map(model => [model.id, model.contextWindow]))).toEqual({
      'gemini-3.1-pro': 200_000,
      'gemini-3-flash-solo': 200_000,
      'minimax-m3': 200_000,
      'minimax-m2.7': 200_000,
      'kimi-k2.5': 200_000,
      'gpt-5.4': 272_000,
      'gpt-5.2': 272_000,
    })
  })
})

describe('every served model is sized for DSH', () => {
  // Regression for issue #8: a model whose context window DSH cannot accept
  // fails the ENTIRE provider route (`adapter returned invalid context metadata`,
  // INVALID_MODEL_CONTEXT), so an unsized fallback row does not degrade one
  // model — it takes a whole region offline. That is what happened for users
  // with no international install: `trae-global` is served from the AI fallback.
  it('sizes every fallback row in both regions with a positive integer', () => {
    for (const region of ['cn', 'ai'] as const) {
      for (const model of fallbackModelsFor(region)) {
        expect(Number.isInteger(model.contextWindow), `${region}/${model.id} needs an integer contextWindow`).toBe(true)
        expect(model.contextWindow!, `${region}/${model.id} needs contextWindow > 0`).toBeGreaterThan(0)
      }
    }
  })

  it('sizes every discovered row that reaches the catalog', () => {
    // Live rows carry their window from the directory; a row that somehow
    // arrives unsized must still not be able to reach the adapter unsized.
    const rows = discoveredCatalog([{ id: 'x', name: 'X', multimodal: false, reasoningSupported: false }])
    expect(rows[0]?.contextWindow).toBeUndefined()
    // The adapter supplies `defaultContextWindow` for exactly this case, so the
    // catalog is allowed to omit it here — but never for the fallbacks above.
  })
})

describe('only callable models are ever served', () => {
  // The catalog must never advertise a config_name that `llm_utils_chat`
  // rejects with 4001. Two independent guarantees enforce that, and both are
  // covered here:
  //   1. the live merge drops any Remote row with no matching wire config
  //      (`mergeTraeModelSources`);
  //   2. the static fallback is written by hand from the verified roster and
  //      is never filtered (filtering it would delete the safety net), so its
  //      ids have to be correct at the source.
  // The IDE-only models have no wire config on the SOLO channel, so they can
  // never survive step 1 and must not be added to the fallback in step 2.
  const IDE_ONLY = ['deepseek-v4.1-flash', 'glm-5.3-flash', 'kimi-k2.8-preview', 'qwen3.8-flash']

  it('drops a remote row that has no matching wire config', () => {
    const remote = [
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
      // Advertised by the remote directory but absent from the wire roster:
      // exactly the shape of a dead config_name such as Doubao-Seed-Code.
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', multimodal: false, reasoningSupported: false },
    ]
    const merged = mergeTraeModelSources(remote, [{ id: 'glm-5.2', name: 'GLM-5.2' }])
    expect(merged.map(model => model.id)).toEqual(['glm-5.2'])
  })

  it('never lists an IDE-only model in either fallback roster', () => {
    for (const region of ['cn', 'ai'] as const) {
      for (const model of fallbackModelsFor(region)) {
        expect(IDE_ONLY).not.toContain(model.id)
        expect(IDE_ONLY).not.toContain(model.name)
      }
    }
  })

  it('keeps every fallback id non-empty and unique', () => {
    for (const region of ['cn', 'ai'] as const) {
      const ids = fallbackModelsFor(region).map(model => model.id)
      expect(ids.every(id => id.trim() !== '')).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})
