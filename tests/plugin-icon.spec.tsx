// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRequire } from 'node:module'
const { JSDOM } = createRequire(import.meta.url)('jsdom')
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginIcon, IconStylePreference, iconStyleSnapshot, setIconStyle } from '../src/client/plugin-icon.tsx'

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const storageWindow = new JSDOM('', { url: 'https://plugin.test' }).window
  vi.stubGlobal('localStorage', storageWindow.localStorage)
  vi.stubGlobal('Storage', storageWindow.Storage)
})

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => { root.unmount() })
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function mount() {
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  roots.push(root)
  await act(async () => { root.render(h('div', null, h(PluginIcon, { className: 'live-icon' }), h(IconStylePreference, { t: key => key }))) })
  return element
}
describe('plugin icon preference', () => {
  it('starts on THIS plugin\'s own icon, not the Claude skin', async () => {
    // The default used to be 'claude', so a first-time user got a re-drawn
    // silhouette before asking for anything and had to go find the product's
    // own artwork as an option. An unset preference must mean the shipped icon.
    const element = await mount()
    expect(iconStyleSnapshot()).toBe('original')
    expect(element.querySelector('img.live-icon')).not.toBeNull()
    expect(element.querySelector('svg.live-icon')).toBeNull()
    // ...and the radio group must agree with what is drawn.
    const radios = element.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true')
    expect(radios[0]!.getAttribute('aria-checked')).toBe('false')
  })

  it('switches all live icons and persists the selected style across remounts', async () => {
    const element = await mount()
    // Starts as our own icon; the FIRST radio is the Claude skin.
    expect(element.querySelector('img.live-icon')).not.toBeNull()
    await act(async () => { element.querySelectorAll<HTMLButtonElement>('[role="radio"]')[0]!.click() })
    expect(iconStyleSnapshot()).toBe('claude')
    expect(element.querySelector('svg.live-icon')).not.toBeNull()
    const remounted = await mount()
    expect(remounted.querySelector('svg.live-icon')).not.toBeNull()
    // ...and back to our own icon.
    await act(async () => { setIconStyle('original') })
    expect(element.querySelector('img.live-icon')).not.toBeNull()
    expect(remounted.querySelector('img.live-icon')).not.toBeNull()
  })

  it('keeps the previous choice and reports a browser storage refusal', async () => {
    const element = await mount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    // Choose the NON-default option, so "kept the previous choice" is a real
    // assertion: if the refusal fell back to the default it would read as
    // success and this test would pass while the icon silently reverted.
    await act(async () => { element.querySelectorAll<HTMLButtonElement>('[role="radio"]')[0]!.click() })
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('row.iconStyleSaveFailed')
    expect(iconStyleSnapshot()).toBe('original')
    expect(element.querySelector('img.live-icon')).not.toBeNull()
  })
})
