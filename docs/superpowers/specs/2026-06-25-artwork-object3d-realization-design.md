# Artwork `object3d` Realization — Design

**Date:** 2026-06-25
**Status:** Approved design, pre-implementation
**Builds on:** `2026-06-25-artwork-3d-realization-design.md` (the realization router; Milestone A merged). This adds a **fourth** realization strategy, `object3d`.

---

## 1. Problem

For a **single-subject** artwork — a portrait (the Mona Lisa), a still-life, a single object — turning it into a 360° skybox is wrong on two counts: (a) depth displacement rubber-sheets the figure (the Milestone-A defect), and (b) more fundamentally, *there is no coherent 360° world "around" a portrait* — Blockade invents a smeared dome. Milestone A's fix routes such artworks to a flat plane, which de-stretches them but still presents "a painting inside a dome." The user's actual want: **see the subject as a 3D object you can lean around**, not a skybox.

## 2. Decisions locked (brainstorming)

- **Real generated 3D mesh**, not a 2.5D diorama. The user accepts the tradeoffs after the caveats.
- **Bounded tilt/lean** (consistent with the existing immersion target). This is load-bearing: a clamped front-cone view means the **hallucinated back of the mesh is never seen**, which is what makes single-image-to-3D viable here.
- **Per-unique-artwork compute, cached forever** — like `panorama_url`/`depth_url`. The Mona Lisa is meshed once (~$0.02), ever, across all users.
- **Provider: fal.ai SAM 3D, `3d-objects` variant**, behind a pluggable `MeshProvider` (Hunyuan3D / TripoSR swappable by env). Rationale: `3d-objects` **bakes the observed painted color onto the mesh**, so it still looks like the artwork; `3d-body` would return a generic posed mannequin with no face identity — wrong for a portrait.
- **Quality gate → fall back to the depth world.** Validate the generated GLB at ingest; if it's a collapsed slab / unusable, silently fall back to the existing depth-parallax realization (the real painting, bounded tilt). The user never sees a broken mesh. **`object3d` never does worse than today.**
- **Unlit rendering** (`MeshBasicMaterial`): the painting already contains the artist's light and shadow; never PBR-relight it.

## 3. Verified external facts (fal.ai SAM 3D, live as of 2026)

- Endpoint `fal-ai/sam-3/3d-objects`. Auth: `Authorization: Key ${FAL_KEY}`. **Queue API** — submit + poll (or webhook); never hold a 30s+ HTTP connection.
- Input: `image_url` accepts a public https URL **or a `data:image/...;base64,` data-URI** (so the rectified artwork goes straight in). **Must pass a steering `prompt`** — its default prompt is literally `"car"`. Set `export_textured_glb: true` (baked texture beats vertex colors for a painting).
- Output: `model_glb` = `{ url, content_type, file_name, file_size }`. The fal CDN URL is **short-lived → re-host immediately**.
- Cost **$0.02/run flat**, latency **~20–40s** (cold-start spikes possible). Commercial use permitted, no watermark.
- glTF **`KHR_materials_unlit`** maps directly to three.js `MeshBasicMaterial`. A GLB POSITION accessor carries `min`/`max` arrays → the bounding box is readable from the GLB JSON chunk **without decoding geometry** (this powers the cheap server-side validation gate, §6).

## 4. Architecture

All compute is at **ingest** (the existing background `runGeneration()` in `supabase/functions/scan/index.ts:159-233`), mirroring the panorama/depth flow.

```
recognize → routeRealization → realization='object3d' persisted → job created
                                          │
                runGeneration(): realization==='object3d'?
                                          │ yes
                 getMeshProvider().generate({ referenceImage, prompt: subject_prompt })
                                          │
                 re-host model_glb → panoramas bucket: mesh/<jobId>.glb (model/gltf-binary)
                                          │
                 validateGlb(bytes): bbox thinness / present?  ──bad/error──┐
                                          │ ok                               │
                 jobs/artworks.update({ mesh_url, realization:'object3d' })  │
                                          │                                  │
                                          │            FALLBACK: re-run route w/o object3d
                                          │            → generate panorama+depth as today,
                                          │              jobs.realization := 'depth'|'flat'
                                          ▼                                  ▼
                 client: WorldViewer → realization==='object3d'? Object3DViewer(meshUrl)
                                                              else Skybox(panoramaUrl,…)
```

**Success path cost = one mesh call.** Failure path falls through to the existing panorama generation (mesh + Blockade), only when the mesh is unusable.

### 4.1 `MeshProvider` interface (mirror of `PanoramaProvider`)

New `supabase/functions/_shared/mesh/index.ts`, structured exactly like `panorama/index.ts:4-46` (same `selected()` env switch + `hasMeshProvider()` key guard):

```typescript
export interface MeshInput {
  referenceImage: string   // public URL or data: base64 (the rectified artwork)
  subjectPrompt: string    // steering noun for 3d-objects, e.g. "woman", "vase of flowers"
}
export interface MeshResult { meshUrl: string }   // GLB URL (provider CDN, short-lived)
export interface MeshProvider { generate(input: MeshInput): Promise<MeshResult> }

function selected(): 'sam3d' | 'hunyuan' | 'triposr' {
  return (Deno.env.get('MESH_PROVIDER') ?? 'sam3d').toLowerCase() as 'sam3d' | 'hunyuan' | 'triposr'
}
export function getMeshProvider(): MeshProvider { /* switch → generateWithSam3d, … */ }
export function hasMeshProvider(): boolean { return Boolean(Deno.env.get('FAL_KEY')) }
```

**SAM 3D adapter** `mesh/sam3d.ts`: POST to the fal queue endpoint with `{ image_url: referenceImage, prompt: subjectPrompt, export_textured_glb: true }`, poll status to completion, return `model_glb.url`. Mirrors the Blockade adapter's create+poll shape (`panorama/blockade.ts`). If `subjectPrompt` is empty (recognizer didn't emit one), the caller supplies a `scene_type` default — `"person"` for `portrait`, `"object"` for `still-life` — so the prompt is never blank (a blank prompt makes 3d-objects build a *car*).

### 4.2 Recognition addition

`object3d` steering needs a short subject noun. Add one field to the existing Gemini recognition call (cheap, the Milestone-A pattern):

- `subject_prompt: string` — the dominant subject as a 1–3 word noun phrase for 3D steering (e.g. `"woman"`, `"human skull"`, `"vase of flowers"`). Empty for non-single-subject works.

Add to `RecognitionResult` (both type mirrors), the prompt's JSON shape + closing guidance (`_shared/prompt.ts`), and `RECOGNITION_JSON_SCHEMA` (properties + required) — same three-file touch as Milestone A Task 3.

### 4.3 Schema

New `supabase/migrations/0004_mesh.sql`:

```sql
-- GLB mesh URL for the object3d realization strategy. Nullable; older rows and
-- non-object3d paths omit it (mirrors 0002_depth.sql).
alter table public.artworks add column if not exists mesh_url text;
alter table public.jobs     add column if not exists mesh_url text;

-- Widen the realization CHECK to admit 'object3d' (0003 allowed flat|depth|layered).
alter table public.artworks drop constraint if exists artworks_realization_check;
alter table public.artworks add  constraint artworks_realization_check
  check (realization is null or realization in ('flat','depth','layered','object3d'));
alter table public.jobs drop constraint if exists jobs_realization_check;
alter table public.jobs add  constraint jobs_realization_check
  check (realization is null or realization in ('flat','depth','layered','object3d'));
```

(Note: the actual constraint names from `0003` must be confirmed during implementation; `drop constraint if exists` is safe regardless.)

### 4.4 Enum + response threading

- Add `'object3d'` to `Realization` in **both** `shared/types.ts` and `supabase/functions/_shared/types.ts`.
- Add `mesh_url` to `ScanReadyResponse` (cache-hit path) and `JobStatusResponse` (poll path); to the `.select(...)` in `scan/index.ts` (cache lookup) and `job-status/index.ts`; to the `.update(...)` on the object3d success path. **Not** on `ScanGeneratingResponse` — the mesh isn't ready at scan time; it arrives via the poll, exactly like `panorama_url`. The final `realization` (possibly rewritten to the fallback during generation) also arrives via the poll, and `api.ts` already prefers `job.realization ?? data.realization`, so a fallback rewrite is handled for free.
- Thread `mesh_url` → `api.ts ScanOutcome.meshUrl` → `App.tsx World.meshUrl` → `WorldViewer` prop (mirrors how `realization`/`depth_url` already thread).
- **Readiness check must admit a mesh-only job.** `api.ts` currently treats a completed job as failed unless `job.panorama_url` is set (`scanViaEdge`/`scanViaDevApi` throw `"Generation finished without a panorama"`). On the `object3d` success path `panorama_url` is **null** and `mesh_url` carries the asset. Update the check to: ready when `status==='ready'` **and** (`panorama_url` **or** `mesh_url`). `ScanOutcome.panoramaUrl` may then be empty for object3d; `WorldViewer` keys off `meshUrl` on that branch and never reads `panoramaUrl`.

### 4.5 Client renderer

`WorldViewer.tsx` `useEffect` (currently constructs `Skybox` at `:108-176`) branches: `realization === 'object3d'` → new `src/three/Object3DViewer.ts`; else the existing `Skybox` path unchanged. Effect deps add `meshUrl`.

`src/three/Object3DViewer.ts` (reuses `DeviceOrientationController` + `Atmosphere` for consistency):
- **Load** the GLB via three.js `GLTFLoader` (wire `setMeshoptDecoder` + `setKTX2Loader` for compressed assets).
- **Unlit:** force every material to `MeshBasicMaterial` with `map = baseColor`, `texture.colorSpace = SRGBColorSpace`; strip normal/rough/metallic. (If the GLB already declares `KHR_materials_unlit`, three.js does this for us.)
- **Auto-fit camera:** `new THREE.Box3().setFromObject(model)`, center it, derive camera distance from bbox size + fov. Never hardcode distance.
- **Bounded view (hide the back):** `OrbitControls` clamped to a front cone — `minAzimuthAngle/maxAzimuthAngle ≈ ±π/7 (±25°)`, `min/maxPolarAngle ≈ 70°–100°`, `enablePan=false`, `enableZoom=false`, `enableDamping=true`. **No `autoRotate`** — idle motion is a gentle ±10–15° sway. Gyro-lean feeds `beta/gamma` into a *clamped offset inside the same cone*; drive ONE source (lerp controls toward the gyro target — don't let gyro and OrbitControls fight). iOS needs `DeviceOrientationEvent.requestPermission()` from a gesture; touch-drag is the fallback.
- **Stage:** dark radial-gradient vignette, soft `ContactShadows` plinth under the mesh, faint floor reflection; optionally dim the mesh near the clamp edges to mask the seam. Stage lighting touches only the pedestal — never the unlit artwork.
- **Mobile budget:** GLB < 3–5 MB, ~30–80k tris, KTX2/UASTC texture ≤ 2048px, `pixelRatio = min(dpr, 2)`, no shadow maps (unlit). The existing FPS watchdog pattern from `Skybox` should be carried over.

## 5. Routing

`object3d` is the **single-dominant-subject** path and becomes the FIRST check in `routeRealization()` (`route.ts`), ahead of the figure guard. `SceneType` already includes `'portrait'` and `'still-life'` (added in Milestone A), so the signal exists:

```typescript
const OBJECT3D_MIN = 0.5   // calibrate on real scans

export function routeRealization(s: RealizationSignals): Realization {
  // Single dominant subject (portrait / still-life) → real mesh under bounded tilt.
  if (s.scene_type === 'portrait' || s.scene_type === 'still-life') {
    if ((s.figure_coverage ?? 0) >= OBJECT3D_MIN) return 'object3d'
  }
  if ((s.figure_coverage ?? 0) > FIGURE_GUARD) return 'flat'   // existing 0.35 guard
  if (s.scene_type === 'abstract') return 'flat'
  if (s.depth_profile === 'flat' || s.depth_profile === 'mostly-far') return 'flat'
  return 'depth'
}
```

`object3d` rescues exactly the bucket Milestone A had to send to flat (`figure_coverage > 0.35` → a single figure it couldn't safely displace). Multi-figure crowds and landscapes stay on flat/depth. **Degrade ladder:** `object3d` → (mesh fails/invalid at ingest) `depth`|`flat` → `flat`. `object3d` is only ever *chosen*; whether it's *delivered* depends on the ingest validation gate (§6), and the persisted `jobs.realization` is rewritten to the fallback when the mesh is rejected, so the client always renders what actually exists.

## 6. Validation gate (the "never show a broken mesh" guarantee)

At ingest, after re-hosting the GLB, run `validateGlb(bytes): boolean` — a pure function over the GLB bytes:
- Parse the GLB container (12-byte header + JSON chunk); read every mesh-primitive `POSITION` accessor's `min`/`max` → scene bounding box. **No geometry decode needed** — glTF mandates min/max on POSITION accessors.
- **Reject** if: no meshes/positions; degenerate bbox; or **thinness** — `depth / max(width, height) < SLAB_RATIO` (start `SLAB_RATIO ≈ 0.15`; calibrate). A collapsed bas-relief slab is the canonical painterly failure and is exactly what this catches.
- Reject on any provider error/timeout too.

On reject → fall through to the existing panorama+depth generation in the same job and set `jobs.realization` to the recomputed fallback. The front-cone clamp (§4.5) is the final safety net for a marginal-but-accepted mesh.

`validateGlb` is pure and unit-testable with crafted GLB byte fixtures (thin slab vs. cube).

## 7. Provider config (env)

- `MESH_PROVIDER` (default `sam3d`) — selects the adapter.
- `FAL_KEY` — fal.ai auth; `hasMeshProvider()` gates on it. With no key, `object3d` is never delivered (router still may *choose* it, but ingest falls straight to the depth path) — graceful, like the existing `hasPanoramaProvider()` demo fallback.
- Add all to `.env.example` with comments.

## 8. Dev-path parity

`dev-api/plugin.ts` (`JobRecord`) and `dev-api/providers.ts` (`runScan()`) must learn the mesh branch (or a stub) so local `npm run dev` testing of `object3d` works, mirroring how they handle the panorama path today.

## 9. Testing

- **`route.ts` unit tests** (extend Milestone A's): portrait/still-life with coverage ≥ 0.5 → `object3d`; below → existing behavior; the figure-guard and degrade invariants still hold; unknown signals still → `depth`.
- **`validateGlb` unit tests**: thin-slab GLB fixture → reject; healthy-bbox GLB → accept; empty/garbage → reject.
- **MeshProvider adapter**: a contract test with a mocked `fetch` (assert request shape — endpoint, `prompt`, `export_textured_glb`, auth header — and that `model_glb.url` is returned). No live network in CI.
- **Manual/visual**: scan the Mona Lisa → a textured 3D object on a plinth, lean within the cone, back never visible, looks like the painting; scan a landscape → unchanged depth world; force a mesh failure → silently lands in the depth world.

## 10. Phase 0 — de-risk spike (do this FIRST)

Before building the full integration, a throwaway script calls `fal-ai/sam-3/3d-objects` on **5–10 real artwork photos** (a portrait, a still-life, a landscape-with-figure, an abstract) and we eyeball the GLBs in a three.js viewer. Goal: confirm the quality is acceptable for the target artworks and **calibrate `SLAB_RATIO` and `OBJECT3D_MIN`** against reality. The whole feature rests on painterly-input quality being good enough; this spike answers it for ~20¢ before any production code. If the spike shows the meshes are uniformly bad, we stop and reconsider (the honest off-ramp) rather than build a pipeline around a bad result.

## 11. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Painterly input is OOD — meshes collapse to bas-relief / smeared back** | **Highest — the core bet** | Phase-0 spike to confirm quality; unlit baked texture; front-cone clamp hides the back; `validateGlb` rejects slabs → depth fallback. Honest off-ramp if the spike fails. |
| fal latency/cold-start vs client poll cap (300s, `api.ts:7`) | Medium | Async submit+poll on the server; never hold the connection; idempotent retry. |
| `OBJECT3D_MIN` / `SLAB_RATIO` miscalibrated → fires on wrong art or over-rejects | Medium | Calibrate in Phase 0; conservative defaults; degrade ladder absorbs misfires. |
| GLB content-type/CORS for `GLTFLoader` | Low | Re-host as `model/gltf-binary` in the already-CORS-permissive `panoramas` bucket. |
| Dev-path parity missed | Low | Explicit task (§8). |
| Mobile perf (poly/texture/thermal) | Low–Medium | gltf-transform (weld/simplify/KTX2/meshopt) at re-host; budgets in §4.5; FPS watchdog. |

## 12. Out of scope

- `3d-body` variant and per-subject routing between body/objects (user chose `3d-objects` primary; the `MeshProvider` keeps it swappable later).
- Gaussian-splat rendering (the `.ply` output) — GLB only for now.
- `dominant_subject_box`-steered segmentation (we steer with the text `subject_prompt`; box steering is a future precision upgrade).
- Walk-around / full-orbit 3D (excluded by the bounded-tilt decision).
- Milestone B (the layered cutout-on-skybox for *multi-element* scenes) — still its own future track; `object3d` is for single dominant subjects.
