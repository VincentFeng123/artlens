import type { PanoramaInput } from './index.ts'

const BASE = 'https://backend.blockadelabs.com/api/v1'
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 180_000

interface BlockadeRequest {
  id?: number | string
  status?: string
  file_url?: string
  error_message?: string | null
}

/**
 * Blockade Labs Skybox AI (image-to-skybox). The artwork is passed as the
 * structure reference (`control_image` + `control_model: "remix"`), preserving
 * composition while reimagining it as a full 360° world. The API is async:
 * create the skybox, then poll until `status === "complete"`.
 */
export async function generateWithBlockade({
  referenceImage,
  prompt,
}: PanoramaInput): Promise<{ equirectPngUrl: string }> {
  const apiKey = Deno.env.get('BLOCKADE_LABS_API_KEY')
  if (!apiKey) throw new Error('BLOCKADE_LABS_API_KEY not set')

  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey }
  const styleId = await resolveStyleId(apiKey, headers)

  // 1) Create
  const createRes = await fetch(`${BASE}/skybox`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      skybox_style_id: styleId,
      prompt: prompt.slice(0, 2000),
      control_image: referenceImage,
      control_model: 'remix',
    }),
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
      return { equirectPngUrl: req.file_url }
    }
    if (status === 'error' || status === 'abort') {
      throw new Error(req.error_message || `Blockade generation ${status}`)
    }
  }
  throw new Error('Blockade generation timed out')
}

/** Use the configured style id, else pick the first available style. */
async function resolveStyleId(
  _apiKey: string,
  headers: Record<string, string>,
): Promise<number> {
  const configured = Deno.env.get('BLOCKADE_SKYBOX_STYLE_ID')
  if (configured) return Number(configured)

  const res = await fetch(`${BASE}/skybox/styles`, { headers })
  if (!res.ok) throw new Error(`Blockade styles ${res.status}: ${await res.text()}`)
  const styles = (await res.json()) as Array<{ id: number }>
  const first = Array.isArray(styles) ? styles[0]?.id : undefined
  if (first == null) throw new Error('No Blockade skybox styles available')
  return first
}

/** Blockade responses are sometimes wrapped in `{ request: {...} }`. */
function unwrap(json: unknown): BlockadeRequest {
  const obj = json as { request?: BlockadeRequest } & BlockadeRequest
  return obj?.request ?? obj ?? {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
