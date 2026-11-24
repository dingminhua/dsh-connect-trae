/**
 * Issue #96: on DSH 0.2.3 every request through this plugin failed in ~378 ms
 * with `Image request maxImageBytes must be a positive integer.` — before a
 * single tool call, and on text-only turns with no image in the message.
 *
 * THE DEFECT. 0.2.3 renamed the per-image cap on the RESOLVED profile
 * (`requestImageMaxBytes` -> `maxImageBytes`) and added a REQUIRED divisor,
 * `requestImageBudgetCount`. `resolveProfiles()` performs both changes, but
 * this plugin never runs it — it hand-builds `ResolvedPiAiProviderProfile`
 * from a live Trae catalog (src/adapter.ts, `profileFor`), so neither the
 * rename nor the default ever happened for these routes. `REQUEST_IMAGE_BUDGETS`
 * still carried only the 0.2.2 five fields.
 *
 * THE NaN CHAIN (verified against the real 0.2.3-alpha.2 packages, not read
 * off the changelog — see docs/ISSUE96_DIAGNOSIS.md):
 *
 *   lib/index.js:1459  allocated = floor(maxRequestImageBytes / count / 4) * 3
 *                      floor(20_971_520 / undefined / 4) * 3        === NaN
 *   lib/index.js:1460  maxImageBytes = min(allocated, maxImageBytes ?? 1MiB)
 *                      Math.min(NaN, 1_048_576)                     === NaN
 *   lib/index.js:1461  if (maxImageBytes < 1) throw INVALID_CONFIG
 *                      NaN < 1 is FALSE  ->  the guard does NOT fire
 *   lib/index.js:1400  requestImageTarget() copies NaN into
 *                      { maxImageBytes, imageTargetBytes }
 *   attachment-local:756  checkedInteger(target.maxImageBytes, ...) throws
 *                      AttachmentError('Image request maxImageBytes must be a
 *                      positive integer.', 'INVALID_ATTACHMENT_REF')
 *
 * WHY TEXT-ONLY TURNS DIED TOO. In 0.2.2 the stream handed the attachment layer
 * `{ maxPixels, maxBytes }` straight off the profile (lib/index.js:2131) and
 * never called `resolveImageRequestBudget()`, so a missing divisor was inert.
 * 0.2.3 resolves the policy EAGERLY on the outer branch that only tests whether
 * the attachment service exists (lib/index.js:2127-2146) — that is strictly
 * before `containsImage` is consulted — so the NaN was computed on every single
 * request regardless of content.
 *
 * WHY BOTH SPELLINGS AND A PER-ROUTE DIVISOR. The peer range spans 0.2.2 and
 * 0.2.3, so the one object must satisfy both: 0.2.2 reads
 * `requestImageMaxBytes`, 0.2.3 reads `maxImageBytes`, and extra keys are inert
 * on the host that does not know them — no version branch needed. The divisor
 * is the subtle part: the resolved cap is `min(share, explicit cap)`, so a
 * divisor whose share drops under 1 MiB silently replaces the cap with a
 * smaller number nobody chose. Each route therefore gets the LARGEST divisor
 * that still keeps its share above 1 MiB — 14 on the 20 MiB consumer routes,
 * 5 on the 8 MiB enterprise route (see `REQUEST_IMAGE_BUDGETS`).
 */
import { describe, expect, it } from 'vitest'

/** The per-image cap both host lines must end up with, in bytes (1 MiB). */
const PER_IMAGE_CAP = 1_048_576

const shim = {
  ready: Promise.resolve(),
  baseUrl: () => 'http://127.0.0.1:1',
  token: () => 'secret',
  tokenOf: () => 'secret',
  close: async () => {},
}

/** The resolved profile this route really publishes, as plain data. */
async function routeProfile(provider: string): Promise<Record<string, unknown>> {
  const { createTraeAdapter } = await import('../src/adapter.ts')
  const { TraeCatalog } = await import('../src/catalog.ts')
  const built = createTraeAdapter({
    shim,
    catalog: new TraeCatalog('cn'),
    provider,
  })
  const snapshot = (built.adapter as unknown as {
    current: () => { profiles: Map<string, Record<string, unknown>> }
  }).current()
  const profile = snapshot.profiles.get(provider)
  if (profile === undefined) throw new Error(`adapter registered no profile for ${provider}`)
  return profile
}

/**
 * The exact 0.2.3 budget resolution, quoted from `lib/index.js:1454-1466`.
 *
 * `catalogBytes` is the model's own resize budget. This plugin's `toPiModel()`
 * sets no `inputLimits`, so `catalogBytes` is always `undefined` here and the
 * explicit per-image cap is what decides — which is exactly why the divisor
 * must keep the share above the cap rather than relying on that branch.
 */
function resolveImageMaxBytes(
  profile: Record<string, unknown>,
  catalogBytes?: number,
): number {
  const total = profile['maxRequestImageBytes'] as number
  const count = profile['requestImageBudgetCount'] as number
  const allocated = Math.floor(total / count / 4) * 3
  return Math.min(
    allocated,
    (profile['maxImageBytes'] as number | undefined) ?? catalogBytes ?? PER_IMAGE_CAP,
  )
}

/** Equal share of the aggregate byte budget, before the explicit cap clamps it. */
function equalShare(profile: Record<string, unknown>): number {
  const total = profile['maxRequestImageBytes'] as number
  const count = profile['requestImageBudgetCount'] as number
  return Math.floor(total / count / 4) * 3
}

/** Every route this plugin publishes, consumer and enterprise alike. */
async function allRoutes(): Promise<Array<{ provider: string; profile: Record<string, unknown> }>> {
  const { TRAE_PROVIDER, TRAE_ENTERPRISE_PROVIDER, TRAE_AI_PROVIDER } = await import('../src/adapter.ts')
  const providers = [TRAE_PROVIDER, TRAE_ENTERPRISE_PROVIDER, TRAE_AI_PROVIDER]
  return Promise.all(providers.map(async provider => ({ provider, profile: await routeProfile(provider) })))
}

describe('the hand-built profile carries every image budget 0.2.3 requires (issue #96)', () => {
  it('states requestImageBudgetCount as a positive safe integer on every route', async () => {
    // THE REGRESSION. 0.2.3 requires this field; without it the host divides by
    // `undefined` and the NaN slips past its own INVALID_CONFIG guard.
    for (const { provider, profile } of await allRoutes()) {
      const count = profile['requestImageBudgetCount']
      expect(Number.isSafeInteger(count), provider).toBe(true)
      expect(count as number, provider).toBeGreaterThan(0)
    }
  })

  it('states BOTH spellings of the per-image cap', async () => {
    // 0.2.2 reads `requestImageMaxBytes`, 0.2.3 reads `maxImageBytes`. Dropping
    // either one regresses the host line that reads it, and the peer range
    // spans both.
    for (const { provider, profile } of await allRoutes()) {
      expect(profile['requestImageMaxBytes'], provider).toBe(PER_IMAGE_CAP)
      expect(profile['maxImageBytes'], provider).toBe(PER_IMAGE_CAP)
    }
  })

  it('resolves to a POSITIVE 1 MiB cap under the real 0.2.3 formula', async () => {
    // Asserted by VALUE, not by "is defined": a nonsense divisor that yields a
    // tiny budget must also go red. Before the fix this is NaN on every route,
    // which is the exact value the attachment layer rejects.
    for (const { provider, profile } of await allRoutes()) {
      expect(resolveImageMaxBytes(profile), provider).toBe(PER_IMAGE_CAP)
    }
  })

  it('keeps every route\'s equal share ABOVE the cap, so the divisor never narrows it', async () => {
    // The resolved cap is `min(share, explicit cap)`. A divisor that pushes the
    // share under 1 MiB replaces the pinned cap with a smaller number nobody
    // chose — the host default of 20 gives 786_432 on the consumer routes and
    // 314_571 on enterprise, and 15 gives 1_048_575 (ONE BYTE short). This is
    // what stops the divisor being "tidied" to the host default.
    for (const { provider, profile } of await allRoutes()) {
      expect(equalShare(profile), provider).toBeGreaterThan(PER_IMAGE_CAP)
    }
  })

  it('picks the largest divisor each route can carry', async () => {
    // Largest divisor keeping the share above 1 MiB:
    //   20_971_520 / 14 / 4 -> 1_123_473  (15 -> 1_048_575, one byte short)
    //    8_388_608 /  5 / 4 -> 1_258_290  ( 6 -> 1_048_575, one byte short)
    // A smaller divisor is harmless but wasteful: it inflates a share the
    // explicit cap immediately clamps. Pinning the exact numbers makes the
    // per-route intent visible instead of leaving one flat value to be guessed.
    const { TRAE_PROVIDER, TRAE_ENTERPRISE_PROVIDER, TRAE_AI_PROVIDER } = await import('../src/adapter.ts')
    const expected: Array<[string, number, number]> = [
      [TRAE_PROVIDER, 14, 1_123_473],
      [TRAE_AI_PROVIDER, 14, 1_123_473],
      [TRAE_ENTERPRISE_PROVIDER, 5, 1_258_290],
    ]
    for (const [provider, count, share] of expected) {
      const profile = await routeProfile(provider)
      expect(profile['requestImageBudgetCount'], provider).toBe(count)
      expect(equalShare(profile), provider).toBe(share)
    }
  })

  it('still carries every 0.2.2 field the older host reads', async () => {
    // Adding the 0.2.3 fields must not drop the old ones: 0.2.2 reads
    // `requestImageMaxBytes` straight off this profile, and these three are
    // what issue #81 measured against the real gateways.
    const { TRAE_PROVIDER, TRAE_ENTERPRISE_PROVIDER, TRAE_AI_PROVIDER } = await import('../src/adapter.ts')
    for (const provider of [TRAE_PROVIDER, TRAE_AI_PROVIDER]) {
      const profile = await routeProfile(provider)
      expect(profile['maxRequestImageBytes'], provider).toBe(20_971_520)
    }
    const enterprise = await routeProfile(TRAE_ENTERPRISE_PROVIDER)
    expect(enterprise['maxRequestImageBytes']).toBe(8_388_608)

    for (const { provider, profile } of await allRoutes()) {
      expect(profile['requestImagePixelBudget'], provider).toBe(4_194_304)
      expect(profile['maxRequestImages'], provider).toBe(50)
      expect(profile['imageOffloadCountQuantum'], provider).toBe(10)
    }
  })
})
