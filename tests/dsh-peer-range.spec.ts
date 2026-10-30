/**
 * Regression guard for the DSH peer ranges in `package.json`.
 *
 * WHY THIS FILE EXISTS — read before weakening it:
 *
 * DSH enforces the `peerDependencies` of a *bundle* at boot, and a bundle whose
 * peers are unsatisfied is skipped **whole** — silently. The plugin does not
 * half-load: no provider, no settings card, not even the usage route. Nothing
 * in this repository noticed when that happened for real:
 *
 *   - `tsc` passes, because the ranges are plain strings;
 *   - all 345 unit tests pass, because the plugin's own code is untouched;
 *   - `pnpm install` passes, because the devDependency pins satisfied the range
 *     that the range itself got wrong;
 *   - CI stays green.
 *
 * The failure is only visible on a user's machine, as "the plugin vanished".
 * That is the exact shape of the 2.3.1 → DSH 0.2.0-rc.1 breakage this file
 * exists to prevent from recurring:
 *
 *     >=0.1.7-rc.1 <0.2.0-0     # intended: "not 0.2.0 yet"
 *
 * That upper bound reads naturally but is **wrong**: in SemVer, `0.2.0-rc.1`
 * sorts BELOW `0.2.0-0`, so `<0.2.0-0` excludes the entire 0.2.0 PRERELEASE
 * line, not just the 0.2.0 release. The first 0.2.0 prerelease the user
 * installed therefore dropped the plugin. `<0.3.0-0` is the correct spelling
 * for "this minor line and later prereleases, but not the next minor line".
 *
 * Two rules keep this guard honest:
 *
 *  1. **Mirror the host, do not invent.** DSH evaluates ranges with
 *     `semver.satisfies(runtime, range, { includePrerelease: true })`
 *     (see `@deepseek-ai/dsh-app-boot` → plugin-compatibility). Without that
 *     option a prerelease runtime fails EVERY range, including the correct one,
 *     so a guard using the default options would reject the fixed manifest and
 *     teach the wrong lesson. The option is applied below and asserted on.
 *  2. **Assert the boundaries, not the spelling.** The probes below name the
 *     versions whose membership is the whole point: the oldest supported line,
 *     the runtime actually installed, and the next minor line that must stay
 *     out. A guard that only checked "0.2.0-rc.1 works" would still pass if
 *     someone widened the range to `>=0.1.7-rc.1` with no upper bound at all.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { satisfies } from 'semver'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  name: string
  version: string
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh: { client: { inject: string[] } }
}

/** The browser roster the host resolves for this bundle's client half. */
const manifestClientInject = manifest.dsh.client.inject

/** Exactly how `@deepseek-ai/dsh-app-boot` evaluates a peer range at boot. */
const admittedByDsh = (runtime: string, range: string): boolean =>
  satisfies(runtime, range, { includePrerelease: true })

/** Every DSH peer this bundle declares, with its range. */
const dshPeers = Object.entries(manifest.peerDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

/** Versions the ranges must ADMIT: the whole supported line plus later prereleases. */
const MUST_ADMIT = [
  '0.1.7-rc.1',    // oldest runtime this plugin claims (the lower bound itself)
  '0.1.7-rc.2',    // last 0.1.7 prerelease
  '0.1.9',         // a stable 0.1.7-line release
  '0.2.0-alpha.1', // first 0.2.0 prerelease — the 2.3.1 regression was exactly this shape
  '0.2.0-rc.1',    // the runtime that dropped the plugin when this guard was added
  '0.2.0',         // the 0.2.0 release
  '0.2.1-rc.1',    // the 0.2.1-rc.1 desktop host the plugin was synced against
  '0.2.1-rc.2',    // the 0.2.1-rc.2 desktop host
  '0.2.1-rc.3',    // the 0.2.1-rc.3 desktop host
  '0.2.1-rc.4',    // the 0.2.1-rc.4 desktop host
  '0.2.1-rc.5',    // the current 0.2.1-rc.5 desktop host
  '0.2.1',
  '0.2.9',         // later in the 0.2 line
] as const

/** Versions the ranges must REJECT: the next minor line, whose contracts are unreviewed. */
const MUST_REJECT = ['0.3.0-rc.1', '0.3.0', '1.0.0'] as const

describe('DSH peer ranges', () => {
  it('declares at least one DSH peer range to guard', () => {
    // Without this, a manifest edit that dropped every peer would make the
    // loops below vacuous and the suite would pass while checking nothing.
    expect(dshPeers.length).toBeGreaterThan(0)
  })

  it('uses semver range syntax the host can evaluate', () => {
    for (const [name, range] of dshPeers) {
      expect(range, `${name} must declare a non-empty range`).toBeTruthy()
      expect(() => satisfies('0.1.7-rc.1', range), `${name} range must parse`).not.toThrow()
    }
  })

  // A prerelease runtime is the case that broke 2.3.1, so it is the case the
  // host's option matters for. Pin the option's effect rather than trusting it:
  // if a future semver changed `includePrerelease` semantics, the range checks
  // below would silently stop testing what the host actually does.
  it('evaluates with includePrerelease, as the host does', () => {
    expect(admittedByDsh('0.2.0-rc.1', '>=0.1.7-rc.1 <0.3.0-0')).toBe(true)
    // The same range under default options rejects the prerelease outright —
    // proof that the option is load-bearing, not decorative.
    expect(satisfies('0.2.0-rc.1', '>=0.1.7-rc.1 <0.3.0-0')).toBe(false)
  })

  for (const [name, range] of dshPeers) {
    it(`${name} admits every supported runtime`, () => {
      for (const runtime of MUST_ADMIT) {
        expect(
          admittedByDsh(runtime, range),
          `${name} range "${range}" must admit DSH ${runtime}, but the host would SKIP the whole bundle`,
        ).toBe(true)
      }
    })

    it(`${name} still fences off the next minor line`, () => {
      for (const runtime of MUST_REJECT) {
        expect(
          admittedByDsh(runtime, range),
          `${name} range "${range}" must not admit unreviewed DSH ${runtime}`,
        ).toBe(false)
      }
    })
  }

  // `<0.2.0-0` is the exact spelling that caused the outage. It is easy to
  // "restore" while tidying, so name it.
  it('does not use a -0 upper bound that excludes prereleases', () => {
    for (const [name, range] of dshPeers) {
      expect(
        range.includes('<0.2.0-0'),
        `${name} uses "<0.2.0-0", which excludes 0.2.0 PRERELEASES and silently disables the whole bundle on DSH 0.2.0-rc.1+`,
      ).toBe(false)
    }
  })

  // The dev tree must resolve to versions its own peer ranges admit, or local
  // typecheck/test exercise a contract no user has and the range guard is moot.
  //
  // Scope note: only packages that actually declare a peer range are checked.
  // The client roster (`dsh.client.inject`) pins five more DSH packages as
  // devDependencies without a peer range of their own — the host resolves those
  // from its own graph, so a range here would guard nothing.
  it('pins every DSH peer in devDependencies, inside its own declared range', () => {
    const peerNames = dshPeers.map(([name]) => name)
    expect(peerNames.length).toBeGreaterThan(0)

    for (const [name, range] of dshPeers) {
      const pinned = manifest.devDependencies?.[name]
      expect(
        pinned,
        `${name} declares a peer range but no devDependency pin, so local typecheck and tests never exercise the range it admits`,
      ).toBeTruthy()
      expect(
        admittedByDsh(pinned as string, range),
        `${name} devDependency ${pinned} falls outside its own peer range "${range}"`,
      ).toBe(true)
    }
  })

  // The client roster must stay installable in the dev tree too: these pins are
  // what let the browser half typecheck locally against a real resolution.
  it('pins every client roster package in devDependencies', () => {
    const inject = manifestClientInject
    expect(inject.length).toBeGreaterThan(0)
    for (const name of inject) {
      expect(
        manifest.devDependencies?.[name],
        `${name} is injected by the browser half but has no devDependency pin`,
      ).toBeTruthy()
    }
  })
})
