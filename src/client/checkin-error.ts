/**
 * Client-side reading of the check-in route's answer.
 *
 * Issue #89: Trae answers the claim endpoint with HTTP 200 and a NON-ZERO
 * business code for ordinary, transient conditions — most visibly `9074`
 * 「当前参与用户太多，请稍后再试」during brief server overload. The old card
 * folded every non-zero code into one red 11px「签到失败：Trae 拒绝了本次签到
 * （业务码 …）」line, which reads as a plugin fault and is easy to miss; and a
 * claim request had no timeout, so a hung upstream left the button spinning
 * forever. Together those are exactly the reported「点了签到没反应」. None of
 * them is a plugin bug.
 *
 * This module NAMES the conditions for what they are. It is pure and free of
 * browser globals so a test can drive every branch without rendering the card.
 */

/** Trae's business code for "too many participants, try again later". */
export const CHECKIN_BUSY_CODE = 9074

/** Bounded wait for the claim route; a hung request must not spin forever. */
export const CHECKIN_TIMEOUT_MS = 30_000

/**
 * Override used only by tests that need to observe the real abort path without
 * installing fake timers. Production always uses {@link CHECKIN_TIMEOUT_MS}.
 */
let timeoutOverride: number | undefined
export function checkinTimeoutMs(): number {
  return timeoutOverride ?? CHECKIN_TIMEOUT_MS
}
export function setCheckinTimeoutForTest(ms: number | undefined): void {
  timeoutOverride = ms
}

export interface ClaimNotice {
  /** Locale key carrying the user-facing sentence. */
  key: 'row.checkinBusy' | 'row.checkinTimeout' | 'row.checkinError'
  params?: Record<string, unknown>
  /**
   * `busy` / `timeout` are transient: a calmer, more readable treatment than
   * the small red error line that made #89 look like a dead button.
   */
  tone: 'error' | 'busy'
}

/** A temporary server-side overload — not a bad request and not a plugin bug. */
export function busyNotice(code: number | undefined): ClaimNotice | undefined {
  return code === CHECKIN_BUSY_CODE ? { key: 'row.checkinBusy', tone: 'busy' } : undefined
}

/** The claim route never answered within the bound. */
export function timeoutNotice(): ClaimNotice {
  return { key: 'row.checkinTimeout', tone: 'busy' }
}

/** A genuine refusal or transport failure, reported verbatim. */
export function errorNotice(message: string): ClaimNotice {
  return { key: 'row.checkinError', params: { message }, tone: 'error' }
}
