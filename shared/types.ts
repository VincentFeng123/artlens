// Shared contract between the React client and the Supabase Edge Functions.
// The Edge Functions keep a Deno-side mirror at
// supabase/functions/_shared/types.ts — keep the two in sync.

/** One related work the viewer might explore next. */
export interface SimilarWork {
  title: string
  artist: string
}

/** A symbol or detail in the work, paired with what it means. */
export interface SymbolNote {
  /** What's in the picture, e.g. "the blown-out candle". */
  detail: string
  /** What it signifies, e.g. "a death in the room". */
  meaning: string
}

/**
 * Strict JSON the vision LLM must return. Every field is already translated
 * into *meaning*, never raw catalogue data — the card is a story, not a placard.
 * Organised by the layers the viewer reveals: glance → lean-in → rabbit hole.
 */
export interface RecognitionResult {
  recognized: boolean
  /** 0..1 confidence in the identification. */
  confidence: number

  // ── Identity (reference, buried behind a tap) ──────────────────────────
  title: string
  artist: string
  /** Artist's lifespan, e.g. "1853–1890" — "" when unknown. */
  artist_life: string
  year: string
  medium: string
  /** Physical size, e.g. "73.7 × 92.1 cm" — "" when unknown. */
  dimensions: string
  /** Where it lives now, e.g. "MoMA, New York" — "" when unknown. */
  location: string
  /** Brief ownership history — "" when unknown. */
  provenance: string

  // ── Glance: the always-on hook (a line, never metadata) ────────────────
  hook: string

  // ── Lean-in: what you're looking at ────────────────────────────────────
  /** Subject, action and emotional core — the main story (2-4 sentences). */
  story: string
  /** First-person scene description that feeds the panorama generator. */
  scene_description: string

  // ── How it was made ────────────────────────────────────────────────────
  brushwork: string
  /** Support, ground, pigments, surface — translated into meaning. */
  materiality: string
  /** Dimensions made relatable, e.g. "smaller than your laptop". */
  scale_note: string
  /** Dominant colours in plain words, e.g. ["deep ultramarine", "amber"]. */
  palette: string[]

  // ── Rabbit hole ────────────────────────────────────────────────────────
  /** Symbols/details paired with what they mean. */
  symbolism: SymbolNote[]
  /** Things people walk right past. */
  hidden_details: string[]
  /** Pentimenti, underdrawing, conservation, original-vs-faded appearance. */
  process: string
  /** Who commissioned it, what it cost, what it was built to say. */
  why_made: string
  /** What it influenced/references, where it shows up in culture. */
  legacy: string
  /** What scholars still argue about — "" when none worth noting. */
  debates: string

  // ── Extras kept for the world + suggestions ────────────────────────────
  style: string
  mood: string
  similar_works: SimilarWork[]

  // ── World-building: spatial/360 structure fed to the panorama generator ──
  // Optional on the type (older cached rows / the demo dossier may omit them),
  // but required in RECOGNITION_JSON_SCHEMA so live scans always produce them.
  /** What sits at each depth plane and pole — drives the directional 360 brief. */
  spatial_layout?: {
    foreground: string
    midground: string
    background: string
    overhead: string
    underfoot: string
  }
  /** Where the horizon sits, e.g. "low, ~1/3 up" | "eye-level" | "none/abstract". */
  horizon?: string
  /** Depth cue, e.g. "one-point, vanishing centre" | "atmospheric" | "flat" | "aerial". */
  perspective?: string
  /** Light direction + quality. */
  light?: {
    direction: string
    quality: string
  }
  /** First-person place the viewer stands inside the scene. */
  vantage?: string
  /** What plausibly continues left/right/behind the frame (the wrap-around). */
  offscreen?: string
  /** Literal medium + facture for the generator, e.g. "thick impasto oil". */
  technique?: string
  /** What the image is NOT — steers the generator away from photorealism. */
  render_negatives?: string[]
  /**
   * Bounding box of JUST the artwork within the captured photo (excludes wall,
   * physical frame, hands, glare), normalized 0..1 with x,y the top-left corner.
   * Used to crop the photo down to the clean artwork.
   */
  artwork_box?: { x: number; y: number; w: number; h: number }
}

/**
 * The full artwork dossier carried from recognition all the way to the viewer's
 * info card — {@link RecognitionResult} plus presentation flags.
 */
export interface ArtworkMeta extends RecognitionResult {
  /** True when this is the zero-config demo world (curated, not a real scan). */
  demo: boolean
}

export type JobStatusValue = 'pending' | 'generating' | 'ready' | 'error'

export interface ScanReadyResponse {
  status: 'ready'
  panorama_url: string
  /** Equirectangular depth PNG URL for parallax (Blockade Model 3); null/absent otherwise. */
  depth_url?: string | null
  title: string
  artist: string
  /** Full artwork dossier for the viewer's info card. */
  meta?: ArtworkMeta
  /** True when served by the zero-config demo path (no keys configured). */
  demo?: boolean
}

export interface ScanGeneratingResponse {
  status: 'generating'
  job_id: string
  title: string
  artist: string
  /**
   * Recognition completes before generation, so the dossier is available here
   * already — the client holds it while polling for the panorama.
   */
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

/** Shape returned by the `job-status` function (the `jobs` row, trimmed). */
export interface JobStatusResponse {
  id: string
  status: JobStatusValue
  panorama_url: string | null
  /** Equirectangular depth PNG URL for parallax; null when none. */
  depth_url?: string | null
  error: string | null
  title: string | null
  artist: string | null
  /** Dossier, when the backend carries it through the job (dev path). */
  meta?: ArtworkMeta | null
}
