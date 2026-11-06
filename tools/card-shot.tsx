// @vitest-environment jsdom
/**
 * The pool section, rendered with REAL zh strings into /tmp/card-preview.html, so
 * its appearance can be inspected and MEASURED rather than guessed.
 *
 * The CSS in this plugin is written blind unless someone looks at the result, and
 * the person looking used to be the user — one round-trip per tweak, and no way to
 * check whether a change helped. This turns "does it look consistent" into a
 * command:
 *
 *   pnpm card:shot
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --hide-scrollbars --window-size=1200,900 \
 *     --screenshot=/tmp/card-shot.png file:///tmp/card-preview.html
 *
 * The page also carries an `#audit` <pre> with the geometry of every block
 * (padding, radius, font size, cell boxes, control edges); read it back with
 * `--dump-dom` to prove alignment instead of eyeballing it.
 *
 * Lives in `tools/` (NOT `tests/`) on purpose: it writes a file and needs a real
 * browser to measure anything, so it is a manual tool. The default `pnpm test`
 * used to collect it as a permanently SKIPPED test, which made every run report
 * "1 skipped" and hid the fact that the rest of the suite was green end to end.
 * `pnpm card:shot` still runs it through its own vitest config.
 */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'

describe('card shot', () => {
  it('writes the html', async () => {
    const { render } = await import('@testing-library/react')
    const React = await import('react')
    const { AccountPool } = await import('../src/client/AccountPool.tsx')
    const { TRAE_CARD_CSS } = await import('../src/client/styles.ts')
    const { zh } = await import('../src/client/locales.ts')
    const { DEMO_NICKNAME, DEMO_NUMERIC_ID } = await import('./demo-accounts.ts')

    const t = ((key: string, params?: Record<string, unknown>) => {
      const raw = (zh as Record<string, string>)[key] ?? key
      if (params === undefined) return raw
      return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? ''))
    }) as never

    const pool = {
      enabled: true,
      checkinSupported: true,
      targetModelId: 'deepseek-v4.1-flash',
      targetModelSource: 'preferred' as const,
      probeInputTokens: 0,
      memberAccountIds: ['u1', 'u2'],
      effectiveMemberAccountIds: ['u1', 'u2'],
      memberNames: {},
      accounts: [
        { accountId: 'u1', accountName: DEMO_NUMERIC_ID, current: true, member: true, reachable: true,
          generalAvailable: 842.17, workAvailable: 0, expiringSoon: 860, nearestExpiryMs: Date.now() + 4 * 86400_000, checkedInToday: true },
        { accountId: 'u2', accountName: DEMO_NICKNAME, current: false, member: true, reachable: true,
          tokenExpired: true, checkedInToday: false, excludedBy: 'credential-rejected' as const,
          probe: { outcome: 'credential-rejected' as const, atMs: Date.now() - 3 * 3600_000, source: 'test-batch' as const } },
        { accountId: 'u3', accountName: '138****0000', current: false, member: false, reachable: true,
          generalAvailable: 1_203, workAvailable: 0, checkedInToday: false,
          probe: { outcome: 'ok' as const, atMs: Date.now() - 5 * 3600_000, source: 'test-batch' as const, modelId: 'deepseek-v4.1-flash' } },
      ],
    }

    let value: Record<string, unknown> = { regions: { cn: { pool: { enabled: true, targetModelId: 'deepseek-v4.1-flash', memberAccountIds: ['u1', 'u2'], probeInputTokens: 0 } } } }
    const scope = {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: () => () => {},
      set: async (field: string, next: unknown) => { value = { ...value, [field]: next }; return true },
    }

    const models = [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' }, { id: 'free-1', name: 'Free' }]
    const { container } = render(
      React.createElement(AccountPool as never, { panel: 'cn', pool, models, t, settingsScope: scope as never }),
    )

    const tokens = `
:root{
  --dsw-alias-label-primary:#0f1115;
  --dsw-alias-label-secondary:#4b5058;
  --dsw-alias-label-tertiary:#8b9099;
  --dsw-alias-label-dimmed:#b0b5bd;
  --dsw-alias-border-l1:rgba(15,17,21,.08);
  --dsw-alias-border-l2:rgba(15,17,21,.16);
  --dsw-alias-bg-layer-1:#ffffff;
  --dsw-alias-bg-layer-2:#ffffff;
  --dsw-alias-bg-layer-3:#f6f7f9;
  --dsw-alias-brand-primary:#1b1c1e;
  --dsw-alias-interactive-bg-hover:rgba(15,17,21,.05);
  --dsw-alias-state-success-primary:#15803d;
  --dsw-alias-state-warn-primary:#b45309;
  --dsw-alias-state-error-primary:#b91c1c;
  --dsw-alias-elevation-prominent:0 8px 24px rgba(15,17,21,.12);
}
html,body{margin:0;background:#fff;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;color:#0f1115}
.pane{max-width:1120px;margin:0 auto;padding:24px 28px 48px}
`
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}\n${TRAE_CARD_CSS.replace(/<\/style/gi, '<\\/style')}</style></head><body><div class="pane">${container.innerHTML}</div></body></html>`
    const audit = `
<script>
addEventListener('load', () => {
  const out = {}
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) } }
  const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const one = (sel) => { const el = document.querySelector(sel); return el ? {
    box: box(el), padL: cs(el,'padding-left'), padR: cs(el,'padding-right'), padT: cs(el,'padding-top'),
    radius: cs(el,'border-radius'), font: cs(el,'font-size'), line: cs(el,'line-height'),
  } : null }
  for (const sel of ['.dsm-trae-pool','.dsm-trae-pool-card','.dsm-trae-pool-card-head',
    '.dsm-trae-pool-table','.dsm-trae-pool-row-head','.dsm-trae-pool-row','.dsm-trae-pool-settings',
    '.dsm-trae-pool-set','.dsm-trae-pool-tools-dashed','.dsm-trae-pool-save-row']) out[sel] = one(sel)
  // every cell of the first two body rows, plus the head cells
  out.headCells = Array.from(document.querySelectorAll('.dsm-trae-pool-row-head > span')).map(el => ({ cls: el.className, text: el.textContent, ...box(el) }))
  out.rowCells = Array.from(document.querySelectorAll('.dsm-trae-pool-row:not(.dsm-trae-pool-row-head)')).slice(0,2).map(row =>
    Array.from(row.children).map(el => ({ cls: el.className.split(' ')[0], ...box(el) })))
  out.controls = Array.from(document.querySelectorAll('.dsm-trae-pool-set-ctl')).map(el => ({ ...box(el), child: box(el.firstElementChild) }))
  // Button metrics: the save bar must agree with the card's other buttons.
  out.buttons = Array.from(document.querySelectorAll('.dsm-btn')).map(el => ({
    cls: el.className, text: (el.textContent || '').trim().slice(0, 8),
    h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width),
    padT: cs(el,'padding-top'), padL: cs(el,'padding-left'), font: cs(el,'font-size'),
  }))
  out.tags = ['.dsm-trae-pool-tag-current','.dsm-trae-pool-tag','.dsm-trae-pool-claim','.dsm-trae-pool-warn-tag'].map(sel => { const el = document.querySelector(sel); return el ? { sel, ...box(el), radius: cs(el,'border-radius'), font: cs(el,'font-size') } : { sel, missing: true } })
  out.rowButtons = Array.from(document.querySelectorAll('.dsm-trae-pool-row-actions .dsm-btn')).slice(0,2).map(el => ({ text: el.textContent, ...box(el), font: cs(el,'font-size') }))
  const pre = document.createElement('pre'); pre.id = 'audit'; pre.textContent = 'AUDIT' + JSON.stringify(out, null, 1); document.body.appendChild(pre)
})
</script>`
    writeFileSync('/tmp/card-preview.html', html.replace('</body>', audit + '</body>'))
  })
})
