// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import { detectLocale, getPref, setPref } from './contentPref'

// Initialize localStorage polyfill if not available
beforeAll(() => {
  if (typeof localStorage === 'undefined') {
    const store: Record<string, string> = {}
    ;(global as any).localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { Object.keys(store).forEach(k => delete store[k]) },
      key: (index: number) => Object.keys(store)[index] || null,
      get length() { return Object.keys(store).length },
    }
  }
})

beforeEach(() => localStorage.clear())

describe('contentPref', () => {
  it('detectLocale maps a navigator language to a supported Locale', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' }); expect(detectLocale()).toBe('zh-Hans')
    vi.stubGlobal('navigator', { language: 'zh-TW' }); expect(detectLocale()).toBe('zh-Hant')
    vi.stubGlobal('navigator', { language: 'es-MX' }); expect(detectLocale()).toBe('es')
    vi.stubGlobal('navigator', { language: 'xx' }); expect(detectLocale()).toBe('en')
  })
  it('getPref defaults to detected locale + medium, persists via setPref', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' })
    expect(getPref()).toEqual({ lang: 'fr', level: 'medium' })
    setPref({ lang: 'ja', level: 'rich' })
    expect(getPref()).toEqual({ lang: 'ja', level: 'rich' })
  })
})
