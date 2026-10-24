// @vitest-environment jsdom
/**
 * The 500K middle step on the card: the third radio per row, and 「switch all
 * to 500K」.
 *
 * WHY THIS FILE EXISTS — the 500K window is NOT advertised by Trae, it is a
 * local choice the plugin invents. So the failure modes are quiet:
 *
 *  1. the radio renders for a model whose Max cannot reach 500K → the user
 *     picks it, `applyContextBudgets` refuses it, and the model silently keeps
 *     its old window (a control that does nothing);
 *  2. the bulk button writes a value the per-row radio does not — the two
 *     paths must land on IDENTICAL saved state, or switching a region and then
 *     touching one row would flip that row back.
 *
 * The assertions therefore look at what lands in the SAVED settings document,
 * not at what the DOM shows.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'
import { TRAE_CONTEXT_BUDGET_MID } from '../src/context-budget.ts'
import { TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
import type { TraeWebModel } from '../src/status-paths.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

function makeScope(initial: Record<string, unknown> = {}) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  return {
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
      },
    },
    current: () => value,
  }
}

function model(id: string, overrides: Partial<TraeWebModel> = {}): TraeWebModel {
  return { id, name: id, contextWindow: 200_000, maxTokens: 4096, ...overrides }
}

function usageDocument(catalog: TraeWebModel[], enabledIds: string[]): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [],
    models: catalog,
    enabledModelIds: enabledIds,
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

/** Open the card's models tab, where both the radios and the bulk buttons live. */
async function renderModelsTab(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  fireEvent.click(await screen.findByRole('tab', { name: 'row.panelModels' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'row.contextAllMid' })).toBeTruthy())
}

/**
 * The radios of one row, as `formatCapacity`-independent as possible: the card
 * labels them with the token count, so the count itself is the stable handle.
 */
function budgetRadiosOf(rowName: string): HTMLInputElement[] {
  const heading = screen.getByText(rowName)
  const row = heading.closest('.dsm-trae-model')
  if (row === null) throw new Error(`row not found: ${rowName}`)
  return Array.from(row.querySelectorAll('.dsm-trae-context-budget input[type="radio"]'))
}

const ROWS = [
  // 200K dev / 1M Max: dev, 500K, Max.
  model('glm-5.2', { contextWindow: 200_000, maxContextWindow: 1_000_000 }),
  // Max below the middle step: dev, Max, no 500K.
  model('small-max', { contextWindow: 200_000, maxContextWindow: 400_000 }),
  // No Max at all: one read-only option.
  model('no-max'),
]

describe('TraeUsageCard 500K middle step', () => {
  it('renders a third radio only where 500K is a real middle step', async () => {
    stubFetch(usageDocument(ROWS, ['glm-5.2', 'small-max', 'no-max']))
    const { scope } = makeScope()
    await renderModelsTab(scope)

    // 200K → 500K → 1M.
    expect(budgetRadiosOf('glm-5.2')).toHaveLength(3)
    // 400K Max cannot host a 500K window, so the row keeps its two options.
    expect(budgetRadiosOf('small-max')).toHaveLength(2)
    // No Max window: a single, already-checked, disabled option.
    const single = budgetRadiosOf('no-max')
    expect(single).toHaveLength(1)
    expect(single[0]!.disabled).toBe(true)
  })

  it('「switch all to 500K」 writes the middle step for exactly the eligible rows', async () => {
    stubFetch(usageDocument(ROWS, ['glm-5.2', 'small-max', 'no-max']))
    const { scope, current } = makeScope()
    await renderModelsTab(scope)

    fireEvent.click(screen.getByRole('button', { name: 'row.contextAllMid' }))
    const save = screen.getByRole('button', { name: 'row.save' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => {
      const slot = current().regions as { cn?: { contextBudgets?: Record<string, number> } }
      // ONLY the row whose Max reaches 500K. Writing it for the others would be
      // state that `applyContextBudgets` silently drops — the saved document
      // would claim a window the model never gets.
      expect(slot.cn?.contextBudgets).toEqual({ 'glm-5.2': TRAE_CONTEXT_BUDGET_MID })
    })
  })

  it('a per-row 500K radio writes the same value the bulk button does', async () => {
    stubFetch(usageDocument(ROWS, ['glm-5.2', 'small-max', 'no-max']))
    const { scope, current } = makeScope()
    await renderModelsTab(scope)

    // Middle radio of the eligible row (0 = dev, 1 = 500K, 2 = Max).
    const radios = budgetRadiosOf('glm-5.2')
    fireEvent.click(radios[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'row.save' }) as HTMLButtonElement)

    await waitFor(() => {
      const slot = current().regions as { cn?: { contextBudgets?: Record<string, number> } }
      expect(slot.cn?.contextBudgets).toEqual({ 'glm-5.2': TRAE_CONTEXT_BUDGET_MID })
    })
  })
})
