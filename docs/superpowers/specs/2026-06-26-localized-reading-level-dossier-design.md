# Localized + Reading-Level Artwork Dossier — Design

**Date:** 2026-06-26
**Status:** Approved design, pre-implementation.

The artwork info card (the LLM-authored ~27-field dossier `ArtworkMeta`) becomes available in **multiple languages** and at **three reading levels**, chosen by the viewer via a language pill + a 3-stop slider in the card. Variants are generated **on demand and cached per `(artwork, language, level)`**.

---

## 1. Goals & decisions (from brainstorming)

- **Reading-level slider** = vocabulary/sentence complexity only; **same facts and depth**. Three stops: `simple` · `medium` · `rich`. Default `medium`.
- **Languages:** base/source is English (`en`). v1 set: `es`, `zh-Hans`, `zh-Hant`, `fr`, `de`, `ja`, `ko`, `pt`. Trivially extensible (on-demand generation means adding a locale is a config line). Default = device locale if supported, else `en`.
- **Generation:** on-demand + cache. Base (`en`/`medium`) generated at scan and **persisted**; each other `(lang, level)` generated once on first request via a cheap **Gemini-Flash** transform, then cached forever. The scanner's own `(locale, level)`, if not the base, is eagerly generated at scan so their first view is instant.
- The viewer's chosen `(language, level)` **persists globally** (localStorage) across artworks.

## 2. Data model

New table (migration `0004_artwork_content.sql`):

```sql
create table if not exists public.artwork_content (
  artwork_id  uuid not null references public.artworks (id) on delete cascade,
  lang        text not null,   -- BCP-47-ish: en, es, zh-Hans, zh-Hant, fr, de, ja, ko, pt
  level       text not null check (level in ('simple','medium','rich')),
  dossier     jsonb not null,  -- a full ArtworkMeta for this (lang, level)
  created_at  timestamptz not null default now(),
  primary key (artwork_id, lang, level)
);
alter table public.artwork_content enable row level security;
drop policy if exists "artwork_content readable" on public.artwork_content;
create policy "artwork_content readable" on public.artwork_content for select using (true);
```

This also closes today's gap where the dossier is **not persisted at all** (it currently only rides the job response). The base `(en, medium)` row is written at scan; all variants live here keyed by `(artwork_id, lang, level)`.

## 3. Types (both mirrors: `shared/types.ts` + `supabase/functions/_shared/types.ts`)

```ts
export type ReadingLevel = 'simple' | 'medium' | 'rich'
export type Locale = 'en' | 'es' | 'zh-Hans' | 'zh-Hant' | 'fr' | 'de' | 'ja' | 'ko' | 'pt'
export const SUPPORTED_LOCALES: Locale[] = ['en','es','zh-Hans','zh-Hant','fr','de','ja','ko','pt']
```

`ArtworkMeta` gains two descriptive fields recording what it represents: `lang: Locale`, `level: ReadingLevel` (optional on the type for back-compat; always set by the backend). Responses (`ScanReadyResponse`/`ScanGeneratingResponse`/`JobStatusResponse`) gain `artwork_id?: string | null` so the client can call `localize`.

## 4. What transforms vs. stays fixed

The transform rewrites **all human-readable prose**: `hook`, `story`, `scene_description`(kept English — it feeds the generator, not the card; see note), `brushwork`, `materiality`, `scale_note`, `palette_notes`, `symbolism[].detail`/`.meaning`, `hidden_details`, `process`, `why_made`, `legacy`, `debates`, `mood`, `style`, `glossary[].term`/`.definition`, and catalogue *values* that are language-bearing (`medium`). 

**Stays fixed / carried verbatim:** `title`, `artist`, `artist_life`, `year`, `dimensions` (numbers), `location` (proper noun — optionally localized later), `confidence`, `recognized`, `similar_works` (titles/artists are proper nouns), `symbolism[].box` (image-anchored), `palette` color *keys*, and **`palette_hex`** (see below). `scene_description`/`render_negatives`/`spatial_layout`/etc. are world-generation inputs, not card content — they stay English and are not part of the localized payload the card uses.

**Palette swatch fix:** swatch color today is parsed from the English color name via `paletteColor()` (`src/lib/paletteColor.ts`). Translating the name would break that. So at **base generation** we precompute `palette_hex: string[]` (index-aligned to `palette`) once from the English names and store it in the dossier. Localized variants **translate the display name** (`palette` strings) but **carry `palette_hex` unchanged**; the client renders the swatch from `palette_hex` and the label from the translated name.

## 5. The `localize` edge function

New `supabase/functions/localize/index.ts`. Input `{ artwork_id?, lang, level, base? }` — `base` is an optional `ArtworkMeta` the client carries from the scan response. Flow:
1. If `artwork_id` present, look up `artwork_content` by `(artwork_id, lang, level)` → if hit, return its `dossier`.
2. Resolve the source dossier: the persisted `(artwork_id, 'en', 'medium')` row if it exists, **else the `base` from the request body** (covers artworks created before this feature, and the keyless demo path where there is no row).
3. One Gemini-Flash call with `LOCALIZE_PROMPT` (in `_shared/prompt.ts`): given the source dossier JSON + target language + target reading level, return the **same JSON shape** with the §4 text fields rewritten and the fixed fields verbatim. Reading-level rubric: `simple` = short sentences, common words, no jargon; `medium` = today's voice; `rich` = precise art vocabulary, longer cadence. Parse tolerantly (reuse `parseRecognitionJson`-style), validate the shape, set `lang`/`level`.
4. If `artwork_id` present, upsert into `artwork_content`. Return the dossier. (No `artwork_id` → transform-and-return without caching, e.g. demo.)

Shares the existing CORS/admin helpers. Uses the same `GEMINI_API_KEY` (or selected recognition provider) — no new key.

**Scan changes (`scan/index.ts`):** after recognition, compute `palette_hex`, persist the base `(en, medium)` dossier into `artwork_content`, and return `artwork_id` in the responses. If the request carries the scanner's `lang`/`level` and it isn't `(en, medium)`, fire the transform for that variant too (best-effort, non-blocking) so their first open is instant.

## 6. Client

- **Pref store** `src/lib/contentPref.ts`: read/write `artlens:lang` + `artlens:level` (localStorage); `detectLocale()` maps `navigator.language` → a `Locale` (else `en`); defaults `(detected, 'medium')`.
- **`src/lib/localize.ts`**: `localizeDossier(artworkId, lang, level): Promise<ArtworkMeta>` → calls the `localize` edge function (or `/api/localize` dev endpoint), with a fallback to the base meta on error.
- **`WorldViewer`**: holds `{lang, level}` from the pref store; renders a **control row** under the grabber — a **language pill** (tap → a simple locale picker sheet) and a **3-stop slider** (Simple ↔ Rich). On change: persist the pref, call `localizeDossier`, swap the rendered `meta` in place; show a brief shimmer while a new variant generates; on failure keep the current text. The base `meta` from the scan response is the initial render (first paint never blocks on localization).
- **Glossary in CJK:** `injectGlossary` matches terms with `\b…\b` word boundaries, which don't exist in Chinese/Japanese. For CJK locales it must fall back to a plain substring match (no `\b`). This is the one language-specific rendering change.

## 7. Dev parity

`dev-api/plugin.ts` + `dev-api/providers.ts`: add `/api/localize` mirroring the edge function (in-memory cache keyed by `(artwork_id|title, lang, level)`), and return `artwork_id` (or a synthetic key) from `/api/scan`. Demo dossier (`DEMO_META`) localizes through the same path with a synthetic key (no DB).

## 8. Error handling

- `localize` transform fails / offline → client keeps the current dossier (base English-Medium or last cached). Never blank.
- Malformed transform JSON → server returns the base dossier unchanged (logged), not an error.
- Unsupported `lang`/`level` → coerce to nearest supported / default; never 500.

## 9. Testing

- `LOCALIZE_PROMPT` round-trip (unit, with a recorded base dossier fixture + a mock provider): returns valid same-shape JSON; fixed fields (`title`, `artist`, `palette_hex`, `symbolism[].box`) unchanged; text fields changed.
- Cache key: `(artwork_id, lang, level)` uniqueness; second request hits cache (no provider call).
- `detectLocale()` mapping (`navigator.language` variants → supported `Locale`, fallback `en`).
- `contentPref` persistence round-trip.
- `injectGlossary` CJK substring path vs Latin `\b` path.
- Reading-level rubric sanity: a fixture asserts `simple` output is shorter/simpler than `rich` (e.g. avg sentence length / jargon-term count) — a coarse guard, not exact text.

## 10. Out of scope

- Localizing the *world* (panorama is a wordless image — nothing to translate).
- Localized **titles** of artworks / location names (kept canonical v1; a `title_local` could be added later).
- RTL languages (Arabic/Hebrew) — not in the v1 set; would need layout work.
- Pre-generating all variants (rejected for cost); voice/audio readout.
- A real authored content DB (the dossier is still LLM-sourced; this design rides whatever produces `ArtworkMeta`).
