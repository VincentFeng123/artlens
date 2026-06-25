import type { Realization, SceneType, DepthProfile } from '../types.ts'

/** Signals the router reads. All optional — missing signals fall back safely. */
export interface RealizationSignals {
  scene_type?: SceneType
  /** 0..1 fraction of the frame occupied by prominent figures (people/animals). */
  figure_coverage?: number
  depth_profile?: DepthProfile
  /** 0..1 recognition confidence. Reserved for Milestone B (S3 demotion). */
  confidence?: number
}

/** Above this figure coverage, depth displacement rubber-sheets the silhouette. */
const FIGURE_GUARD = 0.35

/**
 * Pick the render strategy for one artwork (Milestone A: 'flat' | 'depth').
 *
 * A prominent figure is NEVER depth-displaced — the single connected depth-mesh
 * smears the silhouette — so it renders flat until Milestone B can separate it
 * into its own layer. Abstract and depth-less scenes also render flat (depth
 * would invent fake geometry). Everything else, including unknown/absent
 * signals, gets today's depth-parallax; the client still degrades to flat when
 * no depth map is available, so this never does worse than the current world.
 */
export function routeRealization(s: RealizationSignals): Realization {
  if ((s.figure_coverage ?? 0) > FIGURE_GUARD) return 'flat'
  if (s.scene_type === 'abstract') return 'flat'
  if (s.depth_profile === 'flat' || s.depth_profile === 'mostly-far') return 'flat'
  return 'depth'
}
