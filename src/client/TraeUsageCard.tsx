/**
 * Trae usage card contributed to Harness Plugin configuration.
 *
 * Structure, CSS classes, and button primitives mirror `dsh-subagent-default-model`'s
 * `SubagentModelCard` so the two plugins share one external-presentation language.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import {
  configuredAccountsOf,
  nextRegionEnabled,
  nextRegionCreditPosition,
  nextRegionSlots,
  regionCreditPositionOf,
  regionEnabledOf,
  TRAE_ACCOUNT_STATUS_PATH,
  TRAE_ACCOUNTS_REFRESH_PATH,
  TRAE_CHECKIN_PATH,
  TRAE_MODELS_REFRESH_PATH,
  TRAE_MODELS_TEST_PATH,
  TRAE_PANELS,
  TRAE_USAGE_PATH,
  unwrapVolatileDeep,
  withTraeRegion,
  withTraeRegionFastDetail,
} from '../status-paths.ts'
import type { TraeModelProbeVerdict, TraeModelsTestResponse, TraeWebAccount, TraeWebAccountState, TraeWebCheckinClaim, TraeWebCreditExpiry, TraeWebModel, TraeWebUsage } from '../status-paths.ts'
import type { TraeCreditPosition } from '../status-paths.ts'
import { regionOfPanel, type TraePanel } from '../region.ts'
import { selectTraePromoBadge, type TraePromoKind } from '../promo.ts'
import { TRAE_PLUGIN_ICON } from './icon.ts'
import { TRAE_CARD_CSS } from './styles.ts'
import { BusyOverlay } from './BusyOverlay.tsx'
import { AccountPool } from './AccountPool.tsx'
import { AccountTransfer } from './AccountTransfer.tsx'
import { planVerdict as payVerdict } from './plan-text.ts'
import type { TraeSettingsKey } from './locales.ts'

/** Localized copy injected by the browser-plugin registration. */
export interface TraeUsageCardInjected {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
  /**
   * Optional by design: before the configForms mirror populates (or on a host
   * with no settings surface) this is undefined, and the card renders
   * read-only — saving is the only capability that needs it.
   */
  settingsScope?: {
    getSnapshot(): { status: string; value?: unknown; writable: boolean }
    subscribe(listener: () => void): () => void
    /** Whether the Host accepted the write. */
    set(field: string, value: unknown): Promise<boolean>
  }
}

/**
 * Props delivered by the Plugin configuration item slots
 * (`plugins.bundle.config` / `plugins.row.config`). The type is structural on
 * purpose: the slot names are declared by the host app bundle, not by any
 * package in the plugin's own tree, so referencing a named slot contract here
 * would fail to resolve in the plugin's dev environment.
 */
export type TraeUsageCardProps = Partial<TraeUsageCardInjected> & {
  /** The plugin manager asks for one of two views through its owner props.
   * `page` is the full form with its own save control; `summary` is a
   * one-liner. An absent `view` starts the card collapsed. */
  view?: 'summary' | 'page'
}

const POLL_INTERVAL_MS = 60_000
const TRAE_GITHUB_URL = 'https://github.com/dingminhua/dsh-connect-trae'

/** One region's unsaved model edits; switching tabs never drops these. */
interface TraeDraft {
  models: TraeWebModel[]
  enabledIds: Set<string>
  imageIds: Set<string>
  contextBudgets: Record<string, number>
}

/**
 * Write one settings field and confirm the value actually landed.
 *
 * `configForms.set()` resolving is NOT proof that anything was stored: a write
 * can be accepted by the transport and still not materialize — a rejected
 * write reloads Host state and merely RETURNS, so the caller's `await`
 * succeeds while the document is unchanged. The form answers with an explicit
 * boolean for exactly this reason.
 *
 * Either way the caller must not report success on an unpersisted write: the
 * user would see the control flip and then silently revert.
 *
 * @throws {TraeSettingsWriteError} when the write was refused or did not land.
 */
export class TraeSettingsWriteError extends Error {
  constructor(field: string, detail?: string) {
    super(detail === undefined || detail === ''
      ? `trae: settings field "${field}" was not persisted by the settings write`
      : `trae: settings field "${field}" was not persisted by the settings write (${detail})`)
    this.name = 'TraeSettingsWriteError'
  }
}

export async function writeSettingsField(
  scope: NonNullable<TraeUsageCardInjected['settingsScope']>,
  field: string,
  value: unknown,
  landed: (readBack: unknown) => boolean,
): Promise<void> {
  const accepted = await scope.set(field, value)
  // The 0.1.7 form answers an explicit boolean: `false` is a refusal.
  if (accepted === false) throw new TraeSettingsWriteError(field, 'the Host refused the write')
  if (!landed(unwrapVolatileDeep(scope.getSnapshot().value))) {
    throw new TraeSettingsWriteError(field)
  }
}

/** Read one region's stored `regions` slot out of an unwrapped settings value. */
function regionSlotsOf(value: unknown): Record<string, unknown> {
  const regions = (value as { regions?: unknown } | undefined)?.regions
  return typeof regions === 'object' && regions !== null ? regions as Record<string, unknown> : {}
}

/** Inject the shared card CSS once. */
if (typeof document !== 'undefined') {
  const cssId = 'dsh-connect-trae/client.css'
  if (!document.querySelector(`style[data-plugin-css="${cssId}"]`)) {
    const styleTag = document.createElement('style')
    styleTag.dataset.plugin = 'dsh-connect-trae'
    styleTag.dataset.pluginCss = cssId
    styleTag.textContent = TRAE_CARD_CSS
    document.head.appendChild(styleTag)
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

/** How close a refresh token must be to lapsing before the card warns, in days. */
const REFRESH_WARN_DAYS = 30

/**
 * The refresh-token warning for one account, or undefined when there is nothing
 * worth saying.
 *
 * The access token renews itself every few minutes, so its own expiry answers
 * "when does this need attention" with "never, until the refresh token lapses".
 * The refresh token is therefore the only honest countdown on this card, and it
 * has to be shown BEFORE it runs out: once it lapses the plugin cannot renew at
 * all and the only recovery is signing in to Trae again, which a user who has
 * been reading "auto-renewal" for months has no reason to expect.
 *
 * Three tones, matching the credit-expiry notice: `lapsed` (renewal already
 * dead), `soon` (inside the warning window), and nothing otherwise — a healthy
 * token must not add a line to every account row forever.
 */
function refreshTokenWarning(
  expiresAtMs: number | undefined,
  nowMs: number,
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string,
  formatTime: (value: number) => string,
): { tone: 'lapsed' | 'soon', text: string } | undefined {
  if (expiresAtMs === undefined) return undefined
  const text = formatTime(expiresAtMs)
  if (expiresAtMs <= nowMs) return { tone: 'lapsed', text: t('row.refreshTokenLapsed', { expiresAt: text }) }
  const days = Math.ceil((expiresAtMs - nowMs) / 86_400_000)
  if (days > REFRESH_WARN_DAYS) return undefined
  return { tone: 'soon', text: t('row.refreshTokenExpiring', { expiresAt: text, days }) }
}

function formatCapacity(value: number | undefined, unknown: string): string {
  if (value === undefined) return unknown
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`
  return formatNumber(value)
}

/**
 * The verdict badge for one model, or null when it has not been tested.
 *
 * `unknown` renders as inconclusive, never as a failure: a throttle or a dropped
 * connection says nothing about the model, and painting it the same red as a
 * real refusal is what makes users delete working models.
 */
const PROBE_LABELS: Record<TraeModelProbeVerdict, TraeSettingsKey> = {
  available: 'row.probeAvailable',
  gated: 'row.probeGated',
  unsupported: 'row.probeUnsupported',
  rate_limited: 'row.probeRateLimited',
  auth: 'row.probeAuth',
  unknown: 'row.probeUnknown',
}

function probeBadge(
  probe: { verdict: TraeModelProbeVerdict; detail: string } | undefined,
  t: (key: TraeSettingsKey) => string,
): ReactNode {
  if (probe === undefined) return null
  return (
    <span className={`dsm-trae-model-probe dsm-trae-model-probe-${probe.verdict}`} title={probe.detail}>
      {t(PROBE_LABELS[probe.verdict])}
    </span>
  )
}

/**
 * How each promotion kind is phrased.
 *
 * The wording is PLUGIN copy, not upstream's: Trae publishes a rule — a pay
 * ratio plus optional cheap-hours windows — and never a label (contrast
 * WorkBuddy's `badge.label`, see docs/PROMO_BADGE.md §3). Two things
 * follow, and both are deliberate:
 *
 *  - only `limited_discount` says 限时 / "limited"; upstream gives no end time
 *    for the other kinds, so claiming one would be inventing urgency;
 *  - the number shown is upstream's own pay ratio (`discount: 50` ⇒ 五折 /
 *    "50% off"), never a re-derived price.
 */
const PROMO_LABELS: Record<TraePromoKind, TraeSettingsKey> = {
  limited: 'row.promoLimited',
  subsidy: 'row.promoSubsidy',
  offPeak: 'row.promoOffPeak',
}

/** Pay ratio as the "折" figure a Chinese price tag uses: 50 → "5", 25 → "2.5". */
function promoZhe(discountPercent: number): string {
  const zhe = Math.round(discountPercent * 10) / 100
  return Number.isInteger(zhe) ? String(zhe) : zhe.toFixed(1)
}

/**
 * The model row's promotion capsule, or nothing.
 *
 * Judged HERE, at paint time, not when the directory was parsed: the rule's
 * windows are wall clocks in an upstream-named zone (00:00–09:00 on weekdays,
 * …), so a verdict frozen into a saved catalog would still be shouting about
 * last night's discount tomorrow afternoon. The card re-renders on its poll, so
 * the capsule appears and disappears with the window.
 *
 * One capsule at most, and it sits BESIDE the name rather than inside it: the
 * name is ellipsis-truncated, so a badge placed inside would be clipped away
 * exactly on the long model names.
 */
function promoBadge(
  model: TraeWebModel,
  t: TraeUsageCardInjected['t'],
  now: Date,
): ReactNode {
  const badge = selectTraePromoBadge(model.activityDiscount, now)
  if (badge === undefined) return null
  const zhe = promoZhe(badge.discountPercent)
  // Upstream's own figures go into the hover only; the capsule stays short so a
  // 24-model list does not turn into a wall of numbers.
  const hints: string[] = []
  if (badge.beforeRate !== undefined && badge.rate !== undefined) {
    hints.push(t('row.promoHintRate', { before: String(badge.beforeRate), rate: String(badge.rate) }))
  }
  if (badge.fromClock !== undefined && badge.untilClock !== undefined && badge.timeZone !== undefined) {
    hints.push(t('row.promoHintWindow', { from: badge.fromClock, until: badge.untilClock, zone: badge.timeZone }))
  }
  if (badge.memberDiscountPercent !== undefined) {
    // Both phrasings are passed: the zh locale says "另 {zhe} 折", en says
    // "{percent}% off", and one of them will use the other placeholder.
    hints.push(t('row.promoHintMember', {
      zhe: promoZhe(badge.memberDiscountPercent),
      percent: String(100 - badge.memberDiscountPercent),
    }))
  }
  return (
    <span
      className={`dsm-trae-model-promo dsm-trae-model-promo-${badge.kind}`}
      title={hints.length === 0 ? t(PROMO_LABELS[badge.kind], { zhe, percent: String(badge.percentOff) }) : hints.join(' · ')}
    >
      {t(PROMO_LABELS[badge.kind], { zhe, percent: String(badge.percentOff) })}
    </span>
  )
}

function dotStyle(status: TraeWebUsage['status']): Record<string, string> {
  const color = status === 'signed-in'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d92d20)'
      : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  return { background: color }
}

/**
 * A warning that credit is about to lapse.
 *
 * The balance alone cannot express this: a pack lapsing in an hour and one
 * lapsing next month both render as "150", so a user watching only the total
 * loses the first one silently. The notice names the amount, the pack count and
 * the soonest expiry, and escalates 7d → 24h → already-lapsed.
 *
 * Renders nothing when the upstream reported no end times at all — absence of
 * expiry data is not evidence that nothing lapses, so the component stays
 * silent rather than reassuring.
 */
function ExpiryNotice({ expiry, t, formatNumber: fmt, formatDateTime: fmtTime }: {
  expiry: TraeWebCreditExpiry
  /** Required here: the card throws before rendering if its own `t` is absent,
   *  so this component is only ever reached with a translation function. */
  t: TraeUsageCardInjected['t']
  formatNumber: (value: number) => string
  formatDateTime: (value: number) => string
}): ReactNode {
  const { expired, within24h, within7d } = expiry
  let message: string | undefined
  let soonest: number | undefined
  let tone: string
  // Escalation order: a live expiry the user can still act on outranks a lapsed
  // one they cannot, even when the lapsed amount is larger.
  if (within24h.packs > 0) {
    message = t('row.expiryWarningSoon', { total: fmt(within24h.total), packs: String(within24h.packs) })
    soonest = within24h.earliestExpiresAtMs
    tone = 'dsm-trae-expiry-soon'
  } else if (within7d.packs > 0) {
    message = t('row.expiryWarningWeek', { total: fmt(within7d.total), packs: String(within7d.packs) })
    soonest = within7d.earliestExpiresAtMs
    tone = 'dsm-trae-expiry-week'
  } else if (expired.packs > 0) {
    message = t('row.expiryWarningLapsed', { total: fmt(expired.total), packs: String(expired.packs) })
    tone = 'dsm-trae-expiry-lapsed'
  } else {
    return null
  }
  return (
    <div className={`dsm-trae-expiry ${tone}`} role="status">
      <span>{message}</span>
      {soonest === undefined
        ? null
        : <span className="dsm-trae-expiry-detail">{t('row.expiryEarliest', { time: fmtTime(soonest) })}</span>}
    </div>
  )
}

/** Render Trae sign-in state and the total usage summary as one expandable card. */
export function TraeUsageCard({ t, settingsScope, view }: TraeUsageCardProps) {
  if (t === undefined) throw new Error('Trae usage card requires its translation function')
  // The plugin manager opens the card as a full page (its own save control)
  // when it asks for `view: 'page'`; absent a view, start collapsed so a
  // summary row stays a one-liner.
  const [open, setOpen] = useState(view === 'page')
  /** The region whose tab is on screen; each tab is its own provider stack. */
  const [activeRegion, setActiveRegion] = useState<TraePanel>('cn')
  /**
   * Last-known usage per region, so tab dots survive tab switches.
   *
   * A region is ABSENT until something has been read for it (issue #77). It used
   * to be seeded with a signed-out document, which meant the whole wait for the
   * first paint rendered as "not signed in — sign in again / scan for accounts"
   * to a user who was perfectly signed in. The difference between "nothing known
   * yet" and "known to be signed out" is the difference between a loading line
   * and a wrong instruction, so the map starts empty and the render below says
   * which one it is.
   */
  const [statusByRegion, setStatusByRegion] = useState<Partial<Record<TraePanel, TraeWebUsage>>>({})
  const [busy, setBusy] = useState(false)
  /**
   * Availability verdicts from the one-click test, per region, keyed by model
   * id. Session-only on purpose: a verdict is one moment on one account, and a
   * persisted "not served" would keep claiming that long after upstream changed
   * its mind.
   */
  const [probeByRegion, setProbeByRegion] = useState<Record<TraePanel, Record<string, { verdict: TraeModelProbeVerdict; detail: string }>>>({ cn: {}, enterprise: {}, ai: {} })
  const [testing, setTesting] = useState<{ done: number; total: number } | undefined>(undefined)
  const [testError, setTestError] = useState<string | undefined>(undefined)
  const [testSummary, setTestSummary] = useState<string | undefined>(undefined)
  const [settingsRevision, setSettingsRevision] = useState(0)
  /** Per-region unsaved model edits; a draft on one tab is never dropped by
   * switching to the other tab, only by that tab's discard/save. */
  const [drafts, setDrafts] = useState<Partial<Record<TraePanel, TraeDraft>>>({})
  const [saving, setSaving] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  /** Region whose on/off checkbox write is in flight, so its box can't race. */
  const [togglingRegion, setTogglingRegion] = useState<TraePanel | undefined>(undefined)
  /**
   * Outcome of the last "refresh accounts" press (issue #25).
   *
   * The rescan answers 200 with a fresh account list whether or not anything
   * changed, and the selection is PERSISTED, so a rescan of a machine whose
   * bound account is still the one it was yesterday looks identical to a
   * failure. Reporting the outcome is the difference between "it did nothing"
   * and "it found the same 2 accounts, still on X".
   */

  const [rescanNote, setRescanNote] = useState<string | undefined>(undefined)
  /**
   * A preference the user just flipped, held only until its write lands.
   *
   * The 设置 block used to stage both switches in a draft written by 「保存」.
   * That is GONE: the sibling dsh-connect-workbuddy card commits its preference
   * checkboxes on the click, and a Save button for two booleans asks the user to
   * remember something that has no reason to need remembering.
   *
   * What remains is the smallest thing that keeps a click honest: the box reads
   * this optimistic value until the write settles, then falls back to the
   * committed one. So a flip shows immediately, and a write that FAILS snaps the
   * box back to the Host's value instead of leaving it claiming one that never
   * landed.
   */
  const optimisticSettings = useRef<{ showPointsInMainUi?: boolean | undefined }>({})
  /** True while a preference is crossing the wire; serializes both writers. */
  const [savingSettings, setSavingSettings] = useState(false)
  /**
   * Per-account status (check-in / balances / subscription) shown in each row of
   * the account table, keyed by region then account id. Loaded per account via
   * `TRAE_ACCOUNT_STATUS_PATH` once the table is shown; a row that failed to
   * load (or that has not been read yet) simply renders without its figure,
   * exactly as the composer table treats a missing balance.
   */
  const [accountStatusByRegion, setAccountStatusByRegion] = useState<Record<TraePanel, Record<string, TraeWebAccountState>>>({ cn: {}, enterprise: {}, ai: {} })
  /** Which account row is claiming right now, so only its button spins. */
  const [claimingFor, setClaimingFor] = useState<string | undefined>(undefined)
  /**
   * Per-account claim refusals, keyed by region then account id. A refusal is
   * shown next to the row that caused it rather than in one global error line,
   * because the check-in button now lives per account.
   */
  const [claimErrorByRegion, setClaimErrorByRegion] = useState<Record<TraePanel, Record<string, string>>>({ cn: {}, enterprise: {}, ai: {} })
  /**
   * Whether this MACHINE has spent today's check-in for a given account — the
   * "device is spent but this account was never rewarded" state, per account so
   * it appears next to the row that owns it. Kept separate from the claim error
   * because it is not a failure: it is the upstream's one-per-device-per-day
   * rule, and rendering it through the "签到失败：…" line would present a normal
   * rule as a plugin fault.
   */
  const [deviceSpentByRegion, setDeviceSpentByRegion] = useState<Record<TraePanel, Record<string, boolean>>>({ cn: {}, enterprise: {}, ai: {} })
  /**
   * A refused or unpersisted settings write, surfaced instead of silently
   * reverting. On 0.1.7 a rejected write resolves normally, so without this
   * the control would flip and then quietly snap back on the next snapshot.
   */
  const [writeError, setWriteError] = useState<string | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /**
   * The 设置 block: its committed values, its draft, and the ONE write path.
   *
   * The block commits on 「保存」 rather than on every click, so 「放弃」 has a
   * meaning and a half-finished edit cannot land in the settings document. Both
   * fields are written through `writeSettingsField`, which read-back checks the
   * document — `set()` resolving has never been proof a value landed on this
   * Host, so a saved-looking switch that silently reverted is exactly the
   * failure that guard exists for.
   *
   * Committed values are read from the settings document, never echoed from
   * local state: a write made elsewhere (the DSH settings form, another window)
   * then shows up here instead of being shadowed by a stale copy.
   */
  const committedSettings = {
    showPointsInMainUi: (unwrapVolatileDeep(settingsScope?.getSnapshot().value) as { showPointsInMainUi?: unknown } | null)?.showPointsInMainUi === true,
  }
  /**
   * Ids for the block's label/hint wiring. `useId`, not constants: DSH can mount
   * this card twice at once (the settings ROW and the expanded PAGE), and two
   * copies sharing an id would leave the second switch labelled by the first
   * card's element.
   */
  /**
   * What the two boxes render: the committed value, with any in-flight flip laid
   * over it. Reading BOTH sources here is what lets the write above stay simple —
   * it never has to write into component state that a Host refresh would fight.
   */
  const settingsEdits = {
    showPointsInMainUi: optimisticSettings.current.showPointsInMainUi ?? committedSettings.showPointsInMainUi,
  }
  const settingsIds = useId()
  const creditsLabelId = `${settingsIds}-credits`
  const creditsHintId = `${settingsIds}-credits-hint`

  /**
   * Write ONE preference switch, on the click that flipped it.
   *
   * This replaced a draft + 「保存」/「放弃」 pair, which is what the sibling
   * dsh-connect-workbuddy card does NOT have: its switches are plain checkboxes
   * on a bare line that commit immediately, and a card that needs a Save button
   * for two booleans is asking the user to remember something for no reason.
   *
   * The two writers are SERIALIZED by `savingSettings`, because they write the
   * same settings document. The pattern is the tab bar's `toggleRegion`: flip
   * optimistically so the box responds, then re-read the Host so a failed write
   * snaps it back instead of leaving the box claiming a value that never landed.
   */
  const writePreference = async (
    field: 'showPointsInMainUi',
    value: boolean,
  ): Promise<void> => {
    if (settingsScope === undefined || settingsScope.getSnapshot().writable !== true) return
    setSavingSettings(true)
    setWriteError(undefined)
    optimisticSettings.current = { ...optimisticSettings.current, [field]: value }
    setSettingsRevision(revision => revision + 1)
    try {
      await writeSettingsField(settingsScope, field, value,
        readBack => (unwrapVolatileDeep(readBack) as { showPointsInMainUi?: unknown } | null)?.showPointsInMainUi === value)
    } catch (error: unknown) {
      if (mounted.current) setWriteError(error instanceof Error ? error.message : t('row.requestFailed'))
    } finally {
      // Drop the optimistic overlay either way: on success the committed value
      // now agrees with it, and on failure the Host's value is the truth the box
      // must show.
      if (mounted.current) {
        optimisticSettings.current = { ...optimisticSettings.current, [field]: undefined }
        setSettingsRevision(revision => revision + 1)
      }
      if (mounted.current) setSavingSettings(false)
    }
  }

  useEffect(() => settingsScope?.subscribe(() => { setSettingsRevision(value => value + 1) }), [settingsScope])

  /**
   * WHERE the active tab's credit readout sits (learned from workbuddy #62).
   *
   * Read from the committed SETTINGS document, through the same
   * `regionCreditPositionOf` helper the Host uses — so the control reads
   * instantly and can never disagree with the readout's own gate, which reads
   * the same scope. This mirrors how the show/hide box beside it works
   * (`committedSettings`), rather than how the sibling workbuddy card does it:
   * that card reads the Host's usage answer because a measured defect on its
   * 0.1.7 deployments left the browser settings mirror for its namespace STALE.
   * No such staleness is reproducible here, and reading the mirror eagerly is
   * what keeps this control correct on first paint — a picker fed only by the
   * usage document would sit on the default until a fetch landed, which is the
   * "looks like it did nothing" failure this control must not have.
   *
   * `settingsRevision` is read through the setter above, and the whole block
   * re-renders when the scope notifies, so a write made elsewhere (another
   * window, the DSH settings form) converges here.
   */
  const creditPositionOn = (item: TraePanel): TraeCreditPosition =>
    regionCreditPositionOf(settingsScope?.getSnapshot().value, item)

  /**
   * Move one region's credit readout between its two seats.
   *
   * Same shape as every other region write on this card: the whole target slot
   * goes in (so a seat change cannot drop that region's model picks, budgets or
   * enabled flag, nor touch the sibling region), the write is read-back
   * verified, and the Host is re-read afterwards. The re-read is load-bearing
   * here — the control renders the Host's answer, so without it the picker
   * keeps showing the seat it had and the change looks like it did nothing.
   */
  const changeCreditPosition = async (item: TraePanel, position: TraeCreditPosition): Promise<void> => {
    if (settingsScope === undefined || settingsScope.getSnapshot().writable !== true) return
    setSavingSettings(true)
    setWriteError(undefined)
    try {
      const regions = nextRegionCreditPosition(settingsScope.getSnapshot().value, item, position)
      await writeSettingsField(
        settingsScope,
        'regions',
        regions,
        // The read-back must find the seat in THIS region's slot, which is what
        // makes a silently-reverted write visible rather than a picker that
        // claims a position the readout does not use.
        readBack => regionCreditPositionOf(readBack, item) === position)
      await refreshUsage(item)
    } catch (error: unknown) {
      if (mounted.current) setWriteError(error instanceof Error ? error.message : t('row.requestFailed'))
    } finally {
      if (mounted.current) setSavingSettings(false)
    }
  }

  void settingsRevision
  /**
   * Whether one region's provider is switched on, read off the SAME committed
   * settings document the Host reads (`regionEnabledOf` mirrors the Host's
   * `regionStateOf` opt-out rule: only an explicit `false` disables). Reading
   * the stored value rather than echoing local state means a rejected write,
   * another window's change, or a restart all converge on the truth.
   *
   * The whole settings section is passed deliberately: `regionEnabledOf`
   * accepts either it or the bare `regions` map, because passing the section
   * where the map was expected was a shipped bug (the lookup read
   * `section['cn']`, found nothing, and reported `true` forever — the checkbox
   * stayed checked and clicking it appeared dead while the write succeeded).
   */
  const regionOn = (item: TraePanel): boolean =>
    regionEnabledOf(settingsScope?.getSnapshot().value, item)
  const activeRegionOn = regionOn(activeRegion)
  /**
   * Credential region of the ACTIVE PANEL.
   *
   * The enterprise panel is a second CN pool, so anything that asks "is this the
   * international side?" — pay status vs. credit packs, check-in column, the
   * credit-readout switch — must answer by CREDENTIAL REGION, not by tab
   * identity. `isCnPool` is the common case (cn + enterprise).
   */
  const credentialRegionIsAi = regionOfPanel(activeRegion) === 'ai'
  const isCnPool = !credentialRegionIsAi

  const refreshUsage = useCallback(async (
    region: TraePanel,
    signal?: AbortSignal,
  ): Promise<TraeWebUsage | undefined> => {
    try {
      const response = await fetch(withTraeRegion(TRAE_USAGE_PATH, region), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const usage = value as TraeWebUsage
      if (mounted.current && signal?.aborted !== true) {
        setStatusByRegion(prev => ({ ...prev, [region]: usage }))
      }
      return usage
    } catch (error: unknown) {
      if (mounted.current && signal?.aborted !== true) {
        setStatusByRegion(prev => ({
          ...prev,
          [region]: { status: 'error', message: error instanceof Error ? error.message : t('row.requestFailed') },
        }))
      }
      return undefined
    }
  }, [t])

  /**
   * Paint the fast document (issue #77).
   *
   * The full document above cannot answer before the Host has read every member's
   * balance — one upstream round-trip per account, and this panel's pool assembly
   * happens to walk the membership more than once. That is the wait the issue
   * reports: tens of seconds in which the card used to show nothing at all.
   *
   * The fast document is built from local state only (no upstream read at all), so
   * it answers in milliseconds and carries everything needed to DRAW: the bound
   * account, its expiry, the model list and the pool rows. The live figures it
   * omits (credits, check-in column) are exactly the values that need the round
   * trip, and the card already renders their absence as `—` / unknown.
   *
   * Deliberately separate from {@link refreshUsage} rather than a parameter of it:
   * a first paint never writes an error state (a slow upstream is not the user's
   * problem until the full document says so), and it must never downgrade a region
   * that has already been painted in full.
   */
  const refreshUsageFast = useCallback(async (
    region: TraePanel,
    signal?: AbortSignal,
  ): Promise<void> => {
    try {
      const response = await fetch(withTraeRegionFastDetail(TRAE_USAGE_PATH, region), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) return
      const value: unknown = await response.json().catch(() => undefined)
      const usage = value as TraeWebUsage | undefined
      if (usage === undefined) return
      if (!mounted.current || signal?.aborted === true) return
      setStatusByRegion(prev => {
        const previous = prev[region]
        // A full document already on screen wins: repainting it from a thinner one
        // would make credits and check-in marks flicker away for no reason.
        if (previous !== undefined && previous.status === 'signed-in') return prev
        return { ...prev, [region]: usage }
      })
    } catch {
      // A failed first paint is simply no paint yet — the full document (or its
      // error state) is the one that reports failures.
    }
  }, [])

  useEffect(() => {
    if (!open || !activeRegionOn) return
    const controller = new AbortController()
    void (async () => {
      // Paint first, then pay for the live figures. Sequential on purpose: the full
      // request must not race the fast one into the same region's state.
      await refreshUsageFast(activeRegion, controller.signal)
      if (controller.signal.aborted) return
      void refreshUsage(activeRegion, controller.signal)
    })()
    return () => { controller.abort() }
  }, [open, activeRegion, activeRegionOn, refreshUsage, refreshUsageFast])

  /**
   * The document actually on screen for this region, and whether one has arrived.
   *
   * `loaded === undefined` is the only state that may render the loading line: a
   * signed-out document is a real answer (the user must sign in), never a stand-in
   * for "still fetching".
   */
  const loaded: TraeWebUsage | undefined = statusByRegion[activeRegion]
  const loading = loaded === undefined

  const status: TraeWebUsage = loaded ?? { status: 'signed-out', accounts: [] }

  /**
   * Clear in-flight claim state when the tab changes. `activeRegion` is a single
   * value across both tabs, so a switch must not leave one row's claim spinning
   * under the other tab.
   */
  useEffect(() => {
    // `claimingFor` is a single value across both tabs: a tab switch must not
    // leave one row's in-flight claim spinning under the other tab. The per-region
    // account status (`accountStatusByRegion`) is kept keyed by region so a tab
    // switch does not discard already-loaded rows.
    setClaimingFor(undefined)
  }, [activeRegion])

  useEffect(() => {
    if (!open || !activeRegionOn || status.status !== 'signed-in') return
    const controller = new AbortController()
    const timer = window.setInterval(() => { void refreshUsage(activeRegion, controller.signal) }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [open, activeRegion, activeRegionOn, refreshUsage, status.status])

  const rescanAccounts = async (): Promise<void> => {
    setBusy(true)
    setWriteError(undefined)
    try {
      const response = await fetch(withTraeRegion(TRAE_ACCOUNTS_REFRESH_PATH, activeRegion), {
        method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin',
      })
      const body = await response.json() as { accounts?: { id: string; selected: boolean; accountName?: string }[] }
      if (!response.ok || !Array.isArray(body.accounts)) throw new Error(`HTTP ${response.status}`)
      /**
       * What this press must persist, and why it is NOT `accounts.find(selected)`.
       *
       * The route's `selected` flag answers "which account is IN USE" — and the
       * store reports the account it is bound to, OR, when no binding has ever
       * been saved, the DETECTED default (`preferred`, i.e. whatever the Trae
       * app is signed in to). Those are the same value on a machine that has
       * been used for a while and diverge on exactly the press where it matters:
       * a fresh install, or a Trae sign-in the plugin has not recorded yet.
       *
       * Reading the flag alone therefore meant "nothing was explicitly bound"
       * reduced to "the detected default is what is in use, write nothing" —
       * so the account the user just refreshed was shown as bound while
       * `accounts.<region>` stayed EMPTY, and the next store rebuild (restart,
       * or a Trae sign-in change) silently re-defaulted somewhere else. That is
       * the "refreshed account was not saved" report.
       *
       * The rule is now: persist the account this region is actually using
       * (the store's verdict, which is the truth the card is displaying), and
       * fall back to the region's own roster only when the route returned no
       * verdict at all. A row that is already the SAVED binding is left alone —
       * one press must not rewrite the settings document for nothing.
       */
      const inUse = body.accounts.find(account => account.selected) ?? body.accounts[0]
      const configured = configuredAccountsOf(settingsScope?.getSnapshot().value)
      const alreadyBound = inUse !== undefined && inUse.id === configured[activeRegion]
      const writable = settingsScope !== undefined && settingsScope.getSnapshot().writable === true
      const saved = inUse !== undefined && !alreadyBound && writable
      if (saved && settingsScope !== undefined && inUse !== undefined) {
        await writeSettingsField(settingsScope, 'accounts',
          { ...configured, [activeRegion]: inUse.id },
          readBack => configuredAccountsOf(readBack)[activeRegion] === inUse.id)
      }
      await refreshUsage(activeRegion)
      if (mounted.current) {
        setRescanNote(body.accounts.length === 0
          ? t('row.accountsRefreshedNone')
          : t('row.accountsRefreshed', {
            count: String(body.accounts.length),
            // Name what was BOUND, and say whether this press moved it. The
            // previous wording reported "still bound to X" for a press that
            // saved nothing at all, which is what made the gap invisible.
            selected: saved
              ? ` · ${t('row.accountsSaved')} ${inUse.accountName ?? inUse.id}`
              : ` · ${t('row.accountsKept')} ${inUse?.accountName ?? configured[activeRegion] ?? '—'}`,
          }))
      }
    } catch (error: unknown) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : t('row.requestFailed')
        setRescanNote(t('row.accountsRescanFailed', { message }))
        setWriteError(message)
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const switchAccount = async (accountId: string): Promise<void> => {
    if (settingsScope === undefined) return
    setSwitchingAccount(true)
    setWriteError(undefined)
    try {
      const configured = configuredAccountsOf(settingsScope.getSnapshot().value)
      await writeSettingsField(settingsScope, 'accounts',
        { ...configured, [activeRegion]: accountId },
        readBack => configuredAccountsOf(readBack)[activeRegion] === accountId)
      // Refresh the usage documentso the "in use" badge moves, and re-read the
      // newly bound account's per-row status so its check-in/balance/subscription
      // figures agree with the badge instead of disagreeing in front of the user.
      await refreshUsage(activeRegion)
      void loadAccountStatus(accountId, activeRegion)
    } catch (error: unknown) {
      if (mounted.current) setWriteError(error instanceof Error ? error.message : t('row.requestFailed'))
    } finally {
      if (mounted.current) setSwitchingAccount(false)
    }
  }



  /**
   * Load one account row's per-account state (check-in / balances /
   * subscription) and cache it for the row. Called when the table renders and
   * again after a claim so the reward/refusal lands on the row that owns it.
   */
  const loadAccountStatus = async (accountId: string, region: TraePanel = activeRegion): Promise<TraeWebAccountState | undefined> => {
    try {
      const url = `${withTraeRegion(TRAE_ACCOUNT_STATUS_PATH, region)}&accountId=${encodeURIComponent(accountId)}`
      const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      const body = await response.json().catch(() => ({})) as (TraeWebAccountState & { error?: string })
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      if (mounted.current) {
        setAccountStatusByRegion(prev => ({ ...prev, [region]: { ...prev[region], [accountId]: body } }))
      }
      return body
    } catch {
      // A row that fails to load keeps its seat without a figure — the account
      // is still switchable, and the failure is not worth an error banner.
      return undefined
    }
  }

  /**
   * Re-read EVERY row of one region, not just the one that was acted on.
   *
   * Trae spends the DEVICE's daily check-in, not the account's, so one claim
   * changes what every other row may do: they go from "check in" to "device
   * already used". Re-reading only the claimed account left its siblings
   * advertising a claim that could only come back 9095 — a row of live buttons
   * of which exactly one could work, which is the same false promise the 3.2.0
   * note refused bulk check-in for. Reading the siblings instead of guessing
   * them means the server's own `didCheckedIn` decides, so a sibling that is
   * still genuinely claimable (the device was not spent by this claim) keeps
   * its button.
   */
  const reloadAccountStatuses = async (region: TraePanel): Promise<void> => {
    // `accounts` exists only on the signed-in variant. Every caller is reached
    // from a rendered account row, so this is a narrowing guard, not a branch.
    if (status.status !== 'signed-in') return
    const ids = status.accounts.map(account => account.id)
    await Promise.all(ids.map(id => loadAccountStatus(id, region)))
  }

  /**
   * Claim today's check-in reward for ONE named account row (CN only).
   *
   * The Host route owns every guard that matters — POST only, loopback origin
   * only, CN only, and a status read before the claim — because a browser-side
   * check is not a guard. The row button's own `disabled` is therefore a
   * courtesy (it stops an obviously pointless click), not the protection. The
   * body carries the `accountId`, so the claim reaches THAT account's
   * credential without moving the whole binding.
   *
   * A refusal is not thrown away: the route answers `claimed: false` with the
   * upstream's business code and message, and the row shows it. Three answers
   * are distinguished rather than collapsed into "failed":
   *
   *  - `alreadyCheckedIn` — this ACCOUNT was already paid today; show it as
   *    claimed and refresh, never as an error.
   *  - `deviceCheckedIn` (code 9095) — this MACHINE already spent today's
   *    check-in, so this account cannot claim here today. That is the normal
   *    outcome after switching accounts, and saying "check-in failed" would
   *    blame the plugin for an upstream rule.
   *  - anything else — a real refusal, reported verbatim.
   */
  const claimFor = async (accountId: string): Promise<void> => {
    if (activeRegion !== 'cn') return
    setClaimingFor(accountId)
    setClaimErrorByRegion(prev => {
      const next = { ...prev[activeRegion] }
      delete next[accountId]
      return { ...prev, [activeRegion]: next }
    })
    setDeviceSpentByRegion(prev => {
      const next = { ...prev[activeRegion] }
      delete next[accountId]
      return { ...prev, [activeRegion]: next }
    })
    try {
      const response = await fetch(withTraeRegion(TRAE_CHECKIN_PATH, activeRegion), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ accountId }),
      })
      const body = await response.json().catch(() => undefined) as (TraeWebCheckinClaim & { error?: string }) | undefined
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
      if (body?.claimed === false && body.deviceCheckedIn === true) {
        // Mark this row as device-spent, refresh, and re-read the row's state.
        setDeviceSpentByRegion(prev => ({ ...prev, [activeRegion]: { ...prev[activeRegion], [accountId]: true } }))
        await refreshUsage(activeRegion)
        await reloadAccountStatuses(activeRegion)
        return
      }
      if (body?.claimed === false && body.alreadyCheckedIn !== true) {
        throw new Error(body.message === undefined || body.message === ''
          ? t('row.checkinRefused', { code: String(body.code ?? '') })
          : `${t('row.checkinRefused', { code: String(body.code ?? '') })}: ${body.message}`)
      }
      await refreshUsage(activeRegion)
      await reloadAccountStatuses(activeRegion)
    } catch (error: unknown) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : t('row.requestFailed')
        setClaimErrorByRegion(prev => ({ ...prev, [activeRegion]: { ...prev[activeRegion], [accountId]: message } }))
      }
    } finally {
      if (mounted.current) setClaimingFor(undefined)
    }
  }

  /**
   * Load every account row's per-account status when the card shows a
   * signed-in region. This is what makes the check-in buttons, balances, and
   * (ai) subscription rows appear. It is scoped to a stable `status.accounts`
   * identity so switching tabs or re-reading the document does not re-trigger a
   * burst of upstream calls for rows already loaded.
   */
  useEffect(() => {
    if (!open || !activeRegionOn || status.status !== 'signed-in' || status.accounts.length === 0) return
    const accountsKey = status.accounts.map(account => account.id).join('\u0000')
    const loadedIds = accountStatusByRegion[activeRegion]
    const todo = status.accounts.filter(account => loadedIds[account.id] === undefined)
    if (todo.length === 0) return
    for (const account of todo) void loadAccountStatus(account.id, activeRegion)
    // `accountsKey` is the identity of the roster being shown: every load lands
    // in `accountStatusByRegion`, which re-runs this and immediately hits the
    // `todo.length === 0` early return — so the loop converges after one pass.
    // `loadAccountStatus` is recreated per render but is only used when `todo`
    // is non-empty, so it is deliberately excluded from the dependency list.
  }, [open, activeRegionOn, status, accountStatusByRegion]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Switch one region's provider off or on (issue #11). The write carries the
   * region's whole slot through untouched — only `enabled` changes — so the
   * user's directory, model picks, image opt-ins and budgets survive a
   * round trip. The Host withdraws or restores the provider route on the next
   * `onChange`, which is what actually removes it from DSH's model picker.
   */
  const toggleRegion = async (item: TraePanel, enabled: boolean): Promise<void> => {
    if (settingsScope === undefined || settingsScope.getSnapshot().writable !== true) return
    setTogglingRegion(item)
    setWriteError(undefined)
    try {
      // `nextRegionEnabled` unwraps the settings section itself and returns the
      // bare `regions` map, which is exactly what this field write needs.
      await writeSettingsField(settingsScope, 'regions',
        nextRegionEnabled(settingsScope.getSnapshot().value, item, enabled),
        readBack => regionSlotsOf(readBack)[item] !== undefined
          && (regionSlotsOf(readBack)[item] as { enabled?: unknown }).enabled === enabled)
    } catch (error: unknown) {
      if (mounted.current) setWriteError(error instanceof Error ? error.message : t('row.requestFailed'))
    } finally {
      if (mounted.current) setTogglingRegion(undefined)
    }
  }

  /**
   * One-click availability test for a list of models of the active region.
   *
   * Shared by the「enabled models」and「all models」buttons: the only difference
   * between them is which ids are sent — the enabled rows or the whole visible
   * catalog. Each run goes one model per request, deliberately: the host probe
   * is sequential anyway (Trae throttles bursts), and a per-model round trip
   * lets each row show its verdict as soon as it is known instead of the card
   * sitting blank for a minute. User-started, and it stops on the first
   * authentication failure — every later probe would only repeat that answer.
   */
  const testModels = async (ids: readonly string[]): Promise<void> => {
    setTestError(undefined)
    setTestSummary(undefined)
    if (ids.length === 0) {
      setTestError(t('row.modelsTestEmpty'))
      return
    }
    setTesting({ done: 0, total: ids.length })
    const collected: Record<string, { verdict: TraeModelProbeVerdict; detail: string }> = {}
    let available = 0
    let denied = false
    try {
      for (const [index, id] of ids.entries()) {
        if (!mounted.current) return
        const response = await fetch(withTraeRegion(TRAE_MODELS_TEST_PATH, activeRegion), {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ ids: [id] }),
        })
        const body = await response.json().catch(() => ({})) as TraeModelsTestResponse & { error?: string }
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
        const verdict = body.results?.[0]
        if (verdict !== undefined) {
          collected[id] = { verdict: verdict.verdict, detail: verdict.detail }
          if (verdict.verdict === 'available') available += 1
          setProbeByRegion(prev => ({ ...prev, [activeRegion]: { ...prev[activeRegion], [id]: { verdict: verdict.verdict, detail: verdict.detail } } }))
          if (verdict.verdict === 'auth') { denied = true; break }
        }
        setTesting({ done: index + 1, total: ids.length })
      }
      if (mounted.current) {
        setTestSummary(t('row.modelsTestDone', { available, total: Object.keys(collected).length }))
        if (denied) setTestError(t('row.probeAuth'))
      }
    } catch (error: unknown) {
      if (mounted.current) setTestError(t('row.modelsTestError', { message: error instanceof Error ? error.message : t('row.requestFailed') }))
    } finally {
      if (mounted.current) setTesting(undefined)
    }
  }

  /** Test only the enabled models of the active region. */
  const testEnabledModels = async (): Promise<void> => {
    const ids = [...activeEnabledIds]
    if (ids.length === 0) {
      setTestError(t('row.modelsTestEmpty'))
      setTestSummary(undefined)
      return
    }
    void testModels(ids)
  }

  /**
   * One-click availability test for EVERY model in the active region's catalog,
   * enabled or not — including the rows that are off and the rows the SOLO
   * channel does not serve. The host validates each id against the live catalog
   * and reports rows it does not know as skipped, so passing the whole visible
   * list cannot spend quota on arbitrary config names. Costs quota per model —
   * meaningfully more than the「enabled only」run, which the hint states.
   */
  const testAllModels = async (): Promise<void> => {
    const ids = visibleModels.map(model => model.id)
    if (ids.length === 0) {
      setTestError(t('row.modelsTestEmpty'))
      setTestSummary(undefined)
      return
    }
    void testModels(ids)
  }

  const refreshModels = async (): Promise<void> => {
    setBusy(true)
    try {
      const response = await fetch(withTraeRegion(TRAE_MODELS_REFRESH_PATH, activeRegion), {
        method: 'POST',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      const body = await response.json() as { models?: TraeWebModel[] }
      if (!response.ok || !Array.isArray(body.models)) throw new Error(`HTTP ${response.status}`)
      const fresh = body.models
      const freshIds = new Set(fresh.map(model => model.id))
      // Re-map the user's CURRENT selections (draft first, then saved) onto the
      // fresh catalog by model id, so refresh never silently loses enabled
      // choices, image opt-ins, or context budgets.
      const stillEnabled = [...activeEnabledIds].filter(id => freshIds.has(id))
      const stillImages = [...activeImageIds].filter(id => freshIds.has(id))
      const stillBudgets: Record<string, number> = {}
      for (const id of freshIds) {
        const budget = activeContextBudgets[id]
        if (typeof budget === 'number') stillBudgets[id] = budget
      }
      setDrafts(prev => ({
        ...prev,
        [activeRegion]: {
          models: fresh.map(model => ({ ...model, input: ['text'] as const })),
          enabledIds: new Set(stillEnabled),
          imageIds: new Set(stillImages),
          contextBudgets: stillBudgets,
        },
      }))
    } catch (error: unknown) {
      if (mounted.current) setStatusByRegion(prev => ({
        ...prev,
        [activeRegion]: { status: 'error', message: error instanceof Error ? error.message : t('row.requestFailed') },
      }))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  // Deep-unwrap ONCE at the source: on DSH 0.1.7 the whole section (and each
  // volatile field inside it) arrives as a `{get(): T}` live reference. Every
  // read below assumes a plain object — `regions` would otherwise pass the
  // `typeof === 'object'` check while every region lookup on it returns
  // undefined, so the card would show no saved budgets or image opt-ins at all.
  const settingsValue = unwrapVolatileDeep(settingsScope?.getSnapshot().value)
  // Region-scoped saved state: the active tab's own slot first; the
  // pre-region-split flat fields are only read for cn (the Host reads them the
  // same way, see regionStateOf), so a budget set on one region's model is
  // never applied to the other's.
  const region: TraePanel = activeRegion
  const configuredRegions = typeof settingsValue === 'object' && settingsValue !== null && typeof (settingsValue as { regions?: unknown }).regions === 'object' && (settingsValue as { regions?: unknown }).regions !== null
    ? (settingsValue as { regions: Record<string, { contextBudgets?: unknown; imageModelIds?: unknown[] }> }).regions
    : {}
  const regionSlot = configuredRegions[region]
  const legacySlot = region === 'cn' && regionSlot === undefined
  const slotContextBudgets = typeof regionSlot?.contextBudgets === 'object' && regionSlot.contextBudgets !== null
    ? regionSlot.contextBudgets as Record<string, number>
    : undefined
  const legacyContextBudgets = legacySlot && typeof settingsValue === 'object' && settingsValue !== null && typeof (settingsValue as { contextBudgets?: unknown }).contextBudgets === 'object' && (settingsValue as { contextBudgets?: unknown }).contextBudgets !== null
    ? (settingsValue as { contextBudgets: Record<string, number> }).contextBudgets
    : undefined
  const savedContextBudgets = slotContextBudgets ?? legacyContextBudgets ?? {}
  const slotImageIds = Array.isArray(regionSlot?.imageModelIds)
    ? regionSlot.imageModelIds.filter((id): id is string => typeof id === 'string')
    : undefined
  const legacyImageIds = legacySlot && typeof settingsValue === 'object' && settingsValue !== null && Array.isArray((settingsValue as { imageModelIds?: unknown }).imageModelIds)
    ? (settingsValue as { imageModelIds: unknown[] }).imageModelIds.filter((id): id is string => typeof id === 'string')
    : []
  const savedImageIds = new Set(slotImageIds ?? legacyImageIds)
  void settingsRevision
  // The card always renders the last-refreshed raw directory (`status.models`
  // carries `lastCatalog`), never a stale saved snapshot. Enabled flags come
  // from the user's stored selection, re-mapped onto the current catalog by
  // model id (= Trae name); context budgets work the same way.
  const draft = drafts[activeRegion]
  const visibleModels = draft?.models ?? (status.status === 'signed-in' ? status.models : [])
  /**
   * One clock reading for the whole model list.
   *
   * Promotion badges are judged against it (see `promoBadge`): reading the clock
   * once per render keeps every row's verdict consistent with the others, and
   * because the card re-renders on its poll, a badge still appears and vanishes
   * with its window instead of sticking until the next manual refresh.
   */
  const nowForPromo = new Date()
  const savedEnabledIds = status.status === 'signed-in' ? new Set(status.enabledModelIds) : new Set<string>()
  const activeEnabledIds = draft?.enabledIds ?? savedEnabledIds
  const activeImageIds = draft?.imageIds ?? savedImageIds
  /**
   * Effective image capability of one row, mirroring what the Host reports to
   * DSH: the user's opt-in unioned with Trae's own `multimodal` flag (issue
   * #16). Rendering the union is what keeps this checkbox truthful — showing the
   * raw `imageModelIds` would draw an unticked box next to a model the plugin
   * is in fact advertising as image-capable.
   */
  const rowAcceptsImage = (model: TraeWebModel): boolean =>
    activeImageIds.has(model.id) || model.multimodal === true
  /**
   * A row Trae itself declares multimodal needs no manual opt-in, so its box is
   * shown ticked and read-only rather than offering a toggle that the union
   * would immediately undo. Turning image input off for such a model is
   * deliberately not supported: the flag is the vendor's own capability answer,
   * and enabling it only lets DSH attach an image the user still has to pick per
   * message — it never sends one by itself.
   */
  const rowImageIsAutomatic = (model: TraeWebModel): boolean => model.multimodal === true
  /**
   * The international tab's plan is rendered by `rowValue`, in the account
   * table's 额度 column — one place, per account, beside the account it belongs
   * to.
   *
   * There used to be a SECOND surface for it: a standalone 「订阅状态」 box below
   * the table, reporting the bound account's plan on its own. It was added to
   * fix 「国际版没有那个积分框」 — an asymmetry against the CN tab's credit panel
   * — but the table's 额度 column had since absorbed exactly that figure, so the
   * box repeated the row directly above it. Two renderers of one verdict is the
   * drift risk `plan-text.ts` exists to prevent, and the box could only ever
   * restate what the marked 「当前使用」 row already said. It is gone; the row is
   * the single surface.
   */
  const activeContextBudgets = draft?.contextBudgets ?? savedContextBudgets
  const dirty = draft !== undefined

  /** Apply an edit to the ACTIVE tab's draft, seeding it from the current view. */
  const editDraft = (edit: (current: TraeDraft) => TraeDraft): void => {
    setDrafts(prev => ({
      ...prev,
      [activeRegion]: edit(prev[activeRegion] ?? {
        models: [...visibleModels],
        enabledIds: new Set(activeEnabledIds),
        imageIds: new Set(activeImageIds),
        contextBudgets: { ...activeContextBudgets },
      }),
    }))
  }

  const toggleModel = (modelId: string): void => {
    editDraft(current => {
      const next = new Set(current.enabledIds)
      if (!next.delete(modelId)) next.add(modelId)
      return { ...current, enabledIds: next }
    })
  }

  const toggleImage = (modelId: string): void => {
    editDraft(current => {
      const next = new Set(current.imageIds)
      if (!next.delete(modelId)) next.add(modelId)
      return { ...current, imageIds: next }
    })
  }

  const setContextBudget = (modelId: string, budget: number | undefined): void => {
    editDraft(current => {
      const next = { ...current.contextBudgets }
      if (budget === undefined) delete next[modelId]
      else next[modelId] = budget
      return { ...current, contextBudgets: next }
    })
  }

  /**
   * Bulk context-budget switch (issue #42 side request). The per-model radios
   * stay exactly as they are; these two act on the whole region draft at once.
   * The reporter counted 18 CN models whose Max window differs from the
   * default and described clicking 18 times per region — 「整区切到 Max」 is
   * those 18 clicks as one button. It writes `maxContextWindow` per row, which
   * is precisely the spelling `applyContextBudgets` recognizes (a budget equal
   * to the native Max window widens the effective window), so bulk and per-row
   * paths land on identical saved state. Models without a Max window are left
   * untouched — inventing a budget for them would be filtered out anyway.
   */
  const setAllContextMax = (): void => {
    editDraft(current => {
      const next = { ...current.contextBudgets }
      for (const model of current.models) {
        if (model.maxContextWindow !== undefined) next[model.id] = model.maxContextWindow
      }
      return { ...current, contextBudgets: next }
    })
  }

  /**
   * 「恢复默认上下文」 clears every override in this region's draft. Empty
   * dict = every row falls back to its default window (the same state as a
   * region that was never configured), and clearing is what makes the bulk
   * action reversible without 18 more clicks.
   */
  const resetAllContextBudgets = (): void => {
    editDraft(current => ({ ...current, contextBudgets: {} }))
  }

  const discardModels = (): void => {
    setDrafts(prev => {
      const next = { ...prev }
      delete next[activeRegion]
      return next
    })
  }

  const saveModels = async (): Promise<void> => {
    if (settingsScope === undefined) return
    setSaving(true)
    setWriteError(undefined)
    try {
      // Save this region's raw directory plus the pure selection. The Host
      // derives the runtime catalog from these on save/restart, so re-opening
      // the card re-reads Trae's current catalog instead of a stale snapshot.
      // The CN and international apps expose different rosters, so the write
      // targets the slot keyed by the active tab's region: the other region's
      // picks are never touched.
      if (status.status !== 'signed-in') return
      // Carry the region's on/off flag through: this write replaces the whole
      // slot, and dropping `enabled` would silently re-enable a provider the
      // user switched off just by saving its model list.
      // `input` is re-derived by the Host from the user's opt-ins plus Trae's
      // own multimodal flag, so it is persisted as text-only here to avoid
      // freezing a decision the Host owns. `multimodal` must be carried through
      // verbatim: it IS that upstream fact, and dropping it would switch auto
      // image input off for every model the moment the user saved (issue #16).
      const nextSlot = {
        enabled: regionOn(activeRegion),
        lastCatalog: visibleModels.map(model => ({
          ...model,
          input: ['text'],
          ...model.multimodal === undefined ? {} : { multimodal: model.multimodal },
        })),
        enabledModelIds: [...activeEnabledIds],
        imageModelIds: [...activeImageIds].filter(id => activeEnabledIds.has(id)),
        contextBudgets: activeContextBudgets,
      }
      await writeSettingsField(settingsScope, 'regions',
        nextRegionSlots(configuredRegions, activeRegion, nextSlot),
        readBack => {
          // A shallow "is anything there?" check would pass a truncated write;
          // compare the selection that was actually saved.
          const slot = regionSlotsOf(readBack)[activeRegion] as { enabledModelIds?: unknown } | undefined
          const ids = slot?.enabledModelIds
          return Array.isArray(ids) && ids.length === nextSlot.enabledModelIds.length
            && nextSlot.enabledModelIds.every(id => (ids as unknown[]).includes(id))
        })
      discardModels()
      await refreshUsage(activeRegion)
    } catch (error: unknown) {
      if (mounted.current) setWriteError(error instanceof Error ? error.message : t('row.requestFailed'))
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const title = t('row.title')
  /**
   * Row labels for the account table.
   *
   * The raw `edition` token ("solo") told the user nothing about WHICH product a
   * credential came from, which is exactly what made a leftover TRAE SOLO login
   * indistinguishable from the Trae CN one they thought they were bound to
   * (issue #25). Spell the product out, and keep the region as the second axis.
   */
  const editionLabel = (edition: TraeWebAccount['edition']): string =>
    t(`row.edition${edition === 'cn' ? 'Cn' : edition === 'sg' ? 'Sg' : edition === 'solo' ? 'Solo' : 'SoloSg'}`)
  const sourceLabel = (source: TraeWebAccount['source']): string =>
    source === 'desktop' ? t('row.sourceDesktop') : source === 'cli' ? t('row.sourceCli') : t('row.sourceDsh')
  /**
   * The trailing value on an account row's meta line: the account's general
   * balance (CN) or its subscription verdict (ai).
   *
   * A status that has not loaded — or whose read failed — renders NOTHING
   * rather than a dash. The row already names the account, its edition and its
   * source; a column of placeholder glyphs was pure noise, and it made every
   * row look like something was wrong. `undefined` means "no figure", never
   * "zero".
   */
  const rowValue = (state: TraeWebAccountState | undefined): ReactNode => {
    // Judged by CREDENTIAL REGION: the enterprise panel is a CN pool, so it
    // reads CN balances and check-ins like the domestic tab does.
    if (credentialRegionIsAi) {
      const payStatus = state?.payStatus
      if (payStatus === undefined) return undefined
      const verdict = payVerdict(payStatus)
      if (!verdict.paid) return <span className="dsm-trae-account-value">{t('row.noPackage')}</span>
      return (
        <span className="dsm-trae-account-value dsm-trae-account-value-on">
          {verdict.tier === undefined ? t('row.subscribed') : t('row.planTier', { tier: verdict.tier })}
        </span>
      )
    }
    // The enterprise panel reports no figure by design: tenant spend is not
    // exposed by any endpoint the plugin can reach. Rendering the consumer
    // packs here would put a PERSONAL balance under an enterprise heading.
    if (activeRegion === 'enterprise') {
      return <span className="dsm-trae-account-value dsm-trae-account-value-muted">{t('row.balanceConsoleOnly')}</span>
    }
    const figure = state?.credits?.generalAvailable
    if (figure === undefined) return undefined
    return <span className="dsm-trae-account-value">{t('row.accountBalance', { credits: formatNumber(figure) })}</span>
  }

  /**
   * The CN check-in control for one account row.
   *
   * The reward rides INSIDE the button ("签到 +150") instead of sitting beside
   * it as a second line, so the row says what the click pays without also
   * carrying a "150 credits per day" caption. Four states, none of which lies:
   *
   *  - claimable — live, and names the payout.
   *  - claiming — this row's own claim is in flight; only its button changes.
   *  - claimed — `checkedIn`: this ACCOUNT was paid, so it reads as done.
   *  - device spent — `didCheckedIn` (or a 9095 refusal from this row's click):
   *    the DEVICE is spent but this account was never rewarded, so the button
   *    says exactly that and stays disabled rather than reporting "done" for an
   *    account that got nothing. The full rule lives in `title` — rendered as a
   *    paragraph it dominated the row and drowned out the account itself.
   *
   * Until the row's status lands the button waits, disabled, so the row keeps
   * its shape instead of reflowing the moment the read returns.
   */
  /**
   * Everything a check-in button needs, derived once. The pool's table replaces
   * this card's roster table, so the same derivation has to feed both: two
   * copies would drift the moment one of them learned about a new refusal.
   */
  /**
   * Whether THIS machine has already been paid today, for any account.
   *
   * `didCheckedIn` is not an account fact. Trae keys the daily claim to
   * `x-device-id` and answers a second claim with 9095, so once one account has
   * claimed from this machine, every other account on it is refused for the
   * rest of the day. Keeping that flag per account made the card invite a
   * check-in that could only fail — visible as soon as two accounts sit next to
   * each other in one table.
   */
  const deviceClaimedToday = (() => {
    for (const state of Object.values(accountStatusByRegion[activeRegion])) {
      if (state?.checkin?.didCheckedIn === true) return true
    }
    for (const spent of Object.values(deviceSpentByRegion[activeRegion])) {
      if (spent) return true
    }
    return status.status === 'signed-in' && status.pool !== undefined
      && status.pool.accounts.some(account => account.deviceCheckedIn === true)
  })()

  const claimViewOf = (accountId: string, state: TraeWebAccountState | undefined): { label: string; title: string; disabled: boolean; busy: boolean; claimable: boolean; settled: 'claimed' | 'device' | undefined } => {
    const checkin = state?.checkin
    const reward = checkin === undefined ? undefined : formatNumber(checkin.credits)
    const claimed = checkin?.checkedIn === true
    const deviceSpent = deviceClaimedToday
    const spending = claimingFor === accountId
    const usable = checkin !== undefined && checkin.enabled
    const title = reward === undefined || !usable
      ? t('row.checkinDisabled')
      : deviceSpent && !claimed
        ? t('row.checkinDeviceSpent')
        : claimed
          ? t('row.checkinClaimed')
          : t('row.checkinReward', { reward })
    return {
      label: spending
        ? t('row.checkinClaiming')
        : claimed
          ? t('row.checkinClaimed')
          : deviceSpent
            ? t('row.checkinDeviceSpentShort')
            : /* An account with no usable activity (or one still loading)
                 shows the bare label: "+0" on a dead button reads as a bug. */
              !usable || reward === undefined
              ? t('row.checkinClaim')
              : t('row.checkinClaimWith', { reward }),
      title,
      disabled: !usable || claimed || deviceSpent || spending,
      busy: spending,
      /**
       * False when there is nothing left to DO: a disabled "already claimed"
       * button restates the status line above it, in grey, forever. Callers
       * drop the control instead of buying it a permanent disabled state.
       */
      claimable: !claimed && !deviceSpent,
      settled: claimed ? 'claimed' : deviceSpent ? 'device' : undefined,
    }
  }
  const checkinControl = (account: TraeWebAccount, state: TraeWebAccountState | undefined): ReactNode => {
    const view = claimViewOf(account.id, state)
    // Nothing left to do: a disabled "已领取" button is a control that can never
    // fire again. Say what happened in the cell instead.
    if (!view.claimable) {
      return (
        <span className="dsm-trae-account-checkin-state">
          {view.settled === 'claimed' ? t('row.poolCheckedIn') : t('row.poolDeviceUsed')}
        </span>
      )
    }
    return (
      <button
        type="button"
        className="dsm-trae-account-checkin"
        disabled={view.disabled}
        title={view.title}
        onClick={() => { void claimFor(account.id) }}
      >
        {view.label}
      </button>
    )
  }
  // `loading` outranks the document's own status: before anything has answered,
  // the only true word is "loading" (issue #77 — a signed-out label over a slow
  // fetch is a claim about a user who may well be signed in).
  const label = loading
    ? t('row.accountsLoading')
    : status.status === 'signed-in'
      ? t('row.signedIn', { accountName: status.accountName })
      : status.status === 'error'
        ? t('row.requestFailed')
        : t('row.signedOut')

  return (
    <li className={`dsm-plugin-card${open ? ' dsm-plugin-card-open' : ''}`}>
      <button
        type="button"
        className="dsm-plugin-card-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'row.collapse' : 'row.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <img className="dsm-plugin-card-icon" src={TRAE_PLUGIN_ICON} alt="" />
        <span className="dsm-plugin-card-head">
          <span className="dsm-plugin-card-title">{title}</span>
          <span className="dsm-plugin-card-description">{t('row.desc')}</span>
        </span>
        <span
          aria-hidden="true"
          className={`dsm-plugin-card-chevron${open ? ' dsm-plugin-card-chevron-open' : ''}`}
        />
      </button>
      <div className="dsm-plugin-card-body" hidden={!open}>
        {open
          ? <div className="dsm-trae-usage">
              <div className="dsm-trae-tabs" role="tablist" aria-label={title}>
                {TRAE_PANELS.map(item => {
                  const regionStatus = statusByRegion[item]
                  const on = regionOn(item)
                  return (
                    // The switch lives beside the tab, never inside it: a
                    // checkbox nested in a <button role="tab"> is invalid HTML
                    // and its click would be swallowed by the tab handler
                    // (switching tabs instead of toggling the provider). The
                    // presentational wrapper keeps the tablist/tab relationship
                    // intact for assistive technology.
                    <div className="dsm-trae-tab-cell" role="presentation" key={item}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={item === activeRegion}
                        className={`dsm-trae-tab${item === activeRegion ? ' dsm-trae-tab-active' : ''}${on ? '' : ' dsm-trae-tab-off'}`}
                        onClick={() => { setActiveRegion(item) }}
                      >
                        {regionStatus === undefined
                          ? null
                          : <span aria-hidden="true" className="dsm-trae-tab-dot" style={dotStyle(regionStatus.status)} />}
                        {item === 'cn' ? t('row.tabCn') : item === 'enterprise' ? t('row.tabEnterprise') : t('row.tabAi')}
                      </button>
                      {/* Same knob as the settings switches: a raw accent
                          checkbox next to a styled toggle read as two different
                          products in one card. */}
                      <label className="dsm-trae-switch dsm-trae-tab-switch" title={t('row.tabSwitchHint')}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={settingsScope?.getSnapshot().writable !== true || togglingRegion !== undefined}
                          aria-label={t('row.tabSwitchAria', { region: item === 'cn' ? t('row.tabCn') : item === 'enterprise' ? t('row.tabEnterprise') : t('row.tabAi') })}
                          onChange={event => { void toggleRegion(item, event.currentTarget.checked) }}
                        />
                      </label>
                    </div>
                  )
                })}
              </div>
              <p className="dsm-trae-tab-hint">{t('row.tabHint')}</p>
              {writeError === undefined
                ? null
                : <p className="dsm-trae-usage-error" role="alert">{t('row.settingsWriteFailed', { message: writeError })}</p>}
              {regionOn(activeRegion)
                ? null
                : <p className="dsm-trae-tab-off-notice" role="status">{t('row.tabOffNotice')}</p>}
              {/* The preference switch, as a BARE LINE — no bordered box, no
                  heading, no 「保存」/「放弃」 footer.
                  
                  That is the sibling dsh-connect-workbuddy card's shape, and the
                  reason it is the better one here: a card that asks the user to
                  press Save for a boolean is asking them to remember something
                  with no reason to need remembering. The box now writes on its
                  own click (see `writePreference`), exactly like the region
                  on/off boxes in the tab bar above it — so the whole card has
                  ONE commit model instead of two.
                  
                  The label IS the checkbox's own <label>, so the text is a
                  larger click target and the accessible name needs no ARIA.
                  
                  `showPointsInMainUi` describes a CN BALANCE readout. The
                  international tab's readout is its plan, which the account row
                  below already names — so the switch is carried in BOTH regions
                  instead of hidden on the international one, where turning it on
                  is what makes that readout appear at all (see the
                  `activeRegion !== 'cn'` guard that used to drop it). */}
              <div className="dsm-trae-prefs">
                {/* REGION-AGNOSTIC, both tabs: a readout exists on either side
                    (CN credits, international plan), so the switch that turns it
                    on belongs on either side. The hint below names whichever
                    figure THIS tab's readout would show, so the same box answers
                    "what do I get if I tick this?" without the reader having to
                    switch tabs to find out. */}
                <label className="dsm-trae-pref" title={t(isCnPool ? 'row.showPointsInMainUiHint' : 'row.showPointsInMainUiHintAi')}>
                  <input
                    type="checkbox"
                    className="dsm-trae-pref-check"
                    checked={settingsEdits.showPointsInMainUi}
                    disabled={settingsScope?.getSnapshot().writable !== true || savingSettings}
                    aria-describedby={creditsHintId}
                    onChange={event => { void writePreference('showPointsInMainUi', event.currentTarget.checked) }}
                  />
                  <span className="dsm-trae-pref-copy">
                    <span className="dsm-trae-pref-label" id={creditsLabelId}>{t('row.showPointsInMainUi')}</span>
                    <span className="dsm-trae-pref-hint" id={creditsHintId}>
                      {t(isCnPool ? 'row.showPointsInMainUiHint' : 'row.showPointsInMainUiHintAi')}
                    </span>
                  </span>
                </label>
                {/* WHERE that readout sits (learned from workbuddy #62). It sits
                    directly beside the show/hide box because the two answer one
                    question together ("show it, and where"), and because a user
                    only reaches for this when the default seat is unavailable —
                    typically after installing another plugin that occupies the
                    composer row. A region that is switched off gets a disabled
                    control rather than none: it still has no readout to place,
                    but the control's ABSENCE would look like the feature went
                    away. The value comes from the committed settings document,
                    the same source the readout's own gate reads (see
                    `creditPositionOn`). */}
                <label className="dsm-trae-pref dsm-trae-credit-position-pref" title={t('row.creditPositionHint')}>
                  <span className="dsm-trae-pref-copy">
                    <span className="dsm-trae-pref-lead">
                      <span className="dsm-trae-pref-label">{t('row.creditPositionLabel')}</span>
                      <select
                        className="dsm-trae-credit-position"
                        value={activeRegionOn ? creditPositionOn(activeRegion) : 'composer'}
                        disabled={!activeRegionOn || settingsScope?.getSnapshot().writable !== true || savingSettings}
                        aria-label={t('row.creditPositionAria', { region: activeRegion === 'cn' ? t('row.tabCn') : activeRegion === 'enterprise' ? t('row.tabEnterprise') : t('row.tabAi') })}
                        onChange={event => {
                          void changeCreditPosition(activeRegion, event.currentTarget.value === 'stats' ? 'stats' : 'composer')
                        }}
                      >
                        <option value="composer">{t('row.creditPositionComposer')}</option>
                        <option value="stats">{t('row.creditPositionStats')}</option>
                      </select>
                    </span>
                    <span className="dsm-trae-pref-hint">{t('row.creditPositionHint')}</span>
                  </span>
                </label>
              </div>
              {/* The account table: one row per locally detected sign-in, with
                  the action that matters on a multi-account machine — bind this
                  one — at its end. The switch is per ACCOUNT and never a sweep:
                  Trae spends one check-in per DEVICE per day, so there is
                  deliberately no "for every account" control anywhere in this
                  block (the check-in button below stays a single-account click). */}
              {/* ONE account table, not two. Once the pool document exists the
                  pool's member table below lists the same accounts with the same
                  credits and the same check-in state, so this roster would be a
                  verbatim second copy of it — the row names, balances and check-in
                  words all appeared twice on one screen. Its unique controls
                  (rescan, import/export, the manual binding) move into the pool
                  block's settings, which is also where the WorkBuddy card keeps
                  them. */}
              {status.status === 'signed-in' && status.pool !== undefined
                ? null
                : <section className="dsm-trae-accounts" aria-label={t('row.accountsTitle')}>
                <div className="dsm-trae-accounts-head">
                  <div>
                    <h3 className="dsm-trae-accounts-title">{t('row.accountsTitle')}</h3>
                    <p className="dsm-trae-accounts-hint">{t('row.accountsHint')}</p>
                  </div>
                  <button
                    type="button"
                    className="dsm-btn dsm-btn-outline"
                    disabled={busy}
                    onClick={() => { void rescanAccounts() }}
                  >
                    {busy ? t('row.accountsScanning') : t('row.refreshTokens')}
                  </button>
                </div>
                {/* A signed-out panel still lists what the Host FOUND, and the
                    reason it refuses to use it. Dropping the table in this
                    state is what made a dead binding a dead end: the Host
                    returns the roster alongside the reason, and the card used
                    to throw the roster away — so "the bound account's token
                    cannot be refreshed" arrived with no rows to act on, and
                    the only way out was editing the settings file by hand.
                    The status line stays (it carries the reason), the rows now
                    stay with it, so a dead account is followed by the one
                    press that fixes it. */}
                {status.status !== 'signed-in' || status.accounts.length === 0
                  ? <div className="dsm-trae-usage-account" role="status">
                      <div className="dsm-trae-usage-account-copy">
                        <div className="dsm-trae-usage-status">
                          <span aria-hidden="true" className="dsm-trae-usage-dot" style={dotStyle(status.status)} />
                          <span>{label}</span>
                        </div>
                        {status.status === 'signed-in'
                          ? <span className="dsm-trae-usage-expiry">
                              {t('row.tokenExpiry', { expiresAt: formatDateTime(status.tokenExpiresAtMs) })}
                            </span>
                          : null}
                      </div>
                    </div>
                  : null}
                {status.status !== 'error' && status.accounts.length > 0
                  ? <div className={`dsm-trae-account-table${isCnPool ? ' dsm-trae-account-table-checkin' : ''}`}>
                      {/* Column header, as the sibling WorkBuddy card has one:
                          four values line up in four fixed tracks, so the eye
                          reads DOWN a column instead of re-finding the field on
                          every row. Widths are fractions of the container, not
                          content — that is what stops the "columns drift with
                          the text" problem the previous table had. */}
                      <div className="dsm-trae-account-row dsm-trae-account-row-head" role="row">
                        <span>{t('row.accountColumnAccount')}</span>
                        <span>{t('row.accountColumnValue')}</span>
                        {isCnPool ? <span>{t('row.accountColumnCheckin')}</span> : null}
                        {/* The actions column carries no header: the buttons
                            speak for themselves, and a label here would just be
                            the word "操作" above two words. */}
                        <span />
                      </div>
                      {status.accounts.map(account => {
                        {/* `accountId` exists only on the signed-in variant.
                            A signed-out panel still knows which account the
                            binding points AT (the roster's own `selected`
                            flag), and naming that row is the difference
                            between "this panel is broken" and "THAT binding is
                            the broken one, switch to another row". */}
                        const current = status.status === 'signed-in'
                          ? account.id === status.accountId
                          : account.selected === true
                        const state = accountStatusByRegion[activeRegion][account.id]
                        const error = claimErrorByRegion[activeRegion][account.id]
                        return (
                          /* One grid row per account: identity, worth, the day's
                             check-in, then the actions. The serving row is marked
                             by a LEFT ACCENT BAR plus the tint — a 7%-opacity
                             wash alone reads as a zebra stripe in a long table,
                             which is exactly what the WorkBuddy card below does
                             and why. */
                          <div
                            key={account.id}
                            className={`dsm-trae-account-row${current ? ' dsm-trae-account-row-current' : ''}`}
                            role="row"
                          >
                            <span className="dsm-trae-account-who">
                              <span aria-hidden="true" className="dsm-trae-usage-dot" style={dotStyle(account.selected ? 'signed-in' : 'signed-out')} />
                              <span className="dsm-trae-account-name">
                                <b>{account.accountName}</b>
                                {/* Which account is serving, in WORDS. The tint
                                    alone answers nothing when the question IS
                                    "which one is it?". */}
                                {current ? <span className="dsm-trae-account-badge">{t('row.accountCurrentBadge')}</span> : null}
                                {/* edition · source. The region is NOT repeated:
                                    the edition already names which app the
                                    credential came from (issue #25), and
                                    "国内版 · 国内 · 桌面端" said it twice. */}
                                <span className="dsm-trae-account-meta">
                                  {editionLabel(account.edition)}
                                  <i aria-hidden="true">·</i>
                                  {sourceLabel(account.source)}
                                </span>
                                {/* The countdown that actually ends automatic
                                    renewal. Per ACCOUNT, because the expiry is
                                    a property of each credential (a CLI token
                                    carries none at all), and rendered only when
                                    it is close or already past — a healthy
                                    token must not add a permanent line to every
                                    row (issue #37 follow-up). */}
                                {(() => {
                                  const warning = refreshTokenWarning(account.refreshExpiresAtMs, Date.now(), t, formatDateTime)
                                  return warning === undefined
                                    ? null
                                    : <span className={`dsm-trae-refresh-warn dsm-trae-refresh-warn-${warning.tone}`} role="status">
                                        {warning.text}
                                      </span>
                                })()}
                                {error === undefined
                                  ? null
                                  : <span className="dsm-trae-account-note" role="alert">{t('row.checkinError', { message: error })}</span>}
                              </span>
                            </span>
                            {/* The worth column, its own track at tabular-nums
                                so digits in different rows sit on the same
                                column of the grid. */}
                            <span className="dsm-trae-account-worth">{rowValue(state)}</span>
                            {isCnPool
                              ? <span className="dsm-trae-account-checkin-cell">{checkinControl(account, state)}</span>
                              : null}
                            <span className="dsm-trae-account-actions">
                              {/* The bound row offers no switch: it is already
                                  the one in use, and a disabled copy of the
                                  badge beside the badge said nothing. */}
                              {current
                                ? null
                                : <button
                                    type="button"
                                    className="dsm-btn dsm-btn-outline dsm-trae-account-switch"
                                    disabled={switchingAccount || settingsScope?.getSnapshot()?.writable !== true}
                                    onClick={() => { void switchAccount(account.id) }}
                                  >
                                    {switchingAccount ? t('row.accountSwitching') : t('row.accountSwitch')}
                                  </button>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  : null}
                {/* The enterprise tab has no balance by design: nothing the
                    plugin can reach reports tenant spend, so the figure lives
                    only in the enterprise console. Said plainly instead of
                    leaving an empty area the user would read as a failure. */}
                {/*
                  Import / export (issue #37). Rendered on BOTH sign-in states,
                  and outside the `signed-in` branch above on purpose: a machine
                  that has never signed in is exactly where importing a file
                  exported elsewhere matters most, and the export button simply
                  stays disabled while there is nothing to select.
                */}
                <AccountTransfer
                  t={t}
                  // Import/export moves CREDENTIALS, which belong to a region,
                  // not a billing pool: the enterprise tab shares the cn store.
                  region={activeRegion === 'ai' ? 'ai' : 'cn'}
                  accounts={status.status === 'signed-in'
                    ? status.accounts.map(account => ({ id: account.id, accountName: account.accountName }))
                    : []}
                  onChanged={async () => {
                    // Re-read this region's snapshot so an imported account
                    // appears without the user closing and reopening settings.
                    // `refreshUsage` is the same read the card's normal poll
                    // uses, and it also returns the fresh accounts list.
                    const fresh = await refreshUsage(activeRegion)
                    if (fresh !== undefined) setStatusByRegion(current => ({ ...current, [activeRegion]: fresh }))
                  }}
                />
              </section>}
              {status.status === 'signed-in' && status.creditsUnavailable === 'enterprise'
                ? <p className="dsm-trae-credits-unavailable" role="note">{t('row.enterpriseCreditsNotice')}</p>
                : null}
              {status.status === 'signed-in' && status.alternatives !== undefined && status.alternatives.length > 0
                ? <div className="dsm-trae-usage-alternative" role="status">
                  <p className="dsm-trae-usage-alternative-text">
                    {t('row.creditsExhausted', { account: status.accountName })}
                    {' '}
                    {t('row.creditsAlternative', {
                      accounts: status.alternatives
                        .map(alt => `${alt.accountName}（${t(`row.edition${alt.edition === 'cn' ? 'Cn' : alt.edition === 'sg' ? 'Sg' : alt.edition === 'solo' ? 'Solo' : 'SoloSg'}`)}：${formatNumber(alt.workAvailable + alt.generalAvailable)}）`)
                        .join('、'),
                    })}
                  </p>
                  <button
                    type="button"
                    className="dsm-trae-usage-switch-button"
                    disabled={switchingAccount || settingsScope?.getSnapshot()?.writable !== true}
                    onClick={() => {
                      const target = status.alternatives?.[0]
                      if (target !== undefined) void switchAccount(target.id)
                    }}
                  >
                    {t('row.creditsAlternativeSwitch')}
                  </button>
                </div>
                : null}
              {/* Credit about to lapse. Sits in the usage tab, right after the
                  exhausted/alternative rows, because it answers the same
                  question those do — "is there anything I should do about my
                  balance?" — and unlike them it is actionable while the account
                  still works. */}
              {status.status === 'signed-in' && status.credits?.expiry !== undefined
                ? <ExpiryNotice
                    expiry={status.credits.expiry}
                    t={t}
                    formatNumber={formatNumber}
                    formatDateTime={formatDateTime}
                  />
                : null}
              {rescanNote === undefined ? null : <p className="dsm-trae-usage-note" role="status">{rescanNote}</p>}
              {status.status === 'signed-in'
                ? <>
                    {status.pool !== undefined
                      ? <AccountPool
                          panel={activeRegion}
                          pool={status.pool}
                          models={visibleModels}
                          t={t}
                          settingsScope={settingsScope}
                          topActions={<button
                            type="button"
                            className="dsm-btn dsm-btn-outline"
                            disabled={busy}
                            onClick={() => { void rescanAccounts() }}
                          >
                            {busy ? t('row.accountsScanning') : t('row.poolRescan')}
                          </button>}
                          tools={<div className="dsm-trae-pool-tool-row">
                            <span className="dsm-trae-pool-tool-label">{t('row.poolToolsLabel')}</span>
                            <AccountTransfer
                              t={t}
                              // The row already carries its own label; the
                              // section's heading would be a second one.
                              hideLabel
                              region={activeRegion === 'ai' ? 'ai' : 'cn'}
                              accounts={status.accounts.map(account => ({ id: account.id, accountName: account.accountName }))}
                              onChanged={async () => {
                                const fresh = await refreshUsage(activeRegion)
                                if (fresh !== undefined) setStatusByRegion(current => ({ ...current, [activeRegion]: fresh }))
                              }}
                            />
                          </div>}
                          details={Object.fromEntries(status.accounts.map(account => {
                            const warn = refreshTokenWarning(account.refreshExpiresAtMs, Date.now(), t, formatDateTime)
                            return [account.id, {
                              meta: `${editionLabel(account.edition)} · ${sourceLabel(account.source)}`,
                              ...warn === undefined ? {} : { warn: warn.text, warnTone: warn.tone },
                            }]
                          }))}
                          claims={status.pool.checkinSupported === true
                            ? Object.fromEntries(status.accounts.map(account =>
                                [account.id, claimViewOf(account.id, accountStatusByRegion[activeRegion][account.id])]))
                            : undefined}
                          onClaim={(accountId) => { void claimFor(accountId) }}
                          deviceClaimed={deviceClaimedToday}
                          onBind={(accountId) => { void switchAccount(accountId) }}
                          bindingBusy={switchingAccount}
                          onChanged={async () => {
                            const fresh = await refreshUsage(activeRegion)
                            if (fresh !== undefined) setStatusByRegion(current => ({ ...current, [activeRegion]: fresh }))
                          }}
                          onRefresh={async () => {
                            const fresh = await refreshUsage(activeRegion)
                            if (fresh !== undefined) setStatusByRegion(current => ({ ...current, [activeRegion]: fresh }))
                          }}
                        />
                      : null}
                    {status.checkin !== undefined && !status.checkin.enabled
                      ? <p className="dsm-trae-usage-error">{t('row.checkinDisabled')}</p>
                      : null}
                    {status.checkinError === undefined
                      ? null
                      : <p className="dsm-trae-usage-error">{t('row.checkinError', { message: status.checkinError })}</p>}
                    <section className="dsm-trae-models" aria-label={t('row.modelsTitle')}>
                      <div className="dsm-trae-models-head">
                        <div>
                          <h3 className="dsm-trae-models-title">{t('row.modelsTitle')}</h3>
                          <p className="dsm-trae-models-summary">{t('row.modelsSummary', { count: activeEnabledIds.size })}</p>
                        </div>
                        <div className="dsm-trae-models-actions">
                          <button
                            type="button"
                            className="dsm-btn dsm-btn-outline"
                            disabled={busy}
                            onClick={() => { void refreshModels() }}
                          >
                            {busy ? t('row.modelsRefreshing') : t('row.modelsRefresh')}
                          </button>
                          <button
                            type="button"
                            className="dsm-btn dsm-btn-outline"
                            disabled={busy || testing !== undefined || activeEnabledIds.size === 0}
                            title={t('row.modelsTestHint')}
                            onClick={() => { void testEnabledModels() }}
                          >
                            {testing === undefined
                              ? t('row.modelsTestEnabled')
                              : t('row.modelsTesting', { done: testing.done, total: testing.total })}
                          </button>
                          <button
                            type="button"
                            className="dsm-btn dsm-btn-outline"
                            disabled={busy || testing !== undefined || visibleModels.length === 0}
                            title={t('row.modelsTestAllHint')}
                            onClick={() => { void testAllModels() }}
                          >
                            {testing === undefined
                              ? t('row.modelsTestAll')
                              : t('row.modelsTesting', { done: testing.done, total: testing.total })}
                          </button>
                        </div>
                      </div>
                      {/* ONE line of explanation for both buttons. The second
                          paragraph here said the same thing a different way
                          and only pushed the model list further down. */}
                      <p className="dsm-trae-models-hint">{t('row.modelsTestHint')}</p>
                      {testSummary === undefined ? null : <p className="dsm-trae-models-summary">{testSummary}</p>}
                      {testError === undefined ? null : <p className="dsm-trae-usage-error" role="alert">{testError}</p>}
                      <div className="dsm-trae-model-list">
                        {visibleModels.map(model => (
                          <div className={`dsm-trae-model${activeEnabledIds.has(model.id) ? '' : ' dsm-trae-model-disabled'}`} key={model.id}>
                            <div className="dsm-trae-model-head">
                              <label className="dsm-trae-model-enabled">
                                <input
                                  type="checkbox"
                                  checked={activeEnabledIds.has(model.id)}
                                  disabled={settingsScope?.getSnapshot().writable !== true || saving}
                                  onChange={() => { toggleModel(model.id) }}
                                />
                                <span className="dsm-trae-model-copy">
                                  <span className="dsm-trae-model-name">
                                    {model.name}
                                    {/* No rate on the enterprise tab: the
                                        multiplier is a CONSUMER-pool figure
                                        (personal credits per token), which the
                                        tenant pool does not bill against. A
                                        number there would be read as a price. */}
                                    {activeRegion === 'enterprise' || model.creditMultiplier === undefined ? null
                                      : <span className="dsm-trae-model-name-rate">· x{model.creditMultiplier.toFixed(2)}</span>}
                                    {probeBadge(probeByRegion[activeRegion][model.id], t)}
                                  </span>
                                  {/* Outside the name span on purpose: the
                                      name is ellipsis-truncated, so a capsule
                                      inside it would be clipped on exactly the
                                      long model names. Judged at paint time
                                      (see promoBadge). */}
                                  {promoBadge(model, t, nowForPromo)}
                                </span>
                              </label>
                              <div className="dsm-trae-model-options">
                                <label className="dsm-trae-model-image">
                                  <input
                                    type="checkbox"
                                    checked={rowAcceptsImage(model)}
                                    disabled={rowImageIsAutomatic(model) || settingsScope?.getSnapshot().writable !== true || saving}
                                    title={rowImageIsAutomatic(model) ? t('row.modelImageAuto') : undefined}
                                    onChange={() => { toggleImage(model.id) }}
                                  />
                                  <span>{t('row.modelImage')}</span>
                                </label>
                              <fieldset className="dsm-trae-context-budget" aria-label={t('row.contextBudget')}>
                                {model.maxContextWindow !== undefined
                                  ? <label>
                                      <input
                                        type="radio"
                                        name={`context-${model.id}`}
                                        checked={activeContextBudgets[model.id] !== model.maxContextWindow}
                                        disabled={settingsScope?.getSnapshot().writable !== true || saving}
                                        onChange={() => { setContextBudget(model.id, model.contextWindow) }}
                                      />
                                      <span>{formatCapacity(model.contextWindow, t('row.modelUnknown'))}</span>
                                    </label>
                                  : null}
                                <label>
                                  <input
                                    type="radio"
                                    name={`context-${model.id}`}
                                    checked={model.maxContextWindow === undefined || activeContextBudgets[model.id] === model.maxContextWindow}
                                    disabled={model.maxContextWindow === undefined || settingsScope?.getSnapshot().writable !== true || saving}
                                    onChange={() => { setContextBudget(model.id, model.maxContextWindow) }}
                                  />
                                  <span>{formatCapacity(model.maxContextWindow ?? model.contextWindow, t('row.modelUnknown'))}</span>
                                </label>
                              </fieldset>
                              </div>
                            </div>
                            <div className="dsm-trae-model-meta">
                              <span>{t('row.modelContext', { context: formatCapacity(model.maxContextWindow ?? model.contextWindow, t('row.modelUnknown')) })}</span>
                              {model.maxTokens === undefined ? null
                                : <span>{t('row.modelOutput', { output: formatCapacity(model.maxTokens, t('row.modelUnknown')) })}</span>}
                              {model.reasoning === undefined ? null
                                : <span>{t('row.modelReasoning', { efforts: model.reasoning.supported.join(' / ') })}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Bulk context switch (issue #42): sits directly under the
                          per-row budget radios it replaces a click-walk through,
                          so the affordance is next to what it acts on. */}
                      <div className="dsm-trae-context-bulk">
                        <button
                          type="button"
                          className="dsm-btn dsm-btn-outline"
                          disabled={busy || saving || settingsScope?.getSnapshot().writable !== true || !visibleModels.some(model => model.maxContextWindow !== undefined)}
                          title={t('row.contextAllMaxHint')}
                          onClick={setAllContextMax}
                        >
                          {t('row.contextAllMax')}
                        </button>
                        <button
                          type="button"
                          className="dsm-btn dsm-btn-outline"
                          disabled={busy || saving || settingsScope?.getSnapshot().writable !== true || Object.keys(activeContextBudgets).length === 0}
                          title={t('row.contextAllDefaultHint')}
                          onClick={resetAllContextBudgets}
                        >
                          {t('row.contextAllDefault')}
                        </button>
                      </div>
                      <p className="dsm-trae-model-capability-note">{t('row.modelCapabilityPending')}</p>
                      <div className="dsm-trae-model-actions">
                        <a
                          className="dsm-trae-usage-cheer"
                          href={TRAE_GITHUB_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('row.cheer')}
                          <span className="dsm-trae-usage-cheer-star" aria-hidden="true">★</span>
                        </a>
                        <div className="dsm-trae-model-actions-buttons">
                          <button type="button" className="dsm-btn dsm-btn-outline" disabled={!dirty || saving} onClick={discardModels}>
                            {t('row.discard')}
                          </button>
                          <button type="button" className="dsm-btn dsm-btn-primary" disabled={!dirty || saving || activeEnabledIds.size === 0} onClick={() => { void saveModels() }}>
                            {saving ? t('row.saving') : t('row.save')}
                          </button>
                        </div>
                      </div>
                    </section>
                  </>
                : null}
              {status.status === 'signed-out' && loading
                ? <>
                  {/* Nothing has answered yet. Saying "not signed in" here would be a
                      claim, not a placeholder — issue #77 is exactly the case of a
                      signed-in user reading it for a minute. */}
                  <p className="dsm-trae-usage-text" role="status">{t('row.accountsLoading')}</p>
                </>
                : null}
              {status.status === 'signed-out' && !loading
                ? <>
                  <p className="dsm-trae-usage-text">{status.message ?? t('row.signedOutHint')}</p>
                  {status.searched && status.searched.length > 0
                    ? <details className="dsm-trae-searched">
                      <summary>{t('row.searchedTitle')} ({status.searched.length})</summary>
                      <p className="dsm-trae-searched-hint">{t('row.searchedHint')}</p>
                      <ul className="dsm-trae-searched-list">
                        {status.searched.map(item => (
                          <li key={`${item.source}:${item.path}`}>
                            <code>{item.path}</code>
                            <span className="dsm-trae-searched-reason">
                              {t(item.source === 'cli' ? 'row.sourceCli' : 'row.sourceDesktop')}
                              {' · '}
                              {t(item.reason === 'missing' ? 'row.reasonMissing' : item.reason === 'unreadable' ? 'row.reasonUnreadable' : 'row.reasonInvalid')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                    : null}
                </>
                : null}
              {status.status === 'error' ? <p className="dsm-trae-usage-error">{status.message}</p> : null}
            </div>
          : null}
      </div>
      <BusyOverlay
        visible={saving || savingSettings}
        message={t('row.veilSaving')}
      />
    </li>
  )
}
