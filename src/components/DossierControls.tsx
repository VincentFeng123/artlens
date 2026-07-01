import { SUPPORTED_LOCALES, type Locale, type ReadingLevel } from '../../shared/types'

/** Display label per supported locale (its own endonym), in picker order. */
export const LANG_LABEL: Record<Locale, string> = {
  en: 'English', es: 'Español', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文',
  fr: 'Français', de: 'Deutsch', ja: '日本語', ko: '한국어', pt: 'Português',
}

/** Reading levels low→high, in button order (Kids, Teens, Adult). */
export const LEVELS: ReadingLevel[] = ['simple', 'medium', 'rich']

/**
 * Friendly button labels per level — DISPLAY ONLY. The stored {@link ReadingLevel}
 * stays 'simple' | 'medium' | 'rich', so cache keys, the scan body, and the prompt
 * rubric are unaffected; only the on-screen word changes.
 */
export const LEVEL_LABEL: Record<ReadingLevel, string> = {
  simple: 'Kids', medium: 'Teens', rich: 'Adult',
}

export interface DossierPref {
  lang: Locale
  level: ReadingLevel
}

interface Props {
  value: DossierPref
  onChange: (next: DossierPref) => void
  /** Dims the row (in-world localizing). Visual only — inputs stay interactive. */
  busy?: boolean
}

/**
 * The dossier language pill (a <details> over SUPPORTED_LOCALES) + a 3-button
 * reading-level control (Kids/Teens/Adult). Controlled: renders from `value`,
 * emits `onChange` on a language pick or level click. Owns NO persistence — each consumer wires
 * `onChange` to its own store + state. Reuses the world__controls/__lang/__level
 * styles so it looks identical in the world card and on the Adjust screen.
 */
export function DossierControls({ value, onChange, busy = false }: Props) {
  return (
    <div className={`world__controls${busy ? ' is-busy' : ''}`}>
      <details className="world__lang">
        <summary className="world__lang-pill">{LANG_LABEL[value.lang]}</summary>
        <ul className="world__lang-menu">
          {SUPPORTED_LOCALES.map((l) => (
            <li key={l}>
              <button
                type="button"
                className={l === value.lang ? 'is-active' : ''}
                onClick={(e) => {
                  onChange({ ...value, lang: l })
                  ;(e.currentTarget.closest('details') as HTMLDetailsElement).open = false
                }}
              >{LANG_LABEL[l]}</button>
            </li>
          ))}
        </ul>
      </details>
      <div className="world__level" role="group" aria-label="Reading level">
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            className={`world__level-btn${lvl === value.level ? ' is-active' : ''}`}
            aria-pressed={lvl === value.level}
            onClick={() => onChange({ ...value, level: lvl })}
          >
            {LEVEL_LABEL[lvl]}
          </button>
        ))}
      </div>
    </div>
  )
}
