// @vitest-environment jsdom
/**
 * Reproducing the HOST's own label for a model that is not ours.
 *
 * `conversation.input.model.label` is a `single` slot: whichever plugin holds
 * it replaces the host's built-in "catalog name + that model's `badge`"
 * rendering for EVERY provider, not just its own. So this component is the only
 * thing that can keep another provider's capsule on screen — and it must draw
 * it the way the host would, or the same row looks different depending on which
 * plugin happened to take the cell.
 *
 * WHY A SEPARATE FILE FROM `model-label-slot.spec.tsx`. That one pins the
 * THIS-PLUGIN behaviour (promotion chip, one multiplier, the slot seat). This
 * one pins the FOREIGN branch, where the only source of truth is the host's own
 * `Tag` (`@deepseek-ai/dsh-client-ui-primitives`, `Tag.module.css` in
 * 0.2.2-rc.1) and the host's fallback label in the picker. The two must not
 * drift apart, because they are compared side by side in one menu.
 *
 * THREE PROPERTIES ARE LOAD-BEARING, AND EACH FAILS SILENTLY:
 *
 * 1. Order. The capsule is ALWAYS after the name, on every placement — the
 *    trigger included. This deliberately differs from the host's own fallback,
 *    which moves it before the name on the trigger: this component's own rows
 *    never swap, so following the host put two orders in one open menu. One
 *    order for every row is the rule; see `docs/MODEL-LABEL-SPEC.md`.
 * 2. Palette. `info` is `state-business-primary` (NOT `brand-primary`) and
 *    `warning` is `state-warn-primary` (NOT `state-warn-secondary`); the host's
 *    capsule has NO border and tints its own colour for the fill. Two capsules
 *    on one row are compared directly, so a near-miss token is visible.
 * 3. Safety. This branch is called once per foreign row — a menu can hold twenty
 *    of them. It must be pure and must NEVER throw: a throw retires the whole
 *    component from the cell, which strips the name off every row in the picker,
 *    not just the malformed one.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TraeModelLabel } from '../src/client/TraeModelLabel.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** A foreign row, as the host hands this slot its props. */
function foreign(
  model: { id: string, name: string, badge?: unknown },
  placement: 'trigger' | 'menu' | 'option' = 'menu',
): Parameters<typeof TraeModelLabel>[0] {
  return {
    provider: { id: 'someone-else', name: 'Someone Else' },
    model: model as Parameters<typeof TraeModelLabel>[0]['model'],
    placement,
    selected: false,
  }
}

/** The rendered capsule of the foreign branch, if any. */
function capsule(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.dsm-trae-model-label-host-badge')
}

describe('a foreign row: the one order every row uses', () => {
  const badge = { text: 'New', tone: 'success' as const }

  it('puts the capsule AFTER the name in a menu', () => {
    const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge }, 'menu')} />)
    expect(container.textContent).toBe('Their ModelNew')
  })

  it('puts the capsule AFTER the name in an option too', () => {
    // `option` is a distinct placement in the host's props; both menu-shaped
    // values are drawn the same way, and a `trigger`-only check would leave
    // `option` falling through to whatever the ternary's else-branch is.
    const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge }, 'option')} />)
    expect(container.textContent).toBe('Their ModelNew')
  })

  it('puts the capsule AFTER the name in the composer trigger TOO', () => {
    // This deliberately DIFFERS from the host's own fallback, which moves the
    // capsule BEFORE the name on the trigger. This component's own rows never
    // swap, so following the host put two orders in one open menu — "chip name"
    // for other providers' rows and "name chip" for its own. One order for
    // every row is the rule now; see `docs/MODEL-LABEL-SPEC.md`.
    const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge }, 'trigger')} />)
    expect(container.textContent).toBe('Their ModelNew')
  })

  it('keeps the name and the capsule as separate children, never one glued text node', () => {
    const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge }, 'trigger')} />)
    // The old branch joined them with a literal space, which also aligned the
    // pill on the text baseline. They are now siblings in a flex row, so the
    // gap is CSS and there is no space in the text at all.
    const row = container.firstElementChild!
    expect(row.children.length).toBe(2)
    expect(row.children[0]!.textContent).toBe('Their Model')
    expect(row.children[1]!.className).toContain('dsm-trae-model-label-host-badge')
  })
})

describe('a foreign row: the host\'s palette', () => {
  /** Inline style of the capsule for one tone. */
  function styleOf(tone: 'neutral' | 'info' | 'success' | 'warning'): CSSStyleDeclaration {
    const { container } = render(
      <TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge: { text: 'New', tone } })} />,
    )
    const element = capsule(container)
    if (element === null) throw new Error(`tone ${tone} drew no capsule`)
    return element.style
  }

  it('tints info with state-business-primary, not the brand colour', () => {
    // Copied from the host's `Tag.module.css`. The two tokens are close enough
    // that the wrong one still "looks blue" — which is exactly why it survived
    // review the first time.
    const style = styleOf('info')
    expect(style.color).toContain('--dsw-alias-state-business-primary')
    expect(style.color).not.toContain('--dsw-alias-brand-primary')
    expect(style.background).toContain('--dsw-alias-state-business-primary')
  })

  it('tints warning with state-warn-primary, not the secondary one', () => {
    const style = styleOf('warning')
    expect(style.color).toContain('--dsw-alias-state-warn-primary')
    expect(style.color).not.toContain('--dsw-alias-state-warn-secondary')
  })

  it('fills neutral with the platform module colour, as the host does', () => {
    const style = styleOf('neutral')
    expect(style.color).toContain('--dsw-alias-label-secondary')
    expect(style.background).toContain('--dsw-alias-bg-module-platform')
  })

  it('tints success with its own colour', () => {
    const style = styleOf('success')
    expect(style.color).toContain('--dsw-alias-state-success-primary')
    expect(style.background).toContain('--dsw-alias-state-success-primary')
  })

  it('draws no border, because the host\'s capsule has none', () => {
    // The host's `Tag` is a fill only. Adding a hairline makes this capsule read
    // heavier than the one beside it on the same row.
    for (const tone of ['neutral', 'info', 'success', 'warning'] as const) {
      const style = styleOf(tone)
      expect(style.border, `${tone} must not draw a border`).toBe('')
      expect(style.borderWidth, `${tone} must not draw a border`).toBe('')
    }
  })

  it('uses the host\'s geometry', () => {
    // `Tag.module.css`: padding 1px 8px; font-size 11px; line-height 17px;
    // font-weight 500; border-radius 999px; corner-shape round. The capsule is
    // rendered outside the card's stylesheet, so this has to be inline — a
    // class alone would be uncoloured on a page that never mounted the card.
    //
    // `corner-shape` is NOT asserted: jsdom's CSSOM does not know the property
    // and DROPS it on assignment (measured — `style.setProperty` leaves both the
    // attribute and `getPropertyValue` empty), so the only assertions available
    // here are the ones that survive. It is in the source because the Electron
    // host is new enough to paint it, and its absence on an older engine is the
    // same rounded rectangle `border-radius` already gives.
    const style = styleOf('neutral')
    expect(style.borderRadius).toBe('999px')
    expect(style.padding).toBe('1px 8px')
    expect(style.fontSize).toBe('11px')
    expect(style.lineHeight).toBe('17px')
    expect(style.fontWeight).toBe('500')
    expect(style.whiteSpace).toBe('nowrap')
    expect(style.display).toBe('inline-flex')
    expect(style.alignItems).toBe('center')
  })

  it('does NOT truncate the text, because the host does not', () => {
    // A `max-width` + ellipsis turns "限时免费" into "限时免…" at exactly the
    // row width where the host would have shown the whole thing — less
    // consistent, not more.
    const style = styleOf('neutral')
    expect(style.maxWidth).toBe('')
    expect(style.textOverflow).toBe('')
    expect(style.overflow).toBe('')
  })

  it('falls back to the neutral palette for a tone it does not know', () => {
    // A future host tone, or an old one. Never a throw, never a blank capsule:
    // an unknown tone must still read as a fact.
    const { container } = render(
      <TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge: { text: 'New', tone: 'brand-new-tone' } })} />,
    )
    const element = capsule(container)
    expect(element).not.toBeNull()
    expect(element?.style.color).toContain('--dsw-alias-label-secondary')
    expect(container.textContent).toBe('Their ModelNew')
  })
})

describe('a foreign row: safe degradation', () => {
  it('renders the plain name when there is no badge', () => {
    const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model' })} />)
    expect(container.textContent).toBe('Their Model')
    expect(capsule(container)).toBeNull()
  })

  it('renders the plain name for a `null` badge instead of throwing', () => {
    // A provider that answers `badge: null` has already been rejected by the
    // registry (`badge.text` throws there), but this component is downstream of
    // the SESSION catalog, which may carry what an older host saved. Reading
    // `.text` off `null` here would retire THIS component from the cell and
    // strip the name off every row in the picker.
    expect(() => render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge: null })} />)).not.toThrow()
    const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge: null })} />)
    expect(container.textContent).toBe('Their Model')
  })

  it('renders the plain name for a badge whose text is not a string or a table', () => {
    for (const text of [undefined, null, 42, ['New'], { en: 42 }]) {
      const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge: { text, tone: 'info' } })} />)
      expect(container.textContent, `text=${JSON.stringify(text)} must degrade to the name`).toBe('Their Model')
    }
  })

  it('renders the plain name for a badge that is not an object at all', () => {
    for (const badge of ['New', 7, true, []]) {
      expect(() => render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge })} />)).not.toThrow()
      const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge })} />)
      expect(container.textContent, `badge=${JSON.stringify(badge)} must degrade to the name`).toBe('Their Model')
    }
  })

  it('treats a blank translation as absent, rather than drawing an empty capsule', () => {
    // The host's `resolveText` returns an empty string AS IS (it only fills in
    // missing keys), so `{ en: '' }` would paint a real, empty capsule. This is
    // a stricter rule than the host's, chosen so a decoration never says nothing.
    for (const text of ['', '   ', { en: '' }, { en: '  ' }, { zh: '' }]) {
      const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge: { text, tone: 'info' } })} />)
      expect(capsule(container), `text=${JSON.stringify(text)} must not draw`).toBeNull()
      expect(container.textContent).toBe('Their Model')
    }
  })

  it('picks the reader\'s language, then the base tag, then English', () => {
    const badge = { text: { en: 'New', zh: '新', 'pt-br': 'Novo' }, tone: 'info' as const }
    const withLanguage = (language: string) => {
      Object.defineProperty(navigator, 'language', { value: language, configurable: true })
      const { container } = render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge })} />)
      return container.textContent
    }
    try {
      // No space: name and capsule are siblings in a flex row now, so the gap
      // is CSS rather than a text node.
      expect(withLanguage('zh-CN')).toBe('Their Model新')
      expect(withLanguage('pt-BR')).toBe('Their ModelNovo')
      // A language the badge does not name at all: the host's required `en`.
      expect(withLanguage('ja-JP')).toBe('Their ModelNew')
    } finally {
      Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    }
  })

  it('never fetches, polls or sets a timer for a foreign row', () => {
    // One menu can hold twenty foreign rows: a per-row request would fire twenty
    // requests on the act of opening the picker.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    render(<TraeModelLabel {...foreign({ id: 'm1', name: 'Their Model', badge: { text: 'New', tone: 'info' } })} />)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setIntervalSpy).not.toHaveBeenCalled()
    setIntervalSpy.mockRestore()
  })
})
