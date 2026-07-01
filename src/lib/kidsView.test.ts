import { describe, it, expect } from 'vitest'
import { isKidsLevel, showSection, seeingLabel, paletteLabel, type SectionKey } from './kidsView'

const GATED: SectionKey[] = ['howMade', 'process', 'whyMade', 'stillMatters', 'facts']

describe('isKidsLevel', () => {
  it('is true only for the simple level', () => {
    expect(isKidsLevel('simple')).toBe(true)
    expect(isKidsLevel('medium')).toBe(false)
    expect(isKidsLevel('rich')).toBe(false)
    expect(isKidsLevel(undefined)).toBe(false)
  })
})

describe('showSection', () => {
  it('hides the scholarly sections in kids view', () => {
    for (const s of GATED) expect(showSection(s, 'simple')).toBe(false)
  })
  it('shows every section for teens and adults', () => {
    for (const s of GATED) {
      expect(showSection(s, 'medium')).toBe(true)
      expect(showSection(s, 'rich')).toBe(true)
    }
  })
})

describe('labels', () => {
  it('uses playful kid labels only for the simple level', () => {
    expect(seeingLabel('simple')).toBe('Can you find these?')
    expect(seeingLabel('medium')).toBe("What you're really seeing")
    expect(paletteLabel('simple')).toBe('Colors')
    expect(paletteLabel('rich')).toBe('Palette')
  })
})
