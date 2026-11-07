// @vitest-environment jsdom
/**
 * The credit popover's route to this plugin's settings page (m01198, restored
 * m02517).
 *
 * WHAT CHANGED AND WHY THIS FILE WAS REWRITTEN: the 4.9.0 line removed the pill
 * on the claim that "no client service opens the Settings dialog on a section".
 * The owner corrected that — clicking through the sidebar DOES open the wide
 * settings — so the pill came back on a different route. The old route probed
 * `pluginNavigation.openBundle` and fell back to `layout.selectPanel('plugins')`;
 * both address the **Plugins** page, which stopped holding this plugin's
 * configuration when it moved to its own `settings.section`. The new route
 * drives the settings shell's own store seat. The old two-route cases therefore
 * do not describe the shipped code any more and are replaced, not patched.
 *
 * Two halves, pinned separately because they fail differently:
 *
 *  - `settings-route.ts` (pure) decides WHICH seam is used, and must probe at
 *    PRESS time: the shell is another bundle whose apply order is not ours to
 *    assume, and `entries()` answers `[]` until it has registered.
 *  - `ComposerPoints` owns the button: that it is drawn only when a route
 *    exists, that a press closes the popover, and that a host with no route says
 *    so instead of leaving a button that does nothing.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SETTINGS_SLOT,
  TRAE_SETTINGS_ID,
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
      ? { accounts: [{ id: 'account-1', accountName: 'demo-user', selected: true, generalAvailable: 3392 }] }
      : {
          status: 'signed-in',
          accountId: 'account-1',
          accountName: 'demo-user',
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

/**
 * A stand-in for the settings shell's published store seat.
 *
 * Mirrors the shape the shell actually registers — `create()` returning the one
 * live instance whose `actions` hold `openSection` — so the route is exercised
 * against the real contract rather than a bare `vi.fn`.
 */
function shellSeat(): { openSection: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn>; entries: ReturnType<typeof vi.fn> } {
  const openSection = vi.fn()
  const open = vi.fn()
  const instance = { actions: { openSection, open } }
  const entries = vi.fn((key: string) => (key === SETTINGS_SLOT
    ? [{ store: { create: () => instance } }]
    : []))
  return { openSection, open, entries }
}

/** A `get` probe serving the slots service described by `seat`. */
const probe = (seat: { entries: unknown } | undefined) =>
  (name: string): unknown => (name === 'slots' ? seat : undefined)

/** The option bag every route test needs: a label thunk and a no-op fallback. */
function routeOptions(extra: Partial<Parameters<typeof openPluginSettingsPage>[1]> = {}) {
  return { label: () => 'dsh-connect-trae', ...extra }
}

/** A settings panel carrying the given nav-row labels. */
function panelWith(labels: string[]): HTMLElement {
  const panel = document.createElement('div')
  panel.setAttribute('data-shortcut-modal', 'settings')
  for (const label of labels) {
    const button = document.createElement('button')
    button.textContent = label
    panel.append(button)
  }
  return panel
}

/** The sidebar trigger the shell renders. */
function trigger(expanded = 'false'): HTMLButtonElement {
  const button = document.createElement('button')
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-expanded', expanded)
  return button
}

/** Run every scheduled callback immediately. */
const flush = (run: () => void): void => { run() }

describe('openPluginSettingsPage: route 1, the shell store seat', () => {
  it('opens THIS plugin\'s section through the shell store seat', () => {
    // The finding the module records: the shell pins `create: () => shellInstance`
    // onto its `sidebar.settings` registration precisely so a reader of the seat
    // gets the live dialog. `openSection(id)` sets `activeId` and `open` at once,
    // which is the whole job of this button.
    const seat = shellSeat()
    const opened = openPluginSettingsPage(probe(seat), routeOptions())

    expect(opened).toBe(true)
    expect(seat.openSection).toHaveBeenCalledWith(TRAE_SETTINGS_ID)
    // The id must be the SAME string the page registers under, or the dialog
    // opens on the shell's fallback section and no error says so.
    expect(TRAE_SETTINGS_ID).toBe('dsh-connect-trae')
    // `open` alone would land on whatever section was last active; `openSection`
    // is the specific seam and must not be bypassed by the fallback.
    expect(seat.open).not.toHaveBeenCalled()
  })

  it('reads the SEAT for this slot, not some other slot', () => {
    const seat = shellSeat()
    openPluginSettingsPage(probe(seat), routeOptions())
    expect(seat.entries).toHaveBeenCalledWith(SETTINGS_SLOT)
    expect(SETTINGS_SLOT).toBe('sidebar.settings')
  })

  it('still reaches the RIGHT page when the seat only offers open()', () => {
    // THE POINT OF TWO ROUTES. A shell whose store predates `openSection` can
    // open the dialog but not preselect it. The 4.9.x code returned `true` here
    // and left the user on whichever section the shell defaults to — the button
    // claimed success and did something other than what its label says.
    //
    // Now `open()` runs (the panel is up) and route 2 clicks this plugin's nav
    // row, so the user lands on the page the button names.
    document.body.innerHTML = ''
    let jumped = 0
    const panel = panelWith(['通用', 'dsh-connect-trae', '插件'])
    document.body.append(panel)
    panel.children[1]?.addEventListener('click', () => { jumped += 1 })

    const open = vi.fn()
    const opened = openPluginSettingsPage(probe({
      entries: () => [{ store: { create: () => ({ actions: { open } }) } }],
    }), routeOptions({ schedule: flush }))

    expect(opened).toBe(true)
    // The dialog was opened...
    expect(open).toHaveBeenCalledTimes(1)
    // ...and the row was then clicked, so the landing section is the right one.
    expect(jumped, 'route 2 never clicked this plugin\'s nav row').toBe(1)
  })

  it('reports FALSE when the slots service is absent, instead of throwing', () => {
    // The caller is a click handler on a user's machine: "cannot" must not
    // become an exception there.
    document.body.innerHTML = ''
    expect(openPluginSettingsPage(() => undefined, routeOptions({ schedule: flush }))).toBe(false)
  })

  it('reports FALSE when the shell has not registered the slot yet', () => {
    // `entries()` answers `[]` until the shell's `whenAccess('settings/describe')`
    // gate passes and it registers. That is a host state, not an error.
    document.body.innerHTML = ''
    expect(openPluginSettingsPage(probe({ entries: () => [] }), routeOptions({ schedule: flush }))).toBe(false)
  })

  it('reports FALSE when the seat carries no store', () => {
    // A `sidebar.settings` registration that declared no store seat. Both
    // `undefined` and a non-object must land here rather than being called.
    document.body.innerHTML = ''
    expect(openPluginSettingsPage(probe({ entries: () => [{ }] }), routeOptions({ schedule: flush }))).toBe(false)
    expect(openPluginSettingsPage(probe({ entries: () => [{ store: null }] }), routeOptions({ schedule: flush }))).toBe(false)
  })

  it('reports FALSE when the seat declares a store but no create()', () => {
    document.body.innerHTML = ''
    expect(openPluginSettingsPage(probe({ entries: () => [{ store: {} }] }), routeOptions({ schedule: flush }))).toBe(false)
  })

  it('reports FALSE when create() or a baked action THROWS', () => {
    // Another bundle's code. A composed profile can replace `slots` with
    // something that refuses, and the press must survive it.
    document.body.innerHTML = ''
    expect(openPluginSettingsPage(probe({
      entries: () => [{ store: { create: () => { throw new Error('refused') } } }],
    }), routeOptions({ schedule: flush }))).toBe(false)
    expect(openPluginSettingsPage(probe({
      entries: () => [{ store: { create: () => ({ actions: { openSection: () => { throw new Error('no') } } }) } }],
    }), routeOptions({ schedule: flush }))).toBe(false)
  })

  it('probes the service on EVERY call, so a shell that appears later is found', () => {
    // The shell is provided by another bundle whose apply order is not ours to
    // assume. Probing once in `apply` would capture `undefined` permanently and
    // leave the button dead for the whole session.
    document.body.innerHTML = ''
    let served: unknown
    const get = (name: string): unknown => (name === 'slots' ? served : undefined)

    expect(openPluginSettingsPage(get, routeOptions({ schedule: flush }))).toBe(false)
    const seat = shellSeat()
    served = seat
    expect(openPluginSettingsPage(get, routeOptions())).toBe(true)
    expect(seat.openSection).toHaveBeenCalledTimes(1)
  })
})

describe('openPluginSettingsPage: route 2, driving the chrome', () => {
  it('clicks this plugin\'s row when the panel is already open', () => {
    document.body.innerHTML = ''
    let jumped = 0
    const panel = panelWith(['通用', 'dsh-connect-trae', '插件'])
    document.body.append(panel)
    panel.children[1]?.addEventListener('click', () => { jumped += 1 })

    // No trigger anywhere: an already-open panel must not be toggled shut.
    const result = openPluginSettingsPage(() => undefined, routeOptions({ schedule: flush }))
    expect(result, 'the panel was there but the jump reported nothing to drive').toBe(true)
    expect(jumped, 'the row was never clicked').toBe(1)
  })

  it('drives the trigger first when no panel is mounted', () => {
    document.body.innerHTML = ''
    let triggerClicks = 0
    // The shell mounts the panel in response to the trigger, which is what the
    // retry loop exists for: the rows are not queryable on the same frame.
    const button = trigger('false')
    button.addEventListener('click', () => {
      triggerClicks += 1
      document.body.append(panelWith(['通用', 'dsh-connect-trae']))
    })
    document.body.append(button)

    expect(openPluginSettingsPage(() => undefined, routeOptions({ schedule: flush }))).toBe(true)
    expect(triggerClicks).toBe(1)
  })

  it('does NOT click a trigger that is already expanded', () => {
    // Clicking an expanded trigger CLOSES the dialog, which would read as the
    // settings window flickering shut instead of opening.
    document.body.innerHTML = ''
    let triggerClicks = 0
    const button = trigger('true')
    button.addEventListener('click', () => { triggerClicks += 1 })
    document.body.append(button)
    document.body.append(panelWith(['dsh-connect-trae']))

    openPluginSettingsPage(() => undefined, routeOptions({ schedule: flush }))
    expect(triggerClicks, 'an already-open panel was toggled shut').toBe(0)
  })

  it('matches the row by EXACT label, not by substring', () => {
    // 「模型」 is a substring of 「模型与预设」 on a differently worded shell; a
    // loose match would click the wrong row and the user lands on someone
    // else's page with no explanation.
    document.body.innerHTML = ''
    let right = 0
    let wrong = 0
    const panel = panelWith(['模型与预设', 'dsh-connect-trae'])
    document.body.append(panel)
    panel.children[0]?.addEventListener('click', () => { wrong += 1 })
    panel.children[1]?.addEventListener('click', () => { right += 1 })

    openPluginSettingsPage(() => undefined, routeOptions({ schedule: flush }))
    expect(right).toBe(1)
    expect(wrong).toBe(0)
  })

  it('calls onGiveUp when there is no trigger at all', () => {
    // A host with no settings panel (or a sidebar collapsed to the rail). Do
    // not guess: take the caller's fallback rather than leaving a dead button.
    document.body.innerHTML = ''
    const giveUp = vi.fn()
    const result = openPluginSettingsPage(() => undefined, routeOptions({ schedule: flush, onGiveUp: giveUp }))
    expect(result).toBe(false)
    expect(giveUp).toHaveBeenCalledTimes(1)
  })

  it('calls onGiveUp after the LAST retry, not the first miss', () => {
    // A panel that has mounted while its rows are still rendering is normal;
    // giving up on the first attempt would abandon a shell that was about to
    // work.
    document.body.innerHTML = ''
    document.body.append(panelWith(['通用', '插件']))  // mounted, no row for us
    const giveUp = vi.fn()
    const scheduled: Array<() => void> = []
    openPluginSettingsPage(() => undefined, routeOptions({
      onGiveUp: giveUp,
      schedule: (run) => { scheduled.push(run) },
    }))
    // Run the retries one by one: the fallback must not fire on the first.
    for (const run of scheduled) {
      expect(giveUp, 'gave up before the retry budget was spent').not.toHaveBeenCalled()
      run()
    }
    expect(giveUp).toHaveBeenCalledTimes(1)
  })

  it('re-reads the label on every press, so a language switch still matches', () => {
    document.body.innerHTML = ''
    let jumped = 0
    const panel = panelWith(['dsh-connect-trae'])
    document.body.append(panel)
    panel.children[0]?.addEventListener('click', () => { jumped += 1 })

    let language = 'zh'
    const label = (): string => (language === 'zh' ? 'dsh-connect-trae' : 'Trae')
    expect(openPluginSettingsPage(() => undefined, routeOptions({ label, schedule: flush }))).toBe(true)
    expect(jumped).toBe(1)

    // Switched language: the same thunk must now resolve to the new row.
    document.body.innerHTML = ''
    let jumpedEn = 0
    const enPanel = panelWith(['Trae'])
    document.body.append(enPanel)
    enPanel.children[0]?.addEventListener('click', () => { jumpedEn += 1 })
    language = 'en'
    expect(openPluginSettingsPage(() => undefined, routeOptions({ label, schedule: flush }))).toBe(true)
    expect(jumpedEn, 'the label was captured instead of re-read').toBe(1)
  })

  it('never throws, whatever the shell looks like', () => {
    // Every path runs from a click handler on a render path; a throw here would
    // take out the whole readout, not one button.
    document.body.innerHTML = ''
    const hostile = {
      querySelector: () => { throw new Error('nope') },
      querySelectorAll: () => { throw new Error('nope') },
    } as unknown as Document
    expect(() => openPluginSettingsPage(() => undefined, routeOptions({ doc: hostile, schedule: flush }))).not.toThrow()
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
    // opening the dialog does not remove it — leaving it open would park a
    // credits table on top of the page the user just asked for.
    await waitFor(() => { expect(document.querySelector('[role="dialog"]')).toBeNull() })
  })

  it('is drawn on the INTERNATIONAL panel too, not just the CN one', async () => {
    // The report that asked for this (m01198) was about the GLOBAL panel — it
    // read 「Trae 国际版套餐」 and its rows carried plans, not balances. The
    // header is shared, but "shared" is an assumption a test should hold: the two
    // regions already diverge in the table (a plan column, a different fetch
    // route), so a future edit could easily make the button CN-only by accident.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
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
    }), { status: 200 }))
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

describe('the restored pill kept its shape', () => {
  it('restores the settings keys in BOTH dictionaries', () => {
    // The pill is back, so its copy must be too — and in both languages: the zh
    // bundle is first-class here, not a translation bolted on afterwards.
    expect(zh['composer.openSettings']).toBe('设置')
    expect(en['composer.openSettings']).toBe('Settings')
    expect(zh['composer.openSettingsHint']).toBe('打开本插件的设置页')
    expect(en['composer.openSettingsHint']).toBe('Open this plugin\'s settings page')
    expect(zh['composer.openSettingsFailed']).toBe('这个宿主没有通向插件设置页的入口')
    expect(en['composer.openSettingsFailed']).toBe('This host has no route to the plugin settings page')
  })

  it('styles the restored class and keeps the old refresh rule out', () => {
    // `composer-styles.spec.tsx` asserts every rendered class HAS a rule; this
    // asserts the other direction — the removed refresh control left no rule
    // behind for a future reader to mistake for something still in use.
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-settings{')
    expect(COMPOSER_POINTS_CSS).not.toContain('.dsm-trae-composer-panel-refresh')
  })

  it('keeps the settings button clickable', () => {
    const rule = /\.dsm-trae-composer-panel-settings\{[^}]*\}/.exec(COMPOSER_POINTS_CSS)
    expect(rule).not.toBeNull()
    expect(rule?.[0]).toContain('cursor:pointer')
  })
})

describe('the button copies the sibling workbuddy pill (m01930)', () => {
  /**
   * The owner asked for the SAME control style as `dsh-connect-workbuddy`, which
   * solved this exact problem in the same place: a settings link in a ~250px
   * credit popover's header.
   *
   * Those are CSS strings, so jsdom cannot cascade them — the assertions are
   * structural, on the shipped rule text. They are worth having anyway, because
   * the failure mode here is silent: every behavioural case above still passes if
   * this rule is reverted to a bordered box, and only a reader looking at a
   * screenshot would notice the two connectors had drifted apart.
   */
  const rule = (): string => {
    const found = /\.dsm-trae-composer-panel-settings\{[^}]*\}/.exec(COMPOSER_POINTS_CSS)
    if (found === null) throw new Error('the settings rule is missing')
    return found[0]
  }

  it('is a PILL (999px radius), not a bordered box and not an underlined link', () => {
    expect(rule()).toContain('border-radius:999px')
    // A bordered box was the first version; an underline was workbuddy's first
    // version. Both were rejected for the same reason: neither has a SHAPE at
    // rest, and the affordance is needed before the pointer arrives.
    expect(rule()).toContain('border:1px solid transparent')
    expect(COMPOSER_POINTS_CSS).not.toMatch(/\.dsm-trae-composer-panel-settings\{[^}]*text-decoration:underline/)
  })

  it('is tinted with the BRAND colour at 10%, so it reads as a product action', () => {
    // Not a fourth grey chip beside the title, and not the label-secondary grey
    // the previous version used.
    expect(rule()).toContain('background:rgba(86,134,254,.10)')
    expect(rule()).toContain('color:var(--dsw-alias-brand-primary,#5686fe)')
    expect(rule()).toContain('font-weight:500')
  })

  it('has the same three hover/active/focus states as its sibling', () => {
    // A pill whose hover does nothing reads as disabled.
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-settings:hover:not(:disabled){')
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-settings:active{background:rgba(86,134,254,.26)}')
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-settings:focus-visible{')
  })

  it('honours reduced motion, because the colour transition is decoration', () => {
    const media = /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.dsm-trae-composer-panel-settings\{transition:none\}/.exec(COMPOSER_POINTS_CSS)
    expect(media).not.toBeNull()
  })

  it('carries a GEAR icon and a non-wrapping label, both sized so they cannot squash', async () => {
    // Rendered, not just styled: the icon is part of what makes the pill read as
    // a control, so its absence is a visual regression the CSS alone cannot show.
    stubRoute()
    const { container } = render(
      <ComposerPoints t={t} provider="trae" region="cn" onOpenSettings={() => true} />,
    )
    await openPanel(container)
    const button = settingsButton()
    const icon = button?.querySelector('svg.dsm-trae-composer-panel-settings-icon')
    const label = button?.querySelector('span.dsm-trae-composer-panel-settings-label')
    expect(icon).not.toBeNull()
    // `aria-hidden`: the button's own text already names it, so the icon must not
    // be announced twice by a screen reader.
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(label?.textContent).toBe('composer.openSettings')
    // Both halves must be told not to shrink: a flex item defaults to shrinking,
    // which squashes a 12px gear into an oval on a narrow popover.
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-settings-icon{flex:none;display:block}')
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-settings-label{flex:none;white-space:nowrap}')
  })

  it('pins the title to one line, which the pill forced', () => {
    // Measured on the sibling's live host: the moment the control joined the row,
    // the TITLE broke across two lines. The wrapper owns the auto margin so the
    // header is title … [controls] however many controls render.
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-title{flex:none;white-space:nowrap;')
    // Asserted by RULE BODY, not by whole-rule text: the row's gap grew when a
    // second control joined it, and a whole-string assertion turns every such
    // tweak into a failure that says nothing about the property being guarded.
    const wrapper = /\.dsm-trae-composer-panel-actions\{([^}]*)\}/.exec(COMPOSER_POINTS_CSS)?.[1]
    expect(wrapper).toContain('flex:none')
    expect(wrapper).toContain('margin-left:auto')
    expect(wrapper).toContain('display:flex')
  })

  it('keeps the wrapper in the DOM when there is no button, so the header does not reflow', async () => {
    stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)
    expect(settingsButton()).toBeNull()
    expect(document.querySelector('.dsm-trae-composer-panel-actions')).not.toBeNull()
  })
})
