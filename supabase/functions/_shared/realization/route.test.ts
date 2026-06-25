import { describe, it, expect } from 'vitest'
import type { SceneType } from '../types.ts'
import { routeRealization } from './route.ts'

describe('routeRealization', () => {
  it('renders a prominent figure flat, never depth (the warped-person guard)', () => {
    expect(
      routeRealization({
        scene_type: 'portrait',
        figure_coverage: 0.6,
        depth_profile: 'far-with-near-foreground',
      }),
    ).toBe('flat')
  })

  it('renders abstract art flat', () => {
    expect(
      routeRealization({ scene_type: 'abstract', figure_coverage: 0, depth_profile: 'far-with-near-foreground' }),
    ).toBe('flat')
  })

  it('renders a mostly-far vista flat (depth adds negligible parallax)', () => {
    expect(
      routeRealization({ scene_type: 'landscape', figure_coverage: 0, depth_profile: 'mostly-far' }),
    ).toBe('flat')
  })

  it('renders a landscape with real foreground as depth-parallax', () => {
    expect(
      routeRealization({
        scene_type: 'landscape',
        figure_coverage: 0.05,
        depth_profile: 'far-with-near-foreground',
      }),
    ).toBe('depth')
  })

  it('renders a shallow still-life as depth-parallax', () => {
    expect(
      routeRealization({
        scene_type: 'still-life',
        figure_coverage: 0.1,
        depth_profile: 'shallow-tabletop',
      }),
    ).toBe('depth')
  })

  it('defaults to depth when signals are missing (preserves today\'s behavior)', () => {
    expect(routeRealization({})).toBe('depth')
  })

  it('invariant: figure_coverage > 0.35 never routes to depth', () => {
    const scenes: SceneType[] = ['landscape', 'portrait', 'still-life', 'interior', 'abstract']
    for (const scene_type of scenes) {
      expect(
        routeRealization({
          scene_type,
          figure_coverage: 0.5,
          depth_profile: 'far-with-near-foreground',
        }),
      ).toBe('flat')
    }
  })
})
