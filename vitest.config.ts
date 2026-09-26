import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.tsx` specs render React components in jsdom (per-file
    // `@vitest-environment jsdom` pragma). The card is rendered from its REAL
    // source here — an earlier hand-copied mirror in this repo silently drifted
    // and let a broken checkbox ship, so component tests must import the
    // shipped component.
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    /**
     * Raised from vitest's 5000ms default because the FIRST test of each file
     * pays a one-off cold-start cost that is much larger on the Windows CI
     * runner than locally.
     *
     * Measured on `windows-latest` (CI run #60 — a run that changed only `.md`
     * files, so its code was byte-identical to a passing run):
     *
     *   identity.spec.ts      → 1st test 5179ms (TIMEOUT), later tests 6–60ms
     *   card-checkin.spec.tsx → 1st test 9435ms (TIMEOUT), later tests 50–196ms
     *   that run's totals: transform 17.71s, import 24.28s
     *
     * The same code passed on runs #59 and #61, which is what identifies this as
     * cold-start jitter rather than a defect: only the first test in a file is
     * ever affected, and every later test in the SAME file finishes in
     * milliseconds. Raising the ceiling therefore removes the flake without
     * weakening a single assertion — a genuinely hung test still fails, just
     * later.
     *
     * Do not "fix" a timeout failure by loosening an assertion: if a test that
     * was reliably fast starts timing out on ALL platforms, that is a real
     * regression and this number is not the problem.
     */
    testTimeout: 20_000,
  },
})
