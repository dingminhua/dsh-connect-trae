// @vitest-environment jsdom
/**
 * The 「允许模型自主生图」 switch (`drawImageEnabled`) on the shipped card.
 *
 * WHY THIS FILE EXISTS: the flag is per-PANEL consent that lives inside
 * `regions.<panel>`, and the Host registers `trae_draw_image` ONLY while it is
 * true. Two ways this can ship broken, both invisible on screen:
 *
 *  - the box renders but the write targets a top-level settings key, so the
 *    Host's per-panel resolver never sees a grant (the tool stays absent no
 *    matter how many times the user ticks it);
 *  - the write REPLACES `regions.cn` instead of merging into it, so flipping
 *    the switch silently drops the model directory / budgets / pool (the exact
 *    defect issue #44 fixed for the pool).
 *
 * So these specs render the real card, click the real checkbox, and assert on
 * the settings WRITE: field `regions`, the cn slot's `drawImageEnabled` moved,
 * and every sibling field of that slot still there.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'
import { TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
import type { TraeWebModel } from '../src/status-paths.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/** A settings scope over a mutable document, recording every write. */
function makeScope(initial: Record<string, unknown> = {}) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  const writes: { field: string; value: unknown }[] = []
  return {
    writes,
    current: () => value,
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        writes.push({ field, value: structuredClone(next) })
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
      },
    },
  }
}

function model(id: string, overrides: Partial<TraeWebModel> = {}): TraeWebModel {
  return { id, name: id, contextWindow: 128_000, maxTokens: 4096, ...overrides }
}

function usageDocument(): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [],
    models: [model('glm-5.2'), model('deepseek-v4')],
    enabledModelIds: ['glm-5.2', 'deepseek-v4'],
    credits: { total: 7500, consumed: 5000, available: 2500, workAvailable: 0, generalAvailable: 2500, accounts: [] },
  }
}

function stubFetch(document: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(withTraeRegion(TRAE_USAGE_PATH, 'cn'))) {
      return new Response(JSON.stringify(document), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** The 生图 checkbox, found by its LABEL — never by position. */
function drawImageSwitch(): HTMLInputElement {
  const [box] = screen.getAllByRole('checkbox', { name: /^row\.drawImage\b/ }) as HTMLInputElement[]
  if (box === undefined) throw new Error('the 自主生图 checkbox is missing from the models column')
  return box
}

async function renderModelsTab(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  fireEvent.click(await screen.findByRole('tab', { name: 'row.panelModels' }))
  await waitFor(() => { expect(drawImageSwitch()).toBeTruthy() })
}

describe('the 自主生图 switch on the card', () => {
  it('is UNCHECKED when nothing is stored — consent defaults to off', async () => {
    stubFetch(usageDocument())
    const { scope } = makeScope()
    await renderModelsTab(scope)
    expect(drawImageSwitch().checked).toBe(false)
  })

  it('writes the panel slot (field "regions"), not a top-level key', async () => {
    stubFetch(usageDocument())
    const { scope, writes } = makeScope()
    await renderModelsTab(scope)

    fireEvent.click(drawImageSwitch())
    await waitFor(() => { expect(writes.length).toBeGreaterThan(0) })
    expect(writes.at(-1)?.field).toBe('regions')
    const regions = writes.at(-1)?.value as { cn?: { drawImageEnabled?: unknown } }
    expect(regions.cn?.drawImageEnabled).toBe(true)
  })

  it('carries the rest of the panel slot through, so a flip cannot drop the model picks', async () => {
    stubFetch(usageDocument())
    const { scope, writes } = makeScope({
      regions: {
        cn: {
          enabled: true,
          enabledModelIds: ['glm-5.2'],
          imageModelIds: ['seedream-4'],
          contextBudgets: { 'glm-5.2': 1_000_000 },
          pool: { enabled: true, order: ['account-1'] },
          drawImageEnabled: false,
        },
      },
    })
    await renderModelsTab(scope)

    fireEvent.click(drawImageSwitch())
    await waitFor(() => { expect(writes.length).toBeGreaterThan(0) })
    const cn = (writes.at(-1)?.value as { cn: Record<string, unknown> }).cn
    expect(cn.drawImageEnabled).toBe(true)
    expect(cn.enabledModelIds).toEqual(['glm-5.2'])
    expect(cn.imageModelIds).toEqual(['seedream-4'])
    expect(cn.contextBudgets).toEqual({ 'glm-5.2': 1_000_000 })
    expect(cn.pool).toEqual({ enabled: true, order: ['account-1'] })
  })

  it('renders CHECKED from a stored grant, and unticks it back to false', async () => {
    stubFetch(usageDocument())
    const { scope, writes } = makeScope({ regions: { cn: { enabled: true, drawImageEnabled: true } } })
    await renderModelsTab(scope)

    expect(drawImageSwitch().checked).toBe(true)
    fireEvent.click(drawImageSwitch())
    await waitFor(() => { expect(writes.length).toBeGreaterThan(0) })
    expect((writes.at(-1)?.value as { cn?: { drawImageEnabled?: unknown } }).cn?.drawImageEnabled).toBe(false)
  })
})
