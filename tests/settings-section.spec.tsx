// @vitest-environment jsdom
/**
 * The configuration page as a `settings.section`, not a card on the Plugins page.
 *
 * WHY THIS FILE EXISTS. The configuration entry moved seats: the card used to
 * register into the Plugins page's `plugins.bundle.config` / `plugins.row.config`
 * slots (so the whole form sat inside the plugin's market detail page, below its
 * README) and now registers a page into `settings.section`, addressed by the same
 * id its nav glyph uses.
 *
 * Three things can go wrong here and each has its own failure shape, so each is
 * pinned separately:
 *
 *  1. NO PAGE AT ALL. A `slots.inject` wrapped in a capability probe registers
 *     nowhere when the probe is wrong, silently — the failure mode the sibling
 *     `dsh-subagent-default-model` shipped twice (2.1.16/2.1.17). The entry must
 *     call `inject` unconditionally and let the host answer.
 *  2. NO GLYPH, or a glyph whose id does not match the page's: the shell renders
 *     `settings.section.icon` filtered by `{ only: section.id }`, so a mismatched
 *     id never appears and the default gear silently stays.
 *  3. THE WRONG CHROME. This surface is a page inside the Settings DIALOG, which
 *     already owns the panel, the nav and the close control. Drawing the sidebar
 *     page's "back to conversation" header here would offer a second, competing
 *     way out of a modal that is not a centre-column panel.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import * as clientEntry from '../src/client/index.tsx'
import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_CARD_CSS } from '../src/client/styles.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey) => key) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** One usage document, enough for the card to paint its body. */
function stubUsage(): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    accounts: [],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 0, available: 4503, workAvailable: 1777, generalAvailable: 3392, accounts: [] },
  }), { status: 200 }))
}

function makeScope(): unknown {
  return {
    getSnapshot: () => ({ status: 'ready', value: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => true,
  }
}

/** The readonly shape the double records; `id` is what the settings slots key on. */
class Slots extends Service {
  readonly registrations: { name: string, id: string }[] = []
  constructor(owner: Context) { super(owner, 'slots') }
  inject(_name: string, callback: () => void | (() => void)): () => void {
    return (callback() as (() => void) | undefined) ?? (() => {})
  }
  register(options: { name: string, id?: string, key?: string }): () => void {
    const entry = { name: options.name, id: options.id ?? options.key ?? '' }
    this.registrations.push(entry)
    return () => {
      const index = this.registrations.indexOf(entry)
      if (index >= 0) this.registrations.splice(index, 1)
    }
  }
}

class Locale extends Service {
  constructor(owner: Context) { super(owner, 'locale') }
  register(): () => void { return () => {} }
  bind(): (key: string) => string { return key => key }
}

class ConfigForms extends Service {
  readonly requested: string[] = []
  constructor(owner: Context) { super(owner, 'configForms') }
  describe(): { getSnapshot(): { view: { namespaces: { ns: string }[] } }, subscribe(): () => void } {
    return {
      getSnapshot: () => ({ view: { namespaces: [{ ns: 'dsh-connect-trae' }] } }),
      subscribe: () => () => {},
    }
  }
  get(ns: string): unknown {
    this.requested.push(ns)
    return makeScope()
  }
}

type PluginShape = Parameters<Context['plugin']>[0]

async function boot(plugins: PluginShape[]): Promise<Context> {
  const ctx = new Context()
  for (const plugin of plugins) await ctx.plugin(plugin)
  return ctx
}

describe('the client entry registers a settings SECTION, not a Plugins-page card', () => {
  it('registers settings.section and its glyph under the SAME id', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = await boot([Slots, Locale, ConfigForms])
    const fiber = ctx.plugin(clientEntry as unknown as PluginShape)
    await vi.waitFor(() => { expect(fiber.state).toBe(2) })

    const slots = ctx.get('slots') as unknown as Slots
    const section = slots.registrations.find(entry => entry.name === 'settings.section')
    const icon = slots.registrations.find(entry => entry.name === 'settings.section.icon')
    expect(section?.id).toBe('dsh-connect-trae')
    // The id is what the shell filters the glyph by (`{ only: row.id }`), so a
    // mismatch is a silently missing icon, not an error anywhere.
    expect(icon?.id).toBe(section?.id)

    // The old seats are GONE. Keeping them would mean two configuration
    // surfaces maintained side by side, one of them inside a market listing.
    expect(slots.registrations.map(entry => entry.name)).not.toContain('plugins.bundle.config')
    expect(slots.registrations.map(entry => entry.name)).not.toContain('plugins.row.config')

    spy.mockRestore()
    await ctx.fiber.dispose()
  })

  it('registers the page even when the host declares NO icon slot', async () => {
    // A host line may not declare `settings.section.icon`. The glyph's inject
    // lives inside the page's callback and its refusal is caught there, so the
    // page must survive on its own — a missing glyph is the shell's default
    // gear, not a missing configuration page.
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    class NoIconSlots extends Slots {
      override inject(name: string, callback: () => void | (() => void)): () => void {
        if (name === 'settings.section.icon') {
          throw new Error('slot "settings.section.icon" is not declared on this line')
        }
        return super.inject(name, callback)
      }
    }

    const ctx = await boot([NoIconSlots, Locale, ConfigForms])
    const fiber = ctx.plugin(clientEntry as unknown as PluginShape)
    await vi.waitFor(() => { expect(fiber.state).toBe(2) })

    const slots = ctx.get('slots') as unknown as Slots
    expect(slots.registrations.map(entry => entry.name)).toContain('settings.section')
    expect(slots.registrations.map(entry => entry.name)).not.toContain('settings.section.icon')
    // Reported, not swallowed: a missing glyph is survivable but not silent.
    expect(errors.some(args => String((args as unknown[])[0]).includes('settings nav icon failed to register'))).toBe(true)

    spy.mockRestore()
    await ctx.fiber.dispose()
  })

  it('calls inject UNCONDITIONALLY — no capability probe around it', () => {
    // The code-level guard for failure shape #1. `slots.inject()` already waits
    // for the declaration and does nothing on a host that never declares it, so
    // an outer probe adds only a new way to register nowhere. Asserted on the
    // source because the failure is an ABSENCE: a probe that returns false
    // produces no error, no log line, and no entry to assert on.
    const entry = readFileSync(join(process.cwd(), 'src/client/index.tsx'), 'utf8')
    const body = entry.slice(entry.indexOf('const registerSettingsPage'), entry.indexOf('registerSettingsPage()'))
    // It goes through the shared seat helper, whose SECOND argument IS the slot
    // key it calls `slots.inject` with — so the call is unconditional by
    // construction, and the helper owns the in-callback catch (#74).
    expect(body).toMatch(/registerSlotEntry\(ctx, 'settings\.section#[^']+', 'settings\.section'/u)
    // No `typeof … === 'function'` gate, no `specOf` probe, no early return that
    // could skip the registration.
    expect(body).not.toMatch(/typeof\s+[\w.]+\s*===\s*'function'/u)
    expect(body).not.toContain('specOf')
    expect(body).not.toMatch(/if \([^)]*\bslots\b[^)]*\) return/u)
  })
})

describe('the section surface', () => {
  it('draws a heading and description, and NO back-to-conversation control', async () => {
    stubUsage()
    const { container } = render(
      <TraeUsageCard t={t} settingsScope={makeScope() as never} surface="section" />,
    )
    // No card chrome: the shell owns the panel.
    expect(container.querySelector('.dsm-plugin-card')).toBeNull()
    expect(container.querySelector('.dsm-trae-section')).not.toBeNull()
    expect(container.querySelector('.dsm-trae-section-title')?.textContent).toBe('row.title')
    // The sidebar page's header would be a second way out of a modal.
    expect(container.querySelector('.dsm-trae-page')).toBeNull()
    expect(container.querySelector('.dsm-trae-page-back')).toBeNull()
    expect(screen.queryByRole('button', { name: /row\.pageBack/ })).toBeNull()
    // The body is the SAME tree the card draws, present without a click.
    expect(screen.getAllByRole('checkbox', { name: /^row\.showPointsInMainUi\b/ }).length).toBeGreaterThan(0)
    await waitFor(() => { expect(screen.getByText(/composer|row\.tabHint/u)).toBeTruthy() })
  })

  it('has rules behind every class it renders', () => {
    // jsdom does not cascade, so an unstyled section passes every behavioural
    // assertion — the 2.9.x composer switch shipped exactly that way.
    for (const className of ['dsm-trae-section', 'dsm-trae-section-head', 'dsm-trae-section-title', 'dsm-trae-section-desc']) {
      expect(TRAE_CARD_CSS).toContain(`.${className}`)
    }
  })

  it('adds no frame of its own, because the shell already draws one', () => {
    // The settings shell supplies the panel, its border and a 24px-padded scroll
    // column. A second border or a negative margin here would either double the
    // frame or fight the shell's padding.
    const rule = /\.dsm-trae-section\{([^}]*)\}/.exec(TRAE_CARD_CSS)?.[1]
    expect(rule).toBeDefined()
    expect(rule).not.toContain('border:')
    expect(rule).not.toContain('margin')
    expect(rule).not.toMatch(/background:/u)
  })

  it('does not take over scrolling from the shell', () => {
    // THE RULE THIS PINS. The settings shell's `.options` column already
    // scrolls. A second overflow container inside it means two scrollbars and
    // a wheel that jumps between them — and `height:100%` is the usual way it
    // sneaks in. workbuddy hit exactly this in 5.19.0 and wrote the same
    // conclusion down; this test stops the next revision from re-adding it.
    for (const selector of ['dsm-trae-section', 'dsm-trae-section-head', 'dsm-trae-usage']) {
      const body = new RegExp(`\\.${selector}\\{([^}]*)\\}`).exec(TRAE_CARD_CSS)?.[1] ?? ''
      expect(body, selector).not.toContain('height:100%')
      expect(body, selector).not.toMatch(/overflow-y:\s*(auto|scroll)/u)
      expect(body, selector).not.toMatch(/^overflow:\s*(auto|scroll)/u)
    }
  })

  it('keeps the section strip reachable at every scroll position', () => {
    // The pool sits below the fold, so a static strip scrolls out of view and
    // "models / diagnostics" become unreachable until the user scrolls back to
    // the top. sticky is the whole point; an opaque fill is part of it, or the
    // rows scrolling underneath show through the labels.
    //
    // SCOPED to .dsm-trae-section. The strip element is shared by three
    // surfaces; an unscoped sticky shipped in 4.9.0 and, on the card (which has
    // no scrolling ancestor), laid down a layer-2 band over a layer-3 card.
    const body = /\.dsm-trae-section \.dsm-trae-panels\{([^}]*)\}/.exec(TRAE_CARD_CSS)?.[1] ?? ''
    expect(body).toContain('position:sticky')
    expect(body).toMatch(/top:-?\d/u)
    expect(body).toMatch(/z-index:\s*\d/u)
    expect(body).toMatch(/background:/u)
    // ...and the unscoped rule must carry NO positioning, or it leaks back.
    const base = /^[^\n]*\.dsm-trae-panels\{([^}]*)\}/mu.exec(TRAE_CARD_CSS)?.[1] ?? ''
    expect(base, 'base .dsm-trae-panels').not.toContain('position:sticky')
    expect(base, 'base .dsm-trae-panels').not.toMatch(/background:/u)
  })

  it('hides the region hint visually but keeps it for screen readers', () => {
    // `display:none` would remove the sentence from the accessibility tree,
    // and that sentence is the only place the "CN and enterprise share one
    // login" exception is stated. clip keeps it readable; the 1px box keeps it
    // out of the layout, which is where the 36px came from.
    //
    // SCOPED for the same reason as the strip above: the card has no height
    // pressure and lost a sentence it had no reason to lose.
    const body = /\.dsm-trae-section \.dsm-trae-tab-hint\{([^}]*)\}/.exec(TRAE_CARD_CSS)?.[1] ?? ''
    expect(body).toContain('clip')
    expect(body).not.toContain('display:none')
    expect(body).not.toMatch(/opacity:\s*0/u)
    expect(body).toContain('width:1px')
    // The unscoped rule must stay visible text.
    const base = /^[^\n]*\.dsm-trae-tab-hint\{([^}]*)\}/mu.exec(TRAE_CARD_CSS)?.[1] ?? ''
    expect(base, 'base .dsm-trae-tab-hint').not.toContain('clip')
    expect(base, 'base .dsm-trae-tab-hint').not.toContain('width:1px')
  })

  it('reflows the pool table on the TABLE width, not the viewport', () => {
    // Every @media breakpoint in this stylesheet measures the VIEWPORT, and the
    // settings column is 564px regardless of window size — so a media query
    // never fires there. The pool shipped a five-column grid into 564px and the
    // account name was measured at 76px (a 9-digit id read as only its prefix).
    //
    // container-type belongs on the TABLE and not an ancestor: it makes the
    // element the containing block for position:fixed descendants, and the busy
    // veil / import dialog are SIBLINGS of the table, not descendants.
    //
    // Anchored to the start of a line: `.dsm-trae-pool-card .dsm-trae-pool-table`
    // (a borderless override inside the card) matches the same substring first.
    const table = /^\.dsm-trae-pool-table\{([^}]*)\}/mu.exec(TRAE_CARD_CSS)?.[1] ?? ''
    expect(table).toContain('container-type:inline-size')
    expect(TRAE_CARD_CSS).toMatch(/@container \(max-width:700px\)/u)
    // One threshold, not two: the settings column lands inside a "slightly
    // narrower" band, where a reduced grid's cells no longer line up with their
    // headers. Either the columns fit or the rows stack.
    const thresholds = TRAE_CARD_CSS.match(/@container \(max-width:(\d+)px\)/gu) ?? []
    expect(new Set(thresholds).size).toBe(1)
    // The header describes tracks that no longer exist once the rows stack.
    const narrow = /@container \(max-width:700px\)\{([\s\S]*?)\n\}/.exec(TRAE_CARD_CSS)?.[1] ?? ''
    expect(narrow).toContain('.dsm-trae-pool-row-head{display:none}')
    expect(narrow).toContain('flex-wrap:wrap')
  })

  it('collapses the INNER cells, not just the row wrapper', () => {
    // THE BUG THIS PINS, measured on a real screenshot rather than in a fixture:
    // the first revision only turned `.dsm-trae-pool-row` into a wrapping flex
    // row. But the vertical stacking that actually cost the height lives one
    // level deeper — `.dsm-trae-pool-probe-cell` and `.dsm-trae-pool-account`
    // each carry their OWN `flex-direction:column` / three-row grid. Left alone
    // they kept those inner layouts, so the status cell stayed four lines
    // ("正常 / 测得 3 天前 / 来自测速 / upstream answered") and the account name
    // was squeezed to a bare prefix — the row got taller AND narrower.
    const narrow = /@container \(max-width:700px\)\{([\s\S]*?)\n\}/.exec(TRAE_CARD_CSS)?.[1] ?? ''
    expect(narrow).toContain('.dsm-trae-pool-probe-cell{flex-direction:row')
    expect(narrow).toContain('.dsm-trae-pool-account{display:flex')
    // The account cell's three explicit grid placements must be released, or
    // they keep pinning each child to its own grid line inside the flex box.
    for (const selector of ['dsm-trae-pool-account-name', 'dsm-trae-pool-account-tags', 'dsm-trae-pool-account-note']) {
      expect(narrow, selector).toContain(`.dsm-trae-pool-${selector.replace('dsm-trae-pool-', '')}`)
    }
    expect(narrow).toMatch(/grid-column:auto/u)
  })

  it('right-aligns the credit figure so rows compare vertically', () => {
    // WHY THIS IS PINNED. The balance is the one figure a reader compares
    // ACROSS rows ("which account still has more?"). While it sat next to the
    // account name, sized by content, the three rows put it at x=593 / 614 /
    // 498 — the eye cannot scan a column that does not exist.
    //
    // The fix is flex, not a grid: the account line takes the remaining width
    // and the credit is pushed to that line's end. Measured: all three rows
    // land on right edge 773.
    const narrow = /@container \(max-width:700px\)\{([\s\S]*?)\n\}/.exec(TRAE_CARD_CSS)?.[1] ?? ''
    const credit = /\.dsm-trae-pool-credit\{([^}]*)\}/.exec(narrow)?.[1] ?? ''
    // `flex:none` — the figure must not shrink; a squeezed number is worse
    // than a wrapped row.
    expect(credit).toContain('flex:none')
    expect(credit).toMatch(/text-align:\s*right/u)
    // Tabular digits, or the decimal points do not line up even once the boxes do.
    expect(credit).toContain('tabular-nums')
    // The account line must be the one that yields width. `flex:1 1 100%`
    // (which it carried before) leaves nothing beside it, and the credit
    // would be pushed onto its own line.
    const account = /\.dsm-trae-pool-account\{([^}]*)\}/.exec(narrow)?.[1] ?? ''
    expect(account).toContain('flex:1 1 auto')
    expect(account).not.toContain('100%')
    // The three availability facts move BELOW, so line 1 is just name + balance.
    expect(narrow).toMatch(/\.dsm-trae-pool-probe\{flex:1 1 100%;order:5\}/u)
  })
})
