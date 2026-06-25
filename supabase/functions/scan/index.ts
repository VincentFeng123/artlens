import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from '../_shared/supabaseAdmin.ts'
import { json, preflight, errMessage } from '../_shared/cors.ts'
import {
  getRecognitionProvider,
  hasRecognitionKey,
} from '../_shared/recognition/index.ts'
import { getPanoramaProvider, hasPanoramaProvider } from '../_shared/panorama/index.ts'
import { buildArtworkMeta, buildScenePrompt, DEMO_META } from '../_shared/prompt.ts'
import type { RecognitionResult } from '../_shared/types.ts'
import { routeRealization } from '../_shared/realization/route.ts'

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
      title: DEMO_META.title,
      artist: DEMO_META.artist,
      meta: DEMO_META,
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

  const meta = buildArtworkMeta(recognition)
  const title = meta.title
  const artist = meta.artist
  const realization = routeRealization({
    scene_type: recognition.scene_type,
    figure_coverage: recognition.figure_coverage,
    depth_profile: recognition.depth_profile,
    confidence: recognition.confidence,
  })
  console.log('realization route', {
    title,
    realization,
    scene_type: recognition.scene_type,
    figure_coverage: recognition.figure_coverage,
    depth_profile: recognition.depth_profile,
  })
  const admin = adminClient()

  // 2) Cache lookup (only trust confidently recognized works).
  if (recognition.recognized) {
    const { data: hit } = await admin
      .from('artworks')
      .select('id, title, artist, panorama_url, depth_url, realization')
      .ilike('title', title)
      .ilike('artist', artist)
      .not('panorama_url', 'is', null)
      .limit(1)
      .maybeSingle()
    if (hit?.panorama_url) {
      return json({
        status: 'ready',
        panorama_url: hit.panorama_url,
        depth_url: hit.depth_url ?? null,
        realization: hit.realization ?? realization,
        title: hit.title ?? title,
        artist: hit.artist ?? artist,
        meta: { ...meta, title: hit.title ?? title, artist: hit.artist ?? artist },
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

  const { prompt: scenePrompt, negative: sceneNegative } = buildScenePrompt(recognition)

  // 4) Upsert the artwork row.
  const { data: artwork } = await admin
    .from('artworks')
    .insert({
      title,
      artist,
      reference_image_url: referenceUrl,
      scene_prompt: scenePrompt,
      realization,
    })
    .select('id')
    .single()

  // 5) No usable generator → recognized (real dossier), but serve the demo world.
  if (!hasPanoramaProvider()) {
    return json({ status: 'ready', panorama_url: DEMO_PANORAMA, title, artist, meta, demo: true })
  }

  // 6) Create a job and run generation in the background.
  const { data: job, error: jobErr } = await admin
    .from('jobs')
    .insert({ artwork_id: artwork?.id ?? null, status: 'pending', realization })
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
    sceneNegative,
  })

  // Keep the function alive until generation finishes (Supabase runtime API).
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(work)
  else work.catch((e) => console.error('background generation failed', e))

  // Recognition is already done — hand the dossier to the client to hold while
  // it polls job-status for the panorama.
  return json({ status: 'generating', job_id: job.id, title, artist, meta, realization })
})

interface GenerationArgs {
  admin: SupabaseClient
  jobId: string
  artworkId: string | null
  referenceImage: string
  scenePrompt: string
  sceneNegative: string
}

async function runGeneration({
  admin,
  jobId,
  artworkId,
  referenceImage,
  scenePrompt,
  sceneNegative,
}: GenerationArgs): Promise<void> {
  const stamp = () => new Date().toISOString()
  try {
    await admin.from('jobs').update({ status: 'generating', updated_at: stamp() }).eq('id', jobId)

    const { equirectPngUrl, depthUrl } = await getPanoramaProvider().generate({
      referenceImage,
      prompt: scenePrompt,
      negative: sceneNegative,
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

    // Re-host the depth map too (free Blockade byproduct, used for parallax).
    // Non-fatal: a missing/failed depth map must not fail the job — the client
    // falls back to in-browser depth or a flat sphere.
    let depthPublicUrl: string | null = null
    if (depthUrl) {
      try {
        const dRes = await fetch(depthUrl)
        if (dRes.ok) {
          const dBuf = new Uint8Array(await dRes.arrayBuffer())
          const dPath = `depth/${jobId}.png`
          const { error: dErr } = await admin.storage
            .from('panoramas')
            .upload(dPath, dBuf, { contentType: 'image/png', upsert: true })
          if (!dErr) {
            depthPublicUrl = admin.storage.from('panoramas').getPublicUrl(dPath).data
              .publicUrl
          }
        }
      } catch (e) {
        console.error('depth re-host failed (non-fatal)', e)
      }
    }

    if (artworkId) {
      await admin
        .from('artworks')
        .update({ panorama_url: publicUrl, depth_url: depthPublicUrl })
        .eq('id', artworkId)
    }
    await admin
      .from('jobs')
      .update({
        status: 'ready',
        panorama_url: publicUrl,
        depth_url: depthPublicUrl,
        updated_at: stamp(),
      })
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
