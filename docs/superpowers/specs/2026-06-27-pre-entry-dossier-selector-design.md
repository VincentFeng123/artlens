# Pre-Entry Dossier Language/Difficulty Selector — Design

**Date:** 2026-06-27
**Status:** Approved design, pre-implementation.
**Builds on:** `2026-06-26-localized-reading-level-dossier-design.md` (the localized dossier + `contentPref` store, shipped). This relocates the selector so it's chosen **before** entering the world and configures the first dossier render.

---

## 1. Problem

The language pill + reading-level slider currently live only inside the world's info card (`WorldViewer`), so the first dossier renders in the device-default language and the user must switch *after* stepping in. The selector should appear **before "Step inside →"** so the choice configures the experience up front, and the world opens already in the chosen language/level.

## 2. Decisions (brainstorming)

- Selector placement: **the Adjust screen**, above the "Step inside →" toolbar (the moment before the world builds).
- **Keep** the selector in the world card too (for switching mid-exploration); both share the one persisted preference.
- **Eager-generate** the chosen variant at scan time so the world opens instantly in the chosen language (no shimmer on first open).
- Scope: localizes **dossier content only** (not app chrome) — unchanged from the shipped feature.

## 3. Components & flow

### 3.1 `DossierControls` (extracted, reusable)
Create `src/components/DossierControls.tsx` — the language pill (`<details>` over `SUPPORTED_LOCALES`) + the 3-stop reading-level `<input type=range>`, currently inline in `WorldViewer` (lines ~534–563). Controlled component:

```ts
interface Props {
  value: { lang: Locale; level: ReadingLevel }
  onChange: (next: { lang: Locale; level: ReadingLevel }) => void
  busy?: boolean              // shows the shimmer/disabled state (in-world localizing)
}
```

It renders from `value` and calls `onChange` on a language pick or slider move. It owns **no** persistence itself — each consumer wires `onChange` to `setPref(next)` + its own state. Reuses the existing `world__controls`/`world__lang`/`world__level` styles + the `LANG_LABEL`/`LEVELS` maps (moved into this module).

### 3.2 Adjust screen
`AdjustScreen` holds `const [pref, setLocal] = useState(getPref)` and renders `<DossierControls value={pref} onChange={(next) => { setPref(next); setLocal(next) }} />` directly above the `adjust__toolbar` (the row with "Step inside →"). No dossier exists yet, so this only updates the persisted preference. Styling: a compact row that fits the dark-glass aesthetic, visually grouped with the toolbar.

### 3.3 WorldViewer (replace inline JSX with the component)
Replace the inline control row (Task 11's JSX) with `<DossierControls value={pref} onChange={(next) => { setPref(next); setPrefState(next) }} busy={localizing} />`. The existing localize effect (keyed on `pref.lang`/`pref.level`) is unchanged — it still fetches + swaps `meta` on change. Net behavior identical for in-world switching, just DRY.

### 3.4 Configure-before-entry wiring (instant open)
- **Client:** `scanArtwork` (`src/lib/api.ts`) includes the current `{ lang, level }` from `getPref()` in the scan request body (extend `toRequestBody`/the request payload). Both the Edge and dev paths send it.
- **Backend eager-gen:** `scan/index.ts` reads `lang`/`level` from the body. After recognition + base-dossier persist, if `(lang, level) !== ('en','medium')`, it **eager-generates** that variant: `transformDossier(meta, lang, level)` → upsert into `artwork_content`. This runs **fire-and-forget, non-fatal**, inside the existing background work (`EdgeRuntime.waitUntil`), concurrently with panorama generation (30–180s) — so the variant is cached well before the world opens. A failure is swallowed (logged); it never blocks or fails the scan.
- **Result (fresh scan):** the panorama takes 30–180s, so eager-gen finishes first; when `WorldViewer` mounts and its localize effect requests `(lang, level)`, the `localize` function finds it cached → instant, no shimmer.
- **Cache-hit caveat:** for an already-scanned artwork the world opens in ~1s (cached panorama), which may beat eager-gen — so the first localize falls back to the on-load fetch (brief shimmer), then the eager-gen warms the cache for next time. Acceptable; still never blank. (Eager-gen fires on both the fresh and cache-hit paths when `(lang,level) ≠ (en,medium)`.)
- **Dev parity:** `dev-api/providers.ts` `runScan` reads `lang`/`level`, eager-generates via `localizeNode`, and caches in the dev `localizeCache` Map; `dev-api/plugin.ts` passes the fields through.

## 4. Data flow

```
AdjustScreen: pick lang/level → setPref (persisted)
        │ tap "Step inside →"
        ▼
scanArtwork({...image}, lang=getPref().lang, level=getPref().level)
        │
scan/index.ts: recognize → persist base (en,medium)
        │ if (lang,level) ≠ (en,medium): waitUntil( transformDossier → upsert artwork_content )   [non-fatal, concurrent w/ panorama]
        ▼
world ready → WorldViewer mounts, pref = getPref() = (lang,level)
        │ localize effect → localize fn → CACHE HIT (eager-gen) → instant
        ▼
card renders in chosen language/level; in-world DossierControls already reads the same pref
```

## 5. Error handling

- Eager-gen failure (transform/cache) → swallowed; the scan and world are unaffected; WorldViewer's on-load localize still fetches it (brief shimmer) — never blank.
- Missing/invalid `lang`/`level` in the request → backend skips eager-gen (defaults), no error.
- AdjustScreen with no change → pref stays at its persisted/default value; behavior identical to today.

## 6. Testing

- `src/lib/api.ts`: unit-test that the scan request body includes `lang`/`level` from the pref (mock `getPref`).
- `DossierControls`: a render test (jsdom) — given a `value`, the pill shows `LANG_LABEL[value.lang]` and the slider reflects `LEVELS.indexOf(value.level)`; a language pick / slider move calls `onChange` with the new value.
- `contentPref` already covered (shipped).
- Eager-gen (backend) — `deno check` + manual: scan with a non-default pref → `artwork_content` has the variant row before the world opens; the card opens with no shimmer.
- Manual end-to-end: on Adjust, pick 简体中文 + Simple → Step inside → world opens with the card already in Simplified Chinese / Simple; the in-world pill reads 简体中文.

## 7. Out of scope

- Localizing the app chrome (Adjust/Landing buttons, hints) — dossier content only, unchanged.
- A Landing-screen global selector (rejected in favor of the contextual Adjust placement).
- Adding new languages/levels (the sets are fixed from the shipped feature).
