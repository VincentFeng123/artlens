import { describe, it, expect } from 'vitest'
import { RECOGNITION_PROMPT, buildScenePrompt } from './prompt.ts'
import type { RecognitionResult } from './types.ts'

describe('RECOGNITION_PROMPT', () => {
  it('advertises the three realization routing fields', () => {
    expect(RECOGNITION_PROMPT).toContain('scene_type')
    expect(RECOGNITION_PROMPT).toContain('figure_coverage')
    expect(RECOGNITION_PROMPT).toContain('depth_profile')
  })
})

const sample = {
  recognized: true, title: 'Wheatfield', artist: 'Van Gogh',
  style: 'post-impressionist', mood: 'turbulent', technique: 'thick impasto oil',
  medium: 'oil on canvas', palette: ['gold', 'cobalt'],
  perspective: 'aerial', light: { quality: 'golden-hour', direction: 'from upper-left' },
  spatial_layout: { foreground: 'wheat', midground: 'field', background: 'hills', overhead: 'sky', underfoot: 'soil' },
  horizon: 'low', vantage: 'in a field', offscreen: 'more fields', render_negatives: [],
} as unknown as RecognitionResult

describe('buildScenePrompt', () => {
  it('pushes fidelity to the artist hand, subjects, colour/light and composition', () => {
    const { prompt, negative } = buildScenePrompt(sample)
    expect(prompt).toContain('Faithful to "Wheatfield"')                      // hand/style + naming
    expect(prompt.toLowerCase()).toContain('invent nothing foreign')          // subjects
    expect(prompt.toLowerCase()).toContain('same values and saturation')      // colour
    expect(prompt.toLowerCase()).toMatch(/light exactly as in the original|matching shadows/) // light
    expect(prompt.toLowerCase()).toContain('compose the space as the original does')          // composition
    expect(prompt.toLowerCase()).not.toContain('real depth and distance')     // no generic-depth demand
    expect(negative).toContain('oversaturated')                               // colour negative
  })
})
