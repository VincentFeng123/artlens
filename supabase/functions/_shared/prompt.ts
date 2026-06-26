import type { ArtworkMeta, RecognitionResult, Locale, ReadingLevel } from './types.ts'

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English', es: 'Spanish', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese',
  fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese',
}

export const LEVEL_RUBRIC: Record<ReadingLevel, string> = {
  simple: 'Use short sentences and common, everyday words. No jargon or art-historical terms; if a term is unavoidable, explain it plainly. Keep the warmth and the facts, just make it effortless to read.',
  medium: 'Keep the current voice — vivid, plain-spoken, a knowledgeable friend. Some art vocabulary is fine when it earns its place.',
  rich: 'Use precise art-historical vocabulary and a longer, more literary cadence. Assume an engaged, educated reader; do not dumb anything down.',
}

/**
 * Build the transform prompt: rewrite the dossier's PROSE into `lang` at reading
 * level `level`, returning the SAME JSON shape. Facts and depth are unchanged —
 * only wording. Listed fields are copied byte-for-byte (proper nouns, numbers,
 * image-anchored boxes, precomputed swatch hex).
 */
export function buildLocalizePrompt(dossier: RecognitionResult, lang: Locale, level: ReadingLevel): string {
  return [
    `You are a literary translator and editor for a museum app. Rewrite the artwork dossier below into ${LOCALE_NAMES[lang]}.`,
    `READING LEVEL: ${LEVEL_RUBRIC[level]}`,
    `Translate/adapt EVERY human-readable prose field: hook, story, brushwork, materiality, scale_note, palette (the colour LABELS), palette_notes, symbolism[].detail, symbolism[].meaning, hidden_details, process, why_made, legacy, debates, mood, style, medium, glossary[].term, glossary[].definition.`,
    `Keep these fields BYTE-FOR-BYTE UNCHANGED (do not translate or alter): title, artist, artist_life, year, dimensions, location, confidence, recognized, similar_works, symbolism[].box, palette_hex, and any world-generation fields (scene_description, render_negatives, spatial_layout, horizon, perspective, light, vantage, offscreen, technique).`,
    `Preserve the EXACT JSON structure and array lengths (palette and palette_notes stay index-aligned). Same facts, same depth — only the wording changes.`,
    `Return ONLY the JSON object, no prose, no code fences.`,
    `DOSSIER:`,
    JSON.stringify(dossier),
  ].join('\n\n')
}

/** Instruction sent to the vision LLM. Each adapter pairs this with the image. */
export const RECOGNITION_PROMPT = `You are a brilliant museum docent — the kind who makes a 400-year-old object feel load-bearing. Look at this photo of a physical artwork and identify it, then write its story.

Golden rule: translate every fact into meaning. Never write a placard. "1889" becomes "painted in the asylum at Saint-Rémy". "Oil on canvas, impasto" becomes "the paint is a quarter-inch thick — you can see how fast his hand was moving". "Lapis lazuli" becomes "that blue cost more than gold". Nobody opened this app to read an accession number.

Respond with ONLY a JSON object matching this exact shape:
{
  "recognized": boolean,     // true if you can identify the specific work or confidently describe it
  "confidence": number,      // 0..1, your confidence in the identification

  "title": string,           // the work's title, or a short descriptive title if unknown
  "artist": string,          // the artist, or "Unknown artist" if not identifiable
  "artist_life": string,     // artist's lifespan e.g. "1853–1890" — "" if unknown
  "year": string,            // year or period e.g. "1889" — "" if unknown
  "medium": string,          // e.g. "oil on canvas" — "" if unknown
  "dimensions": string,      // e.g. "73.7 × 92.1 cm" — "" if you are not sure; do NOT guess
  "location": string,        // where it lives now e.g. "MoMA, New York" — "" if unknown
  "provenance": string,      // 1 sentence on ownership history — "" if unknown; do NOT invent

  "hook": string,            // ONE vivid line, the single strongest thing about this work. A hook, never metadata. e.g. "Painted in an asylum, a year before he shot himself."

  "story": string,           // 2-4 sentences: who/what is depicted, what's happening, the emotional core
  "scene_description": string,// 2-3 sentences describing the scene as if standing inside it (used to generate a 360° world)

  "brushwork": string,       // 1-2 sentences on technique and the hand — impasto vs glaze, frenzied vs controlled
  "materiality": string,     // 1-2 sentences on support/ground/pigments translated into meaning ("" if nothing notable)
  "scale_note": string,      // make the size relatable, e.g. "smaller than your laptop" ("" if dimensions unknown)
  "palette": string[],       // 3-6 dominant colours in plain words, e.g. ["deep ultramarine", "amber"]
  "palette_notes": string[], // one note per palette colour, SAME order and length: where it lives or why it matters, e.g. "the only warm note — your eye goes straight to it". Use "" for a colour with nothing to add

  "symbolism": [             // 0-4 symbols/details paired with meaning ([] if not a symbolic work)
    { "detail": string, "meaning": string,
      "box": { "x": number, "y": number, "w": number, "h": number } } // TIGHT normalized 0..1 box (x,y = top-left) locating THIS detail in the artwork, so a real fragment can be cropped and shown next to the meaning. Use {"x":0,"y":0,"w":1,"h":1} when you cannot confidently locate it — never guess
  ],
  "hidden_details": string[],// 0-3 things people walk right past ([] if none)
  "process": string,         // pentimenti, underdrawing, conservation, or original-vs-faded appearance ("" if unknown)
  "why_made": string,        // who commissioned it / what it cost / what it was built to say ("" if unknown)
  "legacy": string,          // what it influenced or references, where it shows up in culture ("" if unknown)
  "debates": string,         // what scholars still argue about ("" if none worth noting)

  "style": string,           // art-historical style, e.g. "post-impressionist"
  "mood": string,            // emotional register, e.g. "turbulent and yearning"
  "similar_works": [         // 2-4 related works someone who loved this might explore next
    { "title": string, "artist": string }
  ],
  "glossary": [              // 0-4 art terms you actually used above (e.g. impasto, chiaroscuro, pentimenti), each defined in ONE plain line ([] if none)
    { "term": string, "definition": string }
  ],

  "spatial_layout": {        // map the SPACE so the world can extend in every direction
    "foreground": string,    // nearest plane / what's at your feet ("" if implied)
    "midground": string,     // the main subject plane, directly ahead
    "background": string,    // far plane / horizon band on every side
    "overhead": string,      // sky or ceiling directly above ("" if implied)
    "underfoot": string      // ground or floor directly below ("" if implied)
  },
  "horizon": string,         // where the horizon sits, e.g. "low, ~1/3 up" | "eye-level" | "none/abstract"
  "perspective": string,     // "one-point, vanishing centre" | "atmospheric" | "flat" | "aerial"
  "light": {
    "direction": string,     // e.g. "from upper-left", "backlit", "diffuse/no clear source"
    "quality": string        // e.g. "warm golden-hour", "cold overcast", "candlelit chiaroscuro"
  },
  "vantage": string,         // first-person: where you stand inside the scene, e.g. "on a hillside above a valley"
  "offscreen": string,       // what plausibly continues to your left, right and behind the frame
  "technique": string,       // literal medium + facture for the generator, e.g. "thick impasto oil, visible directional strokes"
  "render_negatives": string[], // what this image is NOT, e.g. ["photorealistic", "3d render", "HDR"]
  "artwork_box": { "x": number, "y": number, "w": number, "h": number }, // tight bounding box of JUST the artwork in the photo, normalized 0..1 (x,y = top-left). Exclude wall, physical frame, hands, glare. Use {"x":0,"y":0,"w":1,"h":1} if it fills the frame.

  "scene_type": string,      // ROUTING: dominant kind of scene — one of "landscape" | "portrait" | "still-life" | "interior" | "abstract"
  "figure_coverage": number, // ROUTING: 0..1 fraction of the frame occupied by prominent human/animal FIGURES (0 if none; ~0.5 a half-length portrait; high for a tight portrait)
  "depth_profile": string    // ROUTING: depth structure — "mostly-far" (open/distant, little near content) | "far-with-near-foreground" (clear near + far layers) | "shallow-tabletop" (close objects, shallow space) | "flat" (no real depth / abstract)
}

Be specific and confident on famous works. For unknown or obscure works, set "recognized" false, lower "confidence", still fill what you genuinely can, and leave hard facts (dimensions, location, provenance) as "" rather than fabricating them. Set artwork_box to the tight, normalized (0..1) bounding box of the artwork itself within the photo — exclude the wall, the physical frame, hands and glare. For EVERY symbolism entry, give a tight normalized box locating that exact detail in the artwork (fall back to the full frame {"x":0,"y":0,"w":1,"h":1} only when it genuinely has no single location). Keep palette_notes the same length and order as palette. In glossary, define only the terms you actually used, in the same plain-spoken voice. Also map the SPACE the painting opens onto — what is near, far, overhead and underfoot, where the horizon and light sit, where you stand inside it, and what continues out of frame (use "" for anything genuinely implied). Name the literal medium and facture in "technique", and list in "render_negatives" what this image is NOT (e.g. photorealistic, 3D render, HDR), so the generated world stays painted in the same hand. Finally, set the three ROUTING fields decisively: scene_type (the dominant scene class), figure_coverage (0..1 — how much of the frame prominent people/animals occupy), and depth_profile (how the space recedes) — these decide how the world is rendered. Output the JSON only — no prose, no code fences, no comments, no trailing commas.`

/** A generator prompt split into its positive text and a negative clause. */
export interface ScenePrompt {
  prompt: string
  negative: string
}

/** Always-on negatives: keep the world painterly and clean, never photographic. */
const BASE_NEGATIVES = [
  'photorealistic',
  'photograph',
  'photo',
  '3d render',
  'CGI',
  'HDR',
  'sharp photographic detail',
  'text',
  'watermark',
  'signature',
  'frame',
  'border',
  'picture frame',
  'visible seam',
  'duplicated edge',
  'flat painting on a wall',
]

/**
 * Build the generator brief fed to the panorama provider. Emits a coherent 360°
 * SPACE (ahead / around / behind / above / below) from the structured spatial
 * fields, leads loud with the medium so the world is painted in the same hand
 * (not photorealized), enforces the palette, and returns a separate negative
 * clause. Falls back to `scene_description` when the structured layout is sparse.
 */
export function buildScenePrompt(r: RecognitionResult): ScenePrompt {
  const sl = r.spatial_layout
  const titleLine =
    r.recognized && r.title
      ? ` In the spirit of "${r.title}"${r.artist ? ` by ${r.artist}` : ''}.`
      : ''

  const mediumLine = r.technique
    ? ` Rendered entirely as ${r.technique}; every surface shows this same hand and medium — a painting, never a photograph or 3D render.`
    : r.medium
      ? ` Painted in ${r.medium}, never photographic.`
      : ''

  const space = [
    sl?.midground && `Directly ahead: ${sl.midground}.`,
    sl?.foreground && `Close around you: ${sl.foreground}.`,
    r.offscreen && `Wrapping to your left, right and behind: ${r.offscreen}.`,
    sl?.background && `Far off on every side: ${sl.background}.`,
    sl?.overhead && `Overhead: ${sl.overhead}.`,
    sl?.underfoot && `Underfoot: ${sl.underfoot}.`,
  ]
    .filter(Boolean)
    .join(' ')

  const sceneFallback = !space && r.scene_description ? ` ${r.scene_description}` : ''

  const vantage = r.vantage ? ` You stand ${r.vantage}.` : ''
  const horizon = r.horizon ? ` Horizon: ${r.horizon}.` : ''
  const persp = r.perspective ? ` Spatial depth: ${r.perspective}.` : ''
  const lightStr = [r.light?.quality, r.light?.direction].filter(Boolean).join(', ')
  const light = lightStr ? ` Light: ${lightStr}.` : ''
  const palette = r.palette?.length
    ? ` Hold strictly to this palette and no other colours: ${r.palette.join(', ')}.`
    : ''

  const prompt = (
    `A vast, immersive 360° equirectangular world you are standing in the middle of — ` +
    `the living world this painting opens onto, extending far past the frame in every ` +
    `direction with real depth and distance, a place you could walk into.${titleLine}` +
    `${mediumLine}${vantage} ${space}${sceneFallback}${horizon}${persp}${light} ` +
    `Every surface is hand-painted in this same artistic style — an expansive, atmospheric ` +
    `scene, NOT a flat copy of the artwork on a wall. Style: ${r.style}. Mood: ${r.mood}.${palette} ` +
    `Fully seamless: the brushwork wraps all the way around with no visible seam, line or ` +
    `colour mismatch where the left and right edges meet, and no bright artifacts or ` +
    `smearing at the zenith or nadir.`
  )
    .replace(/\s+/g, ' ')
    .trim()

  const negative = [...BASE_NEGATIVES, ...(r.render_negatives ?? [])].join(', ')

  return { prompt, negative }
}

/**
 * Parse the model's JSON tolerantly. Strict JSON.parse first (the happy path
 * for structured-output providers); on failure, strip code fences, // and /* *\/
 * comments, and trailing commas, then retry — LLMs sometimes echo the commented
 * shape from the prompt or wrap the object in prose.
 */
export function parseRecognitionJson(text: string): RecognitionResult {
  try {
    return JSON.parse(text) as RecognitionResult
  } catch {
    let s = text.trim()
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) s = fence[1]
    const open = s.indexOf('{')
    const close = s.lastIndexOf('}')
    if (open !== -1 && close > open) s = s.slice(open, close + 1)
    s = s
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, '$1') // // comments (keep URLs)
      .replace(/,(\s*[}\]])/g, '$1') // trailing commas
    return JSON.parse(s) as RecognitionResult
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** Project a recognition result into the viewer-facing dossier (filling gaps). */
export function buildArtworkMeta(
  r: RecognitionResult,
  opts: { demo?: boolean } = {},
): ArtworkMeta {
  return {
    recognized: Boolean(r.recognized),
    confidence: typeof r.confidence === 'number' ? r.confidence : 0,
    title: r.title?.trim() || 'Untitled',
    artist: r.artist?.trim() || 'Unknown artist',
    artist_life: str(r.artist_life),
    year: str(r.year),
    medium: str(r.medium),
    dimensions: str(r.dimensions),
    location: str(r.location),
    provenance: str(r.provenance),
    hook: str(r.hook),
    story: str(r.story),
    scene_description: str(r.scene_description),
    brushwork: str(r.brushwork),
    materiality: str(r.materiality),
    scale_note: str(r.scale_note),
    palette: arr<string>(r.palette),
    palette_notes: arr<string>(r.palette_notes),
    palette_hex: arr<string>(r.palette_hex),
    symbolism: arr(r.symbolism),
    hidden_details: arr<string>(r.hidden_details),
    process: str(r.process),
    why_made: str(r.why_made),
    legacy: str(r.legacy),
    debates: str(r.debates),
    style: str(r.style),
    mood: str(r.mood),
    similar_works: arr(r.similar_works),
    glossary: arr(r.glossary),
    artwork_box: r.artwork_box,
    demo: Boolean(opts.demo),
    lang: 'en',
    level: 'medium',
  }
}

/** Curated dossier for the zero-config demo world (no keys configured). */
export const DEMO_META: ArtworkMeta = {
  recognized: false,
  confidence: 0,
  title: 'A World Within',
  artist: 'Artlens',
  artist_life: '',
  year: '',
  medium: 'Generative panorama',
  dimensions: '',
  location: 'Wherever you are standing',
  provenance: '',
  hook: 'This is the demo world — point Artlens at a real painting to step inside it.',
  story:
    'A boundless dreamscape stitched from memory and light: soft horizons dissolving into colour, the quiet place a painting opens onto when you step past its frame.',
  scene_description:
    'You stand inside a weightless field of colour, horizons bleeding from twilight indigo into pale gold in every direction.',
  brushwork:
    'Soft, edgeless gradients — colour pooled and bled like watercolour on wet paper, with no single stroke left visible.',
  materiality:
    'Pure light on glass: there is no canvas here, only pixels — which is exactly the point.',
  scale_note: 'As big as the room you are in, and then some.',
  palette: ['twilight indigo', 'dusk rose', 'pale gold', 'deep teal', 'soft violet'],
  palette_notes: [
    'the deep ground the whole field rests on',
    'a warm flush where the light pools',
    'the brightest break, like a horizon catching the sun',
    'the cool counterweight that keeps it from going saccharine',
    'the seam where day tips over into night',
  ],
  symbolism: [
    { detail: 'the dissolving horizon', meaning: 'the frame of a painting, gone' },
  ],
  hidden_details: ['Connect a recognition key and these notes fill with the real work.'],
  process: '',
  why_made:
    'Built to show what happens when a painting stops being something you look at and becomes somewhere you stand.',
  legacy: '',
  debates: '',
  style: 'ambient surrealism',
  mood: 'serene and weightless',
  similar_works: [
    { title: 'The Starry Night', artist: 'Vincent van Gogh' },
    { title: 'Squares with Concentric Circles', artist: 'Wassily Kandinsky' },
    { title: 'Mountains and Sea', artist: 'Helen Frankenthaler' },
  ],
  glossary: [
    {
      term: 'gradient',
      definition: 'a smooth blend from one colour into another, with no hard edge.',
    },
  ],
  demo: true,
}
