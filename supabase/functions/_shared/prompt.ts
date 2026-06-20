import type { RecognitionResult } from './types.ts'

/** Instruction sent to the vision LLM. Each adapter pairs this with the image. */
export const RECOGNITION_PROMPT = `You are an art historian. Look at this photo of a physical artwork (a painting, print, drawing, or similar) and identify it.

Respond with ONLY a JSON object matching this exact shape:
{
  "recognized": boolean,        // true if you can identify the specific work or confidently describe it
  "title": string,              // the work's title, or a short descriptive title if unknown
  "artist": string,             // the artist, or "Unknown artist" if not identifiable
  "confidence": number,         // 0..1, your confidence in the identification
  "scene_description": string,  // 2-4 sentences describing the scene/world the artwork depicts, as if you were standing inside it
  "palette": string[],          // 3-6 dominant colors in plain words, e.g. ["deep ultramarine", "amber"]
  "style": string,              // art-historical style, e.g. "post-impressionist"
  "mood": string                // emotional register, e.g. "turbulent and yearning"
}

If the image is not a recognizable artwork, set "recognized" to false but still describe what you see as a scene. Output the JSON only — no prose, no code fences.`

/** Build the generator prompt fed to the panorama provider. */
export function buildScenePrompt(r: RecognitionResult): string {
  const titleLine =
    r.recognized && r.title
      ? ` Inspired by "${r.title}"${r.artist ? ` by ${r.artist}` : ''}.`
      : ''
  const palette = r.palette?.length ? ` Palette: ${r.palette.join(', ')}.` : ''
  return (
    `Extend this artwork into a seamless 360° equirectangular environment. ` +
    `Preserve its subject matter, palette, lighting, brushwork, and mood; ` +
    `the viewer stands inside the scene the painting depicts.${titleLine} ` +
    `Scene: ${r.scene_description} Style: ${r.style}. Mood: ${r.mood}.${palette}`
  ).trim()
}
