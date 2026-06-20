import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from '../_shared/supabaseAdmin.ts'
import { json, preflight, errMessage } from '../_shared/cors.ts'
import {
  getRecognitionProvider,
  hasRecognitionKey,
} from '../_shared/recognition/index.ts'
import { getPanoramaProvider, hasPanoramaKey } from '../_shared/panorama/index.ts'
import { buildScenePrompt } from '../_shared/prompt.ts'
import type { RecognitionResult } from '../_shared/types.ts'

// Relative path — the client resolves it against the app origin, which serves
// the bundled demo panorama. Used whenever generation can't (or needn't) run.
const DEMO_PANORAMA = '/demo-panorama.png'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') {
    return json({ status: 'error', error: 'POST required' }, 405)
  }

  // Parse body { image: base64, mime }
  let image = ''
  let mime = 'image/jpeg'
  try {
    const body = await req.json()
    image = body.image
    mime = body.mime ?? 'image/jpeg'
    if (!image) throw new Error('missing image')
  } catch {
    return json({ status: 'error', error: 'Invalid request body' }, 400)
  }

  // Demo short-circuit: no recognizer key configured anywhere.
  if (!hasRecognitionKey()) {
    return json({
      status: 'ready',
      panorama_url: DEMO_PANORAMA,
      title: 'A World Within',
      artist: 'Artlens — demo',
      demo: true,
    })
  }

  // 1) Recognize the artwork.
  let recognition: RecognitionResult
  try {
    recognition = await getRecognitionProvider().recognize({
      imageBase64: image,
      mime,
    })
  } catch (e) {
    return json({ status: 'error', error: `Recognition failed: ${errMessage(e)}` }, 502)
  }

  const title = recognition.title?.trim() || 'Untitled'
  const artist = recognition.artist?.trim() || 'Unknown artist'
  const admin = adminClient()

  // 2) Cache lookup (only trust confidently recognized works).
  if (recognition.recognized) {
    const { data: hit } = await admin
      .from('artworks')
      .select('id, title, artist, panorama_url')
      .ilike('title', title)
      .ilike('artist', artist)
      .not('panorama_url', 'is', null)
      .limit(1)
      .maybeSingle()
    if (hit?.panorama_url) {
      return json({
        status: 'ready',
        panorama_url: hit.panorama_url,
        title: hit.title ?? title,
        artist: hit.artist ?? artist,
      })
    }
  }

  // 3) Upload the reference frame (used as the generator's structure image).
  let referenceUrl: string | null = null
  try {
    const bytes = base64ToBytes(image)
    const path = `ref/${crypto.randomUUID()}.jpg`
    const { error } = await admin.storage
      .from('reference-images')
      .upload(path, bytes, { contentType: mime, upsert: true })
    if (!error) {
      referenceUrl = admin.storage.from('reference-images').getPublicUrl(path)
        .data.publicUrl
    }
  } catch {
    // non-fatal — generation can fall back to base64
  }

  const scenePrompt = buildScenePrompt(recognition)

  // 4) Upsert the artwork row.
  const { data: artwork } = await admin
    .from('artworks')
    .insert({
      title,
      artist,
      reference_image_url: referenceUrl,
      scene_prompt: scenePrompt,
    })
    .select('id')
    .single()

  // 5) No panorama key → recognized, but serve the demo world.
  if (!hasPanoramaKey()) {
    return json({ status: 'ready', panorama_url: DEMO_PANORAMA, title, artist, demo: true })
  }

  // 6) Create a job and run generation in the background.
  const { data: job, error: jobErr } = await admin
    .from('jobs')
    .insert({ artwork_id: artwork?.id ?? null, status: 'pending' })
    .select('id')
    .single()
  if (jobErr || !job) {
    return json({ status: 'error', error: 'Could not create generation job' }, 500)
  }

  const work = runGeneration({
    admin,
    jobId: job.id,
    artworkId: artwork?.id ?? null,
    referenceImage: referenceUrl ?? image,
    scenePrompt,
  })

  // Keep the function alive until generation finishes (Supabase runtime API).
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(work)
  else work.catch((e) => console.error('background generation failed', e))

  return json({ status: 'generating', job_id: job.id, title, artist })
})

interface GenerationArgs {
  admin: SupabaseClient
  jobId: string
  artworkId: string | null
  referenceImage: string
  scenePrompt: string
}

async function runGeneration({
  admin,
  jobId,
  artworkId,
  referenceImage,
  scenePrompt,
}: GenerationArgs): Promise<void> {
  const stamp = () => new Date().toISOString()
  try {
    await admin.from('jobs').update({ status: 'generating', updated_at: stamp() }).eq('id', jobId)

    const { equirectPngUrl } = await getPanoramaProvider().generate({
      referenceImage,
      prompt: scenePrompt,
    })

    // Re-host into our public, CORS-permissive bucket for WebGL.
    const res = await fetch(equirectPngUrl)
    if (!res.ok) throw new Error(`Failed to download panorama (${res.status})`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const path = `pano/${jobId}.png`
    const { error: upErr } = await admin.storage
      .from('panoramas')
      .upload(path, buf, { contentType: 'image/png', upsert: true })
    if (upErr) throw upErr
    const publicUrl = admin.storage.from('panoramas').getPublicUrl(path).data
      .publicUrl

    if (artworkId) {
      await admin.from('artworks').update({ panorama_url: publicUrl }).eq('id', artworkId)
    }
    await admin
      .from('jobs')
      .update({ status: 'ready', panorama_url: publicUrl, updated_at: stamp() })
      .eq('id', jobId)
  } catch (e) {
    await admin
      .from('jobs')
      .update({ status: 'error', error: errMessage(e), updated_at: stamp() })
      .eq('id', jobId)
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
