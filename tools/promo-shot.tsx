// @vitest-environment jsdom
/**
 * The model rows, rendered with REAL zh strings into `promo-preview.html`, so
 * the promotion capsule can be LOOKED AT instead of guessed at — the same
 * reasoning as `tools/card-shot.tsx`, applied to the rows it does not cover.
 *
 * Why a separate tool: the capsule's whole point is that it fits in a single
 * line beside an ellipsis-truncated name. A jsdom assertion can prove the
 * element is outside the name span (`tests/card-promo.spec.tsx`), but not that
 * it still fits next to the tick box, nor that `5 折` reads comfortably at
 * 10px. That needs pixels.
 *
 *   pnpm promo:shot
 *   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
 *     --headless=new --hide-scrollbars --window-size=760,900 \
 *     --screenshot=%TEMP%\promo-preview.png %TEMP%\promo-preview.html
 *
 * The page lists one row per real case measured on 2026-10-21: a live subsidy,
 * an open off-peak window, a night-only window that is closed right now (so the
 * row must paint nothing), and a row with no rule at all. Lives in `tools/`, not
 * `tests/`, because it writes a file and is run by hand.
 */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('promo shot', () => {
  it('writes the html', async () => {
    const { render } = await import('@testing-library/react')
    const React = await import('react')
    const { fireEvent, waitFor } = await import('@testing-library/react')
    const { TraeUsageCard } = await import('../src/client/TraeUsageCard.tsx')
    const { TRAE_CARD_CSS } = await import('../src/client/styles.ts')
    const { zh } = await import('../src/client/locales.ts')
    const { parseTraeActivityDiscount } = await import('../src/promo.ts')
    const { TRAE_USAGE_PATH, withTraeRegion } = await import('../src/status-paths.ts')

    const t = ((key: string, params?: Record<string, unknown>) => {
      const raw = (zh as Record<string, string>)[key] ?? key
      if (params === undefined) return raw
      return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? ''))
    }) as never

    const rule = (value: unknown) => {
      const parsed = parseTraeActivityDiscount(value)
      if (parsed === undefined) throw new Error('fixture is not a promotion document')
      return parsed
    }

    const models = [
      {
        id: 'Doubao-Seed-2.1-Turbo', name: 'Doubao-Seed-2.1-Turbo', contextWindow: 256_000, maxTokens: 32_768, creditMultiplier: 0.4,
        // Upstream's own "discounted right now": 0.4 → 0.2, member 0.1.
        activityDiscount: rule({
          enable: true, subKey: 'subsidy_member_discount',
          data: {
            current: { discount_type: 'subsidy', before_consumption_rate: 0.4, consumption_rate: 0.2, discount: 50 },
            member: { before_consumption_rate: 0.4, after_consumption_rate: 0.1, discount: 25 },
          },
        }),
      },
      {
        id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', contextWindow: 200_000, maxTokens: 16_384, creditMultiplier: 0.12,
        // Cheap hours, open all week: judged live by the LOCAL clock.
        activityDiscount: rule({
          enable: true, subKey: 'off_peak_member_discount_18_9',
          data: {
            current: { discount_type: 'none', before_consumption_rate: 0.12, consumption_rate: 0.12, discount: 100 },
            member: { before_consumption_rate: 0.12, after_consumption_rate: 0.06, discount: 50 },
            off_peak: {
              before_consumption_rate: 0.12, after_consumption_rate: 0.06, discount: 50, time_zone: 'Asia/Shanghai',
              time_windows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start_minute: 0, end_minute: 1440 }],
            },
          },
        }),
      },
      {
        id: 'DeepSeek-V4-Pro-Official', name: 'DeepSeek-V4-Pro-Official', contextWindow: 200_000, maxTokens: 16_384, creditMultiplier: 0.12,
        // A window that is closed at any hour except 03:00–03:30, so this row
        // must paint NOTHING most of the time: the capsule is not decoration.
        activityDiscount: rule({
          enable: true, subKey: 'off_peak_discount',
          data: {
            current: { discount_type: 'none', before_consumption_rate: 0.12, consumption_rate: 0.12, discount: 100 },
            off_peak: {
              before_consumption_rate: 0.12, after_consumption_rate: 0.06, discount: 50, time_zone: 'Asia/Shanghai',
              time_windows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start_minute: 180, end_minute: 210 }],
            },
          },
        }),
      },
      {
        id: 'glm-5.3', name: 'glm-5.3', contextWindow: 200_000, maxTokens: 16_384, creditMultiplier: 0.79,
        // No rule at all: a plain row, for comparison.
      },
      {
        // The clipping case the capsule must survive: a long name with a badge.
        id: 'a-very-long-model-name-that-would-be-clipped-by-ellipsis', name: 'a-very-long-model-name-that-would-be-clipped-by-ellipsis',
        contextWindow: 128_000, maxTokens: 8_192, creditMultiplier: 1,
        activityDiscount: rule({
          enable: true, subKey: 'limited_discount',
          data: { current: { discount_type: 'subsidy', before_consumption_rate: 1, consumption_rate: 0.5, discount: 50 } },
        }),
      },
    ]

    const document_ = {
      status: 'signed-in', accountId: 'account-1', accountName: 'LaoDing',
      tokenExpiresAtMs: Date.now() + 3_600_000, region: 'cn', enabled: true, accounts: [],
      models, enabledModelIds: models.map(model => model.id),
      credits: { total: 7500, consumed: 5000, available: 2500, workAvailable: 0, generalAvailable: 2500, accounts: [] },
    }

    const fetchStub = async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith(withTraeRegion(TRAE_USAGE_PATH, 'cn'))) return new Response(JSON.stringify(document_), { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    }
    ;(globalThis as { fetch: unknown }).fetch = fetchStub

    let value: Record<string, unknown> = {}
    const listeners = new Set<() => void>()
    const scope = {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        value = { ...value, [field]: next }
        for (const listener of listeners) listener()
      },
    }

    // `view: 'page'` renders the full form directly. The old code clicked the
    // card's title instead, which stopped being enough once the card was split
    // into sections — and it never waited for the usage read to land, so the
    // section strip (which only exists once a document has arrived) was not there
    // to press. That is why this tool failed from 4.3.0 on.
    const view = render(React.createElement(TraeUsageCard, { t, settingsScope: scope as never, view: 'page' }))
    // The usage read is a promise chain: let it land before looking for tabs.
    await new Promise(resolve => setTimeout(resolve, 60))
    // A section tab is a `<button role="tab">`, so it is queried by DOM rather
    // than by role — an explicit role overrides the element's implicit one, and
    // the id is the one `panels-shot` uses.
    const modelsTab = Array.from(view.container.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"]'))
      .find(tab => tab.id === 'dsm-trae-tab-models')
    if (modelsTab === undefined) throw new Error('no models tab')
    fireEvent.click(modelsTab)
    await waitFor(() => { if (view.queryByRole('region', { name: '模型' }) === null) throw new Error('no model list') })

    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>promo preview</title>
<style>${TRAE_CARD_CSS}
body{margin:0;background:#fff;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif}
#shot{width:auto;max-width:720px;margin:16px auto;padding:16px}
</style></head><body><div id="shot">${view.container.innerHTML}</div></body></html>`
    const out = join(tmpdir(), 'promo-preview.html')
    writeFileSync(out, html, 'utf8')
    console.log(`wrote ${out}`)
  })
})
