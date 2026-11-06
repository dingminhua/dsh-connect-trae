// @vitest-environment jsdom
/**
 * The card's settings and account blocks must actually LOOK like something.
 *
 * WHY THIS FILE EXISTS: the complaint that started 3.2.0 was "I see no change in
 * the settings menu" — and the way a rebuilt settings area fails is by rendering
 * with no rules behind it. jsdom does no layout and no cascade, so an unstyled
 * block passes every behavioural assertion: the card had already shipped that
 * exact bug once (the 2.9.x composer-credit switch rendered as a bare browser
 * checkbox, so it read as absent). `composer-styles.spec.tsx` pinned this for the
 * composer readout; the card itself had no such check, which is what this adds.
 *
 * The assertions are structural, not visual:
 *  - every `dsm-trae-*` class the SHIPPED card renders has a rule in
 *    `TRAE_CARD_CSS` (or is explicitly allowlisted below with a reason);
 *  - the switch's ON state has a rule, because a switch whose knob never moves
 *    is indistinguishable from a disabled one.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_CARD_CSS } from '../src/client/styles.ts'

import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/**
 * Classes the card renders that deliberately carry no rule of their own.
 * Anything added here needs a reason, because the allowlist is the only place a
 * genuinely unstyled block could hide.
 */
const UNSTYLED_BY_DESIGN = new Set([
  // Styled inline from the account/region status colour (`dotStyle`), like the
  // tab dots and the composer panel's dot.
  'dsm-trae-usage-dot',
])

function scope() {
  const value = {}
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
  }
}

function usageDocument(): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [
      { id: 'account-1', accountName: 'demo-user', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
      { id: 'account-2', accountName: 'SecondCN', edition: 'solo', region: 'cn', source: 'cli', tokenExpiresAtMs: Date.now() + 7_200_000, selected: false },
    ],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 },
  }
}

/** Every class the rendered card actually carries, deduped. */
function renderedClasses(): string[] {
  const found = new Set<string>()
  // Index loops, not iteration: this project's test tsconfig carries no
  // DOM.Iterable lib, so a NodeList / DOMTokenList is not iterable to tsc.
  for (const element of Array.from(document.querySelectorAll('[class]'))) {
    const list = element.classList
    for (let index = 0; index < list.length; index += 1) {
      const name = list.item(index)
      if (name !== null && name.startsWith('dsm-trae-')) found.add(name)
    }
  }
  return [...found].sort()
}

/** The selector names the card stylesheet defines. */
function styledClasses(): Set<string> {
  const defined = new Set<string>()
  for (const match of TRAE_CARD_CSS.matchAll(/\.(dsm-trae-[a-z0-9-]+)/gi)) {
    if (match[1] !== undefined) defined.add(match[1])
  }
  return defined
}

/**
 * The stylesheet SOURCE, read from disk rather than imported.
 *
 * Two of the guards below ("cannot be silently dead") operate on the literal's
 * SOURCE and on the extracted string, not on the imported value, because a
 * stray backtick inside the template literal would let the import still succeed
 * while silently truncating the stylesheet. Reading the file keeps this suite
 * able to notice that, exactly when the import would not.
 *
 * Resolved from `process.cwd()` rather than `import.meta.url`: vitest runs from
 * the repo root, and this file runs in the jsdom environment, where the
 * transform gives `import.meta.url` a non-`file:` scheme (only node-environment
 * specs here can use `new URL(..., import.meta.url)`).
 */
const repoRoot = process.cwd()
function stylesSource(): string {
  return readFileSync(join(repoRoot, 'src/client/styles.ts'), 'utf8')
}

describe('the card stylesheet behind the 3.2.0 settings and account blocks', () => {
  it('has a rule for every dsm-trae-* class the expanded card renders', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) =>
      new Response(JSON.stringify(usageDocument()), { status: 200 }))
    render(<TraeUsageCard t={t} settingsScope={scope() as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    // The tab hint is part of the block under test and only renders expanded.
    await screen.findByText('row.tabHint')

    const defined = styledClasses()
    const rendered = renderedClasses()
    // The new blocks are really in the DOM (an empty collection would make the
    // "nothing is missing" assertion below pass for the wrong reason).
    expect(rendered).toContain('dsm-trae-pref')
    expect(rendered).toContain('dsm-trae-switch')
    expect(rendered).toContain('dsm-trae-account-table')
    expect(rendered).toContain('dsm-trae-account-row-head')
    expect(rendered).toContain('dsm-trae-account-checkin')
    expect(rendered.length).toBeGreaterThan(15)

    expect(rendered.filter(name => !defined.has(name) && !UNSTYLED_BY_DESIGN.has(name))).toEqual([])
  })

  /**
   * The switches are a PILL: `appearance:none` plus our own track and knob.
   *
   * The card used to tint the platform checkbox with `accent-color`, which is
   * the platform's business — it cannot draw a pill, and the ON colour is
   * whatever the OS paints. Owned geometry is the only way to get the shape the
   * rest of the product uses, so what has to hold is that the native box is
   * gone and the knob still moves when checked.
   */
  it('draws a pill switch with an explicit knob', () => {
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-switch-pill input\{[^}]*appearance:none/)
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-switch-pill input\{[^}]*border-radius:999px/)
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-switch-pill input::after\{/)
    // Without the translate the knob would sit still and the pill would read as
    // "off" while the browser reports it checked.
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-switch-pill input:checked::after\{[^}]*transform:translateX/)
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-switch:has\(input:disabled\)/)
    // Scoped: a pill INSIDE a tab chip reads as a second button. The tab row
    // keeps the platform checkbox, so the pill rule must not be global.
    expect(TRAE_CARD_CSS).not.toMatch(/(^|\})\s*\.dsm-trae-switch input\{[^}]*appearance:none/)
  })

  /**
   * The account block keeps a titled container; the PREFERENCE block no longer
   * does, and that asymmetry is deliberate.
   *
   * The roster needs a heading — "Trae 账号" plus its rescan button is how the
   * user knows what the block is and that it can be re-detected. The two
   * preference checkboxes do not: they are bare lines that commit on the click,
   * exactly like the sibling dsh-connect-workbuddy card, and wrapping two
   * booleans in a titled box with a Save button asked the user to remember
   * something that had no reason to need remembering.
   */
  it('titles the account block, and leaves the preference switches as bare lines', () => {
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-accounts\{/)
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-account-table\{/)
    expect(TRAE_CARD_CSS).toMatch(/\.dsm-trae-pref\{/)
    // The removed box: a restored .dsm-trae-set would bring back the draft
    // footer it was the container for.
    expect(TRAE_CARD_CSS).not.toMatch(/\.dsm-trae-set\{/)
  })
})

/**
 * Two ways the stylesheet can be silently dead, both of which shipped once and
 * neither of which any behavioural test can see (jsdom does no cascade, and an
 * unstyled element still has the right classes and text).
 *
 * 1. A STRAY `}`. One orphan brace after `.dsm-trae-models-actions` closed the
 *    block early and took out the very next rule — the credit-exhausted notice,
 *    which is exactly the panel the user pointed at: it rendered as bare text
 *    with the button pushed underneath instead of beside it, and every test
 *    stayed green. Brace balance is the whole check.
 * 2. A TOKEN DSH DOES NOT DEFINE. `var(--nope, #333740)` is valid CSS, so it
 *    LOOKS handled, but the fallback then wins in BOTH themes. That is how the
 *    notice button's hover became a dark slab with near-black text on it in the
 *    light theme, while in the dark theme it barely changed at all: the rule
 *    asked for `--dsw-alias-bg-layer-4`, which does not exist.
 *
 * The allowlist below is deliberately explicit. A new token has to be added by
 * hand, which is the moment to check it against the DSH tokens (`grep` the app
 * bundle) instead of inventing a plausible-looking name.
 */
const TOKENS_VERIFIED_AGAINST_DSH = new Set([
  // The optional sidebar PAGE's back control (Config.sidebarPanel). The page is
  // a full-height surface, so its back button sits on the base layer rather than
  // on a nested card layer — `--dsw-alias-bg-layer-1` is the host's "primary
  // raised surface" token, verified against the live theme.
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  // The busy veil's mask: the exact pair the host's own overlays use, so the
  // veil dims the way every other overlay in the shell does. These two came in
  // with the veil (see `dsm-trae-veil` below), along with the panel shadow
  // `--dsw-elevation-prominent` at the end of the list.
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary',
  // The host's own panel shadow, not a hand-rolled drop shadow.
  '--dsw-elevation-prominent',
  // The host's overlay blur, paired with the mask above.
  '--dsw-mask-blur',
])

describe('the stylesheet cannot be silently dead', () => {
  it('has balanced braces, so no rule is skipped as malformed', () => {
    let depth = 0
    let firstStray = -1
    for (let index = 0; index < TRAE_CARD_CSS.length; index += 1) {
      const char = TRAE_CARD_CSS[index]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth < 0 && firstStray === -1) firstStray = index
      }
    }
    // Report the offset, because "expected -1 to be 1" says nothing useful.
    expect({ firstStray, depth }).toEqual({ firstStray: -1, depth: 0 })
  })

  /**
   * A stray backtick inside the CSS template literal ends the string early, and
   * the rest of the stylesheet is then parsed as UNRELATED TS SYNTAX rather
   * than as CSS. Neither typecheck nor the build complains: the file is still
   * valid TS, it just exports a stub stylesheet plus a pile of junk expression
   * statements. The sibling workbuddy card hit this exactly while reworking its
   * busy veil (its comments quoted CSS tokens in backticks, the literal split
   * at the first one, and the veil block vanished) — and this repo must not
   * relearn it, because the veil added here is just such a rework.
   *
   * So count the file's top-level statements against its HEALTHY shape. A
   * healthy styles.ts declares its CSS exports as VariableStatements and
   * nothing else; truncation turns the remainder into dozens of expression
   * statements, one per token. The `TRAE_CARD_CSS` import could not catch this
   * — an extraction over the string would simply match the shorter, broken
   * literal.
   */
  it('exports exactly the CSS variables, and nothing truncated from the literal', () => {
    const source = stylesSource()
    const sf = ts.createSourceFile('styles.ts', source, ts.ScriptTarget.ESNext, true)
    const strays = sf.statements.filter(st => !ts.isVariableStatement(st))
    // A leftover expression statement is a fragment of the truncated literal.
    expect(strays.map(st => ts.SyntaxKind[st.kind])).toEqual([])
    // The veil CSS lives INSIDE the TRAE_CARD_CSS literal, so the healthy count
    // stays at 2 even with the veil shipped. Anything else is a truncation.
    expect(sf.statements.length).toBe(2)
  })

  it('only asks DSH for tokens that actually exist', () => {
    const used = new Set<string>()
    for (const match of TRAE_CARD_CSS.matchAll(/var\((--dsw-[a-z0-9-]+)/gi)) {
      if (match[1] !== undefined) used.add(match[1])
    }
    // Nothing may be invented: a name DSH does not define silently falls back.
    expect([...used].filter(name => !TOKENS_VERIFIED_AGAINST_DSH.has(name)).sort()).toEqual([])
    // ...and the list must not rot into a superset nobody prunes.
    expect(TOKENS_VERIFIED_AGAINST_DSH.size).toBe(used.size)
  })
})

/**
 * Belt and braces for the SAME truncation defect, aimed at the veil.
 *
 * The truncation guard above is about the SOURCE file's shape; this one is
 * about the extracted CSS string. If the literal were ever truncated again, or
 * a veil rule were lost to a rename, these selectors disappear from the
 * stylesheet while every behavioural test stays green (jsdom does no cascade,
 * so an unstyled element still has the right classes and text).
 *
 * The match is PREFIX-AGNOSTIC first — the sibling workbuddy card spells these
 * `dsm-workbuddy-veil*`, this one `dsm-trae-veil*`, so the guard names the
 * plugin's own prefix rather than a hard-coded one — but EXACT about the class:
 * a whole `{`-terminated rule must be present, so a renamed `.dsm-trae-veil-x`
 * is not read as present via the `veil` substring inside `dsm-trae-veil-card`.
 */
describe('the busy veil keeps the selectors its markup depends on', () => {
  // The classes BusyOverlay.tsx actually renders, in DOM order. The spinner's
  // two circles (track + arc) are listed because the ARC — not a border ring —
  // is the whole point of matching the host's state spinner.
  const VEIL_CLASSES = ['veil', 'veil-card', 'veil-spinner', 'veil-spinner-track', 'veil-spinner-arc'] as const

  it('defines a rule for every veil class the overlay renders', () => {
    const css = TRAE_CARD_CSS
    for (const name of VEIL_CLASSES) {
      expect(css).toMatch(new RegExp(`\\.dsm-trae-${name}\\{`))
    }
  })

  it('keeps the arc spinner rules, not a self-drawn border ring', () => {
    const css = TRAE_CARD_CSS
    // The arc is drawn by a dash animation driven by the veil's own keyframes;
    // a reverted to a CSS border-ring would drop both of these.
    expect(css).toMatch(/@keyframes dsm-trae-veil-dash/)
    expect(css).toMatch(/\.dsm-trae-veil-spinner-arc\{/)
    // Reduced motion degrades to a static arc, matching the host.
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
  })
})

/**
 * The veil exists to make a save the user is waiting for visible, not merely to
 * declare classes. The two structural suites above prove the stylesheet backs
 * the classes; this one proves the OVERLAY really appears while a write is in
 * flight — the observable behaviour the other two render as moot.
 *
 * The card's two writers (`saving` from saveModels, `savingSettings` from
 * writePreference) both raise the same veil via `visible={saving ||
 * savingSettings}`. The preference switch is the cheapest to drive: one click on
 * `showPointsInMainUi` calls `writePreference`, which flips `savingSettings` true
 * and keeps it true until the settings write resolves. By handing the scope a
 * `set` that stays pending, the veil stays up long enough to assert — in the
 * real renderer, not via CSS.
 */
describe('the busy veil renders while a save is in flight', () => {
  it('shows the overlay with the saving message from the moment a preference write starts', async () => {
    let releaseWrite: () => void = () => {}
    const writeHeld = new Promise<void>(resolve => { releaseWrite = resolve })
    const scope = {
      getSnapshot: () => ({ status: 'ready', value: {}, writable: true }),
      subscribe: () => () => {},
      // The write stays in flight until the test decides; only then does
      // `savingSettings` clear and the veil come down.
      set: async () => { await writeHeld; return true },
    }

    vi.stubGlobal('fetch', async (input: string | URL | Request) =>
      new Response(JSON.stringify(usageDocument()), { status: 200 }))
    render(<TraeUsageCard t={t} settingsScope={scope as never} />)

    // Expand the card so the preference switches are present.
    fireEvent.click(screen.getByRole('button', { name: /row\.expand/ }))
    const creditsSwitch = await screen.findByRole('checkbox', { name: /row\.showPointsInMainUi/ })

    fireEvent.click(creditsSwitch)

    // The overlay is genuinely in the DOM, live region and all. Queried by the
    // class (like the rest of this file) rather than by `role="status"`, because
    // the card carries several other live regions.
    await waitFor(() => expect(document.querySelector('.dsm-trae-veil')).not.toBeNull())
    const veil = document.querySelector('.dsm-trae-veil')
    expect(veil).not.toBeNull()
    expect(veil?.getAttribute('role')).toBe('status')
    expect(veil?.getAttribute('aria-busy')).toBe('true')
    expect(veil?.getAttribute('aria-live')).toBe('polite')
    // The veil says what it is waiting for.
    expect(veil?.textContent).toContain('row.veilSaving')
    // The arc spinner renders inside the veil card.
    expect(document.querySelector('.dsm-trae-veil-spinner')).not.toBeNull()
    expect(document.querySelector('.dsm-trae-veil-card')).not.toBeNull()

    // Let the write land: the re-read has caught up, so the veil comes down.
    releaseWrite()
    await waitFor(() => expect(document.querySelector('.dsm-trae-veil')).toBeNull())
  })
})
