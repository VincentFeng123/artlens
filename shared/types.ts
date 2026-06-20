// Shared contract between the React client and the Supabase Edge Functions.
// The Edge Functions keep a Deno-side mirror at
// supabase/functions/_shared/types.ts — keep the two in sync.

/** Strict JSON the vision LLM must return when recognizing an artwork. */
export interface RecognitionResult {
  recognized: boolean
  title: string
  artist: string
  /** 0..1 confidence in the recognition. */
  confidence: number
  /** Rich description of the scene the painting depicts, fed to the generator. */
  scene_description: string
  /** Dominant colors, e.g. ["deep ultramarine", "amber"]. */
  palette: string[]
  /** Art-historical style, e.g. "post-impressionist". */
  style: string
  /** Emotional register, e.g. "turbulent, yearning". */
  mood: string
}

export type JobStatusValue = 'pending' | 'generating' | 'ready' | 'error'

export interface ScanReadyResponse {
  status: 'ready'
  panorama_url: string
  title: string
  artist: string
  /** True when served by the zero-config demo path (no keys configured). */
  demo?: boolean
}

export interface ScanGeneratingResponse {
  status: 'generating'
  job_id: string
  title: string
  artist: string
}

export interface ScanErrorResponse {
  status: 'error'
  error: string
}

export type ScanResponse =
  | ScanReadyResponse
  | ScanGeneratingResponse
  | ScanErrorResponse

/** Shape returned by the `job-status` function (the `jobs` row, trimmed). */
export interface JobStatusResponse {
  id: string
  status: JobStatusValue
  panorama_url: string | null
  error: string | null
  title: string | null
  artist: string | null
}
