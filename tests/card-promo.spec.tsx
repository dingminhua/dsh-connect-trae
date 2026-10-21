// @vitest-environment jsdom
/**
 * The promotion capsule on a model row.
 *
 * WHY THIS FILE EXISTS — src/promo.ts decides whether a discount is live, and
 * tests/promo.spec.ts proves that decision. What is left is the row itself, and
 * two things can still go wrong there:
 *
 *  - the capsule must sit BESIDE the name, not inside the ellipsis-truncated
 *    name span, or it is clipped away on exactly the long model names;
 *  - one row paints at most ONE capsule. The model row is a single line wide,
 *    and two capsules push the name — and the tick box behind it — out of it.
 *
 * The rows here use a rule that is open all week (weekdays 1–7, 00:00–24:00) so
 * the assertions do not depend on when the suite runs; the "nothing to show"
 * cases say so by construction (no windows, or no rule at all).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'
import { parseTraeActivityDiscount, type TraeActivityDiscount } from '../src/promo.ts'
import { TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
import type { TraeWebModel } from '../src/status-paths.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

function makeScope(initial: Record<string, unknown> = {}) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  return {
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
      },
    },
  }
}

function model(id: string, overrides: Partial<TraeWebModel> = {}): TraeWebModel {
  return { id, name: id, contextWindow: 128_000, maxTokens: 4096, ...overrides }
}

function usageDocument(catalog: TraeWebModel[]): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [],
    models: catalog,
    enabledModelIds: catalog.map(row => row.id),
    credits: { total: 7500, consumed: 5000, available: 2500, workAvailable: 0, generalAvailable: 2500, accounts: [] },
  }
}

function stubFetch(document: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(withTraeRegion(TRAE_USAGE_PATH, 'cn'))) {
      return new Response(JSON.stringify(document), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** Render the card expanded and wait for the model list. */
async function renderOpen(catalog: TraeWebModel[]): Promise<void> {
  stubFetch(usageDocument(catalog))
  const { scope } = makeScope()
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  // The model rows live in the MODELS section of the split card, so the tab has
  // to be opened before the list is on screen.
  fireEvent.click(await screen.findByRole('tab', { name: 'row.panelModels' }))
  await waitFor(() => { expect(screen.getByRole('region', { name: 'row.modelsTitle' })).toBeTruthy() })
}

/**
 * Parse a fixture, refusing a typo instead of silently testing "no rule": a
 * document the parser rejects renders no capsule, so every absence assertion
 * below would pass for exactly the wrong reason.
 */
function rule(value: unknown): TraeActivityDiscount {
  const parsed = parseTraeActivityDiscount(value)
  if (parsed === undefined) throw new Error('fixture is not a promotion document')
  return parsed
}

/**
 * A rule that is live all week, in Shanghai, for a five-fold discount.
 *
 * Parsed here, not handed over raw: the catalog the card receives already went
 * through `parseTraeActivityDiscount` during discovery, and the card reads that
 * parsed shape (`subKey`, `discountType`, `windows`). Feeding it the upstream
 * spelling instead would test a shape no row ever has.
 */
const OPEN_ALL_WEEK = rule({
  enable: true,
  subKey: 'off_peak_discount',
  data: {
    current: { discount_type: 'none', before_consumption_rate: 0.12, consumption_rate: 0.12, discount: 100 },
    off_peak: {
      before_consumption_rate: 0.12,
      after_consumption_rate: 0.06,
      discount: 50,
      time_zone: 'Asia/Shanghai',
      time_windows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start_minute: 0, end_minute: 1440 }],
    },
  },
})

/** Upstream's own "discounted right now" verdict — no clock involved. */
const LIVE_SUBSIDY = rule({
  enable: true,
  subKey: 'subsidy_member_discount',
  data: {
    current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.2, discount: 50 },
    member: { before_consumption_rate: 0.4, after_consumption_rate: 0.1, discount: 25 },
  },
})

describe('TraeUsageCard promotion capsule', () => {
  it('paints upstream’s live verdict with the ratio it published', async () => {
    await renderOpen([model('Doubao-Seed-2.1-Turbo', { activityDiscount: LIVE_SUBSIDY })])

    const capsule = document.querySelector('.dsm-trae-model-promo')
    expect(capsule).not.toBeNull()
    expect(capsule?.className).toContain('dsm-trae-model-promo-subsidy')
    // 50% pay ratio → 5 折 / "50% off"; both placeholders are handed over and
    // each locale picks the one it phrases with.
    expect(capsule?.textContent).toContain('row.promoSubsidy')
    expect(capsule?.textContent).toContain('"zhe":"5"')
    // Upstream's own two prices and its member comparison live in the hover.
    expect(capsule?.getAttribute('title')).toContain('row.promoHintRate')
    expect(capsule?.getAttribute('title')).toContain('row.promoHintMember')
  })

  it('paints an open off-peak window and names the zone it was judged in', async () => {
    await renderOpen([model('deepseek-v4.1-flash', { activityDiscount: OPEN_ALL_WEEK })])

    const capsule = document.querySelector('.dsm-trae-model-promo')
    expect(capsule?.className).toContain('dsm-trae-model-promo-offPeak')
    expect(capsule?.textContent).toContain('row.promoOffPeak')
    expect(capsule?.getAttribute('title')).toContain('Asia/Shanghai')
  })

  it('keeps the capsule outside the truncated name span', async () => {
    await renderOpen([model('a-very-long-model-name-that-would-be-clipped', { activityDiscount: OPEN_ALL_WEEK })])

    const capsule = document.querySelector('.dsm-trae-model-promo')
    expect(capsule).not.toBeNull()
    // The name span ellipsises its own content; a capsule inside it disappears.
    expect(capsule?.closest('.dsm-trae-model-name')).toBeNull()
    expect(capsule?.closest('.dsm-trae-model-copy')).not.toBeNull()
  })

  it('paints nothing when upstream says nothing is running and no window is open', async () => {
    await renderOpen([model('glm-5.3', {
      activityDiscount: rule({
        enable: true,
        subKey: 'subsidy_member_discount',
        data: { current: { discount_type: 'none', before_consumption_rate: 0.4, consumption_rate: 0.4, discount: 100 } },
      }),
    })])

    expect(document.querySelector('.dsm-trae-model-promo')).toBeNull()
  })

  it('paints nothing for a model whose directory carried no rule at all', async () => {
    await renderOpen([model('glm-5.3')])

    expect(document.querySelector('.dsm-trae-model-promo')).toBeNull()
  })

  it('paints exactly one capsule per row even when both branches are open', async () => {
    // One rule carrying BOTH a live upstream verdict and an all-week window:
    // the document shape where a per-branch render would paint two capsules.
    const both = rule({
      enable: true,
      subKey: 'subsidy_member_discount',
      data: {
        current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.2, discount: 50 },
        off_peak: {
          before_consumption_rate: 0.4,
          after_consumption_rate: 0.2,
          discount: 50,
          time_zone: 'Asia/Shanghai',
          time_windows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start_minute: 0, end_minute: 1440 }],
        },
      },
    })
    await renderOpen([model('Doubao-Seed-2.1-Turbo', { activityDiscount: both })])

    const capsules = document.querySelectorAll('.dsm-trae-model-promo')
    expect(capsules).toHaveLength(1)
    // The upstream verdict outranks a locally computed window.
    expect(capsules[0]?.className).toContain('dsm-trae-model-promo-subsidy')
  })
})
