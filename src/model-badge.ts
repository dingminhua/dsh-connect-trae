/**
 * The one selector badge this plugin advertises on its own catalog rows.
 *
 * WHY A BADGE AT ALL, GIVEN THE CAPSULE ALREADY EXISTS. The picker's model label
 * is a `single` slot: exactly one component renders, and it is called for EVERY
 * provider's rows. Whichever plugin holds that cell is the only thing that can
 * draw a sibling's capsule — and it can only draw what the sibling PUBLISHED,
 * because `model.badge` is the only channel between them. So a connector that
 * writes no badge has bare rows the moment another plugin wins the seat, no
 * matter how carefully that plugin reproduces `badge`. See
 * `docs/MODEL-LABEL-SPEC.md` (sibling `dsh-connect-workbuddy` repository), whose
 * rules this file follows.
 *
 * UNAVAILABLE HOSTS. On 0.1.x there is no `badge` field at all; the registry
 * drops the key and every row renders exactly as before. See `src/adapter.ts`
 * for the conditional-spread that keeps this file compiling there.
 *
 * @module dsh-connect-trae/model-badge
 */

import {
  selectTraePromoBadge,
  TRAE_PROMO_DEFAULT_TIME_ZONE,
  type TraeActivityDiscount,
  type TraePromoBadge,
  type TraePromoKind,
} from './promo.ts'
import type { TraeModelInfo } from './catalog.ts'

/**
 * Emphasis of a selector badge, spelled out locally.
 *
 * Deliberately NOT imported from `@deepseek-ai/dsh-llm`: `LlmModelBadge` does
 * not exist on 0.1.x, so importing it would make this file uncompilable on the
 * host range the plugin still declares. The four literals below are the host's
 * complete vocabulary, and {@link TRAE_BADGE_TONES} is what the test checks
 * them against.
 */
export type TraeBadgeTone = 'neutral' | 'info' | 'success' | 'warning'

/** Every tone the host understands; the test asserts this list is complete. */
export const TRAE_BADGE_TONES: readonly TraeBadgeTone[] = ['neutral', 'info', 'success', 'warning']

/**
 * One selector badge.
 *
 * `text` is a translation table rather than a literal so the capsule reads in
 * the reader's language. `en` is REQUIRED (the host falls back to it for any
 * language it cannot find) and both keys are lowercase language ids, matching
 * the host's `localeKey()` lookup.
 */
export interface TraeModelBadge {
  text: { readonly en: string, readonly zh: string }
  tone: TraeBadgeTone
}

/**
 * Why each promotion kind paints the way it does in the picker.
 *
 * MIRRORS `PROMO_TONES` IN `src/client/TraeModelLabel.tsx`, which is the chip
 * this plugin draws on its own rows. The two must agree: when this plugin holds
 * the label slot the same row is drawn by that component, and when a SIBLING
 * holds it the row is drawn from this badge instead. One row, one colour.
 *
 * `subsidy` is the only negative-valence kind (`state-error`, red) because it is
 * Trae paying part of the bill; `limited` warns, `offPeak` is the mildest.
 */
const PROMO_TONES: Record<TraePromoKind, TraeBadgeTone> = {
  subsidy: 'warning',
  limited: 'warning',
  offPeak: 'info',
}

/**
 * The badge one catalog row should carry, or `undefined` for none.
 *
 * WHY THE PROMOTION, AND NOT THE PRICE. A badge is the ONE thing a sibling can
 * draw on this plugin's behalf, so it has to be the thing a user would act on.
 * "This model is 50% off right now" changes the choice; a price that has been
 * identical for months does not.
 *
 * WHY THE CLOCK IS READ HERE. `activityDiscount` rides along UNRESOLVED on the
 * model entry precisely so the judgement happens where the row is drawn
 * (`src/promo.ts` explains why freezing it at parse time would leave a night-time
 * discount hanging there the next morning). `listModels()` IS that moment on the
 * host side — it runs when the host builds the catalog — and the plugin asks the
 * host to re-read the catalog via `llm/models-updated` whenever the card's own
 * clock crosses a window boundary. So this is not "catalog data that ignores the
 * clock"; it is a clock judgement made at each catalog rebuild.
 *
 * A NOTE ON WHAT WAS TRIED FIRST AND REJECTED. An earlier version advertised
 * `creditMultiplier === 0` as "免费"/"Free". It never fired: every path that
 * parses upstream's `consumption_rate` runs it through `finitePositive`
 * (`src/solo.ts`, `src/model-metadata.ts`), which requires `> 0`, so a rate of
 * `0` arrives as `undefined`. A multiplier of exactly `0` can only come from a
 * saved `lastCatalog`, never from the live directory. Do not reintroduce a
 * price-derived badge from that field.
 *
 * @param model - the catalog row about to be advertised.
 * @param now - the clock the promotion is judged against. Passed in rather than
 *        read from `Date.now()` so the caller owns the "one clock for the whole
 *        catalog" decision and the tests can move time.
 * @returns the badge, or `undefined` — never `null`. A `null` makes the host
 *          registry throw inside `listModels`, which drops this provider's
 *          ENTIRE catalog into `failures`, not just the decorated row.
 */
export function traeModelBadge(
  model: Pick<TraeModelInfo, 'activityDiscount'>,
  now: Date,
): TraeModelBadge | undefined {
  const promo = selectTraePromoBadge(model.activityDiscount, now, TRAE_PROMO_DEFAULT_TIME_ZONE)
  return promo === undefined ? undefined : badgeOfPromo(promo)
}

/**
 * The picker's wording for one promotion.
 *
 * WHY THE UPSTREAM'S OWN WORDING AND NOT INVENTED COPY. The chip the plugin
 * draws in its own card says "闲时 5 折"; the badge has to be recognisable as the
 * same offer, so it reuses the same three phrasings with the same `promoZhe`
 * figure. If a future kind has no wording here, it must NOT fall through to a
 * generic "优惠" — an unlabelled capsule in the picker is worse than none.
 */
function badgeOfPromo(promo: TraePromoBadge): TraeModelBadge {
  const zhe = promoZhe(promo.discountPercent)
  const percent = String(promo.percentOff)
  // Chinese is the language the CN directory writes in, so it is the one that can
  // quote the upstream's own shape ("5 折"). English has no "折": it has to be
  // recast as a percentage, which is a lossless translation of the same figure.
  const en = PROMO_EN[promo.kind].replace('{percent}', percent)
  const zh = PROMO_ZH[promo.kind].replace('{zhe}', zhe)
  return { text: { en, zh }, tone: PROMO_TONES[promo.kind] }
}

/**
 * Pay ratio as the "折" figure a Chinese price tag uses: 50 → "5", 25 → "2.5".
 *
 * Duplicated from `src/client/TraeModelLabel.tsx` ON PURPOSE: that module is a
 * client component and importing it from here would pull React into the host
 * process. `tests/model-badge.spec.ts` asserts the two produce the same string
 * for every percent the directory can publish, so they cannot drift silently.
 */
function promoZhe(discountPercent: number): string {
  const zhe = Math.round(discountPercent * 10) / 100
  return Number.isInteger(zhe) ? String(zhe) : zhe.toFixed(1)
}

/**
 * English wording per kind.
 *
 * NOT a translation table of the Chinese strings: English has no "折", so the
 * discount has to be restated as a percentage. Same number, different grammar.
 *
 * THE ENGLISH HERE IS SHORTER THAN THE CARD'S, BY DESIGN. `src/client/locales.ts`
 * (the chip in this plugin's own settings card) says `Off-peak {percent}% off`;
 * the badge cannot, because the picker enforces 12 graphemes and that phrasing is
 * 17 at `percent = 100`. A settings row has room for the longer sentence; a
 * picker row does not. The Chinese templates, where the two DO match exactly, are
 * asserted in `tests/model-badge.spec.ts` — the English difference is deliberate
 * and is not drift to "fix".
 */
const PROMO_EN: Record<TraePromoKind, string> = {
  limited: 'Limited {percent}%',
  subsidy: '{percent}% off',
  offPeak: 'Offpeak {percent}%',
}

/** Chinese wording per kind, matching the chip this plugin draws in its card. */
const PROMO_ZH: Record<TraePromoKind, string> = {
  limited: '限时 {zhe} 折',
  subsidy: '{zhe} 折',
  offPeak: '闲时 {zhe} 折',
}
