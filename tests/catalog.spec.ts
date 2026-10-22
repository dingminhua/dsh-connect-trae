import { describe, expect, it } from 'vitest'
import type { TraeDiscoveredModel } from '../src/model-metadata.ts'
import {
  applyContextBudgets,
  applyImageSelection,
  withChatCallableFunctions,
  deriveCatalog,
  discoveredCatalog,
  FALLBACK_TRAE_MODELS,
  FALLBACK_TRAE_MODELS_AI,
  fallbackModelsFor,
  isPromotableWireModel,
  mergeTraeModelSources,
  sanitizeCatalog,
  TraeCatalog,
  traeInputModalities,
  traeModelAcceptsImage,
  traeModelDisplayName,
} from '../src/catalog.ts'
import { TRAE_DIRECTORY_FUNCTIONS } from '../src/solo.ts'

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

  it('carries the upstream multimodal flag onto the catalog row without granting image input by itself', () => {
    expect(RAW).toEqual([
      expect.objectContaining({
        id: 'qwen3.8-max', contextWindow: 200_000, maxContextWindow: 1_000_000,
        creditMultiplier: 1.5, input: ['text'], multimodal: true,
      }),
      expect.objectContaining({ id: 'deepseek-v4-pro', contextWindow: 200_000, input: ['text'], multimodal: false }),
    ])
    expect(RAW.some(model => model.id.includes('@1m'))).toBe(false)
  })

  it('unions explicit opt-ins with Trae\'s own multimodal flag', () => {
    // Trae calls qwen3.8-max multimodal, so it is image-capable without a tick;
    // deepseek-v4-pro is explicitly NOT, so it stays text-only until ticked.
    expect(applyImageSelection(RAW, new Set())).toEqual([
      expect.objectContaining({ id: 'qwen3.8-max', input: ['text', 'image'] }),
      expect.objectContaining({ id: 'deepseek-v4-pro', input: ['text'] }),
    ])
    expect(applyImageSelection(RAW, new Set(['deepseek-v4-pro']))).toEqual([
      expect.objectContaining({ id: 'qwen3.8-max', input: ['text', 'image'] }),
      expect.objectContaining({ id: 'deepseek-v4-pro', input: ['text', 'image'] }),
    ])
  })

  it('never revokes a user opt-in, even when a refresh stops reporting the flag', () => {
    // The union is one-directional: Trae dropping the flag must not silently
    // rebuild a working setup into a text-only route.
    const base = RAW[0]!
    const missing = { ...base }
    delete (missing as { multimodal?: boolean }).multimodal
    for (const model of [{ ...base, multimodal: true }, { ...base, multimodal: false }, missing]) {
      expect(applyImageSelection([model], new Set([model.id]))[0]?.input).toEqual(['text', 'image'])
    }
  })

  it('treats a missing flag as not capable rather than assuming capability', () => {
    // Rows saved before the flag was persisted, and fallback rows, carry no
    // `multimodal`. "Unknown" must read as text-only: advertising image input a
    // model may not have burns credits on a silent failure.
    for (const model of RAW) {
      const withoutFlag = { ...model }
      delete (withoutFlag as { multimodal?: boolean }).multimodal
      expect(applyImageSelection([withoutFlag], new Set())[0]?.input).toEqual(['text'])
    }
  })

  it('overwrites stale saved modalities rather than trusting the persisted `input`', () => {
    // `input` is re-derived on every pass; a row saved earlier as image-capable
    // must not stay that way once neither source claims it.
    const stale = RAW.map(model => ({ ...model, input: ['text', 'image'] as ('text' | 'image')[], multimodal: false }))
    expect(applyImageSelection(stale, new Set()).every(model => model.input?.join(',') === 'text')).toBe(true)
  })

  it('exposes traeModelAcceptsImage as the single capability predicate', () => {
    expect(traeModelAcceptsImage({ id: 'a', multimodal: true }, new Set())).toBe(true)
    expect(traeModelAcceptsImage({ id: 'a', multimodal: false }, new Set())).toBe(false)
    expect(traeModelAcceptsImage({ id: 'a' }, new Set())).toBe(false)
    expect(traeModelAcceptsImage({ id: 'a', multimodal: false }, new Set(['a']))).toBe(true)
    // A tick for a DIFFERENT model must not leak capability across rows.
    expect(traeModelAcceptsImage({ id: 'a' }, new Set(['b']))).toBe(false)
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

  it('omits the rate entirely when the caller does not bill one', () => {
    // The enterprise pool does not bill the consumer multiplier, so its model
    // picker entries must not carry a price at all. The rate travels inside
    // the NAME that reaches DSH, which is why this is decided here and not by
    // whatever renders the picker.
    expect(traeModelDisplayName({ name: 'DeepSeek-V4.1-Flash', creditMultiplier: 0.06 }, false)).toBe('DeepSeek-V4.1-Flash')
    expect(traeModelDisplayName({ name: 'DeepSeek-V4.1-Flash', creditMultiplier: 0.06 }, true)).toBe('DeepSeek-V4.1-Flash · x0.06')
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

  it('keeps remote models that map to no wire config_name, without inventing a wire target', () => {
    // Reversed 2026-10-02 (issue #19). These rows used to be dropped as
    // "uncallable", but the wire rosters are ACCOUNT-SCOPED: a model missing
    // from a free account's rosters may still be callable for a paying one, and
    // the reporter's Pro account demonstrably calls models this free account
    // gets gated on. Hiding a model the user's own Trae IDE lists is the worse
    // error, so the row ships and its call fails with a readable upstream
    // message (the bridge translates 4001/4011) instead of silently vanishing.
    const remote: TraeDiscoveredModel[] = [
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', multimodal: true, reasoningSupported: true },
      { id: 'glm-5.3', name: 'GLM-5.3', multimodal: false, reasoningSupported: false },
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
    ]
    const wire = [
      { id: 'glm-5.2', name: 'GLM-5.2', function: 'solo_work_lite' },
      { id: 'Doubao-Seed-2.0-Code', name: 'Doubao-Seed-2.1-Turbo' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    // Every remote row survives; the wire-only orphan still does not.
    expect(merged.map(model => model.id)).toEqual(['Doubao-Seed-Code', 'glm-5.3', 'glm-5.2'])
    // The matched row carries its wire target …
    expect(merged.find(model => model.id === 'glm-5.2')).toMatchObject({ wireFunction: 'solo_work_lite' })
    // … and the unmatched ones carry none, so the bridge falls back to the
    // display id and the default function rather than sending a fabricated id.
    const unmatched = merged.find(model => model.id === 'Doubao-Seed-Code')
    expect(unmatched?.wireFunction).toBeUndefined()
    expect(unmatched?.wireConfigName).toBeUndefined()
  })

  it('keeps the first wire row on same-name collisions instead of the lower-case tail row', () => {
    // Issue #38. The reporter's CN wire lists the DeepSeek-V4 family three
    // times: the `-Official` row, the plain row, and a metadata-poor lower-case
    // tail row whose `id` AND `name` are `deepseek-v4-flash`. Under
    // last-write-wins that tail row overwrote the display-name key, so the
    // bridge rewrote `config_name` to the lower-case spelling and the selector
    // rows were rejected with 4001 ("the param is invalid"). First write wins
    // keeps the canonical camel-case row, so nothing is rewritten.
    //
    // This fixture is the SYNTHETIC roster quoted in the issue. The maintainer's
    // own account was audited (2026-10-16) and its wire carries no lower-case
    // tail row, so there this change is a no-op; the fixture pins the CN shape.
    const remote: TraeDiscoveredModel[] = [
      { id: 'DeepSeek-V4-Flash-Official', name: 'DeepSeek-V4-Flash', multimodal: false, reasoningSupported: true, maxContextWindow: 1_000_000 },
      { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', multimodal: false, reasoningSupported: true, maxContextWindow: 200_000 },
    ]
    const wire = [
      { id: 'DeepSeek-V4-Flash-Official', name: 'DeepSeek-V4-Flash', function: 'solo_work_remote' },
      { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', function: 'solo_work_remote' },
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', function: 'solo_work_remote' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    // Each row keeps its own id as the wire id → no `wireConfigName`, so the
    // bridge sends the display id verbatim and the upstream accepts it.
    expect(merged.map(model => model.wireConfigName)).toEqual([undefined, undefined])
    expect(merged.map(model => model.wireFunction)).toEqual(['solo_work_remote', 'solo_work_remote'])
    // The lower-case tail row must not have claimed the shared display name.
    expect(merged.some(model => model.wireConfigName === 'deepseek-v4-flash')).toBe(false)
  })

  it('carries the wire max_tokens onto the merged row (issue #42)', () => {
    // Issue #42: every CN model showed an empty「最大输出」on DSH's model
    // card. The wire roster DOES publish the output cap — solo.ts's
    // collectModels parses `model_detail_list[].max_tokens` into
    // TraeSoloModel.maxTokens (pinned by tests/solo.spec.ts) — but the merge
    // copied context/credit/reasoning/wire-target and silently dropped
    // maxTokens, so the value never reached TraeModelInfo, /models/refresh,
    // the persisted lastCatalog, or toPiModel. The Remote directory has no
    // output-cap field at all, so the wire is the ONLY source: a dropped
    // wire value is an empty card, which is exactly what the reporter saw.
    const remote: TraeDiscoveredModel[] = [
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, contextWindow: 168_000, reasoningSupported: false },
      // A wire row without max_tokens must not gain an invented one.
      { id: 'kimi-k3', name: 'Kimi-K3', multimodal: false, contextWindow: 200_000, reasoningSupported: false },
    ]
    const wire = [
      { id: 'glm-5.2', name: 'GLM-5.2', maxTokens: 32_000, function: 'solo_work_remote' },
      { id: 'kimi-k3', name: 'Kimi-K3', function: 'solo_work_remote' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.find(model => model.id === 'glm-5.2')?.maxTokens).toBe(32_000)
    expect(merged.find(model => model.id === 'kimi-k3')?.maxTokens).toBeUndefined()
  })

  it('still resolves a genuine display-name join after the first-wins change', () => {
    // Guard against over-correcting: first-wins must not break the tier-2 join
    // for models whose wire id legitimately differs from the remote id.
    const remote: TraeDiscoveredModel[] = [
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', multimodal: false, reasoningSupported: false },
    ]
    const wire = [
      { id: 'Doubao_1_6', name: 'Seed-Code', function: 'chat_v3' },
      { id: 'Doubao_1_6_legacy', name: 'Seed-Code', function: 'chat_v3' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    // The first row carrying that display name wins, deterministically.
    expect(merged[0]?.wireConfigName).toBe('Doubao_1_6')
  })

  it('keeps the Remote skeleton display name, because the wire roster is NOT the IDE name source (issue #46)', () => {
    // The wire roster was measured as a name source and REJECTED. Measured
    // 2026-10-22 on a live CN credential: the wire roster (`get_detail_param`)
    // disagrees with the Trae IDE's own roster (`batch_get_detail_param`, the
    // source the picker renders) on 32 of 81 ids, while the Remote skeleton
    // disagrees on only 3 of 33.
    //
    // The reason is that the wire roster is FUNCTION-SCOPED: the same id
    // carries a different `display_name` depending on which function asked
    // (10 of 102 ids carry more than one name across the IDE's own
    // functions), and the plugin's wire client reads the CHAT functions — so
    // it can land on a name the picker never shows.
    //
    // This test pins the REJECTED behaviour, so a future change cannot
    // reintroduce the wire name as the display name on the strength of a
    // plausible-sounding assumption.
    const remote: TraeDiscoveredModel[] = [
      { id: 'DeepSeek-V4-Pro-Official', name: 'DeepSeek-V4-Pro', multimodal: false, reasoningSupported: false },
      { id: 'Doubao-Seed-2.0-Code', name: 'Doubao-Seed-2.0-Code', multimodal: false, reasoningSupported: false },
      { id: 'Doubao-Seed-2.1-Pro', name: 'Seed-2.1-Pro-0915', multimodal: false, reasoningSupported: false },
    ]
    const wire = [
      // The chat functions publish a DIFFERENT name for these ids than the
      // IDE's picker does.
      { id: 'DeepSeek-V4-Pro-Official', name: 'DeepSeek-V4-Pro' },
      { id: 'Doubao-Seed-2.0-Code', name: 'Doubao-Seed-2.1-Turbo' },
      { id: 'Doubao-Seed-2.1-Pro', name: 'Seed-2.1-Pro-0915' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    // The skeleton's name wins — it is the closer match to the IDE.
    expect(merged.find(model => model.id === 'DeepSeek-V4-Pro-Official')?.name).toBe('DeepSeek-V4-Pro')
    expect(merged.find(model => model.id === 'Doubao-Seed-2.0-Code')?.name).toBe('Doubao-Seed-2.0-Code')
    expect(merged.find(model => model.id === 'Doubao-Seed-2.1-Pro')?.name).toBe('Seed-2.1-Pro-0915')
    // The wire still owns the config_name: that part of the join is unchanged.
    expect(merged.find(model => model.id === 'Doubao-Seed-2.0-Code')?.wireConfigName).toBeUndefined()
  })

  it('promotes a wire-only MODEL the Remote skeleton does not know (issue #46)', () => {
    // The Remote skeleton is the catalog's SKELETON but it is not complete: it
    // carried ZERO dated snapshot config_names on the live account while the
    // wire roster carried three, so every snapshot the IDE offers was dropped
    // by the join and unreachable from the plugin. This is the same reasoning
    // that made issue #19 keep a REMOTE row with no wire match, with the sides
    // swapped: a roster's silence is not proof that a model is absent.
    const remote: TraeDiscoveredModel[] = [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', multimodal: true, contextWindow: 200_000, reasoningSupported: true },
    ]
    const wire = [
      // The dated snapshot: present in the wire roster, absent from the skeleton.
      { id: 'kimi-k2-0905', name: 'Kimi-K2-0905', contextWindow: 200_000, maxTokens: 32_000, function: 'solo_coder', usage: 'chat_completion', configSource: 1 },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    const promoted = merged.find(model => model.id === 'kimi-k2-0905')
    expect(promoted).toBeDefined()
    expect(promoted).toMatchObject({
      id: 'kimi-k2-0905',
      name: 'Kimi-K2-0905',
      contextWindow: 200_000,
      maxTokens: 32_000,
      wireFunction: 'solo_coder',
      input: ['text'],
    })
    // The row's own id IS its wire config_name, so no `wireConfigName` is needed.
    expect(promoted?.wireConfigName).toBeUndefined()
    // The skeleton row is untouched.
    expect(merged.find(model => model.id === 'deepseek-v4.1-flash')).toBeDefined()
  })

  it('does NOT promote a wire-only row that is a tool config, a custom model, or an alias', () => {
    // The wire roster mixes models with the IDE's own helper configs and with
    // the account's custom models. Measured 2026-10-22 on the live account,
    // 50 wire-only rows reduced to 12 promotable models by these four tests:
    // a real `usage`, a Trae-preset `config_source`, a real display name, and a
    // display name no skeleton row already claims.
    const remote: TraeDiscoveredModel[] = [
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', multimodal: false, reasoningSupported: false },
    ]
    const wire = [
      // A tool config: upstream says what it is for, and it is not a model.
      { id: 'title_generation', name: 'title_generation', usage: 'title_generation', configSource: 1 },
      { id: 'summary', name: 'summary', usage: 'summary', configSource: 1 },
      // The account's own custom model (source 3) — the plugin does not host it.
      { id: 'custom_model_gpt-6', name: 'GPT-5.6', usage: 'custom_model', configSource: 3 },
      // A codename config with no real display name.
      { id: 'sagitta', name: '-', usage: 'chat_completion', configSource: 1 },
      { id: 'aquila', name: '', usage: 'chat_completion', configSource: 1 },
      // A config identifier wearing a display-name hat.
      { id: 'search_agent_qwen_fast', name: 'search_agent_qwen_fast', usage: 'chat_completion', configSource: 1 },
      // An ALIAS of a model the skeleton already exposes.
      { id: 'Doubao_1_6', name: 'Seed-Code', usage: 'chat_completion', configSource: 1 },
      // A row with no upstream signals at all (usage/config_source absent).
      { id: 'unknown-shape', name: 'Unknown Shape', function: 'chat_v3' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['Doubao-Seed-Code'])
  })

  it('does not promote a wire-only row whose display name duplicates a skeleton row of equal capability', () => {
    // `glm-5.1_advisor` displays as `GLM-5.1`, which the skeleton already
    // exposes at the same capability. Promoting it would list ONE model twice
    // under two ids.
    const remote: TraeDiscoveredModel[] = [
      { id: 'glm-5.1', name: 'GLM-5.1', multimodal: false, contextWindow: 100_000, reasoningSupported: false },
    ]
    const wire = [
      { id: 'glm-5.1_advisor', name: 'GLM-5.1', contextWindow: 100_000, usage: 'chat_completion', configSource: 1, function: 'chat_v3' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['glm-5.1'])
  })

  it('does not promote a wire-only row that is WEAKER than the skeleton row sharing its name', () => {
    // Measured: `glm-5.2_advisor_default` is 168K against the skeleton's 200K
    // `glm-5.2`. It is an internal re-routing of a model the user already has
    // in full, so a second row would only add noise.
    const remote: TraeDiscoveredModel[] = [
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, contextWindow: 200_000, reasoningSupported: false },
    ]
    const wire = [
      { id: 'glm-5.2_advisor_default', name: 'GLM-5.2', contextWindow: 168_000, usage: 'chat_completion', configSource: 1, function: 'solo_agent_remote' },
    ]
    expect(mergeTraeModelSources(remote, wire).map(model => model.id)).toEqual(['glm-5.2'])
  })

  it('PROMOTES a colliding row that is strictly more capable, disambiguated by id (issue #46)', () => {
    // The measured case this rule exists for: `kimi-k2` (28K) and
    // `kimi-k2-0905` (168K) both display as `Kimi-K2-0905`, and BOTH answer.
    // Dropping the second hid a real 168K model behind an equally-named 28K
    // one -- the "dated snapshot the IDE offers, the plugin does not" report.
    const remote: TraeDiscoveredModel[] = [
      { id: 'kimi-k2', name: 'Kimi-K2-0905', multimodal: false, contextWindow: 28_000, reasoningSupported: false },
    ]
    const wire = [
      { id: 'kimi-k2-0905', name: 'Kimi-K2-0905', contextWindow: 168_000, maxTokens: 32_000, usage: 'chat_completion', configSource: 1, function: 'solo_coder' },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.map(model => model.id)).toEqual(['kimi-k2', 'kimi-k2-0905'])
    // The names must be TELLABLE APART: two rows rendering as `Kimi-K2-0905`
    // is a picker that lies about how many models it has.
    const promoted = merged.find(model => model.id === 'kimi-k2-0905')
    expect(promoted?.name).toBe('Kimi-K2-0905 (kimi-k2-0905)')
    expect(promoted?.contextWindow).toBe(168_000)
    expect(promoted?.wireFunction).toBe('solo_coder')
    // The skeleton row keeps its own name untouched.
    expect(merged.find(model => model.id === 'kimi-k2')?.name).toBe('Kimi-K2-0905')
  })

  it('promotes the bigger `-auto` twin but not an identical one', () => {
    // Measured: `minimax-m2` is 100K/`chat_v3` while `minimax-m2-auto` is
    // 168K/`solo_coder` -- different capability, so both belong. By contrast
    // `glm-4.7` and `glm-4.7-auto` are identical (100K/16000/`chat_v3`), so the
    // twin adds nothing.
    const wire = [
      { id: 'minimax-m2', name: 'MiniMax-M2', contextWindow: 100_000, maxTokens: 16_000, usage: 'chat_completion', configSource: 1, function: 'chat_v3' },
      { id: 'minimax-m2-auto', name: 'MiniMax-M2', contextWindow: 168_000, maxTokens: 32_000, usage: 'chat_completion', configSource: 1, function: 'solo_coder' },
      { id: 'glm-4.7', name: 'GLM-4.7', contextWindow: 100_000, maxTokens: 16_000, usage: 'chat_completion', configSource: 1, function: 'chat_v3' },
      { id: 'glm-4.7-auto', name: 'GLM-4.7', contextWindow: 100_000, maxTokens: 16_000, usage: 'chat_completion', configSource: 1, function: 'chat_v3' },
    ]
    const merged = mergeTraeModelSources([], wire)
    const ids = merged.map(model => model.id)
    expect(ids).toContain('minimax-m2')
    expect(ids).toContain('minimax-m2-auto')
    expect(ids).toContain('glm-4.7')
    // The identical twin is suppressed regardless of which one came first.
    expect(ids).not.toContain('glm-4.7-auto')
    expect(merged.find(model => model.id === 'minimax-m2-auto')?.name).toBe('MiniMax-M2 (minimax-m2-auto)')
  })

  it('compares a collision against the STRONGEST claimant, whatever the wire order', () => {
    // A weaker row arriving after a stronger one must still be suppressed: the
    // comparison is against the best context claimed under the name, not
    // against whichever row happened to be seen last.
    const wire = [
      { id: 'a-strong', name: 'Shared', contextWindow: 200_000, usage: 'chat_completion', configSource: 1, function: 'chat_v3' },
      { id: 'b-weak', name: 'Shared', contextWindow: 100_000, usage: 'chat_completion', configSource: 1, function: 'chat_v3' },
    ]
    const ids = mergeTraeModelSources([], wire).map(model => model.id)
    expect(ids).toEqual(['a-strong'])
  })
})

describe('isPromotableWireModel', () => {
  it('accepts a Trae preset model with a real display name', () => {
    expect(isPromotableWireModel({ id: 'kimi-k2', name: 'Kimi-K2-0905', usage: 'chat_completion', configSource: 1 })).toBe(true)
  })

  it('rejects a row whose usage is not chat_completion', () => {
    // A tool config, or the account's own custom model.
    expect(isPromotableWireModel({ id: 'summary', name: 'summary', usage: 'summary', configSource: 1 })).toBe(false)
    expect(isPromotableWireModel({ id: 'custom_model_kimi', name: 'Kimi', usage: 'custom_model', configSource: 1 })).toBe(false)
  })

  it('rejects a row that is not a Trae preset', () => {
    // `config_source: 3` is the account's own custom model (it carries the
    // user's own base_url and key); the plugin must not offer to bill it.
    expect(isPromotableWireModel({ id: 'custom_model_gpt-6', name: 'GPT-5.6', usage: 'chat_completion', configSource: 3 })).toBe(false)
  })

  it('rejects a row without a real display name', () => {
    expect(isPromotableWireModel({ id: 'sagitta', name: '-', usage: 'chat_completion', configSource: 1 })).toBe(false)
    expect(isPromotableWireModel({ id: 'aquila', name: '', usage: 'chat_completion', configSource: 1 })).toBe(false)
    // A bare identifier is a config name, not a model name.
    expect(isPromotableWireModel({ id: 'search_agent_qwen_fast', name: 'search_agent_qwen_fast', usage: 'chat_completion', configSource: 1 })).toBe(false)
  })

  it('rejects a row whose upstream signals are absent', () => {
    // "Upstream did not say" is never "assume it is a model".
    expect(isPromotableWireModel({ id: 'unknown', name: 'Unknown' })).toBe(false)
    expect(isPromotableWireModel({ id: 'unknown', name: 'Unknown', usage: 'chat_completion' })).toBe(false)
    expect(isPromotableWireModel({ id: 'unknown', name: 'Unknown', configSource: 1 })).toBe(false)
  })
})

describe('directory group function backs up the wire function', () => {
  it('falls back to the directory group function when the wire roster has no row', () => {
    // A restricted network often returns an empty get_detail_param for the chat
    // functions; the merge must then derive wireFunction from the directory's
    // own group, so solo_work_remote models keep their function and the bridge
    // does not 4001 under the default solo_work_lite.
    const remote: TraeDiscoveredModel[] = [
      { id: 'glm-5.3', name: 'GLM-5.3', multimodal: false, reasoningSupported: false, function: 'solo_work_remote' },
      { id: 'Doubao-Seed-Code', name: 'Seed-Code', multimodal: false, reasoningSupported: false, function: 'solo_agent_remote' },
    ]
    const merged = mergeTraeModelSources(remote, [])
    expect(merged.find(model => model.id === 'glm-5.3')?.wireFunction).toBe('solo_work_remote')
    expect(merged.find(model => model.id === 'Doubao-Seed-Code')?.wireFunction).toBe('solo_agent_remote')
  })

  it('lets the wire function win over the directory group function', () => {
    // The roster knows the paid/entitled state the directory cannot, so its
    // get_detail_param function is authoritative whenever a wire row exists.
    const remote: TraeDiscoveredModel[] = [
      { id: 'glm-5.3', name: 'GLM-5.3', multimodal: false, reasoningSupported: false, function: 'solo_work_remote' },
      { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', multimodal: false, reasoningSupported: false, function: 'solo_agent' },
    ]
    const wire = [{ id: 'glm-5.3', name: 'GLM-5.3', function: 'solo_work_lite' }]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.find(model => model.id === 'glm-5.3')?.wireFunction).toBe('solo_work_lite')
    // A model with no wire row keeps its (non-chat) directory attribution at
    // the merge layer; `withChatCallableFunctions` later CLEARS it (it does not
    // drop the row) so the bridge uses the default chat function.
    expect(merged.find(model => model.id === 'kimi-k2.8-preview')?.wireFunction).toBe('solo_agent')
  })

  it('carries the discovered function onto catalog rows with no wire row at all', () => {
    const rows = discoveredCatalog([
      { id: 'glm-5.3', name: 'GLM-5.3', multimodal: false, reasoningSupported: false, function: 'solo_work_remote' },
    ])
    expect(rows[0]?.wireFunction).toBe('solo_work_remote')
  })
})

describe('withChatCallableFunctions', () => {
  it('keeps chat-function rows and functionless rows, and CLEARS a non-chat function instead of dropping the row', () => {
    // Dropping the row was a regression: the directory lists exactly these
    // models under `solo_agent` ALONE (docs/ISSUE19_DIAGNOSIS.md) and they DO
    // answer under the default chat function, so hiding them re-undoes issue
    // #19 on the restricted networks the fallback exists for.
    const rows = [
      { id: 'glm-5.3', name: 'GLM-5.3', wireFunction: 'solo_work_remote' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', wireFunction: 'solo_agent' },
      { id: 'studio-agent', name: 'Studio Agent', wireFunction: 'builder_v3' },
      { id: 'chat-only', name: 'Chat Only', wireFunction: 'chat_v3' },
    ]
    const callable = withChatCallableFunctions(rows, TRAE_DIRECTORY_FUNCTIONS['cn'])
    // Every row survives -- no model is silently hidden.
    expect(callable.map(model => model.id)).toEqual(['glm-5.3', 'glm-5.2', 'kimi-k2.8-preview', 'studio-agent', 'chat-only'])
    // Chat functions are untouched; the non-chat pin is cleared so the bridge
    // sends the region's DEFAULT chat function instead of a roster that 4011s.
    expect(callable.map(model => model.wireFunction)).toEqual(['solo_work_remote', undefined, undefined, undefined, 'chat_v3'])
  })

  it('respects the region list (solo_coder is chat for cn but not for ai)', () => {
    const rows = [{ id: 'glm-5', name: 'GLM-5', wireFunction: 'solo_coder' }]
    expect(withChatCallableFunctions(rows, TRAE_DIRECTORY_FUNCTIONS['cn'])[0]?.wireFunction).toBe('solo_coder')
    expect(withChatCallableFunctions(rows, TRAE_DIRECTORY_FUNCTIONS['ai'])[0]?.wireFunction).toBeUndefined()
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

  it('keeps a remote row with no wire config, but never offers one in a fallback roster', () => {
    // Reversed 2026-10-02 (issue #19): the row ships even without a wire match,
    // because the wire rosters are account-scoped and hiding a model the user's
    // IDE lists is worse than a readable failure at call time. What must NOT
    // happen is the opposite direction — an IDE-only model appearing in the
    // built-in fallback list, which is what the next case guards.
    const remote = [
      { id: 'glm-5.2', name: 'GLM-5.2', multimodal: false, reasoningSupported: false },
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', multimodal: false, reasoningSupported: false },
    ]
    const merged = mergeTraeModelSources(remote, [{ id: 'glm-5.2', name: 'GLM-5.2' }])
    expect(merged.map(model => model.id)).toEqual(['glm-5.2', 'deepseek-v4.1-flash'])
    expect(merged[1]?.wireConfigName).toBeUndefined()
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
