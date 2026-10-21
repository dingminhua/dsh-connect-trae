/**
 * Trae's promotion rule: parsing, and the render-time verdict.
 *
 * WHY THIS FILE EXISTS — Trae ships a discount RULE next to the model, not a
 * badge, and the rule carries weekday + minute windows in a named time zone.
 * Two failures are therefore possible and both are tested here:
 *
 *  1. parsing the wrong branch (`current` spells its rate
 *     `consumption_rate`, every other branch `after_consumption_rate`), or
 *     treating a polluted document as a promotion;
 *  2. freezing a verdict: "闲时 5 折" computed at 08:20 must be GONE at 09:00,
 *     so the judgement has to be a function of the clock it is asked about,
 *     never a field baked into a saved catalog.
 *
 * The windows below are copied from a real CN response (see
 * docs/PROMO_BADGE.md §2): `deepseek-v4.1-flash` runs 00:00–09:00,
 * 12:00–14:00 and 18:00–24:00 on weekdays plus all of Saturday/Sunday, all in
 * `Asia/Shanghai`. 2026-10-21 is a Wednesday.
 */
import { describe, expect, it } from 'vitest'

import {
  parseTraeActivityDiscount,
  selectTraePromoBadge,
  TRAE_PROMO_DEFAULT_TIME_ZONE,
  zonedClock,
  type TraeActivityDiscount,
} from '../src/promo.ts'

/** Wednesday 08:20 in Shanghai, as an absolute instant. */
const WED_0820 = new Date('2026-10-21T00:20:00.000Z')

function offPeakDocument(overrides: {
  timeZone?: string
  windows?: { weekdays: number[]; start_minute: number; end_minute: number }[]
} = {}): unknown {
  return {
    enable: true,
    subKey: 'off_peak_member_discount_18_9',
    data: {
      current: { discount_type: 'none', before_consumption_rate: 0.12, consumption_rate: 0.12, discount: 100 },
      member: { before_consumption_rate: 0.12, after_consumption_rate: 0.06, discount: 50 },
      off_peak: {
        before_consumption_rate: 0.12,
        after_consumption_rate: 0.06,
        discount: 50,
        time_zone: overrides.timeZone ?? 'Asia/Shanghai',
        time_windows: overrides.windows ?? [
          { weekdays: [1, 2, 3, 4, 5], start_minute: 0, end_minute: 540 },
          { weekdays: [1, 2, 3, 4, 5], start_minute: 720, end_minute: 840 },
          { weekdays: [1, 2, 3, 4, 5], start_minute: 1080, end_minute: 1440 },
          { weekdays: [6, 7], start_minute: 0, end_minute: 1440 },
        ],
      },
    },
  }
}

/** A live subsidy, copied from `Doubao-Seed-2.1-Turbo`'s wire row. */
const SUBSIDY_DOCUMENT: unknown = {
  enable: true,
  subKey: 'subsidy_member_discount',
  data: {
    current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.2, discount: 50 },
    member: { before_consumption_rate: 0.4, after_consumption_rate: 0.1, discount: 25 },
    subsidy: { before_consumption_rate: 0.4, after_consumption_rate: 0.2, discount: 50 },
  },
}

describe('parseTraeActivityDiscount', () => {
  it('reads the document only when upstream enabled it', () => {
    expect(parseTraeActivityDiscount({ enable: false, data: {} })).toBeUndefined()
    expect(parseTraeActivityDiscount({ enable: true })).toBeUndefined()
    expect(parseTraeActivityDiscount({ enable: true, data: {} })).toBeUndefined()
    expect(parseTraeActivityDiscount(undefined)).toBeUndefined()
    expect(parseTraeActivityDiscount('')).toBeUndefined()
  })

  it('accepts the JSON-string form the directories publish', () => {
    const parsed = parseTraeActivityDiscount(JSON.stringify(SUBSIDY_DOCUMENT))
    expect(parsed?.subKey).toBe('subsidy_member_discount')
    expect(parsed?.current).toEqual({ discountType: 'subsidy', beforeRate: 0.4, rate: 0.2, discountPercent: 50 })
  })

  it('keeps every branch, including member, without judging any of them', () => {
    const parsed = parseTraeActivityDiscount(SUBSIDY_DOCUMENT)
    expect(parsed?.member?.discountPercent).toBe(25)
    expect(parsed?.subsidy?.rate).toBe(0.2)
    // `current` names its discounted rate `consumption_rate`; the others
    // `after_consumption_rate`. Both must land in `rate`.
    expect(parsed?.current?.rate).toBe(0.2)
    expect(parsed?.member?.rate).toBe(0.1)
  })

  it('reads the off-peak windows, dropping ones it cannot judge', () => {
    const parsed = parseTraeActivityDiscount(offPeakDocument({
      windows: [
        { weekdays: [1, 2, 3], start_minute: 0, end_minute: 540 },
        // No weekday: unjudgeable, never "every day".
        { weekdays: [], start_minute: 0, end_minute: 60 },
        // Empty range.
        { weekdays: [1], start_minute: 600, end_minute: 600 },
        // Out of range.
        { weekdays: [1], start_minute: 0, end_minute: 2000 },
      ],
    }))
    expect(parsed?.offPeak?.windows).toEqual([{ weekdays: [1, 2, 3], startMinute: 0, endMinute: 540 }])
    expect(parsed?.offPeak?.timeZone).toBe('Asia/Shanghai')
  })
})

describe('zonedClock', () => {
  it('reports the wall clock in the zone it is asked about', () => {
    expect(zonedClock(WED_0820, 'Asia/Shanghai')).toEqual({ isoWeekday: 3, minutes: 8 * 60 + 20 })
    // Same instant, different zone: Tuesday 17:20 in Los Angeles.
    expect(zonedClock(WED_0820, 'America/Los_Angeles')).toEqual({ isoWeekday: 2, minutes: 17 * 60 + 20 })
  })

  it('answers undefined for a zone it does not know', () => {
    expect(zonedClock(WED_0820, 'Not/AZone')).toBeUndefined()
  })
})

describe('selectTraePromoBadge', () => {
  it('paints a live subsidy from upstream’s own verdict', () => {
    const badge = selectTraePromoBadge(parseTraeActivityDiscount(SUBSIDY_DOCUMENT), WED_0820)
    expect(badge).toMatchObject({
      kind: 'subsidy',
      discountPercent: 50,
      percentOff: 50,
      beforeRate: 0.4,
      rate: 0.2,
      memberDiscountPercent: 25,
    })
    // No window produced it, so no window is claimed.
    expect(badge?.fromClock).toBeUndefined()
  })

  it('falls back to the off-peak window when upstream says nothing is running', () => {
    const badge = selectTraePromoBadge(parseTraeActivityDiscount(offPeakDocument()), WED_0820)
    expect(badge).toMatchObject({
      kind: 'offPeak',
      discountPercent: 50,
      fromClock: '00:00',
      untilClock: '09:00',
      timeZone: 'Asia/Shanghai',
    })
  })

  it('treats a window as start-inclusive and end-exclusive', () => {
    // 00:00 sharp is inside.
    expect(selectTraePromoBadge(parseTraeActivityDiscount(offPeakDocument()), new Date('2026-10-20T16:00:00.000Z'))).toBeDefined()
    // 09:00 sharp is outside — the discount has already ended.
    expect(selectTraePromoBadge(parseTraeActivityDiscount(offPeakDocument()), new Date('2026-10-21T01:00:00.000Z'))).toBeUndefined()
    // 08:59 is still inside.
    expect(selectTraePromoBadge(parseTraeActivityDiscount(offPeakDocument()), new Date('2026-10-21T00:59:00.000Z'))).toBeDefined()
  })

  it('evaluates the window in the zone the model declares, not the account zone', () => {
    const losAngeles = parseTraeActivityDiscount(offPeakDocument({ timeZone: 'America/Los_Angeles' }))
    // 01:00 Tuesday in Los Angeles — inside 00:00–09:00 there, while Shanghai
    // reads 16:00 on Wednesday and every weekday window is closed.
    expect(selectTraePromoBadge(losAngeles, new Date('2026-10-21T08:00:00.000Z'))?.kind).toBe('offPeak')
    // The Shanghai rule at the same instant: 16:00, no window open.
    expect(selectTraePromoBadge(parseTraeActivityDiscount(offPeakDocument()), new Date('2026-10-21T08:00:00.000Z'))).toBeUndefined()
  })

  it('honours a weekend window and ignores it on a weekday', () => {
    const weekendOnly = parseTraeActivityDiscount(offPeakDocument({ windows: [{ weekdays: [6, 7], start_minute: 0, end_minute: 1440 }] }))
    // Saturday 12:00 in Shanghai.
    expect(selectTraePromoBadge(weekendOnly, new Date('2026-10-24T04:00:00.000Z'))?.kind).toBe('offPeak')
    // Wednesday 12:00 — the same clock, a weekday the rule excludes.
    expect(selectTraePromoBadge(weekendOnly, new Date('2026-10-21T04:00:00.000Z'))).toBeUndefined()
  })

  it('prefers upstream’s live verdict over a window that happens to be open', () => {
    const badge = selectTraePromoBadge(parseTraeActivityDiscount(SUBSIDY_DOCUMENT), WED_0820)
    expect(badge?.kind).toBe('subsidy')
  })

  it('paints nothing when no window is open and nothing is running', () => {
    // Wednesday 10:00 in Shanghai: between the morning and noon windows.
    expect(selectTraePromoBadge(parseTraeActivityDiscount(offPeakDocument()), new Date('2026-10-21T02:00:00.000Z'))).toBeUndefined()
    const weekendOnly = parseTraeActivityDiscount(offPeakDocument({
      windows: [{ weekdays: [6, 7], start_minute: 0, end_minute: 1440 }],
    }))
    expect(selectTraePromoBadge(weekendOnly, WED_0820)).toBeUndefined()
  })

  it('never infers a badge from a member price alone', () => {
    // `member` carries a comparison, not a "running now" flag: no badge, so the
    // row cannot advertise a subscription discount the user may already have.
    const memberOnly = parseTraeActivityDiscount({
      enable: true,
      subKey: 'limited_discount',
      data: { member: { before_consumption_rate: 0.4, after_consumption_rate: 0.1, discount: 25 } },
    })
    expect(memberOnly?.member?.discountPercent).toBe(25)
    expect(selectTraePromoBadge(memberOnly, WED_0820)).toBeUndefined()
  })

  it('says 限时 only for a campaign that calls itself limited', () => {
    const limited = parseTraeActivityDiscount({
      enable: true,
      subKey: 'limited_discount',
      data: { current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.08, discount: 20 } },
    })
    expect(selectTraePromoBadge(limited, WED_0820)).toMatchObject({ kind: 'limited', discountPercent: 20, percentOff: 80 })
    // The same numbers under a subsidy campaign must NOT read as limited.
    const subsidy = parseTraeActivityDiscount({
      enable: true,
      subKey: 'subsidy_member_discount',
      data: { current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.08, discount: 20 } },
    })
    expect(selectTraePromoBadge(subsidy, WED_0820)?.kind).toBe('subsidy')
  })

  it('derives the ratio from the rates when upstream omits `discount`', () => {
    const derived = parseTraeActivityDiscount({
      enable: true,
      subKey: 'subsidy_member_discount',
      data: { current: { discount_type: 'subsidy', before_consumption_rate: 0.8, consumption_rate: 0.08 } },
    })
    expect(selectTraePromoBadge(derived, WED_0820)).toMatchObject({ discountPercent: 10, percentOff: 90 })
  })

  it('refuses to paint a capsule with no number behind it', () => {
    const empty = parseTraeActivityDiscount({
      enable: true,
      subKey: 'subsidy_member_discount',
      data: { current: { discount_type: 'subsidy' } },
    })
    expect(selectTraePromoBadge(empty, WED_0820)).toBeUndefined()
  })

  it('falls back to the account zone when upstream names no zone', () => {
    const document = offPeakDocument()
    const withoutZone = structuredClone(document) as { data: { off_peak: { time_zone?: string } } }
    delete withoutZone.data.off_peak.time_zone
    const badge = selectTraePromoBadge(parseTraeActivityDiscount(withoutZone), WED_0820, TRAE_PROMO_DEFAULT_TIME_ZONE)
    expect(badge).toMatchObject({ kind: 'offPeak', timeZone: TRAE_PROMO_DEFAULT_TIME_ZONE })
  })

  it('reports the zone the window was judged in when upstream names an unusable one', () => {
    // A typo'd zone must not reach the hover line: the hours are read in the
    // account zone, so that is the clock the capsule names. (Measured live
    // 2026-10-21: no such zone has appeared yet — this is the degradation path
    // for one that does.)
    const badge = selectTraePromoBadge(
      parseTraeActivityDiscount(offPeakDocument({ timeZone: 'Mars/Olympus' })),
      WED_0820,
      TRAE_PROMO_DEFAULT_TIME_ZONE,
    )
    expect(badge).toMatchObject({ kind: 'offPeak', timeZone: TRAE_PROMO_DEFAULT_TIME_ZONE, fromClock: '00:00', untilClock: '09:00' })
  })

  it('carries no verdict of its own: the same rule answers differently at different times', () => {
    const rule: TraeActivityDiscount | undefined = parseTraeActivityDiscount(offPeakDocument())
    expect(selectTraePromoBadge(rule, new Date('2026-10-21T00:20:00.000Z'))?.kind).toBe('offPeak')
    expect(selectTraePromoBadge(rule, new Date('2026-10-21T01:00:00.000Z'))).toBeUndefined()
    // …and comes back the next night, from the very same parsed object.
    expect(selectTraePromoBadge(rule, new Date('2026-10-22T00:20:00.000Z'))?.kind).toBe('offPeak')
  })
})
