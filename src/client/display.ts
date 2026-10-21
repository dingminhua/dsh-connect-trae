/**
 * Formatting and verdict helpers shared by the card's sections.
 *
 * WHY THIS IS ITS OWN MODULE: the card's sections are separate components now
 * (`TraeAccountPanel`, plus the models and diagnostics blocks that stayed in
 * `TraeUsageCard`), and two of them need the same answers — "what does this
 * status dot look like", "does this credential need a re-sign-in warning".
 * A copy in each section is free to drift, and a user reading a red dot in the
 * account table and a grey one in the header would be told two things about one
 * account. There is exactly one implementation of each.
 *
 * @module dsh-connect-trae/client/display
 */

import type { TraeWebUsage } from '../status-paths.ts'
import type { TraeSettingsKey } from './locales.ts'

/** A group-separated integer, in the reader's own locale. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

/** A date and time, in the reader's own locale. */
export function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

/**
 * The colour of a status dot, as an inline style.
 *
 * Inline rather than a class because the colour IS the value (signed-in / error
 * / signed-out); a class per state would be three names that say the same thing.
 */
export function dotStyle(status: TraeWebUsage['status']): Record<string, string> {
  const color = status === 'signed-in'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d92d20)'
      : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  return { background: color }
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
export function refreshTokenWarning(
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
