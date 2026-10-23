// @vitest-environment jsdom
/**
 * The upstream's activity badge in the HOST's model picker.
 *
 * The host renders a provider's model name as a plain string, so the only thing
 * a provider can put there is a character — and a character's colour is the
 * emoji font's business, not ours. The host therefore offers exactly one seam
 * for this: the `conversation.input.model.label` slot, whose contract is "render
 * non-interactive inline content such as a coloured name or badge" while the
 * picker keeps owning clicks, focus and check marks. (Ported from the sibling
 * `dsh-connect-workbuddy` plugin, where this slot shipped first.)
 *
 * Four things are worth pinning here, and all four are about not overstating
 * what the upstream said:
 *
 * 1. The badge is drawn NEXT TO the catalog name, never instead of it.
 * 2. The row shows EXACTLY ONE multiplier. `traeModelDisplayName` already ends
 *    the name in `· x0.55`, so a label that appended its own rate would print
 *    `· x0.55 · x0.50` — the sibling plugin's #120 regression, and the reason
 *    `splitCatalogRate` exists.
 * 3. Another provider's model gets the PLAIN name — no badge, no fetch.
 * 4. The snapshot is read with `detail=fast`: opening the picker must not
 *    trigger an upstream read (issue #77).
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fillPlaceholders,
  promoZhe,
  resetTraeModelLabelCache,
  splitCatalogRate,
  TraeModelLabel,
} from '../src/client/TraeModelLabel.tsx'
import { parseTraeActivityDiscount } from '../src/promo.ts'
import type { TraeActivityDiscount } from '../src/promo.ts'
import { TRAE_USAGE_PATH } from '../src/status-paths.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetTraeModelLabelCache()
})

/** A promotion document in the shape the catalog carries (already parsed). */
function rule(value: unknown): TraeActivityDiscount {
  const parsed = parseTraeActivityDiscount(value)
  if (parsed === undefined) throw new Error('fixture is not a promotion document')
  return parsed
}

/** A live subsidy: pay 0.2 where the catalog charges 0.4. */
const LIVE_SUBSIDY = rule({
  enable: true,
  subKey: 'subsidy_member_discount',
  data: {
    current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.2, discount: 50 },
    member: { before_consumption_rate: 0.4, after_consumption_rate: 0.1, discount: 25 },
  },
})

/** A namespace whose entry is enabled but publishes no price at all. */
const NO_PRICE = rule({
  enable: true,
  subKey: 'subsidy_member_discount',
  data: { current: { discount_type: 'none', before_consumption_rate: 0.4, consumption_rate: 0.4, discount: 100 } },
})

/** The host's props for one row in the picker. */
function props(providerId: string, name: string, modelId = 'model-a'): Parameters<typeof TraeModelLabel>[0] {
  return {
    provider: { id: providerId, name: providerId },
    model: { id: modelId, name },
    placement: 'menu',
    selected: false,
  }
}

/** Stub the Host's usage route and record the URLs asked for. */
function stubUsage(models: readonly Record<string, unknown>[], calls: string[] = []): string[] {
  vi.stubGlobal('fetch', async (url: unknown) => {
    calls.push(String(url))
    return {
      ok: true,
      status: 200,
      json: async () => ({ models }),
    }
  })
  return calls
}

describe('splitCatalogRate', () => {
  it('pulls the multiplier back out of the name, so it can be drawn once', () => {
    expect(splitCatalogRate('Kimi-K2 · x0.55', 0.55, undefined)).toEqual({ base: 'Kimi-K2', rate: 0.55 })
  })

  it('lets the discount win over the number the name carries — the #120 regression', () => {
    // Without this the row would read `Kimi-K2 · x0.55 · x0.50`: two numbers,
    // one of them a price the user is not being charged.
    expect(splitCatalogRate('Kimi-K2 · x0.55', 0.55, 0.5)).toEqual({ base: 'Kimi-K2', rate: 0.5 })
  })

  it('keeps a name with no suffix and falls back to the catalog rate', () => {
    expect(splitCatalogRate('GLM-5', 0.3, undefined)).toEqual({ base: 'GLM-5', rate: 0.3 })
  })

  it('draws no number when the name has none and the snapshot knows none', () => {
    expect(splitCatalogRate('GLM-5', undefined, undefined)).toEqual({ base: 'GLM-5', rate: undefined })
  })

  it('strips the suffix by SHAPE, so a renamed catalog rate cannot leave two numbers', () => {
    // The snapshot and the string can disagree (a promotion may change the
    // catalog figure between the two); matching the shape is what keeps the
    // suffix from surviving beside a separate rate.
    expect(splitCatalogRate('Kimi-K2 · x0.55', 0.7, undefined)).toEqual({ base: 'Kimi-K2', rate: 0.55 })
  })

  it('leaves a name that merely mentions an x-rate mid-string alone', () => {
    expect(splitCatalogRate('x0.55 preview', undefined, undefined)).toEqual({ base: 'x0.55 preview', rate: undefined })
  })
})

describe('the chip copy', () => {
  it('fills both spellings of a pay ratio, so either locale can use its own', () => {
    const vars = { zhe: promoZhe(50), percent: '50' }
    expect(fillPlaceholders('限时 {zhe} 折', vars)).toBe('限时 5 折')
    expect(fillPlaceholders('Limited {percent}% off', vars)).toBe('Limited 50% off')
    expect(promoZhe(50)).toBe('5')
    expect(promoZhe(25)).toBe('2.5')
  })

  it('leaves an unknown placeholder visible instead of printing an empty price', () => {
    expect(fillPlaceholders('{unknown} 折', { zhe: '5' })).toBe('{unknown} 折')
  })
})

describe('the model label in the host picker', () => {
  it('keeps the catalog name and adds the badge beside it', async () => {
    stubUsage([{ id: 'model-a', name: 'Doubao-Seed-2.1-Turbo · x0.40', activityDiscount: LIVE_SUBSIDY }])

    const { container } = render(<TraeModelLabel {...props('trae', 'Doubao-Seed-2.1-Turbo · x0.40')} />)

    await waitFor(() => {
      expect(container.querySelector('.dsm-trae-model-label-promo')).not.toBeNull()
    })
    const chip = container.querySelector('.dsm-trae-model-label-promo')
    // The NAME is still there — the contract says to retain it.
    expect(container.textContent).toContain('Doubao-Seed-2.1-Turbo')
    // The live discount replaces the catalog rate: exactly one multiplier, and
    // it is the 0.2 the user actually pays.
    expect(container.textContent).toContain('x0.20')
    expect(container.textContent).not.toContain('x0.40')
    // Upstream's own figures live in the hover.
    expect(chip?.getAttribute('title')).toContain('0.4')
    expect(chip?.getAttribute('title')).toContain('0.2')
  })

  it('reads the fast document, so opening the picker never triggers an upstream read', async () => {
    const calls = stubUsage([{ id: 'model-a', name: 'GLM-5 · x0.30' }])

    render(<TraeModelLabel {...props('trae', 'GLM-5 · x0.30')} />)

    await waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]).toContain(TRAE_USAGE_PATH)
    expect(calls[0]).toContain('detail=fast')
    expect(calls[0]).toContain('region=cn')
  })

  it('asks for the ENTERPRISE panel\'s roster on the enterprise provider', async () => {
    const calls = stubUsage([{ id: 'model-a', name: 'GLM-5 · x0.30' }])

    render(<TraeModelLabel {...props('trae-enterprise', 'GLM-5 · x0.30')} />)

    await waitFor(() => { expect(calls).toHaveLength(1) })
    // Enterprise shares the CN credential but bills a different pool and serves
    // a different roster: asking for `cn` would paint one roster's promotions on
    // the other's models.
    expect(calls[0]).toContain('region=enterprise')
  })

  it('draws no badge when the rule names a discount with no price behind it', async () => {
    stubUsage([{ id: 'model-a', name: 'GLM-5 · x0.30', activityDiscount: NO_PRICE }])

    const { container } = render(<TraeModelLabel {...props('trae', 'GLM-5 · x0.30')} />)

    // Let the fetch land, then assert the chip stayed away.
    await waitFor(() => { expect(container.querySelector('.dsm-trae-model-label-rate')).not.toBeNull() })
    expect(container.querySelector('.dsm-trae-model-label-promo')).toBeNull()
  })

  it('speaks the UI language without an injected `t` (the slot gets none)', async () => {
    // The card's copy arrives through `t`; a slot rendered by the HOST has no
    // such injection, so the component reads the same table off the browser's
    // language. Pinned because a silent fallback to en would ship Chinese copy
    // as "50% off" to every zh user.
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
    try {
      stubUsage([{ id: 'model-a', name: 'Doubao · x0.40', activityDiscount: LIVE_SUBSIDY }])

      const { container } = render(<TraeModelLabel {...props('trae', 'Doubao · x0.40')} />)

      await waitFor(() => {
        expect(container.querySelector('.dsm-trae-model-label-promo')).not.toBeNull()
      })
      expect(container.querySelector('.dsm-trae-model-label-promo')?.textContent).toBe('5 折')
    } finally {
      Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    }
  })

  it('renders another provider\'s model as the plain name, with no fetch', () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: unknown) => {
      calls.push(String(url))
      return { ok: true, status: 200, json: async () => ({ models: [] }) }
    })

    const { container } = render(<TraeModelLabel {...props('someone-else', 'Their Model')} />)

    expect(container.textContent).toBe('Their Model')
    expect(calls).toHaveLength(0)
  })
})
