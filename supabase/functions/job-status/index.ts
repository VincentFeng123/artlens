import { adminClient } from '../_shared/supabaseAdmin.ts'
import { json, preflight } from '../_shared/cors.ts'

// Returns the trimmed `jobs` row. Accepts the id via ?job_id= (GET) or a JSON
// body { job_id } (POST) — the client uses POST through supabase.functions.invoke.
Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  let jobId: string | null = null
  if (req.method === 'GET') {
    jobId = new URL(req.url).searchParams.get('job_id')
  } else {
    try {
      jobId = (await req.json()).job_id ?? null
    } catch {
      jobId = null
    }
  }
  if (!jobId) return json({ error: 'job_id required' }, 400)

  const admin = adminClient()
  const { data, error } = await admin
    .from('jobs')
    .select('id, status, panorama_url, error')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) return json({ error: 'job not found' }, 404)

  return json({
    id: data.id,
    status: data.status,
    panorama_url: data.panorama_url,
    error: data.error,
    title: null,
    artist: null,
  })
})
