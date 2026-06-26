import { adminClient } from '../_shared/supabaseAdmin.ts'
import { json, preflight, errMessage } from '../_shared/cors.ts'
import { buildArtworkMeta } from '../_shared/prompt.ts'
import { transformDossier } from '../_shared/localize.ts'
import type { ArtworkMeta, Locale, ReadingLevel } from '../_shared/types.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  let artworkId: string | null = null
  let lang: Locale = 'en'
  let level: ReadingLevel = 'medium'
  let base: ArtworkMeta | undefined
  try {
    const body = await req.json()
    artworkId = body.artwork_id ?? null
    lang = body.lang ?? 'en'
    level = body.level ?? 'medium'
    base = body.base
  } catch {
    return json({ error: 'invalid body' }, 400)
  }

  const admin = adminClient()

  // 1) cache hit
  if (artworkId) {
    const { data: hit } = await admin
      .from('artwork_content')
      .select('dossier')
      .eq('artwork_id', artworkId).eq('lang', lang).eq('level', level)
      .maybeSingle()
    if (hit?.dossier) return json({ meta: hit.dossier as ArtworkMeta })
  }

  // 2) resolve source: persisted base, else the base from the request body
  let source: ArtworkMeta | undefined
  if (artworkId) {
    const { data: row } = await admin
      .from('artwork_content')
      .select('dossier')
      .eq('artwork_id', artworkId).eq('lang', 'en').eq('level', 'medium')
      .maybeSingle()
    source = row?.dossier as ArtworkMeta | undefined
  }
  source = source ?? base
  if (!source) return json({ error: 'no base dossier available' }, 404)

  // English/Medium is the base itself — no transform.
  if (lang === 'en' && level === 'medium') return json({ meta: source })

  // 3) transform (fall back to source on failure — never blank)
  let localized: ArtworkMeta
  try {
    const out = await transformDossier(source, lang, level)
    localized = buildArtworkMeta(out, { demo: Boolean(source.demo) })
    localized.lang = lang
    localized.level = level
    localized.palette_hex = source.palette_hex
  } catch (e) {
    console.error('localize transform failed (serving base)', errMessage(e))
    return json({ meta: { ...source, lang, level } })
  }

  // 4) cache when we have an artwork id
  if (artworkId) {
    await admin.from('artwork_content')
      .upsert({ artwork_id: artworkId, lang, level, dossier: localized })
  }
  return json({ meta: localized })
})
