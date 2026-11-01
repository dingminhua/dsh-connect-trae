// @vitest-environment jsdom
/**
 * The COMPOSER CREDIT POPOVER, rendered with REAL zh strings into
 * /tmp/composer-preview.html so the header's control can be measured rather
 * than guessed.
 *
 * Why its own dump: `panels-shot.tsx` renders the settings CARD, `page-shot.tsx`
 * the sidebar PAGE — both faces of the plugin's full configuration surface. This
 * one is the small anchored popover in the composer row, which shares no CSS
 * template with either (it injects `COMPOSER_POINTS_CSS` alone, because the card
 * sheet only loads when the settings card does). A width problem here is
 * therefore invisible in both of those dumps.
 *
 * The specific question this change raises (m01198): the header used to carry a
 * 「刷新积分」 button and now carries 「设置」 instead. Both are single short
 * labels in a 248px panel, but the header also holds the title — so what has to
 * be checked is that the title still fits on one line beside it, and that the
 * button's height stays on the 16px line rather than growing the header.
 *
 *   pnpm composer:shot   (or: npx vitest run --config vitest.card.config.ts -t "composer shot")
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --hide-scrollbars --window-size=900,700 \
 *     --screenshot=/tmp/composer-shot.png file:///tmp/composer-preview.html
 *
 * Lives in `tools/` for the same reason the sibling shots do: it writes files
 * and needs a real browser to measure anything.
 */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'

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
  --dsw-specific-menu:#ffffff;
  --dsw-elevation-prominent:0 8px 24px rgba(15,17,21,.12);
  --dsw-menu-backdrop-filter:none;
  --dsw-radius-lg:14px;
}
html,body{margin:0;background:#fff;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;color:#0f1115}
/* The popover is positioned from its trigger and portaled to the body, so it is
   position:fixed. Give it a pane that looks like a composer footer, and pin the
   trigger's own box so the anchored placement has something to measure. */
.pane{position:relative;height:560px;padding:24px 28px}
.pane label{display:block;font-size:12px;color:#8b9099;margin-bottom:10px}
/* PREVIEW ONLY. The anchored placement writes inline left/top measured from the
   trigger, and jsdom reports every box as zero — so the real popover lands
   off-screen and photographs as nothing. That placement is NOT what this dump
   measures (the panel's interior is), so pin it somewhere visible; !important is
   required because the inline style is what has to be overridden. */
.dsm-trae-composer-panel{left:20px !important;top:20px !important;visibility:visible !important}
.pane{height:412px;padding:330px 24px 0;box-sizing:border-box}
`

/** Geometry that has to be MEASURED rather than eyeballed. */
const AUDIT = `
<script>
addEventListener('load', () => {
  const out = {}
  const box = (el) => { const r = el.getBoundingClientRect(); return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } }
  const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const panel = document.querySelector('.dsm-trae-composer-panel')
  out.panel = panel ? { ...box(panel), fixed: cs(panel,'position'), vis: cs(panel,'visibility'), radius: cs(panel,'border-radius') } : null
  out.head = (() => { const el = document.querySelector('.dsm-trae-composer-panel-head'); return el ? box(el) : null })()
  out.title = (() => { const el = document.querySelector('.dsm-trae-composer-panel-title'); return el ? { ...box(el), text: (el.textContent||'').trim(), wrap: el.getBoundingClientRect().height > 24 } : null })()
  // THE QUESTION: does the new control sit on the 16px line inside the header?
  out.settings = (() => { const el = document.querySelector('.dsm-trae-composer-panel-settings'); return el ? { ...box(el), text: (el.textContent||'').trim(), font: cs(el,'font-size'), line: cs(el,'line-height'), radius: cs(el,'border-radius'), cursor: cs(el,'cursor') } : null })()
  // The removed control must not be in the DOM at all.
  out.refresh = (() => { const el = document.querySelector('.dsm-trae-composer-panel-refresh'); return el ? { ...box(el), text: (el.textContent||'').trim() } : null })()
  // The title and the button must be on the SAME line: their vertical centres
  // must not differ by more than a pixel or two.
  if (out.title && out.settings) {
    out.baselineDelta = (out.title.t + out.title.h / 2) - (out.settings.t + out.settings.h / 2)
  }
  out.table = (() => { const el = document.querySelector('.dsm-trae-composer-panel-table'); return el ? { ...box(el), rows: el.querySelectorAll('tbody tr').length } : null })()
  out.foot = (() => { const el = document.querySelector('.dsm-trae-composer-panel-foot'); return el ? { ...box(el), text: (el.textContent||'').trim() } : null })()
  // Horizontal overflow inside the panel would clip the button off the right.
  out.overflowX = panel ? panel.scrollWidth - panel.clientWidth : null
  out.buttons = Array.from(document.querySelectorAll('.dsm-trae-composer-panel button')).map(el => ({ cls: String(el.className), text: (el.textContent||'').trim().slice(0,10), ...box(el) }))
  const pre = document.createElement('pre'); pre.id = 'audit'; pre.textContent = 'AUDIT' + JSON.stringify(out, null, 1); document.body.appendChild(pre)
})
</script>`

describe('composer shot', () => {
  it('writes the html', async () => {
    const { render } = await import('@testing-library/react')
    const React = await import('react')
    const { ComposerPoints } = await import('../src/client/ComposerPoints.tsx')
    const { COMPOSER_POINTS_CSS } = await import('../src/client/styles.ts')
    const { zh } = await import('../src/client/locales.ts')

    const t = ((key: string, params?: Record<string, unknown>) => {
      const raw = (zh as Record<string, string>)[key] ?? key
      if (params === undefined) return raw
      return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? ''))
    }) as never

    // CN shape, because this is the one the README screenshot shows (the credit
    // table with a balance per account, and the readout below it). The `ai` shape
    // is what the AUDIT above was first written against; both go through the same
    // component, and the header control is identical on either side, so measuring
    // one settles the geometry of both.
    const usage = {
      status: 'signed-in',
      accountId: 'account-1',
      accountName: 'LaoDing',
      tokenExpiresAtMs: Date.now() + 3_600_000,
      region: 'cn',
      accounts: [
        { id: 'account-1', accountName: 'LaoDing', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
        { id: 'account-2', accountName: '用户7520607992', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: false },
      ],
      models: [],
      enabledModelIds: [],
      credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 634, accounts: [] },
    }

    const originalFetch = globalThis.fetch
    // The CN panel reads the per-account CREDITS route for each row's balance, so
    // this has to answer it too — neither route may fall through to the usage
    // shape, or every row would render a dash.
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/account-credits')) {
        return new Response(JSON.stringify({
          accounts: [
            { id: 'account-1', accountName: 'LaoDing', selected: true, generalAvailable: 634 },
            { id: 'account-2', accountName: '用户7520607992', selected: false, generalAvailable: 784 },
          ],
        }), { status: 200 })
      }
      return new Response(JSON.stringify(usage), { status: 200 })
    }) as typeof globalThis.fetch

    const container = document.createElement('div')
    container.className = 'pane'
    document.body.appendChild(container)
    const label = document.createElement('label')
    label.textContent = ''
    container.appendChild(label)
    const host = document.createElement('div')
    container.appendChild(host)

    render(
      React.createElement(ComposerPoints as never, {
        t,
        provider: 'trae',
        region: 'cn',
        settingsScope: {
          getSnapshot: () => ({ status: 'ready', value: {}, writable: true }),
          subscribe: () => () => {},
          set: async () => true,
        },
        onOpenSettings: () => true,
      }),
      { container: host },
    )
    // The usage read is a promise chain: let it land, then open the panel.
    await new Promise(resolve => setTimeout(resolve, 80))
    const trigger = host.querySelector('.dsm-trae-composer-points-trigger')
    if (trigger !== null) (trigger as HTMLButtonElement).click()
    await new Promise(resolve => setTimeout(resolve, 120))
    globalThis.fetch = originalFetch

    // The panel is PORTALED to document.body, so it is a SIBLING of the render
    // container, not a descendant. Serializing `container.outerHTML` alone would
    // dump an empty popover — the first version of this file did exactly that
    // and measured nothing (every audit field came back null).
    const portal = document.querySelector('.dsm-trae-composer-panel')
    const staged = portal === null ? container.outerHTML : container.outerHTML + portal.outerHTML

    const shell = '<!doctype html><html><head><meta charset="utf-8"><style>'
    const css = TOKENS + '\n' + COMPOSER_POINTS_CSS.replace(/<\/style/gi, '<\\/style')
    const body = '</style></head><body>' + staged + '</body></html>'
    writeFileSync('/tmp/composer-preview.html', (shell + css + body).replace('</body>', AUDIT + '</body>'))
  })
})
