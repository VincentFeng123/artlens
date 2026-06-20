import { supabase } from './supabase'
import type { JobStatusResponse, ScanResponse } from '../../shared/types'

const DEMO_PANORAMA = '/demo-panorama.png'
const POLL_INTERVAL = 1500
const POLL_TIMEOUT = 120_000

export interface ScanOutcome {
  panoramaUrl: string
  title: string
  artist: string
  demo: boolean
}

/**
 * Scan an artwork frame and resolve to a panorama.
 *
 * No Supabase configured → resolve to the bundled demo panorama (true
 * zero-config local run). Otherwise call the `scan` Edge Function and, if it
 * returns a generating job, poll `job-status` until ready / error / timeout.
 */
export async function scanArtwork(
  jpeg: Blob,
  signal?: AbortSignal,
): Promise<ScanOutcome> {
  if (!supabase) {
    // Let the loading state breathe, then return the demo world.
    await delay(2200, signal)
    return {
      panoramaUrl: DEMO_PANORAMA,
      title: 'A World Within',
      artist: 'Artlens — demo',
      demo: true,
    }
  }

  const body = await toRequestBody(jpeg)
  const { data, error } = await supabase.functions.invoke<ScanResponse>('scan', {
    body,
  })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Empty response from the scan service.')
  if (data.status === 'error') throw new Error(data.error)

  if (data.status === 'ready') {
    return {
      panoramaUrl: data.panorama_url,
      title: data.title,
      artist: data.artist,
      demo: Boolean(data.demo),
    }
  }

  // status === 'generating' → poll the job.
  const job = await pollJob(data.job_id, signal)
  if (job.status !== 'ready' || !job.panorama_url) {
    throw new Error(job.error || 'Generation finished without a panorama.')
  }
  return {
    panoramaUrl: job.panorama_url,
    title: job.title || data.title,
    artist: job.artist || data.artist,
    demo: false,
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
