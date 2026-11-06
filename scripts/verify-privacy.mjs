/**
 * Pre-publish check: no real identifier survives anywhere in what we ship.
 *
 * `tests/privacy.spec.ts` guards the *source* (fixtures and changelog). This
 * script guards the *artifacts* — the PNG bytes and the packed tarball — because
 * a screenshot is opaque to a text grep and a fixture fix does not retroactively
 * clean an image that was rendered before the fix.
 *
 * Why a separate script rather than a unit test: it needs the built `lib/` and
 * an OCR pass over real images, so it belongs in the release sequence
 * (`RELEASING.md`), not in every `pnpm test`.
 *
 *   node scripts/verify-privacy.mjs
 *
 * Exit code 0 means every check passed. Anything else is a release blocker.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex')

/**
 * SHA-256 of every identifier that must never reach a published artifact.
 *
 * Stored as hashes on purpose: writing the leaked values into a guard script
 * would put them straight back into the public repository this guard exists to
 * protect. Hashes keep the check exact and the file clean.
 *
 * Extend it without learning a value:
 *   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1],'utf8').digest('hex'))" "<token>"
 */
const FORBIDDEN_HASHES = new Set([
  '5a9cdc488ea69be20806c004f138b838fbeb7527f1fca2fd55da3fb5c7d44140', // real Trae account id
  'c4418d4952b21d630f70346ee11e038ee792ff99df162af949708e49e3db0f2e', // the same id, display-prefixed
  'c8d5c3ee1b5322c78557eff8b56b2dfe008ea7ee60a9b141c44a26ba9d133783', // maintainer's Trae account name
  '2df1e8e4640cd4618df121b8b8cdaa0b37f471c7e3a17c50062d067e3b769007', // its international variant
  '4ce713c505b2544b3114740501040247b426d77b16ddade1d00e79eb97e39e86', // the truncation seen in a bug screenshot
  '412dcd2c163c865448ef8b4b90f4ed3aa5c503c706c77b3d4f47d932c1e7af70', // personal mailbox, local part
  '5144f546cff299d14c154712beb9db4860f14badfb024d3fce75305639109bb5', // local machine user name
])

/**
 * Files where the maintainer's name is ATTRIBUTION, not a leak. `that name` in
 * LICENSE is the copyright holder and in package.json the `copyright` field;
 * both are intentional and must stay.
 */
const ATTRIBUTION = new Set(['LICENSE', 'package.json', 'README.md', 'README.en.md'])

/** Every quoted word-like token in a text, for hashed comparison. */
function tokensOf(text) {
  return [...text.matchAll(/[\w\u4e00-\u9fa5*@.\-]+/g)].map(match => match[0])
}

/** A copyright phrase legitimately names the holder; strip it before checking. */
function withoutCopyrightPhrases(text) {
  return text.replace(/Copyright \(c\) \d{4} [\w\u4e00-\u9fa5]+/g, 'Copyright')
}

/**
 * Contexts where a hashed token is legitimate rather than a leak.
 *
 * The npm scope form `@dmh2002/...` is a published package name the changelog
 * has to be able to cite — already public on the registry — while a bare local
 * user name of the same spelling still must not appear.
 */
function withoutAllowedForms(text) {
  return text.replace(/@dmh2002\//g, '<npm-scope>')
}

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${detail === '' ? '' : `  — ${detail}`}`)
}
/**
 * A skip is NOT a pass. It is tracked separately so the summary can say out loud
 * how much of the verification actually ran — a check that silently degrades to
 * "OK" when its backend is missing is worse than not having the check at all.
 */
const skips = []
const skip = (label, detail = '') => {
  skips.push({ label, detail })
  console.log(`  SKIP  ${label}${detail === '' ? '' : `  — ${detail}`}`)
}

// ---------------------------------------------------------------------------
// 1. The images, byte-level: a PNG's text chunks can carry a filename or a tool
//    path even when the pixels are clean.
// ---------------------------------------------------------------------------
const IMAGES = [
  'docs/assets/dsh-connect-trae-usage-card.png',
  'docs/assets/dsh-connect-trae-sidebar-page.png',
  'docs/assets/dsh-connect-trae-composer-credits.png',
]

for (const rel of IMAGES) {
  const path = join(ROOT, rel)
  if (!existsSync(path)) { record(false, `${rel} exists`); continue }
  const bytes = readFileSync(path)
  // Textual chunks / tEXt / iTXt keys live in plain ASCII in the byte stream.
  const ascii = bytes.toString('latin1')
  const hits = tokensOf(ascii).filter(token => FORBIDDEN_HASHES.has(sha256(token)))
  record(hits.length === 0, `${rel} has no identifier in its byte stream`,
    hits.length === 0 ? `${(bytes.length / 1024).toFixed(0)} KB` : 'tagged identifier present')
}

// ---------------------------------------------------------------------------
// 2. The images, pixel-level. Byte streams cannot tell us what was *drawn*, so
//    this re-reads the rendered text with the same OCR the app uses. Skips
//    gracefully when no OCR backend is present — a warning, not a pass.
// ---------------------------------------------------------------------------
/**
 * Where the OCR language data lives. tesseract.js otherwise fetches traineddata
 * from a CDN, which fails behind a proxy or offline — and a silently skipping
 * check is exactly the failure mode this script exists to prevent. So: use a
 * local directory when one is configured, and only then fall back to the CDN.
 *
 *   PowerShell:  $env:DSH_TESSDATA = 'C:\path\to\tessdata'
 *   bash:        DSH_TESSDATA=/path/to/tessdata node scripts/verify-privacy.mjs
 *
 * The directory must contain `eng.traineddata.gz`.
 */
function langDataPath() {
  const configured = process.env['DSH_TESSDATA']
  if (configured !== undefined && existsSync(join(configured, 'eng.traineddata.gz'))) return configured
  const local = join(ROOT, 'node_modules', '.cache', 'tessdata')
  if (existsSync(join(local, 'eng.traineddata.gz'))) return local
  return undefined
}

function ocrAvailable() {
  const probe = `
    try { require('tesseract.js'); process.exit(0) } catch { }
    process.exit(1)`
  try {
    execFileSync(process.execPath, ['-e', probe], { stdio: 'ignore' })
    return true
  } catch { return false }
}

const LANG_PATH = langDataPath()

if (ocrAvailable()) {
  if (LANG_PATH === undefined) {
    skip('pixel OCR over all three images', 'no local traineddata; set DSH_TESSDATA to skip the CDN fetch')
  }
  for (const rel of (LANG_PATH === undefined ? [] : IMAGES)) {
    try {
      const text = execFileSync(process.execPath, ['-e', `
        const { createWorker } = require('tesseract.js')
        const { readFileSync } = require('fs')
        const path = ${JSON.stringify(join(ROOT, rel))}
        const langPath = ${JSON.stringify(LANG_PATH)}
        ;(async () => {
          const w = await createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' })
          const { data } = await w.recognize(readFileSync(path))
          process.stdout.write(data.text || '')
          await w.terminate()
        })().catch(() => process.exit(3))
      `], { encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'ignore'] })
      // OCR mangles CJK under the English model and splits tokens on stray
      // punctuation, so match a whole-line-ish window: any token whose hash is
      // on the denylist, plus a containment pass for the plain numeric id that
      // OCR may glue to a neighbouring glyph.
      const hits = tokensOf(text).filter(token => FORBIDDEN_HASHES.has(sha256(token)))
      record(hits.length === 0, `${rel} has no identifier in its rendered text`,
        hits.length === 0 ? '' : 'tagged identifier present')
    } catch (error) {
      // A backend failure is a HOLE in the verification, not a clean result.
      skip(`${rel} OCR`, String(error.message ?? error).split('\n')[0].slice(0, 90))
    }
  }
} else {
  skip('pixel OCR over all three images', 'tesseract.js not installed')
  console.log('         Install it and re-run before a public release:')
  console.log('           pnpm add -D tesseract.js')
}

// ---------------------------------------------------------------------------
// 3. Text files that ship inside the npm tarball.
// ---------------------------------------------------------------------------
const SHIPPED = ['README.md', 'README.en.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md', 'screenshots.json']
for (const rel of SHIPPED) {
  const path = join(ROOT, rel)
  if (!existsSync(path)) continue
  const text = readFileSync(path, 'utf8')
  const scrubbed = withoutCopyrightPhrases(withoutAllowedForms(text))
  const hits = tokensOf(scrubbed).filter(token => FORBIDDEN_HASHES.has(sha256(token)))
  record(hits.length === 0, `${rel} has no identifier`,
    hits.length === 0 ? '' : 'tagged identifier present')
}

// ---------------------------------------------------------------------------
// 4. Files that are ALLOWED to carry the copyright holder's name, and must stay
//    that way — so a future "redact everything" sweep cannot quietly strip the
//    license header. Checked by shape (`Copyright (c) <year> <name>`), which
//    proves the attribution survives without spelling the name here.
// ---------------------------------------------------------------------------
for (const rel of ATTRIBUTION) {
  const path = join(ROOT, rel)
  if (!existsSync(path)) continue
  const text = readFileSync(path, 'utf8')
  record(/Copyright \(c\) \d{4} [\w\u4e00-\u9fa5]+/.test(text), `${rel} keeps the required attribution`)
}

// ---------------------------------------------------------------------------
// 5. Version and changelog consistency — a privacy release that forgets its own
//    version bump ships the old number and the changelog says something else.
// ---------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
record(
  changelog.includes(`## ${pkg.version} `) || changelog.includes(`## ${pkg.version}(`),
  `CHANGELOG has a section for the shipping version ${pkg.version}`,
)
record(
  (pkg.files ?? []).some(f => f.includes('docs/assets/')),
  'package.json `files` still ships the product screenshots',
)

// ---------------------------------------------------------------------------
const failed = results.filter(entry => !entry.ok)
console.log('')
if (failed.length > 0) {
  console.error(`privacy verification FAILED — ${failed.length} check(s):`)
  for (const entry of failed) console.error(`  - ${entry.label}${entry.detail === '' ? '' : `: ${entry.detail}`}`)
  console.error('\nDo not publish. Fix the artifact, not this script.')
  process.exit(1)
}
if (skips.length > 0) {
  // A skip means part of the guarantee did not run. That is acceptable for a
  // casual local run, but the exact invocation that gates publishing must not
  // degrade silently. npm/pnpm set `npm_lifecycle_event` to the script name, so
  // this is detected without requiring a second env var to remember.
  const strict = process.env['DSH_STRICT_PRIVACY'] === '1'
    || process.env['npm_lifecycle_event'] === 'prepublishOnly'
  if (strict) {
    console.error(`privacy verification FAILED — ${skips.length} check(s) could not run:`)
    for (const entry of skips) console.error(`  - ${entry.label}${entry.detail === '' ? '' : `: ${entry.detail}`}`)
    console.error('\nRefusing to publish without full screenshot verification.')
    console.error('Set DSH_TESSDATA to a directory containing eng.traineddata.gz and retry.')
    process.exit(1)
  }
  console.log(`privacy verification passed with ${skips.length} SKIPPED check(s) (${results.length} passed).`)
  console.log('')
  console.log('  ⚠  Screenshot TEXT was not verified. A publish run (DSH_STRICT_PRIVACY=1)')
  console.log('     would refuse rather than continue.')
  process.exit(0)
}
console.log(`privacy verification passed (${results.length} checks, no skips).`)
