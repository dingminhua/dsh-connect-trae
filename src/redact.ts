/**
 * Redaction helpers for diagnostics that a user may paste into a public issue.
 *
 * A verification report is only useful if it can be shared, and it is only safe
 * to share if it carries no personal identifiers. Paths are the hard case:
 * `C:\Users\<real name>\AppData\Roaming\Trae CN\...` contains both a real
 * account name AND the single most diagnostic token in the whole report (the
 * Trae data directory spelling). Redacting the whole path would make the report
 * worthless; printing it whole would leak the user's name. So the user segment
 * is replaced and the meaningful tail is preserved.
 *
 * @module dsh-connect-trae/redact
 */

/**
 * Replace the user segment of a path with `<user>`, keeping the rest intact.
 *
 * Handles the shapes a Trae install can produce:
 *   - `C:\Users\<name>\...` and `C:\Documents and Settings\<name>\...` (Windows)
 *   - `/Users/<name>/...` and `/home/<name>/...` (macOS / Linux)
 *
 * Anything after that segment — edition directory, `User\globalStorage`,
 * `storage.json` — is preserved verbatim, because that is what a report is
 * actually read for. Cross-platform on purpose: the function is called by
 * Windows-focused diagnostics, but the same helpers run in tests and on other
 * hosts, and a report from the wrong platform must not leak either.
 */
export function maskUserPath(path: string): string {
  return String(path)
    // Windows: keep the drive and `Users\` prefix, drop the account name.
    .replace(/([A-Za-z]:\\Users\\)[^\\]+/i, '$1<user>')
    .replace(/([A-Za-z]:\\Documents and Settings\\)[^\\]+/i, '$1<user>')
    // POSIX: drop the first segment under /Users or /home.
    .replace(/^(\/(?:Users|home)\/)[^/]+/, '$1<user>')
}

/**
 * Describe a name by shape instead of by value: a character count, plus whether
 * it is purely numeric.
 *
 * This is the deliberate middle ground for account names. A Trae account name
 * is often a real name or a phone number, so it must never be printed; but the
 * report still needs to show that an account WAS resolved, and the shape
 * distinguishes a real nickname from a generated `用户<n>` id — which is the
 * only thing a reader needs to judge whether account discovery worked.
 */
export function describeNameShape(name: unknown): string {
  const text = String(name ?? '')
  return `${text.length} 字符${/^\d+$/.test(text) ? '，纯数字' : ''}`
}

/**
 * Describe an identifier by shape instead of by value.
 *
 * A device id (`x-device-id`) is a stable installation identifier and is
 * directly tied to the upstream's per-device rules, so it is never printed.
 * Its shape still proves which resolution path ran: a real `icube-dc` id is
 * 15 digits, while the fallback is a 32-character hex hash.
 */
export function describeIdShape(value: unknown): string {
  const text = String(value ?? '')
  if (text === '') return '(空)'
  return `${text.length} 位${/^\d+$/.test(text) ? '，纯数字' : '，含非数字'}`
}
