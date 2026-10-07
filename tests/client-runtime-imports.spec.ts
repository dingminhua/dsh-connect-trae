/**
 * The client half must not VALUE-import a DSH package.
 *
 * This is a build-shape rule with a real outage behind it. The browser loads the
 * client bundle through the shell's module loader, which registers only a small
 * set of specifiers; a value import of anything else is turned into an external
 * `require(...)` by tsdown and then cannot resolve at load time. The failure is
 * total — the whole client half stops activating:
 *
 *   web boot: 1 entry did not activate
 *   dsh-connect-trae: import failed
 *
 * 2.12.0 did exactly that: it added a value import of
 * `@deepseek-ai/dsh-client-ui-primitives` for two popover hooks. Every test
 * stayed green, because the test suite mocks that package and Node resolves it
 * from node_modules — the breakage only existed in the browser. The hooks are
 * now implemented locally in `src/client/popover.ts`.
 *
 * So the rule is checked HERE, statically, at the source: a `import type` is
 * fine (the build erases it), a value import is not. This runs in the ordinary
 * suite, needs no build output, and fails at the line that introduced the
 * problem instead of at boot.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = join(here, '..', 'src', 'client')

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
 * Value (non-type) imports of DSH packages in one file.
 *
 * Deliberately a hand-rolled scan over import statements rather than a full
 * parser: the rule is about the SHAPE of the import clause, and a regex over
 * `from '...'` plus a `import type` check reads clearly and cannot silently
 * drift with a parser upgrade.
 */
function dshValueImports(source: string): string[] {
  const found: string[] = []
  // Each import statement, from `import` up to the closing `;` or newline.
  for (const match of source.matchAll(/^[ \t]*import\b([\s\S]*?)from[ \t]+'([^']+)'/gm)) {
    const clause = match[1] ?? ''
    const specifier = match[2] ?? ''
    if (!specifier.startsWith('@deepseek-ai/')) continue
    // `import type ...` is erased by the build, so it is not the hazard.
    if (/^\s*type\b/.test(clause)) continue
    // `import { type A, type B } from ...` is erased too. Only a braces-only
    // clause can be all-types; a clause with a default or namespace binding is
    // a value import regardless of what the braces hold.
    if (/^\s*\{[\s\S]*\}\s*$/.test(clause)) {
      const names = clause.replace(/[{}]/g, '').split(',').map(part => part.trim()).filter(Boolean)
      if (names.length > 0 && names.every(name => /^type\s/.test(name))) continue
    }
    found.push(specifier)
  }
  return found
}

describe('the client half keeps its runtime imports to the shell-provided set', () => {
  const files = sourceFiles(clientDir)

  it('scans a non-empty set of client sources', () => {
    // Guard the guard: a wrong directory would make every assertion below
    // vacuously true.
    expect(files.length).toBeGreaterThan(5)
  })

  it('value-imports NO DSH package anywhere under src/client', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const specifier of dshValueImports(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(join(here, '..'), file)}: ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('accepts type-only DSH imports (they are erased, so they are not the hazard)', () => {
    // Negative control for the scanner: if this reported nothing for a type-only
    // import, the rule above would be passing for the wrong reason.
    expect(dshValueImports("import type { ClientContext } from '@deepseek-ai/cordis'")).toEqual([])
    expect(dshValueImports("import { type Foo } from '@deepseek-ai/dsh-client-ui-slots'")).toEqual([])
    // ...and it MUST report a value import.
    expect(dshValueImports("import { useThing } from '@deepseek-ai/dsh-client-ui-primitives'"))
      .toEqual(['@deepseek-ai/dsh-client-ui-primitives'])
    // react is served by the shell and is not a DSH package; it stays allowed.
    expect(dshValueImports("import { useState } from 'react'")).toEqual([])
  })
})
