import { generateWithBlockade } from './blockade.ts'
import { generateWithPollinations } from './pollinations.ts'

export interface PanoramaInput {
  /** Public URL (preferred) or base64 of the source artwork — the structure reference. */
  referenceImage: string
  /** Scene description fed to the generator. */
  prompt: string
  /** Negative clause for providers that accept one (Blockade `negative_text`). */
  negative?: string
}

export interface PanoramaResult {
  /** Equirectangular panorama PNG URL. */
  equirectPngUrl: string
  /** Equirectangular depth PNG URL, when the provider yields one inline (Blockade Model 3). */
  depthUrl?: string
}

export interface PanoramaProvider {
  generate(input: PanoramaInput): Promise<PanoramaResult>
}

function selected(): 'blockade' | 'pollinations' {
  const v = (Deno.env.get('PANORAMA_PROVIDER') ?? 'blockade').toLowerCase()
  return v === 'pollinations' ? 'pollinations' : 'blockade'
}

export function getPanoramaProvider(): PanoramaProvider {
  switch (selected()) {
    case 'pollinations':
      return { generate: generateWithPollinations }
    case 'blockade':
      return { generate: generateWithBlockade }
  }
}

/**
 * True when the selected provider can run: pollinations needs no key; blockade
 * needs BLOCKADE_LABS_API_KEY. (Imagen/Flux/etc. drop in behind the same
 * interface, selected via PANORAMA_PROVIDER.)
 */
export function hasPanoramaProvider(): boolean {
  if (selected() === 'pollinations') return true
  return Boolean(Deno.env.get('BLOCKADE_LABS_API_KEY'))
}
