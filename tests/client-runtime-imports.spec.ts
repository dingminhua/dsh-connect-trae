/**
 * The rules that decide whether the client bundle can LOAD in the browser.
 *
 * Two separate things must both hold, and 2.12.0 broke the second one while
 * every test stayed green:
 *
 * 1. A value import that is NOT in tsdown's `CLIENT_EXTERNALS` gets BUNDLED.
 *    Bundling a package the shell already provides inlines its CJS build — and
 *    react-dom's opens with `if (process.env.NODE_ENV !== "production")`, which
 *    throws `ReferenceError: process is not defined` in a browser, at
 *    module-evaluation time. The whole client half then fails to import:
 *
 *      web boot: 1 entry did not activate
 *      dsh-connect-trae: import failed
 *
 *    This is the actual 2.12.0/2.13.0 outage. It was first misattributed to
 *    importing `@deepseek-ai/dsh-client-ui-primitives` — which is in fact
 *    registered by the shell and imports fine.
 *
 * 2. An EXTERNAL import must name a module the shell's module loader registers,
 *    or the emitted `require(...)` resolves to nothing.
 *
 * Neither is observable from the test suite at runtime, because Node resolves
 * every one of these packages from node_modules and the component specs mock
 * them. So they are checked here, statically, over the sources.
 *
 * The registry below is transcribed from the shell's own bootstrap, the
 * `staticModules` object in the web frontend's `index-*.js`. Re-check it against
 * `assets/index-*.js` in `@deepseek-ai/dsh-web-frontend` when a DSH upgrade adds
 * a shared module.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const clientDir = join(root, 'src', 'client')

/** Modules the shell's `__ModuleLoader__` can hand to a plugin bundle. */
const HOST_REGISTERED = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** The `CLIENT_EXTERNALS` list tsdown is configured with. */
function clientExternals(): string[] {
  const source = readFileSync(join(root, 'tsdown.config.ts'), 'utf8')
  const block = /const CLIENT_EXTERNALS = \[([\s\S]*?)\] as const/.exec(source)
  if (block === null) throw new Error('CLIENT_EXTERNALS not found in tsdown.config.ts')
  // Comments are stripped BEFORE matching, and entries are matched one per line.
  // A naive `/'([^']+)'/g` over the raw block silently pairs the apostrophe in a
  // comment word (e.g. "shell's") with the next quote and returns comment text as
  // entries — which is exactly what happened on the first attempt.
  const body = (block[1] ?? '').replace(/^[ \t]*\/\/.*$/gm, '')
  return [...body.matchAll(/^[ \t]*'([^']+)',[ \t]*$/gm)].map(match => match[1] as string)
}

/** Every `.ts`/`.tsx` under a directory, without a shell or a glob library. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/**
 * Value (non-type) imports with their specifier, in one file.
 *
 * A hand-rolled scan over `import … from '…'`: the rule is about the SHAPE of
 * the import clause, and this reads clearly without a parser dependency.
 * `import type …` and an all-`type` named clause are erased by the build, so
 * they are not hazards and are skipped.
 */
function valueImports(source: string): { specifier: string; line: number }[] {
  const found: { specifier: string; line: number }[] = []
  for (const match of source.matchAll(/^[ \t]*import\b([\s\S]*?)from[ \t]+'([^']+)'/gm)) {
    const clause = match[1] ?? ''
    const specifier = match[2] ?? ''
    if (/^\s*type\b/.test(clause)) continue
    if (/^\s*\{[\s\S]*\}\s*$/.test(clause)) {
      const names = clause.replace(/[{}]/g, '').split(',').map(part => part.trim()).filter(Boolean)
      if (names.length > 0 && names.every(name => /^type\s/.test(name))) continue
    }
    const line = (source.slice(0, match.index).match(/\n/g)?.length ?? 0) + 1
    found.push({ specifier, line })
  }
  return found
}

describe('the client bundle can actually load', () => {
  const files = sourceFiles(clientDir)
  const externals = clientExternals()

  it('scans a non-empty set of client sources', () => {
    // Guard the guard: a wrong directory would make everything below vacuous.
    expect(files.length).toBeGreaterThan(5)
  })

  it('every EXTERNAL import names a module the shell registers', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const { specifier, line } of valueImports(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
        if (!externals.includes(specifier)) continue
        if (!(HOST_REGISTERED as readonly string[]).includes(specifier)) {
          offenders.push(`${relative(root, file)}:${line} requires ${specifier}, which the shell never registers`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('NO bare import is left to be BUNDLED (the react-dom outage)', () => {
    // If a package the shell provides is not externalized, tsdown inlines its CJS
    // build. For react-dom that injects `process.env.NODE_ENV` into the bundle
    // and the whole entry dies at import time.
    const bundled: string[] = []
    for (const file of files) {
      for (const { specifier, line } of valueImports(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
        if (externals.includes(specifier)) continue
        bundled.push(`${relative(root, file)}:${line} imports ${specifier}, which is NOT in CLIENT_EXTERNALS and would be bundled`)
      }
    }
    expect(bundled).toEqual([])
  })

  it('the externals list carries react-dom, which the shell registers', () => {
    expect(new Set(externals).size).toBe(externals.length)
    expect(externals).toContain('react-dom')
    expect(externals).toContain('react-dom/client')
    expect((HOST_REGISTERED as readonly string[])).toContain('react-dom')
  })

  it('the scanner reports value imports and ignores type-only ones', () => {
    // Negative control: without this, a scanner that silently matched nothing
    // would make the two rules above pass for the wrong reason.
    expect(valueImports("import type { A } from 'react-dom'")).toEqual([])
    expect(valueImports("import { type A } from 'react-dom'")).toEqual([])
    expect(valueImports("import { createPortal } from 'react-dom'"))
      .toEqual([{ specifier: 'react-dom', line: 1 }])
    expect(valueImports("import { useState } from 'react'")).toEqual([{ specifier: 'react', line: 1 }])
  })
})
