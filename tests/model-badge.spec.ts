/**
 * The selector badge (`LlmModelInfo.badge`) this plugin advertises on its OWN
 * catalog rows — see `docs/MODEL-LABEL-SPEC.md` in the sibling
 * `dsh-connect-workbuddy` repository.
 *
 * WHY THIS EXISTS AT ALL. `conversation.input.model.label` is a `single` slot,
 * so exactly ONE registration renders — and its component is called for EVERY
 * provider's rows. The winner is therefore the only thing that can draw a
 * sibling's capsule, and it can only draw what the sibling PUBLISHED. A plugin
 * that never writes `badge` hands the winner nothing, so its rows stay bare the
 * moment another plugin holds the cell.
 *
 * WHAT THE BADGE SAYS: the promotion running at the moment the catalog is built.
 *
 * AN EARLIER VERSION SAID "免费"/"Free" INSTEAD, AND IT NEVER FIRED. That version
 * keyed on `creditMultiplier === 0`. Every path that parses upstream's
 * `consumption_rate` runs it through `finitePositive` (`src/solo.ts`,
 * `src/model-metadata.ts`), which requires `> 0`, so a rate of `0` arrives as
 * `undefined` and the condition is unreachable from the live directory. This
 * file used to assert it against a hand-written fixture that carried
 * `creditMultiplier: 0` directly — a fixture that no parse path can produce,
 * which is exactly why the suite stayed green while the feature was dead. The
 * "cannot be reached from a live parse" test at the bottom exists so that
 * mistake cannot be repeated silently.
 *
 * THREE RULES ARE PINNED HERE BECAUSE EACH FAILS SILENTLY:
 *
 * 1. Text must carry `en` (the host's `resolveText` fallback) and stay within
 *    12 graphemes (the host's own authoring limit). A missing `en` renders an
 *    EMPTY capsule; nothing validates this on the way in.
 * 2. `tone` must be one of the four literals. The registry copies it verbatim
 *    and the host's `Tag` only writes `data-tone`, so a typo paints a capsule
 *    with no palette at all.
 * 3. "No badge" must be ABSENT, never `null`. The registry does `badge.text` on
 *    whatever arrives, so a `null` throws inside `listModels` and takes the
 *    WHOLE provider out of the catalog (it lands in `failures`).
 */

import { describe, expect, it } from 'vitest'
import { createTraeAdapter, TRAE_PROVIDER } from '../src/adapter.ts'
import { TraeCatalog, type TraeModelInfo } from '../src/catalog.ts'
import { TRAE_BADGE_TONES, traeModelBadge } from '../src/model-badge.ts'
import { parseTraeActivityDiscount, selectTraePromoBadge } from '../src/promo.ts'
import { parseTraeRemoteModel } from '../src/model-metadata.ts'

const shim = {
  ready: Promise.resolve(),
  baseUrl: () => 'http://127.0.0.1:1',
  token: () => 'secret',
  tokenOf: () => 'secret',
  close: async () => {},
}

/**
 * A promotion document in the shape upstream really publishes.
 *
 * Built through {@link parseTraeActivityDiscount} rather than written as a
 * literal `TraeActivityDiscount`: the parser is what turns the wire form into
 * the shape `selectTraePromoBadge` expects, and hand-writing the parsed form is
 * how the previous version of this suite ended up asserting an unreachable
 * state.
 */
function discountOf(data: Record<string, unknown>) {
  // The wire shape upstream publishes: `enable` + `data`. Hand-writing the
  // PARSED form is how the previous version of this suite ended up asserting a
  // state no parse path can produce.
  const parsed = parseTraeActivityDiscount({ enable: true, data })
  if (parsed === undefined) throw new Error('fixture did not parse')
  return parsed
}

/**
 * A live 50%-off campaign.
 *
 * `discount_type` must NOT be `'none'`, and the rate must beat the pre-discount
 * rate: `selectTraePromoBadge` treats `current` as upstream's own "right now"
 * verdict, and a `none` verdict with a member price beside it is not a live
 * promotion at all — it is a subscription price quoted next to an undiscounted
 * base. Getting this wrong is how a fixture ends up asserting a badge that the
 * real directory would never produce.
 */
const HALF_OFF = discountOf({
  current: { discount_type: 'member', before_consumption_rate: 0.12, consumption_rate: 0.06, discount: 50 },
  member: { before_consumption_rate: 0.12, after_consumption_rate: 0.06, discount: 50 },
})

/** A subsidy campaign: Trae paying part of the bill. */
const SUBSIDY = discountOf({
  current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.2, discount: 50 },
  subsidy: { before_consumption_rate: 0.4, after_consumption_rate: 0.2, discount: 50 },
})

/**
 * A weekday off-peak window, 00:00–08:00, with NO live verdict.
 *
 * `current` is deliberately `discount_type: 'none'`: this is the ordinary
 * off-peak shape, where the whole judgement comes from comparing the clock to
 * the window. If `current` also declared a discount, the badge would be right to
 * appear outside the window too — upstream would be saying "discounted right
 * now" and the local window would not be the deciding factor. Mixing the two is
 * what made an earlier version of this test assert a clock behaviour the rule
 * never promised.
 */
const OFF_PEAK = discountOf({
  current: { discount_type: 'none', before_consumption_rate: 0.12, consumption_rate: 0.12, discount: 100 },
  off_peak: {
    time_zone: 'Asia/Shanghai',
    before_consumption_rate: 0.12,
    after_consumption_rate: 0.06,
    discount: 50,
    // `time_windows` with minute offsets — the parser accepts numbers, not
    // "00:00" strings, so a human-readable clock here would parse to no window
    // and the row would silently never be marked.
    time_windows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start_minute: 0, end_minute: 480 }],
  },
})

/** 03:00 in Shanghai on a Wednesday: inside {@link OFF_PEAK}'s window. */
const IN_WINDOW = new Date('2026-11-04T03:00:00+08:00')
/** 13:00 in Shanghai on the same Wednesday: outside it. */
const OUT_OF_WINDOW = new Date('2026-11-04T13:00:00+08:00')
/** An ordinary instant, for the promotions that are always live. */
const NOW = IN_WINDOW

const DISCOUNTED: TraeModelInfo = {
  id: 'glm-5.3',
  name: 'GLM-5.3',
  contextWindow: 200_000,
  creditMultiplier: 0.78,
  activityDiscount: HALF_OFF,
}

const PLAIN: TraeModelInfo = { id: 'kimi-k3', name: 'Kimi-K3', contextWindow: 200_000, creditMultiplier: 0.79 }

/** Grapheme count, the unit the host's 12-character limit is written in. */
function graphemes(text: string): number {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length
}

describe('traeModelBadge — what this plugin is willing to say', () => {
  it('says nothing about a row with no promotion', () => {
    // Not "a neutral capsule with no text": nothing at all. See rule 3 above.
    expect(traeModelBadge(PLAIN, NOW)).toBeUndefined()
  })

  it('quotes the live promotion, with both languages and a tone', () => {
    const badge = traeModelBadge(DISCOUNTED, NOW)
    expect(badge).toBeDefined()
    expect(badge?.text.zh).toBe('5 折')
    expect(badge?.text.en).toBe('50% off')
    expect(TRAE_BADGE_TONES).toContain(badge?.tone)
  })

  it('paints a subsidy in the warning tone and an off-peak window in info', () => {
    // The two kinds must be distinguishable at a glance: one is Trae paying part
    // of the bill, the other is merely a cheap hour.
    expect(traeModelBadge({ ...DISCOUNTED, activityDiscount: SUBSIDY }, NOW)?.tone).toBe('warning')
    expect(traeModelBadge({ ...DISCOUNTED, activityDiscount: OFF_PEAK }, IN_WINDOW)?.tone).toBe('info')
  })

  it('follows the clock: the same row loses its badge outside the window', () => {
    // The point of judging at render time. If this ever passes for a frozen
    // value, "闲时 5 折" will still be on the row tomorrow morning.
    const row = { ...DISCOUNTED, activityDiscount: OFF_PEAK }
    expect(traeModelBadge(row, IN_WINDOW)).toBeDefined()
    expect(traeModelBadge(row, OUT_OF_WINDOW)).toBeUndefined()
  })

  it('agrees with the chip this plugin draws in its own card', () => {
    // The picker and the settings card must not describe the same offer two
    // different ways — one row, one wording. The chip is `PromoChip` in
    // `src/client/TraeModelLabel.tsx`, whose Chinese templates are `闲时 {zhe} 折`
    // / `限时 {zhe} 折` / `{zhe} 折` over that module's `promoZhe`.
    //
    // What this can and cannot guard: the template strings and the KIND→wording
    // mapping are asserted exactly. The `promoZhe` arithmetic is NOT guarded
    // here, and deliberately so — `Math.round(p * 10) / 100` followed by either
    // `String()` or `toFixed(1)` produces the same text for every percent in
    // 1..100 (checked exhaustively), so an assertion pretending to pin it would
    // pass against any rewrite. The duplication is safe precisely because the
    // arithmetic cannot vary.
    const chipZhe = (discountPercent: number) => {
      const zhe = Math.round(discountPercent * 10) / 100
      return Number.isInteger(zhe) ? String(zhe) : zhe.toFixed(1)
    }
    const offPeak = selectTraePromoBadge(OFF_PEAK, IN_WINDOW)
    expect(offPeak).toBeDefined()
    expect(traeModelBadge({ ...DISCOUNTED, activityDiscount: OFF_PEAK }, IN_WINDOW)?.text.zh)
      .toBe(`闲时 ${chipZhe(offPeak!.discountPercent)} 折`)
    expect(traeModelBadge({ ...DISCOUNTED, activityDiscount: SUBSIDY }, NOW)?.text.zh)
      .toBe(`${chipZhe(50)} 折`)
    // ...and the kind picks the same emphasis the chip's palette does.
    expect(traeModelBadge({ ...DISCOUNTED, activityDiscount: OFF_PEAK }, IN_WINDOW)?.tone).toBe('info')
    expect(traeModelBadge({ ...DISCOUNTED, activityDiscount: SUBSIDY }, NOW)?.tone).toBe('warning')
  })
})

describe('the host authoring limits', () => {
  /** Every kind at the WORST percent upstream can publish (100). */
  function worstCaseBadges() {
    // `consumption_rate` cannot be 0 — the parser demands a positive rate — so
    // the worst REAL case is a rate small enough to round to a 100% discount.
    const full = (kind: string) => discountOf({
      current: { discount_type: kind, before_consumption_rate: 1, consumption_rate: 0.001, discount: 0 },
    })
    // Checking only the comfortable 50 in the other fixtures would leave the real
    // overflow undetected — "Off-peak 100% off" is 17 graphemes.
    return [
      traeModelBadge({ ...DISCOUNTED, activityDiscount: full('member') }, NOW),
      traeModelBadge({ ...DISCOUNTED, activityDiscount: full('subsidy') }, NOW),
      traeModelBadge({ ...DISCOUNTED, activityDiscount: full('limited') }, NOW),
    ].filter(badge => badge !== undefined)
  }

  it('keeps every wording within 12 graphemes, at the worst case', () => {
    const badges = worstCaseBadges()
    expect(badges.length, 'the worst-case fixtures must produce badges at all').toBeGreaterThan(0)
    for (const badge of badges) {
      for (const text of [badge.text.en, badge.text.zh]) {
        expect(graphemes(text), JSON.stringify(text)).toBeLessThanOrEqual(12)
        expect(text.trim()).toBe(text)
        expect(text.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the normal fixtures within 12 graphemes too', () => {
    for (const discount of [HALF_OFF, SUBSIDY, OFF_PEAK]) {
      const badge = traeModelBadge({ ...DISCOUNTED, activityDiscount: discount }, IN_WINDOW)
      expect(badge).toBeDefined()
      for (const text of [badge!.text.en, badge!.text.zh]) {
        expect(graphemes(text), JSON.stringify(text)).toBeLessThanOrEqual(12)
      }
    }
  })

  it('deliberately does NOT use the card\'s longer English phrasing', () => {
    // `src/client/locales.ts` says `Off-peak {percent}% off` for the settings
    // card. Reusing that string here looks like the right "consistency" move and
    // is exactly what breaks the picker: it is 17 graphemes at percent = 100.
    // This test exists so a future cleanup that unifies the two fails loudly
    // instead of shipping an overflowing capsule.
    const cardEnglish = 'Off-peak 100% off'
    expect(graphemes(cardEnglish)).toBeGreaterThan(12)
    const badge = traeModelBadge({ ...DISCOUNTED, activityDiscount: OFF_PEAK }, IN_WINDOW)
    expect(badge?.text.en).not.toBe(cardEnglish)
  })

  it('always carries `en`, because the host falls back to it', () => {
    for (const discount of [HALF_OFF, SUBSIDY, OFF_PEAK]) {
      const badge = traeModelBadge({ ...DISCOUNTED, activityDiscount: discount }, IN_WINDOW)
      expect(badge?.text.en, 'a missing `en` renders an EMPTY capsule').toBeTruthy()
    }
  })

  it('uses lowercase language ids, the keys the host looks up', () => {
    const badge = traeModelBadge(DISCOUNTED, NOW)
    expect(Object.keys(badge!.text).sort()).toEqual(['en', 'zh'])
  })

  it('declares the host complete tone vocabulary', () => {
    // The registry does not validate `tone`; the host's Tag only writes
    // `data-tone`, so an unknown value paints a capsule with no palette.
    expect([...TRAE_BADGE_TONES].sort()).toEqual(['info', 'neutral', 'success', 'warning'])
  })
})

/**
 * The dead-badge regression, pinned at the parse boundary.
 *
 * The previous version of this file advertised `creditMultiplier === 0`. That
 * value cannot come out of a live parse: both parsers funnel the rate through
 * `finitePositive`, which demands `> 0`. The assertion below feeds a real
 * `rate: 0` document through the real parser so the next person who reaches for
 * that field sees why it is unusable.
 */
describe('why a price-derived badge is impossible', () => {
  it('parses a live rate of 0 as undefined, not 0', () => {
    for (const rate of [0, 0.0, '0']) {
      const parsed = parseTraeRemoteModel({
        name: 'free-model',
        display_name: 'Free Model',
        features: JSON.stringify({ consumption_rate: { enable: true, data: { rate } } }),
      })
      expect(parsed?.creditMultiplier, `rate=${String(rate)}`).toBeUndefined()
    }
  })
})

describe('listModels() — the badge reaches the host catalog', () => {
  /** Advertise a catalog through the real adapter and return what it lists. */
  async function listed(models: TraeModelInfo[]): Promise<readonly { id: string, name: string, badge?: unknown }[]> {
    const catalog = new TraeCatalog()
    catalog.set(models)
    const { adapter } = createTraeAdapter({
      shim: shim as never,
      catalog,
      provider: TRAE_PROVIDER,
      displayName: 'Trae',
    })
    return await adapter.listModels(TRAE_PROVIDER) as never
  }

  it('attaches the badge to a discounted row only', async () => {
    const models = await listed([DISCOUNTED, PLAIN])
    const discounted = models.find(model => model.id === DISCOUNTED.id)
    const plain = models.find(model => model.id === PLAIN.id)
    expect(discounted?.badge).toMatchObject({ tone: 'warning' })
    // Not `undefined`: the KEY must be absent, because the registry reads
    // `badge.text` off whatever arrives and a present-but-empty value is the
    // shape that breaks. See rule 3.
    expect(plain === undefined ? 'missing' : 'badge' in plain).toBe(false)
  })

  it('leaves the model name untouched', async () => {
    // The host uses `name` for the menu `title`, the trigger `aria-label` and
    // `rankByName` search ranking. Badge syntax must never be smuggled into it.
    const models = await listed([DISCOUNTED])
    expect(models[0]?.name).toBe('GLM-5.3 · x0.78')
  })

  it('is a no-op when the row has no promotion data at all', async () => {
    // The CN static fallback directory carries neither a multiplier nor a rule.
    const models = await listed([PLAIN])
    expect('badge' in (models[0] ?? {})).toBe(false)
  })
})
