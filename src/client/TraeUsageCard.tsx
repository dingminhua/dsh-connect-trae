/**
 * Trae usage card contributed to Harness Plugin configuration.
 *
 * Structure, CSS classes, and button primitives mirror `dsh-subagent-default-model`'s
 * `SubagentModelCard` so the two plugins share one external-presentation language.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createElement as h } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  nextRegionEnabled,
  nextRegionSlots,
  regionEnabledOf,
  TRAE_ACCOUNTS_REFRESH_PATH,
  TRAE_CHECKIN_PATH,
  TRAE_MODELS_REFRESH_PATH,
  TRAE_REGIONS,
  TRAE_USAGE_PATH,
  withTraeRegion,
} from '../status-paths.ts'
import type { TraeWebCheckinClaim, TraeWebModel, TraeWebUsage } from '../status-paths.ts'
import type { TraeRegion } from '../region.ts'
import { TRAE_PLUGIN_ICON } from './icon.ts'
import { TRAE_CARD_CSS } from './styles.ts'
import type { TraeSettingsKey } from './locales.ts'

/** Localized copy injected by the browser-plugin registration. */
export interface TraeUsageCardInjected {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
  settingsScope: {
    getSnapshot(): { status: string; value?: unknown; writable: boolean }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
  }
}

/** Props delivered by the Plugin configuration item slot. */
export type TraeUsageCardProps =
  PropsRuntime<'settings.plugin.item'>
  & Partial<TraeUsageCardInjected>

const POLL_INTERVAL_MS = 60_000
const TRAE_GITHUB_URL = 'https://github.com/dingminhua/dsh-connect-trae'

/** One region's unsaved model edits; switching tabs never drops these. */
interface TraeDraft {
  models: TraeWebModel[]
  enabledIds: Set<string>
  imageIds: Set<string>
  contextBudgets: Record<string, number>
}

/** Read the per-region account selections out of the settings snapshot. */
function configuredAccountsOf(configured: unknown): Record<string, string> {
  const accounts = (configured as { accounts?: unknown } | undefined)?.accounts
  return typeof accounts === 'object' && accounts !== null ? accounts as Record<string, string> : {}
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

function formatCapacity(value: number | undefined, unknown: string): string {
  if (value === undefined) return unknown
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`
  return formatNumber(value)
}

function dotStyle(status: TraeWebUsage['status']): Record<string, string> {
  const color = status === 'signed-in'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d92d20)'
      : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  return { background: color }
}

/** Render Trae sign-in state and the total usage summary as one expandable card. */
export function TraeUsageCard({ t, settingsScope }: TraeUsageCardProps) {
  if (t === undefined) throw new Error('Trae usage card requires its translation function')
  const [open, setOpen] = useState(false)
  /** The region whose tab is on screen; each tab is its own provider stack. */
  const [activeRegion, setActiveRegion] = useState<TraeRegion>('cn')
  /** Last-known usage per region, so tab dots survive tab switches. */
  const [statusByRegion, setStatusByRegion] = useState<Partial<Record<TraeRegion, TraeWebUsage>>>({
    cn: { status: 'signed-out', accounts: [] },
    ai: { status: 'signed-out', accounts: [] },
  })
  const [busy, setBusy] = useState(false)
  const [settingsRevision, setSettingsRevision] = useState(0)
  /** Per-region unsaved model edits; a draft on one tab is never dropped by
   * switching to the other tab, only by that tab's discard/save. */
  const [drafts, setDrafts] = useState<Partial<Record<TraeRegion, TraeDraft>>>({})
  const [saving, setSaving] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  /** Region whose on/off checkbox write is in flight, so its box can't race. */
  const [togglingRegion, setTogglingRegion] = useState<TraeRegion | undefined>(undefined)
  /**
   * Whether a check-in claim is in flight. A single flag rather than a
   * per-region map: the claim exists only on the CN tab, and one shared flag
   * keeps a tab switch from stranding a second concurrent claim.
   */
  const [claiming, setClaiming] = useState(false)
  /** Last claim refusal, shown until the next successful refresh. */
  const [claimError, setClaimError] = useState<string | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => settingsScope?.subscribe(() => { setSettingsRevision(value => value + 1) }), [settingsScope])

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
  const regionOn = (item: TraeRegion): boolean =>
    regionEnabledOf(settingsScope?.getSnapshot().value, item)
  const activeRegionOn = regionOn(activeRegion)

  const refreshUsage = useCallback(async (
    region: TraeRegion,
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

  useEffect(() => {
    if (!open || !activeRegionOn) return
    const controller = new AbortController()
    void refreshUsage(activeRegion, controller.signal)
    return () => { controller.abort() }
  }, [open, activeRegion, activeRegionOn, refreshUsage])

  const status: TraeWebUsage = statusByRegion[activeRegion] ?? { status: 'signed-out', accounts: [] }

  /**
   * Drop a claim refusal when the tab changes. The error belongs to the region
   * it came from — carrying it onto the other tab would attribute an
   * international account's problem to the CN one (or the reverse).
   */
  useEffect(() => { setClaimError(undefined) }, [activeRegion])

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
    try {
      const response = await fetch(withTraeRegion(TRAE_ACCOUNTS_REFRESH_PATH, activeRegion), {
        method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin',
      })
      const body = await response.json() as { accounts?: { id: string; selected: boolean }[] }
      if (!response.ok || !Array.isArray(body.accounts)) throw new Error(`HTTP ${response.status}`)
      const selected = body.accounts.find(account => account.selected)?.id
      const configured = configuredAccountsOf(settingsScope?.getSnapshot().value)
      if (selected !== undefined && selected !== configured[activeRegion] && settingsScope?.getSnapshot().writable === true) {
        await settingsScope.set('accounts', { ...configured, [activeRegion]: selected })
      }
      await refreshUsage(activeRegion)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const switchAccount = async (accountId: string): Promise<void> => {
    if (settingsScope === undefined) return
    setSwitchingAccount(true)
    try {
      const configured = configuredAccountsOf(settingsScope.getSnapshot().value)
      await settingsScope.set('accounts', { ...configured, [activeRegion]: accountId })
      await refreshUsage(activeRegion)
    } finally {
      if (mounted.current) setSwitchingAccount(false)
    }
  }

  /**
   * Claim today's check-in reward for the active tab's region.
   *
   * The Host route owns every guard that matters — POST only, loopback origin
   * only, CN only, and a status read before the claim — because a browser-side
   * check is not a guard. The button's own `disabled` is therefore a courtesy
   * (it stops an obviously pointless click), not the protection.
   *
   * A refusal is not thrown away: the route answers `claimed: false` with the
   * upstream's business code and message, and the card shows it. The upstream
   * also reports success for an already-claimed day, so `alreadyCheckedIn`
   * refreshes the state without pretending a new reward landed.
   */
  const claimCheckin = async (): Promise<void> => {
    setClaiming(true)
    setClaimError(undefined)
    try {
      const response = await fetch(withTraeRegion(TRAE_CHECKIN_PATH, activeRegion), {
        method: 'POST',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => undefined) as (TraeWebCheckinClaim & { error?: string }) | undefined
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
      if (body?.claimed === false && body.alreadyCheckedIn !== true) {
        throw new Error(body.message === undefined || body.message === ''
          ? t('row.checkinRefused', { code: String(body.code ?? '') })
          : `${t('row.checkinRefused', { code: String(body.code ?? '') })}: ${body.message}`)
      }
      await refreshUsage(activeRegion)
    } catch (error: unknown) {
      if (mounted.current) setClaimError(error instanceof Error ? error.message : t('row.requestFailed'))
    } finally {
      if (mounted.current) setClaiming(false)
    }
  }

  /**
   * Switch one region's provider off or on (issue #11). The write carries the
   * region's whole slot through untouched — only `enabled` changes — so the
   * user's directory, model picks, image opt-ins and budgets survive a
   * round trip. The Host withdraws or restores the provider route on the next
   * `onChange`, which is what actually removes it from DSH's model picker.
   */
  const toggleRegion = async (item: TraeRegion, enabled: boolean): Promise<void> => {
    if (settingsScope === undefined || settingsScope.getSnapshot().writable !== true) return
    setTogglingRegion(item)
    try {
      // `nextRegionEnabled` unwraps the settings section itself and returns the
      // bare `regions` map, which is exactly what this field write needs.
      await settingsScope.set('regions', nextRegionEnabled(settingsScope.getSnapshot().value, item, enabled))
    } finally {
      if (mounted.current) setTogglingRegion(undefined)
    }
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

  const settingsValue = settingsScope?.getSnapshot().value
  // Region-scoped saved state: the active tab's own slot first; the
  // pre-region-split flat fields are only read for cn (the Host reads them the
  // same way, see regionStateOf), so a budget set on one region's model is
  // never applied to the other's.
  const region: TraeRegion = activeRegion
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
  const savedEnabledIds = status.status === 'signed-in' ? new Set(status.enabledModelIds) : new Set<string>()
  const activeEnabledIds = draft?.enabledIds ?? savedEnabledIds
  const activeImageIds = draft?.imageIds ?? savedImageIds
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
      await settingsScope.set('regions', nextRegionSlots(configuredRegions, activeRegion, {
        enabled: regionOn(activeRegion),
        lastCatalog: visibleModels.map(model => ({ ...model, input: ['text'] })),
        enabledModelIds: [...activeEnabledIds],
        imageModelIds: [...activeImageIds].filter(id => activeEnabledIds.has(id)),
        contextBudgets: activeContextBudgets,
      }))
      discardModels()
      await refreshUsage(activeRegion)
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const title = t('row.title')
  const label = status.status === 'signed-in'
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
        >
          {h(IconChevronDownOutline14, { size: 14 })}
        </span>
      </button>
      <div className="dsm-plugin-card-body" hidden={!open}>
        {open
          ? <div className="dsm-trae-usage">
              <div className="dsm-trae-tabs" role="tablist" aria-label={title}>
                {TRAE_REGIONS.map(item => {
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
                        {item === 'cn' ? t('row.tabCn') : t('row.tabAi')}
                      </button>
                      <label className="dsm-trae-tab-switch" title={t('row.tabSwitchHint')}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={settingsScope?.getSnapshot().writable !== true || togglingRegion !== undefined}
                          aria-label={t('row.tabSwitchAria', { region: item === 'cn' ? t('row.tabCn') : t('row.tabAi') })}
                          onChange={event => { void toggleRegion(item, event.currentTarget.checked) }}
                        />
                      </label>
                    </div>
                  )
                })}
              </div>
              <p className="dsm-trae-tab-hint">{t('row.tabHint')}</p>
              {regionOn(activeRegion)
                ? null
                : <p className="dsm-trae-tab-off-notice" role="status">{t('row.tabOffNotice')}</p>}
              <div className="dsm-trae-usage-account">
                <div className="dsm-trae-usage-account-copy" role="status">
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
                <button
                  type="button"
                  className="dsm-btn dsm-btn-outline"
                  disabled={busy}
                  onClick={() => { void rescanAccounts() }}
                >
                  {busy ? t('row.accountsScanning') : t('row.refreshTokens')}
                </button>
              </div>
              {status.status !== 'error' && status.accounts.length > 0
                ? <section className="dsm-trae-account-picker" aria-label={t('row.accountsTitle')}>
                    <div className="dsm-trae-usage-select-wrap">
                      <select
                        className="dsm-trae-usage-select"
                        value={status.status === 'signed-in' ? status.accountId : ''}
                        disabled={switchingAccount || settingsScope?.getSnapshot().writable !== true}
                        onChange={event => { void switchAccount(event.currentTarget.value) }}
                      >
                        {status.accounts.map(account => <option key={account.id} value={account.id}>{account.accountName} · {account.region === 'ai' ? t('row.regionAi') : t('row.regionCn')} · {account.edition}</option>)}
                      </select>
                    </div>
                  </section>
                : null}
              {status.status === 'signed-in'
                ? <>
                    {status.payStatus === undefined ? null : (
                      <div className="dsm-trae-usage-list">
                        <div className="dsm-trae-usage-stats dsm-trae-usage-stats-two">
                          <div className="dsm-trae-usage-stat dsm-trae-usage-stat-general">
                            <div className="dsm-trae-usage-stat-head">
                              <span className="dsm-trae-usage-stat-label">{t('row.subscriptionLabel')}</span>
                              <span className={`dsm-trae-usage-stat-badge ${status.payStatus.hasPackage ? 'dsm-trae-usage-stat-badge-on' : 'dsm-trae-usage-stat-badge-off'}`}>
                                {t(status.payStatus.hasPackage ? 'row.subscribed' : 'row.noPackage')}
                              </span>
                            </div>
                            <span className="dsm-trae-usage-stat-value dsm-trae-usage-stat-value-general">
                              {status.payStatus.inTrial && status.payStatus.trialEndTimeMs > 0
                                ? t('row.trialUntil', { date: formatDateTime(status.payStatus.trialEndTimeMs) })
                                : t(status.payStatus.hasPackage ? 'row.subscribed' : 'row.noPackage')}
                            </span>
                            <span className="dsm-trae-usage-stat-hint">
                              {status.payStatus.enableSoloLite || status.payStatus.enableSoloCoder || status.payStatus.enableSoloBuilder || status.payStatus.enableSoloWeb
                                ? [status.payStatus.enableSoloLite ? 'SOLO Lite' : '', status.payStatus.enableSoloCoder ? 'SOLO Coder' : '', status.payStatus.enableSoloBuilder ? 'SOLO Builder' : '', status.payStatus.enableSoloWeb ? 'SOLO Web' : ''].filter(Boolean).join(' · ')
                                : (status.payStatus.isDollarUsageBilling ? 'dollar usage billing' : '')}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    {status.payStatusError === undefined ? null
                      : <p className="dsm-trae-usage-error">{t('row.payStatusError', { message: status.payStatusError })}</p>}
                    {status.credits === undefined ? null : (
                      <div className="dsm-trae-usage-list">
                        <div className="dsm-trae-usage-stats dsm-trae-usage-stats-two">
                          <div className="dsm-trae-usage-stat dsm-trae-usage-stat-work">
                            <div className="dsm-trae-usage-stat-head">
                              <span className="dsm-trae-usage-stat-label">{t('row.workCreditsLabel')}</span>
                              <span className="dsm-trae-usage-stat-badge dsm-trae-usage-stat-badge-off">{t('row.workNotUsable')}</span>
                            </div>
                            <span className="dsm-trae-usage-stat-value dsm-trae-usage-stat-value-work">{formatNumber(status.credits.workAvailable)}</span>
                            <span className="dsm-trae-usage-stat-hint">{t('row.workUsableHint')}</span>
                          </div>
                          <div className="dsm-trae-usage-stat dsm-trae-usage-stat-general">
                            <div className="dsm-trae-usage-stat-head">
                              <span className="dsm-trae-usage-stat-label">{t('row.generalCreditsLabel')}</span>
                              <span className="dsm-trae-usage-stat-badge dsm-trae-usage-stat-badge-on">{t('row.generalUsable')}</span>
                            </div>
                            <span className="dsm-trae-usage-stat-value dsm-trae-usage-stat-value-general">{formatNumber(status.credits.generalAvailable)}</span>
                            <span className="dsm-trae-usage-stat-hint">{t('row.generalUsableHint')}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {status.creditsError === undefined ? null
                      : <p className="dsm-trae-usage-error">{t('row.creditsError', { message: status.creditsError })}</p>}
                    {status.checkin === undefined ? null : (() => {
                      // `didCheckedIn` counts as done alongside `checkedIn`: the
                      // upstream reports them separately, and the official app
                      // keeps the button disabled for the rest of the day off
                      // the former. Disabling on both means a status read that
                      // happens to say `checked_in: false` cannot invite a
                      // second, pointless claim.
                      const done = status.checkin.checkedIn || status.checkin.didCheckedIn
                      const reward = formatNumber(status.checkin.credits)
                      const bonus = status.checkin.extraCredits === undefined
                        ? ''
                        : ` + ${formatNumber(status.checkin.extraCredits)}`
                      return (
                        <div className="dsm-trae-checkin">
                          <span className="dsm-trae-checkin-copy">
                            <span className="dsm-trae-checkin-label">{t('row.checkinLabel')}</span>
                            <span className="dsm-trae-checkin-hint">
                              {t('row.checkinReward', { reward: `${reward}${bonus}` })}
                              {done ? ` · ${t('row.checkinDoneHint')}` : ''}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="dsm-btn dsm-btn-primary dsm-trae-checkin-button"
                            disabled={!status.checkin.enabled || done || claiming}
                            onClick={() => { void claimCheckin() }}
                          >
                            {claiming
                              ? t('row.checkinClaiming')
                              : done ? t('row.checkinClaimed') : t('row.checkinClaim')}
                          </button>
                        </div>
                      )
                    })()}
                    {status.checkin !== undefined && !status.checkin.enabled
                      ? <p className="dsm-trae-usage-error">{t('row.checkinDisabled')}</p>
                      : null}
                    {status.checkinError === undefined
                      ? null
                      : <p className="dsm-trae-usage-error">{t('row.checkinError', { message: status.checkinError })}</p>}
                    {claimError === undefined
                      ? null
                      : <p className="dsm-trae-usage-error" role="alert">{t('row.checkinError', { message: claimError })}</p>}
                    <section className="dsm-trae-models" aria-label={t('row.modelsTitle')}>
                      <div className="dsm-trae-models-head">
                        <div>
                          <h3 className="dsm-trae-models-title">{t('row.modelsTitle')}</h3>
                          <p className="dsm-trae-models-summary">{t('row.modelsSummary', { count: activeEnabledIds.size })}</p>
                        </div>
                        <button
                          type="button"
                          className="dsm-btn dsm-btn-outline"
                          disabled={busy}
                          onClick={() => { void refreshModels() }}
                        >
                          {busy ? t('row.modelsRefreshing') : t('row.modelsRefresh')}
                        </button>
                      </div>
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
                                    {model.creditMultiplier === undefined ? null
                                      : <span className="dsm-trae-model-name-rate">· x{model.creditMultiplier.toFixed(2)}</span>}
                                  </span>
                                </span>
                              </label>
                              <div className="dsm-trae-model-options">
                                <label className="dsm-trae-model-image">
                                  <input
                                    type="checkbox"
                                    checked={activeImageIds.has(model.id)}
                                    disabled={settingsScope?.getSnapshot().writable !== true || saving}
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
              {status.status === 'signed-out'
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
    </li>
  )
}
