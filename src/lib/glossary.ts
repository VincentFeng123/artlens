import type { Locale } from '../../shared/types'

/** CJK locales have no spaces, so glossary matching must use substring (not \b). */
export function isCjk(lang: Locale): boolean {
  return lang === 'zh-Hans' || lang === 'zh-Hant' || lang === 'ja' || lang === 'ko'
}

/** Build a term-match regex: word-boundary for Latin scripts, plain for CJK. */
export function termRegex(term: string, lang: Locale): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return isCjk(lang) ? new RegExp(esc, 'i') : new RegExp(`\\b${esc}(?:e?s)?\\b`, 'i')
}
