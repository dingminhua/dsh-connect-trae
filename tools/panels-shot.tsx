// @vitest-environment jsdom
/**
 * The whole settings CARD — all three sections — rendered with REAL zh strings
 * into /tmp/panels-preview-<section>.html, so the split can be inspected and
 * MEASURED rather than guessed.
 *
 * Written for two questions that cannot be answered from the source:
 *
 *  1. does the MODEL section really paint EVERY model — no inner scrollbar, no
 *     clipped row — with a realistic (30-model) catalog?
 *  2. do the section tabs stay reachable, and does the region row above them
 *     still read as the SCOPE rather than as a fourth tab?
 *
 *   pnpm panels:shot
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --hide-scrollbars --window-size=1200,2600 \
 *     --screenshot=/tmp/panels-shot-models.png \
 *     file:///tmp/panels-preview-models.html
 *
 * ONE FILE PER SECTION: the card holds the open section in React state, so a
 * click dispatched on the dumped DOM would not repaint reliably. Each section is
 * rendered afresh and its tab pressed through `fireEvent` — the same path a user
 * takes, under `act`.
 *
 * Each page carries an `#audit` <pre> with the geometry of every part: the panel
 * boxes, the model list's own scrollHeight vs clientHeight (the measurement that
 * answers "is anything clipped?"), the section strip, and every element anywhere
 * in a panel that scrolls on its own — which is exactly the thing that was
 * complained about. Read it back with `--dump-dom`.
 *
 * Lives in `tools/` (NOT `tests/`) for the same reason `card-shot.tsx` does: it
 * writes files and needs a real browser to measure anything.
 */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'

/** Short names mixed with long ones: the promo capsule only interacts with long. */
const MODEL_NAMES = [
  'DeepSeek-V4.1-Flash', 'GLM-5.2', 'Kimi-K3', 'Qwen3-Max-Thinking-Preview-2026',
  'Doubao-Seed-1.6', 'DeepSeek-V4-Pro',
]

/**
 * A realistic CN catalog: 30 rows, mixed multipliers, a few image-capable
 * models. 30 is not arbitrary — it is more than one screen, so a scroll cap
 * would be visible here and invisible in a six-model fixture.
 */
function catalog(): Record<string, unknown>[] {
  return Array.from({ length: 30 }, (_, index) => {
    const maxContextWindow = index % 4 === 0 ? 1_000_000 : undefined
    return {
      id: `model-${index}`,
      name: `${MODEL_NAMES[index % MODEL_NAMES.length]!}${index >= MODEL_NAMES.length ? ` (${index})` : ''}`,
      contextWindow: 128_000 + index * 1_000,
      ...maxContextWindow === undefined ? {} : { maxContextWindow },
      maxTokens: 8_192,
      ...index % 5 === 0 ? { creditMultiplier: 0.4 } : index % 3 === 0 ? { creditMultiplier: 1 } : {},
      ...index % 7 === 0 ? { multimodal: true } : {},
    }
  })
}

/** A signed-in CN document carrying that catalog. */
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
  --dsw-alias-elevation-prominent:0 8px 24px rgba(15,17,21,.12);
}
html,body{margin:0;background:#fff;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;color:#0f1115}
.pane{max-width:760px;margin:0 auto;padding:24px 28px 48px}
`

/** The in-page audit: everything that has to be MEASURED rather than eyeballed. */
const AUDIT = `
<script>
addEventListener('load', () => {
  const out = {}
  const box = (el) => { const r = el.getBoundingClientRect(); return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } }
  const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const one = (sel) => { const el = document.querySelector(sel); return el ? {
    box: box(el), maxH: cs(el,'max-height'), overflowY: cs(el,'overflow-y'), overflow: cs(el,'overflow'),
  } : null }

  // THE ANSWER TO "does every model fit without a scrollbar".
  const list = document.querySelector('.dsm-trae-model-list')
  out.modelList = list ? {
    ...box(list),
    scrollHeight: list.scrollHeight,
    clientHeight: list.clientHeight,
    clipped: list.scrollHeight > list.clientHeight + 1,
    overflowY: cs(list,'overflow-y'),
    maxHeight: cs(list,'max-height'),
    rows: document.querySelectorAll('.dsm-trae-model').length,
    hiddenRows: Array.from(document.querySelectorAll('.dsm-trae-model')).filter(el => el.hidden).length,
  } : null

  out.panels = Array.from(document.querySelectorAll('.dsm-trae-panels [role="tab"]')).map(el => ({
    id: el.id, text: (el.textContent||'').trim(), selected: el.getAttribute('aria-selected'), ...box(el),
    underline: cs(el,'border-bottom-color'),
  }))
  out.regions = Array.from(document.querySelectorAll('.dsm-trae-tabs .dsm-trae-tab')).map(el => ({
    text: (el.textContent||'').trim(), selected: el.getAttribute('aria-selected'), ...box(el),
  }))
  out.tabpanels = Array.from(document.querySelectorAll('.dsm-trae-panel')).map(el => ({
    id: el.id, hidden: el.hidden, ...box(el),
  }))
  const regionRow = document.querySelector('.dsm-trae-tabs')
  const sectionStrip = document.querySelector('.dsm-trae-panels')
  out.regionRow = regionRow ? box(regionRow) : null
  out.sectionStrip = sectionStrip ? box(sectionStrip) : null
  out.modelActions = one('.dsm-trae-model-actions')
  out.docHeight = document.body.scrollHeight
  // Anything that scrolls on its own, anywhere inside the open panel: the
  // complaint was about a second scrollbar, so the audit names every one.
  const panel = Array.from(document.querySelectorAll('.dsm-trae-panel')).find(el => !el.hidden)
  out.ownScrollers = panel ? Array.from(panel.querySelectorAll('*')).filter(el => {
    const style = getComputedStyle(el)
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
  }).map(el => ({ cls: String(el.className), ...box(el), maxH: cs(el,'max-height') })) : []
  const pre = document.createElement('pre'); pre.id = 'audit'; pre.textContent = 'AUDIT' + JSON.stringify(out, null, 1); document.body.appendChild(pre)
})
</script>`

describe('panels shot', () => {
  it('writes the html', async () => {
    const { render, fireEvent, cleanup } = await import('@testing-library/react')
    const React = await import('react')
    const { TraeUsageCard } = await import('../src/client/TraeUsageCard.tsx')
    const { TRAE_CARD_CSS } = await import('../src/client/styles.ts')
    const { zh } = await import('../src/client/locales.ts')

    const t = ((key: string, params?: Record<string, unknown>) => {
      const raw = (zh as Record<string, string>)[key] ?? key
      if (params === undefined) return raw
      return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? ''))
    }) as never

    for (const section of ['accounts', 'models', 'diag'] as const) {
      const settings: Record<string, unknown> = { showPointsInMainUi: true }
      const scope = {
        getSnapshot: () => ({ status: 'ready', value: settings, writable: true }),
        subscribe: () => () => {},
        set: async (field: string, next: unknown) => { settings[field] = next; return true },
      }

      const usage = usageDocument()
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('account-status')) {
          return new Response(JSON.stringify({
            id: 'account-1',
            checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true },
          }), { status: 200 })
        }
        return new Response(JSON.stringify(usage), { status: 200 })
      }) as typeof globalThis.fetch

      const { container } = render(
        React.createElement(TraeUsageCard as never, { t, settingsScope: scope as never, view: 'page' }),
      )
      // The usage read is a promise chain: let it land before looking for the
      // section strip, which only exists once a document has arrived.
      await new Promise(resolve => setTimeout(resolve, 60))
      globalThis.fetch = originalFetch

      if (section !== 'accounts') {
        const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"]'))
          .find(button => button.id === `dsm-trae-tab-${section}`)
        if (tab === undefined) throw new Error(`no section tab for ${section}`)
        // Through the harness, not a raw click: React must see the event for the
        // section to repaint before the markup is captured.
        fireEvent.click(tab)
      }

      const html = `<!doctype html><html><head><meta charset="utf-8"><style>${TOKENS}\n${TRAE_CARD_CSS.replace(/<\/style/gi, '<\\/style')}</style></head><body><div class="pane">${container.innerHTML}</div></body></html>`
      writeFileSync(`/tmp/panels-preview-${section}.html`, html.replace('</body>', AUDIT + '</body>'))
      cleanup()
    }
  })
})
