import Anthropic from 'npm:@anthropic-ai/sdk'
import type { RecognitionResult } from '../types.ts'
import { RECOGNITION_PROMPT } from '../prompt.ts'
import { RECOGNITION_JSON_SCHEMA, type RecognitionInput } from './index.ts'

/**
 * Anthropic Claude vision recognition using the official SDK. Structured output
 * is forced via `output_config.format` (GA on claude-opus-4-8), so the first
 * text block is guaranteed-valid JSON matching RECOGNITION_JSON_SCHEMA.
 */
export async function recognizeWithClaude({
  imageBase64,
  mime,
}: RecognitionInput): Promise<RecognitionResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-4-8'

  const client = new Anthropic({ apiKey })

  // `output_config` is GA but may not be in this SDK build's static types;
  // the params shape comes from current Anthropic docs.
  const params = {
    model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: RECOGNITION_PROMPT },
          {
            type: 'image',
            source: { type: 'base64', media_type: mime, data: imageBase64 },
          },
        ],
      },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RECOGNITION_JSON_SCHEMA },
    },
    // deno-lint-ignore no-explicit-any
  } as any

  const message = (await client.messages.create(params)) as {
    content: Array<{ type: string; text?: string }>
  }

  const text = message.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('Claude returned no text content')
  return JSON.parse(text) as RecognitionResult
}
