// @vitest-environment jsdom
/**
 * The card's provider on/off checkbox, driven through a REAL click (issue #11).
 *
 * WHY THIS FILE EXISTS — read before deleting or weakening it:
 * the first shipped version of this switch was broken: the card passed the WHOLE
 * settings section to a helper that expected the `regions` sub-object, so the
 * lookup read `section['cn']`, found nothing, and answered `true` forever. The
 * checkbox stayed pinned checked and clicking it appeared to do nothing — while
 * the write had actually succeeded. Host-side tests all passed, because they
 * called the helper directly with the CORRECT argument; nothing exercised the
 * card's own call site. Repo wisdom at the time was a hand-copied "mirror" spec
 * (see `client-fallback.spec.ts`'s DRIFT WARNING), which cannot catch this.
 *
 * So: this spec renders the SHIPPED `TraeUsageCard` and clicks the real input.
 * Assert on the settings WRITE (`scope.set`) and on the rendered state, never on
 * internals.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Primitives ships browser-only CSS modules (shiki, `anser`, `*.module.css`) that
// jsdom cannot transform. The card needs exactly one icon from it, so the package
// is stubbed wholesale — the card itself is still the shipped implementation.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/**
 * A stand-in `settingsScope` over a mutable section document. Mirrors the real
 * contract the card depends on: `getSnapshot()` returns the WHOLE settings
 * section (that shape is the whole point of this spec), and `set(field, value)`
 * commits one top-level field and notifies subscribers.
 */
function makeScope(initial: Record<string, unknown>, writable = true) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  const writes: { field: string; value: unknown }[] = []
  return {
    writes,
    snapshot: () => value,
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        writes.push({ field, value: structuredClone(next) })
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
      },
    },
  }
}

/** The card body (and therefore the switches) only exists once expanded. */
function expand(): void {
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
}

/**
 * Expand the card and return its two region switches, in tab order.
 * `noUncheckedIndexedAccess` is on in this repo, so the pair is asserted here
 * once instead of sprinkling non-null assertions through every case.
 */
function switches(): [HTMLInputElement, HTMLInputElement] {
  const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
  const [cn, ai] = boxes
  if (cn === undefined || ai === undefined) throw new Error(`expected two region switches, saw ${boxes.length}`)
  return [cn, ai]
}

/** Render the card already expanded — the state most assertions need. */
function renderOpen(scope: unknown): void {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  expand()
}

/** The single committed write, asserted so strict indexing stays happy. */
function onlyWrite(writes: { field: string; value: unknown }[]): { field: string; value: unknown } {
  const [first] = writes
  if (first === undefined || writes.length !== 1) {
    throw new Error(`expected exactly one write, saw ${writes.length}`)
  }
  return first
}

describe('TraeUsageCard provider on/off switch', () => {
  it('renders both tabs checked when nothing is stored', () => {
    const { scope } = makeScope({})
    renderOpen(scope)
    const [cn, ai] = switches()
    expect(cn.checked).toBe(true)
    expect(ai.checked).toBe(true)
  })

  it('shows an unchecked box for a region stored as enabled:false', () => {
    // THE REGRESSION: with the whole section passed to the helper, this box
    // rendered checked. It must reflect the stored `false`.
    const { scope } = makeScope({ regions: { cn: { enabled: false }, ai: { enabled: true } } })
    renderOpen(scope)
    const [cn, ai] = switches()
    expect(cn.checked).toBe(false)
    expect(ai.checked).toBe(true)
  })

  it('writes enabled:false for the clicked region and flips the box', async () => {
    const state = makeScope({})
    renderOpen(state.scope)
    const [cn] = switches()
    expect(cn.checked).toBe(true)

    fireEvent.click(cn)

    // The write must go to the `regions` field and carry only the flag — and it
    // must NOT be nested under another `regions` key.
    await vi.waitFor(() => { expect(state.writes.length).toBe(1) })
    const write = onlyWrite(state.writes)
    expect(write.field).toBe('regions')
    expect(write.value).toEqual({ cn: { enabled: false } })

    // …and the box the user clicked now reads as unchecked.
    await vi.waitFor(() => { expect(switches()[0].checked).toBe(false) })
  })

  it('re-enables a disabled region and preserves its stored model state', async () => {
    const state = makeScope({
      regions: { cn: { enabled: false, enabledModelIds: ['glm-5.2'], contextBudgets: { 'glm-5.2': 200_000 } } },
    })
    renderOpen(state.scope)
    expect(switches()[0].checked).toBe(false)

    fireEvent.click(switches()[0])

    await vi.waitFor(() => { expect(state.writes.length).toBe(1) })
    // Toggling must never discard the user's picks.
    expect(onlyWrite(state.writes).value).toEqual({
      cn: { enabled: true, enabledModelIds: ['glm-5.2'], contextBudgets: { 'glm-5.2': 200_000 } },
    })
  })

  it('toggles the region whose box was clicked, not the active tab', async () => {
    const state = makeScope({})
    renderOpen(state.scope)
    const [, ai] = switches()

    fireEvent.click(ai)

    await vi.waitFor(() => { expect(state.writes.length).toBe(1) })
    // Clicking the SECOND box must write `ai`, even though `cn` is the open tab.
    expect(onlyWrite(state.writes).value).toEqual({ ai: { enabled: false } })
  })

  it('does not switch tabs when the box is clicked', async () => {
    // The switch lives BESIDE the tab button for exactly this reason: nested in
    // the button, the tab handler would steal the click and flip the tab.
    const state = makeScope({})
    renderOpen(state.scope)
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('row.tabCn')

    fireEvent.click(switches()[1])

    await vi.waitFor(() => { expect(state.writes.length).toBe(1) })
    // Still the CN tab.
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('row.tabCn')
  })

  it('explains itself in the panel of a switched-off region', () => {
    const { scope } = makeScope({ regions: { cn: { enabled: false } } })
    renderOpen(scope)
    // The user must be told the models are gone but the settings survived —
    // silence here is what made the original bug so confusing.
    expect(screen.getByText('row.tabOffNotice')).toBeTruthy()
  })

  it('disables the boxes when settings are not writable', () => {
    const { scope } = makeScope({}, false)
    renderOpen(scope)
    for (const box of switches()) expect(box.disabled).toBe(true)
  })
})
