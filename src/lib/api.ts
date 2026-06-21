import { supabase } from './supabase'
import type { ArtworkMeta, JobStatusResponse, ScanResponse } from '../../shared/types'
import { DEMO_META } from '../../shared/prompt'

const DEMO_PANORAMA = '/demo-panorama.png'
const POLL_INTERVAL = 1500
const POLL_TIMEOUT = 300_000 // local ComfyUI / Blockade can take a few minutes

export interface ScanOutcome {
  panoramaUrl: string
  /** Equirectangular depth PNG URL for parallax; undefined when none (client computes it). */
  depthUrl?: string
  title: string
  artist: string
  demo: boolean
  /** Full artwork dossier for the viewer's info card. */
  meta: ArtworkMeta
}

/** Minimal dossier when the backend is older or hasn't attached one. */
function fallbackMeta(title: string, artist: string, demo: boolean): ArtworkMeta {
  return {
    recognized: false,
    confidence: 0,
    title,
    artist,
    artist_life: '',
    year: '',
    medium: '',
    dimensions: '',
    location: '',
    provenance: '',
    hook: '',
    story: '',
    scene_description: '',
    brushwork: '',
    materiality: '',
    scale_note: '',
    palette: [],
    symbolism: [],
    hidden_details: [],
    process: '',
    why_made: '',
    legacy: '',
    debates: '',
    style: '',
    mood: '',
    similar_works: [],
    demo,
  }
}

/**
 * Scan an artwork frame and resolve to a panorama. Three paths:
 *  - Supabase configured → call the `scan` Edge Function (+ poll job-status).
 *  - Dev, no Supabase → call the local /api/scan dev server (keys from .env).
 *  - Production, no backend → bundled demo panorama (true zero-config).
 */
export async function scanArtwork(
  jpeg: Blob,
  signal?: AbortSignal,
): Promise<ScanOutcome> {
  if (supabase) return scanViaEdge(jpeg, signal)
  if (import.meta.env.DEV) return scanViaDevApi(jpeg, signal)

  await delay(2200, signal)
  return demoOutcome()
}

// ── Local dev server (./dev-api) ───────────────────────────────────────────
async function scanViaDevApi(
  jpeg: Blob,
  signal?: AbortSignal,
): Promise<ScanOutcome> {
  const body = await toRequestBody(jpeg)
  let res: Response
  try {
    res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    // Dev API unreachable (e.g. plugin disabled) → bundled demo.
    await delay(1200, signal)
    return demoOutcome()
  }
  const data = (await res.json()) as ScanResponse
  if (data.status === 'error') throw new Error(data.error)
  if (data.status === 'ready') {
    return {
      panoramaUrl: data.panorama_url,
      depthUrl: data.depth_url ?? undefined,
      title: data.title,
      artist: data.artist,
      demo: Boolean(data.demo),
      meta: data.meta ?? fallbackMeta(data.title, data.artist, Boolean(data.demo)),
    }
  }

  // generating → poll /api/job-status (quick requests, no long-held connection
  // for iOS Safari to abort — important for slow ComfyUI generation). In dev the
  // dossier rides along on the job (recognition runs server-side after the scan).
  const job = await pollDevJob(data.job_id, signal)
  if (job.status !== 'ready' || !job.panorama_url) {
    throw new Error(job.error || 'Generation finished without a panorama.')
  }
  const title = job.title || 'Your world'
  const artist = job.artist || ''
  return {
    panoramaUrl: job.panorama_url,
    depthUrl: job.depth_url ?? undefined,
    title,
    artist,
    demo: false,
    meta: job.meta ?? fallbackMeta(title, artist, false),
  }
}

async function pollDevJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobStatusResponse> {
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT) {
    if (signal?.aborted) throw new Error('Cancelled')
    try {
      const r = await fetch(
        `/api/job-status?job_id=${encodeURIComponent(jobId)}`,
        { signal },
      )
      const data = (await r.json()) as JobStatusResponse
      if (data.status === 'ready' || data.status === 'error') return data
    } catch {
      // transient — keep polling
    }
    await delay(POLL_INTERVAL, signal)
  }
  throw new Error('Timed out while building your world. Please try again.')
}

// ── Supabase Edge Functions ────────────────────────────────────────────────
async function scanViaEdge(
  jpeg: Blob,
  signal?: AbortSignal,
): Promise<ScanOutcome> {
  const body = await toRequestBody(jpeg)
  const { data, error } = await supabase!.functions.invoke<ScanResponse>('scan', {
    body,
  })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Empty response from the scan service.')
  if (data.status === 'error') throw new Error(data.error)

  if (data.status === 'ready') {
    return {
      panoramaUrl: data.panorama_url,
      depthUrl: data.depth_url ?? undefined,
      title: data.title,
      artist: data.artist,
      demo: Boolean(data.demo),
      meta: data.meta ?? fallbackMeta(data.title, data.artist, Boolean(data.demo)),
    }
  }

  // Recognition already ran — the Edge `generating` response carries the dossier;
  // hold it while polling (job-status only returns the panorama).
  const genMeta = data.meta
  const job = await pollJob(data.job_id, signal)
  if (job.status !== 'ready' || !job.panorama_url) {
    throw new Error(job.error || 'Generation finished without a panorama.')
  }
  const title = job.title || data.title
  const artist = job.artist || data.artist
  return {
    panoramaUrl: job.panorama_url,
    depthUrl: job.depth_url ?? undefined,
    title,
    artist,
    demo: false,
    meta: job.meta ?? genMeta ?? fallbackMeta(title, artist, false),
  }
}

async function pollJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobStatusResponse> {
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT) {
    if (signal?.aborted) throw new Error('Cancelled')
    const { data, error } = await supabase!.functions.invoke<JobStatusResponse>(
      'job-status',
      { body: { job_id: jobId } },
    )
    if (error) throw new Error(error.message)
    if (data && (data.status === 'ready' || data.status === 'error')) return data
    await delay(POLL_INTERVAL, signal)
  }
  throw new Error('Timed out while building your world. Please try again.')
}

// ── helpers ────────────────────────────────────────────────────────────────
function demoOutcome(): ScanOutcome {
  return {
    panoramaUrl: DEMO_PANORAMA,
    title: DEMO_META.title,
    artist: DEMO_META.artist,
    demo: true,
    meta: DEMO_META,
  }
}

function toRequestBody(jpeg: Blob): Promise<{ image: string; mime: string }> {
  return jpeg.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return { image: btoa(binary), mime: jpeg.type || 'image/jpeg' }
  })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(new Error('Cancelled'))
      },
      { once: true },
    )
  })
}
