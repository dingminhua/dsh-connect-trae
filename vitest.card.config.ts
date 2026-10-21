import { defineConfig } from 'vitest/config'

/**
 * Manual screenshot run for the pool card: renders it with the REAL zh strings
 * into /tmp/card-preview.html so a headless Chrome can measure it.
 *
 * Kept out of `vitest.config.ts` on purpose — that suite must be pure (no files
 * written, no browser) and must not carry a test that is skipped on purpose, or
 * every run reports "1 skipped" and the green result stops meaning "everything
 * ran". The file lives in `tools/`, so the default glob never sees it.
 */
export default defineConfig({
  test: {
    include: ['tools/card-shot.tsx', 'tools/promo-shot.tsx', 'tools/panels-shot.tsx'],
    environment: 'node',
  },
})
