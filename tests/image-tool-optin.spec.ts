/**
 * The `trae_draw_image` opt-in rule, tested where it lives.
 *
 * `drawImagePanelsOf` is the single judgment behind both the tool's
 * registration and its account resolver (review of #62, item 3): while it sat
 * inside `apply()`'s closure, "does ticking the box actually grant anything"
 * could only be code-reviewed. Every case below is one way a settings document
 * can fail to be consent — or one way the two panels this plugin never measured
 * could sneak in.
 */
import { describe, expect, it } from 'vitest'
import { DRAW_IMAGE_PANELS, drawImageEnabledOf, drawImagePanelsOf } from '../src/status-paths.ts'
import { TRAE_PANELS } from '../src/region.ts'

/** A settings section whose CN panel already carries everything but consent. */
const cnTick = { regions: { cn: { drawImageEnabled: true } } }

describe('drawImagePanelsOf', () => {
  it('grants nothing when the user never touched the switch', () => {
    expect(drawImagePanelsOf(undefined)).toEqual([])
    expect(drawImagePanelsOf({})).toEqual([])
    expect(drawImagePanelsOf({ regions: {} })).toEqual([])
    expect(drawImagePanelsOf({ regions: { cn: {} } })).toEqual([])
  })

  it('grants nothing for shapes that are not a settings document', () => {
    for (const value of [null, 'regions', 42, true, [], ['cn']]) {
      expect(drawImagePanelsOf(value)).toEqual([])
    }
  })

  it('accepts only the literal true as consent', () => {
    // A hand-edited 'yes' or 1 is a typo, not a permission to spend credits —
    // the switch is the only writer, and what it writes is a boolean.
    for (const drawImageEnabled of ['yes', 'true', 1, 0, {}]) {
      expect(drawImagePanelsOf({ regions: { cn: { drawImageEnabled } } })).toEqual([])
      expect(drawImageEnabledOf({ regions: { cn: { drawImageEnabled } } }, 'cn')).toBe(false)
    }
    expect(drawImageEnabledOf(cnTick, 'cn')).toBe(true)
  })

  it('decodes a live reference (DSH 0.1.7 slot shape) to the true it holds', () => {
    // Not a loophole: on 0.1.7 settings arrive as {get(): T} live references, so
    // the value has to be decoded before it can be compared at all — and what
    // it holds here is the literal true the Host itself wrote.
    expect(drawImageEnabledOf({ regions: { cn: { drawImageEnabled: { get: () => true } } } }, 'cn')).toBe(true)
    expect(drawImageEnabledOf({ regions: { cn: { drawImageEnabled: { get: () => 'yes' } } } }, 'cn')).toBe(false)
  })

  it('grants the CN panel once the box is ticked', () => {
    expect(drawImagePanelsOf(cnTick)).toEqual(['cn'])
  })

  it('still grants CN on a config written before the provider switch existed', () => {
    // The provider switch is opt-OUT, so an absent `enabled` means "on" — a
    // saved document from an older build must not silently lose its grant.
    expect(drawImagePanelsOf({ regions: { cn: { enabled: undefined, drawImageEnabled: true } } })).toEqual(['cn'])
  })

  it('treats a tick on a switched-off provider as stored consent, not a grant', () => {
    expect(drawImagePanelsOf({ regions: { cn: { enabled: false, drawImageEnabled: true } } })).toEqual([])
    expect(drawImagePanelsOf({ regions: { cn: { enabled: 'false', drawImageEnabled: true } } })).toEqual(['cn'])
  })

  it('keeps the enterprise panel refused even when it is switched on and ticked', () => {
    const granted = drawImagePanelsOf({ regions: { enterprise: { enabled: true, drawImageEnabled: true } } })
    expect(granted).toEqual([])
    expect(granted).not.toContain('enterprise')
  })

  it('does not grant the international panel yet', () => {
    // Image generation has only been measured on Trae CN; the AI path bills on
    // a different plan, so the credit figures this tool quotes would be wrong.
    // This is the review's asymmetry, now pinned: enterprise was refused for
    // being unverified, so AI cannot be allowed for the same reason.
    expect(drawImagePanelsOf({ regions: { ai: { enabled: true, drawImageEnabled: true } } })).toEqual([])
    expect(DRAW_IMAGE_PANELS).not.toContain('ai')
  })

  it('answers CN first when several panels carry the grant', () => {
    const granted = drawImagePanelsOf({
      regions: {
        ai: { enabled: true, drawImageEnabled: true },
        cn: { enabled: true, drawImageEnabled: true },
      },
    })
    expect(granted).toEqual(['cn'])
    // The resolver takes the FIRST entry and stops (it bills real credits), so
    // the order is part of the contract: measured panel before unmeasured ones.
    expect(granted).toEqual(TRAE_PANELS.filter(panel => granted.includes(panel)))
  })

  it('reads the whole settings section and the bare regions map identically', () => {
    expect(drawImagePanelsOf({ regions: { cn: { drawImageEnabled: true } } })).toEqual(['cn'])
    expect(drawImagePanelsOf({ cn: { drawImageEnabled: true } })).toEqual(['cn'])
  })

  it('only ever grants panels listed in DRAW_IMAGE_PANELS', () => {
    const granted = drawImagePanelsOf({
      regions: {
        cn: { enabled: true, drawImageEnabled: true },
        enterprise: { enabled: true, drawImageEnabled: true },
        ai: { enabled: true, drawImageEnabled: true },
      },
    })
    for (const panel of granted) expect(DRAW_IMAGE_PANELS).toContain(panel)
    expect(DRAW_IMAGE_PANELS).not.toContain('enterprise')
  })
})
