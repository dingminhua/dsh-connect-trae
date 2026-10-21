// @vitest-environment jsdom
/**
 * The one-click model-availability buttons on the card: 「test enabled」 sends
 * only the rows the user ticked, 「test all」 sends the WHOLE visible catalog
 * (enabled or not).
 *
 * WHY THIS FILE EXISTS — the "enabled" button was shipped first and takes its
 * id list from `activeEnabledIds`. The "all" variant must take its list from
 * `visibleModels` instead, or it would silently test the same subset and the
 * whole point (surfacing the unticked rows that may simply be missing from a
 * tier's roster) would be lost. Both buttons share one underlying `testModels`
 * run, so the assertion that matters is WHAT ids each button hands to the
 * host test route — never the internal wiring.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'
import { TRAE_MODELS_TEST_PATH, TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
import type { TraeWebModel } from '../src/status-paths.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/** A settings scope over a mutable document; the card only reads it here. */
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
  }
}

/** A page-side model row. */
function model(id: string, overrides: Partial<TraeWebModel> = {}): TraeWebModel {
  return { id, name: id, contextWindow: 128_000, maxTokens: 4096, ...overrides }
}

/**
 * A signed-in usage document carrying a 3-row catalog where `glm-5.2` and
 * `gpt-5.4` are enabled and `kimi-k3` is present in the directory but off —
 * the exact shape the "test all" feature exists to probe.
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

/**
 * Stub fetch: the usage route serves the signed-in document, and the model-test
 * route records the ids it was handed and answers each as `available`.
 */
function stubFetch(document: Record<string, unknown>): { probes: string[] } {
  const probes: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith(withTraeRegion(TRAE_USAGE_PATH, 'cn'))) {
      return new Response(JSON.stringify(document), { status: 200 })
    }
    if (url.startsWith(TRAE_MODELS_TEST_PATH)) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { ids?: string[] }
      probes.push(...(body.ids ?? []))
      return new Response(JSON.stringify({
        results: (body.ids ?? []).map(id => ({ id, verdict: 'available', detail: 'upstream answered' })),
      }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  return { probes }
}

/** Render the card already expanded, so the usage route fires immediately. */
async function renderOpen(scope: unknown): Promise<[HTMLButtonElement, HTMLButtonElement]> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  // The card splits into sections (account / models / diagnostics) once it is
  // signed in, so the model controls live behind the MODELS tab. The tab strip
  // itself only appears after the first usage read lands, which is what the
  // `findBy` waits for.
  fireEvent.click(await screen.findByRole('tab', { name: 'row.panelModels' }))
  await waitFor(() => { expect(screen.getAllByRole('button', { name: /row\.modelsTest(Enabled|All)/ })).toHaveLength(2) })
  // The「test all」button is the one whose label is not the enabled variant.
  const buttons = screen.getAllByRole('button', { name: /row\.modelsTest(Enabled|All)/ }) as HTMLButtonElement[]
  const all = buttons.find(button => button.textContent === 'row.modelsTestAll')
  const enabled = buttons.find(button => button.textContent === 'row.modelsTestEnabled')
  if (all === undefined || enabled === undefined) throw new Error('expected both model-test buttons')
  return [enabled, all]
}

describe('TraeUsageCard model availability buttons', () => {
  it('「test enabled」 sends only the enabled ids', async () => {
    const catalog = [model('glm-5.2'), model('gpt-5.4'), model('kimi-k3')]
    const { probes } = stubFetch(usageDocument(catalog, ['glm-5.2', 'gpt-5.4']))
    const { scope } = makeScope()
    const [enabled] = await renderOpen(scope)

    fireEvent.click(enabled)

    await waitFor(() => { expect(probes).toHaveLength(2) })
    expect([...probes].sort()).toEqual(['glm-5.2', 'gpt-5.4'])
    expect(probes).not.toContain('kimi-k3')
  })

  it('「test all」 sends every catalog id, including the unticked row', async () => {
    const catalog = [model('glm-5.2'), model('gpt-5.4'), model('kimi-k3')]
    const { probes } = stubFetch(usageDocument(catalog, ['glm-5.2', 'gpt-5.4']))
    const { scope } = makeScope()
    const [, all] = await renderOpen(scope)

    fireEvent.click(all)

    await waitFor(() => { expect(probes).toHaveLength(3) })
    expect([...probes].sort()).toEqual(['glm-5.2', 'gpt-5.4', 'kimi-k3'])
  })

  it('「test all」 also probes an empty-selection directory of models where none are enabled', async () => {
    const catalog = [model('qwen3-max'), model('doubao-seed')]
    const { probes } = stubFetch(usageDocument(catalog, []))
    const { scope } = makeScope()
    const [, all] = await renderOpen(scope)

    // With nothing enabled, the「enabled」button is disabled but「all」still works.
    const enabledDisabled = (screen.getAllByRole('button', { name: /row\.modelsTest(Enabled|All)/ }) as HTMLButtonElement[])
      .find(button => button.textContent === 'row.modelsTestEnabled')
    expect(enabledDisabled?.disabled).toBe(true)
    expect(all.disabled).toBe(false)

    fireEvent.click(all)
    await waitFor(() => { expect(probes).toHaveLength(2) })
    expect([...probes].sort()).toEqual(['doubao-seed', 'qwen3-max'])
  })
})