// @vitest-environment jsdom
/**
 * The OPTIONAL sidebar PAGE (`surface: 'page'`), rendered with REAL zh strings
 * into /tmp/page-preview.html so its geometry can be measured rather than
 * guessed.
 *
 * Why a separate dump from `panels-shot.tsx`: that one renders the settings CARD
 * (`view: 'page'` inside the Plugins page, which still draws the collapsible
 * `<li>`), while this one renders the SIDEBAR page — no card frame, its own
 * heading, and the back control. Two different shells around the same body, so
 * measuring one tells you nothing about the other.
 *
 * The questions this answers, none of which the specs can:
 *
 *  1. is the page header actually at the top of the column, with the back
 *     control below a 40px icon (not squeezed into a 20px row)?
 *  2. does the body keep the card's own width cap instead of stretching to the
 *     window, so the model table does not turn into unreadable rows?
 *  3. does the page scroll as ONE scroller (no nested scrollbar inside it)?
 *
 *   pnpm page:shot   (or: npx vitest run --config vitest.card.config.ts -t "page shot")
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --hide-scrollbars --window-size=1200,2400 \
 *     --screenshot=/tmp/page-shot.png file:///tmp/page-preview.html
 *
 * Lives in `tools/` for the same reason the sibling shots do: it writes files
 * and needs a real browser to measure anything.
 */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'

/** A small CN catalog: enough rows to see the table, few enough to stay readable. */
function catalog(): Record<string, unknown>[] {
  const names = ['DeepSeek-V4.1-Flash', 'GLM-5.2', 'Kimi-K3', 'Qwen3-Max-Thinking-Preview-2026', 'Doubao-Seed-1.6']
  return Array.from({ length: 12 }, (_, index) => ({
    id: `model-${index}`,
    name: `${names[index % names.length] as string}${index >= names.length ? ` (${index})` : ''}`,
    contextWindow: 200_000,
    maxTokens: 32_000,
    ...index % 4 === 0 ? { creditMultiplier: 0.4 } : {},
  }))
}

function usageDocument(): Record<string, unknown> {
  const models = catalog()
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: '用户7520607992',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    refreshExpiresAtMs: Date.now() + 10 * 86_400_000,
    region: 'cn',
    enabled: true,
    sidebarPanelEnabled: true,
    accounts: [
      { id: 'account-1', accountName: '用户7520607992', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
      { id: 'account-2', accountName: 'LaoDing', edition: 'solo', region: 'cn', source: 'cli', tokenExpiresAtMs: Date.now() + 7_200_000, selected: false },
    ],
    models,
    enabledModelIds: models.filter((_, index) => index % 2 === 0).map(model => model.id),
    imageModelIds: [],
    credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 },
  }
}

const TOKENS = `
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
  --dsw-alias-bg-mask-1:rgba(15,17,21,.32);
  --dsw-mask-blur:blur(2px);
  --dsw-elevation-prominent:0 8px 24px rgba(15,17,21,.12);
}
html,body{margin:0;background:#fff;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;color:#0f1115}
/* The host renders a panel inside a column with a fixed height; without that
   the page's own height:100% would collapse and hide any overflow problem. */
.pane{height:900px;max-width:980px;margin:0 auto;border:1px dashed #d6d9de}
`

/** The in-page audit: geometry that has to be MEASURED rather than eyeballed. */
const AUDIT = `
<script>
addEventListener('load', () => {
  const out = {}
  const box = (el) => { const r = el.getBoundingClientRect(); return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } }
  const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const page = document.querySelector('.dsm-trae-page')
  out.page = page ? { ...box(page), scrollH: page.scrollHeight, clientH: page.clientHeight, overflowY: cs(page,'overflow-y') } : null
  // NO card chrome on a page surface: this must be null.
  out.cardShell = document.querySelector('.dsm-plugin-card') ? box(document.querySelector('.dsm-plugin-card')) : null
  out.head = (() => { const el = document.querySelector('.dsm-trae-page-head'); return el ? box(el) : null })()
  out.back = (() => { const el = document.querySelector('.dsm-trae-page-back'); return el ? { ...box(el), text: (el.textContent||'').trim() } : null })()
  out.icon = (() => { const el = document.querySelector('.dsm-trae-page-icon'); return el ? box(el) : null })()
  out.title = (() => { const el = document.querySelector('.dsm-trae-page-title'); return el ? { ...box(el), text: (el.textContent||'').trim() } : null })()
  out.body = (() => { const el = document.querySelector('.dsm-trae-page-body'); return el ? box(el) : null })()
  out.usage = (() => { const el = document.querySelector('.dsm-trae-page-body .dsm-trae-usage'); return el ? { ...box(el), border: cs(el,'border-top-width'), radius: cs(el,'border-radius') } : null })()
  // The preference block: the sidebar switch must be one of the bare lines here.
  out.prefs = Array.from(document.querySelectorAll('.dsm-trae-pref')).map(el => ({
    text: (el.textContent||'').trim().slice(0, 40),
    checked: el.querySelector('input') ? el.querySelector('input').checked : null,
    ...box(el),
  }))
  // Anything that scrolls on its own inside the page: there must be exactly one
  // (the page itself), because a nested scroller inside a scrolling page is the
  // complaint the sibling card's model list already fixed once.
  out.ownScrollers = Array.from(document.querySelectorAll('.dsm-trae-page *')).filter(el => {
    const style = getComputedStyle(el)
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
  }).map(el => ({ cls: String(el.className).slice(0, 60), ...box(el) }))
  out.docHeight = document.body.scrollHeight
  const pre = document.createElement('pre'); pre.id = 'audit'; pre.textContent = 'AUDIT' + JSON.stringify(out, null, 1); document.body.appendChild(pre)
})
</script>`

describe('page shot', () => {
  it('writes the html', async () => {
    const { render } = await import('@testing-library/react')
    const React = await import('react')
    const { TraeUsageCard } = await import('../src/client/TraeUsageCard.tsx')
    const { TRAE_CARD_CSS } = await import('../src/client/styles.ts')
    const { zh } = await import('../src/client/locales.ts')

    const t = ((key: string, params?: Record<string, unknown>) => {
      const raw = (zh as Record<string, string>)[key] ?? key
      if (params === undefined) return raw
      return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? ''))
    }) as never

    const settings: Record<string, unknown> = { showPointsInMainUi: true, sidebarPanel: true }
    const scope = {
      getSnapshot: () => ({ status: 'ready', value: settings, writable: true }),
      subscribe: () => () => {},
      set: async (field: string, next: unknown) => { settings[field] = next; return true },
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify(usageDocument()), { status: 200 })) as typeof globalThis.fetch
    const { container } = render(
      React.createElement(TraeUsageCard as never, {
        t,
        settingsScope: scope as never,
        surface: 'page',
        backToConversation: () => {},
      }),
    )
    // The usage read is a promise chain: let it land before dumping markup.
    await new Promise(resolve => setTimeout(resolve, 60))
    globalThis.fetch = originalFetch

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${TOKENS}\n${TRAE_CARD_CSS.replace(/<\/style/gi, '<\\/style')}</style></head><body><div class="pane">${container.innerHTML}</div></body></html>`
    writeFileSync('/tmp/page-preview.html', html.replace('</body>', AUDIT + '</body>'))
  })
})
