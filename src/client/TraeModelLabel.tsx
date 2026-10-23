/**
 * The HOST's model picker label: the catalog name, the upstream's activity
 * badge, and EXACTLY ONE multiplier.
 *
 * WHY A SLOT. The picker renders the model name as a plain string, so the only
 * thing a provider can put there is a character — and a character's colour is
 * the emoji font's business, not ours. The host therefore offers exactly one
 * seam for this: the `conversation.input.model.label` slot, whose contract is
 * "render non-interactive inline content such as a coloured name or badge"
 * while the picker keeps owning clicks, focus, check marks and the
 * accessibility text. The shipped example is the official DeepSeek "1017"
 * release badge — a coloured marker next to a model name — which is the same
 * job. (Ported from the sibling `dsh-connect-workbuddy` plugin, which solved
 * the same problem for the same host; the two must stay one presentation.)
 *
 * WHY THE BADGE BELONGS HERE AT ALL. The picker is where the choice is made,
 * and a time-boxed promotion is a choice criterion: "half price at night"
 * changes which row you click. The card already drew these badges, but the card
 * is the settings surface — by the time you read them there you have already
 * picked. This is the same upstream fact, moved to where it can still change a
 * decision.
 *
 * WHY ONE MULTIPLIER AND NOT TWO. `traeModelDisplayName` ALREADY ends the name
 * in the catalog multiplier (`Kimi-K2 · x0.55` — see `src/catalog.ts`), and the
 * host renders that string verbatim. Appending another rate here would print
 * `· x0.55 · x0.55`, which is precisely the defect the sibling plugin shipped
 * and had to fix (its #120 regression). The suffix is therefore pulled back OUT
 * of the name and re-drawn in the span that can carry the DISCOUNTED value, so
 * the row always shows exactly one number and it is the one that holds now.
 *
 * WHY A SEPARATE FETCH. The slot is rendered by the host, outside the plugin's
 * card, so it cannot read the card's React state (nor its injected `t`). It
 * asks the Host itself, over the SAME route the card polls
 * (`TRAE_USAGE_PATH`) — but with `detail=fast` (issue #77), the first-paint
 * document built from LOCAL state: the model roster, its `creditMultiplier` and
 * its unresolved `activityDiscount` are all known locally, so opening the
 * picker must not trigger an upstream read. The answer is cached briefly: a
 * picker that re-fetched on every re-render would be wasteful, and a level a few
 * seconds old is still true.
 *
 * WHY THE CLOCK IS RE-READ ON EVERY RENDER. A promotion's badge is a function
 * of the clock (an off-peak window opens and closes; a campaign expires).
 * Resolving it once at fetch time and holding it would leave "闲时 5 折" on the
 * picker the next morning — the exact overstatement `src/promo.ts` refuses to
 * make. The snapshot is fetched once and the BADGE is resolved at render time;
 * a shared one-minute ticker re-renders the mounted labels, so a window edge is
 * picked up without one timer per model row.
 *
 * WHY THE HOST STILL OWNS THE NAME. The contract says to keep `model.name` as
 * the text and render the addition beside it, so this component returns the name
 * first — it never replaces it — and it renders nothing extra for a provider
 * that is not ours.
 *
 * @module dsh-connect-trae/client/TraeModelLabel
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { selectTraePromoBadge } from '../promo.ts'
import type { TraePromoBadge, TraePromoKind } from '../promo.ts'
import { panelOfProvider } from '../region.ts'
import type { TraePanel } from '../region.ts'
import { TRAE_USAGE_PATH, withTraeRegionFastDetail } from '../status-paths.ts'
import type { TraeWebModel } from '../status-paths.ts'
import { en, zh } from './locales.ts'
import type { TraeSettingsKey } from './locales.ts'

/** How long a fetched snapshot is trusted, in milliseconds. */
const CACHE_MS = 60_000

/** How often a mounted label re-reads the clock, in milliseconds. */
const TICK_MS = 60_000

/**
 * The one fact a label needs, per model, as read from the Host.
 *
 * The roster rides on the same `detail=fast` document the card polls: each row
 * carries its own catalog `creditMultiplier` and its UNRESOLVED
 * `activityDiscount` — the badge is resolved against the clock by the renderer,
 * not by the Host.
 */
interface StatusSnapshot {
  models: ReadonlyMap<string, TraeWebModel>
}

/** The snapshot per panel, plus when it was read. */
const caches = new Map<TraePanel, { snapshot: StatusSnapshot, at: number }>()

/**
 * The snapshot, read from the Host once and reused briefly.
 *
 * `undefined` means "not known" — the caller renders the plain name rather than
 * guessing, because a badge that claims a promotion the upstream never stated
 * is worse than no badge.
 */
async function statusNow(panel: TraePanel): Promise<StatusSnapshot | undefined> {
  const cached = caches.get(panel)
  if (cached !== undefined && Date.now() - cached.at < CACHE_MS) return cached.snapshot
  try {
    // The answer is per PANEL: `enterprise` shares the CN credential but bills a
    // different pool and serves a different roster, so asking without the panel
    // would show one roster's promotions on another's models.
    const response = await fetch(withTraeRegionFastDetail(TRAE_USAGE_PATH, panel), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (!response.ok) return undefined
    const body = await response.json() as { models?: readonly TraeWebModel[] }
    const models = new Map<string, TraeWebModel>()
    for (const model of body.models ?? []) models.set(model.id, model)
    const snapshot: StatusSnapshot = { models }
    caches.set(panel, { snapshot, at: Date.now() })
    return snapshot
  } catch {
    // The Host is unreachable or refused: no badge. Never a made-up one.
    return undefined
  }
}

/** Forget the cached snapshots; used by the tests. */
export function resetTraeModelLabelCache(): void {
  caches.clear()
}

/** One shared minute ticker, so N mounted labels cost one timer, not N. */
const minuteTicker: { timer: ReturnType<typeof setInterval> | undefined, listeners: Set<() => void> } = {
  timer: undefined,
  listeners: new Set(),
}

/**
 * Re-render the caller once a minute while it is mounted.
 *
 * @param listener - The callback to run at each tick.
 * @returns The unsubscribe function, which stops the shared timer when the last
 *          listener leaves.
 */
function subscribeMinute(listener: () => void): () => void {
  minuteTicker.listeners.add(listener)
  if (minuteTicker.timer === undefined) {
    minuteTicker.timer = setInterval(() => {
      for (const each of [...minuteTicker.listeners]) each()
    }, TICK_MS)
    // A pending interval keeps the Node event loop alive. This one exists for
    // the UI, so it must never be the reason a test run or a CLI command hangs.
    const handle = minuteTicker.timer as unknown as { unref?: () => void }
    handle.unref?.()
  }
  return () => {
    minuteTicker.listeners.delete(listener)
    if (minuteTicker.listeners.size === 0 && minuteTicker.timer !== undefined) {
      clearInterval(minuteTicker.timer)
      minuteTicker.timer = undefined
    }
  }
}

/**
 * The UI's language, as the browser reports it.
 *
 * The card formats dates and numbers with the browser's locale, so reading the
 * same signal here keeps the badge in the language the user reads. Read
 * defensively: this module is imported by tests that run in a plain Node
 * environment, where neither global exists.
 */
export function uiLanguage(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language !== '') {
    return navigator.language
  }
  if (typeof document !== 'undefined' && typeof document.documentElement?.lang === 'string') {
    return document.documentElement.lang
  }
  return ''
}

/** Whether the given language is an English one. */
function isEnglish(language: string): boolean {
  return language.toLowerCase().startsWith('en')
}

/** The copy table for one language, so the slot needs no injected `t`. */
function copyFor(language: string): Record<TraeSettingsKey, string> {
  return isEnglish(language) ? en : zh
}

/**
 * Fill `{name}` placeholders in one locale string.
 *
 * The card's own `t` does this; the slot cannot use `t` (it is rendered by the
 * host, outside the card's injection), so the same substitution is done here on
 * the same table. Both phrasings are always passed: the zh locale spells a pay
 * ratio as "5 折" and needs `{zhe}`, the en one says "50% off" and needs
 * `{percent}` — each uses the placeholder it names, the other is ignored.
 */
export function fillPlaceholders(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
}

/** Pay ratio as the "折" figure a Chinese price tag uses: 50 → "5", 25 → "2.5". */
export function promoZhe(discountPercent: number): string {
  const zhe = Math.round(discountPercent * 10) / 100
  return Number.isInteger(zhe) ? String(zhe) : zhe.toFixed(1)
}

/** The locale key that names each promotion kind. */
const PROMO_LABELS: Record<TraePromoKind, TraeSettingsKey> = {
  limited: 'row.promoLimited',
  subsidy: 'row.promoSubsidy',
  offPeak: 'row.promoOffPeak',
}

/**
 * The chip's colour per kind, mirroring `.dsm-trae-model-promo-*` in
 * `styles.ts`.
 *
 * Written inline because a slot component is rendered OUTSIDE the card: the
 * card's stylesheet is only mounted while the card is, so a picker opened on a
 * page where the card was never opened would otherwise get an uncoloured chip.
 * The tokens are the same ones the stylesheet uses, with the same fallbacks.
 */
const PROMO_TONES: Record<TraePromoKind, { color: string, border: string, background: string }> = {
  subsidy: {
    color: 'var(--dsw-alias-state-error-primary,#d92d20)',
    border: 'color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 40%,transparent)',
    background: 'color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 10%,transparent)',
  },
  limited: {
    color: 'var(--dsw-alias-state-warn-primary,#f59e0b)',
    border: 'color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 45%,transparent)',
    background: 'color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 12%,transparent)',
  },
  offPeak: {
    color: 'var(--dsw-alias-brand-primary,#5686fe)',
    border: 'color-mix(in srgb,var(--dsw-alias-brand-primary,#5686fe) 40%,transparent)',
    background: 'color-mix(in srgb,var(--dsw-alias-brand-primary,#5686fe) 10%,transparent)',
  },
}

/**
 * Split the host's display name into "name" and "the multiplier to show".
 *
 * `traeModelDisplayName` builds `"<name> · x<multiplier>"` and the host renders
 * that string verbatim, so appending another rate next to it would print the
 * figure twice in the picker (`Kimi-K2 · x0.55 · x0.55`). The suffix is
 * therefore pulled back OUT of the string and re-drawn in the span that can
 * carry the discounted value — exactly one number, and it is the one that holds
 * right now.
 *
 * The suffix is recognised by SHAPE, not by comparing against the snapshot's
 * `creditMultiplier`: the two can disagree (a promotion can change the catalog
 * figure between the snapshot and this render), and leaving the suffix in place
 * then prints two numbers again — the very defect this function removes.
 *
 * @param name - The host's rendered name, possibly ending in ` · x<rate>`.
 * @param catalogRate - The catalog multiplier, as the snapshot reports it.
 * @param discounted - The rate to show instead, when a discount is running.
 * @returns The name without its rate suffix, and the single rate to draw.
 *          `undefined` means "draw no number" (the name had none and no discount
 *          is running).
 */
export function splitCatalogRate(
  name: string,
  catalogRate: number | undefined,
  discounted: number | undefined,
): { base: string, rate: number | undefined } {
  const match = / · x(\d+(?:\.\d+)?)$/.exec(name)
  const fromName = match === null ? undefined : Number(match[1])
  const base = match === null ? name : name.slice(0, match.index)
  // The discount wins; otherwise keep the number the name carried; otherwise
  // fall back to the snapshot (a name with no suffix still gets its rate).
  const rate = discounted ?? fromName ?? catalogRate
  return { base, rate }
}

/** The rate a live badge says the user pays, when it names one. */
function discountedRateOf(badge: TraePromoBadge | undefined): number | undefined {
  // `rate` is the post-discount `consumption_rate`; a "free" campaign reports 0,
  // which is a real price and must survive (only `undefined` means "not said").
  return badge?.rate
}

/**
 * The upstream's promotion chip, as the picker draws it.
 *
 * Same classes as the card's capsule so the two surfaces cannot drift apart,
 * plus the inline tone described in {@link PROMO_TONES}.
 *
 * @param props - The resolved badge and the copy table for the UI's language.
 * @returns The chip.
 */
function PromoChip(props: { badge: TraePromoBadge, copy: Record<TraeSettingsKey, string> }): ReactElement {
  const { badge, copy } = props
  const zhe = promoZhe(badge.discountPercent)
  const label = fillPlaceholders(copy[PROMO_LABELS[badge.kind]], { zhe, percent: String(badge.percentOff) })
  // Upstream's own figures go into the hover only; the chip stays short so a
  // 24-model list does not turn into a wall of numbers.
  const hints: string[] = []
  if (badge.beforeRate !== undefined && badge.rate !== undefined) {
    hints.push(fillPlaceholders(copy['row.promoHintRate'], { before: String(badge.beforeRate), rate: String(badge.rate) }))
  }
  if (badge.fromClock !== undefined && badge.untilClock !== undefined && badge.timeZone !== undefined) {
    hints.push(fillPlaceholders(copy['row.promoHintWindow'], { from: badge.fromClock, until: badge.untilClock, zone: badge.timeZone }))
  }
  if (badge.memberDiscountPercent !== undefined && badge.memberRate !== undefined) {
    hints.push(fillPlaceholders(copy['row.promoHintMember'], {
      rate: String(badge.memberRate),
      zhe: promoZhe(badge.memberDiscountPercent),
      percent: String(100 - badge.memberDiscountPercent),
    }))
  }
  const tone = PROMO_TONES[badge.kind]
  return (
    <span
      className={`dsm-trae-model-promo dsm-trae-model-promo-${badge.kind} dsm-trae-model-label-promo`}
      title={hints.length === 0 ? label : hints.join(' · ')}
      style={{
        flex: 'none',
        borderRadius: '999px',
        padding: '1px 7px',
        fontSize: '10px',
        fontWeight: 500,
        lineHeight: '15px',
        whiteSpace: 'nowrap',
        border: `1px solid ${tone.border}`,
        color: tone.color,
        background: tone.background,
        // A menu row is one line wide: the chip may shrink, its text may not
        // wrap, and the ellipsis keeps a long "限时 5 折" from pushing the row.
        maxWidth: '6em',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </span>
  )
}

/**
 * The label for one model row in the host's picker.
 *
 * @param props - The host's model identity and the placement of this label.
 * @returns The catalog name, followed by the promotion chip when one holds.
 */
export function TraeModelLabel(props: {
  provider: { id: string, name: string }
  model: { id: string, name: string }
  placement: 'trigger' | 'menu' | 'option'
  selected: boolean
}): ReactElement {
  const { provider, model } = props
  const panel = panelOfProvider(provider.id)
  if (panel === undefined) {
    // Another provider's model: the host renders the plain name.
    return <span>{model.name}</span>
  }
  return <TraeModelLabelInner modelId={model.id} name={model.name} panel={panel} />
}

/** The stateful half: fetches the snapshot, then renders what holds right now. */
function TraeModelLabelInner(props: {
  modelId: string
  name: string
  panel: TraePanel
}): ReactElement {
  const { modelId, name, panel } = props
  const [snapshot, setSnapshot] = useState<StatusSnapshot | undefined>(undefined)
  const [, setTick] = useState(0)

  useEffect(() => {
    let live = true
    void statusNow(panel).then(next => {
      // Superseded while in flight: a newer answer must not be overwritten by
      // an older one.
      if (!live || next === undefined) return
      setSnapshot(next)
    })
    return () => { live = false }
  }, [modelId, panel])

  // The clock is an input to the badge, so the component has to re-read it
  // while it is mounted. One shared timer for every label keeps an open menu
  // with twenty rows from starting twenty intervals.
  useEffect(() => subscribeMinute(() => setTick(count => count + 1)), [])

  const model = snapshot?.models.get(modelId)
  // Resolved against NOW, not against the fetch: an off-peak window that opened
  // after this snapshot was cached still shows, and one that closed stops.
  const badge = model === undefined ? undefined : selectTraePromoBadge(model.activityDiscount, new Date())
  const { base, rate } = splitCatalogRate(name, model?.creditMultiplier, discountedRateOf(badge))
  const copy = copyFor(uiLanguage())

  return (
    <span
      className="dsm-trae-model-label"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', verticalAlign: 'baseline' }}
    >
      <span>{base}</span>
      {rate === undefined
        ? null
        : <span className="dsm-trae-model-label-rate"> · x{rate.toFixed(2)}</span>}
      {badge === undefined ? null : <PromoChip badge={badge} copy={copy} />}
    </span>
  )
}
