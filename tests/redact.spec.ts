/**
 * Redaction helpers used by the Windows verification report.
 *
 * WHY THIS FILE EXISTS — read before weakening it:
 * `scripts/verify-windows.mjs` produces a report that the README invites users to
 * paste into a PUBLIC issue. Everything that report prints is therefore on the
 * open internet forever, and the values involved are the sensitive ones: paths
 * carry the real Windows account name, and the account/device identifiers are
 * tied to the user's Trae account and the upstream's per-device rules.
 *
 * The redaction only works if it is BOTH complete and non-destructive:
 *
 *  - complete: a real name (or a phone-number-shaped account) must not survive
 *    in any segment;
 *  - non-destructive: the Trae data directory spelling (`Trae CN` vs `trae-cn`)
 *    is the single most diagnostic token in the report — masking it away would
 *    make the report worthless, which is the failure mode that gets redaction
 *    ripped out later.
 *
 * A test that only asserts "the name is gone" would pass for a function that
 * returns `'<redacted>'` for everything, so the retention assertions below are
 * as load-bearing as the removal ones.
 */
import { describe, expect, it } from 'vitest'
import { describeIdShape, describeNameShape, maskUserPath } from '../src/redact.ts'

describe('maskUserPath', () => {
  it('removes the Windows account name but keeps the Trae directory spelling', () => {
    const masked = maskUserPath('C:\\Users\\DingMinHua\\AppData\\Roaming\\Trae CN\\User\\globalStorage\\storage.json')
    expect(masked).not.toContain('DingMinHua')
    expect(masked).toBe('C:\\Users\\<user>\\AppData\\Roaming\\Trae CN\\User\\globalStorage\\storage.json')
  })

  it('keeps the alternate spelling intact too', () => {
    // The whole point of the report is to learn WHICH spelling exists on a real
    // machine, so both must survive masking verbatim.
    const masked = maskUserPath('C:\\Users\\someone\\AppData\\Roaming\\trae-solo-cn\\User\\globalStorage\\storage.json')
    expect(masked).toContain('trae-solo-cn')
    expect(masked).not.toContain('someone')
  })

  it('masks the POSIX user segment as well', () => {
    // The script runs cross-platform (the plugin supports macOS and Linux), and
    // a report from the wrong platform must not leak either.
    expect(maskUserPath('/Users/realname/Library/Application Support/Trae CN/User/globalStorage/storage.json'))
      .toBe('/Users/<user>/Library/Application Support/Trae CN/User/globalStorage/storage.json')
    expect(maskUserPath('/home/realname/.trae-cn/trae-jwt-token'))
      .toBe('/home/<user>/.trae-cn/trae-jwt-token')
  })

  it('masks the legacy Windows profile root', () => {
    const masked = maskUserPath('C:\\Documents and Settings\\olduser\\AppData\\Roaming\\Trae\\User\\globalStorage\\storage.json')
    expect(masked).not.toContain('olduser')
    expect(masked).toContain('Trae\\User\\globalStorage')
  })

  it('leaves a path with no user segment untouched', () => {
    // No false positives: an already-synthetic path must pass through unchanged,
    // otherwise the report starts hiding things that were never sensitive.
    expect(maskUserPath('D:\\corp\\Trae CN\\User\\globalStorage\\storage.json'))
      .toBe('D:\\corp\\Trae CN\\User\\globalStorage\\storage.json')
  })

  it('does not mangle a name that merely contains "Users"', () => {
    // `/UsersGuide/...` is not a user home: the pattern is anchored to the
    // segment boundary, so this must not be rewritten.
    expect(maskUserPath('/UsersGuide/Trae CN/storage.json')).toBe('/UsersGuide/Trae CN/storage.json')
  })
})

describe('describeNameShape', () => {
  it('reports length and numeric-ness instead of the name', () => {
    // A real nickname and a generated `用户<phone>` id must be distinguishable
    // by shape — that is what tells a reader account discovery worked.
    const nickname = describeNameShape('LaoDing')
    expect(nickname).toBe('7 字符')
    expect(nickname).not.toContain('LaoDing')
    expect(describeNameShape('7520607992')).toBe('10 字符，纯数字')
  })

  it('never echoes the value for any input', () => {
    for (const value of ['丁敏华', 'real@example.com', 42, undefined, null]) {
      const shape = describeNameShape(value)
      expect(shape).toMatch(/^\d+ 字符/)
      if (typeof value === 'string' && value !== '') expect(shape).not.toContain(value)
    }
  })
})

describe('describeIdShape', () => {
  it('distinguishes the real device id from the hash fallback by shape', () => {
    // 15 digits = a real `iCubeAuthInfo://icube-dc:<id>` suffix; 32 hex = the
    // synthesized fallback. Telling them apart is the diagnostic value.
    expect(describeIdShape('999000111222333')).toBe('15 位，纯数字')
    expect(describeIdShape('8bc55d72beb6b9272ef9d467efa5f2c9')).toBe('32 位，含非数字')
  })

  it('reports an empty id explicitly', () => {
    expect(describeIdShape('')).toBe('(空)')
    expect(describeIdShape(undefined)).toBe('(空)')
  })

  it('never echoes the identifier', () => {
    const shape = describeIdShape('999000111222333')
    expect(shape).not.toContain('999000111222333')
  })
})
