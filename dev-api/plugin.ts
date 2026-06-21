// Vite dev-only plugin: exposes /api/scan, /api/job-status and /api/proxy so you
// can test real recognition + generation locally without deploying Supabase.
// Keys are read from `env` (loaded from .env) and stay in the Node process —
// they are never sent to the browser. Disabled in production builds.
//
// /api/scan is non-blocking (returns a job id immediately) so slow generators
// (e.g. local ComfyUI, 1–3 min) don't hold an HTTP request open long enough for
// iOS Safari to abort it (~60s inactivity timeout). The phone polls /api/job-status.

import type { Plugin } from 'vite'
import { runScan } from './providers'
import type { ArtworkMeta } from '../shared/types'

type Env = Record<string, string | undefined>

interface JobRecord {
  status: 'generating' | 'ready' | 'error'
  panorama_url?: string
  depth_url?: string | null
  title?: string
  artist?: string
  meta?: ArtworkMeta
  error?: string
}

export function artlensDevApi(env: Env): Plugin {
  const jobs = new Map<string, JobRecord>()

  return {
    name: 'artlens-dev-api',
    apply: 'serve',
    configureServer(server) {
      // POST /api/scan  { image, mime } -> { status: 'generating', job_id }
      server.middlewares.use('/api/scan', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST required')
          return
        }
        let body: { image?: string; mime?: string }
        try {
          body = await readJson(req)
        } catch {
          sendJson(res, { status: 'error', error: 'invalid request body' })
          return
        }
        if (!body?.image) {
          sendJson(res, { status: 'error', error: 'missing image' })
          return
        }

        const jobId = crypto.randomUUID()
        jobs.set(jobId, { status: 'generating' })

        // Recognition + generation run in the background; the client polls.
        runScan(body.image, body.mime ?? 'image/jpeg', env)
          .then((r) => {
            if (r.status === 'ready') {
              jobs.set(jobId, {
                status: 'ready',
                panorama_url: r.panorama_url,
                depth_url: r.depth_url ?? null,
                title: r.title,
                artist: r.artist,
                meta: r.meta,
              })
            } else {
              jobs.set(jobId, {
                status: 'error',
                error: r.status === 'error' ? r.error : 'unexpected response',
              })
            }
          })
          .catch((e) => {
            jobs.set(jobId, {
              status: 'error',
              error: e instanceof Error ? e.message : String(e),
            })
          })
          .finally(() => {
            setTimeout(() => jobs.delete(jobId), 300_000) // ephemeral cleanup
          })

        sendJson(res, { status: 'generating', job_id: jobId })
      })

      // GET /api/job-status?job_id=  (or POST { job_id }) -> job record
      server.middlewares.use('/api/job-status', async (req, res) => {
        let jobId: string | null = null
        if (req.method === 'GET') {
          jobId = new URL(req.url ?? '', 'http://localhost').searchParams.get('job_id')
        } else {
          try {
            jobId = (await readJson(req)).job_id ?? null
          } catch {
            jobId = null
          }
        }
        if (!jobId) {
          sendJson(res, { error: 'job_id required' })
          return
        }
        const job = jobs.get(jobId)
        if (!job) {
          sendJson(res, {
            id: jobId,
            status: 'error',
            panorama_url: null,
            error: 'job not found',
            title: null,
            artist: null,
            meta: null,
          })
          return
        }
        sendJson(res, {
          id: jobId,
          status: job.status,
          panorama_url: job.panorama_url ?? null,
          depth_url: job.depth_url ?? null,
          error: job.error ?? null,
          title: job.title ?? null,
          artist: job.artist ?? null,
          meta: job.meta ?? null,
        })
      })

      // GET /api/proxy?url=... -> streams a remote image same-origin (no CORS taint)
      server.middlewares.use('/api/proxy', async (req, res) => {
        try {
          const target = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')
          if (!target) {
            res.statusCode = 400
            res.end('url required')
            return
          }
          const upstream = await fetch(target)
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'image/png')
          res.setHeader('cache-control', 'no-store')
          const buf = Buffer.from(await upstream.arrayBuffer())
          res.end(buf)
        } catch (e) {
          res.statusCode = 502
          res.end(e instanceof Error ? e.message : 'proxy error')
        }
      })
    },
  }
}

function readJson(req: {
  on: (ev: string, cb: (arg?: unknown) => void) => void
}): Promise<{ image?: string; mime?: string; job_id?: string }> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(
  res: { setHeader: (k: string, v: string) => void; end: (b: string) => void },
  body: unknown,
) {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
