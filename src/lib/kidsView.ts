import type { ReadingLevel } from '../../shared/types'

/**
 * The Kids view is the `simple` reading level rendered stripped-down for young
 * children: fewer sections, playful labels, no glossary chips. These pure helpers
 * hold that decision so it is unit-testable without mounting the 3D WorldViewer.
 */

/** True when the dossier should render in the kid-friendly Kids view. */
export function isKidsLevel(level: ReadingLevel | undefined): boolean {
  return level === 'simple'
}

/** Dossier sections whose visibility varies by reading level. */
export type SectionKey = 'howMade' | 'process' | 'whyMade' | 'stillMatters' | 'facts'

/** Scholarly/dense sections hidden in the Kids view. */
const KID_HIDDEN: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'howMade',
  'process',
  'whyMade',
  'stillMatters',
  'facts',
])

/** Whether `section` renders at reading `level`. Kids view hides the scholarly set. */
export function showSection(section: SectionKey, level: ReadingLevel | undefined): boolean {
  return isKidsLevel(level) ? !KID_HIDDEN.has(section) : true
}

/** Label for the symbolism/hidden-details section — a seek-and-find prompt for kids. */
export function seeingLabel(level: ReadingLevel | undefined): string {
  return isKidsLevel(level) ? 'Can you find these?' : "What you're really seeing"
}

/** Label for the palette section — plain "Colors" for kids. */
export function paletteLabel(level: ReadingLevel | undefined): string {
  return isKidsLevel(level) ? 'Colors' : 'Palette'
}
