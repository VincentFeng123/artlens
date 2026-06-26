import { supabase } from './supabase'
import type { ArtworkMeta, Locale, ReadingLevel } from '../../shared/types'

/**
 * Fetch the dossier for (lang, level). Returns the localized ArtworkMeta, or the
 * provided base unchanged on any failure (never throws to the UI).
 */
export async function localizeDossier(args: {
  artworkId?: string
  lang: Locale
  level: ReadingLevel
  base: ArtworkMeta
}): Promise<ArtworkMeta> {
  const { artworkId, lang, level, base } = args
  if (lang === 'en' && level === 'medium') return base
  const body = { artwork_id: artworkId, lang, level, base }
  try {
    if (supabase) {
      const { data, error } = await supabase.functions.invoke<{ meta: ArtworkMeta }>('localize', { body })
      if (error || !data?.meta) throw new Error(error?.message ?? 'no meta')
      return data.meta
    }
    const res = await fetch('/api/localize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = (await res.json()) as { meta?: ArtworkMeta; error?: string }
    if (!data.meta) throw new Error(data.error ?? 'no meta')
    return data.meta
  } catch (e) {
    console.warn('localize failed; keeping base', e)
    return { ...base, lang, level }
  }
}
