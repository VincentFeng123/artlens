// Deno-side mirror of /shared/types.ts. Keep the two in sync.

export interface RecognitionResult {
  recognized: boolean
  title: string
  artist: string
  confidence: number
  scene_description: string
  palette: string[]
  style: string
  mood: string
}

export type JobStatusValue = 'pending' | 'generating' | 'ready' | 'error'

export interface ScanReadyResponse {
  status: 'ready'
  panorama_url: string
  title: string
  artist: string
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

export interface JobStatusResponse {
  id: string
  status: JobStatusValue
  panorama_url: string | null
  error: string | null
  title: string | null
  artist: string | null
}
