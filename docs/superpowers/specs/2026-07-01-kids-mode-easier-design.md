# Kids mode for 1st–3rd graders — design

**Date:** 2026-07-01
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** `2026-06-26-localized-reading-level-dossier-design.md` (the reading-level/localize feature)

## Problem

"Kids mode" is the `simple` reading level (the "Kids" end of the Kids / Teens / Adult
slider in `DossierControls`). Today it targets *"a curious 8-year-old"* (~3rd-grade top
end) and, like every level, is told to keep **all the same facts at the same depth** —
only the wording changes. Every dossier section renders identically at every level.

For 1st–3rd graders (ages ~6–9) this is still too hard: sentences and vocabulary are
too advanced, there is far too much text, adult/dark facts survive verbatim (e.g.
*"painted a year before he shot himself"*), and scholarly sections (debates, provenance,
technique, glossary) are meaningless to a young child.

## Goal

Make `simple`/Kids mode **a lot easier** for 1st–3rd graders along four axes the user
confirmed:

1. **Much simpler writing** — tiny sentences, decodable words, noticeably shorter.
2. **Softer content** — gently soften or skip scary/mature facts.
3. **Fewer sections** — show a short, focused set; hide the scholarly ones.
4. **Kid engagement** — reframe the existing symbols/hidden-details as a playful
   seek-and-find ("Can you find these?"), reusing the picture crops already produced.

**Non-goal:** No changes to Teens (`medium`) or Adult (`rich`). No new slider stops, no
new data fields, no schema/DB migration, no recognition-prompt changes.

## Design overview

Everything keys off the existing `level === 'simple'`. Two areas change:

- **A. What the writer produces** — the `simple` rubric + one shared instruction in the
  localize prompt.
- **B. What the viewer shows** — fewer, relabeled sections when `meta.level === 'simple'`.

No backend, schema, or cache-shape changes. Section-trimming is purely client-side, so it
takes effect immediately even for content already cached at `simple`.

## A. Writing changes (prompt)

Two mirrored files must stay in sync (Node/client + Deno/edge):
`shared/prompt.ts` and `supabase/functions/_shared/prompt.ts`.

### A1. Rewrite `LEVEL_RUBRIC.simple`

Replace the "curious 8-year-old" rubric with one aimed at 1st–2nd-grade decodability
(works up through 3rd), covering vocabulary, length, tone, **and** content safety.
Target wording (final phrasing tunable during implementation):

> Write for a child in 1st–3rd grade (about 6–9 years old) who is just learning to read.
> Use tiny sentences of only a few simple, common words — like an early picture book —
> and make every part very short, much shorter than the original. Use no art words or
> hard words at all; if you name a thing, say it the way you would to a small kid. Be
> warm, playful, and full of wonder, always about what you can see and feel. Keep it
> happy and gentle: soften or simply leave out anything scary, sad, or grown-up — no
> death, violence, blood, or nudity — this is for young children.

Constraints the rubric must satisfy (for the existing/updated tests):
- Mentions the young audience (matches `/8-year-old|child|kid/`).
- Signals shorter/tinier sentences.
- Signals content softening (the new behavior).

### A2. Relax the global "same facts" line — only via the rubric

`buildLocalizePrompt` currently ends with a hard, level-independent instruction:

> `Preserve the EXACT JSON structure and array lengths (palette and palette_notes stay index-aligned). Same facts, same depth — only the wording changes.`

This blocks the `simple` softening. Change the trailing clause so depth/softening defers
to the reading level, while structure and proper nouns stay locked:

> `Preserve the EXACT JSON structure and array lengths (palette and palette_notes stay index-aligned). Keep the same proper nouns, numbers, and the verbatim fields listed above; how much to simplify, shorten, or soften the prose is governed entirely by the READING LEVEL above.`

This is safe for Teens/Adult: their rubrics say keep the voice / "do not dumb anything
down," so they still preserve depth. Only `simple` is told to soften.

### A3. Seek-and-find framing (no new field)

The seek-and-find is a **viewer relabel** of the existing symbolism/hidden-details block
(which already carries image crops via `symbolism[].box`). The `simple` rubric naturally
makes `symbolism[].detail`, `symbolism[].meaning`, and `hidden_details[]` playful and
noticing-oriented ("Look — can you find…"), so no new data field or schema change is
needed. Array lengths and boxes stay untouched (already in the verbatim list).

## B. Viewer changes (`src/components/WorldViewer.tsx`)

Introduce a single predicate, e.g. `const kids = (meta.level ?? 'medium') === 'simple'`.

### B1. Sections kept for kids

| Section (current label) | Condition | Kids behavior |
|---|---|---|
| Hero: title + **Hook** | always | keep |
| **The story** | `meta.story` | keep, label unchanged |
| **What you're really seeing** (symbolism + hidden_details) | `symbolism.length \|\| hidden_details.length` | keep, **relabel → "Can you find these?"** |
| **Palette** | `palette.length` | keep, **relabel → "Colors"** |
| **If you liked this** (similar_works) | `similar_works.length` | keep (optional relabel → "More art you'll like") |

### B2. Sections hidden for kids (wrap in `!kids &&`)

- **How it was made** (brushwork / materiality / scale_note)
- **"Go deeper"** divider (`hasRabbitHole`)
- **Underneath** (process)
- **Why it was made** (why_made)
- **Why it still matters** (legacy / debates)
- **The facts** (year / medium / dimensions / location / provenance / style)

### B3. Glossary chips off for kids

Set the glossary source empty in kids mode: `const glossary = kids ? [] : (meta.glossary ?? [])`.
`injectGlossary` returns text unchanged when the glossary is empty, so all `injectGlossary`
call sites become no-ops for kids with no other edits. (There is no jargon to chip anyway.)

### B4. Labels

Two conditional labels only:
- "What you're really seeing" → "Can you find these?" when `kids`.
- "Palette" → "Colors" when `kids`.

("If you liked this" → "More art you'll like" is optional polish; default to keeping the
existing label to minimize churn unless trivial.)

## Approach decision (recorded)

- **Section trimming lives client-side** (chosen) rather than blanking hidden fields at
  the localize step. Keeps stored content complete and presentation-independent, needs no
  regeneration when switching levels, and works on already-cached content immediately.
- **Rejected:** server-side blanking of fields for `simple` — couples content to
  presentation, loses data, and pollutes the cache.
- **Engagement = reuse symbolism as seek-and-find** (chosen) rather than a new generated
  activity field — zero schema/DB impact.

## Testing

- **Prompt (`supabase/functions/_shared/localizePrompt.test.ts`):** update the `simple`
  assertions — still matches `/8-year-old|child|kid/`, plus assert the new shorter-sentence
  and softening signals. Add an assertion that `buildLocalizePrompt` no longer hard-codes
  "same depth" (or that it references the reading level for depth).
- **Prompt sync:** `shared/prompt.ts` and `supabase/functions/_shared/prompt.ts` carry
  identical rubric + localize-prompt text. Keep both in the change; the localize test only
  imports the Deno mirror, so verify the Node mirror by inspection/grep parity.
- **Viewer show/hide logic:** extract the "which sections are visible for a level" decision
  into a tiny pure helper so it is unit-testable without mounting the Three.js viewer
  (e.g. a `kidsMode(level)` predicate or a `visibleSections(level)` map in
  `src/lib/`). Test that `simple` hides the scholarly set and keeps the fun set; `medium`/
  `rich` keep everything.
- `RECOGNITION_PROMPT` tests (`prompt.test.ts`) are unaffected (no recognition changes).

## Risks / notes

- **Cache staleness:** section-trimming + seek-and-find relabel apply instantly to all
  content. The *softer wording* only applies to newly generated `simple` dossiers; any
  artwork already cached at `simple` in `artwork_content` keeps its old wording until
  regenerated. Acceptable (frontend not yet hosted); optionally clear existing `level =
  'simple'` rows to force regeneration. No cache **shape** change either way.
- **`scale_note`** ("smaller than your laptop") is kid-friendly but lives inside the hidden
  "How it was made" section; it is dropped for kids. Acceptable; not worth surfacing
  separately.
- **Prompt-mirror drift** is the main maintenance risk — the two files must be edited
  together.

## Out of scope

New slider stops or an explicit "age" control; recognition-prompt/schema changes; new
generated kid-activity fields; DB migration; changes to Teens/Adult.
