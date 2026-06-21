import type { RecognitionResult } from '../types.ts'
import { RECOGNITION_PROMPT, parseRecognitionJson } from '../prompt.ts'
import { RECOGNITION_JSON_SCHEMA, type RecognitionInput } from './index.ts'

/**
 * OpenAI vision recognition via Chat Completions. A strict `json_schema`
 * response format guarantees the message content is valid JSON matching
 * RECOGNITION_JSON_SCHEMA.
 */
export async function recognizeWithOpenAI({
  imageBase64,
  mime,
}: RecognitionInput): Promise<RecognitionResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o'

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: RECOGNITION_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${imageBase64}` },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'artwork_recognition',
          strict: true,
          schema: RECOGNITION_JSON_SCHEMA,
        },
      },
      max_completion_tokens: 3072, // headroom for the spatial/style world-building fields
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('OpenAI returned no content')
  return parseRecognitionJson(text)
}
