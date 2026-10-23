/**
 * The account-pool card UI for Trae, ported from the WorkBuddy sibling.
 *
 * Mounted by {@link TraeUsageCard} inside the signed-in branch, below the
 * account table, rendered only when the usage document carries `pool` (the Host
 * omits it when the panel is unconfigured).
 *
 * This half of the feature is deliberately dumb about rules: every verdict an
 * account needs — credits, exclusion, the in-pool flag, the serving row — comes
 * pre-derived by the Host (`TraeWebPoolAccount`), so the card never re-ranks on
 * its own idea of "which account should bill". It drafts the saved preferences
 * (`TraePoolPreferences`) and writes them back through the card's verified
 * regions-write helper.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode, SyntheticEvent } from 'react'
import {
  regionPoolOf,
  nextRegionPool,
  withTraePoolAction,
  withTraePoolAccount,
} from '../status-paths.ts'
import type {
  TraePanel,
  TraePoolPreferences,
  TraePoolTestRowView,
  TraeWebModel,
  TraeWebPool,
  TraeWebPoolAccount,
  TraeWebPoolExclusion,
  TraeWebPoolOutcome,
  TraeWebPoolDeleteAnswer,
} from '../status-paths.ts'
import { writeSettingsField } from './TraeUsageCard.tsx'
import type { TraeSettingsKey } from './locales.ts'

/**
 * A finite number or the fallback.
 *
 * The usage document is served by a Host that may be OLDER than this bundle (the
 * card ships in the client bundle and updates on refresh, the Host only on
 * restart), so a field the Host does not send yet must degrade to a usable default
 * instead of rendering `undefined` into a select.
 */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Probe sizes the card offers, in tokens. `0` is the minimal one-word probe.
 *
 * Deliberately a short, coarse list: the number is a spend decision (a probe at
 * 50k tokens costs real credit on every account in the batch), and offering a
 * free-text field invites values the upstream rounds away anyway.
 */
const PROBE_INPUT_TOKEN_CHOICES: readonly number[] = [0, 10_000, 20_000, 30_000, 50_000, 100_000]

/** Facts the pool document does not carry, joined from the card's roster by id. */
export interface TraePoolRowDetail {
  /** edition · credential source, already worded by the card. */
  meta?: string
  /** Token-expiry countdown, already worded, and only when it matters. */
  warn?: string
  /** `soon` = renewal ends shortly, `lapsed` = it already did. */
  warnTone?: 'soon' | 'lapsed' | undefined
}

/** The daily check-in control for one row, pre-derived by the card. */
export interface TraePoolRowClaim {
  label: string
  disabled: boolean
  title?: string
  busy: boolean
  /**
   * Whether the click can still do anything. False once the account is paid or
   * this machine spent the day's claim: the row then shows the state alone,
   * without a greyed button repeating it.
   */
  claimable?: boolean
}

interface AccountPoolProps {
  panel: TraePanel
  pool: TraeWebPool
  /** The panel's live model catalog, for the target-model select. */
  models: readonly TraeWebModel[]
  t: (key: TraeSettingsKey, params?: Record<string, unknown> | undefined) => string
  settingsScope?: {
    getSnapshot(): { status: string; value?: unknown; writable: boolean }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<boolean>
  } | undefined
  /** Called after a successful save so the card can re-read the pool document. */
  onChanged?: () => void
  /**
   * Re-read the region's usage after a remove/test so rows refresh. The
   * card answers with the fetch promise, so an in-row action can await it and
   * only then clear its own busy state.
   */
  onRefresh?: (() => void | Promise<unknown>) | undefined
  /**
   * Account management (rescan, import/export), rendered inside the settings
   * block. The pool's table IS this card's account table once `pool` exists, so
   * the controls that manage accounts belong here rather than in a second table
   * above it that repeats the same names, credits and check-in states.
   */
  tools?: ReactNode
  /**
   * The right-hand side of the top action row (the rescan button). Sits on
   * the same line as the batch actions, the way the reference card puts
   * 「重新检测账号」 opposite 「一键签到 / 一键测试」.
   */
  topActions?: ReactNode | undefined
  /** edition · source and the token countdown, keyed by account id. */
  details?: Readonly<Record<string, TraePoolRowDetail>> | undefined
  /** Per-row check-in buttons, keyed by account id. */
  claims?: Readonly<Record<string, TraePoolRowClaim>> | undefined
  /** Claim one row's check-in. */
  onClaim?: (accountId: string) => void
  /**
   * True when THIS machine already spent today's check-in, on any account.
   *
   * Trae keys the daily claim to `x-device-id`, so one machine can be paid once
   * per day: a second account is refused with 9095 no matter which row asks.
   * The batch button therefore has to stop at the device level, not the row
   * level — offering it invites an action that can only be refused.
   */
  deviceClaimed?: boolean
  /**
   * Bind a specific account by hand. Offered only while the pool is OFF: with it
   * on, the Host picks who bills and a manual picker would look authoritative
   * while changing nothing.
   */
  onBind?: (accountId: string) => void
  bindingBusy?: boolean
}

interface LogEntry {
  id: number
  tone: 'ok' | 'info' | 'warn' | 'error'
  text: string
}

/** Compare two arrays of ids order-insensitively. */
function sameIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const lhs = [...(a ?? [])].sort()
  const rhs = [...(b ?? [])].sort()
  return lhs.length === rhs.length && lhs.every((v, i) => v === rhs[i])
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

type T = AccountPoolProps['t']

/** `MM/DD, HH:mm` — the absolute stamp a row shows under its age. */
function shortWhen(atMs: number): string {
  const at = new Date(atMs)
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value))
  return `${pad(at.getMonth() + 1)}/${pad(at.getDate())}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** `MM/DD`, for a line that has room for a date but not a clock time. */
function shortDate(atMs: number): string {
  const at = new Date(atMs)
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value))
  return `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`
}

function relativeAt(atMs: number, now: number, t: T): string {
  const mins = Math.max(0, Math.round((now - atMs) / 60_000))
  if (mins < 1) return t('row.poolAgoNow')
  if (mins < 60) return t('row.poolAgoMin', { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('row.poolAgoHour', { n: hours })
  const days = Math.round(hours / 24)
  return t('row.poolAgoDay', { n: days })
}

/** A human label for every value of {@link TraeWebPoolOutcome}. */
function outcomeLabel(outcome: TraeWebPoolOutcome, t: T): string {
  switch (outcome) {
    case 'ok': return t('row.poolProbeOk')
    case 'rate-limited': return t('row.poolProbeRateLimited')
    case 'model-busy': return t('row.poolProbeModelBusy')
    case 'out-of-credit': return t('row.poolProbeOutOfCredit')
    case 'credential-rejected': return t('row.poolProbeCredentialRejected')
    case 'policy-rejected': return t('row.poolProbePolicyRejected')
    case 'plan-gated': return t('row.poolProbePlanGated')
    case 'unavailable': return t('row.poolProbeUnavailable')
    case 'not-found': return t('row.poolProbeNotFound')
    case 'failed': return t('row.poolProbeFailed')
  }
}

/** A human label for every value of {@link TraeWebPoolExclusion}. */
function exclusionLabel(exclusion: TraeWebPoolExclusion, t: T): string {
  switch (exclusion) {
    case 'unusable': return t('row.poolExcludedUnusable')
    case 'rate-limited': return t('row.poolExcludedRateLimited')
    case 'model-busy': return t('row.poolExcludedModelBusy')
    case 'out-of-credit': return t('row.poolExcludedOutOfCredit')
    case 'credential-rejected': return t('row.poolExcludedCredentialRejected')
    case 'policy-rejected': return t('row.poolExcludedPolicyRejected')
    case 'plan-gated': return t('row.poolExcludedPlanGated')
    case 'not-found': return t('row.poolExcludedNotFound')
    case 'unavailable': return t('row.poolExcludedUnavailable')
    case 'failed': return t('row.poolExcludedFailed')
  }
}

function probeSourceLabel(source: 'test-batch' | 'live-request' | undefined, t: T): string {
  switch (source) {
    case 'test-batch': return t('row.poolProbeSourceTest')
    case 'live-request': return t('row.poolProbeSourceLive')
    case undefined: return t('row.poolProbeSourceUnknown')
  }
}

/** The tone to log a test row result under. */
function outcomeTone(outcome: TraeWebPoolOutcome): LogEntry['tone'] {
  return outcome === 'ok' ? 'ok' : 'warn'
}

/** The serving account (Host's answer), for the header badge. */
function servingAccount(pool: TraeWebPool): TraeWebPoolAccount | undefined {
  return pool.accounts.find(account => account.current === true)
}

/**
 * Render a route refusal into a card-safe string. The error statuses the Host
 * can answer with are listed in the card doc; every one here must render as
 * TEXT (never crash). `origin-not-trusted`/`pool-unavailable` carry no body, so
 * they get a dedicated copy line keyed off the status.
 */
function renderRouteError(t: T, status: number, body: { reason?: unknown } | undefined): string {
  if (status === 403 && body?.reason === 'origin-not-trusted') return t('row.poolErrOrigin')
  if (status === 503) return t('row.poolErrUnavailable')
  if (status === 405) return t('row.poolErrMethod')
  if (status === 400) return t('row.poolErrBadRequest')
  if (status === 409) {
    switch (body?.reason) {
      case 'no-members': return t('row.poolErrNoMembers')
      case 'no-live-members': return t('row.poolErrNoLiveMembers')
      case 'target-model-stale': return t('row.poolErrTargetStale')
      case 'no-free-model': return t('row.poolErrNoFreeModel')
      default: return t('row.poolErrConflict')
    }
  }
  return t('row.poolErrGeneric', { status: String(status) })
}

/** Whether one row is a saved member (dictates the in-pool tag / ghost badge). */
interface TestMediaLine {
  row?: TraePoolTestRowView
  rows?: TraePoolTestRowView[]
  reason?: string
  error?: string
}

/**
 * Handle ONE NDJSON line of a `test` answer. A non-JSON line is skipped; a
 * `{reason:'pool-failed'}` line reports the failure and counts as "saw
 * something". Returns whether the line was usable, so the caller can tell "the
 * route answered nothing parseable" (a bug to surface) from "not finished yet".
 */
function applyTestLine(
  line: string,
  t: T,
  onRow: (row: TraePoolTestRowView) => void,
  onFailure: (message: string) => void,
): boolean {
  if (line.trim() === '') return false
  let parsed: TestMediaLine
  try { parsed = JSON.parse(line) } catch { return false }
  if (parsed.row !== undefined) {
    onRow(parsed.row)
    return true
  }
  if (parsed.rows !== undefined) {
    for (const r of parsed.rows) onRow(r)
    return true
  }
  if (parsed.reason === 'pool-failed') {
    onFailure(parsed.error ?? t('row.poolLogGeneric'))
    return true
  }
  return false
}

/**
 * Read the answer line by line AS IT ARRIVES.
 *
 * The Host streams one line per account, but `response.text()` waits for the
 * whole body: with a slow probe the card sat on "逐个处理账号中…" and looked
 * frozen (a single member could take half a minute). Reading the body stream
 * makes each finished account appear immediately, and an empty/failed stream
 * still ends the loop instead of hanging the busy state forever.
 */
async function* testLinesOf(response: Response): AsyncGenerator<string> {
  const body = response.body
  if (body === null) {
    for (const line of (await response.text()).split(/\r?\n/)) yield line
    return
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut = buffer.indexOf('\n')
    while (cut >= 0) {
      yield buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      cut = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.trim() !== '') yield buffer
}

/**
 * How long one `test` request may take before the card gives up.
 *
 * A probe has its own upstream deadline, but a stalled connection (a restarting
 * Host, a dropped keep-alive) has none: without this the run button stays
 * disabled until the page is reloaded, which reads as "测速卡住了". Sized for a
 * batch: a few seconds per account plus room for the slowest upstream.
 */
const TEST_TIMEOUT_MS = 180_000

export function AccountPool({ panel, pool, models, t, settingsScope, onChanged, onRefresh, tools, topActions, details, claims, onClaim, deviceClaimed = false, onBind, bindingBusy }: AccountPoolProps): ReactElement | null {
  // Re-read saved preferences whenever the settings scope changes (a save here,
  // or a save elsewhere / a profile import). Without this the `saved` memo is
  // keyed on `settingsScope`/`pool` field PRIMITIVES, so a write that only
  // mutates the scope (no pool identity change) would leave the draft comparing
  // against a stale snapshot and the "unsaved changes" badge stuck on.
  const [settingsTick, setSettingsTick] = useState(0)

  // Saved preferences — the SOURCE OF TRUTH for what the pool actually does.
  // NON-NEGOTIABLE: `targetModelId` must read as the saved/pool value, NOT `''`,
  // while the Host still holds the old id. Reading `''` makes a controlled
  // select show "automatic" and the NEXT save erases the user's choice.
  const saved = useMemo(() => {
    const base = regionPoolOf(settingsScope?.getSnapshot().value, panel)
    return {
      enabled: base.enabled === true,
      targetModelId: base.targetModelId ?? pool.targetModelId ?? pool.staleTargetModelId ?? '',
      memberAccountIds: [...(base.memberAccountIds ?? [])],
      // 0 is a real choice ("minimal probe"), so it must not fall back to the
      // document's value: only an ABSENT field means "never touched".
      probeInputTokens: numberOr(base.probeInputTokens, numberOr(pool.probeInputTokens, 0)),
    }
  }, [settingsTick, settingsScope, panel, pool.targetModelId, pool.staleTargetModelId, pool.probeInputTokens])

  /**
   * Whether the running Host knows the probe-size preference at all.
   *
   * The card bundle and the Host update on different clocks (a page refresh vs a
   * restart), so an older Host serves a pool document without this field. Writing
   * a key that Host's schema does not declare would be dropped on the way in and
   * then fail the read-back check — a save that reports an error and changes
   * nothing. Hiding the row is the honest state: this Host cannot do it yet.
   */
  const probeSupported = typeof pool.probeInputTokens === 'number'

  // The draft the user edits. The membership checkbox binds HERE (NON-NEGOTIABLE
  // #4), never to `account.member`.
  const [enabled, setEnabled] = useState(saved.enabled)
  const [targetModelId, setTargetModelId] = useState(saved.targetModelId ?? '')
  const [probeInputTokens, setProbeInputTokens] = useState(saved.probeInputTokens)
  const [selected, setSelected] = useState(() => new Set(saved.memberAccountIds ?? []))
  const [busy, setBusy] = useState<'test' | 'delete' | 'save' | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  // The reference block is controlled so a background refresh — which re-renders
  // this card on every poll — cannot collapse a section the user just opened.
  const [moreRulesOpen, setMoreRulesOpen] = useState(false)
  const [testing, setTesting] = useState<{ done: number } | undefined>(undefined)
  const [rows, setRows] = useState<Readonly<Record<string, TraePoolTestRowView>>>({})
  // Per-row destructive delete IN FLIGHT (`delete` drops the plugin's credential
  // copy). Same caveat as every other in-flight flag: it must not double as the
  // success marker, or a completed delete would leave the removed row showing a
  // spinner forever — so this is a transient Set cleared in `finally`.
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set())
  // A transient guidance line telling the user where an account that could not
  // be erased actually lives (a Trae desktop login the plugin does not own).
  const [deleteHint, setDeleteHint] = useState<
    | { kind: 'still-signed-in'; accountId: string; accountName: string; hadCopy: boolean }
    | { kind: 'app-running'; accountId: string; accountName: string; apps: readonly string[] }
    | undefined
  >(undefined)
  const [log, setLog] = useState<LogEntry[]>([])
  const [now, setNow] = useState(Date.now())
  const logId = useRef(0)
  const mountRef = useRef(true)

  useEffect(() => { mountRef.current = true; return () => { mountRef.current = false } }, [])

  useEffect(() => settingsScope?.subscribe(() => { setSettingsTick(tick => tick + 1) }), [settingsScope])

  const pushLog = (tone: LogEntry['tone'], text: string) => {
    if (!mountRef.current) return
    // Take the id OUTSIDE the updater: React may call an updater twice (StrictMode,
    // or a re-render of a batched update), and a mutable ref read inside it hands
    // the same id to two entries — which shows up as duplicate React keys.
    logId.current += 1
    const id = logId.current
    setLog(prev => [...prev.slice(-49), { id, tone, text }])
  }

  // Ghost members: saved but resolving to no local sign-in. They MUST still
  // render (as checked rows) so the user can see and remove them (#5).
  const knownIds = useMemo(() => new Set(pool.accounts.map(account => account.accountId)), [pool])
  const ghosts = useMemo(() => {
    const names = pool.memberNames ?? {}
    const result: { accountId: string; accountName: string }[] = []
    for (const id of saved.memberAccountIds ?? []) {
      if (knownIds.has(id)) continue
      // A blank saved name must not render as an empty row: the row is how the
      // user finds and deletes the copy, so fall back to the id it is keyed by.
      const name = names[id]
      result.push({ accountId: id, accountName: name === undefined || name === '' ? id : name })
    }
    return result
  }, [saved, pool, knownIds])

  // Dirty compares enabled / targetModelId / membership ids ORDER-INSENSITIVELY (#3).
  const dirty = enabled !== saved.enabled
    || (targetModelId ?? '') !== (saved.targetModelId ?? '')
    || (probeSupported && probeInputTokens !== saved.probeInputTokens)
    || !sameIds([...selected], saved.memberAccountIds)

  const writable = settingsScope?.getSnapshot().writable === true

  // Reset the draft when the saved preferences change identity (after a save or
  // a settings re-read elsewhere) — but field by field. One effect keyed on the
  // whole saved value would also fire for the in-row 移除, which writes ONLY the
  // membership, and would silently revert a switch or target model the user is
  // still editing but has not saved.
  const savedMemberKey = useMemo(() => [...(saved.memberAccountIds ?? [])].sort().join('\u0000'), [saved])
  useEffect(() => { setEnabled(saved.enabled) }, [panel, saved.enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTargetModelId(saved.targetModelId ?? '') }, [panel, saved.targetModelId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setProbeInputTokens(saved.probeInputTokens) }, [panel, saved.probeInputTokens]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(new Set(saved.memberAccountIds ?? [])) }, [panel, savedMemberKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const savedKey = useMemo(() => `${panel}:${saved.enabled}:${saved.targetModelId ?? ''}:${saved.probeInputTokens}:${savedMemberKey}`, [panel, saved.enabled, saved.targetModelId, saved.probeInputTokens, savedMemberKey])
  useEffect(() => { setSaveError(undefined) }, [savedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMember = (accountId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set([...pool.accounts.map(a => a.accountId), ...(saved.memberAccountIds ?? [])]))
  }
  const selectNone = () => setSelected(new Set())

  const discard = () => {
    setEnabled(saved.enabled)
    setTargetModelId(saved.targetModelId ?? '')
    setProbeInputTokens(saved.probeInputTokens)
    setSelected(new Set(saved.memberAccountIds ?? []))
    setSaveError(undefined)
    pushLog('info', t('row.poolLogDiscarded'))
    setNow(Date.now())
  }

  const save = async (): Promise<void> => {
    if (!writable || busy !== undefined) return
    setBusy('save')
    setSaveError(undefined)
    try {
      const next: TraePoolPreferences = {
        enabled,
        ...(targetModelId === '' ? {} : { targetModelId }),
        memberAccountIds: [...selected],
        ...(probeSupported ? { probeInputTokens } : {}),
      }
      await writeSettingsField(
        settingsScope,
        'regions',
        nextRegionPool(settingsScope.getSnapshot().value, panel, next),
        readBack => {
          const readPool = regionPoolOf(readBack, panel)
          return readPool.enabled === (next.enabled ?? false)
            && sameIds(readPool.memberAccountIds, next.memberAccountIds)
            && (readPool.targetModelId ?? '') === (next.targetModelId ?? '')
            && (!probeSupported || (readPool.probeInputTokens ?? 0) === probeInputTokens)
        },
      )
      pushLog('ok', t('row.poolLogSaved'))
      onChanged?.()
      onRefresh?.()
      setNow(Date.now())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(t('row.poolSaveFailed', { message }))
      pushLog('error', t('row.poolLogSaveFailed'))
    } finally {
      if (mountRef.current) setBusy(undefined)
    }
  }

  const runTest = async (): Promise<void> => {
    if (busy !== undefined) return
    const members = [...selected]
    if (members.length === 0) { pushLog('warn', t('row.poolLogNoMembers')); return }
    setBusy('test')
    setRows({})
    setTesting({ done: 0 })
    setNow(Date.now())
    const targetLabel = targetModelId === '' ? t('row.poolTargetAutoOption') : (models.find(m => m.id === targetModelId)?.name ?? targetModelId)
    pushLog('info', t('row.poolLogTestStart', { count: members.length, model: targetLabel }))
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, TEST_TIMEOUT_MS)
    try {
      const response = await fetch(withTraePoolAction(panel, 'test'), { method: 'POST', signal: controller.signal })
      const seen = new Set<string>()
      let sawAny = false
      // Streamed, so each finished account lands while the rest still run.
      for await (const line of testLinesOf(response)) {
        const used = applyTestLine(line, t, r => {
          // The Host streams a `{row}` per account and then a final `{rows}`
          // summary that repeats them. Logging both would print every account
          // twice for ONE click, so the second sighting only refreshes the cell.
          const fresh = !seen.has(r.accountId)
          setRows(prev => ({ ...prev, [r.accountId]: r }))
          if (!fresh) return
          seen.add(r.accountId)
          if (mountRef.current) setTesting({ done: seen.size })
          pushLog(outcomeTone(r.outcome), t('row.poolLogTestRow', { accountName: r.accountName, outcome: outcomeLabel(r.outcome, t) }))
        }, errorText => {
          pushLog('error', t('row.poolLogBatchFailed', { message: errorText }))
        })
        if (used) sawAny = true
      }
      if (!sawAny) throw new Error(t('row.poolLogGeneric'))
      pushLog('ok', t('row.poolLogTestDone'))
      onRefresh?.()
      setNow(Date.now())
    } catch (error: unknown) {
      pushLog('error', t(
        controller.signal.aborted ? 'row.poolLogTimeout' : 'row.poolLogBatchFailed',
        { message: error instanceof Error ? error.message : String(error) },
      ))
    } finally {
      clearTimeout(timer)
      if (mountRef.current) { setBusy(undefined); setTesting(undefined) }
    }
  }

  const runSingleTest = async (account: TraeWebPoolAccount): Promise<void> => {
    if (busy !== undefined) return
    setBusy('test')
    setNow(Date.now())
    const targetLabel = targetModelId === '' ? t('row.poolTargetAutoOption') : (models.find(m => m.id === targetModelId)?.name ?? targetModelId)
    pushLog('info', t('row.poolLogRowTesting', { accountName: account.accountName }))
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, TEST_TIMEOUT_MS)
    try {
      const response = await fetch(withTraePoolAccount(panel, 'test', account.accountId), { method: 'POST', signal: controller.signal })
      let sawAny = false
      const logged = new Set<string>()
      for await (const line of testLinesOf(response)) {
        const used = applyTestLine(line, t, r => {
          setRows(prev => ({ ...prev, [r.accountId]: r }))
          // Same reason as the batch: `{row}` lines and the trailing `{rows}`
          // summary describe the same account, and one click logs it once.
          if (logged.has(r.accountId)) return
          logged.add(r.accountId)
          pushLog(outcomeTone(r.outcome), t('row.poolLogTestRow', { accountName: r.accountName, outcome: outcomeLabel(r.outcome, t), model: targetLabel }))
        }, errorText => {
          pushLog('error', t('row.poolLogBatchFailed', { message: errorText }))
        })
        if (used) sawAny = true
      }
      if (!sawAny) throw new Error(t('row.poolLogGeneric'))
      onRefresh?.()
      setNow(Date.now())
    } catch (error: unknown) {
      pushLog('error', t(
        controller.signal.aborted ? 'row.poolLogTimeout' : 'row.poolLogBatchFailed',
        { message: error instanceof Error ? error.message : String(error) },
      ))
    } finally {
      clearTimeout(timer)
      if (mountRef.current) setBusy(undefined)
    }
  }

  /**
   * Persist the removal of ONE account out of this panel's membership.
   *
   * The slot written is the SAVED slot with ONLY `memberAccountIds` replaced —
   * never the draft's switch or target model, because the card's own hint
   * promises only the in-row actions take effect immediately
   * (「开关与目标模型是偏好，改完要保存」), and never the DOCUMENT's effective
   * target model either: that falls back to the free model when the user left
   * the choice automatic, so writing it back would pin a model they never chose.
   * The membership written is the DRAFT minus the removed id, so a checkbox the
   * user already toggled on another row is not silently discarded by the
   * settings re-read this write triggers.
   */
  const persistRemoval = async (accountId: string): Promise<void> => {
    const scope = settingsScope
    if (scope === undefined) throw new Error(t('row.poolLogSaveFailed'))
    const base = regionPoolOf(scope.getSnapshot().value, panel)
    const next: TraePoolPreferences = {
      ...base,
      memberAccountIds: [...selected].filter(id => id !== accountId),
    }
    await writeSettingsField(
      scope,
      'regions',
      nextRegionPool(scope.getSnapshot().value, panel, next),
      readBack => {
        const readPool = regionPoolOf(readBack, panel)
        return !readPool.memberAccountIds?.includes(accountId)
          && sameIds(readPool.memberAccountIds, next.memberAccountIds)
          && (readPool.enabled ?? false) === (base.enabled ?? false)
          && (readPool.targetModelId ?? '') === (base.targetModelId ?? '')
          && (readPool.probeInputTokens ?? 0) === (base.probeInputTokens ?? 0)
      },
    )
  }

  /** Product names for the desktop apps a delete touched or was blocked by. */
  const appLabels = (editions: readonly string[]): string =>
    editions
      .map(edition => t(`row.edition${edition === 'cn' ? 'Cn' : edition === 'sg' ? 'Sg' : edition === 'solo' ? 'Solo' : 'SoloSg'}`))
      .join('、')

  /**
   * Delete an account from this machine: drop the plugin's own credential copy,
   * then erase the account's login from Trae's `storage.json`, then clear every
   * account-holder this card holds (pool probe, settings membership, draft
   * selection, the serving binding it may have held).
   *
   * The app half is what makes the row actually disappear. It has one failure
   * mode worth its own message: a RUNNING Trae flushes its in-memory state back
   * over the file, so the Host refuses and names the app, and the card says to
   * quit it instead of reporting a generic failure the user cannot act on.
   */
  const deleteAccount = async (account: { accountId: string; accountName: string }): Promise<void> => {
    if (busy !== undefined || deletingIds.has(account.accountId)) return
    setBusy('delete')
    setDeletingIds(prev => new Set(prev).add(account.accountId))
    setDeleteHint(undefined)
    try {
      const response = await fetch(withTraePoolAccount(panel, 'delete', account.accountId), { method: 'POST' })
      const body = await response.json() as (TraeWebPoolDeleteAnswer & { reason?: string }) | undefined
      if (!response.ok) throw new Error(renderRouteError(t, response.status, body))
      const blocked = body?.blockedApps ?? []
      if (blocked.length > 0 && body?.deleted !== true) {
        // Nothing was changed that a refresh could show; a running app owns the
        // file we would rewrite, so the honest answer is "quit it and retry".
        setDeleteHint({ kind: 'app-running', accountId: account.accountId, accountName: account.accountName, apps: blocked })
        pushLog('warn', t('row.poolRowDeleteAppRunning', { accountName: account.accountName, apps: appLabels(blocked) }))
        setNow(Date.now())
        return
      }
      if (body?.deleted !== true) throw new Error(t('row.poolRowDeleteFailed'))
      // Drop the plugin's own membership preference for this account so a stale
      // `memberAccountIds` entry cannot resurrect it (single-writer rule).
      const wasMember = (saved.memberAccountIds ?? []).includes(account.accountId)
      let saveFailed = false
      if (wasMember) {
        if (!writable) {
          saveFailed = true
          setSaveError(t('row.poolSaveFailed', { message: t('row.poolLogSaveFailed') }))
          pushLog('error', t('row.poolLogSaveFailed'))
        } else {
          try {
            await persistRemoval(account.accountId)
          } catch (error: unknown) {
            saveFailed = true
            const message = error instanceof Error ? error.message : String(error)
            setSaveError(t('row.poolSaveFailed', { message }))
            pushLog('error', t('row.poolLogSaveFailed'))
          }
        }
      }
      setSelected(prev => { const next = new Set(prev); next.delete(account.accountId); return next })
      // A failed membership write is the whole outcome: the plugin copy is gone
      // but the saved preference still lists the account, so it comes back on the
      // next read. Logging "deleted" (or the sign-out hint) here would announce a
      // state the next poll immediately contradicts.
      if (!saveFailed) {
        if (body.stillSignedIn === true) {
          // A partial outcome: something still carries the account (an older Host
          // that never touches the app login, or a rewrite that did not verify).
          // Say which case rather than claiming a deletion that did not stick.
          // `hadCopy === false` means the account lives ONLY in the Trae app.
          const hadCopy = body.hadCopy !== false
          setDeleteHint({ kind: 'still-signed-in', accountId: account.accountId, accountName: account.accountName, hadCopy })
          pushLog('warn', t(hadCopy ? 'row.poolRowDeleteStillSigned' : 'row.poolRowDeleteNoCopy', { accountName: account.accountName }))
        } else {
          const signedOut = body.signedOutApps ?? []
          pushLog('ok', signedOut.length === 0
            ? t('row.poolRowDeleted', { accountName: account.accountName })
            : t('row.poolRowDeletedSignedOut', { accountName: account.accountName, apps: appLabels(signedOut) }))
        }
      }
      setNow(Date.now())
      if (!saveFailed) await onRefresh?.()
      // When the row itself vanished we cannot await a refresh that never comes;
      // when it stayed (desktop login) the refresh repaints it with the hint.
    } catch (error: unknown) {
      pushLog('error', t('row.poolRowDeleteError', { accountName: account.accountName, message: error instanceof Error ? error.message : String(error) }))
    } finally {
      if (mountRef.current) {
        setBusy(undefined)
        setDeletingIds(prev => {
          const next = new Set(prev)
          next.delete(account.accountId)
          return next
        })
      }
    }
  }

  const noCandidate = pool.noCandidate
  const showNoCandidate = pool.enabled && noCandidate !== undefined
  const serving = servingAccount(pool)
  /**
   * The batch buttons are disabled for reasons the user cannot see (they are not
   * under the pointer, so a `title` only helps after a hover). Name them here.
   */
  const actionNotes: string[] = []
  if (selected.size === 0) actionNotes.push(t('row.poolActionNoteNoMembers'))
  if (pool.targetModelSource === 'none') actionNotes.push(t('row.poolActionNoteTestNone'))

  return (
    <section className="dsm-trae-pool" aria-label={t('row.poolTitle')}>
      {/* The header is the title plus ONE answer to "who is billing?". With the
          pool off that answer is the manual picker — the control already carries
          the account name, so a badge repeating it would state the same fact
          twice in one row of pixels. With the pool on there is nothing to pick,
          so the slot falls back to the name. */}
      <div className="dsm-trae-pool-head">
        <h3 className="dsm-trae-pool-title">{t('row.poolTitle')}</h3>
        {pool.enabled !== true && onBind !== undefined
          ? <select
              className="dsm-trae-select dsm-trae-pool-account-select"
              aria-label={t('row.poolManualAccountLabel')}
              value={serving?.accountId ?? ''}
              disabled={bindingBusy === true || !writable}
              onChange={(event) => {
                const next = event.target.value
                if (next !== '') onBind(next)
              }}
            >
              {serving === undefined
                ? <option value="" disabled>{t('row.poolManualAccountNone')}</option>
                : null}
              {/* Only accounts this machine can actually bill: a ghost row
                  (saved, sign-in gone) has no credential, so binding it would
                  look like a click that did nothing. */}
              {pool.accounts
                .filter(account => account.reachable !== false)
                .map(account =>
                  <option key={account.accountId} value={account.accountId}>{account.accountName}</option>)}
            </select>
          : serving === undefined
            ? null
            : <span className="dsm-trae-pool-current">{t('row.poolCurrentHeader', { account: serving.accountName })}</span>}
      </div>

      {/* The mode switch, FIRST. It used to be the last row of the settings box —
          about a hundred lines below the member table whose every column changes
          meaning with it (「未入池」 only matters while the pool is what picks).
          This page has exactly two modes, "the pool picks" and "you pick"; the
          control that selects between them has to come before the mode-specific
          controls, not after all of them.

          It keeps the `dsm-trae-pool-settings` class on purpose: that is the
          settings-GROUP style (bordered, stacked rows). */}
      <div className="dsm-trae-pool-settings dsm-trae-pool-modebar">
        <div className="dsm-trae-pool-modebar-row">
          <label className="dsm-trae-switch dsm-trae-switch-pill">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy !== undefined || !writable}
              aria-label={t('row.poolEnabled')}
              onChange={(e) => { setEnabled(e.target.checked) }}
            />
          </label>
          <b className="dsm-trae-pool-modebar-label">{t('row.poolEnabled')}</b>
          {/* The RUNNING mode, not the draft: the switch shows the pending edit
              and the 「未保存」 chip beside it says that edit is pending, which
              leaves this chip free to answer the different question — what is
              the pool doing right now? Reading the draft here would label the
              page 「自动挑号」 while the saved pool was still off and the manual
              picker was still in charge. */}
          <span className="dsm-trae-pool-modebar-state">
            {pool.enabled === true ? t('row.poolModeAuto') : t('row.poolModeManual')}
          </span>
          {/* Unsaved state sits beside the switch because the switch is the first
              thing a user can dirty. It used to hang on the settings heading,
              i.e. below everything it warned about. */}
          {dirty ? <span className="dsm-trae-pool-dirty" role="status">{t('row.poolDirty')}</span> : null}
        </div>
        {/* ONE line, and only one. The same paragraph used to stand under the
            switch at the bottom of the page as well, which read as a developer
            note that had leaked into the card. */}
        <p className="dsm-trae-pool-note">{t('row.poolEnabledHint')}</p>
      </div>

      {/* "Billing now" and "in the pool" are orthogonal, and a row cannot say
          both without looking self-contradictory. The explanation has to exist
          SOMEWHERE, so it goes here — in one line, and only in the state that
          needs it. */}
      {pool.enabled === true && serving !== undefined && serving.member !== true
        ? <p className="dsm-trae-pool-note dsm-trae-pool-serving-note" role="status">
            {t('row.poolServingOutside', { account: serving.accountName })}
          </p>
        : null}

      {saved.enabled === true && enabled === false
        ? <p className="dsm-trae-pool-off-notice" role="status">{t('row.poolOffNotice')}</p>
        : null}

      {/* Failover needs somewhere to go. A pool whose members are all excluded
          (or that has none) reports the failure instead of retrying, so say so
          here — above the member list, before the user starts ticking boxes. */}
      {showNoCandidate ? <NoCandidateNotice noCandidate={noCandidate} t={t} /> : null}

      {/* Membership table. Ghost members keep rendering as checked rows. */}
      <div className="dsm-trae-pool-card">
        <div className="dsm-trae-pool-card-head">
          <h3 className="dsm-trae-pool-card-title">{t('row.poolMembersTitle')}</h3>
          <div className="dsm-trae-pool-card-tools">
            <span className="dsm-trae-pool-count">{t('row.poolSelectedCount', { count: selected.size, total: pool.accounts.length + ghosts.length })}</span>
            <button type="button" className="dsm-btn dsm-btn-outline" disabled={busy !== undefined} onClick={selectAll}>{t('row.poolSelectAll')}</button>
            <button type="button" className="dsm-btn dsm-btn-outline" disabled={busy !== undefined} onClick={selectNone}>{t('row.poolSelectNone')}</button>
          </div>
        </div>
        {/* The batch bar sits HERE — under the member heading, above the rows —
            because every button on it acts on the set that heading describes:
            「已选 N / M」 and 全部 / 清空 are one line above, the checkboxes they
            count are one line below. It used to stand ABOVE the whole member
            block, where it read as a page-level toolbar and had the buttons
            asking "act on WHICH accounts?" a full block before the control that
            answers it.

            The batch check-in button is still absent on purpose: Trae allows ONE
            check-in per DEVICE per day, so after this machine spent its claim
            the button could only ever be disabled for the rest of the day — a
            permanent dead control. The per-account claim in the table below is
            the remaining path.

            Why both buttons are dead is stated right under them: the reason was
            once an amber banner above the member table, a whole screen away from
            the buttons it explained. */}
        <div className="dsm-trae-pool-actions">
          <button
            type="button"
            className="dsm-btn dsm-btn-outline dsm-trae-pool-action-test"
            disabled={busy !== undefined || selected.size === 0 || pool.targetModelSource === 'none'}
            title={pool.targetModelSource === 'none' ? t('row.poolTargetNoneHint') : undefined}
            onClick={() => { void runTest() }}
          >
            {busy === 'test' ? t('row.poolTesting') : t('row.poolTestAll')}
          </button>
          {(busy === 'test' || testing !== undefined)
            ? <span className="dsm-trae-pool-busy" role="status">{t('row.poolBusyHint')}</span>
            : null}
          {topActions === undefined ? null : <span className="dsm-trae-pool-actions-end">{topActions}</span>}
        </div>
        {actionNotes.length === 0 ? null : <p className="dsm-trae-pool-action-note">{actionNotes.join(' · ')}</p>}
        <div className={pool.checkinSupported ? 'dsm-trae-pool-table' : 'dsm-trae-pool-table dsm-trae-pool-table-no-checkin'} role="table" aria-label={t('row.poolMembersTitle')}>
          <MemberRowHeader t={t} checkinSupported={pool.checkinSupported} />
          {pool.accounts.map(account => (
            <MemberRow
              key={account.accountId}
              account={account}
              showCheckin={pool.checkinSupported}
              deviceClaimed={deviceClaimed}
              models={models}
              rows={rows}
              checked={selected.has(account.accountId)}
              poolEnabled={pool.enabled === true}
              poolModelId={pool.targetModelId ?? ''}
              detail={details?.[account.accountId]}
              claim={claims?.[account.accountId]}
              onClaim={onClaim}
              onToggle={() => { toggleMember(account.accountId) }}
              onTest={() => { void runSingleTest(account) }}
              t={t}
              disabled={busy !== undefined || !writable}
              deleting={deletingIds.has(account.accountId)}
              onDelete={() => { void deleteAccount(account) }}
              canDelete={pool.deleteSupported === true}
              formatNumber={formatNumber}
              relativeAt={relativeAt}
            />
          ))}
          {ghosts.map(ghost => (
            <MemberGhostRow
              key={`ghost:${ghost.accountId}`}
              ghost={ghost}
              showCheckin={pool.checkinSupported}
              checked={selected.has(ghost.accountId)}
              onToggle={() => { toggleMember(ghost.accountId) }}
              t={t}
              disabled={busy !== undefined || !writable}
              deleting={deletingIds.has(ghost.accountId)}
              onDelete={() => { void deleteAccount(ghost) }}
              canDelete={pool.deleteSupported === true}
            />
          ))}
        </div>
        {ghosts.length > 0
          ? <p className="dsm-trae-pool-ghost-note" role="status">
              {t('row.poolGhostMembers', { count: ghosts.length, names: ghosts.map(g => g.accountName).join('、') })}
            </p>
          : null}
        {deleteHint?.kind === 'still-signed-in'
          ? <p className="dsm-trae-pool-delete-hint" role="status">
              {t(
                deleteHint.hadCopy ? 'row.poolDeleteStillSigned' : 'row.poolDeleteNoCopy',
                { accountName: deleteHint.accountName },
              )}
            </p>
          : null}
        {deleteHint?.kind === 'app-running'
          ? <p className="dsm-trae-pool-delete-hint dsm-trae-pool-delete-hint-action" role="status">
              {t('row.poolDeleteAppRunning', { accountName: deleteHint.accountName, apps: appLabels(deleteHint.apps) })}
            </p>
          : null}
        {dirty ? <p className="dsm-trae-pool-unsaved" role="status">{t('row.poolUnsavedMembers')}</p> : null}
      </div>

      {/* Settings block: account management, then a subheading and one bordered
          box of label+hint rows with the control on the right — the same shape
          the WorkBuddy card uses, so a reader who knows one card can read the
          other. */}
      <div className="dsm-trae-pool-settings-wrap">
        {/* Account management FIRST — ABOVE the subheading, not under it.

            Everything below that heading is a DRAFT that only takes effect when
            「保存」 is pressed (the note under the heading says exactly that),
            while the transfer buttons apply immediately. A control that acts at
            once must not live inside a block that promises "点保存才生效": a user
            who reads the note first waits for a button that was never needed,
            and one who clicks first is surprised the table changed on its own. */}
        {tools === undefined ? null : <div className="dsm-trae-pool-tools dsm-trae-pool-tools-dashed">{tools}</div>}
        <div className="dsm-trae-pool-head">
          <h3 className="dsm-trae-pool-title">{t('row.poolSettingsTitle')}</h3>
        </div>
        {/* Reference text, folded. Three paragraphs used to sit here as a wall of
            grey — where the copies live, when settings take effect, what Delete
            does — and they pushed the two real controls below them off the first
            screen. A <details> keeps them one click away without dressing them up
            as controls; nothing was cut, the copy path included ("the plugin keeps
            a real copy" is a claim, "these two ids live in this file right now" is
            something the user can open with an editor). The path renders only when
            the Host reports it, so an older Host says nothing rather than showing
            a stale one. */}
        <details
          className="dsm-trae-pool-more"
          open={moreRulesOpen}
          onToggle={(event: SyntheticEvent<HTMLDetailsElement>) => setMoreRulesOpen(event.currentTarget.open)}
        >
          <summary className="dsm-trae-pool-more-summary">{t('row.poolMoreRulesTitle')}</summary>
          <div className="dsm-trae-pool-more-body">
            {pool.copies === undefined
              ? null
              : <p className="dsm-trae-pool-note" role="note">
                  {t('row.poolCopyFile', { path: pool.copies.path, count: pool.copies.count })}
                </p>}
            <p className="dsm-trae-pool-note">{t('row.poolSettingsNote')}</p>
            <p className="dsm-trae-pool-note">{t('row.poolDeleteHint')}</p>
          </div>
        </details>
        <div className="dsm-trae-pool-settings">
        {/* The 「启用账号池」 switch is NOT here any more: it is the page's mode
            selector and now stands directly under the title (see the mode bar).
            What remains below are the two settings a manual TEST needs, which is
            why they stay reachable with the pool off. */}
        <div className="dsm-trae-pool-set">
          <span className="dsm-trae-pool-set-copy">
            <b>{t('row.poolTargetLabel')}</b>
            <span>{t('row.poolTargetHint')}</span>
          </span>
          <span className="dsm-trae-pool-set-ctl">
          <select
            className="dsm-trae-select"
            aria-label={t('row.poolTargetLabel')}
            value={targetModelId}
            disabled={busy !== undefined || !writable}
            onChange={(e) => { setTargetModelId(e.target.value) }}
          >
            <option value="">{t('row.poolTargetAutoOption')}</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            {pool.targetModelSource === 'stale' && pool.staleTargetModelId !== undefined
              ? <option value={pool.staleTargetModelId}>{t('row.poolTargetStaleOption', { model: pool.staleTargetModelId })}</option>
              : null}
          </select>
          </span>
        </div>
        {pool.targetModelSource === 'stale'
            ? <div className="dsm-trae-pool-target-stale" role="status">
                <span>{t('row.poolTargetStale', { model: pool.staleTargetModelId ?? '' })}</span>
                <button
                  type="button"
                  className="dsm-btn dsm-btn-outline"
                  disabled={busy !== undefined}
                  onClick={() => { setTargetModelId(''); pushLog('info', t('row.poolLogTargetCleared')) }}
                >
                  {t('row.poolTargetStaleClear')}
                </button>
              </div>
            : null}
          {pool.targetModelSource === 'none'
            ? <p className="dsm-trae-pool-target-none" role="status">{t('row.poolTargetNone')} — {t('row.poolTargetNoneHint')}</p>
            : null}

        {probeSupported
          ? <div className="dsm-trae-pool-set">
          <span className="dsm-trae-pool-set-copy">
            <b>{t('row.poolProbeSizeLabel')}</b>
            <span>{t('row.poolProbeSizeHint')}</span>
          </span>
          <span className="dsm-trae-pool-set-ctl">
            <select
              className="dsm-trae-select"
              aria-label={t('row.poolProbeSizeLabel')}
              value={String(probeInputTokens)}
              disabled={busy !== undefined || !writable}
              onChange={(e) => { setProbeInputTokens(Number(e.target.value)) }}
            >
              {PROBE_INPUT_TOKEN_CHOICES.map(choice => (
                <option key={choice} value={String(choice)}>
                  {choice === 0
                    ? t('row.poolProbeSizeDefault')
                    : t('row.poolProbeSizeOption', { wan: choice / 10_000 })}
                </option>
              ))}
            </select>
          </span>
        </div>
          : null}

        {/* The problem, if the last save failed. Inside the box: it belongs to the
            thing that failed to be written. */}
        {saveError === undefined ? null : <p className="dsm-trae-pool-save-error" role="alert">{saveError}</p>}
        </div>

        {/* Save bar OUTSIDE the preference box, on the line below it: the two
            buttons apply to everything above, so they must not look like a row of
            the box they would be the last row of. Deliberately the same bar the
            models section ends with — one card, one way to save. */}
        <div className="dsm-trae-pool-save-row">
          <a
            className="dsm-trae-usage-cheer"
            href="https://github.com/dingminhua/dsh-connect-trae"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('row.cheer')}
            <span className="dsm-trae-usage-cheer-star" aria-hidden="true">★</span>
          </a>
          <div className="dsm-trae-pool-save-buttons">
            <button type="button" className="dsm-btn dsm-btn-outline" disabled={!dirty || busy !== undefined} onClick={discard}>{t('row.poolDiscard')}</button>
            <button type="button" className="dsm-btn dsm-btn-primary" disabled={!dirty || busy !== undefined} onClick={() => { void save() }}>
              {busy === 'save' ? t('row.poolSaving') : t('row.poolSaved')}
            </button>
          </div>
        </div>
      </div>

      {/* Activity log. */}
      <ActivityLog log={log} t={t} now={now} relativeAt={relativeAt} onClear={() => setLog([])} />
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Small presentational helpers, kept in this file so the component is *
 * unit-testable without pulling in the whole card.                    *
 * ------------------------------------------------------------------ */

function NoCandidateNotice({ noCandidate, t }: { noCandidate: TraeWebPoolExclusion | 'empty'; t: T }): ReactElement {
  if (noCandidate === 'empty') {
    return (
      <div className="dsm-trae-pool-warning dsm-trae-pool-warning-empty" role="status">
        <span className="dsm-trae-pool-warning-title">{t('row.poolNoCandidateEmpty')}</span>
        <span className="dsm-trae-pool-warning-hint">{t('row.poolNoCandidateEmptyHint')}</span>
      </div>
    )
  }
  return (
    <div className="dsm-trae-pool-warning dsm-trae-pool-warning-unusable" role="status">
      <span className="dsm-trae-pool-warning-title">{t('row.poolNoCandidateUnusable')}</span>
      <span className="dsm-trae-pool-warning-hint">
        {t('row.poolNoCandidateHint')} {exclusionLabel(noCandidate, t)}
      </span>
    </div>
  )
}

function MemberRowHeader({ t, checkinSupported }: { t: T; checkinSupported: boolean }): ReactElement {
  return (
    <div className="dsm-trae-pool-row dsm-trae-pool-row-head" role="row">
      <span className="dsm-trae-pool-col-account">{t('row.poolColumnAccount')}</span>
      <span>{t('row.poolColumnCredits')}</span>
      <span>{t('row.poolColumnProbe')}</span>
      {checkinSupported ? <span>{t('row.poolColumnCheckin')}</span> : null}
      <span />
    </div>
  )
}

interface MemberRowProps {
  account: TraeWebPoolAccount
  /**
   * Whether this table has a check-in column at all.
   *
   * A row must render exactly as many cells as `--dsm-trae-pool-cols` declares:
   * an extra cell does not shrink, it wraps the action buttons onto a second
   * grid line, which is how a five-column row looked on a four-column table.
   */
  showCheckin: boolean
  /**
   * The pool already knows the DEVICE spent today's claim (see
   * {@link AccountPoolProps.deviceClaimed}). A row that is not itself claimed
   * must say so instead of 「未签到」, which would read as "you can still claim
   * this one" right next to a disabled button.
   */
  deviceClaimed: boolean
  models: readonly TraeWebModel[]
  rows: Readonly<Record<string, TraePoolTestRowView>>
  checked: boolean
  /**
   * Whether the pool is on, which decides whether a `current` row may be tinted
   * as the pool's own pick.
   *
   * With the pool ON the Host answers `current` with the account its ROTATION
   * picked, and falls back to the saved selection when the pool holds no member
   * to pick. Presenting that fallback as the pool's answer claimed a removed
   * account while the notice above the table said "no pool members are selected
   * yet" — two lines contradicting each other on one screen. The tint therefore
   * only names a row that can actually be the rotation's answer.
   */
  poolEnabled: boolean
  /**
   * The pool's saved target model (`''` when it resolves one itself), so the
   * probe cell only reprints a model name when it differs from that choice.
   */
  poolModelId: string
  detail?: TraePoolRowDetail | undefined
  claim?: TraePoolRowClaim | undefined
  onClaim?: ((accountId: string) => void) | undefined
  onToggle: () => void
  onTest: () => void
  t: T
  disabled: boolean
  deleting: boolean
  onDelete: () => void
  canDelete: boolean
  formatNumber: (value: number) => string
  relativeAt: (at: number, now: number, t: T) => string
}

function MemberRow({ account, models, rows, checked, onToggle, onTest, t, disabled, deleting, onDelete, canDelete, formatNumber, relativeAt, detail, claim, onClaim, showCheckin, deviceClaimed, poolEnabled, poolModelId }: MemberRowProps): ReactElement {
  /**
   * Whether this row is the one billing the next request — and, with the pool on,
   * whether that claim is the pool's own.
   *
   * `account.current` alone is not enough: with an empty (or fully excluded) pool
   * the Host deliberately falls back to the saved selection, so a removed account
   * stays `current` and the pill would keep announcing it as the pool's pick.
   * A row can only be the rotation's answer while it is a member.
   */
  const isCurrent = account.current === true && (poolEnabled !== true || account.member === true)
  // `reachable:false` means this machine holds neither a copy nor a sign-in.
  // Anything that needs a credential (test, check-in) is a guaranteed failure.
  const hasCopy = account.reachable
  // NON-NEGOTIABLE #7: show General as the number (what chat spends); never
  // rank/display `available` (the wider sum) as "credits".
  const credit = account.generalAvailable
  const excluded = account.excludedBy
  const checkin = account.checkedInToday
  const device = account.deviceCheckedIn
  const testRow = rows[account.accountId]
  /**
   * Whether the probe column already explains WHY this row is excluded.
   *
   * The exclusion tag and the probe cell are derived from the same verdict, so a
   * row that shows both says 「登录凭据被拒」 twice, six centimetres apart. Keep
   * the tag only for the case the cell cannot cover: no probe to show at all
   * (e.g. a stored member whose last test predates this session).
   */
  const probeOnScreen = testRow !== undefined || account.probe !== undefined

  return (
    <div className={`dsm-trae-pool-row${isCurrent ? ' dsm-trae-pool-row-current' : ''}`} role="row" data-account-id={account.accountId}>
      {/* Account: draft checkbox + status dot + current badge + in-pool tag + exclusion. */}
      <div className="dsm-trae-pool-account">
        <label className="dsm-trae-pool-check">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
            aria-label={t('row.poolSelectAria', { accountName: account.accountName })}
          />
        </label>
        <span className="dsm-trae-pool-account-name">
          {/* A row with no local copy must not get the healthy green dot: the
              dot is the first thing scanned, and green next to 「本机无副本」
              is a contradiction the label cannot undo. */}
          <span className={`dsm-trae-pool-dot dsm-trae-pool-dot-${account.reachable === false ? 'ghost' : excluded ? 'excluded' : 'ok'}`} aria-hidden="true" />
          {/* A row whose name never got measured (a member saved before the
              plugin recorded names) must NOT render as an empty cell: the id is
              the only handle the user has on it, and a blank row reads as a
              broken copy rather than as a stale member to delete. */}
          <b>{account.accountName !== '' ? account.accountName : account.accountId}</b>
          {/* edition · credential source, and the countdown that ends automatic
              renewal. Both used to live in the roster table this section
              replaces, so leaving them out would have been a silent loss of the
              only warning that a token is about to die. */}
          {detail?.meta === undefined ? null : <span className="dsm-trae-pool-meta">{detail.meta}</span>}
          {detail?.warn === undefined
            ? null
            : <span className={`dsm-trae-pool-warn-tag dsm-trae-pool-warn-tag-${detail.warnTone ?? 'soon'}`} role="status">{detail.warn}</span>}
        </span>
        <span className="dsm-trae-pool-account-tags">
          {/* 「派单中」 is NOT here any more. It used to share this line with
              「未入池」, and the pair is self-contradictory by construction: an
              account can be billing right now (the Host fell back to the saved
              selection) while not being a rotation member. The same line also
              sits under a count of 「已选 0 / 1」, which made a correct state read
              as a bug. Who bills is now answered ONCE, in the header, with a
              one-line note under the mode bar for the case the two disagree; the
              row keeps the membership in words, and `isCurrent` still tints it
              so the billing row stays findable at a glance. */}
          {/* Membership is stated in WORDS on every row, and it follows the
              DRAFT (the checkbox), never the saved list: an unchecked row that
              still says 「已在池中」 is the one contradiction a user cannot
              resolve. It is also what makes an unselected row look different
              from a selected one at a glance — a tick alone is 13 pixels of
              difference in a five-column table. */}
          <span className={checked ? 'dsm-trae-pool-member' : 'dsm-trae-pool-not-member'}>
            {checked ? t('row.poolMember') : t('row.poolNotMember')}
          </span>
          {account.reachable === false
            ? <span className="dsm-trae-pool-tag dsm-trae-pool-tag-ghost" role="status">{t('row.poolNoCopyTag')}</span>
            : null}
          {excluded && !probeOnScreen
            ? <span className="dsm-trae-pool-tag dsm-trae-pool-tag-excluded">{exclusionLabel(excluded, t)}</span>
            : null}
          {/* A lapsed access token explains the empty credit cell: the balance
              is not zero, it is unreadable until the user signs in again. */}
          {account.tokenExpired === true && excluded !== 'credential-rejected'
            ? <span className="dsm-trae-pool-warn-tag dsm-trae-pool-warn-tag-lapsed">{t('row.poolTokenExpired')}</span>
            : null}
        </span>
        {/* Absolute time of the last probe. The model cell says how long ago;
            this says when, which is what people compare across rows. */}
        {account.probe?.atMs === undefined
          ? null
          : <span className="dsm-trae-pool-account-note">{t('row.poolProbeAt', { when: shortWhen(account.probe.atMs) })}</span>}
      </div>

      {/* Credit: the General bucket. Work is only a hint (never shown as the number). */}
      {/* The column header already says 「通用积分」, so repeating 「通用」 under
          every number was the same word twice in one cell. The tooltip keeps the
          explanation one hover away. */}
      <div className="dsm-trae-pool-credit" title={t('row.poolWorkHint')}>
        <span className="dsm-trae-pool-credit-num">{credit === undefined ? t('row.poolCreditNone') : formatNumber(credit)}</span>
        {credit === undefined || account.nearestExpiryMs === undefined
          ? null
          : <span className="dsm-trae-pool-credit-meta">{t('row.poolCreditExpiry', { when: shortDate(account.nearestExpiryMs) })}</span>}
      </div>

      {/* Probe result. */}
      <div className="dsm-trae-pool-probe">
        {testRow !== undefined
          ? <ProbeResult outcome={testRow.outcome} modelId={testRow.modelId} atMs={undefined} source={undefined} t={t} relativeAt={relativeAt} now={Date.now()} detail={testRow.detail} poolModelId={poolModelId} />
          : account.probe !== undefined
            ? <ProbeResult outcome={account.probe.outcome} modelId={account.probe.modelId} atMs={account.probe.atMs} source={account.probe.source} t={t} relativeAt={relativeAt} now={Date.now()} detail={account.probe.message} poolModelId={poolModelId} />
            : <span className="dsm-trae-pool-probe-none">{t('row.poolNeverTested')}</span>}
      </div>

      {/* Check-in column (only when the panel supports it). */}
      {showCheckin ? <div className="dsm-trae-pool-checkin">
        <span className={`dsm-trae-pool-checkin-state dsm-trae-pool-checkin-${checkin === undefined ? 'unknown' : checkin ? 'ok' : device === true || deviceClaimed ? 'device' : 'no'}`}>
          {checkin === undefined
            ? t('row.poolCheckinUnknown')
            : checkin ? t('row.poolCheckedIn')
              : device === true || deviceClaimed ? t('row.poolDeviceUsed') : t('row.poolNotCheckedIn')}
        </span>
        {/* Only an ACTION belongs here. Once this account is claimed — or this
            machine already spent the day's check-in — a greyed "already
            claimed" button is a dead control repeating the line above it. */}
        {claim === undefined || onClaim === undefined || claim.claimable === false
          ? null
          : <button
              type="button"
              className="dsm-btn dsm-btn-outline dsm-trae-pool-claim"
              disabled={claim.disabled || disabled}
              title={claim.title}
              onClick={() => { onClaim(account.accountId) }}
            >
              {claim.label}
            </button>}
      </div> : null}

      {/* Row actions: Test / Delete. */}
      {/* Delete is the ONE destructive action on a row: it erases this plugin's
          OWN credential copy (Trae's desktop login is left alone). There is no
          separate 「移除」 any more — a second, softer removal that only edited the
          membership draft was a fork in the road the user could not read, and it
          was the one they kept reporting as broken. */}
      <div className="dsm-trae-pool-row-actions">
        {/* A row with no local copy has nothing to test: the Host answers
            「no stored credential for this account」, which the card renders as
            「登录凭据被拒」 — a rejection that never happened. Disable the button
            and say why instead of offering an action that can only fail. */}
        <button
          type="button"
          className="dsm-btn dsm-btn-outline"
          disabled={disabled || hasCopy === false}
          title={hasCopy === false ? t('row.poolNoCopyTestHint') : undefined}
          onClick={onTest}
        >{t('row.poolRowTest')}</button>
        {/* A Host that cannot delete (legacy, no deleteAccountOf) must not render
            a button whose only outcome is a 503; `canDelete` mirrors that. */}
        {canDelete
          ? <button
              type="button"
              className="dsm-btn dsm-btn-outline-danger dsm-trae-pool-delete"
              disabled={disabled || deleting}
              aria-label={t('row.poolRowDeleteAria', { accountName: account.accountName })}
              onClick={onDelete}
            >
              {deleting ? t('row.poolRowDeleting') : t('row.poolRowDelete')}
            </button>
          : null}
      </div>
    </div>
  )
}

interface MemberGhostRowProps {
  ghost: { accountId: string; accountName: string }
  /** Same rule as {@link MemberRowProps.showCheckin}: cell count must match the columns. */
  showCheckin: boolean
  checked: boolean
  onToggle: () => void
  t: T
  disabled: boolean
  deleting: boolean
  onDelete: () => void
  canDelete: boolean
}

function MemberGhostRow({ ghost, checked, onToggle, t, disabled, deleting, onDelete, canDelete, showCheckin }: MemberGhostRowProps): ReactElement {
  return (
    <div className="dsm-trae-pool-row dsm-trae-pool-row-ghost" role="row" data-account-id={ghost.accountId}>
      <div className="dsm-trae-pool-account">
        <label className="dsm-trae-pool-check">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
            aria-label={t('row.poolSelectAria', { accountName: ghost.accountName })}
          />
        </label>
        <span className="dsm-trae-pool-account-name">
          <span className="dsm-trae-pool-dot dsm-trae-pool-dot-ghost" aria-hidden="true" />
          {ghost.accountName}
        </span>
        <span className="dsm-trae-pool-account-tags">
          <span className={checked ? 'dsm-trae-pool-member' : 'dsm-trae-pool-not-member'}>
            {checked ? t('row.poolMember') : t('row.poolNotMember')}
          </span>
          <span className="dsm-trae-pool-tag dsm-trae-pool-tag-ghost">{t('row.poolExcludedUnusable')}</span>
        </span>
      </div>
      {/* A ghost has no live credit / probe — deleting it (or the stale
          membership that keeps it here) is the point. */}
      <div className="dsm-trae-pool-credit"><span className="dsm-trae-pool-credit-num">{t('row.poolCreditNone')}</span></div>
      <div className="dsm-trae-pool-probe"><span className="dsm-trae-pool-probe-none">{t('row.poolNeverTested')}</span></div>
      {showCheckin
        ? <div className="dsm-trae-pool-checkin"><span className="dsm-trae-pool-checkin-state dsm-trae-pool-checkin-unknown">{t('row.poolCheckinUnknown')}</span></div>
        : null}
      <div className="dsm-trae-pool-row-actions">
        {canDelete
          ? <button
              type="button"
              className="dsm-btn dsm-btn-outline-danger dsm-trae-pool-delete"
              disabled={disabled || deleting}
              aria-label={t('row.poolGhostDeleteAria', { accountName: ghost.accountName })}
              onClick={onDelete}
            >
              {deleting ? t('row.poolRowDeleting') : t('row.poolRowDelete')}
            </button>
          : null}
      </div>
    </div>
  )
}

interface ProbeResultProps {
  outcome: TraeWebPoolOutcome
  modelId?: string | undefined
  atMs?: number | undefined
  source?: 'test-batch' | 'live-request' | undefined
  detail?: string | undefined
  /**
   * The pool's SAVED target model (`pool.targetModelId`), or `''` when the pool
   * resolves one itself.
   *
   * The model used to be reprinted under every row unconditionally, which made
   * the same name appear three times on one screen: on the 「目标测速模型」
   * control, in the column header, and again here. The header no longer claims
   * to name a model (it says 「状态」), and this line now speaks only when it has
   * something the other two do not: the probe ran against a DIFFERENT model than
   * the pool is set to — the case that looks like a bug and is not.
   */
  poolModelId: string
  t: T
  relativeAt: (at: number, now: number, t: T) => string
  now: number
}

function ProbeResult({ outcome, modelId, atMs, source, detail, poolModelId, t, relativeAt, now }: ProbeResultProps): ReactElement {
  const tone = outcome === 'ok' ? 'ok' : 'warn'
  // Compared against the SAVED resolution, not the draft: a model the user is
  // merely considering must not make every row suddenly reprint its id.
  const modelDiffers = modelId !== undefined && modelId !== poolModelId
  const sourceLabel = source === undefined ? '' : probeSourceLabel(source, t)
  return (
    <div className="dsm-trae-pool-probe-cell">
      <span className={`dsm-trae-pool-probe-outcome dsm-trae-pool-probe-${tone}`}>
        <span className="dsm-trae-pool-dot dsm-trae-pool-dot-ok" aria-hidden="true" />
        {outcomeLabel(outcome, t)}
      </span>
      {atMs === undefined
        ? null
        : <span className="dsm-trae-pool-probe-meta">{t('row.poolProbeMeasured', { when: relativeAt(atMs, now, t) })}</span>}
      {modelDiffers
        ? <span className="dsm-trae-pool-probe-meta">
            {t('row.poolProbeModel', { model: modelId })}
            {sourceLabel === '' ? '' : ` · ${sourceLabel}`}
          </span>
        : sourceLabel === ''
          ? null
          : <span className="dsm-trae-pool-probe-meta">{sourceLabel}</span>}
      {detail !== undefined && detail !== '' ? <span className="dsm-trae-pool-probe-detail">{detail}</span> : null}
    </div>
  )
}

interface ActivityLogProps {
  log: LogEntry[]
  t: T
  now: number
  relativeAt: (at: number, now: number, t: T) => string
  onClear: () => void
}

function ActivityLog({ log, t, now, relativeAt, onClear }: ActivityLogProps): ReactElement {
  return (
    <div className="dsm-trae-pool-log">
      <div className="dsm-trae-pool-log-head">
        <h4 className="dsm-trae-pool-subtitle">{t('row.poolLogTitle')}</h4>
        {log.length > 0 ? <button type="button" className="dsm-btn dsm-btn-outline" onClick={onClear}>{t('row.poolLogClear')}</button> : null}
      </div>
      {log.length === 0
        ? <p className="dsm-trae-pool-log-empty">{t('row.poolLogEmpty')}</p>
        : <ol className="dsm-trae-pool-log-list">
            {log.map(entry => (
              <li key={entry.id} className={`dsm-trae-pool-log-item dsm-trae-pool-log-${entry.tone}`}>
                <span className="dsm-trae-pool-log-text">{entry.text}</span>
              </li>
            ))}
          </ol>}
    </div>
  )
}