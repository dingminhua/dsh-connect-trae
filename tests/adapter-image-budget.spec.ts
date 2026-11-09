/**
 * Issue #81: the enterprise route declared a request-image budget larger than
 * the gateway that receives it accepts, so image-heavy turns died at the
 * transport layer instead of going through the host's offload retry.
 *
 * THE DEFECT. `REQUEST_IMAGE_BUDGETS` pinned `maxRequestImageBytes` to the
 * host's own default of 20 MiB for **every** region, with a comment saying the
 * values mirror "the host's own defaults (50 / 10)". That reasoning holds for
 * the count fields — those are a host contract — but not for the byte bound,
 * which has to match the *gateway*, and the gateways disagree by 2.5x.
 *
 * Measured to the byte on 2026-11-09, unauthenticated (openresty rejects on
 * body size BEFORE authentication runs, so the status code is the cap and no
 * credentials or credits are involved):
 *
 *   POST console.enterprise.trae.cn/api/agent/v3/create_agent_task
 *     10_485_758 bytes -> 401      10_485_762 bytes -> 413
 *   POST console.enterprise.trae.cn/api/agent/v3/llm_utils_chat
 *     10_485_758 bytes -> 401      10_485_762 bytes -> 413
 *     => cap 10 MiB (10_485_760) on both paths
 *
 *   POST trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat
 *     401 at 10, 12, 16, 24, 32 and 48 MiB — no cap reached
 *   POST coresg-normal.trae.ai/api/agent/v3/llm_utils_chat
 *     401 at 10, 12, 16 and 20 MiB  — no cap reached
 *
 * THE FAILURE IT CAUSED. DSH compares `maxRequestImageBytes` against the
 * base64 aggregate of every image a request re-inlines, and a route that
 * exceeds it raises `IMAGE_OFFLOAD_REQUIRED`, which `dsh-compaction-image-offload`
 * turns into "mark the oldest occurrences, retry". With 20 MiB budgeted against
 * a 10 MiB cap the host's own check reported "fits" at a payload the gateway
 * refused, so the retry never ran: the turn died on the 413 with an
 * `INVALID_REQUEST` and no recovery. A real session grew 1.56 MB -> 11.80 MB
 * over steps 9-19 and failed at step 20.
 *
 * WHY THESE ASSERTIONS ARE SHAPED LIKE THIS. The regression is a *number on one
 * route*, so a test that only checks "the enterprise budget is 8 MiB" would
 * also pass if someone lowered every route to 8 MiB and started offloading
 * images the consumer gateways would have accepted. The pairs below pin both
 * arms: the enterprise bound is under the measured cap, and the other two
 * routes are left at the host default.
 */

import { describe, expect, it } from 'vitest'
import {
  createTraeAdapter,
  TRAE_AI_PROVIDER,
  TRAE_ENTERPRISE_PROVIDER,
  TRAE_PROVIDER,
} from '../src/adapter.ts'

/** The enterprise gateway's measured body cap (10 MiB), in bytes. */
const ENTERPRISE_GATEWAY_CAP = 10_485_760

/**
 * Floor for the enterprise budget, in bytes (5 MiB — half the measured cap).
 *
 * WHY A LOWER BOUND ON A BOUND. The fix is "make it smaller", and an assertion
 * that only checks "smaller than the cap" is satisfied by *any* smaller number:
 * 1 MiB would pass it while offloading images the gateway would have accepted —
 * the same silent quality regression the other two routes are protected from,
 * just from the conservative side. Half the cap is the loosest floor that still
 * fails a change that gives up sending most of what fits; the shipped value is
 * 8 MiB, so this only bites on a real regression.
 */
const ENTERPRISE_MIN_USEFUL_BUDGET = 5_242_880

/** The host's own `maxRequestImageBytes` default, which the other routes keep. */
const HOST_DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20_971_520

const shim = {
  ready: Promise.resolve(),
  baseUrl: () => 'http://127.0.0.1:1',
  token: () => 'secret',
  tokenOf: () => 'secret',
  close: async () => {},
}

/** The image budget the adapter really hands DSH for one provider route. */
async function budgetFor(provider: string) {
  const { TraeCatalog } = await import('../src/catalog.ts')
  const built = createTraeAdapter({
    shim,
    catalog: new TraeCatalog('cn'),
    provider,
  })
  const snapshot = (built.adapter as unknown as {
    current: () => {
      profiles: Map<string, {
        maxRequestImageBytes?: number
        maxRequestImages?: number
        imageOffloadCountQuantum?: number
      }>
    }
  }).current()
  const profile = snapshot.profiles.get(provider)
  if (profile === undefined) throw new Error(`adapter registered no profile for ${provider}`)
  return profile
}

describe('createTraeAdapter — request image budget per gateway (issue #81)', () => {
  it('keeps the enterprise image budget under that gateway\'s 10 MiB body cap', async () => {
    const profile = await budgetFor(TRAE_ENTERPRISE_PROVIDER)
    expect(profile.maxRequestImageBytes).toBeTypeOf('number')
    // Strictly under, with room for the non-image envelope: at the cap itself
    // the request still carries the system prompt, tool declarations and text.
    expect(profile.maxRequestImageBytes!).toBeLessThan(ENTERPRISE_GATEWAY_CAP)
    // ... but not so far under that the fix becomes its own regression. Without
    // this arm, any smaller number passes — including one that offloads images
    // this gateway accepts, which is exactly what the next test forbids for the
    // other two routes.
    expect(profile.maxRequestImageBytes!).toBeGreaterThanOrEqual(ENTERPRISE_MIN_USEFUL_BUDGET)
  })

  it('leaves the CN and international routes on the host default', async () => {
    // Lowering these would offload images those gateways accept (measured: no
    // cap below 48 MiB on CN, 20 MiB on the international gateway), which is a
    // silent quality regression, not a fix.
    for (const provider of [TRAE_PROVIDER, TRAE_AI_PROVIDER]) {
      const profile = await budgetFor(provider)
      expect(profile.maxRequestImageBytes, provider).toBe(HOST_DEFAULT_MAX_REQUEST_IMAGE_BYTES)
    }
  })

  it('keeps the count bounds on every route, since those are a host contract', async () => {
    for (const provider of [TRAE_PROVIDER, TRAE_ENTERPRISE_PROVIDER, TRAE_AI_PROVIDER]) {
      const profile = await budgetFor(provider)
      expect(profile.maxRequestImages, provider).toBe(50)
      expect(profile.imageOffloadCountQuantum, provider).toBe(10)
    }
  })
})
