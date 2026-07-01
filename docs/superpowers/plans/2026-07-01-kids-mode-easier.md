# Much-Easier Kids Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `simple`/Kids reading level a lot easier for 1st–3rd graders — much simpler & softer writing, plus a trimmed, playful dossier (seek-and-find, "Colors", scholarly sections hidden).

**Architecture:** Two areas change, both keyed off the existing `level === 'simple'`. (A) The `simple` writing rubric + one shared line in the localize prompt (mirrored in `shared/prompt.ts` and `supabase/functions/_shared/prompt.ts`). (B) The viewer renders fewer, relabeled sections in Kids mode, driven by a new pure helper `src/lib/kidsView.ts`. No schema/DB/recognition changes; section-trimming is client-side.

**Tech Stack:** TypeScript, React, Vite, Vitest, Supabase Edge Functions (Deno).

## Global Constraints

- **Do NOT change Teens (`medium`) or Adult (`rich`) behavior.** Only `simple` softens/trims.
- **The two prompt files must stay byte-identical for the changed strings:** `shared/prompt.ts` (Node/client mirror) and `supabase/functions/_shared/prompt.ts` (Deno/edge mirror).
- **No schema, DB migration, or recognition-prompt changes.** JSON shape and array lengths unchanged.
- **Spec:** `docs/superpowers/specs/2026-07-01-kids-mode-easier-design.md`.
- **Commands:** tests `npm run test` (or `npx vitest run <path>`); types `npm run typecheck`; build `npm run build`.

---

### Task 1: Easier & softer `simple` rubric + level-deferred localize line

**Files:**
- Modify: `supabase/functions/_shared/prompt.ts:8-12` (LEVEL_RUBRIC.simple) and `:26` (localize line)
- Modify: `shared/prompt.ts:14-18` (LEVEL_RUBRIC.simple) and `:32` (localize line)
- Test: `supabase/functions/_shared/localizePrompt.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged signatures — `LEVEL_RUBRIC` (record) and `buildLocalizePrompt(dossier, lang, level)` keep the same types; only string contents change.

- [ ] **Step 1: Update the failing test**

Replace the first `it` block in `supabase/functions/_shared/localizePrompt.test.ts` with the version below (keep the second `it` unchanged):

```ts
  it('names the target language and the reading-level rubric', () => {
    const p = buildLocalizePrompt(base, 'zh-Hans', 'simple')
    expect(p).toContain('Simplified Chinese')
    expect(p.toLowerCase()).toMatch(/tiny sentences|much shorter|very short/) // simple = tinier
    expect(p.toLowerCase()).toMatch(/8-year-old|child|kid/)                   // young audience
    expect(p.toLowerCase()).toMatch(/soften|leave out|gentle/)               // content softening
    expect(p).not.toContain('Same facts, same depth')                         // depth now defers to level
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/localizePrompt.test.ts`
Expected: FAIL — old rubric lacks "tiny sentences"/"soften", and the prompt still contains "Same facts, same depth".

- [ ] **Step 3: Rewrite the rubric + localize line in the Deno mirror**

In `supabase/functions/_shared/prompt.ts`, replace the `simple:` entry of `LEVEL_RUBRIC` (line 9) with:

```ts
  simple: 'Write for a child in 1st to 3rd grade — about 6 to 9 years old — who is just learning to read. Use tiny sentences of only a few simple, common words, like an early picture book, and make every part very short — much shorter than the original. Use no art words and no hard words at all; if you must name a thing, say it the way you would to a small kid. Be warm, playful, and full of wonder, always about what you can see and feel. Keep it happy and gentle for young children: soften or simply leave out anything scary, sad, or grown-up — nothing about death, killing, violence, blood, or nudity.',
```

In the same file, replace the localize line (line 26) inside `buildLocalizePrompt`:

```ts
    `Preserve the EXACT JSON structure and array lengths (palette and palette_notes stay index-aligned). Keep the same proper nouns and numbers and the verbatim fields listed above; how much to simplify, shorten, or soften the prose is governed entirely by the READING LEVEL above.`,
```

- [ ] **Step 4: Apply the identical change to the Node mirror**

In `shared/prompt.ts`, make the two edits identical to Step 3: replace the `simple:` rubric entry (line 15) and the localize line (line 32) with the exact same strings.

- [ ] **Step 5: Run tests + verify mirror parity**

Run: `npx vitest run supabase/functions/_shared/localizePrompt.test.ts` → Expected: PASS
Run: `npm run test` → Expected: PASS (full suite)
Run: `diff <(grep -n "1st to 3rd grade" shared/prompt.ts) <(grep -n "1st to 3rd grade" supabase/functions/_shared/prompt.ts)` — both must match the same rubric text (line numbers differ; the quoted string must be present in both).
Run: `grep -c "Same facts, same depth" shared/prompt.ts supabase/functions/_shared/prompt.ts` → Expected: `0` for both.

- [ ] **Step 6: Commit**

```bash
git add shared/prompt.ts supabase/functions/_shared/prompt.ts supabase/functions/_shared/localizePrompt.test.ts
git commit -m "feat: easier, softer Kids (simple) reading-level rubric"
```

---

### Task 2: `kidsView` pure helper (section gating + labels)

**Files:**
- Create: `src/lib/kidsView.ts`
- Test: `src/lib/kidsView.test.ts`

**Interfaces:**
- Consumes: `ReadingLevel` from `shared/types`.
- Produces (used by Task 3):
  - `isKidsLevel(level: ReadingLevel | undefined): boolean`
  - `type SectionKey = 'howMade' | 'process' | 'whyMade' | 'stillMatters' | 'facts'`
  - `showSection(section: SectionKey, level: ReadingLevel | undefined): boolean`
  - `seeingLabel(level: ReadingLevel | undefined): string`
  - `paletteLabel(level: ReadingLevel | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/kidsView.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isKidsLevel, showSection, seeingLabel, paletteLabel, type SectionKey } from './kidsView'

const GATED: SectionKey[] = ['howMade', 'process', 'whyMade', 'stillMatters', 'facts']

describe('isKidsLevel', () => {
  it('is true only for the simple level', () => {
    expect(isKidsLevel('simple')).toBe(true)
    expect(isKidsLevel('medium')).toBe(false)
    expect(isKidsLevel('rich')).toBe(false)
    expect(isKidsLevel(undefined)).toBe(false)
  })
})

describe('showSection', () => {
  it('hides the scholarly sections in kids view', () => {
    for (const s of GATED) expect(showSection(s, 'simple')).toBe(false)
  })
  it('shows every section for teens and adults', () => {
    for (const s of GATED) {
      expect(showSection(s, 'medium')).toBe(true)
      expect(showSection(s, 'rich')).toBe(true)
    }
  })
})

describe('labels', () => {
  it('uses playful kid labels only for the simple level', () => {
    expect(seeingLabel('simple')).toBe('Can you find these?')
    expect(seeingLabel('medium')).toBe("What you're really seeing")
    expect(paletteLabel('simple')).toBe('Colors')
    expect(paletteLabel('rich')).toBe('Palette')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/kidsView.test.ts`
Expected: FAIL — `Cannot find module './kidsView'`.

- [ ] **Step 3: Create the helper**

Create `src/lib/kidsView.ts`:

```ts
import type { ReadingLevel } from '../../shared/types'

/**
 * The Kids view is the `simple` reading level rendered stripped-down for young
 * children: fewer sections, playful labels, no glossary chips. These pure helpers
 * hold that decision so it is unit-testable without mounting the 3D WorldViewer.
 */

/** True when the dossier should render in the kid-friendly Kids view. */
export function isKidsLevel(level: ReadingLevel | undefined): boolean {
  return level === 'simple'
}

/** Dossier sections whose visibility varies by reading level. */
export type SectionKey = 'howMade' | 'process' | 'whyMade' | 'stillMatters' | 'facts'

/** Scholarly/dense sections hidden in the Kids view. */
const KID_HIDDEN: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'howMade',
  'process',
  'whyMade',
  'stillMatters',
  'facts',
])

/** Whether `section` renders at reading `level`. Kids view hides the scholarly set. */
export function showSection(section: SectionKey, level: ReadingLevel | undefined): boolean {
  return isKidsLevel(level) ? !KID_HIDDEN.has(section) : true
}

/** Label for the symbolism/hidden-details section — a seek-and-find prompt for kids. */
export function seeingLabel(level: ReadingLevel | undefined): string {
  return isKidsLevel(level) ? 'Can you find these?' : "What you're really seeing"
}

/** Label for the palette section — plain "Colors" for kids. */
export function paletteLabel(level: ReadingLevel | undefined): string {
  return isKidsLevel(level) ? 'Colors' : 'Palette'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/kidsView.test.ts` → Expected: PASS
Run: `npm run typecheck` → Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/kidsView.ts src/lib/kidsView.test.ts
git commit -m "feat: kidsView helper — section gating + playful labels for Kids mode"
```

---

### Task 3: Wire the viewer to trim + relabel in Kids mode

**Files:**
- Modify: `src/components/WorldViewer.tsx` (import ~line 16; `glossary` ~line 399; section blocks 531, 574, 591, 630, 636, 644, 652, 668)

**Interfaces:**
- Consumes: `isKidsLevel`, `showSection`, `seeingLabel`, `paletteLabel` from `../lib/kidsView` (Task 2).
- Produces: nothing new (JSX wiring only).

> No new unit test: this is thin JSX gating over the Task-2 helper (already tested). The 3D viewer can't mount in jsdom, so verification is typecheck + build + full suite + a manual Kids-mode check.

- [ ] **Step 1: Add the helper import**

In `src/components/WorldViewer.tsx`, immediately after the line `import { termRegex } from '../lib/glossary'` (line 16), add:

```ts
import { isKidsLevel, showSection, seeingLabel, paletteLabel } from '../lib/kidsView'
```

- [ ] **Step 2: Compute `kids` and gate the glossary**

Replace the line (line 399):

```ts
  const glossary = meta.glossary ?? []
```

with:

```ts
  const kids = isKidsLevel(meta.level)
  // Kids view drops the tappable glossary chips (no jargon to define anyway).
  const glossary = kids ? [] : (meta.glossary ?? [])
```

- [ ] **Step 3: Relabel the two kept sections**

Replace `<Section label="What you're really seeing">` (line 531) with:

```tsx
              <Section label={seeingLabel(meta.level)}>
```

Replace `<Section label="Palette">` (line 591) with:

```tsx
              <Section label={paletteLabel(meta.level)}>
```

- [ ] **Step 4: Hide the scholarly sections in Kids mode**

Make each of these five edits (each `old` string is unique in the file):

1. `{(meta.brushwork || meta.materiality || meta.scale_note) && (`
   → `{showSection('howMade', meta.level) && (meta.brushwork || meta.materiality || meta.scale_note) && (`

2. `{hasRabbitHole && (`
   → `{!kids && hasRabbitHole && (`

3. `{meta.process && (`
   → `{showSection('process', meta.level) && meta.process && (`

4. `{meta.why_made && (`
   → `{showSection('whyMade', meta.level) && meta.why_made && (`

5. `{(meta.legacy || meta.debates) && (`
   → `{showSection('stillMatters', meta.level) && (meta.legacy || meta.debates) && (`

6. `{hasCatalog && (`
   → `{showSection('facts', meta.level) && hasCatalog && (`

- [ ] **Step 5: Verify types, tests, and build**

Run: `npm run typecheck` → Expected: PASS
Run: `npm run test` → Expected: PASS
Run: `npm run build` → Expected: PASS

- [ ] **Step 6: Manual Kids-mode check**

Run: `npm run dev`, open the demo world, set the reading slider to **Kids** (or enter with `simple`). Confirm: only **The story · "Can you find these?" · Colors · If you liked this** render; How-it-was-made, "Go deeper", Underneath, Why-it-was-made, Why-it-still-matters, and The-facts are gone; the story has no tappable glossary chips. Switch to **Teens/Adult** and confirm all sections return with original labels.

- [ ] **Step 7: Commit**

```bash
git add src/components/WorldViewer.tsx
git commit -m "feat: trim + relabel dossier for Kids mode (seek-and-find, Colors, hide scholarly)"
```

---

## Self-Review

**Spec coverage:**
- Simpler/shorter writing → Task 1 (rubric). ✓
- Softer content → Task 1 (rubric softening + level-deferred localize line). ✓
- Fewer sections (hide howMade/process/whyMade/stillMatters/facts + glossary) → Task 2 helper + Task 3 wiring. ✓
- Seek-and-find + "Colors" labels; keep story + similar works → Task 2 labels + Task 3 (kept sections untouched). ✓
- Both prompt mirrors in sync → Task 1 Steps 3–5. ✓
- Pure, testable show/hide helper → Task 2. ✓
- No Teens/Adult change → `showSection`/labels return defaults for `medium`/`rich` (Task 2 tests assert this). ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `isKidsLevel`/`showSection`/`seeingLabel`/`paletteLabel` and `SectionKey` names/signatures match between Task 2 (definition), its test, and Task 3 (usage). `meta.level` is `ReadingLevel | undefined`, matching every helper's parameter type.
