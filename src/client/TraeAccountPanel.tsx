/**
 * The card's ACCOUNT section, as its own component.
 *
 * WHY THIS IS ITS OWN MODULE: the card passed 2,300 lines once the section split
 * landed, and the account section alone — the preference lines, the per-account
 * roster, the check-in column and the pool — was roughly a third of the JSX. A
 * component that size cannot be read in one sitting, and every edit risked the
 * models and diagnostics sections by touching the same file.
 *
 * The split is deliberately DUMB, in the same spirit as {@link AccountPool}:
 * every verdict this panel draws arrives pre-derived. It does not decide which
 * account is serving, which row may claim, what an account is worth, or whether
 * the readout seat is available. Those rules stay in `TraeUsageCard`, next to the
 * writes they belong to, so there is exactly one place that knows them.
 *
 * @module dsh-connect-trae/client/TraeAccountPanel
 */

import type { ReactElement, ReactNode } from 'react'
import type {
  TraeCreditPosition,
  TraePanel,
  TraeWebCreditAlternative,
  TraeWebCreditExpiry,
  TraeWebModel,
  TraeWebUsage,
} from '../status-paths.ts'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'
import { AccountPool } from './AccountPool.tsx'
import type { TraePoolRowClaim, TraePoolRowDetail } from './AccountPool.tsx'
import { AccountTransfer } from './AccountTransfer.tsx'
import { dotStyle, formatDateTime, formatNumber, refreshTokenWarning } from './display.ts'
import type { TraeSettingsKey } from './locales.ts'

/** One row of the account roster, with everything the row cannot derive itself. */
export interface TraeAccountRowView {
  id: string
  accountName: string
  /** This is the account currently serving this panel. */
  current: boolean
  /** The binding points at this row (the signed-out variant's only clue). */
  selected: boolean
  /** `edition · source`, already worded by the card. */
  meta: string
  /**
   * The worth cell: a CN balance, an international plan verdict, or the
   * enterprise "console only" note. `undefined` means "no figure" — never zero —
   * so a status that has not loaded renders nothing.
   */
  value: ReactNode
  /** Absent when the credential carries no refresh token (a CLI token does not). */
  refreshExpiresAtMs?: number | undefined
  /** Dry of the last claim attempt for this row, already worded by the card. */
  error?: string | undefined
  /**
   * The check-in control for this row. Absent on a panel that has no check-in
   * surface at all (the international one), which is why the whole cell — not
   * just the button — disappears.
   */
  claim?: TraeRowClaim | undefined
}

/** The check-in cell's state, pre-derived by the card (see its `claimViewOf`). */
export interface TraeRowClaim {
  label: string
  title: string
  disabled: boolean
  busy: boolean
  /** False once the click can do nothing more: render the outcome, not a button. */
  claimable: boolean
  settled: 'claimed' | 'device' | undefined
}

export interface TraeAccountPanelProps {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
  settingsScope?: TraeUsageCardInjected['settingsScope'] | undefined
  /** The panel (provider) this section is about. */
  panel: TraePanel
  /** The region's usage document; only its signed-in variant reaches here. */
  status: TraeWebUsage
  /** The status word the card already chose (loading / signed-in / …). */
  statusLabel: string
  /** Whether this panel's credential is an international (pay-status) one. */
  credentialRegionIsAi: boolean
  /** Whether the panel's provider is switched on at all. */
  regionOn: boolean

  /** The "show the credit readout" preference, committed plus in-flight. */
  showPointsInMainUi: boolean
  onToggleShowPoints(value: boolean): void
  /** Where the readout sits for THIS panel. */
  creditPosition: TraeCreditPosition
  onCreditPositionChange(position: TraeCreditPosition): void
  savingPreferences: boolean
  /** Ids wiring the preference label to its hint (`useId` lives in the card). */
  creditsLabelId: string
  creditsHintId: string

  /** The roster, already judged. */
  rows: readonly TraeAccountRowView[]
  busy: boolean
  rescanNote?: string | undefined
  onRescan(): void
  switchingAccount: boolean
  onSwitchAccount(accountId: string): void
  onClaim(accountId: string): void
  /** Re-read this panel after import/export wrote a credential. */
  onTransferChanged(): void | Promise<unknown>

  /** The pool document, when the Host serves one. */
  poolDetails: Record<string, TraePoolRowDetail>
  poolClaims?: Record<string, TraePoolRowClaim> | undefined
  /** Every model of this panel, for the pool's target select. */
  models: readonly TraeWebModel[]
  deviceClaimed: boolean
  onPoolChanged(): void | Promise<unknown>
  onPoolRefresh(): void | Promise<unknown>

  /** Notices that are about the ACCOUNT, so they live in this section. */
  creditsUnavailable?: 'enterprise' | undefined
  creditsExpiry?: TraeWebCreditExpiry | undefined
  alternatives?: readonly TraeWebCreditAlternative[] | undefined
  onSwitchToAlternative(accountId: string): void
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
 * expiry data is not evidence that nothing lapses, so the component stays silent
 * rather than reassuring.
 */
function ExpiryNotice({ expiry, t }: {
  expiry: TraeWebCreditExpiry
  t: TraeAccountPanelProps['t']
}): ReactNode {
  const { expired, within24h, within7d } = expiry
  let message: string | undefined
  let soonest: number | undefined
  let tone: string
  // Escalation order: a live expiry the user can still act on outranks a lapsed
  // one they cannot, even when the lapsed amount is larger.
  if (within24h.packs > 0) {
    message = t('row.expiryWarningSoon', { total: formatNumber(within24h.total), packs: String(within24h.packs) })
    soonest = within24h.earliestExpiresAtMs
    tone = 'dsm-trae-expiry-soon'
  } else if (within7d.packs > 0) {
    message = t('row.expiryWarningWeek', { total: formatNumber(within7d.total), packs: String(within7d.packs) })
    soonest = within7d.earliestExpiresAtMs
    tone = 'dsm-trae-expiry-week'
  } else if (expired.packs > 0) {
    message = t('row.expiryWarningLapsed', { total: formatNumber(expired.total), packs: String(expired.packs) })
    tone = 'dsm-trae-expiry-lapsed'
  } else {
    return null
  }
  return (
    <div className={`dsm-trae-expiry ${tone}`} role="status">
      <span>{message}</span>
      {soonest === undefined
        ? null
        : <span className="dsm-trae-expiry-detail">{t('row.expiryEarliest', { time: formatDateTime(soonest) })}</span>}
    </div>
  )
}

/** The CN check-in cell for one row: an outcome once there is nothing left to do. */
function ClaimCell({ claim, onClaim, t }: {
  claim: TraeRowClaim
  onClaim: () => void
  t: TraeAccountPanelProps['t']
}): ReactElement {
  // Nothing left to do: a disabled "already claimed" button restates the status
  // line above it, in grey, forever. Say what happened in the cell instead.
  if (!claim.claimable) {
    return (
      <span className="dsm-trae-account-checkin-state">
        {claim.settled === 'claimed' ? t('row.poolCheckedIn') : t('row.poolDeviceUsed')}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="dsm-trae-account-checkin"
      disabled={claim.disabled}
      title={claim.title}
      onClick={onClaim}
    >
      {claim.label}
    </button>
  )
}

/**
 * The account section: preferences, the roster, the pool, and every notice about
 * the credential.
 *
 * Everything here commits ON THE CLICK (the preference boxes write themselves,
 * the check-in claims immediately, the pool saves through its own footer). That
 * is precisely why this section has no 「保存」 of its own — the model catalog,
 * which does, lives in its own section.
 */
export function TraeAccountPanel({
  t, settingsScope, panel, status, statusLabel, credentialRegionIsAi, regionOn,
  showPointsInMainUi, onToggleShowPoints, creditPosition, onCreditPositionChange,
  savingPreferences, creditsLabelId, creditsHintId,
  rows, busy, rescanNote, onRescan, switchingAccount, onSwitchAccount, onClaim, onTransferChanged,
  poolDetails, poolClaims, models, deviceClaimed, onPoolChanged, onPoolRefresh,
  creditsUnavailable, creditsExpiry, alternatives, onSwitchToAlternative,
}: TraeAccountPanelProps): ReactElement | null {
  const writable = settingsScope?.getSnapshot().writable === true
  const signedIn = status.status === 'signed-in'
  // `accounts` exists only on the signed-in variant.
  const accounts = signedIn ? status.accounts : []
  const pool = signedIn ? status.pool : undefined

  return (
    <>
      {/* The preference switches, as BARE LINES — no bordered box, no heading,
          no 「保存」/「放弃」 footer.
          
          That is the sibling dsh-connect-workbuddy card's shape, and the reason
          it is the better one here: a card that asks the user to press Save for a
          boolean is asking them to remember something with no reason to need
          remembering. The boxes write on their own click (see the card's
          `writePreference`), exactly like the region on/off boxes in the tab bar
          above — so the whole card has ONE commit model instead of two.
          
          The label IS the checkbox's own <label>, so the text is a larger click
          target and the accessible name needs no ARIA. */}
      <div className="dsm-trae-prefs">
        {/* REGION-AGNOSTIC: a readout exists on either side (CN credits,
            international plan), so the switch that turns it on belongs on either
            side. The hint names whichever figure THIS panel's readout would show,
            so the box answers "what do I get if I tick this?" without the reader
            having to switch panels to find out. */}
        <label className="dsm-trae-pref" title={t(credentialRegionIsAi ? 'row.showPointsInMainUiHintAi' : 'row.showPointsInMainUiHint')}>
          <input
            type="checkbox"
            className="dsm-trae-pref-check"
            checked={showPointsInMainUi}
            disabled={!writable || savingPreferences}
            aria-describedby={creditsHintId}
            onChange={event => { onToggleShowPoints(event.currentTarget.checked) }}
          />
          <span className="dsm-trae-pref-copy">
            <span className="dsm-trae-pref-label" id={creditsLabelId}>{t('row.showPointsInMainUi')}</span>
            <span className="dsm-trae-pref-hint" id={creditsHintId}>
              {t(credentialRegionIsAi ? 'row.showPointsInMainUiHintAi' : 'row.showPointsInMainUiHint')}
            </span>
          </span>
        </label>
        {/* WHERE that readout sits (learned from workbuddy #62). It sits directly
            beside the show/hide box because the two answer one question together
            ("show it, and where"), and because a user only reaches for this when
            the default seat is unavailable — typically after installing another
            plugin that occupies the composer row. A panel that is switched off
            gets a disabled control rather than none: it still has no readout to
            place, but the control's ABSENCE would look like the feature went
            away. */}
        <label className="dsm-trae-pref dsm-trae-credit-position-pref" title={t('row.creditPositionHint')}>
          <span className="dsm-trae-pref-copy">
            <span className="dsm-trae-pref-lead">
              <span className="dsm-trae-pref-label">{t('row.creditPositionLabel')}</span>
              <select
                className="dsm-trae-credit-position"
                value={regionOn ? creditPosition : 'composer'}
                disabled={!regionOn || !writable || savingPreferences}
                aria-label={t('row.creditPositionAria', {
                  region: panel === 'cn' ? t('row.tabCn') : panel === 'enterprise' ? t('row.tabEnterprise') : t('row.tabAi'),
                })}
                onChange={event => {
                  onCreditPositionChange(event.currentTarget.value === 'stats' ? 'stats' : 'composer')
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

      {/* ONE account table, not two. Once the pool document exists the pool's
          member table below lists the same accounts with the same credits and the
          same check-in state, so this roster would be a verbatim second copy of
          it — the row names, balances and check-in words all appeared twice on
          one screen. Its unique controls (rescan, import/export, the manual
          binding) move into the pool block's settings, which is also where the
          WorkBuddy card keeps them. */}
      {pool !== undefined
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
              onClick={onRescan}
            >
              {busy ? t('row.accountsScanning') : t('row.refreshTokens')}
            </button>
          </div>
          {/* A signed-out panel still lists what the Host FOUND, and the reason
              it refuses to use it. Dropping the table in this state is what made
              a dead binding a dead end: the Host returns the roster alongside the
              reason, and the card used to throw the roster away — so "the bound
              account's token cannot be refreshed" arrived with no rows to act on,
              and the only way out was editing the settings file by hand. */}
          {!signedIn || accounts.length === 0
            ? <div className="dsm-trae-usage-account" role="status">
                <div className="dsm-trae-usage-account-copy">
                  <div className="dsm-trae-usage-status">
                    <span aria-hidden="true" className="dsm-trae-usage-dot" style={dotStyle(status.status)} />
                    <span>{statusLabel}</span>
                  </div>
                  {signedIn
                    ? <span className="dsm-trae-usage-expiry">
                        {t('row.tokenExpiry', { expiresAt: formatDateTime(status.tokenExpiresAtMs) })}
                      </span>
                    : null}
                </div>
              </div>
            : null}
          {status.status !== 'error' && rows.length > 0
            ? <div className={`dsm-trae-account-table${credentialRegionIsAi ? '' : ' dsm-trae-account-table-checkin'}`}>
                {/* Column header, as the sibling WorkBuddy card has one: the
                    values line up in fixed tracks, so the eye reads DOWN a column
                    instead of re-finding the field on every row. Widths are
                    fractions of the container, not content — that is what stops
                    the "columns drift with the text" problem the previous table
                    had. */}
                <div className="dsm-trae-account-row dsm-trae-account-row-head" role="row">
                  <span>{t('row.accountColumnAccount')}</span>
                  <span>{t('row.accountColumnValue')}</span>
                  {credentialRegionIsAi ? null : <span>{t('row.accountColumnCheckin')}</span>}
                  {/* The actions column carries no header: the buttons speak
                      for themselves, and a label here would just be the word
                      "操作" above two words. */}
                  <span />
                </div>
                {rows.map(row => {
                  const warning = refreshTokenWarning(row.refreshExpiresAtMs, Date.now(), t, formatDateTime)
                  return (
                    /* One grid row per account: identity, worth, the day's
                       check-in, then the actions. The serving row is marked by a
                       LEFT ACCENT BAR plus the tint — a wash alone reads as a
                       zebra stripe in a long table. */
                    <div
                      key={row.id}
                      className={`dsm-trae-account-row${row.current ? ' dsm-trae-account-row-current' : ''}`}
                      role="row"
                    >
                      <span className="dsm-trae-account-who">
                        <span aria-hidden="true" className="dsm-trae-usage-dot" style={dotStyle(row.selected ? 'signed-in' : 'signed-out')} />
                        <span className="dsm-trae-account-name">
                          <b>{row.accountName}</b>
                          {/* Which account is serving, in WORDS. The tint alone
                              answers nothing when the question IS "which one is
                              it?". */}
                          {row.current ? <span className="dsm-trae-account-badge">{t('row.accountCurrentBadge')}</span> : null}
                          <span className="dsm-trae-account-meta">{row.meta}</span>
                          {/* The countdown that actually ends automatic renewal.
                              Per ACCOUNT, because the expiry is a property of
                              each credential, and rendered only when it is close
                              or already past — a healthy token must not add a
                              permanent line to every row. */}
                          {warning === undefined
                            ? null
                            : <span className={`dsm-trae-refresh-warn dsm-trae-refresh-warn-${warning.tone}`} role="status">
                                {warning.text}
                              </span>}
                          {row.error === undefined
                            ? null
                            : <span className="dsm-trae-account-note" role="alert">{row.error}</span>}
                        </span>
                      </span>
                      <span className="dsm-trae-account-worth">{row.value}</span>
                      {credentialRegionIsAi
                        ? null
                        : <span className="dsm-trae-account-checkin-cell">
                            {row.claim === undefined
                              ? null
                              : <ClaimCell claim={row.claim} t={t} onClaim={() => { onClaim(row.id) }} />}
                          </span>}
                      <span className="dsm-trae-account-actions">
                        {/* The bound row offers no switch: it is already the one
                            in use, and a disabled copy of the badge beside the
                            badge said nothing. */}
                        {row.current
                          ? null
                          : <button
                              type="button"
                              className="dsm-btn dsm-btn-outline dsm-trae-account-switch"
                              disabled={switchingAccount || !writable}
                              onClick={() => { onSwitchAccount(row.id) }}
                            >
                              {switchingAccount ? t('row.accountSwitching') : t('row.accountSwitch')}
                            </button>}
                      </span>
                    </div>
                  )
                })}
              </div>
            : null}
          {/*
            Import / export (issue #37). Rendered on BOTH sign-in states, and
            outside the `signed-in` branch above on purpose: a machine that has
            never signed in is exactly where importing a file exported elsewhere
            matters most, and the export button simply stays disabled while there
            is nothing to select.
          */}
          <AccountTransfer
            t={t}
            // Import/export moves CREDENTIALS, which belong to a region, not a
            // billing pool: the enterprise panel shares the cn store.
            region={panel === 'ai' ? 'ai' : 'cn'}
            accounts={accounts.map(account => ({ id: account.id, accountName: account.accountName }))}
            onChanged={onTransferChanged}
          />
        </section>}

      {signedIn && creditsUnavailable === 'enterprise'
        ? <p className="dsm-trae-credits-unavailable" role="note">{t('row.enterpriseCreditsNotice')}</p>
        : null}
      {signedIn && alternatives !== undefined && alternatives.length > 0
        ? <div className="dsm-trae-usage-alternative" role="status">
            <p className="dsm-trae-usage-alternative-text">
              {t('row.creditsExhausted', { account: status.accountName })}
              {' '}
              {t('row.creditsAlternative', {
                accounts: alternatives
                  .map(alt => `${alt.accountName}（${t(`row.edition${alt.edition === 'cn' ? 'Cn' : alt.edition === 'sg' ? 'Sg' : alt.edition === 'solo' ? 'Solo' : 'SoloSg'}`)}：${formatNumber(alt.workAvailable + alt.generalAvailable)}）`)
                  .join('、'),
              })}
            </p>
            <button
              type="button"
              className="dsm-trae-usage-switch-button"
              disabled={switchingAccount || !writable}
              onClick={() => {
                const [target] = alternatives
                if (target !== undefined) onSwitchToAlternative(target.id)
              }}
            >
              {t('row.creditsAlternativeSwitch')}
            </button>
          </div>
        : null}
      {/* Credit about to lapse. Sits right after the exhausted/alternative rows,
          because it answers the same question those do — "is there anything I
          should do about my balance?" — and unlike them it is actionable while
          the account still works. */}
      {signedIn && creditsExpiry !== undefined
        ? <ExpiryNotice expiry={creditsExpiry} t={t} />
        : null}
      {rescanNote === undefined ? null : <p className="dsm-trae-usage-note" role="status">{rescanNote}</p>}

      {signedIn
        ? <>
            {pool !== undefined
              ? <AccountPool
                  panel={panel}
                  pool={pool}
                  models={models}
                  t={t}
                  settingsScope={settingsScope}
                  topActions={<button
                    type="button"
                    className="dsm-btn dsm-btn-outline"
                    disabled={busy}
                    onClick={onRescan}
                  >
                    {busy ? t('row.accountsScanning') : t('row.poolRescan')}
                  </button>}
                  tools={<div className="dsm-trae-pool-tool-row">
                    <span className="dsm-trae-pool-tool-label">{t('row.poolToolsLabel')}</span>
                    <AccountTransfer
                      t={t}
                      // The row already carries its own label; the section's
                      // heading would be a second one.
                      hideLabel
                      region={panel === 'ai' ? 'ai' : 'cn'}
                      accounts={accounts.map(account => ({ id: account.id, accountName: account.accountName }))}
                      onChanged={onTransferChanged}
                    />
                  </div>}
                  details={poolDetails}
                  claims={pool.checkinSupported === true ? poolClaims : undefined}
                  onClaim={onClaim}
                  deviceClaimed={deviceClaimed}
                  onBind={onSwitchAccount}
                  bindingBusy={switchingAccount}
                  onChanged={onPoolChanged}
                  onRefresh={onPoolRefresh}
                />
              : null}
            {status.checkin !== undefined && !status.checkin.enabled
              ? <p className="dsm-trae-usage-error">{t('row.checkinDisabled')}</p>
              : null}
            {status.checkinError === undefined
              ? null
              : <p className="dsm-trae-usage-error">{t('row.checkinError', { message: status.checkinError })}</p>}
          </>
        : null}
    </>
  )
}

