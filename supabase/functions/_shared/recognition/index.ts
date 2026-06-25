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
    confidence: { type: 'number' },
    title: { type: 'string' },
    artist: { type: 'string' },
    artist_life: { type: 'string' },
    year: { type: 'string' },
    medium: { type: 'string' },
    dimensions: { type: 'string' },
    location: { type: 'string' },
    provenance: { type: 'string' },
    hook: { type: 'string' },
    story: { type: 'string' },
    scene_description: { type: 'string' },
    brushwork: { type: 'string' },
    materiality: { type: 'string' },
    scale_note: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' } },
    palette_notes: { type: 'array', items: { type: 'string' } },
    symbolism: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          detail: { type: 'string' },
          meaning: { type: 'string' },
          box: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
        },
        required: ['detail', 'meaning', 'box'],
        additionalProperties: false,
      },
    },
    hidden_details: { type: 'array', items: { type: 'string' } },
    process: { type: 'string' },
    why_made: { type: 'string' },
    legacy: { type: 'string' },
    debates: { type: 'string' },
    style: { type: 'string' },
    mood: { type: 'string' },
    similar_works: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          artist: { type: 'string' },
        },
        required: ['title', 'artist'],
        additionalProperties: false,
      },
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          definition: { type: 'string' },
        },
        required: ['term', 'definition'],
        additionalProperties: false,
      },
    },
    spatial_layout: {
      type: 'object',
      properties: {
        foreground: { type: 'string' },
        midground: { type: 'string' },
        background: { type: 'string' },
        overhead: { type: 'string' },
        underfoot: { type: 'string' },
      },
      required: ['foreground', 'midground', 'background', 'overhead', 'underfoot'],
      additionalProperties: false,
    },
    horizon: { type: 'string' },
    perspective: { type: 'string' },
    light: {
      type: 'object',
      properties: {
        direction: { type: 'string' },
        quality: { type: 'string' },
      },
      required: ['direction', 'quality'],
      additionalProperties: false,
    },
    vantage: { type: 'string' },
    offscreen: { type: 'string' },
    technique: { type: 'string' },
    render_negatives: { type: 'array', items: { type: 'string' } },
    artwork_box: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
      },
      required: ['x', 'y', 'w', 'h'],
      additionalProperties: false,
    },
    scene_type: {
      type: 'string',
      enum: ['landscape', 'portrait', 'still-life', 'interior', 'abstract'],
    },
    figure_coverage: { type: 'number' },
    depth_profile: {
      type: 'string',
      enum: ['mostly-far', 'far-with-near-foreground', 'shallow-tabletop', 'flat'],
    },
  },
  required: [
    'recognized',
    'confidence',
    'title',
    'artist',
    'artist_life',
    'year',
    'medium',
    'dimensions',
    'location',
    'provenance',
    'hook',
    'story',
    'scene_description',
    'brushwork',
    'materiality',
    'scale_note',
    'palette',
    'palette_notes',
    'symbolism',
    'hidden_details',
    'process',
    'why_made',
    'legacy',
    'debates',
    'style',
    'mood',
    'similar_works',
    'glossary',
    'spatial_layout',
    'horizon',
    'perspective',
    'light',
    'vantage',
    'offscreen',
    'technique',
    'render_negatives',
    'artwork_box',
    'scene_type',
    'figure_coverage',
    'depth_profile',
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
