// @vitest-environment jsdom
/**
 * The composer readout must actually LOOK like something.
 *
 * 2.13.0 removed the sidebar credit line — and, because the composer's rules
 * had been written inside that same `TRAE_SIDEBAR_CSS` template, deleted them
 * too. Nothing failed: jsdom does not do layout or cascade, so an unstyled
 * component passes every behavioural assertion. The user then saw the trigger
 * fall back to the browser's default BUTTON BOX and the panel, stripped of
 * `position: fixed`, render nowhere at all (its inline left/top are ignored
 * without a positioned ancestor).
 *
 * So the rules are checked here, structurally:
 *  - the component injects its stylesheet into <head>;
 *  - every `dsm-*` class it renders has a rule in that stylesheet;
 *  - the panel rule is `position: fixed`, the one property whose absence made
 *    it invisible.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComposerPoints } from '../src/client/ComposerPoints.tsx'
import { COMPOSER_POINTS_CSS } from '../src/client/styles.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey) => key) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function stubRoute(): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    accounts: [],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 0, available: 4503, workAvailable: 1777, generalAvailable: 3392, accounts: [] },
  }), { status: 200 }))
}

/** Every `dsm-*` class in the rendered tree, before the panel is opened. */
function classesIn(container: HTMLElement): Set<string> {
  const found = new Set<string>()
  // `Array.from` rather than a bare for-of: tsconfig's lib is `dom` without
  // `dom.iterable`, so a NodeList is not an Iterable to the type checker.
  for (const element of Array.from(container.querySelectorAll('[class]'))) {
    for (const name of element.getAttribute('class')?.split(/\s+/) ?? []) {
      if (name !== '') found.add(name)
    }
  }
  return found
}

describe('the composer readout injects its own stylesheet', () => {
  it('writes a <head> style tag for the readout, guarded against double injection', () => {
    // Rendering twice must not append a second copy: duplicated rules are how a
    // "just add the CSS back" fix quietly doubles every stylesheet in the page.
    stubRoute()
    render(<ComposerPoints t={t} provider="trae" region="cn" />)
    render(<ComposerPoints t={t} provider="trae" region="cn" />)
    const tags = document.querySelectorAll('style[data-plugin-css="dsh-connect-trae/composer-points.css"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toBe(COMPOSER_POINTS_CSS)
  })

  it('every class the row renders has a rule in that stylesheet', async () => {
    stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })

    const missing = [...classesIn(container)].filter(
      name => !COMPOSER_POINTS_CSS.includes(`.${name}{`) && !COMPOSER_POINTS_CSS.includes(`.${name}:`),
    )
    expect(missing).toEqual([])
  })

  it('every class the PANEL renders has a rule in that stylesheet', async () => {
    stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /composer\.points/ }))
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })

    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel).not.toBeNull()
    const names = [...classesIn(panel), ...classesIn(container)]
    const missing = [...new Set(names)].filter(
      name => !COMPOSER_POINTS_CSS.includes(`.${name}{`) && !COMPOSER_POINTS_CSS.includes(`.${name}:`),
    )
    expect(missing).toEqual([])
  })

  it('the panel rule is position: fixed — without it the panel has no geometry at all', () => {
    // The measured left/top are written as inline styles; an element that is not
    // positioned ignores them and lands in document flow instead of under its
    // trigger. This single declaration is what made the panel invisible.
    const rule = /\.dsm-trae-composer-panel\{[^}]*\}/.exec(COMPOSER_POINTS_CSS)
    expect(rule).not.toBeNull()
    expect(rule?.[0]).toContain('position:fixed')
    expect(rule?.[0]).toContain('z-index')
  })

  it('the trigger is borderless at rest — the readout is meant to read as text', () => {
    // The whole label is the click target, but the box it drew when the styles
    // went missing is what the user rejected. The affordance comes from hover.
    const rule = /\.dsm-trae-composer-points-trigger\{[^}]*\}/.exec(COMPOSER_POINTS_CSS)
    expect(rule).not.toBeNull()
    expect(rule?.[0]).toContain('border:0')
    expect(rule?.[0]).toContain('background:transparent')
    expect(rule?.[0]).toContain('cursor:pointer')
    // ...and a hover state exists, so it is discoverable as clickable.
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-points-trigger:hover')
  })
})
