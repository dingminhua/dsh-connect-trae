/**
 * The credit-expiry ladder, shared by the card and the composer panel.
 *
 * WHY IT IS ITS OWN MODULE: two surfaces render the same notice — the card's
 * account panel and the composer panel's expiry line — off the SAME locale
 * keys (`row.expiryWarning*`, `row.expiryEarliest`). When they each carried
 * their own ladder, they drifted, and the drift was invisible until a reader
 * compared the two surfaces: 4.6.7 shipped a "earliest expiry" line that the
 * card rendered as `2026/10/31 23:59` and the panel rendered as `23:59`, from
 * ONE key. The fix there was a one-line change; the fix for the CLASS of that
 * bug is having one implementation to change.
 *
 * So: both surfaces call {@link expiryNotice} and get the same tier, the same
 * message, the same soonest time and the same tone. A future tier added here
 * reaches both surfaces at once, and cannot reach only one.
 *
 * WHAT THE TIERS MEAN (see {@link TraeWebCreditExpiry}): the upstream buckets
 * are nested and cumulative — `within24h` ⊆ `within3d` ⊆ `within7d` — so each
 * bucket answers "how much lapses within N" and the tier reports that bucket's
 * OWN figure. Every sentence therefore stands alone ("200 credit lapses within
 * 3 days" is true of that bucket), and because exactly ONE tier is shown, the
 * reader is never asked to add two figures together.
 */
import type { TraeWebCreditExpiry } from '../status-paths.ts'

/** Which horizon a notice is reporting, in escalating urgency. */
export type ExpiryTier = 'soon' | 'days' | 'week' | 'lapsed'

/** What a notice says, once the tier is chosen. */
export interface ExpiryNotice {
  /** Which horizon this notice reports. */
  tier: ExpiryTier
  /**
   * The credit at stake in that horizon, epoch-independent.
   *
   * This is the tier's OWN cumulative bucket — see the module note.
   */
  total: number
  /** How many packs contribute to it. */
  packs: number
  /**
   * The soonest expiry WITHIN this tier, or undefined when the tier carries
   * no time (the lapsed tier has none: its packs are already past due).
   */
  soonestExpiresAtMs?: number
}

/**
 * Choose the notice's tier and its figures.
 *
 * Escalation order matters: a live expiry the user can still act on outranks
 * a lapsed one they cannot, even when the lapsed amount is larger.
 *
 * The 3-day tier exists because the 7-day bucket covers it. Without it, credit
 * expiring in two days was reported as "within 7 days" — true, but three times
 * too coarse to plan around, in the one sentence whose job is "how long do I
 * have left".
 */
export function expiryNotice(expiry: TraeWebCreditExpiry): ExpiryNotice | undefined {
  if (expiry.within24h.packs > 0) {
    return {
      tier: 'soon',
      total: expiry.within24h.total,
      packs: expiry.within24h.packs,
      ...(expiry.within24h.earliestExpiresAtMs === undefined ? {} : { soonestExpiresAtMs: expiry.within24h.earliestExpiresAtMs }),
    }
  }
  if (expiry.within3d.packs > 0) {
    return {
      tier: 'days',
      total: expiry.within3d.total,
      packs: expiry.within3d.packs,
      ...(expiry.within3d.earliestExpiresAtMs === undefined ? {} : { soonestExpiresAtMs: expiry.within3d.earliestExpiresAtMs }),
    }
  }
  if (expiry.within7d.packs > 0) {
    return {
      tier: 'week',
      total: expiry.within7d.total,
      packs: expiry.within7d.packs,
      ...(expiry.within7d.earliestExpiresAtMs === undefined ? {} : { soonestExpiresAtMs: expiry.within7d.earliestExpiresAtMs }),
    }
  }
  if (expiry.expired.packs > 0) {
    // A lapsed pack has no future time to name — only the amount and count.
    return { tier: 'lapsed', total: expiry.expired.total, packs: expiry.expired.packs }
  }
  return undefined
}

/**
 * The locale key that states this tier's headline.
 *
 * Kept beside the tier choice so a new tier cannot be added without its copy.
 */
export function expiryHeadlineKey(tier: ExpiryTier): 'row.expiryWarningSoon' | 'row.expiryWarningDays' | 'row.expiryWarningWeek' | 'row.expiryWarningLapsed' {
  switch (tier) {
    case 'soon': return 'row.expiryWarningSoon'
    case 'days': return 'row.expiryWarningDays'
    case 'week': return 'row.expiryWarningWeek'
    case 'lapsed': return 'row.expiryWarningLapsed'
  }
}

/**
 * The CSS class that gives this tier its urgency tone.
 *
 * Four tones so the 24-hour case cannot be mistaken for the 3-day one, nor
 * either for the 7-day one, at a glance. The 3-day tone sits BETWEEN the other
 * two: it carries the warning border (a 3-day expiry must not be scrolled past
 * unnoticed) but not the warning fill (a 3-day pack is not the emergency a
 * 24-hour pack is).
 */
export function expiryToneClass(tier: ExpiryTier): string {
  switch (tier) {
    case 'soon': return 'dsm-trae-expiry-soon'
    case 'days': return 'dsm-trae-expiry-days'
    case 'week': return 'dsm-trae-expiry-week'
    case 'lapsed': return 'dsm-trae-expiry-lapsed'
  }
}
