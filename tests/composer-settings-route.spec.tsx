// @vitest-environment jsdom
/**
 * The credit popover's route to this plugin's settings page (m01198).
 *
 * The reported request: the panel header carried a "refresh credits" button,
 * which asked an upstream the panel already re-reads on open, on every account
 * switch and every five minutes. What a reader actually needs from that header
 * is the way to the plugin's own settings — which used to mean closing the
 * popover, finding the Plugins row and clicking the bundle.
 *
 * Two halves, pinned separately because they fail differently:
 *
 *  - `settings-route.ts` (pure) decides WHICH host route is taken. It is the one
 *    place that knows a plugin's settings live on the Plugins page rather than in
 *    Settings, and it must probe at PRESS time — the service it uses belongs to
 *    another bundle whose apply order is not ours to assume.
 *  - `ComposerPoints` owns the button: that it is drawn only when a route
 *    exists, that a press closes the popover, and that a host with no route says
 *    so instead of leaving a button that does nothing.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PLUGINS_PANEL_ID,
  TRAE_PACKAGE_NAME,
  openPluginSettingsPage,
} from '../src/client/settings-route.ts'
import { ComposerPoints } from '../src/client/ComposerPoints.tsx'
import { ComposerPointsGate } from '../src/client/ComposerPointsGate.tsx'
import { COMPOSER_POINTS_CSS } from '../src/client/styles.ts'
import { en, zh } from '../src/client/locales.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey) => key) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.querySelectorAll('.dsm-trae-composer-panel').forEach(node => { node.remove() })
})

function stubRoute(): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    const body = url.includes('/account-credits')
      ? { accounts: [{ id: 'account-1', accountName: 'LaoDing', selected: true, generalAvailable: 3392 }] }
      : {
          status: 'signed-in',
          accountId: 'account-1',
          accountName: 'LaoDing',
          tokenExpiresAtMs: Date.now() + 3_600_000,
          region: 'cn',
          accounts: [],
          models: [],
          enabledModelIds: [],
          credits: { total: 7500, consumed: 0, available: 4503, workAvailable: 1777, generalAvailable: 3392, accounts: [] },
        }
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

/** The settings button inside the open panel, or null. */
const settingsButton = (): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>('button.dsm-trae-composer-panel-settings')

/** Open the popover from the trigger and wait for the panel. */
async function openPanel(container: HTMLElement): Promise<void> {
  await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
  fireEvent.click(container.querySelector('button.dsm-trae-composer-points-trigger') as HTMLButtonElement)
  await waitFor(() => { expect(document.querySelector('[role="dialog"]')).not.toBeNull() })
}

describe('openPluginSettingsPage: which host route is taken', () => {
  it('opens the bundle page through pluginNavigation, by EXACT package name', () => {
    // Exact equality is the contract: the Plugins inventory compares `pkg.name`,
    // and a Loader entry id (`include:dsh-connect-trae`) would never match.
    const openBundle = vi.fn()
    const selectPanel = vi.fn()
    const opened = openPluginSettingsPage(name => ({
      pluginNavigation: { openBundle },
      layout: { selectPanel },
    })[name as 'pluginNavigation' | 'layout'])

    expect(opened).toBe(true)
    expect(openBundle).toHaveBeenCalledWith(TRAE_PACKAGE_NAME)
    // The published route wins; the layout fallback must NOT also fire, or the
    // user would land on the plugin LIST instead of this bundle's page.
    expect(selectPanel).not.toHaveBeenCalled()
  })

  it('falls back to the Plugins main panel when pluginNavigation is absent', () => {
    // A profile composed without the plugin-manager bundle still has the page
    // itself; landing on it is one click from the bundle row.
    const selectPanel = vi.fn()
    const opened = openPluginSettingsPage(name =>
      (name === 'layout' ? { selectPanel } : undefined))

    expect(opened).toBe(true)
    expect(selectPanel).toHaveBeenCalledWith(PLUGINS_PANEL_ID)
  })

  it('reports FALSE when neither route exists, instead of throwing', () => {
    // The caller is a click handler on a user's machine: "cannot" must not
    // become an exception there.
    expect(openPluginSettingsPage(() => undefined)).toBe(false)
  })

  it('falls through to layout when openBundle THROWS', () => {
    // `openBundle` refuses when the inventory does not list the package. The
    // Plugins page itself is still a better landing spot than nothing.
    const selectPanel = vi.fn()
    const opened = openPluginSettingsPage(name => (name === 'pluginNavigation'
      ? { openBundle: () => { throw new Error('no such bundle') } }
      : { selectPanel }))

    expect(opened).toBe(true)
    expect(selectPanel).toHaveBeenCalledWith(PLUGINS_PANEL_ID)
  })

  it('reports FALSE when BOTH routes throw, swallowing neither into a crash', () => {
    const opened = openPluginSettingsPage(name => (name === 'pluginNavigation'
      ? { openBundle: () => { throw new Error('refused') } }
      : { selectPanel: () => { throw new Error('unregistered key') } }))

    expect(opened).toBe(false)
  })

  it('probes the services on EVERY call, so one that appears later is found', () => {
    // `pluginNavigation` is provided by the Plugins bundle, whose apply order is
    // not ours to assume. Probing once in `apply` would capture `undefined`
    // permanently and leave the button dead for the whole session.
    const openBundle = vi.fn()
    let served: unknown
    const get = (name: string): unknown => (name === 'pluginNavigation' ? served : undefined)

    expect(openPluginSettingsPage(get)).toBe(false)
    served = { openBundle }
    expect(openPluginSettingsPage(get)).toBe(true)
    expect(openBundle).toHaveBeenCalledTimes(1)
  })
})

describe('the panel header carries a SETTINGS button', () => {
  it('is drawn when a route exists, and a press opens the page then CLOSES the panel', async () => {
    stubRoute()
    const onOpenSettings = vi.fn(() => true)
    const { container } = render(
      <ComposerPoints t={t} provider="trae" region="cn" onOpenSettings={onOpenSettings} />,
    )
    await openPanel(container)

    const button = settingsButton()
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('composer.openSettings')
    fireEvent.click(button as HTMLButtonElement)

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    // CLOSING IS PART OF THE JOB: the panel is portaled to `document.body`, so
    // navigating the centre column does not remove it — leaving it open would
    // park a credits table on top of the page the user just asked for.
    await waitFor(() => { expect(document.querySelector('[role="dialog"]')).toBeNull() })
  })

  it('is drawn on the INTERNATIONAL panel too, not just the CN one', async () => {
    // The report that asked for this (m01198) was about the GLOBAL panel — it
    // read 「Trae 国际版套餐」 and its rows carried plans, not balances. The
    // header is shared, but "shared" is an assumption a test should hold: the two
    // regions already diverge in the table (a plan column, a different fetch
    // route), so a future edit could easily make the button CN-only by accident.
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      calls.push(String(input))
      return new Response(JSON.stringify({
        status: 'signed-in',
        accountId: 'ai-1',
        accountName: 'dingminhua',
        tokenExpiresAtMs: Date.now() + 3_600_000,
        region: 'ai',
        accounts: [
          { id: 'ai-1', accountName: 'dingminhua', edition: 'sg', region: 'ai', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
        ],
        models: [],
        enabledModelIds: [],
        payStatus: { isDollarUsageBilling: true, hasPackage: false, inTrial: false, trialEndTimeMs: 0, payIdentity: 5, payIdentityStr: 'Free' },
      }), { status: 200 })
    })
    const onOpenSettings = vi.fn(() => true)
    const { container } = render(
      <ComposerPoints t={t} provider="trae-global" region="ai" onOpenSettings={onOpenSettings} />,
    )
    await openPanel(container)

    // It is the INTERNATIONAL panel that is open (its own aria-label), and the
    // settings control is there beside that title.
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('composer.panelTitleGlobal')
    expect(settingsButton()).not.toBeNull()
    fireEvent.click(settingsButton() as HTMLButtonElement)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('is NOT drawn when no route was injected', async () => {
    // The same rule the page header's back button follows: a control that cannot
    // do anything must not be drawn.
    stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)

    expect(settingsButton()).toBeNull()
    // Nor does the panel keep the old refresh button around as a fallback.
    expect(document.querySelector('.dsm-trae-composer-panel-refresh')).toBeNull()
  })

  it('reports the missing route instead of silently doing nothing', async () => {
    // A press that changes nothing on screen is indistinguishable from a broken
    // button; the honest answer is "this host has no way there".
    stubRoute()
    const onOpenSettings = vi.fn(() => false)
    const { container } = render(
      <ComposerPoints t={t} provider="trae" region="cn" onOpenSettings={onOpenSettings} />,
    )
    await openPanel(container)

    fireEvent.click(settingsButton() as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.openSettingsFailed/)).toBeTruthy() })
    // The panel STAYS OPEN: there was nowhere to go, so dismissing it would look
    // like the press had worked.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('keeps its own error line, so a failed read does not erase it (and vice versa)', async () => {
    // `failed` and `settingsFailed` say different things. Sharing one flag would
    // let either press erase the other's explanation.
    stubRoute()
    const { container } = render(
      <ComposerPoints t={t} provider="trae" region="cn" onOpenSettings={() => false} />,
    )
    await openPanel(container)
    fireEvent.click(settingsButton() as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.openSettingsFailed/)).toBeTruthy() })
    expect(screen.queryByText(/composer\.refreshFailed/)).toBeNull()
  })

  it('passes through the GATE, so the shipped wiring actually reaches it', async () => {
    // `ComposerPointsGate` is what the entry registers. Without this case the
    // route could be wired into the entry and dropped by the gate, and every
    // other assertion here would still pass.
    stubRoute()
    const value = { showPointsInMainUi: true, creditPosition: { cn: 'composer' } }
    const scope = {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    }
    const onOpenSettings = vi.fn(() => true)
    const { container } = render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        onOpenSettings={onOpenSettings}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    await openPanel(container)
    fireEvent.click(settingsButton() as HTMLButtonElement)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})

describe('the replacement left nothing behind', () => {
  it('drops the refresh keys from BOTH dictionaries', () => {
    // The button is gone, so its copy must be too. Two dead locale entries are
    // how "we removed the feature" turns into "we removed its rendering".
    for (const table of [en, zh]) {
      expect(Object.keys(table).filter(key => /^composer\.refresh(ing)?$/.test(key))).toEqual([])
    }
    expect(zh['composer.openSettings']).toBe('设置')
    expect(en['composer.openSettings']).toBe('Settings')
  })

  it('styles the new class and leaves no rule for the removed one', () => {
    // `composer-styles.spec.tsx` asserts every rendered class HAS a rule; this
    // asserts the reverse — that the old rule went with the old button, so a
    // future reader does not mistake it for something still in use.
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-settings{')
    expect(COMPOSER_POINTS_CSS).not.toContain('.dsm-trae-composer-panel-refresh')
  })

  it('keeps the settings button buttonable while an account switch is in flight', () => {
    // Not disabled by `busy`: opening the settings page is a navigation, and a
    // five-minute read blocking it would make the control look broken.
    const rule = /\.dsm-trae-composer-panel-settings\{[^}]*\}/.exec(COMPOSER_POINTS_CSS)
    expect(rule).not.toBeNull()
    expect(rule?.[0]).toContain('cursor:pointer')
  })
})
