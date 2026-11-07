// @vitest-environment jsdom
/**
 * The OPTIONAL sidebar panel (`Config.sidebarPanel`, default false), ported from
 * the sibling `dsh-connect-workbuddy` plugin's PR #188.
 *
 * ## Why this suite exists
 *
 * WorkBuddy shipped that panel unconditional first: every install grew a sidebar
 * row and a `main` page whether the user wanted them or not. That is exactly the
 * class of change this plugin refuses everywhere else (image generation, the
 * video tool, the composer readout — every one ships OFF with a switch), and this
 * row is worse than most because it claims a GLOBAL seat every installed bundle
 * shares, while the Plugins page already reaches the same card.
 *
 * So the panel is gated on `Config.sidebarPanel` (default false), and this file
 * pins the four things that make that gate real:
 *
 *   DEFAULT   Absent settings read OFF, from the schema AND from every reader.
 *             An upgrade must not re-arrange a sidebar nobody asked to change.
 *   OFF       OFF registers no `sidebar.panellist` entry and no `main` entry.
 *             The row is built from ENTRY METADATA, so a component returning
 *             null would render a blank but still-clickable button: the entry
 *             must not register at all.
 *   LIVE      The switch can turn the row on AND off without a reload, which is
 *             the store the entry subscribes to.
 *   HOST      The switch is seeded from the Host's status document, because this
 *             namespace's browser mirror is documented as stale on the affected
 *             0.1.7 deployments — a stale `false` must not hide a served row.
 *
 * The card assertions click the REAL input of the shipped card and check the
 * settings WRITE, exactly like `card-composer-credits-switch.spec.tsx`: a switch
 * that paints but never persists leaves the feature unreachable with no way for
 * the user to tell.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  resetSidebarPanelWanted, setSidebarPanelWanted, sidebarPanelEnabledOf,
  sidebarPanelWanted, subscribeSidebarPanelWanted,
} from '../src/client/panel-switch.ts'
import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetSidebarPanelWanted()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

function usageDocument(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [{ id: 'account-1', accountName: 'demo-user', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true }],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    ...extra,
  }
}

function stubUsage(document: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(document), { status: 200 }))
}

/** A settings scope over a mutable document, recording every write. */
function makeScope(initial: Record<string, unknown>, writable = true) {
  let value: Record<string, unknown> = { ...initial }
  const listeners = new Set<() => void>()
  const writes: { field: string; value: unknown }[] = []
  return {
    writes,
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        writes.push({ field, value: next })
        value = { ...value, [field]: next }
        for (const listener of listeners) listener()
      },
    },
  }
}

/** The sidebar-row checkbox, found by its own label (never by position). */
function sidebarSwitch(): HTMLInputElement {
  const [box] = screen.getAllByRole('checkbox', { name: /^row\.sidebarPanelLabel\b/ }) as HTMLInputElement[]
  if (box === undefined) throw new Error('the sidebar-panel checkbox is missing from the card')
  return box
}

/**
 * Open the card, land on the 「能力」 section, and wait for its first document.
 *
 * The sidebar-row switch moved out of the account section: it grants something
 * the plugin may do, which is not "which account is serving". So these tests
 * have to open that section first — the switch being unreachable from the
 * default tab is the point of the move, not an accident of it.
 */
async function renderOpen(scope: unknown): Promise<void> {
  stubUsage(usageDocument())
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await screen.findByText('row.tabHint')
  const capabilities = Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"]'))
    .find(element => element.id === 'dsm-trae-tab-capabilities')
  if (capabilities === undefined) throw new Error('no capabilities tab')
  fireEvent.click(capabilities)
}

describe('the switch reads OFF unless explicitly on', () => {
  it('reads OFF for every shape that is not an explicit true', () => {
    expect(sidebarPanelEnabledOf(undefined)).toBe(false)
    expect(sidebarPanelEnabledOf({})).toBe(false)
    expect(sidebarPanelEnabledOf({ sidebarPanel: false })).toBe(false)
    // A stringified boolean is a settings-file typo, not consent.
    expect(sidebarPanelEnabledOf({ sidebarPanel: 'true' })).toBe(false)
    expect(sidebarPanelEnabledOf({ sidebarPanel: 1 })).toBe(false)
    // A neighbouring switch must never be mistaken for this one.
    expect(sidebarPanelEnabledOf({ showPointsInMainUi: true })).toBe(false)
  })

  it('reads ON only for an explicit boolean true', () => {
    expect(sidebarPanelEnabledOf({ sidebarPanel: true })).toBe(true)
  })

  it('unwraps a volatile live reference before comparing', () => {
    // DSH 0.1.7 hands volatile fields back as `{get(): T}`, which is a truthy
    // non-boolean — reading it as-is would report every config as switched on.
    expect(sidebarPanelEnabledOf({ sidebarPanel: { get: () => true } })).toBe(true)
    expect(sidebarPanelEnabledOf({ sidebarPanel: { get: () => false } })).toBe(false)
  })

  it('is OFF by default in the Host schema', () => {
    const schema = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8')
    const declaration = /sidebarPanel:\s*asVolatile\(([\s\S]*?)\n\s*\)\s*as unknown as z<boolean>/.exec(schema)
    expect(declaration, 'sidebarPanel must be declared as a volatile boolean in Config').not.toBeNull()
    expect(declaration?.[1]).toContain('.default(false)')
  })
})

describe('the panel-switch store', () => {
  it('starts OFF, notifies on change, and stops after unsubscribe', () => {
    expect(sidebarPanelWanted()).toBe(false)
    const seen: boolean[] = []
    const stop = subscribeSidebarPanelWanted(() => { seen.push(sidebarPanelWanted()) })
    setSidebarPanelWanted(true)
    // Idempotent: the same value must not churn the registrations.
    setSidebarPanelWanted(true)
    setSidebarPanelWanted(false)
    stop()
    setSidebarPanelWanted(true)
    expect(seen).toEqual([true, false])
    expect(sidebarPanelWanted()).toBe(true)
  })

  it('does not let one throwing listener strand the rest', () => {
    const seen: string[] = []
    subscribeSidebarPanelWanted(() => { throw new Error('boom') })
    subscribeSidebarPanelWanted(() => { seen.push('second') })
    expect(() => { setSidebarPanelWanted(true) }).not.toThrow()
    expect(seen).toEqual(['second'])
  })
})

describe('the card switch', () => {
  it('renders UNCHECKED when neither the settings document nor the Host has ever set it', async () => {
    await renderOpen(makeScope({}).scope)
    expect(sidebarSwitch().checked).toBe(false)
  })

  it('is checked when the stored value is true, so an existing opt-in survives', async () => {
    await renderOpen(makeScope({ sidebarPanel: true }).scope)
    expect(sidebarSwitch().checked).toBe(true)
  })

  it('falls back to the HOST answer when the settings namespace is not served', async () => {
    // The 0.1.7 mirror can be stale, or not bound yet. A served row must not
    // render switched off just because the mirror says nothing.
    stubUsage(usageDocument({ sidebarPanelEnabled: true }))
    render(<TraeUsageCard t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await screen.findByText('row.tabHint')
    // The switch lives in 「能力」 now, so that section must be shown before the
    // box exists in the accessibility tree.
    const capabilities = Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"]'))
      .find(element => element.id === 'dsm-trae-tab-capabilities')
    if (capabilities === undefined) throw new Error('no capabilities tab')
    fireEvent.click(capabilities)
    expect(sidebarSwitch().checked).toBe(true)
  })

  it('writes the field on the click that flips it — there is no 保存 to press', async () => {
    const holder = makeScope({})
    await renderOpen(holder.scope)
    fireEvent.click(sidebarSwitch())
    await vi.waitFor(() => { expect(holder.writes.length).toBeGreaterThan(0) })
    expect(holder.writes).toEqual([{ field: 'sidebarPanel', value: true }])
    // Publishing the store is what makes the row exist — the entry subscribes to
    // it, and the row is built from slot entry metadata. It happens after the
    // write is confirmed, so it is awaited rather than read synchronously.
    await vi.waitFor(() => { expect(sidebarPanelWanted()).toBe(true) })
  })

  it('writes false when unticked again, and the entry loses the row', async () => {
    const holder = makeScope({ sidebarPanel: true })
    setSidebarPanelWanted(true)
    await renderOpen(holder.scope)
    fireEvent.click(sidebarSwitch())
    await vi.waitFor(() => { expect(holder.writes.length).toBeGreaterThan(0) })
    expect(holder.writes).toEqual([{ field: 'sidebarPanel', value: false }])
    await vi.waitFor(() => { expect(sidebarPanelWanted()).toBe(false) })
  })

  it('reports a refused write instead of leaving the box claiming it saved', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(usageDocument()), { status: 200 }))
    // A scope that accepts the call and silently drops the value: the read-back
    // guard must turn that into an error line, because a switch that paints but
    // does not persist is unreachable in the worst way.
    const scope = {
      getSnapshot: () => ({ status: 'ready', value: {}, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    }
    render(<TraeUsageCard t={t} settingsScope={scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await screen.findByText('row.tabHint')
    const capabilities = Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"]'))
      .find(element => element.id === 'dsm-trae-tab-capabilities')
    if (capabilities === undefined) throw new Error('no capabilities tab')
    fireEvent.click(capabilities)
    fireEvent.click(sidebarSwitch())
    await screen.findByRole('alert')
    // The store must NOT be published on a write that did not land.
    expect(sidebarPanelWanted()).toBe(false)
  })
})

describe('the page surface', () => {
  it('renders expanded with its own header and a back control, not card chrome', async () => {
    stubUsage(usageDocument())
    const back = vi.fn()
    const { container } = render(
      <TraeUsageCard t={t} settingsScope={makeScope({}).scope as never} surface="page" backToConversation={back} />,
    )
    // No collapse affordance on a page: there is nothing to collapse to.
    expect(container.querySelector('.dsm-plugin-card')).toBeNull()
    expect(screen.queryByRole('button', { name: /row\.expand|row\.collapse/ })).toBeNull()
    // The body is present without any click, and the header names the page.
    expect(container.querySelector('.dsm-trae-page')).not.toBeNull()
    expect(container.querySelector('.dsm-trae-page-title')?.textContent).toBe('row.title')
    // The credits switch still lives in the body: it is the same card.
    expect(screen.getAllByRole('checkbox', { name: /^row\.showPointsInMainUi\b/ }).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /row\.pageBack/ }))
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('omits the back control rather than drawing it dead when the host has no layout service', async () => {
    stubUsage(usageDocument())
    render(<TraeUsageCard t={t} settingsScope={makeScope({}).scope as never} surface="page" />)
    expect(screen.queryByRole('button', { name: /row\.pageBack/ })).toBeNull()
  })
})

describe('the client entry registers the panel only when switched on', () => {
  const entry = readFileSync(join(process.cwd(), 'src/client/index.tsx'), 'utf8')

  it('gates the registration on the store, and seeds it from the Host', () => {
    // The gate itself.
    expect(entry).toMatch(/if \(!sidebarPanelWanted\(\)\) return/u)
    // The subscription that makes the switch live.
    expect(entry).toContain('subscribeSidebarPanelWanted(syncPanelRegistration)')
    // The Host seed. OFF is the default, so only an explicit `true` may turn it
    // on — a failed read must leave the row absent.
    expect(entry).toContain('document.sidebarPanelEnabled === true')
  })

  it('registers the row and the page under ONE id, the host’s panel contract', () => {
    // `sidebar.panellist` addresses `main` by list id, so the two registrations
    // must share it or the row would open nothing.
    expect(entry).toMatch(/const PANEL_ID = 'dsh-connect-trae'/u)
    expect(entry).toMatch(/name: 'sidebar\.panellist',\s*\n\s*id: PANEL_ID/u)
    expect(entry).toMatch(/name: 'main',\s*\n\s*key: PANEL_ID/u)
    // Both go through `registerSlotEntry` now (issue #74), which owns the
    // dispose-before-register ordering and the in-callback catch. The seats are
    // named by their slot key, so the two registrations are still visibly
    // distinct entries rather than one conflated call.
    expect(entry).toContain("registerSlotEntry(ctx, 'sidebar.panellist#dsh-connect-trae', 'sidebar.panellist'")
    expect(entry).toMatch(/registerSlotEntry\(ctx, `main#\$\{PANEL_ID\}`, 'main'/u)
  })

  it('passes the page surface and the back action to the card', () => {
    expect(entry).toContain("surface: 'page' as const")
    expect(entry).toContain('backToConversation')
    // Soft-probed through `ctx.get()`, never declared in `inject`: an absent
    // service in `inject` keeps `apply` from running at all.
    expect(entry).toMatch(/softGet\('layout'\)/u)
  })
})
