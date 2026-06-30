// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DossierControls, LANG_LABEL, LEVELS, LEVEL_LABEL, type DossierPref } from './DossierControls'

// React 18 requires this flag for act() outside a test renderer.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(value: DossierPref, onChange: (n: DossierPref) => void): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(createElement(DossierControls, { value, onChange })) })
  return container
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  container = null
  root = null
})

describe('DossierControls', () => {
  it('renders the pill label and slider position from value', () => {
    const el = render({ lang: 'ja', level: 'rich' }, () => {})
    expect(el.querySelector('.world__lang-pill')!.textContent).toBe(LANG_LABEL.ja)
    const slider = el.querySelector('.world__level') as HTMLInputElement
    expect(slider.value).toBe(String(LEVELS.indexOf('rich')))
    expect(el.querySelector('.world__level-label')!.textContent).toBe(LEVEL_LABEL.rich)
  })

  it('calls onChange with the picked language', () => {
    const onChange = vi.fn()
    const el = render({ lang: 'en', level: 'medium' }, onChange)
    const buttons = Array.from(el.querySelectorAll('.world__lang-menu button')) as HTMLButtonElement[]
    const es = buttons.find((b) => b.textContent === LANG_LABEL.es)!
    act(() => { es.click() })
    expect(onChange).toHaveBeenCalledWith({ lang: 'es', level: 'medium' })
  })

  it('calls onChange with the new level on a slider move', () => {
    const onChange = vi.fn()
    const el = render({ lang: 'en', level: 'medium' }, onChange)
    const slider = el.querySelector('.world__level') as HTMLInputElement
    // Bypass React's value tracking so the synthetic onChange fires.
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setNativeValue.call(slider, '0')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({ lang: 'en', level: 'simple' })
  })
})
