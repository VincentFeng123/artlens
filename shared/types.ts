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
  /**
   * Tight bounding box of this detail within the artwork image, normalized 0..1
   * (x,y = top-left) — lets the viewer crop a real fragment of the painting to
   * show beside the meaning. Full-frame ({x:0,y:0,w:1,h:1}) or absent when the
   * model can't localize it; the client then falls back to text only.
   */
  box?: { x: number; y: number; w: number; h: number }
}

/** An art-vocabulary term used in the prose, with a one-line definition. */
export interface GlossaryTerm {
  /** The term as it appears in the text, e.g. "impasto". */
  term: string
  /** A plain, one-line definition (≤15 words). */
  definition: string
}

/** Which renderer the world uses, chosen per-artwork by the realization router. */
export type Realization = 'flat' | 'depth' | 'layered'

/** Coarse scene class the router reads to pick a realization strategy. */
export type SceneType =
  | 'landscape'
  | 'portrait'
  | 'still-life'
  | 'interior'
  | 'abstract'

/** Coarse depth structure the router reads to pick a realization strategy. */
export type DepthProfile =
  | 'mostly-far'
  | 'far-with-near-foreground'
  | 'shallow-tabletop'
  | 'flat'

/** Reading level for the dossier prose — same facts, vocabulary scales. */
export type ReadingLevel = 'simple' | 'medium' | 'rich'

/** Supported dossier languages (BCP-47-ish). English is the base/source. */
export type Locale = 'en' | 'es' | 'zh-Hans' | 'zh-Hant' | 'fr' | 'de' | 'ja' | 'ko' | 'pt'

/** The locales offered in the picker, in display order. */
export const SUPPORTED_LOCALES: Locale[] = ['en', 'es', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'ja', 'ko', 'pt']

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
  /**
   * One note per {@link palette} entry (index-aligned): where that colour lives
   * in the work or why it matters. "" when there's nothing worth saying.
   * Optional so older/skewed payloads degrade to static swatches.
   */
  palette_notes?: string[]
  /**
   * Display hex (index-aligned to {@link palette}) precomputed from the English
   * colour names at base generation, so localized variants render correct
   * swatches even when the colour *labels* are translated. Optional for back-compat.
   */
  palette_hex?: string[]

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
  /**
   * Art-vocabulary terms used in the prose, each with a one-line definition, so
   * the viewer can surface them as tappable glossary chips. Optional/[] when none.
   */
  glossary?: GlossaryTerm[]

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

  // ── 3D realization routing (drives flat vs depth-mesh vs — later — layered) ──
  // Optional on the type (older cached rows / the demo dossier omit them); the
  // router defaults safely when absent.
  /** Coarse scene class — the dominant kind of scene. */
  scene_type?: SceneType
  /** 0..1 fraction of the frame occupied by prominent figures (people/animals). */
  figure_coverage?: number
  /** Coarse depth structure of the scene. */
  depth_profile?: DepthProfile
}

/**
 * The full artwork dossier carried from recognition all the way to the viewer's
 * info card — {@link RecognitionResult} plus presentation flags.
 */
export interface ArtworkMeta extends RecognitionResult {
  /** True when this is the zero-config demo world (curated, not a real scan). */
  demo: boolean
  /** Which language this dossier is rendered in (default 'en'). */
  lang?: Locale
  /** Which reading level this dossier is rendered at (default 'medium'). */
  level?: ReadingLevel
}

export type JobStatusValue = 'pending' | 'generating' | 'ready' | 'error'

export interface ScanReadyResponse {
  status: 'ready'
  panorama_url: string
  /** Equirectangular depth PNG URL for parallax (Blockade Model 3); null/absent otherwise. */
  depth_url?: string | null
  /** Render strategy chosen by the realization router; absent → client default. */
  realization?: Realization
  title: string
  artist: string
  /** Full artwork dossier for the viewer's info card. */
  meta?: ArtworkMeta
  /** The cached artwork's id, so the client can request localized variants. */
  artwork_id?: string | null
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
  /** The cached artwork's id, so the client can request localized variants. */
  artwork_id?: string | null
  /** Render strategy chosen by the realization router; absent → client default. */
  realization?: Realization
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
  /** Render strategy chosen by the realization router; null/absent → client default. */
  realization?: Realization | null
  error: string | null
  title: string | null
  artist: string | null
  /** Dossier, when the backend carries it through the job (dev path). */
  meta?: ArtworkMeta | null
  /** The cached artwork's id, so the client can request localized variants. */
  artwork_id?: string | null
}
