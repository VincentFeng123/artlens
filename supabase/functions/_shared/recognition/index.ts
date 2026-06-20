import type { RecognitionResult } from '../types.ts'
import { recognizeWithClaude } from './claude.ts'
import { recognizeWithGemini } from './gemini.ts'
import { recognizeWithOpenAI } from './openai.ts'

export interface RecognitionInput {
  /** Base64 (no data: prefix) of the captured JPEG frame. */
  imageBase64: string
  mime: string
}

export interface RecognitionProvider {
  recognize(input: RecognitionInput): Promise<RecognitionResult>
}

/** JSON Schema shared by the Claude (output_config) and OpenAI (json_schema) adapters. */
export const RECOGNITION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    recognized: { type: 'boolean' },
    title: { type: 'string' },
    artist: { type: 'string' },
    confidence: { type: 'number' },
    scene_description: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' } },
    style: { type: 'string' },
    mood: { type: 'string' },
  },
  required: [
    'recognized',
    'title',
    'artist',
    'confidence',
    'scene_description',
    'palette',
    'style',
    'mood',
  ],
  additionalProperties: false,
} as const

function selected(): 'claude' | 'gemini' | 'openai' {
  const v = (Deno.env.get('RECOGNITION_PROVIDER') ?? 'claude').toLowerCase()
  return v === 'gemini' || v === 'openai' ? v : 'claude'
}

export function getRecognitionProvider(): RecognitionProvider {
  switch (selected()) {
    case 'gemini':
      return { recognize: recognizeWithGemini }
    case 'openai':
      return { recognize: recognizeWithOpenAI }
    case 'claude':
      return { recognize: recognizeWithClaude }
  }
}

/** True when the API key for the *selected* provider is present. */
export function hasRecognitionKey(): boolean {
  switch (selected()) {
    case 'gemini':
      return Boolean(Deno.env.get('GEMINI_API_KEY'))
    case 'openai':
      return Boolean(Deno.env.get('OPENAI_API_KEY'))
    case 'claude':
      return Boolean(Deno.env.get('ANTHROPIC_API_KEY'))
  }
}
