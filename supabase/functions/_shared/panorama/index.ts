import { generateWithBlockade } from './blockade.ts'

export interface PanoramaInput {
  /** Public URL (preferred) or base64 of the source artwork — the structure reference. */
  referenceImage: string
  /** Scene description fed to the generator. */
  prompt: string
}

export interface PanoramaProvider {
  generate(input: PanoramaInput): Promise<{ equirectPngUrl: string }>
}

function selected(): 'blockade' {
  // Only Blockade is implemented in v1. Imagen/Flux/etc. drop in here behind
  // the same interface, selected via PANORAMA_PROVIDER.
  return 'blockade'
}

export function getPanoramaProvider(): PanoramaProvider {
  switch (selected()) {
    case 'blockade':
      return { generate: generateWithBlockade }
  }
}

export function hasPanoramaKey(): boolean {
  switch (selected()) {
    case 'blockade':
      return Boolean(Deno.env.get('BLOCKADE_LABS_API_KEY'))
  }
}
