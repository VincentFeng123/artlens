# Artwork 3D Realization Router — Design

**Date:** 2026-06-25
**Status:** Approved design, pre-implementation
**Scope:** How artlens decides *how* to render an artwork's immersive world — flat skybox, depth-displaced skybox, or layered depth-mesh — so that foreground figures stop warping. Plus the per-artwork router that makes that choice automatically.

---

## 1. Problem

Today the immersive world is an equirectangular Blockade panorama mapped onto an inverted sphere (`src/three/Skybox.ts:31-102`). When a depth map is present, a patched vertex shader radially displaces the **single connected sphere mesh** (`src/three/Skybox.ts:205-242`).

The user observed: *"if the artwork has people in it, it would warp the person (since skybox is a sphere)."* The framing conflates two separate problems; only one is the real defect:

- **Projection warp** — mapping a flat painting onto a sphere bends straight features (pole compression, peripheral curvature). Affects the whole image; already partially handled by pole/seam fade masks (`src/three/Skybox.ts:226-237`).
- **Disocclusion smear under parallax (the real defect)** — because the depth map displaces *one connected mesh*, the mesh cannot tear at a depth discontinuity. At a figure's silhouette, depth jumps from "near figure" to "far background" and the mesh stretches a rubber sheet between them. Leaning the camera smears the figure's edge into the background.

Two consequences that determine the solution:

1. **Switching the projection (sphere → cubemap → plane) fixes nothing.** A flat depth-mesh smears the silhouette identically. The only fix is to **separate the figure into its own render layer** so the surface can tear cleanly.
2. **A full single-image-to-3D model is the wrong tool.** Within bounded tilt it is unnecessary; it also breaks the project's free/no-GPU constraint (paid hosted API, 5–30s latency) and produces a smoothed, hallucinated-back result because painterly input is out-of-distribution. There is no free, no-GPU, in-browser image-to-3D path in 2026 (verified: TripoSR, SF3D, TRELLIS.2, Hunyuan3D, SAM 3D). **Dropped.**

Additional fact reinforcing layer separation: monocular depth models are trained to *flatten flat media*, so a painted figure often gets **less** relief than a photo — the depth-mesh both smears the figure and fails to lift it.

## 2. Decisions locked in brainstorming

- **Movement budget = bounded tilt/lean** (the gyro/cursor cone already shipped). Within this cone a cutout billboard never "cards," so layer separation fully solves the warped-person problem and **full image-to-3D (S5) is dropped entirely.**
- **The world is always the generated Blockade panorama.** Strategies differ only in *how that one panorama is rendered*. This is consistent with the prior decision (project memory `artlens-real-artwork-pipeline`) to reject a floating real-artwork plane in the world — Milestone B operates on the **generated panorama's own pixels**, never a cutout of the real painting.
- **Cutout assets are per-*artwork*, not per-*scan*** — the same painting yields the same world, so segment+inpaint runs **once at artwork-ingest time and caches forever**, exactly like `panorama_url`/`depth_url` already do. This removes the viewer-device WebGPU/iOS-Safari fragility: every device just downloads ready-made layer assets.
- **Phased delivery:** Milestone A (router + flat-figure guard) ships first; Milestone B (layered depth-mesh) follows.

## 3. Realization strategy ladder

The router selects one strategy per artwork. All operate on the generated panorama.

| ID | Strategy | Render | Best for | Cost |
|----|----------|--------|----------|------|
| **S1** | Flat skybox | panorama on sphere, no displacement | abstract / color-field / dense crowds / mostly-far | $0 |
| **S2** | Depth-mesh *(today's default)* | one connected sphere, radially displaced by depth | landscapes, cityscapes, interiors, architectural recession | $0 |
| **S3** | Layered depth-mesh | background sphere (inpainted) + dominant figure as a **separated** near-layer | portraits, single-figure works, a hero subject | $0, computed once at ingest |
| ~~S5~~ | ~~Full image-to-3D~~ | ~~mesh/splat per figure~~ | — | **dropped** (paid, painterly-fragile, breaks constraints) |

**Invariant:** every strategy degrades to S2 then S1. The router can only ever improve on today's single-method behavior, because the default leaf *is* today's method.

## 4. The router

A pure, deterministic, unit-testable function: `supabase/functions/_shared/realization/route.ts`. It runs **server-side in the scan flow, after the panorama + depth map are generated** (Blockade Model-3 returns depth for free, so this wastes no work), using the Gemini recognition fields gathered earlier in the same scan plus a histogram over the freshly generated depth map. It persists its decision; the client renders whatever was persisted.

**Signal availability / sequencing:** `far_ratio` / `near_ratio` require the generated depth map and are therefore only available post-generation. When the depth map is absent (depth generation skipped or failed), the router falls back to Gemini's always-available `depth_profile` field for the far/near reasoning. The figure gate (`figure_coverage`) comes from Gemini and is available regardless, so the flat-figure guard never depends on the depth map.

### 4.1 Signals (all cheap; mostly already paid for)

| Signal | Source | Marginal cost |
|--------|--------|---------------|
| `scene_type` ∈ {landscape, portrait, still-life, interior, abstract} | Gemini recognition call (already made) | ~tokens |
| `figure_coverage` ∈ [0,1], `figure_count`, `dominant_subject_box` | Gemini (it already localizes `artwork_box` + symbolism boxes) | ~tokens |
| `depth_profile` ∈ {mostly-far, far-with-near-foreground, shallow-tabletop, flat}, `horizon_band` | Gemini | ~tokens |
| `far_ratio`, `near_ratio` | histogram over the panorama depth map already computed (`src/lib/depth.ts`, `Skybox.normalizeDepth`) | sub-ms CPU pass |
| `confidence` | Gemini self-report + cross-check agreement | — |

The router is **not a new model.** Tier A is ~6 extra fields on the existing Gemini call; Tier B is a histogram over a depth canvas that already exists. Net new cost ≈ a handful of tokens.

### 4.2 Decision tree

```
INPUT: scene_type, figure_coverage, figure_count,
       far_ratio, near_ratio, depth_profile, confidence,
       layer_assets_available   (Milestone B only)

1. IF scene_type == abstract
      OR (far_ratio > 0.7 AND near_ratio < 0.15):
        -> S1  (flat; depth would invent fake geometry)

2. ELSE IF figure_coverage > 0.35:                 # single/few large figures
        Milestone A:  -> flat (figure-guard): render flat, do NOT displace the figure
        Milestone B:  -> S3 if layer_assets_available else flat (figure-guard)

3. ELSE IF near_ratio > 0.25
      OR depth_profile == far-with-near-foreground:
        -> S2  (depth-mesh; landscape/interior with real foreground)

4. ELSE:
        -> S1  (flat)

GLOBAL FALLBACK: confidence low OR required assets missing
        -> demote S3 -> S2 -> S1
```

Small/peripheral figures (`figure_coverage < 0.1`, e.g. staffage in a landscape) are deliberately left in the S2 depth-mesh — harmless, and not worth separating.

## 5. Data model changes

### 5.1 Recognition result (add routing fields)

Extend the `RecognitionResult` type and the recognition JSON schema/prompt with the six routing fields:

- `shared/types.ts` (client/shared type)
- `supabase/functions/_shared/types.ts` (function-side type)
- `supabase/functions/_shared/prompt.ts` — `RECOGNITION_PROMPT` + `RECOGNITION_JSON_SCHEMA`

Fields: `scene_type`, `figure_coverage`, `figure_count`, `dominant_subject_box` (normalized 0..1), `depth_profile`, `horizon_band`.

### 5.2 Persist the decision

Today recognition metadata is **not** persisted (only `scene_prompt` + `panorama_url`/`depth_url`). This design fixes that gap:

- New migration after `supabase/migrations/0002_depth.sql`.
- On `artworks` (and surfaced through `jobs`): `realization` (enum: `flat` | `depth` | `layered`), plus the routing signals used (for debuggability/auditing). The flat-figure guard maps to `flat`; the routing signals distinguish *why* (figure-guard vs abstract/far) for auditing.
- `supabase/functions/job-status/index.ts` returns `realization`.
- `src/lib/api.ts` `ScanOutcome` carries `realization` through to the client.

### 5.3 Milestone B assets

- Columns: `figure_layer_url`, `bg_inpaint_url`, `layer_manifest` (jsonb: figure equirect placement + layer depth + alpha/feather params).
- Storage prefixes `figure/` and `bg/`, mirroring the existing `pano/` + `depth/` bucket pattern.

## 6. Milestone A — Router + flat-figure guard

**Goal:** stop melted faces immediately, with zero new ML.

**Touchpoints:**
1. Add routing fields to recognition schema/prompt/types (§5.1).
2. `supabase/functions/_shared/realization/route.ts` — the decision tree (§4.2), Milestone-A leaves only (`flat` | `depth`; figure-heavy → `flat`).
3. Wire into the scan flow (`supabase/functions/scan/index.ts`): call `route()` after the panorama + depth are generated and re-hosted (`scan/index.ts:159-232`), persist `realization` (§5.2).
4. `job-status` + `src/lib/api.ts` carry `realization` to the client.
5. `src/components/WorldViewer.tsx` passes `realization` to the Skybox.
6. `src/three/Skybox.ts` gains a `displacement: 'flat' | 'depth'` switch: when `flat`, **skip binding the depth map** (clean flat render) instead of smearing the figure.

**Result:** figure-heavy artworks render clean-flat (no smear); landscapes/interiors keep S2 parallax; abstracts go flat. No new models, no new assets, no new buckets.

## 7. Milestone B — Layered depth-mesh

**Goal:** figures *pop* with real occlusion and parallax, still $0, operating only on the generated panorama.

**Ingest pipeline** — runs in the **pre-seed/ingest path** (Node + `onnxruntime-node`, unbounded CPU/time), **not** the edge function, computed once per artwork and cached:
1. On the generated equirectangular panorama, locate the dominant figure: intersect the depth near-blob with Gemini's `dominant_subject_box` mapped into equirect coordinates.
2. Segment the figure (MobileSAM, ~40MB) → `figure_layer` RGBA with feathered alpha.
3. Inpaint the silhouette-shaped hole behind it in the panorama (LaMa-ONNX) → `bg_inpaint`.
4. Emit `layer_manifest` (equirect placement + layer depth) and store all assets in the bucket.

**Render** (`src/three/Skybox.ts`):
- Background = `bg_inpaint` depth-displaced sphere (S2 as-is).
- Figure = depth-bent plane at its layer depth, composited in front.
- **Cap parallax travel** so the disocclusion hole barely reveals.

**Live path:** artworks not yet enhanced fall back to the Milestone-A flat-figure guard until their cutout is computed. Never blocking.

**Avoid:** full SAM2 (>200MB encoder) — use MobileSAM. No real-artwork cutout (consistent with the prior "no floating plane" decision) — segmentation operates on the *generated panorama's* pixels.

## 8. Error handling & degradation

- Strict ladder on any failure: S3 asset missing/failed → S2 → S1.
- Low router `confidence` → demote.
- The existing FPS watchdog (drops pixel-ratio/parallax/displacement below ~28fps for 2 frames, `Skybox.ts`) is retained.
- No path produces output worse than today's shipped behavior.

## 9. Testing

- **`route.ts` unit tests:** signal fixtures across portrait / landscape / still-life / abstract / interior → assert the chosen strategy. Enforced invariants:
  - `figure_coverage > 0.35` never routes to bare depth-mesh.
  - Low confidence always degrades to a shipping strategy (`flat` or `depth`).
  - Missing Milestone-B assets never select `layered`.
- **Golden artwork set:** a handful of real artworks per category, end-to-end → assert realization choice.
- **Milestone B (manual/visual):** on a portrait, confirm the figure stays crisp under lean (no smear) and inspect the inpaint edge for halos/structure errors.

## 10. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Inpaint quality at the disocclusion edge (B) | Medium — the one real quality risk; error appears exactly where the eye goes under lean | Parallax-travel cap + feathered alpha; only take S3 at high figure-coverage confidence |
| Gemini `figure_coverage` unreliable on stylized art | Medium | Cross-check against depth `near_ratio`; gate conservatively; degrade to S2/S1 |
| Alpha-matting halos on hair/fur/translucent edges (B) | Low–Medium | Feather/matting pass on the mask |
| A 360 world generated from a portrait is inherently odd (what's "around" a portrait?) | Low (pre-existing) | Out of scope; the router at least stops it from *also* being smeared |

## 11. Out of scope

- Full single-image-to-3D / Gaussian splats (S5) — dropped per the bounded-tilt decision; revisit only if the movement budget changes or a free in-browser path appears.
- Redesigning world generation for non-landscape artworks (e.g. what a portrait's 360 surroundings should depict).
- Cubemap/alternate projection — does not address the actual defect.
