# More faithful world-generation prompt — design

**Date:** 2026-07-01
**Status:** Approved (brainstorming) → implement
**Scope:** `buildScenePrompt` in both mirrors (`shared/prompt.ts`, `supabase/functions/_shared/prompt.ts`). No other files except a test.

## Problem

The generated 360° world drifts from the source painting. The user wants it *more faithful* across four axes: the artist's hand/style, the actual subjects depicted, the colours & light, and the composition/depth feel — without losing the immersive "world you stand inside, NOT a flat copy on a wall" goal.

## Approach

Approach **A (targeted clauses)**: strengthen the weak existing fidelity language and add one short clause per axis, keeping the current prompt structure and the immersive framing. (Rejected B: conditional depth restructuring — overlaps the realization router, bigger risk for modest gain.)

## Global constraints

- Both prompt mirrors stay **byte-identical** for the changed strings.
- Keep: the immersive 360° opening, the `NOT a flat copy of the artwork on a wall` guard, the seamless-wrap clause.
- No schema/type/signature change — `buildScenePrompt(r): { prompt, negative }` unchanged.

## Clause changes (in `buildScenePrompt`)

**1. Opening — drop the unconditional deep-space demand (composition fidelity):**
- Old: `…extending far past the frame in every direction with real depth and distance, a place you could walk into.`
- New: `…extending far past the frame in every direction, a place you could walk into.`

**2. `titleLine` — stronger fidelity naming (hand/style):**
- Old: `` In the spirit of "${title}"${by artist}.``
- New: `` Faithful to "${title}"${by artist} — this is that painting's own world, seen from within.``

**3. `mediumLine` — reproduce the exact hand:**
- Old: `` Rendered entirely as ${technique}; every surface shows this same hand and medium — a painting, never a photograph or 3D render.``
- New: `` Rendered entirely as ${technique}; reproduce the artist's exact brushwork, edges and touch — every surface shows this same hand and medium, a painting, never a photograph or 3D render.``
- Fallback (`r.medium` branch): `` Painted in ${medium}, in the artist's own hand, never photographic.``

**4. `subjects` — new clause, always included (subject fidelity):**
- New const: `` Keep the real subjects, motifs and setting the original depicts, continuing them naturally past the frame — invent nothing foreign to it.``
- Inserted right before the "Every surface is hand-painted…" sentence.

**5. `persp` — honour the original's composition (composition/depth):**
- Old: `` Spatial depth: ${perspective}.``
- New: `` Compose the space as the original does — its ${perspective} perspective, kept as flat or as deep as the painting itself, not a generic deep 3D space.``

**6. `light` — match exactly (light fidelity):**
- Old: `` Light: ${lightStr}.``
- New: `` Light exactly as in the original: ${lightStr}, with matching shadows and atmosphere.``

**7. `palette` — lock values & saturation (colour fidelity):**
- Old: `` Hold strictly to this palette and no other colours: ${palette}.``
- New: `` Hold strictly to the original's palette and no other colours, at the same values and saturation: ${palette}.``

**8. Negatives:** add `'oversaturated'` to `BASE_NEGATIVES`.

All clauses remain guarded by their existing `?:` conditions (persp/light/palette only appear when their field is present); `subjects` and the opening/medium changes always apply. The final `.replace(/\s+/g,' ').trim()` absorbs any spacing.

## Testing

Add a `buildScenePrompt` test to `supabase/functions/_shared/prompt.test.ts` (the tested mirror). With a sample recognized dossier, assert the prompt contains: `Faithful to "…"`, `invent nothing foreign`, `same values and saturation`, light "exactly as in the original", `Compose the space as the original does`; does NOT contain `real depth and distance`; and the negative contains `oversaturated`. Verify both mirrors byte-identical for the changed block via grep/diff. Full suite + typecheck + build.

## Risks

- Prompt bloat: kept each clause tight; net addition ~3 sentences.
- Mirror drift: edit both files together (the standing maintenance risk for these prompts).
- Faithfulness vs. immersion: the `NOT a flat copy` guard is retained so subject-fidelity doesn't collapse into reproducing the framed artwork.
