import type { RecognitionResult } from '../types.ts'
import { RECOGNITION_PROMPT, parseRecognitionJson } from '../prompt.ts'
import type { RecognitionInput } from './index.ts'

/**
 * Google Gemini vision recognition via the generateContent REST endpoint.
 * `responseMimeType: application/json` forces a JSON-only response; the exact
 * shape is guided by RECOGNITION_PROMPT (avoids Gemini's responseSchema dialect).
 */
export async function recognizeWithGemini({
  imageBase64,
  mime,
}: RecognitionInput): Promise<RecognitionResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash'

  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: RECOGNITION_PROMPT },
              { inline_data: { mime_type: mime, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          // gemini-2.5/3.x are "thinking" models: thinking tokens count against
          // maxOutputTokens. The dossier needs ~800 output tokens on top of
          // ~1.3k thinking tokens; 2048 truncated the JSON mid-array. 8192 is
          // ample headroom for both.
          maxOutputTokens: 8192,
        },
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error('Gemini returned no text content')
  return parseRecognitionJson(text)
}

// Gemini intermittently returns 503 UNAVAILABLE ("high demand … spikes are
// usually temporary") or 429. Without a retry, one transient blip fails the
// whole scan (no world, no info). Retry transient statuses with backoff.
async function fetchGeminiWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  const transient = new Set([429, 500, 503, 529])
  let res = await fetch(url, init)
  for (let i = 1; i < attempts && !res.ok && transient.has(res.status); i++) {
    await new Promise((r) => setTimeout(r, 800 * i))
    res = await fetch(url, init)
  }
  return res
}
