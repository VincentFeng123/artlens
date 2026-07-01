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
  it('renders the pill label and the active level button from value', () => {
    const el = render({ lang: 'ja', level: 'rich' }, () => {})
    expect(el.querySelector('.world__lang-pill')!.textContent).toBe(LANG_LABEL.ja)
    const btns = Array.from(el.querySelectorAll('.world__level-btn')) as HTMLButtonElement[]
    expect(btns.map((b) => b.textContent)).toEqual(LEVELS.map((l) => LEVEL_LABEL[l]))
    const active = btns.find((b) => b.classList.contains('is-active'))!
    expect(active.textContent).toBe(LEVEL_LABEL.rich)
    expect(active.getAttribute('aria-pressed')).toBe('true')
  })

  it('calls onChange with the picked language', () => {
    const onChange = vi.fn()
    const el = render({ lang: 'en', level: 'medium' }, onChange)
    const buttons = Array.from(el.querySelectorAll('.world__lang-menu button')) as HTMLButtonElement[]
    const es = buttons.find((b) => b.textContent === LANG_LABEL.es)!
    act(() => { es.click() })
    expect(onChange).toHaveBeenCalledWith({ lang: 'es', level: 'medium' })
  })

  it('calls onChange with the picked reading level on a button click', () => {
    const onChange = vi.fn()
    const el = render({ lang: 'en', level: 'medium' }, onChange)
    const btns = Array.from(el.querySelectorAll('.world__level-btn')) as HTMLButtonElement[]
    const kids = btns.find((b) => b.textContent === LEVEL_LABEL.simple)!
    act(() => { kids.click() })
    expect(onChange).toHaveBeenCalledWith({ lang: 'en', level: 'simple' })
  })
})
