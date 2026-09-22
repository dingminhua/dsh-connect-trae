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
  },
})
