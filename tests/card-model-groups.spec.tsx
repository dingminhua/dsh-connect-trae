// @vitest-environment jsdom
/**
 * The model catalog as the card DRAWS it (issue #52, P0): one fixed order,
 * channel groups, and a search box.
 *
 * WHY THIS FILE EXISTS. `model-order.spec.ts` pins the pure functions; this file
 * pins the two ways the CARD can get them wrong:
 *
 *  - acting on the FILTERED list instead of the whole catalog — 「test all」 and
 *    the bulk context buttons must never shrink because a search box has text in
 *    it. That is a quota-spending action, so a silent narrowing is a real bug.
 *  - letting the grouping lose the row a user came for: every catalog row must
 *    be reachable, and a folded group must open again when a search starts.
 *
 * jsdom does not implement the `<details>` toggle BEHAVIOUR, so the fold test
 * drives it the way a browser would: flip `open`, then fire `toggle`.
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

function makeScope() {
  let value: Record<string, unknown> = {}
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

function model(id: string, overrides: Partial<TraeWebModel> = {}): TraeWebModel {
  return { id, name: id, contextWindow: 128_000, maxTokens: 4096, ...overrides }
}

/** The catalog the fixture uses: three channels plus one unattributed row. */
function catalog(): TraeWebModel[] {
  return [
    // Deliberately NOT in channel order: the card must re-order, not trust it.
    model('doubao-seed'),
    model('gpt-5.4', { wireFunction: 'solo_coder', wireConfigName: 'gpt-5.4-official' }),
    model('qwen3-max', { wireFunction: 'chat_v3' }),
    model('kimi-k3', { wireFunction: 'solo_work_remote' }),
    model('glm-5.2', { wireFunction: 'solo_work_remote' }),
  ]
}

function usageDocument(models: TraeWebModel[], enabledIds: string[]): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [],
    models,
    enabledModelIds: enabledIds,
    credits: { total: 7500, consumed: 5000, available: 2500, workAvailable: 0, generalAvailable: 2500, accounts: [] },
  }
}

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

async function renderModels(scope: unknown): Promise<HTMLButtonElement> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  fireEvent.click(await screen.findByRole('tab', { name: 'row.panelModels' }))
  const buttons = await waitFor(() => {
    const found = screen.getAllByRole('button', { name: /row\.modelsTest(Enabled|All)/ }) as HTMLButtonElement[]
    expect(found).toHaveLength(2)
    return found
  })
  const all = buttons.find(button => button.textContent === 'row.modelsTestAll')
  if (all === undefined) throw new Error('expected the「test all」button')
  return all
}

/** Display names in DOM order — the order the user actually reads. */
function renderedNames(): string[] {
  return Array.from(document.querySelectorAll('.dsm-trae-model-name'))
    .map(node => node.textContent ?? '')
    // A probe badge or a rate suffix would be appended to the name span; this
    // fixture renders neither, so the text is the name.
    .map(text => text.trim())
}

function groupTitles(): string[] {
  return Array.from(document.querySelectorAll('.dsm-trae-model-group-name')).map(node => node.textContent ?? '')
}

function searchBox(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'row.modelsSearch' }) as HTMLInputElement
}

/**
 * Widen to every channel.
 *
 * The card DEFAULTS to the common scope (issue #52 P2), so any assertion about
 * `solo_coder` / `chat_v3` rows has to ask for the full catalog first — which is
 * the point of the scope: it is a real default, not a decoration.
 */
function showAll(): void {
  fireEvent.click(screen.getByRole('button', { name: /row\.modelsViewAll/ }))
}

function scopeChips(): HTMLButtonElement[] {
  const group = document.querySelector('.dsm-trae-models-view')
  if (group === null) return []
  return Array.from(group.querySelectorAll('button')) as HTMLButtonElement[]
}

describe('TraeUsageCard model catalog shape', () => {
  it('renders the catalog in channel-priority order, not in document order', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)
    showAll()

    // solo_work_remote → chat_v3 → solo_coder → (no mode). Within a channel the
    // rows are alphabetical, so glm-5.2 precedes kimi-k3.
    expect(renderedNames()).toEqual(['glm-5.2', 'kimi-k3', 'qwen3-max', 'gpt-5.4', 'doubao-seed'])
    expect(groupTitles()).toEqual([
      'row.modelsChannelWorkRemote',
      'row.modelsChannelChatV3',
      'row.modelsChannelCoder',
      'row.modelsChannelDefault',
    ])
  })

  it('counts the rows in each group header', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)
    showAll()

    const counts = Array.from(document.querySelectorAll('.dsm-trae-model-group-count'))
      .map(node => node.textContent ?? '')
    expect(counts).toEqual([
      'row.modelsGroupCount:{"count":2}',
      'row.modelsGroupCount:{"count":1}',
      'row.modelsGroupCount:{"count":1}',
      'row.modelsGroupCount:{"count":1}',
    ])
  })

  it('narrows the visible rows to the search and says how many are left', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)

    fireEvent.change(searchBox(), { target: { value: 'kimi' } })

    expect(renderedNames()).toEqual(['kimi-k3'])
    // The denominator is the SCOPE (3 common rows), because that is the list the
    // user is standing in; the chip beside it carries the catalog total.
    expect(screen.getByText('row.modelsSearchCount:{"shown":1,"total":3}')).toBeTruthy()
    // The group a match lives in survives; the others disappear entirely rather
    // than lingering as empty headers.
    expect(groupTitles()).toEqual(['row.modelsChannelWorkRemote'])
  })

  it('finds a row by its WIRE config name, which is not the name on screen', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)
    showAll()

    fireEvent.change(searchBox(), { target: { value: 'gpt-5.4-official' } })

    expect(renderedNames()).toEqual(['gpt-5.4'])
  })

  it('says so when nothing matches instead of showing an empty box', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)

    fireEvent.change(searchBox(), { target: { value: 'gpt-6' } })

    expect(renderedNames()).toEqual([])
    expect(screen.getByText('row.modelsSearchEmpty:{"query":"gpt-6"}')).toBeTruthy()
  })

  it('keeps 「test all」 covering the WHOLE catalog while a search is active', async () => {
    // The search is a view, never a selection: narrowing what is on screen must
    // not narrow a run that spends quota.
    const { probes } = stubFetch(usageDocument(catalog(), ['glm-5.2']))
    const scope = makeScope().scope
    const all = await renderModels(scope)

    fireEvent.change(searchBox(), { target: { value: 'kimi' } })
    expect(renderedNames()).toEqual(['kimi-k3'])

    fireEvent.click(all)

    await waitFor(() => { expect(probes).toHaveLength(5) })
    expect([...probes].sort()).toEqual(['doubao-seed', 'glm-5.2', 'gpt-5.4', 'kimi-k3', 'qwen3-max'])
  })

  it('folds a group shut and opens it again when a search starts', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)
    showAll()

    const groups = Array.from(document.querySelectorAll('details.dsm-trae-model-group')) as HTMLDetailsElement[]
    expect(groups).toHaveLength(4)
    // Everything starts open: a default of "collapsed" would hide the very model
    // the user opened this section to enable.
    expect(groups.every(group => group.open)).toBe(true)

    // Fold the first group the way a browser does (jsdom has no default toggle).
    const first = groups[0]!
    first.open = false
    fireEvent(first, new Event('toggle'))
    await waitFor(() => {
      expect((document.querySelectorAll('details.dsm-trae-model-group')[0] as HTMLDetailsElement).open).toBe(false)
    })

    fireEvent.change(searchBox(), { target: { value: 'glm' } })

    // A search answers 「where is it」, so it re-opens the groups it touches.
    const reopened = Array.from(document.querySelectorAll('details.dsm-trae-model-group')) as HTMLDetailsElement[]
    expect(reopened.every(group => group.open)).toBe(true)
  })
})

/**
 * The scope control (issue #52, P2).
 *
 * The default is 24 of 34 rows on a live account, i.e. the specialist-channel
 * rows (`solo_coder`, `chat_v3`, `solo_agent_remote`) are NOT drawn until asked
 * for. That is a real default that can hide a row a user enabled long ago, so
 * this block pins the two promises that make it safe: the count is always on
 * screen, and a hidden-but-enabled row is announced rather than silently
 * vanishing.
 */
describe('TraeUsageCard model scope', () => {
  it('defaults to the common channels and shows how many it is leaving out', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)

    // Three common rows: two on solo_work_remote, one unattributed (called
    // through solo_work_lite, so it IS in scope — see `traeModelCallChannel`).
    expect(renderedNames()).toEqual(['glm-5.2', 'kimi-k3', 'doubao-seed'])
    expect(groupTitles()).toEqual(['row.modelsChannelWorkRemote', 'row.modelsChannelDefault'])

    const chips = scopeChips()
    expect(chips).toHaveLength(2)
    expect(chips[0]?.textContent).toBe('row.modelsViewCommon:{"count":3}')
    expect(chips[1]?.textContent).toBe('row.modelsViewAll:{"count":5}')
    // aria-pressed, not only a class: the announced state must match the paint.
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('false')
  })

  it('widens to every channel and switches the pressed state with it', async () => {
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)

    showAll()

    expect(renderedNames()).toEqual(['glm-5.2', 'kimi-k3', 'qwen3-max', 'gpt-5.4', 'doubao-seed'])
    expect(groupTitles()).toHaveLength(4)
    const chips = scopeChips()
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('false')
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('true')
  })

  it('says where a match lives when the view hid it', async () => {
    // The one answer a search box must never give is 「nothing matches」 for a
    // model that exists. `gpt` matches only the solo_coder row, which the
    // default scope does not draw.
    stubFetch(usageDocument(catalog(), ['glm-5.2']))
    await renderModels(makeScope().scope)

    fireEvent.change(searchBox(), { target: { value: 'gpt' } })

    expect(renderedNames()).toEqual([])
    expect(screen.getByText(/row\.modelsSearchOutsideView/)).toBeTruthy()
    expect(screen.queryByText(/row\.modelsSearchEmpty/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'row.modelsViewShowAll' }))

    expect(renderedNames()).toEqual(['gpt-5.4'])
  })

  it('announces an ENABLED row the view is hiding, and keeps it enabled', async () => {
    // Enabled outside the default scope: the checkbox that would turn it off is
    // not rendered, so the list has to say the row exists.
    stubFetch(usageDocument(catalog(), ['glm-5.2', 'gpt-5.4']))
    await renderModels(makeScope().scope)

    expect(screen.getByText('row.modelsEnabledOutsideView:{"count":1}')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'row.modelsViewShowAll' }))

    // Widened: the row is on screen, still ticked, and the note is gone.
    expect(renderedNames()).toContain('gpt-5.4')
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.dsm-trae-model-enabled input'))
    expect(boxes).toHaveLength(5)
    expect(boxes.filter(box => box.checked).length).toBe(2)
    expect(screen.queryByText(/row\.modelsEnabledOutsideView/)).toBeNull()
  })

  it('renders no scope control when the catalog has nothing outside the scope', async () => {
    // A region or account whose rows are all common: a two-way switch between
    // identical lists would be noise, so the control is absent rather than dead.
    const commonOnly = catalog().filter(row => row.wireFunction === undefined || row.wireFunction === 'solo_work_remote')
    stubFetch(usageDocument(commonOnly, ['glm-5.2']))
    await renderModels(makeScope().scope)

    expect(scopeChips()).toEqual([])
    expect(document.querySelector('.dsm-trae-models-view')).toBeNull()
  })
})
