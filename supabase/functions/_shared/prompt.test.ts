import { describe, it, expect } from 'vitest'
import { RECOGNITION_PROMPT } from './prompt.ts'

describe('RECOGNITION_PROMPT', () => {
  it('advertises the three realization routing fields', () => {
    expect(RECOGNITION_PROMPT).toContain('scene_type')
    expect(RECOGNITION_PROMPT).toContain('figure_coverage')
    expect(RECOGNITION_PROMPT).toContain('depth_profile')
  })
})
