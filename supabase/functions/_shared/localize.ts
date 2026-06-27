import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ArtworkMeta, Locale, ReadingLevel, RecognitionResult } from './types.ts'
import { buildArtworkMeta, buildLocalizePrompt, parseRecognitionJson } from './prompt.ts'

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

/**
 * Transform `source` into (lang, level), normalize to a full ArtworkMeta, and —
 * when `artworkId` is set — upsert it into `artwork_content`. Returns the
 * localized dossier. Mirrors steps 3–4 of `localize/index.ts` so an
 * EAGER-generated cache entry is byte-identical to the on-demand one (same
 * buildArtworkMeta normalization, same carried lang/level/palette_hex). The
 * upsert is non-fatal; only a failed transform throws (the caller decides).
 */
export async function localizeAndCache(
  admin: SupabaseClient,
  artworkId: string | null,
  source: ArtworkMeta,
  lang: Locale,
  level: ReadingLevel,
): Promise<ArtworkMeta> {
  const out = await transformDossier(source, lang, level)
  const localized = buildArtworkMeta(out, { demo: Boolean(source.demo) })
  localized.lang = lang
  localized.level = level
  localized.palette_hex = source.palette_hex
  if (artworkId) {
    try {
      await admin.from('artwork_content')
        .upsert({ artwork_id: artworkId, lang, level, dossier: localized })
    } catch (e) {
      console.error('eager-gen cache upsert failed (non-fatal)', e)
    }
  }
  return localized
}
