/**
 * A served model row with no `contextWindow` must not fail the whole provider
 * route.
 *
 * WHY (issue reported as `adapter returned invalid context metadata for
 * provider "trae" model "doubao_1.8"`). DSH validates EVERY resolved model:
 *
 *   const context = resolved.context
 *   if (context !== undefined && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0))
 *     throw new LlmError(..., 'INVALID_MODEL_CONTEXT')
 *
 * and the failure is per-PROVIDER, not per-model: one unsized row takes the
 * entire `trae` region offline.
 *
 * `createTraeAdapter` states a `defaultContextWindow` on the profile for
 * exactly this case, but that field is only consulted by the kernel's own
 * catalog-resolution step. This plugin builds its provider BY HAND
 * (`createProvider({ models })`), so `Models.getModel()` returns the raw row
 * straight out of `toPiModel` — no defaulting anywhere. `toPiModel` omits the
 * key when the catalog row has no window, `PiAiAdapter.modelInfo()` therefore
 * resolves `context: { contextWindow: undefined }`, and DSH rejects it.
 *
 * The fallback constant existed; nothing ever applied it. These tests pin the
 * invariant at the two places that can break it.
 */

import { describe, expect, it } from 'vitest'
import { TraeCatalog, type TraeModelInfo } from '../src/catalog.ts'
import { createTraeAdapter, TRAE_PROVIDER } from '../src/adapter.ts'

const shim = {
  ready: Promise.resolve(),
  baseUrl: () => 'http://127.0.0.1:1',
  token: () => 'secret',
  tokenOf: () => 'secret',
  close: async () => {},
}

/** The unsized row: a live directory entry that published no window. */
const UNSIZED: TraeModelInfo = { id: 'unsized-model', name: 'Unsized' }

/** Drive the host's path: adapter.current() -> profiles -> models.getModel(). */
function handBuiltRow(row: TraeModelInfo) {
  const catalog = new TraeCatalog('cn')
  catalog.set([row])
  const built = createTraeAdapter({ shim, catalog })
  const snapshot = (built.adapter as unknown as {
    current: () => { models: { getModel: (provider: string, id: string) => { contextWindow?: number } | undefined } }
  }).current()
  return snapshot.models.getModel(TRAE_PROVIDER, row.id)
}

/** Drive the host's path for opaque metadata: PiAiAdapter.resolveModel(). */
async function resolvedInfo(row: TraeModelInfo) {
  const catalog = new TraeCatalog('cn')
  catalog.set([row])
  const built = createTraeAdapter({ shim, catalog })
  return built.adapter.resolveModel(TRAE_PROVIDER, row.id)
}

describe('an unsized catalog row is still sized for DSH', () => {
  it('gives the hand-built pi-ai model a positive integer contextWindow', () => {
    const model = handBuiltRow(UNSIZED)
    expect(model, 'the catalog row must reach pi-ai').toBeDefined()
    expect(Number.isInteger(model?.contextWindow)).toBe(true)
    expect(model?.contextWindow!).toBeGreaterThan(0)
  })

  it('never resolves context.contextWindow to a non-integer through the adapter', async () => {
    // This is the exact value DSH validates. It used to be `undefined`, which
    // raised `INVALID_MODEL_CONTEXT` and killed the whole `trae` provider.
    const info = await resolvedInfo(UNSIZED)
    expect(Number.isInteger(info.context?.contextWindow)).toBe(true)
    expect(info.context?.contextWindow!).toBeGreaterThan(0)
  })

  it('keeps a row own window instead of the fallback', async () => {
    const sized: TraeModelInfo = { id: 'sized-model', name: 'Sized', contextWindow: 168_000 }
    expect(handBuiltRow(sized)?.contextWindow).toBe(168_000)
    const info = await resolvedInfo(sized)
    expect(info.context?.contextWindow).toBe(168_000)
  })

  it('sizes every row of a mixed catalog, so one bad row cannot take the route down', async () => {
    const catalog = new TraeCatalog('cn')
    catalog.set([
      { id: 'sized-model', name: 'Sized', contextWindow: 200_000 },
      { id: 'unsized-model', name: 'Unsized' },
      { id: 'also-unsized', name: 'Also unsized' },
    ])
    const built = createTraeAdapter({ shim, catalog })
    for (const id of ['sized-model', 'unsized-model', 'also-unsized']) {
      const info = await built.adapter.resolveModel(TRAE_PROVIDER, id)
      expect(Number.isInteger(info.context?.contextWindow), `${id} must resolve an integer window`).toBe(true)
      expect(info.context?.contextWindow!, `${id} must resolve a positive window`).toBeGreaterThan(0)
    }
  })

  /**
   * Not every BAD row is a MISSING one. The directory parser admits anything
   * `finitePositive` accepts, and `finitePositive` checks only `isFinite` and
   * `> 0` — so a fractional `context_window_tokens.dev` (or a stale saved
   * `lastCatalog` carrying one) reaches the adapter as a non-integer. DSH
   * rejects a non-integer exactly like a missing one, and `toPiModel` replaces
   * the key wholesale rather than omitting it, so each of these must fall back
   * rather than pass through.
   */
  it.each([
    ['fractional', 200_000.5],
    ['zero', 0],
    ['negative', -1],
    ['not a number', Number.NaN],
  ])('replaces a %s window with the fallback', async (_label, value) => {
    const catalog = new TraeCatalog('cn')
    catalog.set([{ id: 'malformed-model', name: 'Malformed', contextWindow: value }])
    const built = createTraeAdapter({ shim, catalog })
    const info = await built.adapter.resolveModel(TRAE_PROVIDER, 'malformed-model')
    expect(Number.isInteger(info.context?.contextWindow)).toBe(true)
    expect(info.context?.contextWindow!).toBeGreaterThan(0)
  })
})
