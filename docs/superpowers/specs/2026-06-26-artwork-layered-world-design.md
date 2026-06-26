# Artwork `layered` Realization — Extended World + Flat Figure — Design

**Date:** 2026-06-26
**Status:** Approved direction, pre-implementation. **Supersedes** the `object3d` (fal SAM 3D mesh) approach for the single-subject branch (`2026-06-25-artwork-object3d-realization-design.md`); that paid-mesh path is parked as a possible *future optional* upgrade, not built.
**Builds on:** the realization router (`2026-06-25-artwork-3d-realization-design.md`, Milestone A merged). This fills in the **`layered`** strategy slot the enum already reserves.

---

## 1. Problem & chosen approach

A single-subject artwork (portrait, still-life) can't be a 360° skybox — for the Mona Lisa, Blockade builds a stretched dome, and depth displacement warps her. Milestone A's flat-figure guard de-stretches her but leaves a **flat, static** painting. The user wants "extend the world so it's more."

**Approach — layered / extended-world:** keep the figure **flat and rigid** (a foreground cutout — she never warps) and put an **extended, depth-parallaxed world behind her** (immersion). The figure stays the *real painted pixels*; only the world has depth. This plays to Blockade's strength (extending an environment) and avoids its weakness (warping a figure). **Fully free** — Blockade (already integrated) + in-browser segmentation (`@huggingface/transformers`, already bundled for depth). Uses the reserved `layered` enum value (no enum migration).

## 2. Key reconciliation (decision to confirm)

This composites a **real-artwork cutout as a foreground plane in the world**. The user previously rejected a floating real-artwork plane (project memory `artlens-real-artwork-pipeline`: `Skybox.setArtwork`/`featherArtwork`/`ARTWORK_*` were deleted; the world became "purely the Blockade skybox"). That rejection was for a *rectangular whole-painting* plane hung in a generated room. **This design is different in intent**: a *segmented figure* standing in front of the world generated from her own painting, reading as "she's in her world," not "a painting on a wall." **The user has approved revisiting that decision for a segmented figure.** (If this proves to look wrong in the prototype, the off-ramp is the figure-excluded variant rendered without a real cutout — see §6 variant B.)

## 3. Architecture (all free; ingest-cached where possible)

```
recognize → single-subject? → realization = 'layered'
                                      │
      ┌───────────────────────────────┴───────────────────────────────┐
      │ FIGURE                                                          │ WORLD
      │ segment the figure from the rectified artwork                   │ Blockade generates the SURROUNDING environment
      │  → figure_rgba (real painted pixels, transparent bg)            │  (figure-excluded prompt) + depth
      │  (free: RMBG-1.4 / MobileSAM via transformers.js)               │  → panorama_url (world) + depth_url  [columns exist]
      └───────────────────────────────┬───────────────────────────────┘
                                       │ store figure_url (new column)
                                       ▼
  client (realization==='layered'): Skybox depth-world behind  +  figure cutout billboard in front
                                     lean → world parallaxes, figure stays rigid (bounded tilt → no carding)
```

**No hole-inpainting:** the world is generated complete (figure-excluded), so there's nothing behind the cutout to fill. This is the major simplification over the old "tear the figure out of the world" sketch.

### 3.1 Segmentation (the figure)
- Model: **RMBG-1.4** (or MobileSAM) via `@huggingface/transformers` — the same dependency already used for in-browser depth (`src/lib/depth.ts`). Produces an RGBA cutout of the real painted figure.
- Output `figure_rgba` PNG, transparent background, in the artwork's own pixel coordinates (so it composites at the right place).

### 3.2 World (figure-excluded)
- Reuse the Blockade path. Adjust the **scene prompt** for the `layered` case to describe the *environment around the subject with the subject absent* (e.g. "the landscape/setting this portrait opens onto — the subject themselves is not present in this 360° world"), plus figure-excluding negatives ("person, figure, portrait subject in center").
- `init_image`: prefer the **figure-removed background** so Blockade doesn't reproduce a ghost figure. Producing that needs a rough fill of the figure region — but quality is non-critical (Blockade reimagines at low `init_strength`). Two options, chosen in the prototype (§7):
  - **A (clean):** rough background fill (cheap inpaint / surrounding-color fill of the figure mask) → Blockade world has no central figure.
  - **B (simple):** feed the full painting; rely on the prompt+negatives to suppress the figure; the **real cutout masks** whatever central figure remains (cutout sits in front, slightly oversized). Accept minor ghost-peek at lean extremes (bounded tilt limits it).

### 3.3 Composite (render)
- Existing `Skybox` renders the depth-world (unchanged).
- Add a **foreground figure plane**: a camera-facing billboard at a *near* depth, textured with `figure_rgba`, **unlit** (`MeshBasicMaterial`, `SRGBColorSpace`), feathered alpha edge. As the camera leans (bounded), the near figure shifts more than the far world → real parallax pop; the figure itself never deforms. Optional slight depth-bend of the figure plane for a touch of roundness.
- This re-introduces a foreground-plane renderer — a **figure-cutout** plane, deliberately distinct from the rejected whole-painting plane.

## 4. Compute site (live vs pre-seed) — mirrors the depth pipeline's split

- **Pre-seeded / known artworks (Node pre-seed pipeline, milestone-6 pre-seeding):** segment + figure-excluded world computed offline, `figure_url`/`panorama_url`/`depth_url` cached in the DB. View-time is trivial and device-independent.
- **Live scan of an unknown artwork (Supabase Edge, Deno):** Blockade world (figure-excluded prompt) + depth generated server-side as today; the **figure segmentation runs client-side** via transformers.js (WebGPU) at view time and composites — the same server/client posture already used for depth (`depthUrl` server, else in-browser `computeEquirectDepth`). On no-WebGPU devices → **fall back to the Milestone A flat guard** (de-stretched flat painting, no parallax). Never blocks.

## 5. Schema, enum, routing

- **Enum:** `realization='layered'` already exists (shipped in Milestone A's type + `0003` CHECK constraint). **No enum migration.**
- **New column:** `figure_url text` on `artworks` + `jobs` (migration `0004_figure.sql`), nullable, mirroring `0002_depth.sql`. Reuse `panorama_url` (the world) and `depth_url`.
- **Router** (`route.ts`): single dominant subject (`scene_type ∈ {portrait, still-life}` and `figure_coverage ≥ LAYERED_MIN`, ~0.5) → `'layered'` (this replaces the `object3d` branch from the superseded spec). **Degrade ladder:** `layered` → (segmentation or world fails, or no WebGPU on live) `flat` → today's behavior. `layered` never does worse than the flat guard.
- **Response threading:** add `figure_url`/`figureUrl` through `scan` → `job-status` → `api.ts ScanOutcome` → `App` → `WorldViewer` (mirrors `depth_url`). Readiness: a `layered` job is ready when the world (`panorama_url`) is present; `figure_url` may be null on the live path (client segments instead).

## 6. Client renderer

Extend `WorldViewer`/`Skybox` (not a separate viewer — the world IS the existing Skybox; we only add a foreground plane) so that when `realization==='layered'` and a figure (either `figureUrl` or a client-segmented canvas) is available, a foreground figure billboard is added in front of the depth-world. Bounded-tilt parallax already exists in `DeviceOrientationController`; the figure plane rides the same camera offset at a nearer depth. Feathered alpha; unlit; optional depth-bend. FPS watchdog and graceful degradation carry over.

## 7. Prototype / spike first (free)

Before the full build, prototype on 3–5 real artworks (a portrait, a still-life, a multi-figure scene) — **free** (Blockade key + in-browser segmentation):
1. **Figure-excluded world quality:** does Blockade build a coherent figure-free environment (variant A vs B)? Pick A or B.
2. **Segmentation quality:** RMBG/MobileSAM cutout of a *painted* figure — hair/edge halos acceptable?
3. **Composite under bounded tilt:** does the flat figure + parallaxing world read as immersive and *not* cardboard? Calibrate figure depth/placement and `LAYERED_MIN`.
Honest off-ramp: if the composite looks wrong, fall back to shipping just the Milestone A flat guard for single subjects.

## 8. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Figure-cutout plane revives a previously-rejected pattern | Medium (UX/taste) | §2 reconciliation — segmented figure ≠ whole-painting plane; prototype confirms the look; user approved revisiting |
| Segmentation halos on hair/painterly edges | Medium | Feathered alpha + matting pass; RMBG is decent on clear subjects; bounded tilt hides edge artifacts |
| Ghost figure in the generated world (variant B) | Medium | Variant A (figure-removed init_image) or oversized cutout mask; prototype picks |
| Flat figure "cards" under lean | Low–Med | Bounded tilt keeps lean small; optional figure depth-bend |
| Live client segmentation fragile on mobile (iOS Safari/WebGPU) | Medium | Pre-seed caches `figure_url` for known works; live no-WebGPU → flat-guard fallback |
| Figure placement/scale in the world | Low | Center, near depth, scaled to fit; calibrate in prototype |

## 9. Out of scope

- **`object3d` / fal SAM 3D mesh** — superseded here; parked as a *future optional* "true 3D pop-out" upgrade if ever wanted (paid, painterly-fragile). Not built.
- Multi-figure crowds / dense scenes → stay on `depth`/`flat` (segmentation degrades; not single-subject).
- Walk-around / full orbit — excluded by bounded tilt.
- Outpainting the painting's *own* canvas outward (a different "extend" idea) — not this; the world is Blockade's generated environment.
