// Deno-side mirror of /shared/types.ts. Keep the two in sync.

export interface SimilarWork {
  title: string
  artist: string
}

export interface SymbolNote {
  detail: string
  meaning: string
  box?: { x: number; y: number; w: number; h: number }
}

export interface GlossaryTerm {
  term: string
  definition: string
}

export interface RecognitionResult {
  recognized: boolean
  confidence: number
  title: string
  artist: string
  artist_life: string
  year: string
  medium: string
  dimensions: string
  location: string
  provenance: string
  hook: string
  story: string
  scene_description: string
  brushwork: string
  materiality: string
  scale_note: string
  palette: string[]
  palette_notes?: string[]
  symbolism: SymbolNote[]
  hidden_details: string[]
  process: string
  why_made: string
  legacy: string
  debates: string
  style: string
  mood: string
  similar_works: SimilarWork[]
  glossary?: GlossaryTerm[]

  // ── World-building: spatial/360 structure fed to the panorama generator ──
  // Optional on the type (older cached rows / the demo dossier may omit them),
  // but required in RECOGNITION_JSON_SCHEMA so live scans always produce them.
  spatial_layout?: {
    foreground: string
    midground: string
    background: string
    overhead: string
    underfoot: string
  }
  horizon?: string
  perspective?: string
  light?: {
    direction: string
    quality: string
  }
  vantage?: string
  offscreen?: string
  technique?: string
  render_negatives?: string[]
  artwork_box?: { x: number; y: number; w: number; h: number }
}

export interface ArtworkMeta extends RecognitionResult {
  demo: boolean
}

export type JobStatusValue = 'pending' | 'generating' | 'ready' | 'error'

export interface ScanReadyResponse {
  status: 'ready'
  panorama_url: string
  depth_url?: string | null
  title: string
  artist: string
  meta?: ArtworkMeta
  demo?: boolean
}

export interface ScanGeneratingResponse {
  status: 'generating'
  job_id: string
  title: string
  artist: string
  meta?: ArtworkMeta
}

export interface ScanErrorResponse {
  status: 'error'
  error: string
}

export type ScanResponse =
  | ScanReadyResponse
  | ScanGeneratingResponse
  | ScanErrorResponse

export interface JobStatusResponse {
  id: string
  status: JobStatusValue
  panorama_url: string | null
  depth_url?: string | null
  error: string | null
  title: string | null
  artist: string | null
  meta?: ArtworkMeta | null
}
