# Artwork 3D Realization — Milestone A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-artwork "realization router" + flat-figure guard so artworks with prominent figures stop being smeared by depth displacement — rendering clean-flat instead — with zero new ML.

**Architecture:** Recognition (Gemini/Claude/OpenAI) emits three new routing fields (`scene_type`, `figure_coverage`, `depth_profile`). A pure server-side function `routeRealization()` maps them to a `realization` strategy (`'flat' | 'depth'`, with `'layered'` reserved for Milestone B). The scan flow persists the chosen strategy on the `artworks`/`jobs` rows; the client threads it to `WorldViewer`, which skips binding the depth map when the strategy is `'flat'`. Every path degrades to today's behavior — unknown signals → `'depth'`, and the client still renders flat when no depth map exists — so the router can only ever improve on the current single-method world.

**Tech Stack:** TypeScript, React + Vite (client), Three.js (`src/three/Skybox.ts`), Supabase Edge Functions on Deno (`supabase/functions/**`), Postgres migrations (`supabase/migrations/**`), Vitest (new — unit tests for the pure router).

Full design context: `docs/superpowers/specs/2026-06-25-artwork-3d-realization-design.md` (§4 router, §6 Milestone A).

## Global Constraints

These apply to every task:

- **Free / no new ML / no new paid services.** Milestone A adds no models, no client ML, no new WebGPU dependency, no external calls. (The depth map remains Blockade's free Model-3 byproduct.)
- **Two type files must stay in sync.** `shared/types.ts` (client, tsc-checked) and `supabase/functions/_shared/types.ts` (Deno mirror) — every shared-shape change goes in BOTH, verbatim.
- **The realization enum is exactly** `'flat' | 'depth' | 'layered'`. Milestone A only ever produces `'flat'` or `'depth'`; `'layered'` is reserved for Milestone B.
- **Degrade-to-today invariant.** Absent/unknown signals → `'depth'`; a `'depth'`/absent strategy with no depth map still renders flat client-side. No path may produce output worse than today's.
- **The figure guard is the point:** `figure_coverage > 0.35` must NEVER route to `'depth'`.
- **Deno files** (`supabase/functions/**`) are NOT covered by `npm run typecheck` (tsconfig includes only `src`,`shared`). Verify them with `deno check <file>`; if `deno` is not installed (`deno --version` fails), they are type-checked at deploy time by `supabase functions deploy` — in that case visually diff against the snippet in the step.
- The Blockade 2200-char prompt cap concerns the *scene* prompt (`buildScenePrompt`), which this milestone does not touch. The recognition prompt (`RECOGNITION_PROMPT`) has no such cap.

## File Structure

**New files:**
- `supabase/functions/_shared/realization/route.ts` — the pure router (`routeRealization` + signal types). One responsibility: signals → strategy.
- `supabase/functions/_shared/realization/route.test.ts` — vitest unit tests for the router.
- `supabase/functions/_shared/prompt.test.ts` — vitest assertion that the recognition prompt advertises the routing fields.
- `supabase/migrations/0003_realization.sql` — adds the `realization` column to `artworks` + `jobs`.
- `vitest.config.ts` — minimal Node-env test config, isolated from the app's Vite plugins.

**Modified files:**
- `shared/types.ts` + `supabase/functions/_shared/types.ts` — new union types, recognition fields, response fields.
- `supabase/functions/_shared/prompt.ts` — three routing fields + guidance in `RECOGNITION_PROMPT`.
- `supabase/functions/_shared/recognition/index.ts` — three routing fields in `RECOGNITION_JSON_SCHEMA` (properties + required).
- `supabase/functions/scan/index.ts` — compute + persist `realization`; return it in responses.
- `supabase/functions/job-status/index.ts` — select + return `realization`.
- `src/lib/api.ts` — `ScanOutcome.realization`; thread through all paths.
- `src/App.tsx` — carry `realization` from scan into `WorldViewer`.
- `src/components/WorldViewer.tsx` — skip the depth bind when `realization === 'flat'`.
- `package.json` — add `vitest` devDep + `test` script.

---

### Task 1: Shared types (router enum, recognition fields, response fields)

**Files:**
- Modify: `shared/types.ts`
- Modify: `supabase/functions/_shared/types.ts`

**Interfaces:**
- Produces: `Realization = 'flat' | 'depth' | 'layered'`; `SceneType = 'landscape' | 'portrait' | 'still-life' | 'interior' | 'abstract'`; `DepthProfile = 'mostly-far' | 'far-with-near-foreground' | 'shallow-tabletop' | 'flat'`. Adds optional `scene_type`, `figure_coverage`, `depth_profile` to `RecognitionResult`; optional `realization` to `ScanReadyResponse`, `ScanGeneratingResponse`, `JobStatusResponse`. Every later task consumes these names.

- [ ] **Step 1: Add the three union types to `shared/types.ts`**

Insert immediately above `export interface RecognitionResult {` (currently line 39):

```typescript
/** Which renderer the world uses, chosen per-artwork by the realization router. */
export type Realization = 'flat' | 'depth' | 'layered'

/** Coarse scene class the router reads to pick a realization strategy. */
export type SceneType =
  | 'landscape'
  | 'portrait'
  | 'still-life'
  | 'interior'
  | 'abstract'

/** Coarse depth structure the router reads to pick a realization strategy. */
export type DepthProfile =
  | 'mostly-far'
  | 'far-with-near-foreground'
  | 'shallow-tabletop'
  | 'flat'

```

- [ ] **Step 2: Add the three recognition fields to `RecognitionResult` in `shared/types.ts`**

Inside `RecognitionResult`, immediately after the `artwork_box?: { ... }` field (the last field, currently ending line 139), add:

```typescript

  // ── 3D realization routing (drives flat vs depth-mesh vs — later — layered) ──
  // Optional on the type (older cached rows / the demo dossier omit them); the
  // router defaults safely when absent.
  /** Coarse scene class — the dominant kind of scene. */
  scene_type?: SceneType
  /** 0..1 fraction of the frame occupied by prominent figures (people/animals). */
  figure_coverage?: number
  /** Coarse depth structure of the scene. */
  depth_profile?: DepthProfile
```

- [ ] **Step 3: Add `realization` to the three response types in `shared/types.ts`**

In `ScanReadyResponse`, after `depth_url?: string | null` (line 157), add:

```typescript
  /** Render strategy chosen by the realization router; absent → client default. */
  realization?: Realization
```

In `ScanGeneratingResponse`, after `meta?: ArtworkMeta` (line 175), add:

```typescript
  /** Render strategy chosen by the realization router; absent → client default. */
  realization?: Realization
```

In `JobStatusResponse`, after `depth_url?: string | null` (line 194), add:

```typescript
  /** Render strategy chosen by the realization router; null/absent → client default. */
  realization?: Realization | null
```

- [ ] **Step 4: Mirror all of Steps 1–3 verbatim into `supabase/functions/_shared/types.ts`**

Add the same three union types above `export interface RecognitionResult {` (currently line 19); the same three fields after `artwork_box?` (currently line 69); the same `realization?` fields in `ScanReadyResponse` (after line 81 `depth_url?`), `ScanGeneratingResponse` (after line 93 `meta?`), and `JobStatusResponse` (after line 110 `depth_url?`). The Deno mirror omits doc comments on existing fields, so keep the additions comment-light to match its style — but the type bodies must be identical.

- [ ] **Step 5: Verify the client types compile**

Run: `npm run typecheck`
Expected: exits 0, no errors. (New exported types are unused-but-exported, which `noUnusedLocals` permits.)

- [ ] **Step 6: Verify the Deno mirror parses (best-effort)**

Run: `deno check supabase/functions/_shared/types.ts`
Expected: `Check …/_shared/types.ts` with no errors. If `deno` is not installed, skip and visually confirm the mirror matches `shared/types.ts`.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts supabase/functions/_shared/types.ts
git commit -m "types: realization enum + routing & response fields"
```

---

### Task 2: Vitest harness + the pure realization router

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `supabase/functions/_shared/realization/route.ts`
- Test: `supabase/functions/_shared/realization/route.test.ts`

**Interfaces:**
- Consumes: `Realization`, `SceneType`, `DepthProfile` from `../types.ts` (Task 1).
- Produces: `routeRealization(s: RealizationSignals): Realization` and `interface RealizationSignals { scene_type?: SceneType; figure_coverage?: number; depth_profile?: DepthProfile; confidence?: number }`. Task 4 calls `routeRealization`.

- [ ] **Step 1: Install vitest and add the test script**

Run: `npm install -D vitest`
Then add to the `"scripts"` block in `package.json` (after the `"typecheck"` line):

```json
    "test": "vitest run"
```

- [ ] **Step 2: Create the isolated test config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

// Pure unit tests (the realization router). Node env, no DOM, and intentionally
// NOT the app's vite.config.ts — the Deno edge files under test import only
// type-only symbols from sibling .ts files, so esbuild strips those imports and
// the files transpile here without resolving any Deno/npm specifiers.
export default defineConfig({
  test: {
    include: ['supabase/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 3: Write the failing router test**

Create `supabase/functions/_shared/realization/route.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { SceneType } from '../types.ts'
import { routeRealization } from './route.ts'

describe('routeRealization', () => {
  it('renders a prominent figure flat, never depth (the warped-person guard)', () => {
    expect(
      routeRealization({
        scene_type: 'portrait',
        figure_coverage: 0.6,
        depth_profile: 'far-with-near-foreground',
      }),
    ).toBe('flat')
  })

  it('renders abstract art flat', () => {
    expect(
      routeRealization({ scene_type: 'abstract', figure_coverage: 0, depth_profile: 'flat' }),
    ).toBe('flat')
  })

  it('renders a mostly-far vista flat (depth adds negligible parallax)', () => {
    expect(
      routeRealization({ scene_type: 'landscape', figure_coverage: 0, depth_profile: 'mostly-far' }),
    ).toBe('flat')
  })

  it('renders a landscape with real foreground as depth-parallax', () => {
    expect(
      routeRealization({
        scene_type: 'landscape',
        figure_coverage: 0.05,
        depth_profile: 'far-with-near-foreground',
      }),
    ).toBe('depth')
  })

  it('renders a shallow still-life as depth-parallax', () => {
    expect(
      routeRealization({
        scene_type: 'still-life',
        figure_coverage: 0.1,
        depth_profile: 'shallow-tabletop',
      }),
    ).toBe('depth')
  })

  it('defaults to depth when signals are missing (preserves today’s behavior)', () => {
    expect(routeRealization({})).toBe('depth')
  })

  it('invariant: figure_coverage > 0.35 never routes to depth', () => {
    const scenes: SceneType[] = ['landscape', 'portrait', 'still-life', 'interior', 'abstract']
    for (const scene_type of scenes) {
      expect(
        routeRealization({
          scene_type,
          figure_coverage: 0.5,
          depth_profile: 'far-with-near-foreground',
        }),
      ).toBe('flat')
    }
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — vitest cannot resolve `./route.ts` (module/function not found).

- [ ] **Step 5: Implement the router**

Create `supabase/functions/_shared/realization/route.ts`:

```typescript
import type { Realization, SceneType, DepthProfile } from '../types.ts'

/** Signals the router reads. All optional — missing signals fall back safely. */
export interface RealizationSignals {
  scene_type?: SceneType
  /** 0..1 fraction of the frame occupied by prominent figures (people/animals). */
  figure_coverage?: number
  depth_profile?: DepthProfile
  /** 0..1 recognition confidence. Reserved for Milestone B (S3 demotion). */
  confidence?: number
}

/** Above this figure coverage, depth displacement rubber-sheets the silhouette. */
const FIGURE_GUARD = 0.35

/**
 * Pick the render strategy for one artwork (Milestone A: 'flat' | 'depth').
 *
 * A prominent figure is NEVER depth-displaced — the single connected depth-mesh
 * smears the silhouette — so it renders flat until Milestone B can separate it
 * into its own layer. Abstract and depth-less scenes also render flat (depth
 * would invent fake geometry). Everything else, including unknown/absent
 * signals, gets today's depth-parallax; the client still degrades to flat when
 * no depth map is available, so this never does worse than the current world.
 */
export function routeRealization(s: RealizationSignals): Realization {
  if ((s.figure_coverage ?? 0) > FIGURE_GUARD) return 'flat'
  if (s.scene_type === 'abstract') return 'flat'
  if (s.depth_profile === 'flat' || s.depth_profile === 'mostly-far') return 'flat'
  return 'depth'
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 7 tests in `route.test.ts` pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts supabase/functions/_shared/realization/route.ts supabase/functions/_shared/realization/route.test.ts
git commit -m "feat: realization router (flat-figure guard) + vitest harness"
```

---

### Task 3: Recognition emits the routing fields

**Files:**
- Test: `supabase/functions/_shared/prompt.test.ts`
- Modify: `supabase/functions/_shared/prompt.ts`
- Modify: `supabase/functions/_shared/recognition/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RECOGNITION_PROMPT` (in `prompt.ts`) and `RECOGNITION_JSON_SCHEMA` (in `recognition/index.ts`) now advertise/require `scene_type`, `figure_coverage`, `depth_profile`, so `recognition.scene_type` etc. arrive populated for Task 4's router call.

- [ ] **Step 1: Write the failing prompt test**

Create `supabase/functions/_shared/prompt.test.ts` (`prompt.ts` has only type-only imports, so vitest transpiles it cleanly):

```typescript
import { describe, it, expect } from 'vitest'
import { RECOGNITION_PROMPT } from './prompt.ts'

describe('RECOGNITION_PROMPT', () => {
  it('advertises the three realization routing fields', () => {
    expect(RECOGNITION_PROMPT).toContain('scene_type')
    expect(RECOGNITION_PROMPT).toContain('figure_coverage')
    expect(RECOGNITION_PROMPT).toContain('depth_profile')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `RECOGNITION_PROMPT` does not contain those strings yet.

- [ ] **Step 3: Add the three fields to the prompt's JSON shape**

In `supabase/functions/_shared/prompt.ts`, find the `artwork_box` line (currently line 69) which ends the JSON shape just before the closing `}`:

```
  "artwork_box": { "x": number, "y": number, "w": number, "h": number } // tight bounding box of JUST the artwork in the photo, normalized 0..1 (x,y = top-left). Exclude wall, physical frame, hands, glare. Use {"x":0,"y":0,"w":1,"h":1} if it fills the frame.
}
```

Replace those two lines with (note the added comma after `artwork_box`):

```
  "artwork_box": { "x": number, "y": number, "w": number, "h": number }, // tight bounding box of JUST the artwork in the photo, normalized 0..1 (x,y = top-left). Exclude wall, physical frame, hands, glare. Use {"x":0,"y":0,"w":1,"h":1} if it fills the frame.

  "scene_type": string,      // ROUTING: dominant kind of scene — one of "landscape" | "portrait" | "still-life" | "interior" | "abstract"
  "figure_coverage": number, // ROUTING: 0..1 fraction of the frame occupied by prominent human/animal FIGURES (0 if none; ~0.5 a half-length portrait; high for a tight portrait)
  "depth_profile": string    // ROUTING: depth structure — "mostly-far" (open/distant, little near content) | "far-with-near-foreground" (clear near + far layers) | "shallow-tabletop" (close objects, shallow space) | "flat" (no real depth / abstract)
}
```

- [ ] **Step 4: Add routing guidance to the prompt's closing instructions**

In the same file, find the end of the closing paragraph (currently line 72) which finishes:

```
… so the generated world stays painted in the same hand. Output the JSON only — no prose, no code fences, no comments, no trailing commas.`
```

Replace with (insert one sentence before "Output the JSON only"):

```
… so the generated world stays painted in the same hand. Finally, set the three ROUTING fields decisively: scene_type (the dominant scene class), figure_coverage (0..1 — how much of the frame prominent people/animals occupy), and depth_profile (how the space recedes) — these decide how the world is rendered. Output the JSON only — no prose, no code fences, no comments, no trailing commas.`
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — `prompt.test.ts` passes alongside the router tests.

- [ ] **Step 6: Add the three fields to `RECOGNITION_JSON_SCHEMA` (Claude/OpenAI providers)**

In `supabase/functions/_shared/recognition/index.ts`, inside `RECOGNITION_JSON_SCHEMA.properties`, after the `artwork_box` property block (ends line 129, the `}` before `},` that closes `properties` at line 130) add:

```typescript
    scene_type: {
      type: 'string',
      enum: ['landscape', 'portrait', 'still-life', 'interior', 'abstract'],
    },
    figure_coverage: { type: 'number' },
    depth_profile: {
      type: 'string',
      enum: ['mostly-far', 'far-with-near-foreground', 'shallow-tabletop', 'flat'],
    },
```

Then in the `required` array, after `'artwork_box',` (line 168) add:

```typescript
    'scene_type',
    'figure_coverage',
    'depth_profile',
```

- [ ] **Step 7: Verify the schema file parses (best-effort)**

Run: `deno check supabase/functions/_shared/recognition/index.ts`
Expected: no errors. If `deno` is not installed, visually confirm the new properties and `required` entries are well-formed (the surrounding objects use `enum`/`type` exactly as shown) — this file is also type-checked at `supabase functions deploy`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/prompt.ts supabase/functions/_shared/prompt.test.ts supabase/functions/_shared/recognition/index.ts
git commit -m "feat: recognition emits scene_type/figure_coverage/depth_profile"
```

---

### Task 4: Persist & expose the realization (migration + scan + job-status)

**Files:**
- Create: `supabase/migrations/0003_realization.sql`
- Modify: `supabase/functions/scan/index.ts`
- Modify: `supabase/functions/job-status/index.ts`

**Interfaces:**
- Consumes: `routeRealization` (Task 2); `recognition.scene_type/figure_coverage/depth_profile` (Tasks 1+3); the new `realization` columns (this task).
- Produces: `scan` writes `realization` to `artworks` + `jobs` and returns it in the ready/generating responses; `job-status` returns `realization`. Task 5 reads these.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_realization.sql`:

```sql
-- Per-artwork 3D realization strategy chosen by the realization router
-- (supabase/functions/_shared/realization/route.ts). Nullable: older rows and
-- the demo path leave it null, and the client then uses its default behavior
-- (depth when a depth map exists, else flat).

alter table public.artworks add column if not exists realization text
  check (realization is null or realization in ('flat', 'depth', 'layered'));

alter table public.jobs add column if not exists realization text
  check (realization is null or realization in ('flat', 'depth', 'layered'));
```

- [ ] **Step 2: Import the router into the scan function**

In `supabase/functions/scan/index.ts`, after the existing `import type { RecognitionResult } from '../_shared/types.ts'` (line 10), add:

```typescript
import { routeRealization } from '../_shared/realization/route.ts'
```

- [ ] **Step 3: Compute the realization right after recognition**

In the same file, after `const artist = meta.artist` (line 60) and before `const admin = adminClient()` (line 61), add:

```typescript
  const realization = routeRealization({
    scene_type: recognition.scene_type,
    figure_coverage: recognition.figure_coverage,
    depth_profile: recognition.depth_profile,
    confidence: recognition.confidence,
  })
  console.log('realization route', {
    title,
    realization,
    scene_type: recognition.scene_type,
    figure_coverage: recognition.figure_coverage,
    depth_profile: recognition.depth_profile,
  })
```

- [ ] **Step 4: Return the cached strategy on a cache hit**

In the cache-lookup `.select(...)` (line 67), add `realization`:

```typescript
      .select('id, title, artist, panorama_url, depth_url, realization')
```

Then in the cache-hit response object (lines 74–81), after `depth_url: hit.depth_url ?? null,` add:

```typescript
        realization: hit.realization ?? realization,
```

- [ ] **Step 5: Persist the strategy on the new artwork row**

In the `artworks` insert (lines 106–111), after `scene_prompt: scenePrompt,` add:

```typescript
      realization,
```

- [ ] **Step 6: Persist the strategy on the job row**

Change the `jobs` insert (line 123) from:

```typescript
    .insert({ artwork_id: artwork?.id ?? null, status: 'pending' })
```

to:

```typescript
    .insert({ artwork_id: artwork?.id ?? null, status: 'pending', realization })
```

- [ ] **Step 7: Return the strategy in the `generating` response**

Change the final return (line 147) from:

```typescript
  return json({ status: 'generating', job_id: job.id, title, artist, meta })
```

to:

```typescript
  return json({ status: 'generating', job_id: job.id, title, artist, meta, realization })
```

(The demo and no-generator short-circuits intentionally omit `realization` — they have no depth and render flat regardless.)

- [ ] **Step 8: Return the strategy from `job-status`**

In `supabase/functions/job-status/index.ts`, change the `.select(...)` (line 25) to:

```typescript
    .select('id, status, panorama_url, depth_url, error, realization')
```

Then in the returned object (lines 31–39), after `depth_url: data.depth_url ?? null,` add:

```typescript
    realization: data.realization ?? null,
```

- [ ] **Step 9: Verify both functions parse (best-effort)**

Run: `deno check supabase/functions/scan/index.ts supabase/functions/job-status/index.ts`
Expected: no errors. If `deno` is not installed, visually verify the edits against the snippets; these files are type-checked at `supabase functions deploy`.

- [ ] **Step 10: Apply the migration**

Run: `supabase db push`
Expected: `0003_realization.sql` applied; the `realization` column now exists on `artworks` and `jobs`. (If using the hosted dashboard instead, run the SQL from Step 1 in the SQL editor.) Confirm with:

Run: `supabase db push --dry-run` (or re-running `db push`)
Expected: no pending changes / "up to date".

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0003_realization.sql supabase/functions/scan/index.ts supabase/functions/job-status/index.ts
git commit -m "feat: persist + expose realization strategy from scan/job-status"
```

---

### Task 5: Client threads `realization` and applies the flat-figure guard

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/WorldViewer.tsx`

**Interfaces:**
- Consumes: `realization` from the `scan`/`job-status` responses (Task 4); `Realization` type (Task 1).
- Produces: `ScanOutcome.realization`; `WorldViewer` skips the depth bind when it is `'flat'`. Terminal consumer — nothing depends on this task.

- [ ] **Step 1: Add `realization` to `ScanOutcome` and import the type**

In `src/lib/api.ts`, change the import on line 2 from:

```typescript
import type { ArtworkMeta, JobStatusResponse, ScanResponse } from '../../shared/types'
```

to:

```typescript
import type { ArtworkMeta, JobStatusResponse, Realization, ScanResponse } from '../../shared/types'
```

Then in the `ScanOutcome` interface, after `depthUrl?: string` (line 12) add:

```typescript
  /** Render strategy from the router; undefined → use the client default. */
  realization?: Realization
```

- [ ] **Step 2: Thread `realization` through the dev-API paths**

In `scanViaDevApi`, the `ready` return (lines 94–101), after `depthUrl: data.depth_url ?? undefined,` add:

```typescript
      realization: data.realization,
```

And the generating return (lines 113–120), after `depthUrl: job.depth_url ?? undefined,` add:

```typescript
    realization: job.realization ?? data.realization,
```

- [ ] **Step 3: Thread `realization` through the Edge-function paths**

In `scanViaEdge`, the `ready` return (lines 159–166), after `depthUrl: data.depth_url ?? undefined,` add:

```typescript
      realization: data.realization,
```

And the generating return (lines 178–185), after `depthUrl: job.depth_url ?? undefined,` add:

```typescript
    realization: job.realization ?? data.realization,
```

(`demoOutcome` intentionally leaves `realization` undefined.)

- [ ] **Step 4: Carry `realization` through `App.tsx`**

In `src/App.tsx`, change the import on line 10 from:

```typescript
import type { ArtworkMeta } from '../shared/types'
```

to:

```typescript
import type { ArtworkMeta, Realization } from '../shared/types'
```

In the `World` interface (lines 14–18), after `depthUrl?: string` add:

```typescript
  realization?: Realization
```

In `handleAdjustConfirm`, change the `setWorld(...)` call (line 58) from:

```typescript
      setWorld({ url: res.panoramaUrl, depthUrl: res.depthUrl, meta: res.meta })
```

to:

```typescript
      setWorld({
        url: res.panoramaUrl,
        depthUrl: res.depthUrl,
        meta: res.meta,
        realization: res.realization,
      })
```

In the `world` case (lines 107–113), add the prop to `<WorldViewer>` after `depthUrl={world.depthUrl}`:

```typescript
          realization={world.realization}
```

- [ ] **Step 5: Apply the guard in `WorldViewer.tsx`**

In `src/components/WorldViewer.tsx`, change the import on line 11 from:

```typescript
import type { ArtworkMeta, GlossaryTerm, SymbolNote } from '../../shared/types'
```

to:

```typescript
import type { ArtworkMeta, GlossaryTerm, Realization, SymbolNote } from '../../shared/types'
```

In `Props` (lines 15–27), after `depthUrl?: string` add:

```typescript
  /**
   * Render strategy from the router. 'flat' suppresses depth displacement so a
   * prominent figure isn't rubber-sheeted; undefined/'depth' keep today's
   * behavior. ('layered' is Milestone B and also keeps depth for now.)
   */
  realization?: Realization
```

In the component's destructured props (lines 61–67), add `realization` after `depthUrl,`:

```typescript
export function WorldViewer({
  panoramaUrl,
  depthUrl,
  realization,
  meta,
  sourceImage,
  onScanAnother,
}: Props) {
```

Change the depth gate (line 144) from:

```typescript
        if (!depthEnabled) return
```

to:

```typescript
        // Flat-figure guard: when the router chose 'flat' (e.g. a prominent
        // figure), never bind depth — the single connected mesh would smear the
        // silhouette under parallax. Leave the sphere flat.
        if (!depthEnabled || realization === 'flat') return
```

Add `realization` to the effect's dependency array (line 176), changing:

```typescript
  }, [panoramaUrl, depthUrl])
```

to:

```typescript
  }, [panoramaUrl, depthUrl, realization])
```

- [ ] **Step 6: Verify the client type-checks and builds**

Run: `npm run typecheck`
Expected: exits 0, no errors.

Run: `npm run build`
Expected: `tsc --noEmit` passes and `vite build` produces `dist/` with no errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — router + prompt tests (8 tests total) green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api.ts src/App.tsx src/components/WorldViewer.tsx
git commit -m "feat: thread realization to WorldViewer + flat-figure guard"
```

---

## Manual end-to-end verification (after Task 5)

Requires recognition + Blockade keys configured. With `npm run dev`:
1. Scan a **landscape with foreground** (e.g. a Hudson River School view) → world shows depth-parallax (lean/gyro moves near vs far). Server log shows `realization: 'depth'`.
2. Scan a **portrait / single-figure work** (e.g. a Rembrandt) → world renders flat (no melted face under lean). Server log shows `realization: 'flat'`.
3. Scan an **abstract** (e.g. a Rothko) → flat.
4. Re-scan the same artwork → cache hit returns the same `realization` (check the network response / server log).

If a figure scene still smears, confirm the scan response carried `realization: 'flat'` (network tab) and that `WorldViewer` received the prop (the guard is `realization === 'flat'`).

---

## Self-Review

**Spec coverage (`…artwork-3d-realization-design.md`):**
- §4 router signals + decision tree → Task 2 (`route.ts`) + Task 3 (signals from recognition). The plan uses Gemini's `depth_profile` instead of a computed `far_ratio`/`near_ratio` histogram — consistent with the spec's §4 "depth-absent fallback" note; the computed histogram is explicitly a Milestone B refinement.
- §5.1 recognition fields → Task 3 (prompt + schema) + Task 1 (types). `horizon_band` and `dominant_subject_box` are intentionally deferred to Milestone B (not used by the Milestone A router) — YAGNI; `horizon` already exists.
- §5.2 persist the decision → Task 4 (migration + scan + job-status). Per-signal audit *columns* are deferred in favor of a `console.log` of the signals (debuggability without schema bloat), as the spec marked them optional.
- §6 Milestone A behavior (figure-heavy → flat; zero new ML) → Tasks 2 + 5.
- Degrade-to-today invariant → encoded in `routeRealization` (default `'depth'`) and the client guard (only `'flat'` suppresses depth); covered by the "missing signals → depth" test.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Verification steps give exact commands + expected output. Deno-file steps name the `deno check` fallback explicitly rather than hand-waving.

**Type consistency:** `routeRealization` / `RealizationSignals` named identically in Task 2 (def), Task 2 test, and Task 4 (call). `Realization` union identical across `shared/types.ts`, the Deno mirror, `route.ts`, `ScanOutcome`, `World`, and `WorldViewer` Props. Field names `scene_type` / `figure_coverage` / `depth_profile` identical across the prompt, the schema, both type files, and the router call. Enum values for `depth_profile`/`scene_type` match between the schema (Task 3) and the union types (Task 1).

**Out of scope (Milestone B, separate plan):** segmentation + inpainting at ingest, `figure_layer_url`/`bg_inpaint_url`/`layer_manifest`, the Skybox billboard compositor, the `'layered'` strategy branch, and the computed depth histogram.
