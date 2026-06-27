# Pre-Entry Dossier Language/Difficulty Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dossier language pill + reading-level slider ahead of "Step inside →" on the Adjust screen so the choice configures the *first* dossier render, and have the backend eager-generate that variant at scan time so the world opens instantly in the chosen language/level.

**Architecture:** Extract the inline control row from `WorldViewer` into a reusable controlled `DossierControls` component, reused by both `AdjustScreen` (pre-entry) and `WorldViewer` (mid-exploration), both sharing the persisted `contentPref` store. The client sends the current `{lang, level}` in the scan request body; the `scan` Edge Function (and its dev mirror) fire a non-fatal, fire-and-forget eager-localization concurrently with panorama generation, caching the variant in `artwork_content` so `WorldViewer`'s on-load localize hits the cache (no shimmer).

**Tech Stack:** TypeScript; React 18 + Vite; Supabase Edge Functions (Deno); Postgres; Vitest (jsdom opt-in); Gemini (existing `GEMINI_API_KEY`, no new key).

**Spec:** `docs/superpowers/specs/2026-06-27-pre-entry-dossier-selector-design.md` — read it; this plan implements it. Builds on the shipped localized-dossier feature (`contentPref`, `localize` edge fn, `transformDossier`, `artwork_content`, `SUPPORTED_LOCALES`/`Locale`/`ReadingLevel`).

## Global Constraints

- **Levels are exactly** `'simple' | 'medium' | 'rich'`; base is `(en, medium)`. **Locales are exactly** `['en','es','zh-Hans','zh-Hant','fr','de','ja','ko','pt']`. No new languages/levels.
- **Eager-gen is non-fatal & fire-and-forget:** any failure is swallowed (logged); it NEVER blocks or fails the scan or the world. It only fires when `(lang, level) !== ('en','medium')` AND an artwork id exists.
- **Never blank:** if the eager-gen cache isn't warm yet, `WorldViewer`'s existing on-load localize still fetches it (brief shimmer) — fall back, never blank.
- **Shape-identical cache entries:** an eager-generated `artwork_content` row must be byte-identical in shape to what the on-demand `localize` function produces — same `buildArtworkMeta` normalization, same carried `lang`/`level`/`palette_hex`. (Achieved via the shared `localizeAndCache` helper, which mirrors `localize/index.ts` steps 3–4.)
- **Mirrors:** `shared/*` ↔ `supabase/functions/_shared/*` are MANUAL MIRRORS — edit both, keep identical. (This plan does NOT touch the mirrored `types.ts`/`prompt.ts`. `_shared/localize.ts` is edge-only — its Node twin is `localizeNode` in `dev-api/providers.ts`; the dev mirror is updated in Task 5.)
- **Deploy surface:** only the `scan` function changes behavior, so only `scan` needs redeploy after merge. **Do NOT modify `localize/index.ts`.** No new migration, no new function. **Do not deploy or migrate without explicit OK.**
- **Testing tooling:** Vitest default env is `node`; opt into jsdom with a top-of-file `// @vitest-environment jsdom` comment. **No `@testing-library/*` is installed** — render tests use `react-dom/client` + `act` directly. The vitest `include` glob is `src/**/*.test.ts` and `supabase/**/*.test.ts` — **test files must end in `.test.ts` (not `.test.tsx`)**, so write React tests with `createElement` (no JSX). Pure `src`/`shared` TS is covered by `npm run typecheck`/`npm run build`; Deno edge files by `deno check`; `dev-api` by `npx tsc -p tsconfig.node.json --noEmit` (via the `vite.config.ts` import graph).
- **DRY:** `toRequestBody` is the single place the client builds the scan body — adding `lang`/`level` there covers BOTH the Edge and dev paths at once.

## File structure

**New:**
- `src/components/DossierControls.tsx` — the reusable controlled control row (owns `LANG_LABEL`, `LEVELS`).
- `src/components/DossierControls.test.ts` — render + onChange test (jsdom, `react-dom/client` + `act`, `createElement`).
- `src/lib/api.test.ts` — asserts the scan body carries `lang`/`level` from `getPref()`.

**Modified:**
- `src/components/WorldViewer.tsx` — replace the inline `world__controls` row with `<DossierControls …>`; drop the now-moved `LANG_LABEL`/`LEVELS` consts and the unused `SUPPORTED_LOCALES`/`ReadingLevel` imports.
- `src/components/AdjustScreen.tsx` — render `<DossierControls …>` above `.adjust__toolbar`, wired to `setPref` + local state.
- `src/index.css` — one `.adjust__controls` wrapper rule.
- `src/lib/api.ts` — `toRequestBody` reads `getPref()` and includes `lang`/`level`.
- `supabase/functions/_shared/localize.ts` — add `localizeAndCache(admin, artworkId, source, lang, level)`.
- `supabase/functions/scan/index.ts` — parse `lang`/`level`; fire `eagerLocalize(...)` (via `EdgeRuntime.waitUntil`) on the cache-hit, no-generator, and generation branches.
- `dev-api/providers.ts` — export a shared `localizeCache` Map + `localizeCacheKey`; `runScan` takes `lang`/`level` and fires a non-awaited eager-localize into the cache.
- `dev-api/plugin.ts` — use the shared `localizeCache`; `/api/scan` reads `lang`/`level` and passes them to `runScan`.

---

### Task 1: Extract `DossierControls`, reuse it in `WorldViewer`

**Files:**
- Create: `src/components/DossierControls.tsx`
- Test: `src/components/DossierControls.test.ts`
- Modify: `src/components/WorldViewer.tsx` (imports at `:11`–`:22`; control row at `:534`–`:564`)

**Interfaces:**
- Produces:
  - `export interface DossierPref { lang: Locale; level: ReadingLevel }`
  - `export const LANG_LABEL: Record<Locale, string>`
  - `export const LEVELS: ReadingLevel[]` (`['simple','medium','rich']`)
  - `export function DossierControls(props: { value: DossierPref; onChange: (next: DossierPref) => void; busy?: boolean }): JSX.Element`
- Consumes: `SUPPORTED_LOCALES`, `Locale`, `ReadingLevel` from `../../shared/types`.

- [ ] **Step 1: Write the failing test** — `src/components/DossierControls.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DossierControls, LANG_LABEL, LEVELS, type DossierPref } from './DossierControls'

// React 18 requires this flag for act() outside a test renderer.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(value: DossierPref, onChange: (n: DossierPref) => void): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(createElement(DossierControls, { value, onChange })) })
  return container
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  container = null
  root = null
})

describe('DossierControls', () => {
  it('renders the pill label and slider position from value', () => {
    const el = render({ lang: 'ja', level: 'rich' }, () => {})
    expect(el.querySelector('.world__lang-pill')!.textContent).toBe(LANG_LABEL.ja)
    const slider = el.querySelector('.world__level') as HTMLInputElement
    expect(slider.value).toBe(String(LEVELS.indexOf('rich')))
    expect(el.querySelector('.world__level-label')!.textContent).toBe('rich')
  })

  it('calls onChange with the picked language', () => {
    const onChange = vi.fn()
    const el = render({ lang: 'en', level: 'medium' }, onChange)
    const buttons = Array.from(el.querySelectorAll('.world__lang-menu button')) as HTMLButtonElement[]
    const es = buttons.find((b) => b.textContent === LANG_LABEL.es)!
    act(() => { es.click() })
    expect(onChange).toHaveBeenCalledWith({ lang: 'es', level: 'medium' })
  })

  it('calls onChange with the new level on a slider move', () => {
    const onChange = vi.fn()
    const el = render({ lang: 'en', level: 'medium' }, onChange)
    const slider = el.querySelector('.world__level') as HTMLInputElement
    // Bypass React's value tracking so the synthetic onChange fires.
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setNativeValue.call(slider, '0')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({ lang: 'en', level: 'simple' })
  })
})
```

> Note: if `act` is not exported from `react` in this version, change the import to `import { createElement } from 'react'` + `import { act } from 'react-dom/test-utils'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/DossierControls.test.ts`
Expected: FAIL — cannot resolve `./DossierControls` (module not found).

- [ ] **Step 3: Create the component** — `src/components/DossierControls.tsx`

```tsx
import { SUPPORTED_LOCALES, type Locale, type ReadingLevel } from '../../shared/types'

/** Display label per supported locale (its own endonym), in picker order. */
export const LANG_LABEL: Record<Locale, string> = {
  en: 'English', es: 'Español', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文',
  fr: 'Français', de: 'Deutsch', ja: '日本語', ko: '한국어', pt: 'Português',
}

/** Reading levels low→high, index-aligned to the slider stops (0,1,2). */
export const LEVELS: ReadingLevel[] = ['simple', 'medium', 'rich']

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
      <span className="world__level-label">{value.level}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/DossierControls.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Replace the inline control row in `WorldViewer.tsx`**

5a. Trim the types import at line 11 (drop `SUPPORTED_LOCALES` and `ReadingLevel` — they are no longer referenced once the row moves out):

```tsx
import { type ArtworkMeta, type GlossaryTerm, type Locale, type Realization, type SymbolNote } from '../../shared/types'
```

5b. Delete the now-moved consts (lines 18–22):

```tsx
const LANG_LABEL: Record<Locale, string> = {
  en: 'English', es: 'Español', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文',
  fr: 'Français', de: 'Deutsch', ja: '日本語', ko: '한국어', pt: 'Português',
}
const LEVELS: ReadingLevel[] = ['simple', 'medium', 'rich']
```

5c. Add the component import next to the existing `getPref`/`setPref` import (after line 14):

```tsx
import { DossierControls } from './DossierControls'
```

5d. Replace the entire inline control `<div className={`world__controls…`}>…</div>` block (lines 534–564) with:

```tsx
          <DossierControls
            value={pref}
            busy={localizing}
            onChange={(next) => { setPref(next); setPrefState(next) }}
          />
```

(Keep everything else — the `localize` effect at `:92`–`:100`, the `setPref`/`getPref` imports, the `pref`/`setPrefState`/`localizing` state — unchanged.)

- [ ] **Step 6: Verify nothing else referenced the removed symbols, then typecheck + build**

Run: `grep -n "SUPPORTED_LOCALES\|LANG_LABEL\|LEVELS\|ReadingLevel" src/components/WorldViewer.tsx`
Expected: no matches.

Run: `npm run typecheck && npm run build`
Expected: PASS (no unused-locals/imports errors; clean build).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (existing suites + the 3 new `DossierControls` tests).

- [ ] **Step 8: Commit**

```bash
git add src/components/DossierControls.tsx src/components/DossierControls.test.ts src/components/WorldViewer.tsx
git commit -m "feat: extract reusable DossierControls; reuse in WorldViewer"
```

---

### Task 2: Render `DossierControls` on the Adjust screen

**Files:**
- Modify: `src/components/AdjustScreen.tsx` (imports at `:1`–`:3`; render at `:149`–`:150`)
- Modify: `src/index.css` (add `.adjust__controls` near the `.adjust__toolbar` block at `:1415`)

**Interfaces:**
- Consumes: `DossierControls`, `DossierPref` (Task 1); `getPref`, `setPref` from `../lib/contentPref`.
- Produces: nothing new (UI wiring only).

- [ ] **Step 1: Add imports to `AdjustScreen.tsx`**

After the existing imports (top of file, after line 3), add:

```tsx
import { DossierControls } from './DossierControls'
import { getPref, setPref } from '../lib/contentPref'
```

- [ ] **Step 2: Add local preference state**

Inside `AdjustScreen`, alongside the other `useState` hooks (after line 44, the `statusText` state), add:

```tsx
  const [pref, setLocalPref] = useState(getPref)
```

- [ ] **Step 3: Render the controls above the toolbar**

In the main (`status !== 'error'`) return, insert the controls between the `.adjust__hint` paragraph and the `.adjust__toolbar` div (between lines 149 and 150):

```tsx
      <p className="adjust__hint">Drag the four corners onto the artwork's edges.</p>
      <div className="adjust__controls">
        <DossierControls
          value={pref}
          onChange={(next) => { setPref(next); setLocalPref(next) }}
        />
      </div>
      <div className="adjust__toolbar">
```

- [ ] **Step 4: Add the wrapper style** — `src/index.css`

Immediately after the `.adjust__toolbar { … }` rule (ends at line 1421), add:

```css
.adjust__controls {
  display: flex;
  justify-content: center;
  width: 100%;
  max-width: 560px;
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AdjustScreen.tsx src/index.css
git commit -m "feat: pre-entry DossierControls on the Adjust screen"
```

---

### Task 3: Client sends `{lang, level}` in the scan request body

**Files:**
- Modify: `src/lib/api.ts` (imports at `:2`; `toRequestBody` at `:228`–`:238`)
- Test: `src/lib/api.test.ts`

**Interfaces:**
- Consumes: `getPref` from `./contentPref`; `Locale`, `ReadingLevel` from `../../shared/types`.
- Produces: `toRequestBody(jpeg)` now resolves `{ image: string; mime: string; lang: Locale; level: ReadingLevel }` — consumed unchanged by both `scanViaEdge` and `scanViaDevApi`.

- [ ] **Step 1: Write the failing test** — `src/lib/api.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Force the dev (fetch) path and a known preference.
vi.mock('./supabase', () => ({ supabase: null }))
vi.mock('./contentPref', () => ({ getPref: () => ({ lang: 'ja', level: 'rich' }) }))

import { scanArtwork } from './api'

beforeEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('scanArtwork request body', () => {
  it('includes lang/level from getPref()', async () => {
    let sent: { image?: string; mime?: string; lang?: string; level?: string } | null = null
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body)
      return {
        ok: true,
        json: async () => ({
          status: 'ready', panorama_url: 'x', title: 't', artist: 'a', artwork_id: null,
        }),
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('DEV', 'true') // ensure the dev path (supabase is mocked null)

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    await scanArtwork(blob)

    expect(fetchMock).toHaveBeenCalled()
    expect(sent!.lang).toBe('ja')
    expect(sent!.level).toBe('rich')
    expect(typeof sent!.image).toBe('string')
    expect(sent!.mime).toBe('image/jpeg')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/api.test.ts`
Expected: FAIL — `sent.lang` is `undefined` (the body has no `lang`/`level` yet).

- [ ] **Step 3: Implement — `src/lib/api.ts`**

3a. Extend the shared-types import at line 2 and add the `getPref` import below it:

```ts
import type { ArtworkMeta, JobStatusResponse, Locale, Realization, ReadingLevel, ScanResponse } from '../../shared/types'
import { DEMO_META } from '../../shared/prompt'
import { getPref } from './contentPref'
```

3b. Replace `toRequestBody` (lines 228–238) with:

```ts
function toRequestBody(
  jpeg: Blob,
): Promise<{ image: string; mime: string; lang: Locale; level: ReadingLevel }> {
  const { lang, level } = getPref()
  return jpeg.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return { image: btoa(binary), mime: jpeg.type || 'image/jpeg', lang, level }
  })
}
```

(`DEMO_META` import stays exactly as it was — only `getPref` is added beneath it. Both `scanViaEdge` and `scanViaDevApi` already call `toRequestBody(jpeg)`, so both paths now carry `lang`/`level` with no further change.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat: send current lang/level in the scan request body"
```

---

### Task 4: Backend eager-gen — `localizeAndCache` helper + `scan` fires it

**Files:**
- Modify: `supabase/functions/_shared/localize.ts` (imports at `:1`–`:3`; add `localizeAndCache`)
- Modify: `supabase/functions/scan/index.ts` (imports at `:11`–`:12`; body parse at `:26`–`:35`; cache-hit at `:90`–`:101`; no-generator at `:146`–`:148`; generating return at `:177`)

**Interfaces:**
- Produces (`_shared/localize.ts`):
  - `export async function localizeAndCache(admin: SupabaseClient, artworkId: string | null, source: ArtworkMeta, lang: Locale, level: ReadingLevel): Promise<ArtworkMeta>` — transforms `source` into `(lang, level)`, normalizes via `buildArtworkMeta`, carries `lang`/`level`/`palette_hex`, upserts into `artwork_content` when `artworkId` is set (upsert non-fatal), and returns the localized dossier. Throws only if the transform fails.
- Consumes (`scan/index.ts`): `localizeAndCache`; `ArtworkMeta`, `Locale`, `ReadingLevel` from `../_shared/types.ts`; the existing `EdgeRuntime.waitUntil` runtime shim; `errMessage` from `../_shared/cors.ts`.

- [ ] **Step 1: Add `localizeAndCache` to `_shared/localize.ts`**

1a. Update the imports (lines 1–3) to add `SupabaseClient`, `ArtworkMeta`, and `buildArtworkMeta`:

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ArtworkMeta, Locale, ReadingLevel, RecognitionResult } from './types.ts'
import { buildArtworkMeta, buildLocalizePrompt, parseRecognitionJson } from './prompt.ts'
```

1b. Append the helper to the end of the file (after `transformDossier`):

```ts
/**
 * Transform `source` into (lang, level), normalize to a full ArtworkMeta, and —
 * when `artworkId` is set — upsert it into `artwork_content`. Returns the
 * localized dossier. Mirrors steps 3–4 of `localize/index.ts` so an
 * EAGER-generated cache entry is byte-identical to the on-demand one (same
 * buildArtworkMeta normalization, same carried lang/level/palette_hex). The
 * upsert is non-fatal; only a failed transform throws (the caller decides).
 */
export async function localizeAndCache(
  admin: SupabaseClient,
  artworkId: string | null,
  source: ArtworkMeta,
  lang: Locale,
  level: ReadingLevel,
): Promise<ArtworkMeta> {
  const out = await transformDossier(source, lang, level)
  const localized = buildArtworkMeta(out, { demo: Boolean(source.demo) })
  localized.lang = lang
  localized.level = level
  localized.palette_hex = source.palette_hex
  if (artworkId) {
    try {
      await admin.from('artwork_content')
        .upsert({ artwork_id: artworkId, lang, level, dossier: localized })
    } catch (e) {
      console.error('eager-gen cache upsert failed (non-fatal)', e)
    }
  }
  return localized
}
```

- [ ] **Step 2: Wire `scan/index.ts` — imports + body parse**

2a. Add the helper import and widen the types import (lines 11–12 area):

```ts
import type { ArtworkMeta, Locale, ReadingLevel, RecognitionResult } from '../_shared/types.ts'
import { routeRealization } from '../_shared/realization/route.ts'
import { localizeAndCache } from '../_shared/localize.ts'
```

2b. Read `lang`/`level` from the body. Replace the parse block (lines 27–35):

```ts
  // Parse body { image: base64, mime, lang, level }
  let image = ''
  let mime = 'image/jpeg'
  let lang: Locale = 'en'
  let level: ReadingLevel = 'medium'
  try {
    const body = await req.json()
    image = body.image
    mime = body.mime ?? 'image/jpeg'
    lang = body.lang ?? 'en'
    level = body.level ?? 'medium'
    if (!image) throw new Error('missing image')
  } catch {
    return json({ status: 'error', error: 'Invalid request body' }, 400)
  }
```

- [ ] **Step 3: Add the `eagerLocalize` fire-and-forget helper to `scan/index.ts`**

Add this module-level function (e.g. directly above `Deno.serve`):

```ts
/**
 * Fire-and-forget eager localization, concurrent with panorama generation, so
 * the world opens in the chosen language with no shimmer. Non-fatal: any failure
 * is swallowed (logged) and never affects the scan. No-ops for the base
 * (en, medium) or when no artwork id exists.
 */
function eagerLocalize(
  admin: SupabaseClient,
  artworkId: string | null,
  source: ArtworkMeta,
  lang: Locale,
  level: ReadingLevel,
): void {
  if (!artworkId) return
  if (lang === 'en' && level === 'medium') return
  const work = localizeAndCache(admin, artworkId, source, lang, level)
    .then(() => {})
    .catch((e) => console.warn('eager-gen failed (non-fatal)', errMessage(e)))
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(work)
  else work.catch((e) => console.error('eager-gen failed', e))
}
```

- [ ] **Step 4: Fire it on the cache-hit branch**

In the cache-hit block (lines 90–101), compute the response meta once, fire eager-gen, then return. Replace:

```ts
    if (hit?.panorama_url) {
      return json({
        status: 'ready',
        panorama_url: hit.panorama_url,
        depth_url: hit.depth_url ?? null,
        realization: hit.realization ?? realization,
        title: hit.title ?? title,
        artist: hit.artist ?? artist,
        meta: { ...meta, title: hit.title ?? title, artist: hit.artist ?? artist },
        artwork_id: hit.id,
      })
    }
```

with:

```ts
    if (hit?.panorama_url) {
      const cachedMeta = { ...meta, title: hit.title ?? title, artist: hit.artist ?? artist }
      // Cache opens fast (~1s) and may beat eager-gen; that's fine — WorldViewer's
      // on-load localize covers the gap and this warms the cache for next time.
      eagerLocalize(admin, hit.id, cachedMeta, lang, level)
      return json({
        status: 'ready',
        panorama_url: hit.panorama_url,
        depth_url: hit.depth_url ?? null,
        realization: hit.realization ?? realization,
        title: hit.title ?? title,
        artist: hit.artist ?? artist,
        meta: cachedMeta,
        artwork_id: hit.id,
      })
    }
```

- [ ] **Step 5: Fire it on the no-generator branch**

In the no-panorama-provider block (lines 146–148), fire eager-gen before returning:

```ts
  // 5b) No usable generator → recognized (real dossier), but serve the demo world.
  if (!hasPanoramaProvider()) {
    eagerLocalize(admin, artwork?.id ?? null, meta, lang, level)
    return json({ status: 'ready', panorama_url: DEMO_PANORAMA, title, artist, meta, artwork_id: artwork?.id ?? null, demo: true })
  }
```

- [ ] **Step 6: Fire it on the generation branch (concurrent with the panorama)**

After the `runtime?.waitUntil(work)` block and before the final `return json({ status: 'generating', … })` (around line 174–177), add:

```ts
  // Eager-generate the chosen variant concurrently with the panorama (30–180s),
  // so it's cached well before WorldViewer's localize effect requests it.
  eagerLocalize(admin, artwork?.id ?? null, meta, lang, level)

  // Recognition is already done — hand the dossier to the client to hold while
  // it polls job-status for the panorama.
  return json({ status: 'generating', job_id: job.id, title, artist, meta, realization, artwork_id: artwork?.id ?? null })
```

- [ ] **Step 7: Deno type-check both edge files**

Run: `deno check supabase/functions/_shared/localize.ts supabase/functions/scan/index.ts`
Expected: PASS (no type errors). If `deno` resolves a different lock, run each file separately.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/localize.ts supabase/functions/scan/index.ts
git commit -m "feat: eager-generate chosen dossier variant at scan time (non-fatal)"
```

---

### Task 5: Dev parity — eager-gen in `runScan`, shared `localizeCache`

**Files:**
- Modify: `dev-api/providers.ts` (`runScan` at `:23`–`:27` + body; add exports near `:21`)
- Modify: `dev-api/plugin.ts` (imports at `:11`; local cache at `:29`; `/api/scan` body type at `:42` and `runScan` call at `:58`; `/api/localize` cacheKey at `:161`)

**Interfaces:**
- Produces (`dev-api/providers.ts`):
  - `export const localizeCache: Map<string, ArtworkMeta>` — shared between `runScan` (eager-gen writer) and the `/api/localize` handler (reader/writer).
  - `export function localizeCacheKey(artworkId: string, lang: Locale, level: ReadingLevel): string` → `` `${artworkId}:${lang}:${level}` ``.
  - `runScan(imageBase64, mime, env, lang = 'en', level = 'medium')` — same return type; now fires a non-awaited eager-localize into `localizeCache`.
- Consumes (`dev-api/plugin.ts`): the three exports above; `Locale`, `ReadingLevel` (already imported at `:12`).

- [ ] **Step 1: Add the shared cache + key + eager helper to `providers.ts`**

1a. After the `DEMO_PANORAMA` const (line 21), add the shared cache and key helper:

```ts
/**
 * Shared dev localize cache, keyed `${artwork_id}:${lang}:${level}`. Written by
 * the eager-gen in runScan AND by the /api/localize handler (plugin.ts), and read
 * by /api/localize — so a pre-entry selection is warm when WorldViewer requests it.
 */
export const localizeCache = new Map<string, ArtworkMeta>()
export function localizeCacheKey(artworkId: string, lang: Locale, level: ReadingLevel): string {
  return `${artworkId}:${lang}:${level}`
}

/** Fire-and-forget dev eager localization (mirror of scan/index.ts). Non-fatal. */
function eagerLocalizeDev(
  base: ArtworkMeta,
  artworkId: string,
  lang: Locale,
  level: ReadingLevel,
  env: Env,
): void {
  if (lang === 'en' && level === 'medium') return
  if (!env.GEMINI_API_KEY) return // localizeNode needs the Gemini key
  const key = localizeCacheKey(artworkId, lang, level)
  if (localizeCache.has(key)) return
  void localizeNode(base, lang, level, env)
    .then((m) => { localizeCache.set(key, m) })
    .catch((e) => console.error('[dev-api] eager-gen failed (non-fatal)', e))
}
```

- [ ] **Step 2: Accept `lang`/`level` in `runScan` and fire eager-gen**

2a. Widen the signature (lines 23–27):

```ts
export async function runScan(
  imageBase64: string,
  mime: string,
  env: Env,
  lang: Locale = 'en',
  level: ReadingLevel = 'medium',
): Promise<ScanResponse> {
```

2b. Fire eager-gen right after `artwork_id` is computed (immediately after line 47, `const artwork_id = djb2(title + '|' + artist).toString(16)`), so it runs concurrently with whichever panorama branch follows:

```ts
  const artwork_id = djb2(title + '|' + artist).toString(16)

  // Eager-localize concurrently with panorama generation (mirror of scan/index.ts).
  eagerLocalizeDev(meta, artwork_id, lang, level, env)
```

- [ ] **Step 3: Use the shared cache + pass `lang`/`level` in `plugin.ts`**

3a. Update the providers import (line 11):

```ts
import { localizeCache, localizeCacheKey, localizeNode, runScan } from './providers'
```

3b. Delete the local cache declaration (line 29):

```ts
  const localizeCache = new Map<string, ArtworkMeta>()
```

3c. Widen the `/api/scan` body annotation (line 42) and pass `lang`/`level` into `runScan` (line 58):

```ts
        let body: { image?: string; mime?: string; lang?: string; level?: string }
```

```ts
        runScan(
          body.image,
          body.mime ?? 'image/jpeg',
          env,
          (body.lang as Locale) ?? 'en',
          (body.level as ReadingLevel) ?? 'medium',
        )
```

3d. In `/api/localize`, build the cache key via the shared helper (replace line 161):

```ts
        const cacheKey = localizeCacheKey(artwork_id, lang, level)
```

(The `ArtworkMeta` import in `plugin.ts` at line 12 stays — it's still used by `JobRecord`.)

- [ ] **Step 4: Type-check the dev-api graph + build**

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: PASS (this checks `vite.config.ts` → `dev-api/plugin.ts` → `dev-api/providers.ts`).

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dev-api/providers.ts dev-api/plugin.ts
git commit -m "feat: dev parity — eager-gen chosen dossier variant in runScan"
```

---

### Task 6: Full verification + manual end-to-end

**Files:** none (verification only).

- [ ] **Step 1: Run every automated gate**

```bash
npm test
npm run typecheck
npm run build
npx tsc -p tsconfig.node.json --noEmit
deno check supabase/functions/_shared/localize.ts supabase/functions/scan/index.ts
```

Expected: all PASS. (`npm test` includes the new `DossierControls` and `api` tests plus the existing `contentPref`/`glossary`/edge-shared suites.)

- [ ] **Step 2: Manual end-to-end (per spec §6), with a recognition + Gemini key configured in `.env`, `npm run dev`)**

- On the **Adjust** screen, confirm the language pill + level slider appear **above** "Step inside →".
- Pick **简体中文** + **Simple**, then tap **Step inside →**.
- Confirm the world's info card opens **already in Simplified Chinese / Simple** with **no shimmer** on first open (fresh scan; eager-gen finished during the 30–180s panorama build).
- Confirm the **in-world** pill reads **简体中文** and the slider sits at **Simple** (shared `contentPref`).
- Switch language **in-world** → still swaps correctly (WorldViewer behavior unchanged).
- Negative path: leave the selector at **English / Medium** → behavior identical to today (no eager-gen fired).
- Cache-hit path: scan the same artwork again with a non-default pref → world opens in ~1s; a brief shimmer is acceptable, and the variant is warm on the next open.

- [ ] **Step 3: Confirm the eager-gen cache row (optional, if Supabase is wired)**

After a non-default fresh scan completes, verify an `artwork_content` row exists for `(artwork_id, lang, level)` matching the selection, with a `dossier` whose `lang`/`level` fields match.

- [ ] **Step 4: Deploy note (do NOT run without explicit OK)**

After merge, the `scan` function needs redeploy: `supabase functions deploy scan`. No new migration or function. `localize` is unchanged (no redeploy). The frontend isn't hosted yet (Vercel not connected).

---

## Self-Review

**Spec coverage:**
- §3.1 `DossierControls` (extracted, controlled, `value`/`onChange`/`busy`, owns `LANG_LABEL`/`LEVELS`, reuses `world__*` styles) → Task 1. ✓
- §3.2 Adjust screen renders it above `.adjust__toolbar`, `setPref` + local state → Task 2. ✓
- §3.3 WorldViewer replaces inline JSX with the component, `busy={localizing}`, localize effect unchanged → Task 1 (Step 5). ✓
- §3.4 client `scanArtwork` sends `{lang, level}` (both Edge + dev) → Task 3 (`toRequestBody`, the single shared body-builder). ✓
- §3.4 backend eager-gen via `transformDossier` → upsert `artwork_content`, fire-and-forget non-fatal via `EdgeRuntime.waitUntil`, concurrent with panorama; fires on fresh AND cache-hit → Task 4. ✓
- §3.4 dev parity (`runScan` reads lang/level, eager-gen via `localizeNode`, caches in `localizeCache`; `plugin.ts` passes fields through) → Task 5. ✓
- §4 data-flow / §5 error handling (eager-gen failure swallowed; missing/invalid lang/level → defaults; no-change pref identical to today) → Task 4 `eagerLocalize` guards + `localizeAndCache` non-fatal upsert; Task 6 negative-path manual check. ✓
- §6 testing (api body unit test; `DossierControls` render test; eager-gen deno check + manual) → Tasks 3, 1, 4, 6. ✓
- §7 out of scope (no chrome localization, no Landing selector, no new langs/levels) → respected; nothing added. ✓

**Placeholder scan:** every code step shows the full code or exact edit; no TBD/"handle errors"/"similar to". ✓

**Type consistency:** `DossierPref { lang: Locale; level: ReadingLevel }` and `LEVELS`/`LANG_LABEL` defined in Task 1 are the same names consumed in Tasks 1–2. `localizeAndCache(admin, artworkId, source, lang, level)` defined in Task 4 is called with the same arg order/types by `eagerLocalize`. `runScan(…, lang, level)` and `localizeCache`/`localizeCacheKey` names match between Tasks 5's producer (`providers.ts`) and consumer (`plugin.ts`). `toRequestBody` return type `{ image, mime, lang, level }` matches what the test asserts. ✓
