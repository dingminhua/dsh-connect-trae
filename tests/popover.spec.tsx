// @vitest-environment jsdom
/**
 * The local popover hooks (`src/client/popover.ts`).
 *
 * These replaced the shell's primitives after a value import of that package
 * took the whole client half down (see `client-runtime-imports.spec.ts`). Owning
 * the code means owning these behaviours, so they are pinned directly here
 * rather than assumed to match the shell.
 *
 * jsdom does no layout, so the geometry is supplied explicitly: the anchor's
 * `getBoundingClientRect` and the panel's `offsetWidth`/`offsetHeight` are
 * stubbed, which is also what makes the assertions exact instead of approximate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { overlayTopMargin, useAnchoredPosition, useDismissOnOutsidePointer } from '../src/client/popover.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Give an element the box jsdom will not compute for it. */
function box(element: HTMLElement, rect: Partial<DOMRect>, size: { w?: number; h?: number } = {}): void {
  element.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  }) as DOMRect
  Object.defineProperty(element, 'offsetWidth', { value: size.w ?? 0, configurable: true })
  Object.defineProperty(element, 'offsetHeight', { value: size.h ?? 0, configurable: true })
}

/**
 * Renders the anchored hook with the geometry applied in the REF phase.
 *
 * Order matters: React attaches refs before it runs layout effects, so stubbing
 * the boxes from a ref callback means the hook's first measurement already sees
 * them. Stubbing after `render()` would be too late — the effect would have
 * measured jsdom's all-zero boxes.
 */
function AnchoredProbe(props: {
  rect: Partial<DOMRect>
  size: { w: number; h: number }
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
}): JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const { rect, size, side, align } = props
  const position = useAnchoredPosition({
    open: true,
    anchorRef,
    panelRef,
    gap: 8,
    margin: 12,
    ...side === undefined ? {} : { side },
    ...align === undefined ? {} : { align },
  })
  return (
    <div>
      <div ref={element => { anchorRef.current = element; if (element !== null) box(element, rect) }} />
      <div
        ref={element => {
          panelRef.current = element
          if (element !== null) box(element, {}, size)
        }}
        data-testid="panel"
        data-left={position === null || position === undefined ? '' : String(position.left)}
        data-top={position === null || position === undefined ? '' : String(position.top)}
      />
    </div>
  )
}

/** The rendered position, or a loud failure when the hook produced none. */
function positionOf(getByTestId: (id: string) => HTMLElement): { left: number; top: number } {
  const panel = getByTestId('panel')
  const left = panel.getAttribute('data-left')
  const top = panel.getAttribute('data-top')
  expect(left, 'the hook produced no left').not.toBe('')
  return { left: Number(left), top: Number(top) }
}

describe('useAnchoredPosition', () => {
  it('places the panel ABOVE the anchor, offset by the gap, aligned to its left edge', () => {
    const { getByTestId } = render(
      <AnchoredProbe side="top" rect={{ top: 300, left: 120, bottom: 320, right: 260 }} size={{ w: 200, h: 80 }} />,
    )
    // 300 - 8 (gap) - 80 (height) = 212
    expect(positionOf(getByTestId)).toEqual({ left: 120, top: 212 })
  })

  it('places the panel BELOW the anchor when asked', () => {
    const { getByTestId } = render(
      <AnchoredProbe side="bottom" rect={{ top: 300, left: 120, bottom: 320, right: 260 }} size={{ w: 200, h: 80 }} />,
    )
    // 320 + 8 = 328
    expect(positionOf(getByTestId)).toEqual({ left: 120, top: 328 })
  })

  it('aligns to the anchor RIGHT edge when asked', () => {
    const { getByTestId } = render(
      <AnchoredProbe align="end" side="top" rect={{ top: 300, left: 120, bottom: 320, right: 260 }} size={{ w: 200, h: 80 }} />,
    )
    // 260 (right) - 200 (width) = 60
    expect(positionOf(getByTestId)).toEqual({ left: 60, top: 212 })
  })

  it('clamps a panel that would cross the LEFT margin', () => {
    const { getByTestId } = render(
      <AnchoredProbe side="top" rect={{ top: 300, left: -50, bottom: 320, right: 90 }} size={{ w: 200, h: 80 }} />,
    )
    // left would be -50; clamped up to the 12px margin.
    expect(positionOf(getByTestId).left).toBe(12)
  })

  it('clamps a panel that would cross the RIGHT margin', () => {
    const { getByTestId } = render(
      <AnchoredProbe side="top" rect={{ top: 300, left: 5000, bottom: 320, right: 5200 }} size={{ w: 200, h: 80 }} />,
    )
    // left would be 5000; clamped to innerWidth - width - margin.
    expect(positionOf(getByTestId).left).toBe(window.innerWidth - 200 - 12)
  })

  it('clamps a panel that would cross the BOTTOM margin', () => {
    const { getByTestId } = render(
      <AnchoredProbe side="bottom" rect={{ top: 5000, left: 10, bottom: 5020, right: 50 }} size={{ w: 200, h: 80 }} />,
    )
    expect(positionOf(getByTestId).top).toBe(window.innerHeight - 80 - 12)
  })

  it('leaves the axis alone when the panel has not been measured yet', () => {
    // A zero measurement must not pin the panel to the margin: the clamp arms
    // are guarded on a positive size.
    const { getByTestId } = render(
      <AnchoredProbe side="top" rect={{ top: 300, left: 120, bottom: 320, right: 260 }} size={{ w: 0, h: 0 }} />,
    )
    expect(positionOf(getByTestId)).toEqual({ left: 120, top: 300 - 8 - 0 })
  })

  it('produces no position while closed', () => {
    function Closed(): JSX.Element {
      const anchorRef = useRef<HTMLDivElement | null>(null)
      const panelRef = useRef<HTMLDivElement | null>(null)
      const position = useAnchoredPosition({ open: false, anchorRef, panelRef, gap: 8, margin: 12 })
      return <div data-testid="closed" data-value={position === null ? 'null' : 'set'} />
    }
    expect(render(<Closed />).getByTestId('closed').getAttribute('data-value')).toBe('null')
  })

  it('falls back to the requested margin when the frame-clearance variable is absent', () => {
    // jsdom has no `--dsh-frame-top-clearance`, so the parse yields NaN and the
    // helper must return `min` — a NaN top would hide the panel entirely.
    expect(overlayTopMargin(19)).toBe(19)
    expect(overlayTopMargin(12)).toBe(12)
  })
})

/**
 * Fire a pointerdown at an element.
 *
 * jsdom implements no `PointerEvent`, and constructing one throws
 * (`ReferenceError: PointerEvent is not defined`). The hook reads only
 * `event.type` and `event.target`, so a bubbling `Event` of the same name
 * exercises exactly the same path — and avoids shipping a polyfill that could
 * itself diverge from the browser.
 */
function pointerDown(element: HTMLElement): void {
  element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

/** Renders the dismissal hook with real elements to click. */
function DismissProbe(props: { open: boolean; setOpen: (v: boolean) => void; portal: boolean }): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const portalRef = useRef<HTMLDivElement | null>(null)
  useDismissOnOutsidePointer(rootRef, props.open, props.setOpen, props.portal ? portalRef : undefined)
  return (
    <div>
      <div ref={rootRef} data-testid="root"><span data-testid="inside">inside</span></div>
      <div ref={portalRef} data-testid="portal"><span data-testid="on-panel">panel</span></div>
      <span data-testid="outside">outside</span>
    </div>
  )
}

describe('useDismissOnOutsidePointer', () => {
  it('closes on a pointerdown outside the anchor', () => {
    const setOpen = vi.fn()
    const { getByTestId } = render(<DismissProbe open setOpen={setOpen} portal />)
    pointerDown(getByTestId('outside'))
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('does NOT close when the press lands on the anchor', () => {
    const setOpen = vi.fn()
    const { getByTestId } = render(<DismissProbe open setOpen={setOpen} portal />)
    pointerDown(getByTestId('inside'))
    expect(setOpen).not.toHaveBeenCalled()
  })

  it('does NOT close when the press lands on the PORTALED panel', () => {
    // The panel is portaled to document.body, so it is not a descendant of the
    // anchor. Without the portal exception, pressing the refresh button inside
    // the panel would dismiss the panel instead of refreshing.
    const setOpen = vi.fn()
    const { getByTestId } = render(<DismissProbe open setOpen={setOpen} portal />)
    pointerDown(getByTestId('on-panel'))
    expect(setOpen).not.toHaveBeenCalled()
  })

  it('treats a portaled panel as outside when NO portal ref was supplied', () => {
    // Documents the contract: the caller must hand over the portal ref.
    const setOpen = vi.fn()
    const { getByTestId } = render(<DismissProbe open setOpen={setOpen} portal={false} />)
    pointerDown(getByTestId('on-panel'))
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('listens only while open', () => {
    const setOpen = vi.fn()
    const { getByTestId } = render(<DismissProbe open={false} setOpen={setOpen} portal />)
    pointerDown(getByTestId('outside'))
    expect(setOpen).not.toHaveBeenCalled()
  })
})
