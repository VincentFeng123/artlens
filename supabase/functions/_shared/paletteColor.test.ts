import { describe, it, expect } from 'vitest'
import { paletteColor, buildPaletteHex } from './paletteColor.ts'

describe('paletteColor (Deno mirror)', () => {
  it('returns a 6-digit hex for a known colour', () => {
    expect(paletteColor('ultramarine')).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('darkens with the "deep" adjective', () => {
    expect(paletteColor('deep ultramarine')).not.toBe(paletteColor('ultramarine'))
  })
  it('falls back to a stable hex for an unknown name', () => {
    expect(paletteColor('zorblax')).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('buildPaletteHex is index-aligned', () => {
    const out = buildPaletteHex(['ultramarine', 'amber', 'bone'])
    expect(out).toHaveLength(3)
    out.forEach((h) => expect(h).toMatch(/^#[0-9a-f]{6}$/i))
  })
})
