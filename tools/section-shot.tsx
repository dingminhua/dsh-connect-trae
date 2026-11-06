// @vitest-environment jsdom
/**
 * The `settings.section` page (`surface: 'section'`), rendered with REAL zh
 * strings into /tmp/section-preview.html so its geometry can be measured rather
 * than guessed.
 *
 * Why a third dump beside `panels-shot.tsx` (the Plugins-page card) and
 * `page-shot.tsx` (the sidebar page): all three wrap the same body in different
 * chrome, and the settings shell's column is NOT the centre column — it is a
 * modal dialog with its own width and height, so measuring the other two says
 * nothing about whether the section uses the space it is given.
 *
 * The questions this answers, none of which the specs can:
 *
 *  1. how much of the dialog's height does the section actually occupy, and
 *     where is the vertical space being spent (region chips, hint, section
 *     strip, preferences, table)?
 *  2. how many PIXELS separate the top of the section from the first actionable
 *     control, and how many pixels of it are pure chrome?
 *  3. on a dialog-height viewport, what falls below the fold?
 *
 *   pnpm section:shot
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --hide-scrollbars --window-size=1000,760 \
 *     --screenshot=/tmp/section-shot.png file:///tmp/section-preview.html
 *
 * Lives in `tools/` for the same reason the sibling shots do: it writes files
 * and needs a real browser to measure anything.
 */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { DEMO_NICKNAME, DEMO_NUMERIC_ID } from './demo-accounts.ts'

function catalog(): Record<string, unknown>[] {
  const names = ['DeepSeek-V4.1-Flash', 'GLM-5.2', 'Kimi-K3', 'Qwen3-Max-Thinking-Preview-2026', 'Doubao-Seed-1.6']
  // THREE WINDOW SHAPES on purpose. The context-budget control is a select whose
  // option COUNT varies per model, and a fixture where every model offers one
  // window cannot show whether the control is stable across rows — which is the
  // thing the select was meant to fix.
  return Array.from({ length: 12 }, (_, index) => ({
    id: `model-${index}`,
    name: `${names[index % names.length] as string}${index >= names.length ? ` (${index})` : ''}`,
    contextWindow: 200_000,
    // index 0, 3, 6, 9 → dev + 500K + Max; index 1, 4, 7, 10 → dev + Max
    // (400K, so no 500K middle step); the rest keep a single read-only window.
    ...(index % 3 === 0 ? { maxContextWindow: 1_000_000 } : index % 3 === 1 ? { maxContextWindow: 400_000 } : {}),
    maxTokens: 32_000,
  }))
}

function usageDocument(): Record<string, unknown> {
  const models = catalog()
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: DEMO_NUMERIC_ID,
    tokenExpiresAtMs: Date.now() + 3_600_000,
    refreshExpiresAtMs: Date.now() + 10 * 86_400_000,
    region: 'cn',
    enabled: true,
    sidebarPanelEnabled: true,
    accounts: [
      { id: 'account-1', accountName: DEMO_NUMERIC_ID, edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
      { id: 'account-2', accountName: DEMO_NICKNAME, edition: 'solo', region: 'cn', source: 'cli', tokenExpiresAtMs: Date.now() + 7_200_000, selected: false },
    ],
    models,
    enabledModelIds: models.filter((_, index) => index % 2 === 0).map(model => model.id),
    imageModelIds: [],
    credits: { total: 9_600, consumed: 3_141.28, available: 6_458.72, workAvailable: 0, generalAvailable: 96.42, accounts: [] },
    checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 },
    // THE POOL IS PART OF THE SHIPPING LAYOUT. The live desktop profile
    // (cordis.patch.yml) runs with `regions.cn.pool.enabled: true` and three
    // members, so `TraeAccountPanel` renders `<AccountPool>` — the five-track
    // table — and NOT the two-column roster. A fixture without `pool` measures
    // the one layout this plugin is least likely to be seen in, and that is
    // exactly how the "420px of fixed tracks" problem stayed invisible while
    // the tab was being redesigned.
    pool: {
      enabled: true,
      checkinSupported: true,
      deleteSupported: true,
      copies: { path: '~/.trae/pool/cn', count: 3 },
      targetModelId: 'deepseek-v4.1-flash',
      targetModelSource: 'preferred',
      probeInputTokens: 0,
      memberAccountIds: ['account-1', 'account-2', 'account-3'],
      effectiveMemberAccountIds: ['account-1', 'account-2', 'account-3'],
      memberNames: { 'account-1': DEMO_NUMERIC_ID, 'account-2': DEMO_NICKNAME, 'account-3': 'demo-third' },
      accounts: [
        // Each account carries a REAL probe record: the measured screenshot that
        // prompted this work showed four stacked lines in the status cell
        // ("正常 / 测得 3 天前 / 来自测速 / upstream answered") squeezing the
        // account name to a bare prefix. A fixture whose rows are all "never tested"
        // renders ONE line there and hides the whole problem.
        {
          accountId: 'account-1', accountName: DEMO_NUMERIC_ID, current: true, member: true, reachable: true,
          credits: 517, generalAvailable: 96.42, workAvailable: 0, checkedInToday: false,
          probe: { outcome: 'ok', atMs: Date.now() - 3 * 24 * 3600_000, source: 'test-batch', modelId: 'deepseek-v4.1-flash' },
        },
        {
          accountId: 'account-2', accountName: DEMO_NICKNAME, current: false, member: true, reachable: true,
          credits: 517, generalAvailable: 145.6, workAvailable: 500, checkedInToday: true,
          probe: { outcome: 'ok', atMs: Date.now() - 3 * 24 * 3600_000, source: 'test-batch', modelId: 'deepseek-v4.1-flash' },
        },
        {
          accountId: 'account-3', accountName: 'demo-third', current: false, member: true, reachable: true,
          credits: 268, generalAvailable: 73.9, workAvailable: 40, checkedInToday: false,
          probe: { outcome: 'ok', atMs: Date.now() - 3 * 24 * 3600_000, source: 'test-batch', modelId: 'deepseek-v4.1-flash' },
        },
      ],
    },
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
html,body{margin:0;background:#eceef1;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;color:#0f1115}
/* THE REAL SHELL, copied from ui-settings-general's own stylesheet rather than
   approximated: the panel is 800x800 (bounded by the viewport), a two-column
   grid of 188px | 1fr, and the SECTION lands in .options — a scrolling column
   with 0 24px 24px padding. So the width this plugin actually gets is
   800 - 188 - 48 = 564px, not the 950px a naive full-width fixture shows. */
.dialog{box-sizing:border-box;width:800px;height:800px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;
  display:grid;grid-template:"title header" "nav options" minmax(0,1fr)/188px minmax(0,1fr)}
.dialog-title{grid-area:title;padding:22px 12px 8px 24px;font-size:16px;font-weight:500;line-height:24px;color:#0f1115}
.dialog-header{grid-area:header;height:54px;padding:20px 14px 8px 10px;display:flex;justify-content:flex-end;align-items:flex-start;font-size:13px;color:#8b9099}
.dialog-nav{grid-area:nav;display:flex;flex-direction:column;gap:4px;min-height:0;padding:10px 12px 0;overflow-y:auto}
.dialog-nav i{display:block;height:40px;border-radius:8px;padding:9px 16px 9px 12px;font-style:normal;font-size:14px;line-height:22px;color:#0f1115}
.dialog-nav i.on{background:rgba(15,17,21,.06)}
.dialog-body{grid-area:options;min-width:0;min-height:0;padding:0 24px 24px;overflow-y:auto}
`

/** The in-page audit: geometry that has to be MEASURED rather than eyeballed. */
const AUDIT = `
<script>
addEventListener('load', () => {
  const out = {}
  const box = (el) => { const r = el.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } }
  const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const section = document.querySelector('.dsm-trae-section')
  out.dialog = (() => { const el = document.querySelector('.dialog'); return el ? box(el) : null })()
  out.scrollColumn = (() => { const el = document.querySelector('.dialog-body'); return el ? { ...box(el), scrollH: el.scrollHeight, clientH: el.clientHeight } : null })()
  out.section = section
    ? { ...box(section), scrollH: section.scrollHeight, display: cs(section, 'display'), height: cs(section, 'height') }
    : null
  // The shell's own scroll column: does the plugin's own scroller (if any)
  // duplicate it? Two nested scrollers is the failure mode a "fill the height"
  // rewrite is most likely to introduce.
  out.columnOverflow = (() => {
    const el = document.querySelector('.dialog-body')
    return el === null ? null : cs(el, 'overflow-y')
  })()
  const part = (sel, key) => {
    const el = document.querySelector(sel)
    if (el) out[key] = { ...box(el), scrollH: el.scrollHeight, text: (el.textContent || '').trim().slice(0, 40) }
  }
  part('.dsm-trae-section-head', 'head')
  part('.dsm-trae-tabs', 'regionChips')
  part('.dsm-trae-tab-hint', 'regionHint')
  part('.dsm-trae-panels', 'sectionStrip')
  part('.dsm-trae-prefs', 'prefs')
  part('.dsm-trae-accounts', 'accounts')
  part('.dsm-trae-account-table', 'table')
  part('.dsm-trae-pool-card', 'poolCard')
  part('.dsm-trae-pool-table', 'poolTable')
  // The five-track pool table is the binding constraint on a narrow column:
  // 128 + 96 + 128 of FIXED tracks plus the gaps and padding are unavailable
  // to the account and probe cells no matter how wide the column is.
  out.poolRow = (() => {
    const el = document.querySelector('.dsm-trae-pool-row')
    if (el === null) return null
    const cols = cs(el, 'grid-template-columns')
    const widths = Array.from(el.children).map(child => Math.round(child.getBoundingClientRect().width))
    return { cols, widths, ...box(el) }
  })()
  out.poolRows = Array.from(document.querySelectorAll('.dsm-trae-pool-row')).map(el => ({
    head: el.classList.contains('dsm-trae-pool-row-head'),
    ...box(el),
  }))
  // What the five tracks cost BEFORE any flexible share: the fixed ones plus
  // the gaps plus the side padding. Printed so the rail budget is arithmetic
  // on a measured number rather than on a recollection of the CSS.
  out.poolFixedTracks = (() => {
    const el = document.querySelector('.dsm-trae-pool-row')
    if (el === null) return null
    const tokens = cs(el, 'grid-template-columns').split(/\s+/)
    const fixed = tokens.filter(token => !token.includes('fr') && token !== '').length
    const gaps = Math.max(0, tokens.length - 1) * parseFloat(cs(el, 'column-gap') || '0')
    const pad = parseFloat(cs(el, 'padding-left') || '0') + parseFloat(cs(el, 'padding-right') || '0')
    return { fixedCount: fixed, gaps: Math.round(gaps), pad: Math.round(pad), total: Math.round(gaps + pad) }
  })()
  out.regionChipsCells = Array.from(document.querySelectorAll('.dsm-trae-tab-cell')).map(el => ({
    text: (el.textContent || '').trim().slice(0, 20), ...box(el),
  }))
  out.panelTabs = Array.from(document.querySelectorAll('.dsm-trae-panel-tab')).map(el => ({
    text: (el.textContent || '').trim().slice(0, 20),
    active: el.classList.contains('dsm-trae-panel-tab-active'),
    ...box(el),
  }))
  out.rows = Array.from(document.querySelectorAll('.dsm-trae-account-row')).map(el => ({
    head: el.classList.contains('dsm-trae-account-row-head'), ...box(el),
  }))
  // Vertical spend above the first actionable control (the rescan button or the
  // first checkbox), and the gap between the sections.
  const first = document.querySelector('.dsm-trae-prefs input, .dsm-trae-accounts button')
  out.firstControl = first ? { cls: String(first.className).slice(0, 40), ...box(first) } : null
  out.ownScrollers = Array.from(document.querySelectorAll('.dsm-trae-section *')).filter(el => {
    const style = getComputedStyle(el)
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
  }).map(el => ({ cls: String(el.className).slice(0, 60), ...box(el) }))
  out.windowHeight = window.innerHeight
  const pre = document.createElement('pre'); pre.id = 'audit'; pre.textContent = 'AUDIT' + JSON.stringify(out, null, 1); document.body.appendChild(pre)
})
</script>`

describe('section shot', () => {
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
        surface: 'section',
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 60))
    globalThis.fetch = originalFetch

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${TOKENS}\n${TRAE_CARD_CSS.replace(/<\/style/gi, '<\\/style')}</style></head><body><div class="dialog"><div class="dialog-title">设置</div><div class="dialog-header">✕</div><div class="dialog-nav"><i class="on">账号</i><i>通用</i><i>模型</i><i>插件</i><i>dsh-connect-trae</i></div><div class="dialog-body">${container.innerHTML}</div></div></body></html>`
    writeFileSync('/tmp/section-preview.html', html.replace('</body>', AUDIT + '</body>'))
  })
})
