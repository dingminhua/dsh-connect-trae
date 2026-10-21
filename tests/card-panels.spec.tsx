// @vitest-environment jsdom
/**
 * The card's SECTION TABS (account / models / diagnostics).
 *
 * Ported from the sibling `dsh-connect-workbuddy` card, whose settings page
 * split for exactly this reason: the card had grown into one long column that
 * carried two unrelated jobs — operating an account (who serves, what is left,
 * the check-in, the pool) and editing the catalog (which models, image input,
 * context budget). The two do not even commit the same way: an account change
 * lands on the click, a catalog change is a draft until 「保存」. One column
 * therefore put the save button screens away from what it saves.
 *
 * What these tests pin, and why each line matters:
 *
 *   DEFAULT    The card opens on the account section. A card that opened on a
 *              section the user did not ask for would hide the account state
 *              they came to check.
 *   HIDDEN     An inactive panel leaves the accessibility tree via the `hidden`
 *              attribute, and the ACTIVE one carries `role="tabpanel"`.
 *   MOUNTED    The ACCOUNT and MODELS panels stay in the DOM while inactive.
 *              This is not an implementation detail: remounting them would
 *              refetch usage and drop a half-filled catalog draft every time
 *              the user glanced at another section.
 *   ARIA       Exactly one tab is `aria-selected`, and each tab points at the
 *              panel it controls (and each panel back at its tab).
 *   SCOPE      The section tabs sit UNDER the region row: switching sections
 *              must never switch which provider the card is about.
 *   SIGNED OUT A signed-out card is one screen of instructions; it renders no
 *              section strip, and nothing may hide that screen behind a tab the
 *              user cannot see.
 *   DIAG       The diagnostics section reports what the card actually READ, by
 *              name rather than by id, and carries no control.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_CARD_CSS } from '../src/client/styles.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/** A stand-in settings scope over one mutable document. */
function makeScope(initial: Record<string, unknown> = {}) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field: string, next: unknown) => {
      value = { ...value, [field]: structuredClone(next) }
      for (const listener of listeners) listener()
      return true
    },
  }
}

/** A signed-in CN document, trimmed to what these tests read. */
function usageOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [
      { id: 'account-1', accountName: 'LaoDing', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
    ],
    models: [
      { id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 200_000, maxContextWindow: 1_000_000 },
      { id: 'kimi-k3', name: 'Kimi K3', contextWindow: 128_000 },
    ],
    enabledModelIds: ['glm-5.2'],
    credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    ...overrides,
  }
}

/** Serve the usage route (and the per-account status route) from one stub. */
function stubFetch(document: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('account-status')) {
      return new Response(JSON.stringify({ id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } }), { status: 200 })
    }
    if (url.includes('/usage')) return new Response(JSON.stringify(document), { status: 200 })
    return new Response('{}', { status: 200 })
  }))
}

/** Expand the card and wait for the section strip the usage read reveals. */
async function renderOpen(document: Record<string, unknown> = usageOf()): Promise<void> {
  stubFetch(document)
  render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await screen.findByRole('tab', { name: 'row.panelAccounts' })
}

/**
 * A panel or a section tab by its id.
 *
 * Scanned by class plus id rather than by a `#id` selector: inside this harness
 * an id selector occasionally resolves to null for an element that is plainly in
 * the tree. Matching the class list and comparing `el.id` is deterministic.
 */
function panel(id: 'accounts' | 'models' | 'diag'): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('.dsm-trae-panel'))
    .find(element => element.id === `dsm-trae-panel-${id}`)
  if (found === undefined) throw new Error(`no panel dsm-trae-panel-${id}`)
  return found
}

function tab(id: 'accounts' | 'models' | 'diag'): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"]'))
    .find(element => element.id === `dsm-trae-tab-${id}`)
  if (found === undefined) throw new Error(`no tab dsm-trae-tab-${id}`)
  return found
}

describe('the card splits into three sections', () => {
  it('opens on the account section, with the other two panels hidden', async () => {
    await renderOpen()
    expect(panel('accounts').hidden).toBe(false)
    expect(panel('models').hidden).toBe(true)
    expect(panel('diag').hidden).toBe(true)
  })

  it('shows the models section when its tab is clicked, and hides the account one', async () => {
    await renderOpen()
    fireEvent.click(tab('models'))
    expect(panel('models').hidden).toBe(false)
    expect(panel('accounts').hidden).toBe(true)
    // The panel is the real section, not a summary of it: the model list and
    // the save footer both live in there.
    expect(panel('models').querySelector('.dsm-trae-model-list')).not.toBeNull()
    expect(panel('models').querySelector('.dsm-trae-model-actions')).not.toBeNull()
  })

  it('shows the diagnostics facts when its tab is clicked', async () => {
    await renderOpen()
    fireEvent.click(tab('diag'))
    const text = panel('diag').textContent ?? ''
    expect(text).toContain('row.diagRegion')
    expect(text).toContain('row.tabCn')
    // The provider id is what a bug report is actually correlated on, so it is
    // printed verbatim rather than translated.
    expect(text).toContain('trae')
    expect(text).toContain('row.diagAccount')
    // …by NAME, not by id: the diagnostics panel must not print `account-1`.
    expect(text).toContain('LaoDing')
    expect(text).not.toContain('account-1')
    expect(text).toContain('row.diagCatalog')
    expect(text).toContain('row.diagEnabled')
    expect(text).toContain('row.diagNoFailures')
  })

  it('keeps the account and model panels mounted, so a draft survives the trip', async () => {
    await renderOpen()
    // Present in the DOM while hidden: remounting would refetch usage and drop
    // unsaved catalog edits.
    expect(panel('models').querySelector('.dsm-trae-model-list')).not.toBeNull()
    fireEvent.click(tab('models'))
    expect(panel('models').querySelector('.dsm-trae-model-list')).not.toBeNull()
    // The account section is likewise still there behind the models panel.
    expect(panel('accounts').querySelector('.dsm-trae-prefs')).not.toBeNull()
  })

  it('marks exactly one tab selected and points each tab at its panel', async () => {
    await renderOpen()
    const selected = (): HTMLButtonElement[] =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"][aria-selected="true"]'))

    expect(selected().map(button => button.id)).toEqual(['dsm-trae-tab-accounts'])
    expect(tab('accounts').getAttribute('aria-controls')).toBe('dsm-trae-panel-accounts')

    fireEvent.click(tab('diag'))
    expect(selected().map(button => button.id)).toEqual(['dsm-trae-tab-diag'])
    expect(tab('diag').getAttribute('aria-controls')).toBe('dsm-trae-panel-diag')

    // Every panel names the tab that labels it.
    for (const id of ['accounts', 'models', 'diag'] as const) {
      expect(panel(id).getAttribute('aria-labelledby')).toBe(`dsm-trae-tab-${id}`)
    }
  })

  it('keeps the region scope untouched when the section changes', async () => {
    await renderOpen()
    // The region row is a DIFFERENT tablist: these section tabs select a part
    // of one provider's card, never the provider itself.
    const regions = Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-tabs [role="tab"]'))
    expect(regions.map(button => button.textContent)).toHaveLength(3)
    const regionBefore = regions.find(button => button.getAttribute('aria-selected') === 'true')?.textContent

    fireEvent.click(tab('models'))
    const regionAfter = Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-tabs [role="tab"]'))
      .find(button => button.getAttribute('aria-selected') === 'true')?.textContent
    expect(regionAfter).toBe(regionBefore)
  })

  it('carries no control in the diagnostics section', async () => {
    await renderOpen()
    fireEvent.click(tab('diag'))
    // A diagnostics panel that can change settings is a settings panel with a
    // worse name. Nothing in it may be focusable.
    expect(panel('diag').querySelectorAll('button, input, select, textarea, a[href]').length).toBe(0)
  })

  it('reports the check-in from the check-in document, not from the pool', async () => {
    // `pool` is a separate, OPT-IN feature: a CN profile with the pool switched
    // off still offers the daily reward. Judging the diagnostics row from
    // `pool.checkinSupported` therefore printed "not offered here" on exactly
    // the panel that does offer it.
    await renderOpen(usageOf({
      checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true },
      pool: undefined,
    }))
    fireEvent.click(tab('diag'))
    const text = panel('diag').textContent ?? ''
    expect(text).toContain('row.diagCheckin')
    expect(text).toContain('row.diagCheckinOn')
    expect(text).not.toContain('row.diagCheckinOff')
  })

  it('renders EVERY model, with no inner scroller on the list', async () => {
    // The model list was briefly a max-height box with its own scrollbar, which
    // put the models a reader was looking for behind a second scroll gesture
    // inside a page that already scrolls. Every model is on the page now; the
    // only scroll is the card's own.
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: `m-${index}`,
      name: `Model ${index}`,
      contextWindow: 128_000,
    }))
    await renderOpen(usageOf({ models: many, enabledModelIds: ['m-0'] }))
    fireEvent.click(tab('models'))

    const rows = panel('models').querySelectorAll('.dsm-trae-model')
    expect(rows.length).toBe(many.length)
    // Not one row is hidden, clipped or collapsed: a `hidden` attribute here
    // would mean "a scroller with extra steps".
    expect(Array.from(rows).filter(row => (row as HTMLElement).hidden).length).toBe(0)

    // The stylesheet must not cap the list again: no max-height, and no
    // overflow-y that would manufacture a scrollbar for it.
    const rule = /\.dsm-trae-model-list\{([^}]*)\}/.exec(TRAE_CARD_CSS)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).not.toMatch(/max-height/)
    expect(rule?.[1]).not.toMatch(/overflow-y:\s*(auto|scroll)/)
  })

  it('renders no section tabs while signed out, and hides nothing', async () => {
    stubFetch({ status: 'signed-out', accounts: [], message: 'row.signedOutHint', searched: [] })
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await waitFor(() => { expect(screen.getByText('row.signedOutHint')).toBeTruthy() })

    expect(document.querySelector('#dsm-trae-tab-accounts')).toBeNull()
    // The one screen of instructions stays visible: `hidden` is never applied
    // without the tabs that could undo it.
    expect(panel('accounts').hidden).toBe(false)
  })
})
