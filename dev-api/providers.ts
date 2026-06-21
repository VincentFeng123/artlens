// Node-side recognition + panorama for LOCAL DEVELOPMENT only. Runs inside the
// Vite dev server (see ./plugin.ts). Reads keys from the dev `env` (loaded from
// .env), which stay server-side — they are never exposed to the client bundle.
// Mirrors the Supabase Edge Function logic in supabase/functions/.

import Anthropic from '@anthropic-ai/sdk'
import {
  RECOGNITION_PROMPT,
  RECOGNITION_JSON_SCHEMA,
  buildArtworkMeta,
  buildScenePrompt,
  parseRecognitionJson,
  DEMO_META,
} from '../shared/prompt'
import type { RecognitionResult, ScanResponse } from '../shared/types'

type Env = Record<string, string | undefined>

const DEMO_PANORAMA = '/demo-panorama.png'

export async function runScan(
  imageBase64: string,
  mime: string,
  env: Env,
): Promise<ScanResponse> {
  const provider = (env.RECOGNITION_PROVIDER ?? 'claude').toLowerCase()
  if (!hasRecognitionKey(provider, env)) {
    await sleep(1400) // let the loading state breathe
    return {
      status: 'ready',
      panorama_url: DEMO_PANORAMA,
      title: DEMO_META.title,
      artist: DEMO_META.artist,
      meta: DEMO_META,
      demo: true,
    }
  }

  const recognition = await recognize(provider, imageBase64, mime, env)
  const meta = buildArtworkMeta(recognition)
  const title = meta.title
  const artist = meta.artist

  const scene = buildScenePrompt(recognition)
  const pano = (
    env.PANORAMA_PROVIDER ?? (env.BLOCKADE_LABS_API_KEY ? 'blockade' : 'demo')
  ).toLowerCase()

  // Local ComfyUI on your machine (keyless, sharp). Requires ComfyUI running.
  if (pano === 'comfyui') {
    return {
      status: 'ready',
      panorama_url: await generateComfyUI(scene.prompt, env),
      title,
      artist,
      meta,
    }
  }

  // Keyless hosted image generation (no signup) — text-only, lower-res. No depth
  // map; the client computes depth in-browser for parallax.
  if (pano === 'pollinations') {
    return {
      status: 'ready',
      panorama_url: await generatePollinations(scene.prompt, scene.negative),
      title,
      artist,
      meta,
    }
  }

  // Blockade Labs — best quality, artwork-faithful equirectangular skyboxes plus a
  // free depth map (needs a key).
  if (pano === 'blockade' && env.BLOCKADE_LABS_API_KEY) {
    const { fileUrl, depthUrl } = await generateBlockade(
      scene.prompt,
      scene.negative,
      imageBase64,
      env,
    )
    // Proxy through the dev server so the texture loads same-origin (no CORS taint).
    return {
      status: 'ready',
      panorama_url: `/api/proxy?url=${encodeURIComponent(fileUrl)}`,
      depth_url: depthUrl ? `/api/proxy?url=${encodeURIComponent(depthUrl)}` : null,
      title,
      artist,
      meta,
    }
  }

  // No generator configured → recognized (real dossier), but serve the demo world.
  return { status: 'ready', panorama_url: DEMO_PANORAMA, title, artist, meta, demo: true }
}

// ── Pollinations (keyless image generation) ────────────────────────────────
// Returns a data: URL so the client loads it instantly with no CORS/proxy.
async function generatePollinations(scenePrompt: string, negative?: string): Promise<string> {
  // Pollinations is keyless/low-res and degrades with very long URLs — keep the
  // prompt compact so the request stays reliable.
  const scene = scenePrompt.length > 600 ? scenePrompt.slice(0, 600) : scenePrompt
  const avoid = negative ? ` Avoid: ${negative.slice(0, 200)}.` : ''
  const prompt =
    `equirectangular 360 degree panorama, seamless horizontally tileable, ` +
    `2:1 aspect ratio, painterly (not a photograph), no text or watermark, ` +
    `no seam at the wrap, no distortion at the poles. ${scene}${avoid}`

  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const seed = (djb2(prompt) + attempt) % 1_000_000 // stable seed → same artwork yields same world
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=2048&height=1024&nologo=true&model=flux&seed=${seed}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 90_000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`Pollinations error ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      // Pollinations sometimes returns a 200 with an error/HTML body under load —
      // guard against handing the client a broken "image".
      if (!looksLikeImage(buf)) throw new Error('Pollinations returned a non-image response')
      const contentType = res.headers.get('content-type') ?? 'image/jpeg'
      return `data:${contentType};base64,${buf.toString('base64')}`
    } catch (e) {
      lastErr = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Pollinations generation failed')
}

/** Sniff common image magic bytes (JPEG / PNG / WebP). */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true // JPEG
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return true // PNG
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return true // WebP
  return false
}

// ── ComfyUI (local, keyless, runs on your Mac via MPS) ─────────────────────
// Queues a hires-fix SDXL workflow, polls /history, returns the image as a
// data: URL. Needs a ComfyUI server running locally with an SDXL checkpoint.
async function generateComfyUI(scenePrompt: string, env: Env): Promise<string> {
  const base = (env.COMFYUI_URL ?? 'http://127.0.0.1:8188').replace(/\/+$/, '')
  const ckpt = env.COMFYUI_CKPT ?? 'sd_xl_base_1.0.safetensors'
  const width = Number(env.COMFYUI_WIDTH ?? 2048)
  const height = Number(env.COMFYUI_HEIGHT ?? 1024)
  const seed = djb2(scenePrompt) % 2_147_483_647
  const positive =
    `equirectangular 360 degree panorama, monoscopic, 2:1 aspect ratio, ` +
    `ultra detailed, sharp focus, immersive, ${scenePrompt}`
  const negative =
    'blurry, low quality, low resolution, distorted, deformed, text, ' +
    'watermark, signature, frame, border, picture frame'

  const workflow = buildComfyWorkflow({ ckpt, positive, negative, seed, width, height })

  const queueRes = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: `artlens-${seed}` }),
  }).catch(() => {
    throw new Error(
      `Couldn't reach ComfyUI at ${base}. Is it running? (PANORAMA_PROVIDER=comfyui)`,
    )
  })
  if (!queueRes.ok) {
    throw new Error(`ComfyUI /prompt ${queueRes.status}: ${await queueRes.text()}`)
  }
  const { prompt_id: promptId } = await queueRes.json()
  if (!promptId) throw new Error('ComfyUI did not return a prompt_id')

  const started = Date.now()
  const TIMEOUT = 300_000 // generation is slow on a Mac (MPS)
  while (Date.now() - started < TIMEOUT) {
    await sleep(2000)
    const hRes = await fetch(`${base}/history/${promptId}`)
    if (!hRes.ok) continue
    const hist = await hRes.json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      throw new Error('ComfyUI generation failed — check the ComfyUI console.')
    }
    for (const node of Object.values(entry.outputs ?? {})) {
      const images = (node as { images?: Array<{ filename: string; subfolder?: string; type?: string }> })
        .images
      if (images?.length) {
        const img = images[0]
        const viewUrl =
          `${base}/view?filename=${encodeURIComponent(img.filename)}` +
          `&subfolder=${encodeURIComponent(img.subfolder ?? '')}` +
          `&type=${encodeURIComponent(img.type ?? 'output')}`
        const imgRes = await fetch(viewUrl)
        if (!imgRes.ok) throw new Error(`ComfyUI /view ${imgRes.status}`)
        const buf = Buffer.from(await imgRes.arrayBuffer())
        const ct = imgRes.headers.get('content-type') ?? 'image/png'
        return `data:${ct};base64,${buf.toString('base64')}`
      }
    }
  }
  throw new Error('ComfyUI generation timed out (5 min).')
}

// Core-node SDXL workflow with a hires-fix pass: generate near ~1MP (avoids
// SDXL duplication at wide aspect), then latent-upscale to the target size.
function buildComfyWorkflow(o: {
  ckpt: string
  positive: string
  negative: string
  seed: number
  width: number
  height: number
}) {
  const baseW = o.width >= 1536 ? Math.round(o.width / 2) : o.width
  const baseH = o.height >= 768 ? Math.round(o.height / 2) : o.height
  const ks = (latent: [string, number], steps: number, denoise: number) => ({
    class_type: 'KSampler',
    inputs: {
      seed: o.seed,
      steps,
      cfg: 7,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise,
      model: ['10', 0],
      positive: ['11', 0],
      negative: ['12', 0],
      latent_image: latent,
    },
  })
  return {
    '10': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: o.ckpt } },
    '11': { class_type: 'CLIPTextEncode', inputs: { text: o.positive, clip: ['10', 1] } },
    '12': { class_type: 'CLIPTextEncode', inputs: { text: o.negative, clip: ['10', 1] } },
    '13': { class_type: 'EmptyLatentImage', inputs: { width: baseW, height: baseH, batch_size: 1 } },
    '14': ks(['13', 0], 25, 1),
    '15': {
      class_type: 'LatentUpscale',
      inputs: {
        samples: ['14', 0],
        upscale_method: 'nearest-exact',
        width: o.width,
        height: o.height,
        crop: 'disabled',
      },
    },
    '16': ks(['15', 0], 15, 0.45),
    '17': { class_type: 'VAEDecode', inputs: { samples: ['16', 0], vae: ['10', 2] } },
    '18': { class_type: 'SaveImage', inputs: { images: ['17', 0], filename_prefix: 'artlens' } },
  }
}

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

function hasRecognitionKey(provider: string, env: Env): boolean {
  if (provider === 'gemini') return Boolean(env.GEMINI_API_KEY)
  if (provider === 'openai') return Boolean(env.OPENAI_API_KEY)
  return Boolean(env.ANTHROPIC_API_KEY)
}

function recognize(
  provider: string,
  imageBase64: string,
  mime: string,
  env: Env,
): Promise<RecognitionResult> {
  if (provider === 'gemini') return recognizeGemini(imageBase64, mime, env)
  if (provider === 'openai') return recognizeOpenAI(imageBase64, mime, env)
  return recognizeClaude(imageBase64, mime, env)
}

// ── Claude (official SDK, structured outputs) ──────────────────────────────
async function recognizeClaude(
  imageBase64: string,
  mime: string,
  env: Env,
): Promise<RecognitionResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const model = env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'

  const params = {
    model,
    max_tokens: 3072, // headroom for the spatial/style world-building fields
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  const message = (await client.messages.create(params)) as {
    content: Array<{ type: string; text?: string }>
  }
  const text = message.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('Claude returned no text content')
  return parseRecognitionJson(text)
}

// ── Gemini (REST, JSON response) ───────────────────────────────────────────
async function recognizeGemini(
  imageBase64: string,
  mime: string,
  env: Env,
): Promise<RecognitionResult> {
  const model = env.GEMINI_MODEL ?? 'gemini-3.5-flash'
  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY ?? '',
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
        // gemini-2.5/3.x are "thinking" models: thinking tokens count against
        // maxOutputTokens. The full dossier needs ~800 output tokens on top of
        // ~1.3k thinking tokens; 2048 truncated the JSON mid-array (parse error,
        // failed scan). 8192 leaves ample room for both.
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 8192 },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text: string =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '')
      .join('') ?? ''
  if (!text) throw new Error('Gemini returned no text content')
  return parseRecognitionJson(text)
}

// ── OpenAI (REST, strict json_schema) ──────────────────────────────────────
async function recognizeOpenAI(
  imageBase64: string,
  mime: string,
  env: Env,
): Promise<RecognitionResult> {
  const model = env.OPENAI_MODEL ?? 'gpt-4o'
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}`,
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
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text: string = data?.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('OpenAI returned no content')
  return parseRecognitionJson(text)
}

// ── Blockade Labs (REST, async) ────────────────────────────────────────────
async function generateBlockade(
  prompt: string,
  negative: string,
  controlImageBase64: string,
  env: Env,
): Promise<{ fileUrl: string; depthUrl?: string }> {
  const BASE = 'https://backend.blockadelabs.com/api/v1'
  const headers = {
    'content-type': 'application/json',
    'x-api-key': env.BLOCKADE_LABS_API_KEY ?? '',
  }

  let styleId = env.BLOCKADE_SKYBOX_STYLE_ID ? Number(env.BLOCKADE_SKYBOX_STYLE_ID) : 0
  if (!styleId) {
    const sRes = await fetch(`${BASE}/skybox/styles`, { headers })
    if (!sRes.ok) throw new Error(`Blockade styles ${sRes.status}: ${await sRes.text()}`)
    const styles = await sRes.json()
    // Prefer a Model-3 style (Model 3 returns a free depth map; Model 4 doesn't).
    const flat: BlockadeStyle[] = Array.isArray(styles)
      ? styles.flatMap((s: BlockadeStyle) => (Array.isArray(s.items) ? s.items : [s]))
      : []
    const model3 = flat.find((s) => `${s.model ?? ''} ${s.model_version ?? ''}`.includes('3'))
    styleId = (model3?.id ?? flat[0]?.id) as number
    if (!styleId) throw new Error('No Blockade skybox styles available')
  }

  // init_image + low init_strength preserves palette AND composition (faithful);
  // BLOCKADE_MODE=remix keeps composition but drops colour.
  const mode = (env.BLOCKADE_MODE ?? 'init').toLowerCase()
  const initStrength = Number(env.BLOCKADE_INIT_STRENGTH ?? 0.25)
  const body: Record<string, unknown> = {
    skybox_style_id: styleId,
    prompt: prompt.slice(0, 2000),
  }
  if (negative) body.negative_text = negative.slice(0, 2000)
  if (mode === 'remix') {
    body.control_image = controlImageBase64
    body.control_model = 'remix'
  } else {
    body.init_image = controlImageBase64
    body.init_strength = initStrength
  }

  const cRes = await fetch(`${BASE}/skybox`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!cRes.ok) throw new Error(`Blockade create ${cRes.status}: ${await cRes.text()}`)
  const created = unwrap(await cRes.json())
  const id = created.id
  if (id == null) throw new Error('Blockade did not return a request id')

  const started = Date.now()
  while (Date.now() - started < 180_000) {
    await sleep(3000)
    const pRes = await fetch(`${BASE}/imagine/requests/${id}`, { headers })
    if (!pRes.ok) continue
    const req = unwrap(await pRes.json())
    const status = String(req.status ?? '').toLowerCase()
    if (status === 'complete') {
      if (!req.file_url) throw new Error('Blockade completed without a file_url')
      return { fileUrl: req.file_url, depthUrl: req.depth_map_url || undefined }
    }
    if (status === 'error' || status === 'abort') {
      throw new Error(req.error_message || `Blockade generation ${status}`)
    }
  }
  throw new Error('Blockade generation timed out')
}

interface BlockadeStyle {
  id?: number
  model?: string
  model_version?: number | string
  items?: BlockadeStyle[]
}

interface BlockadeReq {
  id?: number | string
  status?: string
  file_url?: string
  depth_map_url?: string
  error_message?: string | null
}

function unwrap(json: { request?: BlockadeReq } & BlockadeReq): BlockadeReq {
  return json?.request ?? json ?? {}
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
    await sleep(800 * i)
    res = await fetch(url, init)
  }
  return res
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
