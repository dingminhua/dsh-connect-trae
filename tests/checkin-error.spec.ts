import { describe, expect, it } from 'vitest'
import { busyNotice, CHECKIN_BUSY_CODE, CHECKIN_TIMEOUT_MS, errorNotice, timeoutNotice } from '../src/client/checkin-error.ts'

/**
 * Issue #89's reading rules live here, not in the card's JSX. Pin them at the
 * boundary so the distinction ("transient server overload" vs "a real refusal")
 * cannot be collapsed by a future copy edit.
 */
describe('check-in claim notices', () => {
  it('reads 9074 as a transient overload, not a hard failure', () => {
    expect(CHECKIN_BUSY_CODE).toBe(9074)
    expect(busyNotice(9074)).toEqual({ key: 'row.checkinBusy', tone: 'busy' })
  })

  it('does not treat other business codes as transient', () => {
    // 9004 really is a rejected request; 9095 is handled separately as the
    // device-already state. Neither may get the "busy, retry soon" wording.
    expect(busyNotice(9004)).toBeUndefined()
    expect(busyNotice(9095)).toBeUndefined()
    expect(busyNotice(undefined)).toBeUndefined()
    expect(busyNotice(0)).toBeUndefined()
  })

  it('has a bounded claim timeout with a distinct message', () => {
    expect(CHECKIN_TIMEOUT_MS).toBeGreaterThan(0)
    expect(timeoutNotice()).toEqual({ key: 'row.checkinTimeout', tone: 'busy' })
  })

  it('keeps a genuine refusal verbatim as an error', () => {
    expect(errorNotice('upstream exploded')).toEqual({
      key: 'row.checkinError',
      params: { message: 'upstream exploded' },
      tone: 'error',
    })
  })
})
