/**
 * The client half of the account-pool TEST batch, shared by its two callers.
 *
 * ## Why this module exists
 *
 * The batch is addressable from two places now: the card's pool section
 * ("测试勾选的账号", where the membership checkboxes are) and the composer
 * credit popover's header (where a reader is already looking at the accounts).
 * Both drive the SAME route (`POST …/pool?action=test`), which answers NDJSON —
 * one line per account, streamed — and both must fold those lines identically.
 *
 * A second copy of that fold is how the two surfaces would drift: one teaches
 * itself a new line shape, the other keeps rendering the old one, and a user
 * sees two different outcomes for one batch depending on where they pressed.
 * So the parsing, the outcome vocabulary and the deadline live HERE, and the
 * two call sites keep only their own presentation.
 *
 * The card originally held these as file-private helpers. They moved without
 * behaviour changes; `tests/account-pool.spec.tsx` still pins the fold through
 * the card.
 *
 * ## What is deliberately NOT here
 *
 * The per-surface side effects: the card writes rows into its own table and
 * pushes a log line; the popover patches the usage document it already renders.
 * Those differ by design (one has a log, the other has five rows), and pulling
 * them in would make this module a component.
 */
import type { TraePoolTestRowView, TraeWebPoolOutcome } from '../status-paths.ts'
import type { TraeSettingsKey } from './locales.ts'

/** Localized copy injected by the browser-plugin registration. */
export type PoolTestTranslator = (key: TraeSettingsKey, params?: Record<string, unknown>) => string

/**
 * How long one `test` request may take before the caller gives up.
 *
 * A probe has its own upstream deadline, but a stalled connection (a restarting
 * Host, a dropped keep-alive) has none: without this the run button stays
 * disabled until the page is reloaded, which reads as "测速卡住了". Sized for a
 * full batch — a serial run with a gap between accounts — rather than for one
 * account, because aborting a healthy batch half way through would report the
 * members it never reached as failures.
 */
export const POOL_TEST_TIMEOUT_MS = 180_000

/** The shapes the route writes, one JSON object per line. */
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
export function applyTestLine(
  line: string,
  t: PoolTestTranslator,
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
 * whole body: with a slow probe the surface sat on "逐个处理账号中…" and looked
 * frozen (a single member could take half a minute). Reading the body stream
 * makes each finished account appear immediately, and an empty/failed stream
 * still ends the loop instead of hanging the busy state forever.
 */
export async function* testLinesOf(response: Response): AsyncGenerator<string> {
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

/** A human label for every value of {@link TraeWebPoolOutcome}. */
export function outcomeLabel(outcome: TraeWebPoolOutcome, t: PoolTestTranslator): string {
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
