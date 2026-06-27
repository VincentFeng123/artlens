import type { RecognitionResult } from './types.ts'
import type { Locale, ReadingLevel } from './types.ts'
import { buildLocalizePrompt, parseRecognitionJson } from './prompt.ts'

/**
 * Transform a base dossier into (lang, level) via Gemini, returning the same
 * shape. Uses GEMINI_API_KEY (the project's default recognition provider key).
 * Throws on hard failure; the caller falls back to the base dossier.
 */
export async function transformDossier(
  base: RecognitionResult,
  lang: Locale,
  level: ReadingLevel,
): Promise<RecognitionResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash'

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildLocalizePrompt(base, lang, level) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 8192 },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini localize ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error('Gemini localize returned no text')
  const out = parseRecognitionJson(text)
  // Carry the structurally-fixed fields through verbatim — never trust the model to.
  out.title = base.title; out.artist = base.artist; out.artist_life = base.artist_life
  out.year = base.year; out.dimensions = base.dimensions; out.location = base.location
  out.similar_works = base.similar_works; out.palette_hex = base.palette_hex
  out.recognized = base.recognized; out.confidence = base.confidence
  if (Array.isArray(out.symbolism) && Array.isArray(base.symbolism)) {
    out.symbolism.forEach((s, i) => { if (base.symbolism[i]) s.box = base.symbolism[i].box })
  }
  out.scene_description = base.scene_description
  out.render_negatives = base.render_negatives
  out.spatial_layout = base.spatial_layout
  out.horizon = base.horizon
  out.perspective = base.perspective
  out.light = base.light
  out.vantage = base.vantage
  out.offscreen = base.offscreen
  out.technique = base.technique
  return out
}
