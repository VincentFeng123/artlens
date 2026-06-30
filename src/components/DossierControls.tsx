import { SUPPORTED_LOCALES, type Locale, type ReadingLevel } from '../../shared/types'

/** Display label per supported locale (its own endonym), in picker order. */
export const LANG_LABEL: Record<Locale, string> = {
  en: 'English', es: 'Español', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文',
  fr: 'Français', de: 'Deutsch', ja: '日本語', ko: '한국어', pt: 'Português',
}

/** Reading levels low→high, index-aligned to the slider stops (0,1,2). */
export const LEVELS: ReadingLevel[] = ['simple', 'medium', 'rich']

/**
 * Friendly slider labels per level — DISPLAY ONLY. The stored {@link ReadingLevel}
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
 * The dossier language pill (a <details> over SUPPORTED_LOCALES) + a 3-stop
 * reading-level slider. Controlled: renders from `value`, emits `onChange` on a
 * language pick or slider move. Owns NO persistence — each consumer wires
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
      <input
        className="world__level"
        type="range" min={0} max={2} step={1}
        value={LEVELS.indexOf(value.level)}
        aria-label="Reading level"
        onChange={(e) => onChange({ ...value, level: LEVELS[Number(e.target.value)] })}
      />
      <span className="world__level-label">{LEVEL_LABEL[value.level]}</span>
    </div>
  )
}
