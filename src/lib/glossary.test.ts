import { describe, it, expect } from 'vitest'
import { isCjk } from './glossary'

describe('isCjk', () => {
  it('is true for Chinese/Japanese/Korean, false for Latin', () => {
    expect(isCjk('zh-Hans')).toBe(true)
    expect(isCjk('zh-Hant')).toBe(true)
    expect(isCjk('ja')).toBe(true)
    expect(isCjk('ko')).toBe(true)
    expect(isCjk('en')).toBe(false)
    expect(isCjk('es')).toBe(false)
  })
})
