import type { PanoramaInput, PanoramaResult } from './index.ts'

const BASE = 'https://backend.blockadelabs.com/api/v1'
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 180_000
const DEFAULT_INIT_STRENGTH = 0.25 // Blockade's scale is inverted: lower = stronger artwork influence

interface BlockadeRequest {
  id?: number | string
  status?: string
  file_url?: string
  /** Equirectangular depth map, returned inline on Model 3 (absent on Model 4). */
  depth_map_url?: string
  error_message?: string | null
}

/**
 * Blockade Labs Skybox AI (image-to-skybox). The artwork conditions generation
 * so the world stays faithful to the painting:
 *  - `init` mode (default): `init_image` + low `init_strength` preserves BOTH the
 *    palette AND composition — best fidelity. (`remix` keeps composition but drops
 *    colour, so it's opt-in via BLOCKADE_MODE=remix.)
 *  - Model 3 returns a free `depth_map_url` inline (used for parallax); Model 4 has
 *    none, so we prefer a Model-3 style. If depth is absent we simply omit it.
 * The API is async: create the skybox, then poll until `status === "complete"`.
 */
export async function generateWithBlockade({
  referenceImage,
  prompt,
  negative,
}: PanoramaInput): Promise<PanoramaResult> {
  const apiKey = Deno.env.get('BLOCKADE_LABS_API_KEY')
  if (!apiKey) throw new Error('BLOCKADE_LABS_API_KEY not set')

  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey }
  const styleId = await resolveStyleId(headers)

  const mode = (Deno.env.get('BLOCKADE_MODE') ?? 'init').toLowerCase()
  const initStrength = Number(Deno.env.get('BLOCKADE_INIT_STRENGTH') ?? DEFAULT_INIT_STRENGTH)

  // 1) Create — condition on the artwork per mode.
  const body: Record<string, unknown> = {
    skybox_style_id: styleId,
    prompt: prompt.slice(0, 2000),
  }
  if (negative) body.negative_text = negative.slice(0, 2000)
  if (mode === 'remix') {
    body.control_image = referenceImage
    body.control_model = 'remix'
  } else {
    body.init_image = referenceImage
    body.init_strength = initStrength
  }

  const createRes = await fetch(`${BASE}/skybox`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!createRes.ok) {
    throw new Error(`Blockade create ${createRes.status}: ${await createRes.text()}`)
  }
  const created = unwrap(await createRes.json())
  const id = created.id
  if (id == null) throw new Error('Blockade did not return a request id')

  // 2) Poll
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS)
    const pollRes = await fetch(`${BASE}/imagine/requests/${id}`, { headers })
    if (!pollRes.ok) continue
    const req = unwrap(await pollRes.json())
    const status = (req.status ?? '').toLowerCase()
    if (status === 'complete') {
      if (!req.file_url) throw new Error('Blockade completed without a file_url')
      return { equirectPngUrl: req.file_url, depthUrl: req.depth_map_url || undefined }
    }
    if (status === 'error' || status === 'abort') {
      throw new Error(req.error_message || `Blockade generation ${status}`)
    }
  }
  throw new Error('Blockade generation timed out')
}

/**
 * Use the configured style id, else pick a Model-3 style (so depth maps are
 * available), falling back to the first available style.
 */
async function resolveStyleId(headers: Record<string, string>): Promise<number> {
  const configured = Deno.env.get('BLOCKADE_SKYBOX_STYLE_ID')
  if (configured) return Number(configured)

  const res = await fetch(`${BASE}/skybox/styles`, { headers })
  if (!res.ok) throw new Error(`Blockade styles ${res.status}: ${await res.text()}`)
  const styles = (await res.json()) as BlockadeStyle[]
  const flat = flattenStyles(styles)
  const model3 = flat.find((s) => isModel3(s))
  const chosen = model3?.id ?? flat[0]?.id
  if (chosen == null) throw new Error('No Blockade skybox styles available')
  return chosen
}

interface BlockadeStyle {
  id?: number
  model?: string
  model_version?: number | string
  name?: string
  /** The styles endpoint sometimes nests variants under a family. */
  items?: BlockadeStyle[]
}

/** The styles endpoint may return flat styles or families with nested `items`. */
function flattenStyles(styles: BlockadeStyle[]): BlockadeStyle[] {
  if (!Array.isArray(styles)) return []
  return styles.flatMap((s) => (Array.isArray(s.items) ? s.items : [s]))
}

/** Best-effort: does this style belong to Model 3 (which returns depth maps)? */
function isModel3(s: BlockadeStyle): boolean {
  const hay = `${s.model ?? ''} ${s.model_version ?? ''}`.toLowerCase()
  return hay.includes('3')
}

/** Blockade responses are sometimes wrapped in `{ request: {...} }`. */
function unwrap(json: unknown): BlockadeRequest {
  const obj = json as { request?: BlockadeRequest } & BlockadeRequest
  return obj?.request ?? obj ?? {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
