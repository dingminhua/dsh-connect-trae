/**
 * Guard for issue #65: a plugin installed through the DSH plugin market must
 * survive a full restart, and it did not.
 *
 * WHAT HAPPENED. Installation reported success (`generation-install: promoted
 * to dsh-connect-trae+4.6.1+…`) and then failed one line later:
 *
 *     generation-install: generation peer validation failed:
 *     @earendil-works/pi-ai does not resolve from the generation or
 *     installation closure
 *
 * The generation was therefore never registered in the persistent manifests,
 * DSH's next boot rebuilt `.generations/live` from those manifests, and the
 * plugin was swept away — "install, restart, gone". The user's only workaround
 * is reinstalling, which reproduces it.
 *
 * WHY pi-ai IS DIFFERENT FROM THE OTHER PEERS. The market treats
 * `@deepseek-ai/dsh*` and `@deepseek-ai/cordis*` as host-core packages: it
 * derives that set from the installation's own `node_modules`
 * (`corePackageNames()` in dshmarket's `check.ts`) and resolves those from the
 * host anchor instead of from the profile. `@earendil-works/pi-ai` matches
 * neither prefix, so it is demanded from the plugin's own installation
 * closure — where it never exists, because DSH supplies pi-ai at runtime
 * (the sibling `dsh-connect-workbuddy` hit this first and marks it optional;
 * `docs/`-level detail lives in `src/pi-ai-runtime.ts`, which probes *which*
 * pi-ai the host resolved rather than shipping one).
 *
 * THE FIX IS DECLARATIVE, SO IT NEEDS A TEST. Nothing in the build notices:
 * `tsc` sees plain strings, the dev tree has a real pi-ai in `devDependencies`
 * (so every local test resolves it happily), and CI stays green. The only
 * place the failure shows up is a user's machine after a restart. Hence this
 * guard reads the shipped manifest and asserts the optional marker is there.
 *
 * DO NOT "FIX" A RED HERE BY DELETING THE PEER. The range is load-bearing: it
 * is what tells the host which pi-ai generations this plugin's adapter can
 * consume (see `tests/dsh-peer-range.spec.ts` for the same reasoning applied
 * to the DSH ranges). The marker, not the range, is the correct lever.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface Manifest {
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: unknown }>
  devDependencies?: Record<string, string>
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as Manifest

/**
 * Host-supplied peers the market resolves from the host anchor, so they are
 * allowed to be absent from a plugin's own closure. Mirrors
 * `corePackageNames()`: the `@deepseek-ai/dsh*` and `@deepseek-ai/cordis*`
 * families. This is a prefix rule on purpose — the market derives its set
 * from a directory listing, so a curated name list here would drift.
 */
const HOST_CORE = /^@deepseek-ai\/(?:dsh|cordis)/

/** Peers that legitimately live in the host's own graph, outside either prefix. */
const HOST_PROVIDED_OTHERWISE = new Set([
  // DSH's LLM layer hands the adapter its pi-ai at runtime; the plugin probes
  // the resolved copy instead of installing one (#27, #65).
  '@earendil-works/pi-ai',
])

const peerNames = Object.keys(manifest.peerDependencies ?? {})

describe('optional peers (#65)', () => {
  it('declares peers at all, so the assertions below are not vacuous', () => {
    expect(peerNames.length).toBeGreaterThan(0)
  })

  // The exact regression: pi-ai must carry `optional: true`, or the generation
  // installer rejects the plugin and the next restart deletes it.
  it('marks @earendil-works/pi-ai optional, so generation peer validation passes', () => {
    expect(peerNames).toContain('@earendil-works/pi-ai')
    expect(
      manifest.peerDependenciesMeta?.['@earendil-works/pi-ai']?.optional,
      'pi-ai is supplied by the DSH host at runtime and is NOT one of the market\'s '
      + 'host-core prefixes; without `optional: true` the desktop generation installer fails '
      + 'peer validation, the install is never registered, and the next DSH restart sweeps '
      + 'the plugin away (issue #65). Do not delete the peer range instead — it encodes '
      + 'which pi-ai generations the adapter can consume.',
    ).toBe(true)
  })

  // Generalised so the next host-provided peer does not reopen the same hole.
  it('marks every non-host-core, host-provided peer optional', () => {
    for (const name of peerNames) {
      if (HOST_CORE.test(name)) continue
      if (!HOST_PROVIDED_OTHERWISE.has(name)) continue
      expect(
        manifest.peerDependenciesMeta?.[name]?.optional,
        `${name} is provided by the host but is outside the market's host-core prefixes, `
        + 'so it must be an optional peer or it will fail generation peer validation',
      ).toBe(true)
    }
  })

  // The marker must be a literal `true`. `"yes"`, `1` and friends are not what
  // npm/the host read, and a hand-edited truthy value would look fixed while
  // behaving exactly like the bug.
  it('uses a literal boolean true for the optional flag', () => {
    for (const [name, meta] of Object.entries(manifest.peerDependenciesMeta ?? {})) {
      if (!('optional' in meta)) continue
      expect(typeof meta.optional, `${name} peerDependenciesMeta.optional must be a boolean`).toBe('boolean')
    }
  })

  // Every optional entry must still name a declared peer: a stray key would
  // silently do nothing and could convince a reader the marker is in place.
  it('only marks peers that are actually declared', () => {
    for (const name of Object.keys(manifest.peerDependenciesMeta ?? {})) {
      expect(peerNames, `${name} has peerDependenciesMeta but no peerDependencies entry`).toContain(name)
    }
  })

  // The optional marker must not become a way to smuggle in an unpinned peer:
  // local typecheck and tests still need a real copy to compile against.
  it('still pins pi-ai in devDependencies', () => {
    expect(manifest.devDependencies?.['@earendil-works/pi-ai']).toBeTruthy()
  })
})
