/**
 * The default thinking level: what the pure resolver decides, and that the
 * adapter actually reports it to the kernel.
 *
 * WHY TWO LAYERS. The resolver is easy to get right and easy to leave
 * UNCONNECTED — the defect this feature fixes is exactly that shape: Trae has
 * published a per-model default all along (`reasoning.defaultEffort`), the
 * parser even carried it into the catalog, and DSH's picker still said
 * `Default` because nothing ever told the kernel. So a table test of
 * `defaultEffortFor` alone would have passed against the broken build.
 *
 * The adapter half is therefore driven the way the host drives it
 * (`resolveModel` / `prepareCall` on a real `createTraeAdapter`), not by calling
 * `advertiseDefaultEffort` directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const stubApi = {
  stream: () => ({ fake: 'stream' }),
  streamSimple: () => ({ fake: 'streamSimple' }),
}

vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => stubApi,
}))

const shim = {
  ready: Promise.resolve(),
  baseUrl: () => 'http://127.0.0.1:1',
  token: () => 'secret',
  tokenOf: () => 'secret',
  close: async () => {},
}

/**
 * A catalog row shaped the way `catalog.ts` really produces one.
 *
 * `reasoningEfforts` is NOT optional decoration: it is the table `toPiModel`
 * reads to decide whether a row offers reasoning at all AND what each level's
 * wire name is. A fixture that carried only `reasoning` would build a
 * non-reasoning model, and every assertion below would measure that instead of
 * the default level.
 */
const WIRE: Record<string, string> = { low: 'light', high: 'high', xhigh: 'extra_high', medium: 'medium', maximal: 'max' }
const row = (id: string, supported: string[], defaultEffort?: string) => ({
  id,
  name: id,
  contextWindow: 200_000,
  reasoningSupported: true,
  reasoning: { supported, ...defaultEffort === undefined ? {} : { defaultEffort } },
  reasoningEfforts: Object.fromEntries(supported.map(level => [level, WIRE[level] ?? level])),
})

beforeEach(() => { vi.clearAllMocks() })

describe('defaultEffortFor — precedence', () => {
  it('follows the level upstream declares when the user has chosen nothing', async () => {
    const { defaultEffortFor } = await import('../src/default-effort.ts')
    expect(defaultEffortFor({ id: 'm', supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' })).toBe('high')
  })

  it('lets an explicit choice beat the upstream default', async () => {
    const { defaultEffortFor } = await import('../src/default-effort.ts')
    const model = { id: 'm', supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' }
    expect(defaultEffortFor(model, { m: 'xhigh' })).toBe('xhigh')
  })

  it('ignores a saved level the model no longer declares', async () => {
    const { defaultEffortFor } = await import('../src/default-effort.ts')
    // The directory withdrew `xhigh`; sending it would be rejected by the kernel
    // with UNSUPPORTED_REASONING_EFFORT, which fails the whole request.
    const model = { id: 'm', supported: ['low', 'high'], defaultEffort: 'high' }
    expect(defaultEffortFor(model, { m: 'xhigh' })).toBe('high')
  })

  it('falls back to `medium` when a model declares tiers but no default', async () => {
    const { defaultEffortFor } = await import('../src/default-effort.ts')
    expect(defaultEffortFor({ id: 'm', supported: ['low', 'medium', 'high'] })).toBe('medium')
  })

  it('falls back to the model OWN middle tier when it has no `medium`', async () => {
    const { defaultEffortFor } = await import('../src/default-effort.ts')
    // Measured on `Doubao-Seed-2.1-Pro` / `step-5-preview`: `low / high` only.
    // Choosing the weakest tier instead would silently mean "thinking off".
    expect(defaultEffortFor({ id: 'm', supported: ['low', 'high'] })).toBe('low')
    // Three tiers: the middle one is `high`, not the weakest.
    expect(defaultEffortFor({ id: 'm', supported: ['low', 'high', 'xhigh'] })).toBe('high')
    // `medium` wins whenever the model publishes it, however long the ladder is.
    expect(defaultEffortFor({ id: 'm', supported: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] })).toBe('medium')
  })

  it('reports nothing for a model that declares no tiers at all', async () => {
    const { defaultEffortFor } = await import('../src/default-effort.ts')
    expect(defaultEffortFor({ id: 'm', supported: [] })).toBeUndefined()
    expect(defaultEffortFor({ id: 'm' })).toBeUndefined()
  })

  it('drops a tier DSH cannot name', async () => {
    const { declaredEfforts } = await import('../src/default-effort.ts')
    // Trae's own names (`light` / `extra_high`) must never leak upward; only the
    // mapped DSH levels are reportable.
    expect(declaredEfforts({ id: 'm', supported: ['light', 'high', 'extra_high'] })).toEqual(['high'])
    expect(declaredEfforts({ id: 'm', supported: ['low', 'high', 'xhigh'] })).toEqual(['low', 'high', 'xhigh'])
  })

  it('keeps tiers in DSH strength order, not the order the caller listed them', async () => {
    const { selectableEfforts } = await import('../src/default-effort.ts')
    expect(selectableEfforts({ id: 'm', supported: ['xhigh', 'low', 'high'] })).toEqual(['low', 'high', 'xhigh'])
  })
})

describe('createTraeAdapter — the default level actually reaches the kernel', () => {
  /** Drive the adapter the way the host does, with a catalog we control. */
  async function adapterWith(models: ReturnType<typeof row>[], defaultEfforts?: () => Record<string, string>) {
    const { createTraeAdapter, TRAE_PROVIDER } = await import('../src/adapter.ts')
    const { TraeCatalog } = await import('../src/catalog.ts')
    const catalog = new TraeCatalog('cn')
    // `TraeCatalog.current()` is what the provider serves and what the resolver
    // reads, so seeding it is seeding both halves of the seam.
    ;(catalog as unknown as { saved: unknown }).saved = models
    vi.spyOn(catalog, 'current').mockReturnValue(models as never)
    const built = createTraeAdapter({
      shim,
      catalog,
      ...defaultEfforts === undefined ? {} : { defaultEfforts },
    })
    return { adapter: built.adapter, provider: TRAE_PROVIDER }
  }

  it('reports the upstream default through resolveModel', async () => {
    const { adapter, provider } = await adapterWith([row('m', ['low', 'high', 'xhigh'], 'high')])
    const info = await adapter.resolveModel(provider, 'm')
    expect(info.reasoning?.defaultEffort).toBe('high')
  })

  it('reports it through prepareCall as well, which is the path a real request takes', async () => {
    const { adapter, provider } = await adapterWith([row('m', ['low', 'high', 'xhigh'], 'xhigh')])
    const call = await adapter.prepareCall(provider, 'm')
    expect(call.model.reasoning?.defaultEffort).toBe('xhigh')
  })

  it('prefers the saved choice over the upstream default', async () => {
    const { adapter, provider } = await adapterWith(
      [row('m', ['low', 'high', 'xhigh'], 'high')],
      () => ({ m: 'low' }),
    )
    const info = await adapter.resolveModel(provider, 'm')
    expect(info.reasoning?.defaultEffort).toBe('low')
  })

  it('re-reads the saved choice on every resolution, so a save needs no restart', async () => {
    const saved: Record<string, string> = {}
    const { adapter, provider } = await adapterWith([row('m', ['low', 'high', 'xhigh'], 'high')], () => saved)
    expect((await adapter.resolveModel(provider, 'm')).reasoning?.defaultEffort).toBe('high')
    saved.m = 'xhigh'
    expect((await adapter.resolveModel(provider, 'm')).reasoning?.defaultEffort).toBe('xhigh')
  })

  it('never reports a level the model does not offer', async () => {
    // The guard that keeps a bad save from failing every request: the kernel
    // rejects an unknown default with INVALID_MODEL_REASONING.
    const { adapter, provider } = await adapterWith(
      [row('m', ['low', 'high'], 'high')],
      () => ({ m: 'max' }),
    )
    const info = await adapter.resolveModel(provider, 'm')
    expect(info.reasoning?.defaultEffort).toBe('high')
    expect(info.reasoning?.efforts.map(level => level.id)).toEqual(['low', 'high'])
  })

  it('reports nothing for a model that offers no reasoning', async () => {
    const { adapter, provider } = await adapterWith([{ id: 'm', name: 'm', contextWindow: 100_000 } as never])
    const info = await adapter.resolveModel(provider, 'm')
    expect(info.reasoning).toBeUndefined()
  })
})

describe('thinkingEffortsOf — the saved map the adapter reads', () => {
  it('returns only non-empty string levels', async () => {
    const { thinkingEffortsOf } = await import('../src/index.ts')
    const config = { regions: { cn: { thinkingEfforts: { a: 'high', b: '', c: 42 } } } } as never
    expect(thinkingEffortsOf(config, 'cn')).toEqual({ a: 'high' })
  })

  it('is empty for a panel with no saved levels', async () => {
    const { thinkingEffortsOf } = await import('../src/index.ts')
    expect(thinkingEffortsOf({} as never, 'cn')).toEqual({})
    expect(thinkingEffortsOf({ regions: { cn: {} } } as never, 'cn')).toEqual({})
  })

  it('keeps panels apart', async () => {
    const { thinkingEffortsOf } = await import('../src/index.ts')
    const config = { regions: { cn: { thinkingEfforts: { a: 'high' } }, ai: { thinkingEfforts: { a: 'low' } } } } as never
    expect(thinkingEffortsOf(config, 'cn')).toEqual({ a: 'high' })
    expect(thinkingEffortsOf(config, 'ai')).toEqual({ a: 'low' })
  })
})

describe('the settings schema enforces the shape of the saved choice', () => {
  /**
   * What the schema declaration actually buys.
   *
   * It is NOT retention: this schemastery keeps fields it does not recognise
   * (measured — an undeclared key survives a round-trip), so the comment on
   * `regionStateConfig` that credits the declaration with preventing loss is
   * about the HISTORICAL failure mode (`wireConfigName` was dropped by a
   * reader that rebuilt the row field-by-field), not about schemastery pruning.
   *
   * What the declaration does is refuse a document whose levels are not
   * strings. That matters because a non-string level would reach
   * `thinkingEffortsOf`, be filtered out silently, and leave the picker showing
   * a choice nobody made — the fix is to reject the write, which is what these
   * two tests pin.
   */
  it('accepts a document of string levels', async () => {
    const { Config } = await import('../src/index.ts')
    const { unwrapVolatileDeep } = await import('../src/status-paths.ts')
    const document = { regions: { cn: { thinkingEfforts: { 'deepseek-v4.1-flash': 'high' } } } }
    // `regions` is marked volatile, so on 0.1.7 the validated document hands it
    // back as a `{ get() }` live reference — the same unwrap every reader does.
    const validated = unwrapVolatileDeep(Config(document as never)) as unknown as {
      regions: Record<string, { thinkingEfforts?: Record<string, string> }>
    }
    expect(validated.regions.cn?.thinkingEfforts).toEqual({ 'deepseek-v4.1-flash': 'high' })
  })

  it('rejects a level that is not a string', async () => {
    const { Config } = await import('../src/index.ts')
    expect(() => Config({ regions: { cn: { thinkingEfforts: { m: 42 } } } } as never)).toThrow(/expected string/)
  })

  it('fills in no levels when none were chosen', async () => {
    // `{}` rather than a materialised tier list: writing a level here would
    // freeze today's upstream default into the config, and the model would stop
    // following upstream the moment it changed its mind.
    const { Config } = await import('../src/index.ts')
    const { unwrapVolatileDeep } = await import('../src/status-paths.ts')
    const validated = unwrapVolatileDeep(Config({ regions: { cn: {} } } as never)) as unknown as {
      regions: Record<string, { thinkingEfforts?: Record<string, string> }>
    }
    expect(validated.regions.cn?.thinkingEfforts).toEqual({})
  })
})
