import { describe, it, expect } from 'vitest'
import { buildLocalizePrompt } from './prompt.ts'
import type { RecognitionResult } from './types.ts'

const base = { title: 'Mona Lisa', artist: 'Leonardo', hook: 'A face that follows you.', story: 'A woman sits.', palette: ['amber'], palette_hex: ['#e0a32b'] } as unknown as RecognitionResult

describe('buildLocalizePrompt', () => {
  it('names the target language and the reading-level rubric', () => {
    const p = buildLocalizePrompt(base, 'zh-Hans', 'simple')
    expect(p).toContain('Simplified Chinese')
    expect(p.toLowerCase()).toMatch(/tiny sentences|much shorter|very short/) // simple = tinier
    expect(p.toLowerCase()).toMatch(/8-year-old|child|kid/)                   // young audience
    expect(p.toLowerCase()).toMatch(/soften|leave out|gentle/)               // content softening
    expect(p).not.toContain('Same facts, same depth')                         // depth now defers to level
  })
  it('embeds the source dossier and demands the same JSON shape + verbatim fields', () => {
    const p = buildLocalizePrompt(base, 'es', 'rich')
    expect(p).toContain('Mona Lisa')          // dossier present
    expect(p).toContain('palette_hex')        // verbatim-field instruction
    expect(p).toContain('title')
  })
})
