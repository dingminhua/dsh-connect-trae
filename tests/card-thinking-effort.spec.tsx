// @vitest-environment jsdom
/**
 * The per-model thinking-level picker on the card.
 *
 * WHY THIS FILE EXISTS. The adapter half (`default-effort.spec.ts`) makes DSH's
 * own picker able to name a level; this half is what lets the user OVERRIDE it,
 * and the two failures it guards are both silent:
 *
 *  1. A picker whose empty option says only "Default" tells the reader nothing
 *     about what they are overriding. The label must name the level the model
 *     would really run at — computed by the SAME function the adapter reports
 *     from, so the sentence and the behaviour cannot drift.
 *  2. Choosing "the upstream default" must DELETE the key, not store a level
 *     that happens to equal today's default. Storing it would look identical on
 *     screen while quietly pinning the choice, so the model would stop following
 *     upstream the moment Trae changed its mind.
 *
 * The save is asserted through the document the scope receives, for the reason
 * the whole settings channel exists: a level that is edited but not carried into
 * that document is dropped on the next save of the model list.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'
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

/** A row shaped the way the live CN directory ships it (measured 2026-11-03). */
function model(id: string, supported: string[], defaultEffort?: string): TraeWebModel {
  return {
    id,
    name: id,
    contextWindow: 128_000,
    maxTokens: 4096,
    reasoningSupported: true,
    reasoning: { supported, ...defaultEffort === undefined ? {} : { defaultEffort } },
  }
}

function usageDocument(catalog: TraeWebModel[], enabledIds: string[]): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
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

/** Open the card, its models section, and hand back the picker for one model id. */
async function renderModels(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  fireEvent.click(await screen.findByRole('tab', { name: 'row.panelModels' }))
}

/**
 * The picker for one model row.
 *
 * Found through the class the row's own markup carries rather than an
 * accessible name: the visible label is a locale key here (the stub translator
 * returns keys verbatim), and binding to that would make every test below
 * depend on the stub's shape instead of on the control.
 */
async function pickerFor(index = 0): Promise<HTMLSelectElement> {
  const selects = await waitFor(() => {
    const found = Array.from(document.querySelectorAll<HTMLSelectElement>('.dsm-trae-model-effort-select'))
    expect(found.length).toBeGreaterThan(index)
    return found
  })
  return selects[index]!
}

const CATALOG = [model('deepseek-v4.1-flash', ['low', 'high', 'xhigh'], 'high')]

describe('thinking-level picker', () => {
  it('names the level the model will actually run at in its default option', async () => {
    stubFetch(usageDocument(CATALOG, ['deepseek-v4.1-flash']))
    const { scope } = makeScope()
    await renderModels(scope)
    const select = await pickerFor()
    expect(select.options[0]!.value).toBe('')
    // Named, not merely "Default": the reader must be able to see what the
    // absence of a choice means.
    expect(select.options[0]!.textContent).toContain('high')
  })

  it('offers exactly the tiers the model declares, nothing wider', async () => {
    stubFetch(usageDocument(CATALOG, ['deepseek-v4.1-flash']))
    const { scope } = makeScope()
    await renderModels(scope)
    const select = await pickerFor()
    expect(Array.from(select.options, option => option.value)).toEqual(['', 'low', 'high', 'xhigh'])
  })

  it('writes the chosen level into the draft', async () => {
    stubFetch(usageDocument(CATALOG, ['deepseek-v4.1-flash']))
    const { scope } = makeScope()
    await renderModels(scope)
    const select = await pickerFor()
    fireEvent.change(select, { target: { value: 'xhigh' } })
    await waitFor(() => { expect((select as HTMLSelectElement).value).toBe('xhigh') })
  })

  it('deletes the key when the user goes back to the upstream default', async () => {
    stubFetch(usageDocument(CATALOG, ['deepseek-v4.1-flash']))
    const { scope, current } = makeScope({
      regions: { cn: { enabledModelIds: ['deepseek-v4.1-flash'], thinkingEfforts: { 'deepseek-v4.1-flash': 'low' } } },
    })
    await renderModels(scope)
    const select = await pickerFor()
    expect(select.value).toBe('low')
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => { expect((select as HTMLSelectElement).value).toBe('') })
    // The saved document must not carry the level that was abandoned.
    fireEvent.click(screen.getByRole('button', { name: 'row.save' }))
    await waitFor(() => {
      const saved = current() as { regions: { cn: { thinkingEfforts: Record<string, string> } } }
      expect(saved.regions.cn.thinkingEfforts).toEqual({})
    })
  })

  it('carries the chosen levels through the model-list save', async () => {
    stubFetch(usageDocument(CATALOG, ['deepseek-v4.1-flash']))
    const { scope, current } = makeScope()
    await renderModels(scope)
    const select = await pickerFor()
    fireEvent.change(select, { target: { value: 'xhigh' } })
    fireEvent.click(screen.getByRole('button', { name: 'row.save' }))
    // THE assertion this file exists for: the level survives the write that
    // replaces the whole region slot. A field omitted from `nextSlot` would be
    // gone here while still showing on screen until the next refresh.
    await waitFor(() => {
      const saved = current() as { regions: { cn: { thinkingEfforts?: Record<string, string> } } }
      expect(saved.regions.cn.thinkingEfforts).toEqual({ 'deepseek-v4.1-flash': 'xhigh' })
    })
  })

  it('renders no picker for a model that declares no tiers', async () => {
    stubFetch(usageDocument([{ id: 'kimi-k2.6', name: 'kimi-k2.6', contextWindow: 128_000, maxTokens: 4096 }], ['kimi-k2.6']))
    const { scope } = makeScope()
    await renderModels(scope)
    // The row is on screen (so the absence below is meaningful)…
    await waitFor(() => { expect(screen.getByText(/kimi-k2\.6/)).toBeTruthy() })
    // …and it carries no select at all.
    expect(document.querySelector('.dsm-trae-model-effort')).toBeNull()
  })

  it('is read-only when the settings scope is not writable', async () => {
    stubFetch(usageDocument(CATALOG, ['deepseek-v4.1-flash']))
    const scope = {
      getSnapshot: () => ({ status: 'ready', value: {}, writable: false }),
      subscribe: () => () => {},
      set: async () => {},
    }
    await renderModels(scope)
    const select = await pickerFor()
    expect(select.disabled).toBe(true)
  })
})
