/**
 * The ONLY account identities the screenshot fixtures are allowed to use.
 *
 * Every `tools/*-shot.tsx` renders a real component with fixture data, and its
 * output ends up in README / npm / the marketplace. So the fixture data *is*
 * publication material: whatever name sits here ships to every reader. Before
 * v4.10.1 these files used the maintainer's own Trae account names, which put
 * two real account identifiers — and the fact that they belong to the same
 * person — into `docs/assets/*.png` and 80 published npm versions.
 *
 * Two rules, both enforced by `tests/privacy.spec.ts`:
 *
 *   1. Never put a real account name / id / balance here. Use the constants
 *      below, or a plainly invented `demo-*` string.
 *   2. Keep the *shape* representative, because the shots measure geometry:
 *      `DEMO_NUMERIC_ID` is a 9-digit generated-style id and `DEMO_NICKNAME` a
 *      7-character nickname, which is what the real data looked like. A short
 *      placeholder like `a` / `b` would make the card measure the wrong width
 *      and quietly stop being a meaningful screenshot.
 *
 * @module tools/demo-accounts
 */

/** A generated `用户<digits>`-style id. Numbers are sequential from 100000001. */
export const DEMO_NUMERIC_ID = '用户100000001'

/** A nickname of the same length as a real product handle. */
export const DEMO_NICKNAME = 'demo-usr'

/**
 * A full demo account row. Kept because the shot files build rows by hand today;
 * spread it and override what a shot needs to vary:
 *
 *     { ...demoAccount('account-2', DEMO_NICKNAME), selected: true }
 */
export function demoAccount(
  id: string,
  accountName: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    accountName,
    edition: 'cn',
    region: 'cn',
    source: 'desktop',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    selected: false,
    ...overrides,
  }
}

/**
 * Balances are invented.
 *
 * The first version of this file carried the *real* values from the pre-fix
 * screenshots (7500 / 5879.63 / 1620.37 / 2700 / 2372) under a comment claiming
 * they were invented. They are not: a balance is as identifying as the account
 * name, because it pins a specific account at a specific moment. Everything here
 * is made up, and no shot should read a balance from anywhere else.
 */
export const DEMO_CREDITS = {
  available: 6_458.72,
  consumed: 3_141.28,
  total: 9_600,
  work: 1_874,
  general: 2_531,
} as const
