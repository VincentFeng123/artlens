# Localized + Reading-Level Dossier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let viewers read the artwork dossier in any of 9 languages at 3 reading levels, via a language pill + slider in the card, with variants generated on-demand by a Gemini-Flash transform and cached per `(artwork, lang, level)`.

**Architecture:** A new `localize` edge function transforms the base (English/Medium) dossier into a target `(lang, level)` and caches it in a new `artwork_content` table (which also persists the base, closing today's no-persistence gap). The client holds a global `(lang, level)` preference; `WorldViewer` swaps the rendered dossier in place when it changes, falling back to the base on any failure.

**Tech Stack:** TypeScript; React + Vite; Supabase Edge Functions (Deno); Postgres; Vitest; Gemini (existing `GEMINI_API_KEY`, no new key).

**Spec:** `docs/superpowers/specs/2026-06-26-localized-reading-level-dossier-design.md` — read it; this plan implements it.

## Global Constraints

- **Levels are exactly** `'simple' | 'medium' | 'rich'`; base is `(en, medium)`.
- **Locales are exactly** `['en','es','zh-Hans','zh-Hant','fr','de','ja','ko','pt']`.
- **On-demand + cache.** A `(lang, level)` is generated once via ONE Gemini-Flash call, then cached in `artwork_content` keyed by `(artwork_id, lang, level)`. Never pre-generate all combos.
- **Fixed fields carried verbatim by the transform:** `title`, `artist`, `artist_life`, `year`, `dimensions`, `location`, `confidence`, `recognized`, `similar_works`, `symbolism[].box`, and **`palette_hex`**. World-gen fields (`scene_description`, `render_negatives`, `spatial_layout`, `horizon`, `perspective`, `light`, `vantage`, `offscreen`, `technique`, routing fields) stay English and are NOT part of the card payload.
- **Palette swatches survive translation:** precompute `palette_hex` (index-aligned to `palette`) at base generation from the English names; localized variants translate the label but carry `palette_hex` unchanged. Client renders the swatch from `palette_hex` (fallback `paletteColor(name)`).
- **Never blank:** any localize failure → keep the current/base dossier.
- **Two type files stay in sync verbatim:** `shared/types.ts` + `supabase/functions/_shared/types.ts`.
- **Edge tree is self-contained** (no imports outside `supabase/functions/`) — hence the `paletteColor` mirror.
- Deno files verified with `deno check`; pure `.ts` (no Deno/npm specifiers) is vitest-tested. `npm run typecheck` covers only `src`+`shared`.

## File structure

**New:** `supabase/migrations/0004_artwork_content.sql`; `supabase/functions/_shared/paletteColor.ts` (mirror); `supabase/functions/_shared/localize.ts` (transform provider); `supabase/functions/localize/index.ts` (edge fn); `src/lib/contentPref.ts`; `src/lib/localize.ts`; `src/lib/glossary.ts` (CJK-aware match, extracted from WorldViewer). Tests alongside.
**Modified:** both `types.ts`; `_shared/prompt.ts` (LOCALIZE_PROMPT builder); `scan/index.ts` (palette_hex, persist base, return artwork_id, eager-gen); `job-status/index.ts` (artwork_id); `src/lib/api.ts` (ScanOutcome.artworkId); `src/App.tsx` (thread artworkId); `src/components/WorldViewer.tsx` (control row, state wrapper, palette_hex, glossary import); `dev-api/providers.ts` + `dev-api/plugin.ts` (parity).

---

### Task 1: Types — Locale, ReadingLevel, ArtworkMeta fields, response `artwork_id`

**Files:** Modify `shared/types.ts` + `supabase/functions/_shared/types.ts`.

**Interfaces — Produces:** `ReadingLevel`, `Locale`, `SUPPORTED_LOCALES`; `ArtworkMeta.lang?/.level?/.palette_hex?`; `artwork_id?` on the three response types.

- [ ] **Step 1: Add the unions + const above `interface RecognitionResult` in `shared/types.ts`**

```typescript
/** Reading level for the dossier prose — same facts, vocabulary scales. */
export type ReadingLevel = 'simple' | 'medium' | 'rich'

/** Supported dossier languages (BCP-47-ish). English is the base/source. */
export type Locale = 'en' | 'es' | 'zh-Hans' | 'zh-Hant' | 'fr' | 'de' | 'ja' | 'ko' | 'pt'

/** The locales offered in the picker, in display order. */
export const SUPPORTED_LOCALES: Locale[] = ['en', 'es', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'ja', 'ko', 'pt']
```

- [ ] **Step 2: Add `palette_hex` to `RecognitionResult` in `shared/types.ts`**

Immediately after the `palette_notes?: string[]` field, add:

```typescript
  /**
   * Display hex (index-aligned to {@link palette}) precomputed from the English
   * colour names at base generation, so localized variants render correct
   * swatches even when the colour *labels* are translated. Optional for back-compat.
   */
  palette_hex?: string[]
```

- [ ] **Step 3: Add `lang`/`level` to `ArtworkMeta` in `shared/types.ts`**

Change the `ArtworkMeta` interface body to add two fields after `demo: boolean`:

```typescript
export interface ArtworkMeta extends RecognitionResult {
  /** True when this is the zero-config demo world (curated, not a real scan). */
  demo: boolean
  /** Which language this dossier is rendered in (default 'en'). */
  lang?: Locale
  /** Which reading level this dossier is rendered at (default 'medium'). */
  level?: ReadingLevel
}
```

- [ ] **Step 4: Add `artwork_id` to the three response types in `shared/types.ts`**

In `ScanReadyResponse`, `ScanGeneratingResponse`, and `JobStatusResponse`, add (after `meta?`):

```typescript
  /** The cached artwork's id, so the client can request localized variants. */
  artwork_id?: string | null
```

- [ ] **Step 5: Mirror Steps 1–4 verbatim into `supabase/functions/_shared/types.ts`**

Same unions/const above `RecognitionResult`, same `palette_hex?` after `palette_notes?`, same `lang?`/`level?` on `ArtworkMeta`, same `artwork_id?` on the three responses. Keep type bodies identical (the Deno mirror is comment-light).

- [ ] **Step 6: Verify**

Run: `npm run typecheck` → exits 0.
Run: `deno check supabase/functions/_shared/types.ts` → no errors.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts supabase/functions/_shared/types.ts
git commit -m "types: Locale/ReadingLevel, palette_hex, artwork_id on responses"
```

---

### Task 2: Migration — `artwork_content` table

**Files:** Create `supabase/migrations/0004_artwork_content.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- Per-(artwork, language, reading-level) dossier variants. The base (en, medium)
-- row is written at scan; other variants are generated on demand by the localize
-- function and cached here. Also persists the dossier (previously unpersisted).
create table if not exists public.artwork_content (
  artwork_id  uuid not null references public.artworks (id) on delete cascade,
  lang        text not null,
  level       text not null check (level in ('simple', 'medium', 'rich')),
  dossier     jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (artwork_id, lang, level)
);

alter table public.artwork_content enable row level security;
drop policy if exists "artwork_content readable" on public.artwork_content;
create policy "artwork_content readable" on public.artwork_content for select using (true);
```

- [ ] **Step 2: Sanity-check the SQL is well-formed**

Run: `grep -c "create table\|primary key\|policy" supabase/migrations/0004_artwork_content.sql` → expect `3`.
(The controller applies this to the live DB with `supabase db push` as a deliberate step, like `0003`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_artwork_content.sql
git commit -m "feat: artwork_content table for localized dossier variants"
```

---

### Task 3: `paletteColor` Deno mirror + `palette_hex` helper

**Files:** Create `supabase/functions/_shared/paletteColor.ts`; Create `supabase/functions/_shared/paletteColor.test.ts`.

**Interfaces — Produces:** `paletteColor(name: string): string` and `buildPaletteHex(palette: string[]): string[]` (Deno-side, for scan).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/paletteColor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { paletteColor, buildPaletteHex } from './paletteColor.ts'

describe('paletteColor (Deno mirror)', () => {
  it('returns a 6-digit hex for a known colour', () => {
    expect(paletteColor('ultramarine')).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('darkens with the "deep" adjective', () => {
    expect(paletteColor('deep ultramarine')).not.toBe(paletteColor('ultramarine'))
  })
  it('falls back to a stable hex for an unknown name', () => {
    expect(paletteColor('zorblax')).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('buildPaletteHex is index-aligned', () => {
    const out = buildPaletteHex(['ultramarine', 'amber', 'bone'])
    expect(out).toHaveLength(3)
    out.forEach((h) => expect(h).toMatch(/^#[0-9a-f]{6}$/i))
  })
})
```

- [ ] **Step 2: Run it — fails (module missing)**

Run: `npm test` → FAIL (`./paletteColor.ts` not found).

- [ ] **Step 3: Create the mirror**

Copy the entire contents of `src/lib/paletteColor.ts` into `supabase/functions/_shared/paletteColor.ts` **verbatim** (it is pure, no imports), then append the helper at the end:

```typescript

/** Precompute display hex for each palette colour name (index-aligned). */
export function buildPaletteHex(palette: string[]): string[] {
  return (palette ?? []).map((name) => paletteColor(name))
}
```

- [ ] **Step 4: Run it — passes**

Run: `npm test` → the 4 paletteColor tests pass (plus the existing suite).

- [ ] **Step 5: Verify Deno parse**

Run: `deno check supabase/functions/_shared/paletteColor.ts` → no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/paletteColor.ts supabase/functions/_shared/paletteColor.test.ts
git commit -m "feat: paletteColor Deno mirror + buildPaletteHex"
```

---

### Task 4: `LOCALIZE_PROMPT` builder

**Files:** Modify `supabase/functions/_shared/prompt.ts`; Create `supabase/functions/_shared/localizePrompt.test.ts`.

**Interfaces — Consumes:** `ReadingLevel`, `Locale`, `RecognitionResult`. **Produces:** `buildLocalizePrompt(dossier: RecognitionResult, lang: Locale, level: ReadingLevel): string`; `LOCALE_NAMES: Record<Locale, string>`; `LEVEL_RUBRIC: Record<ReadingLevel, string>`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/localizePrompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildLocalizePrompt } from './prompt.ts'
import type { RecognitionResult } from './types.ts'

const base = { title: 'Mona Lisa', artist: 'Leonardo', hook: 'A face that follows you.', story: 'A woman sits.', palette: ['amber'], palette_hex: ['#e0a32b'] } as unknown as RecognitionResult

describe('buildLocalizePrompt', () => {
  it('names the target language and the reading-level rubric', () => {
    const p = buildLocalizePrompt(base, 'zh-Hans', 'simple')
    expect(p).toContain('Simplified Chinese')
    expect(p.toLowerCase()).toContain('short sentences')   // simple rubric
  })
  it('embeds the source dossier and demands the same JSON shape + verbatim fields', () => {
    const p = buildLocalizePrompt(base, 'es', 'rich')
    expect(p).toContain('Mona Lisa')          // dossier present
    expect(p).toContain('palette_hex')        // verbatim-field instruction
    expect(p).toContain('title')
  })
})
```

- [ ] **Step 2: Run it — fails**

Run: `npm test` → FAIL (`buildLocalizePrompt` not exported).

- [ ] **Step 3: Implement in `prompt.ts`**

Add near the top of `supabase/functions/_shared/prompt.ts` (after the existing imports), importing the new types:

```typescript
import type { Locale, ReadingLevel } from './types.ts'

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English', es: 'Spanish', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese',
  fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese',
}

export const LEVEL_RUBRIC: Record<ReadingLevel, string> = {
  simple: 'Use short sentences and common, everyday words. No jargon or art-historical terms; if a term is unavoidable, explain it plainly. Keep the warmth and the facts, just make it effortless to read.',
  medium: 'Keep the current voice — vivid, plain-spoken, a knowledgeable friend. Some art vocabulary is fine when it earns its place.',
  rich: 'Use precise art-historical vocabulary and a longer, more literary cadence. Assume an engaged, educated reader; do not dumb anything down.',
}

/**
 * Build the transform prompt: rewrite the dossier's PROSE into `lang` at reading
 * level `level`, returning the SAME JSON shape. Facts and depth are unchanged —
 * only wording. Listed fields are copied byte-for-byte (proper nouns, numbers,
 * image-anchored boxes, precomputed swatch hex).
 */
export function buildLocalizePrompt(dossier: RecognitionResult, lang: Locale, level: ReadingLevel): string {
  return [
    `You are a literary translator and editor for a museum app. Rewrite the artwork dossier below into ${LOCALE_NAMES[lang]}.`,
    `READING LEVEL: ${LEVEL_RUBRIC[level]}`,
    `Translate/adapt EVERY human-readable prose field: hook, story, brushwork, materiality, scale_note, palette (the colour LABELS), palette_notes, symbolism[].detail, symbolism[].meaning, hidden_details, process, why_made, legacy, debates, mood, style, medium, glossary[].term, glossary[].definition.`,
    `Keep these fields BYTE-FOR-BYTE UNCHANGED (do not translate or alter): title, artist, artist_life, year, dimensions, location, confidence, recognized, similar_works, symbolism[].box, palette_hex, and any world-generation fields (scene_description, render_negatives, spatial_layout, horizon, perspective, light, vantage, offscreen, technique).`,
    `Preserve the EXACT JSON structure and array lengths (palette and palette_notes stay index-aligned). Same facts, same depth — only the wording changes.`,
    `Return ONLY the JSON object, no prose, no code fences.`,
    `DOSSIER:`,
    JSON.stringify(dossier),
  ].join('\n\n')
}
```

- [ ] **Step 4: Run it — passes**

Run: `npm test` → the 2 localizePrompt tests pass.

- [ ] **Step 5: Verify Deno parse**

Run: `deno check supabase/functions/_shared/prompt.ts` → no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/prompt.ts supabase/functions/_shared/localizePrompt.test.ts
git commit -m "feat: buildLocalizePrompt + locale names + level rubric"
```

---

### Task 5: Localize transform provider (`_shared/localize.ts`)

**Files:** Create `supabase/functions/_shared/localize.ts`.

**Interfaces — Consumes:** `buildLocalizePrompt`, `parseRecognitionJson`, `RecognitionResult`, `Locale`, `ReadingLevel`. **Produces:** `transformDossier(base: RecognitionResult, lang: Locale, level: ReadingLevel): Promise<RecognitionResult>`.

- [ ] **Step 1: Implement (Gemini REST, mirrors `_shared/recognition/gemini.ts`)**

Create `supabase/functions/_shared/localize.ts`:

```typescript
import type { RecognitionResult } from './types.ts'
import type { Locale, ReadingLevel } from './types.ts'
import { buildLocalizePrompt, parseRecognitionJson } from './prompt.ts'

/**
 * Transform a base dossier into (lang, level) via Gemini, returning the same
 * shape. Uses GEMINI_API_KEY (the project's default recognition provider key).
 * Throws on hard failure; the caller falls back to the base dossier.
 */
export async function transformDossier(
  base: RecognitionResult,
  lang: Locale,
  level: ReadingLevel,
): Promise<RecognitionResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash'

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildLocalizePrompt(base, lang, level) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 8192 },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini localize ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error('Gemini localize returned no text')
  const out = parseRecognitionJson(text)
  // Carry the structurally-fixed fields through verbatim — never trust the model to.
  out.title = base.title; out.artist = base.artist; out.artist_life = base.artist_life
  out.year = base.year; out.dimensions = base.dimensions; out.location = base.location
  out.similar_works = base.similar_works; out.palette_hex = base.palette_hex
  out.recognized = base.recognized; out.confidence = base.confidence
  if (Array.isArray(out.symbolism) && Array.isArray(base.symbolism)) {
    out.symbolism.forEach((s, i) => { if (base.symbolism[i]) s.box = base.symbolism[i].box })
  }
  return out
}
```

- [ ] **Step 2: Verify Deno parse**

Run: `deno check supabase/functions/_shared/localize.ts` → no errors. (No vitest — Deno specifiers.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/localize.ts
git commit -m "feat: transformDossier (Gemini localize provider)"
```

---

### Task 6: `localize` edge function

**Files:** Create `supabase/functions/localize/index.ts`.

**Interfaces — Consumes:** `transformDossier`, `adminClient`, `json`/`preflight`/`errMessage`, `buildArtworkMeta`, `ArtworkMeta`, `Locale`, `ReadingLevel`. **Produces:** `POST /localize` → `{ meta: ArtworkMeta }`.

- [ ] **Step 1: Implement**

Create `supabase/functions/localize/index.ts`:

```typescript
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
```

(Note: `buildArtworkMeta` currently does not copy `palette_hex`/`lang`/`level` — Task 7 Step 1 extends it so this compiles correctly.)

- [ ] **Step 2: Verify Deno parse**

Run: `deno check supabase/functions/localize/index.ts` → no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/localize/index.ts
git commit -m "feat: localize edge function (cache + transform + fallback)"
```

---

### Task 7: Scan — palette_hex, persist base, return artwork_id; job-status artwork_id

**Files:** Modify `supabase/functions/_shared/prompt.ts` (`buildArtworkMeta`), `supabase/functions/scan/index.ts`, `supabase/functions/job-status/index.ts`.

- [ ] **Step 1: Extend `buildArtworkMeta` to carry `palette_hex`, `lang`, `level`**

In `supabase/functions/_shared/prompt.ts`, in `buildArtworkMeta`, after the `palette_notes` line add `palette_hex: arr<string>(r.palette_hex),` and after `demo:` add `lang: r.lang ?? 'en', level: r.level ?? 'medium',`. (Import `Locale`/`ReadingLevel` already added in Task 4; `RecognitionResult` already has the fields from Task 1.)

- [ ] **Step 2: In `scan/index.ts`, compute palette_hex on the dossier**

Add the import near the top: `import { buildPaletteHex } from '../_shared/paletteColor.ts'`.
After `const meta = buildArtworkMeta(recognition)` (line ~58), add:

```typescript
  meta.palette_hex = buildPaletteHex(meta.palette)
```

- [ ] **Step 3: Persist the base dossier + return artwork_id (cache-hit and generating paths)**

In the cache-hit block, after fetching `hit`, the response already returns `meta`; add `artwork_id: hit.id` to that response object. In the new-artwork path, after the `artworks` insert that yields `artwork`, persist the base dossier and remember the id:

```typescript
  if (artwork?.id) {
    await admin.from('artwork_content')
      .upsert({ artwork_id: artwork.id, lang: 'en', level: 'medium', dossier: meta })
  }
```

Add `artwork_id: artwork?.id ?? null` to the `generating` response and to the demo/no-generator `ready` responses (so the client always has it; demo will be null).

- [ ] **Step 4: Return artwork_id from job-status**

`job-status/index.ts`: the row select doesn't include artwork_id today; add it to `.select('id, status, panorama_url, depth_url, error, realization, artwork_id')` and to the returned object as `artwork_id: data.artwork_id ?? null`. (The `jobs` table has `artwork_id` from `0001`.)

- [ ] **Step 5: Verify**

Run: `npm test` → existing suite still green (buildArtworkMeta change doesn't break route/prompt tests).
Run: `deno check supabase/functions/scan/index.ts supabase/functions/job-status/index.ts supabase/functions/_shared/prompt.ts` → no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/prompt.ts supabase/functions/scan/index.ts supabase/functions/job-status/index.ts
git commit -m "feat: scan computes palette_hex, persists base dossier, returns artwork_id"
```

---

### Task 8: Client preference store (`contentPref.ts`)

**Files:** Create `src/lib/contentPref.ts`; Create `src/lib/contentPref.test.ts`.

**Interfaces — Produces:** `detectLocale(): Locale`; `getPref(): {lang: Locale, level: ReadingLevel}`; `setPref(p): void`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/contentPref.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { detectLocale, getPref, setPref } from './contentPref'

beforeEach(() => localStorage.clear())

describe('contentPref', () => {
  it('detectLocale maps a navigator language to a supported Locale', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' }); expect(detectLocale()).toBe('zh-Hans')
    vi.stubGlobal('navigator', { language: 'zh-TW' }); expect(detectLocale()).toBe('zh-Hant')
    vi.stubGlobal('navigator', { language: 'es-MX' }); expect(detectLocale()).toBe('es')
    vi.stubGlobal('navigator', { language: 'xx' }); expect(detectLocale()).toBe('en')
  })
  it('getPref defaults to detected locale + medium, persists via setPref', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' })
    expect(getPref()).toEqual({ lang: 'fr', level: 'medium' })
    setPref({ lang: 'ja', level: 'rich' })
    expect(getPref()).toEqual({ lang: 'ja', level: 'rich' })
  })
})
```

- [ ] **Step 2: Run it — fails**

Run: `npm test` → FAIL (`./contentPref` not found). (Vitest config `environment: 'node'` from Milestone A has no `localStorage`; add `environment: 'jsdom'` per-file via a docblock — see Step 3 note. If jsdom isn't installed, run `npm i -D jsdom` first.)

- [ ] **Step 3: Implement**

Add `npm i -D jsdom` if needed, then add at the very top of `contentPref.test.ts`: `// @vitest-environment jsdom`.

Create `src/lib/contentPref.ts`:

```typescript
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
```

- [ ] **Step 4: Run it — passes**

Run: `npm test` → contentPref tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contentPref.ts src/lib/contentPref.test.ts package.json package-lock.json vitest.config.ts
git commit -m "feat: contentPref store + detectLocale"
```

---

### Task 9: Glossary CJK-aware match (`glossary.ts`) + client localize lib

**Files:** Create `src/lib/glossary.ts`; Create `src/lib/glossary.test.ts`; Create `src/lib/localize.ts`.

**Interfaces — Produces:** `isCjk(lang: Locale): boolean`; `localizeDossier(args): Promise<ArtworkMeta>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/glossary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isCjk } from './glossary'

describe('isCjk', () => {
  it('is true for Chinese/Japanese/Korean, false for Latin', () => {
    expect(isCjk('zh-Hans')).toBe(true)
    expect(isCjk('zh-Hant')).toBe(true)
    expect(isCjk('ja')).toBe(true)
    expect(isCjk('ko')).toBe(true)
    expect(isCjk('en')).toBe(false)
    expect(isCjk('es')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — fails**

Run: `npm test` → FAIL (`./glossary` not found).

- [ ] **Step 3: Implement `glossary.ts`**

Create `src/lib/glossary.ts`:

```typescript
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
```

- [ ] **Step 4: Run it — passes**

Run: `npm test` → isCjk test passes.

- [ ] **Step 5: Implement `localize.ts`**

Create `src/lib/localize.ts`:

```typescript
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
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/glossary.ts src/lib/glossary.test.ts src/lib/localize.ts
git commit -m "feat: CJK-aware glossary match + client localizeDossier"
```

---

### Task 10: Client threading — `ScanOutcome.artworkId` → `App` → `WorldViewer`

**Files:** Modify `src/lib/api.ts`, `src/App.tsx`.

- [ ] **Step 1: `api.ts` — add `artworkId` to `ScanOutcome` and thread it**

In `ScanOutcome` add `artworkId?: string`. In all four real return paths (`scanViaDevApi` ready+generating, `scanViaEdge` ready+generating) add `artworkId: data.artwork_id ?? undefined` (ready) and `artworkId: job.artwork_id ?? data.artwork_id ?? undefined` (generating). `demoOutcome` leaves it undefined.

- [ ] **Step 2: `App.tsx` — carry `artworkId` into `World` + the `WorldViewer` prop**

Add `artworkId?: string` to the `World` interface; set `artworkId: res.artworkId` in `setWorld(...)`; pass `artworkId={world.artworkId}` to `<WorldViewer>`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → 0. Run: `npm test` → green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/App.tsx
git commit -m "feat: thread artworkId to WorldViewer"
```

---

### Task 11: WorldViewer — control row, dossier state wrapper, palette_hex, glossary import

**Files:** Modify `src/components/WorldViewer.tsx`, `src/index.css`.

**Interfaces — Consumes:** `getPref`/`setPref`, `localizeDossier`, `termRegex`, `SUPPORTED_LOCALES`, `LOCALE_NAMES` analog (use a local label map), `palette_hex`, `artworkId` prop.

- [ ] **Step 1: Make the rendered dossier swappable via state**

In the `WorldViewer` props destructure, rename `meta` to `meta: initialMeta`, then add at the top of the component body:

```typescript
  const [meta, setMeta] = useState<ArtworkMeta>(initialMeta)
  const [pref, setPrefState] = useState(getPref)
  const [localizing, setLocalizing] = useState(false)
  // Reset to the base when a new artwork is scanned.
  useEffect(() => { setMeta(initialMeta) }, [initialMeta])
```

(All existing `meta.` references now read the state copy — no other render changes needed.)

- [ ] **Step 2: Localize when the preference changes**

Add an effect (after the one above):

```typescript
  useEffect(() => {
    let cancelled = false
    if (pref.lang === 'en' && pref.level === 'medium') { setMeta(initialMeta); return }
    setLocalizing(true)
    localizeDossier({ artworkId, lang: pref.lang, level: pref.level, base: initialMeta })
      .then((m) => { if (!cancelled) setMeta(m) })
      .finally(() => { if (!cancelled) setLocalizing(false) })
    return () => { cancelled = true }
  }, [pref.lang, pref.level, artworkId, initialMeta])
```

- [ ] **Step 3: Add the imports + the `artworkId` prop + a label map**

Imports: `import { getPref, setPref } from '../lib/contentPref'`, `import { localizeDossier } from '../lib/localize'`, `import { termRegex } from '../lib/glossary'`, and `SUPPORTED_LOCALES`, `type Locale`, `type ReadingLevel` from `'../../shared/types'`. Add `artworkId?: string` to `Props`. Add near the top of the module:

```typescript
const LANG_LABEL: Record<Locale, string> = {
  en: 'English', es: 'Español', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文',
  fr: 'Français', de: 'Deutsch', ja: '日本語', ko: '한국어', pt: 'Português',
}
const LEVELS: ReadingLevel[] = ['simple', 'medium', 'rich']
```

- [ ] **Step 4: Render the control row (language pill + 3-stop slider)**

Inside the card, immediately after the `world__grabber` div, add:

```tsx
          <div className={`world__controls${localizing ? ' is-busy' : ''}`}>
            <details className="world__lang">
              <summary className="world__lang-pill">{LANG_LABEL[pref.lang]}</summary>
              <ul className="world__lang-menu">
                {SUPPORTED_LOCALES.map((l) => (
                  <li key={l}>
                    <button
                      type="button"
                      className={l === pref.lang ? 'is-active' : ''}
                      onClick={(e) => {
                        const next = { ...pref, lang: l }
                        setPref(next); setPrefState(next)
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
              value={LEVELS.indexOf(pref.level)}
              aria-label="Reading level"
              onChange={(e) => {
                const next = { ...pref, level: LEVELS[Number(e.target.value)] }
                setPref(next); setPrefState(next)
              }}
            />
            <span className="world__level-label">{pref.level}</span>
          </div>
```

- [ ] **Step 5: Use `palette_hex` for swatches (fallback to `paletteColor`)**

The palette swatch currently uses `paletteColor(c)`. Change the swatch `background` to `meta.palette_hex?.[i] ?? paletteColor(c)` in both the peek dots and the palette section (two spots). For the peek dots, the map index is available; in the palette section the `i` index is in scope.

- [ ] **Step 6: Use `termRegex` in `injectGlossary` for CJK**

`injectGlossary` builds its match with `new RegExp(\`\\b${esc}(?:e?s)?\\b\`, 'i')`. Replace that line with `termRegex(g.term, meta.lang ?? 'en')` (pass the active locale). Add `meta.lang` access — `injectGlossary` is called with `(text, glossary, used)`; thread the locale by reading `meta.lang` at the call sites or add a 4th param `lang`. Minimal: add `lang: Locale = 'en'` param to `injectGlossary` and pass `meta.lang ?? 'en'` from each call site.

- [ ] **Step 7: Add minimal styles to `src/index.css`**

```css
.world__controls { display: flex; align-items: center; gap: 12px; padding: 4px 18px 8px; }
.world__controls.is-busy { opacity: 0.6; transition: opacity 0.2s; }
.world__lang { position: relative; }
.world__lang-pill { list-style: none; cursor: pointer; font-size: 0.85rem; padding: 4px 10px;
  border-radius: 999px; background: rgba(255,255,255,0.08); }
.world__lang-menu { position: absolute; bottom: 120%; left: 0; margin: 0; padding: 6px; list-style: none;
  background: rgba(18,18,26,0.96); border-radius: 12px; backdrop-filter: blur(12px); z-index: 5; max-height: 50vh; overflow:auto; }
.world__lang-menu button { width: 100%; text-align: left; padding: 6px 12px; background: none; color: inherit;
  border: 0; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.world__lang-menu button.is-active { background: rgba(255,255,255,0.12); }
.world__level { flex: 1; max-width: 160px; }
.world__level-label { font-size: 0.78rem; opacity: 0.7; text-transform: capitalize; min-width: 3.5em; }
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck` → 0. Run: `npm run build` → succeeds. Run: `npm test` → all green.

- [ ] **Step 9: Commit**

```bash
git add src/components/WorldViewer.tsx src/index.css
git commit -m "feat: dossier language pill + reading-level slider + palette_hex + CJK glossary"
```

---

### Task 12: Dev-API parity

**Files:** Modify `dev-api/providers.ts`, `dev-api/plugin.ts`.

- [ ] **Step 1: Return `artwork_id` from dev `/api/scan` and `/api/job-status`**

Dev jobs have no DB; use a synthetic stable key. In `dev-api/providers.ts` `runScan`, compute `meta.palette_hex` (import a JS copy of `buildPaletteHex` — reuse `shared`/a local copy; simplest: `import { paletteColor } from '../src/lib/paletteColor'` and map). Return a synthetic `artwork_id` (e.g. a hash of title+artist) on each `ready` response. In `plugin.ts`, add `artwork_id` to `JobRecord` and the `/api/job-status` return.

- [ ] **Step 2: Add `/api/localize`**

In `plugin.ts`, register `server.middlewares.use('/api/localize', …)` that reads `{ artwork_id, lang, level, base }`, checks an in-memory `Map` keyed by `${artwork_id}:${lang}:${level}`, and on miss calls a Node transform (mirror `transformDossier` using the Gemini REST call already present in `dev-api/providers.ts` — extract a `localizeNode(base, lang, level, env)` helper there), caches, returns `{ meta }`. On failure return `{ meta: { ...base, lang, level } }`.

- [ ] **Step 3: Verify**

Run: `npm run build` → succeeds (dev-api is bundled by Vite config but not the client build; confirm `npm run dev` starts without type errors via `npm run typecheck`).

- [ ] **Step 4: Commit**

```bash
git add dev-api/providers.ts dev-api/plugin.ts
git commit -m "feat: dev-api parity for localize + artwork_id"
```

---

## Manual end-to-end verification (after Task 12)

With recognition + Blockade keys and `npm run dev`:
1. Scan an artwork → card renders in your device language at Medium (or English if unsupported).
2. Open the language pill → pick 简体中文 → card text becomes Simplified Chinese after a brief shimmer; swatches keep their colours; glossary chips still highlight.
3. Drag the slider to Simple → text simplifies; to Rich → richer vocabulary. Same facts throughout.
4. Re-pick the same language/level → instant (cached). Scan a second artwork → preference persists.
5. Kill the network mid-switch → card stays on the last good text (never blank).

## Self-Review

**1. Spec coverage:** §1 levels/locales/defaults → Tasks 1, 8, 11. §2 table → Task 2. §3 types → Task 1. §4 transform fields + palette_hex → Tasks 3, 4, 5, 7. §5 localize fn + scan persistence + base-in-body → Tasks 5, 6, 7. §6 client (pref, lib, control row, CJK glossary, state wrapper) → Tasks 8, 9, 10, 11. §7 dev parity → Task 12. §8 error handling (fallback, never blank) → Tasks 5, 6, 9, 11. §9 testing → folded into each task. §10 out-of-scope honored. No gap.

**2. Placeholder scan:** Every code step shows complete code or a precise edit. Task 11 Step 5/6 describe exact line replacements with the replacement expression. Task 12 references extracting `localizeNode` from the existing dev Gemini call — the helper body mirrors Task 5's `transformDossier` (same REST shape). No TODO/TBD.

**3. Type consistency:** `Locale`/`ReadingLevel`/`SUPPORTED_LOCALES`, `palette_hex`, `artwork_id`/`artworkId`, `buildLocalizePrompt`/`LOCALE_NAMES`/`LEVEL_RUBRIC`, `transformDossier`, `localizeDossier`, `getPref`/`setPref`/`detectLocale`, `isCjk`/`termRegex` are named identically across defining and consuming tasks. `buildArtworkMeta` extended (Task 7 Step 1) before `localize/index.ts` (Task 6) relies on it — note the cross-task ordering: Task 7 Step 1 may be pulled earlier if an implementer builds Task 6 first; flagged in Task 6 Step 1's note.
