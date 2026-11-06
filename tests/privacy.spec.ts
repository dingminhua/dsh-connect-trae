/**
 * The guard that stops a real account identity from reaching publication.
 *
 * History this test exists for: v4.10.0 shipped `docs/assets/*.png` in which the
 * maintainer's own Trae account names were rendered in plaintext, and the same
 * strings sat in the `tools/*-shot.tsx` fixtures that generate those images. The
 * images then went to GitHub, the marketplace and 80 npm versions. Nothing in
 * the test suite noticed, because nothing was looking at *fixture data* as
 * publication material.
 *
 * **The denylist is stored as SHA-256 hashes, not as the strings themselves.**
 * Writing the leaked values into the guard would put them back in a public
 * repository — a guard that reintroduces what it guards against is worse than no
 * guard. Hashes let the check stay exact without any readable identifier here.
 *
 * Two independent checks, because they fail in different ways:
 *
 *   1. **Denylist** — the exact identifiers that leaked. Cheap, and it fails
 *      loudly on the specific regression that actually happened.
 *   2. **Shape allowlist** — every `accountName` in a shot fixture must either
 *      come from `tools/demo-accounts.ts` or match an obviously synthetic shape.
 *      This is the part that catches a *future* real name, which the denylist
 *      cannot know about.
 *
 * The second check is why `tools/demo-accounts.ts` exists at all: a rule that
 * only says "don't" gets bypassed the moment someone needs a realistic-looking
 * row, so the sanctioned way to get one is one import away.
 *
 * @module tests/privacy
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const TOOLS = join(ROOT, 'tools')

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

/**
 * SHA-256 of every identifier that must never reappear. Add to this list rather
 * than removing from it — an entry here is a fact about a leak that already
 * happened. To extend it without learning a value, hash what you found:
 *
 *     node -e "console.log(require('crypto').createHash('sha256').update(ARG,'utf8').digest('hex'))"
 */
const FORBIDDEN_HASHES = new Set([
  '5a9cdc488ea69be20806c004f138b838fbeb7527f1fca2fd55da3fb5c7d44140', // real Trae account id
  'c4418d4952b21d630f70346ee11e038ee792ff99df162af949708e49e3db0f2e', // the same id, display-prefixed form
  'c8d5c3ee1b5322c78557eff8b56b2dfe008ea7ee60a9b141c44a26ba9d133783', // maintainer's Trae account name
  '2df1e8e4640cd4618df121b8b8cdaa0b37f471c7e3a17c50062d067e3b769007', // its international variant
  '4ce713c505b2544b3114740501040247b426d77b16ddade1d00e79eb97e39e86', // the truncation seen in a bug screenshot
  '412dcd2c163c865448ef8b4b90f4ed3aa5c503c706c77b3d4f47d932c1e7af70', // personal mailbox, local part
  '6d132a06f944cbe2661ee36d45e756fdfd76496046f557e324dc0926bef64220', // the holder's real personal name
  // The npm account name is deliberately NOT here: `npm whoami` docs have to be
  // able to state what a correct answer looks like, and the name is public on
  // the registry. What must not appear is that name as a *local user path*,
  // which is checked by PATH_LEAK below.
])

/**
 * Candidate strings to hash, at TWO granularities.
 *
 * Comparing whole tokens was not enough: OCR and prose glue neighbours on, so
 * `AP7520607992`, `用户7520607992的` and `(LaoDing)` all sailed past it even
 * though the identifier was right there. Splitting `<letters><digits>` apart
 * turns `AP7520607992` into `7520607992`, and splitting CJK from Latin turns
 * `LaoDing的` back into `LaoDing`.
 *
 * But splitting *only* that way breaks identifiers that legitimately mix the two
 * (`shangxinyu2002` becomes `shangxinyu` + `2002` and stops matching), so every
 * maximal alphanumeric run is ALSO hashed whole. Values are compared only as
 * hashes, so this file still carries no identifier in the clear.
 */
function segments(text: string): string[] {
  const runs = text.match(/[A-Za-z0-9\u4e00-\u9fa5]+/g) ?? []
  const parts = text.match(/[A-Za-z]+|[0-9]+|[\u4e00-\u9fa5]+/g) ?? []
  return [...runs, ...parts]
}

/** True if any known identifier appears anywhere in `text`, glued or not. */
function offendingSegments(text: string): string[] {
  return segments(text).filter(segment => FORBIDDEN_HASHES.has(sha256(segment)))
}

/**
 * A personal home directory is a local identity even when the account name
 * itself is public — `/Users/<name>/...` reveals the machine's user name and
 * directory layout, so the repo uses `/Users/<user>/` everywhere instead.
 *
 * The placeholder names below are sanctioned: single letters and `realname`
 * (which `redact.spec.ts` uses precisely to prove a real-looking name gets
 * masked). Anything else is a genuine personal path.
 */
const HOME_PLACEHOLDERS = new Set(['<user>', '<name>', 'x', 'u', 'test', 'realname'])
const PATH_LEAK = /\/(?:Users|home)\/([A-Za-z0-9._<>-]+)\//g

/**
 * The copyright holder's name is a denylist entry *and* the legally required MIT
 * attribution. Four files carry it by design; the attribution test below proves
 * it is still there. Everywhere else the phrase is stripped before scanning, so
 * a nickname sitting in prose is still caught.
 */
const ATTRIBUTION_EXEMPT = ['LICENSE', 'package.json', 'README.md', 'README.en.md']

/**
 * Files that are *supposed* to carry the maintainer's name, and only as
 * attribution. A tripwire: if this set grows, confirm the new file is
 * attribution and not a credential or a personal identifier.
 */
const ATTRIBUTION_FILES = ['LICENSE', 'package.json', 'README.md', 'README.en.md']

/**
 * Names allowed in a shot fixture's `accountName:` besides the demo imports.
 *
 * The CJK branch accepts a generated id only when its digits are visibly
 * sequential: `用户100000001` passes, while an arbitrary real one (which has
 * scattered digits) does not. An earlier version of this regex required the
 * literal run `111`, which never matched the demo constant, so the branch was
 * dead code.
 */
function isSyntheticName(name: string): boolean {
  return (
    /^demo-/i.test(name) ||
    // A generated id whose digits are visibly padded (`用户100000001`), not an
    // arbitrary real one whose digits are scattered.
    /^[\u4e00-\u9fa5]{2,4}1\d{7,}$/.test(name) ||
    // An obviously placeholder phone number.
    /^\d{3}\*{4}0{4}$/.test(name)
  )
}

function shotFixtures(): { file: string; text: string }[] {
  return readdirSync(TOOLS)
    .filter(name => /-shot\.tsx$/.test(name))
    .map(name => ({ file: name, text: readFileSync(join(TOOLS, name), 'utf8') }))
}

/**
 * Every text file in the repo, excluding `node_modules`, `.git` and the build
 * output in `lib/` (a compiled mirror of `src/`, so scanning it doubles the
 * runtime without adding coverage).
 */
function trackedTextFiles(): { file: string; text: string }[] {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'coverage', '.pnpm-store'])
  const EXTS = ['.md', '.ts', '.tsx', '.mjs', '.js', '.json', '.yml', '.yaml']
  const out: { file: string; text: string }[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!EXTS.some(ext => entry.name.endsWith(ext))) continue
      // This guard's own source only carries hashes; scanning it is still right,
      // because a future edit could paste a value back in.
      // `ROOT` ends with a separator, so slice exactly its length — slicing
      // `length + 1` ate the first character of every reported path.
      out.push({ file: full.slice(ROOT.length), text: readFileSync(full, 'utf8') })
    }
  }
  walk(ROOT)
  return out
}

/** Strip the npm scope form, which is public on the registry. */
function withoutAllowedForms(text: string): string {
  return text.replace(/@dmh2002\//g, '<npm-scope>')
}

/**
 * Strip copyright phrases: the holder's name there is required, not a leak.
 *
 * Covers both the plain sentence (`Copyright (c) 2026 <name>`) and the quoted
 * forms docs use when telling a maintainer what to verify, e.g.
 * `grep -F "Copyright (c) 2026 <name>" LICENSE`.
 */
function withoutCopyrightPhrases(text: string): string {
  // NOTE: JS `\w` is ASCII-only, so a CJK holder name needs an explicit range —
  // Python's `\w` is Unicode-aware and this regex silently under-matched before
  // that was fixed.
  return text.replace(/Copyright \(c\) \d{4} [\w\u4e00-\u9fa5]+/g, 'Copyright')
}

describe('privacy: shot fixtures are publication material', () => {
  it('contains none of the identifiers that already leaked', () => {
    const offenders: string[] = []
    for (const { file, text } of shotFixtures()) {
      if (offendingSegments(text).length > 0) offenders.push(`${file}: leaked identifier`)
    }
    expect(offenders).toEqual([])
  })

  it('never hardcodes a real account name in an accountName literal', () => {
    const sanctioned = new Set(['DEMO_NICKNAME', 'DEMO_NUMERIC_ID'])
    const offenders: string[] = []

    for (const { file, text } of shotFixtures()) {
      for (const match of text.matchAll(/accountName:\s*'([^']*)'/g)) {
        const name = match[1] as string
        if (sanctioned.has(name) || isSyntheticName(name)) continue
        offenders.push(`${file}: accountName '${name}'`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps every tracked text file free of leaked identifiers', () => {
    // Not just the fixtures: the first fix scanned `tools/` only and left the
    // truncated nickname sitting in CHANGELOG.md, which ships to npm. This walks
    // the whole working tree instead, so `tests/`, `docs/`, `src/` and the
    // scripts are covered too — those are public on GitHub even when they are
    // not in the tarball.
    const offenders: string[] = []
    for (const { file, text } of trackedTextFiles()) {
      // LICENSE / package.json / README* carry the copyright holder's name by
      // design; they are checked for that attribution in another test.
      if (ATTRIBUTION_EXEMPT.includes(file)) continue
      // This file necessarily discusses the patterns (and its own demo constants
      // appear in the shape test); the hash set it carries is not a leak.
      // Compare on the basename: `trackedTextFiles` yields platform separators.
      if (file.replace(/\\/g, '/').endsWith('tests/privacy.spec.ts')) continue
      const scrubbed = withoutCopyrightPhrases(withoutAllowedForms(text))
      if (offendingSegments(scrubbed).length > 0) offenders.push(`${file}: leaked identifier`)
      for (const match of text.matchAll(PATH_LEAK)) {
        const segment = match[1] as string
        if (HOME_PLACEHOLDERS.has(segment)) continue
        offenders.push(`${file}: personal home directory path (${match[0]})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never hardcodes a real account name in an accountName literal', () => {
    const sanctioned = new Set(['DEMO_NICKNAME', 'DEMO_NUMERIC_ID'])
    const offenders: string[] = []

    for (const { file, text } of shotFixtures()) {
      for (const match of text.matchAll(/accountName:\s*'([^']*)'/g)) {
        const name = match[1] as string
        if (sanctioned.has(name) || isSyntheticName(name)) continue
        offenders.push(`${file}: accountName '${name}'`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the shipped changelog free of leaked identifiers', () => {
    // CHANGELOG.md is in package.json `files`, so this text reaches every user.
    const changelog = withoutCopyrightPhrases(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'))
    expect(offendingSegments(changelog)).toEqual([])
  })

  it('keeps the real attribution intact in the files that must carry it', () => {
    // Replaces an earlier tautology that asserted a hardcoded array equalled
    // itself. This one reads the actual files: the copyright line has to still
    // be there, so a future "redact everything" sweep cannot strip the license.
    for (const rel of ATTRIBUTION_FILES) {
      const text = readFileSync(join(ROOT, rel), 'utf8')
      expect(text, `${rel} keeps its copyright line`).toMatch(/Copyright \(c\) \d{4} [\w\u4e00-\u9fa5]+/)
    }
  })
})

describe('privacy: the demo constants stay synthetic', () => {
  it('exposes no real-looking id and is importable by every shot', async () => {
    const demo = await import('../tools/demo-accounts.ts') as Record<string, unknown>
    const numeric = String(demo['DEMO_NUMERIC_ID'])
    const nickname = String(demo['DEMO_NICKNAME'])

    for (const value of [numeric, nickname]) {
      expect(FORBIDDEN_HASHES.has(sha256(value))).toBe(false)
    }
    // Shape must stay representative — the shots measure geometry with it.
    expect(numeric.length).toBeGreaterThanOrEqual(8)
    expect(nickname.length).toBeGreaterThanOrEqual(6)
  })
})
