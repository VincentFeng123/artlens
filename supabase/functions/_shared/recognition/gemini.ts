import type { RecognitionResult } from '../types.ts'
import { RECOGNITION_PROMPT } from '../prompt.ts'
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
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-1.5-flash'

  const res = await fetch(
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
  return JSON.parse(text) as RecognitionResult
}
