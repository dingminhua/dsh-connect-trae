// @vitest-environment jsdom
/**
 * The bulk context-budget buttons on the card: 「switch all to Max」 and
 * 「restore default context」 (issue #42 side request).
 *
 * WHY THIS FILE EXISTS — the per-model budget radios work but are one row at
 * a time, and 18 of the 32 CN models expose a Max window above their default;
 * the reporter counted 18 clicks per region just to switch a whole account
 * onto the long context, and asked for a bulk control. The assertion that
 * matters is WHAT the buttons leave in the draft that gets saved: the Max
 * button must write each Max-capable row's `maxContextWindow` (the exact
 * spelling `applyContextBudgets` widens on) while leaving no-Max rows OUT of
 * the dict entirely, and the reset button must produce an empty dict. A bulk
 * button that wrote a plausible-looking but unrecognized number would look
 * identical on screen and do nothing at runtime.
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

/** A settings scope over a mutable document; `set` writes fields back in. */
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
  return { id, name: id, contextWindow: 128_000, maxTokens: 4096, ...overrides }
}

/**
 * A signed-in usage document with two Max-capable rows (200k→1M and
 * 128k→981 504, the shapes the CN directory actually ships) plus one row with
 * no Max at all.
 */
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

/** Render the card expanded with the model list showing, and hand back the bulk buttons. */
async function renderOpenBulk(scope: unknown): Promise<{ max: HTMLButtonElement, reset: HTMLButtonElement }> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  // The bulk buttons belong to the MODELS section (the card splits into
  // account / models / diagnostics once signed in), so open that tab first.
  fireEvent.click(await screen.findByRole('tab', { name: 'row.panelModels' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'row.contextAllMax' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'row.contextAllDefault' })).toBeTruthy()
  })
  return {
    max: screen.getByRole('button', { name: 'row.contextAllMax' }) as HTMLButtonElement,
    reset: screen.getByRole('button', { name: 'row.contextAllDefault' }) as HTMLButtonElement,
  }
}

const MAXABLE = [
  model('glm-5.2', { contextWindow: 200_000, maxContextWindow: 1_000_000 }),
  model('kimi-k3', { contextWindow: 128_000, maxContextWindow: 981_504 }),
  model('deepseek-v4'),
]

describe('TraeUsageCard bulk context-budget buttons', () => {
  it('「switch all to Max」 budgets every Max-capable row at its maxContextWindow and saves', async () => {
    stubFetch(usageDocument(MAXABLE, ['glm-5.2', 'kimi-k3', 'deepseek-v4']))
    const { scope, current } = makeScope()
    const { max } = await renderOpenBulk(scope)

    fireEvent.click(max)
    // The draft now differs from saved state, so the save button lights up.
    const save = screen.getByRole('button', { name: 'row.save' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => {
      const slot = current().regions as { cn?: { contextBudgets?: Record<string, number> } }
      expect(slot.cn?.contextBudgets).toEqual({ 'glm-5.2': 1_000_000, 'kimi-k3': 981_504 })
    })
    // The no-Max row stays out of the dict — a budget for it would be ignored
    // at runtime anyway, and writing one would misrepresent the state.
    const slot = current().regions as { cn: { contextBudgets: Record<string, number> } }
    expect(slot.cn.contextBudgets['deepseek-v4']).toBeUndefined()
  })

  it('「switch all to Max」 keeps an existing per-row budget for rows without Max', async () => {
    stubFetch(usageDocument(MAXABLE, ['glm-5.2', 'kimi-k3', 'deepseek-v4']))
    const { scope, current } = makeScope({ regions: { cn: { contextBudgets: { 'deepseek-v4': 64_000 } } } })
    const { max } = await renderOpenBulk(scope)

    fireEvent.click(max)
    fireEvent.click(screen.getByRole('button', { name: 'row.save' }))

    await waitFor(() => {
      const slot = current().regions as { cn?: { contextBudgets?: Record<string, number> } }
      // The pre-existing manual budget for the no-Max row survives the bulk
      // edit — 「switch all to Max」 only touches rows it can honor.
      expect(slot.cn?.contextBudgets).toEqual({ 'deepseek-v4': 64_000, 'glm-5.2': 1_000_000, 'kimi-k3': 981_504 })
    })
  })

  it('「restore default context」 empties the region budget dict on save', async () => {
    stubFetch(usageDocument(MAXABLE, ['glm-5.2', 'kimi-k3', 'deepseek-v4']))
    const { scope, current } = makeScope({ regions: { cn: { contextBudgets: { 'glm-5.2': 1_000_000, 'kimi-k3': 981_504 } } } })
    const { reset } = await renderOpenBulk(scope)

    // With a saved budget present, the reset button is live.
    expect(reset.disabled).toBe(false)
    fireEvent.click(reset)
    fireEvent.click(screen.getByRole('button', { name: 'row.save' }))

    await waitFor(() => {
      const slot = current().regions as { cn?: { contextBudgets?: Record<string, number> } }
      expect(slot.cn?.contextBudgets).toEqual({})
    })
  })

  it('the reset button is dead while no budget exists anywhere', async () => {
    stubFetch(usageDocument(MAXABLE, ['glm-5.2', 'kimi-k3', 'deepseek-v4']))
    const { scope } = makeScope()
    const { reset } = await renderOpenBulk(scope)
    expect(reset.disabled).toBe(true)
  })

  it('the Max button is dead when no visible row has a Max window', async () => {
    const noMax = [model('glm-5.2'), model('deepseek-v4')]
    stubFetch(usageDocument(noMax, ['glm-5.2', 'deepseek-v4']))
    const { scope } = makeScope()
    const { max } = await renderOpenBulk(scope)
    expect(max.disabled).toBe(true)
  })
})
