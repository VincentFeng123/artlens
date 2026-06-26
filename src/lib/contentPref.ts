import { SUPPORTED_LOCALES, type Locale, type ReadingLevel } from '../../shared/types'

const LANG_KEY = 'artlens:lang'
const LEVEL_KEY = 'artlens:level'

/** Map a navigator language tag to the nearest supported Locale (else 'en'). */
export function detectLocale(): Locale {
  const raw = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en'
  const lower = raw.toLowerCase()
  if (lower.startsWith('zh')) {
    return /(^|[-_])(hant|tw|hk|mo)/.test(lower) ? 'zh-Hant' : 'zh-Hans'
  }
  const primary = lower.split('-')[0] as Locale
  return (SUPPORTED_LOCALES as string[]).includes(primary) ? primary : 'en'
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

export function getPref(): { lang: Locale; level: ReadingLevel } {
  return {
    lang: read(LANG_KEY, SUPPORTED_LOCALES, detectLocale()),
    level: read(LEVEL_KEY, ['simple', 'medium', 'rich'] as const, 'medium'),
  }
}

export function setPref(p: { lang: Locale; level: ReadingLevel }): void {
  try {
    localStorage.setItem(LANG_KEY, p.lang)
    localStorage.setItem(LEVEL_KEY, p.level)
  } catch { /* private mode — ignore */ }
}
