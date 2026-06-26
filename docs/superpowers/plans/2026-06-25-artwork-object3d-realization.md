# Artwork `object3d` Realization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single-subject artworks (portraits, still-lifes) render as a real 3D mesh under bounded tilt — generated once per artwork via fal.ai SAM 3D `3d-objects`, validated at ingest, with auto-fallback to the existing depth world if the mesh is unusable.

**Architecture:** A new `object3d` realization strategy. At ingest the server segments+meshes the subject (fal `3d-objects`, textured GLB), re-hosts the GLB, validates its bounding box (rejects collapsed slabs), and persists `mesh_url`; on rejection it falls through to the existing panorama+depth path. The client switches `WorldViewer` to a new `Object3DViewer` (three.js `GLTFLoader`) that renders the mesh **unlit** on a dark plinth with a **clamped front-cone** view so the hallucinated back is never seen.

**Tech Stack:** TypeScript; React + Vite; three.js 0.169 (`GLTFLoader`/`OrbitControls`/`meshopt`/`KTX2Loader` already vendored under `three/examples/jsm/`); Supabase Edge Functions (Deno); Postgres migrations; Vitest; fal.ai SAM 3D (`fal-ai/sam-3/3d-objects`).

**Spec:** `docs/superpowers/specs/2026-06-25-artwork-object3d-realization-design.md` — read it; this plan implements it.

## Global Constraints

- **`object3d` never does worse than today.** If mesh generation fails OR the GLB fails validation, the job falls back to the existing `depth`/`flat` realization and rewrites `jobs.realization` accordingly. The user never sees a broken mesh.
- **Provider = fal.ai `fal-ai/sam-3/3d-objects`** (NOT `3d-body`), behind a pluggable `MeshProvider` (env `MESH_PROVIDER`, default `sam3d`; auth `FAL_KEY`). `3d-objects` bakes observed painted color → keeps the artwork looking like itself.
- **Render unlit.** The mesh is shown with `MeshBasicMaterial` (or the GLB's `KHR_materials_unlit`); never PBR-relight a painting. Stage lighting touches only the pedestal.
- **Bounded tilt, clamped front cone.** Orbit clamped to ≈ ±25° azimuth / 70–100° polar; no full turntable; idle sway ≤ ±15°. This hides the hallucinated back.
- **Per-unique-artwork compute, cached forever** — mesh stored at `mesh/<jobId>.glb` in the existing `panoramas` bucket, `content-type: model/gltf-binary`.
- **Two type files stay in sync verbatim** (type bodies): `shared/types.ts` and `supabase/functions/_shared/types.ts`.
- **Realization enum is exactly** `'flat' | 'depth' | 'layered' | 'object3d'`.
- **fal is a queue API** — submit + poll; never hold a long HTTP connection. fal `model_glb.url` is short-lived → re-host immediately.
- **Deno files** (`supabase/functions/**`) verified with `deno check` (deno 2.8.3 installed); they are not covered by `npm run typecheck` (tsconfig includes only `src`,`shared`). Pure `.ts` with type-only imports is unit-tested via vitest.

---

## Phase 0 — De-risk spike (GATE) — detailed below

The whole feature rests on SAM 3D `3d-objects` producing acceptable meshes from *paintings*. Task 1 proves or disproves that for ~20¢ before any production code, and calibrates two constants the build depends on. **Tasks 2+ are BLOCKED until the Phase-0 gate passes.**

---

### Task 1: Spike — SAM 3D quality on real artworks (GATE)

**Files:**
- Create: `scratch/object3d-spike/run.mjs` (throwaway; `scratch/` is git-ignored — confirm in Step 1)
- Create: `scratch/object3d-spike/view.html` (throwaway local viewer)
- Create: `scratch/object3d-spike/README.md` (records the go/no-go + calibrated constants)

**Interfaces:**
- Produces (for the controller/human, not code): a GO / NO-GO decision; calibrated `SLAB_RATIO` and `OBJECT3D_MIN`; confirmation that `3d-objects` (not `3d-body`) is the right variant. These feed Tasks 4 and 6.

**Prerequisite:** a `FAL_KEY` with billing in the environment (`export FAL_KEY=...`). Without it this task cannot run — STOP and request it.

- [ ] **Step 1: Confirm `scratch/` is ignored, create the spike dir, gather test images**

Run: `git check-ignore scratch/ || echo "NOT IGNORED"`
- If it prints `scratch/`, good. If it prints `NOT IGNORED`, instead create the spike under `/private/tmp/claude-501/.../scratchpad/object3d-spike/` (the session scratchpad) so nothing throwaway is committed. Use that dir everywhere below.

Gather 5–6 test images covering the routing classes, saved as `scratch/object3d-spike/img/*.jpg`:
- a clear portrait (e.g. a photo of a Mona Lisa print) — the driving case
- a single-object still-life
- a full-figure painting
- a landscape (should look bad as a mesh — confirms why it's NOT routed here)
- an abstract (control)

(Use real phone photos or downloaded public-domain images. The point is to see real OOD behavior.)

- [ ] **Step 2: Write the spike runner**

Create `scratch/object3d-spike/run.mjs`:

```javascript
// Throwaway spike: call fal SAM 3D 3d-objects on each ./img/*, download the GLB,
// print bounding-box dimensions + thinness ratio (to calibrate SLAB_RATIO).
// Usage: FAL_KEY=... node scratch/object3d-spike/run.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'

const FAL_KEY = process.env.FAL_KEY
if (!FAL_KEY) { console.error('Set FAL_KEY'); process.exit(1) }
const MODEL = 'fal-ai/sam-3/3d-objects'
const HDRS = { Authorization: `Key ${FAL_KEY}`, 'content-type': 'application/json' }
const DIR = new URL('.', import.meta.url).pathname
const IMG = join(DIR, 'img'), OUT = join(DIR, 'glb')
mkdirSync(OUT, { recursive: true })

const mimeOf = (f) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }[extname(f).toLowerCase()] || 'image/jpeg')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function generate(dataUri, prompt) {
  // fal queue: submit -> poll status -> fetch result
  const submit = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: 'POST', headers: HDRS,
    body: JSON.stringify({ image_url: dataUri, prompt, export_textured_glb: true }),
  })
  if (!submit.ok) throw new Error(`submit ${submit.status}: ${await submit.text()}`)
  const { request_id } = await submit.json()
  const base = `https://queue.fal.run/${MODEL}/requests/${request_id}`
  const started = Date.now()
  while (Date.now() - started < 180_000) {
    await sleep(3000)
    const s = await fetch(`${base}/status`, { headers: HDRS })
    const sj = await s.json()
    if (sj.status === 'COMPLETED') break
    if (sj.status === 'FAILED') throw new Error(`fal FAILED: ${JSON.stringify(sj)}`)
  }
  const r = await fetch(base, { headers: HDRS })
  if (!r.ok) throw new Error(`result ${r.status}: ${await r.text()}`)
  const out = await r.json()
  const url = out?.model_glb?.url
  if (!url) throw new Error(`no model_glb in ${JSON.stringify(out).slice(0, 400)}`)
  return url
}

// Read POSITION accessor min/max from a GLB to get the scene bbox (no geom decode).
function glbBbox(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB')
  let off = 12, json = null
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true)
    const start = off + 8
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + len)))
    off = start + len
  }
  if (!json) throw new Error('no JSON chunk')
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const m of json.meshes ?? [])
    for (const p of m.primitives ?? []) {
      const ai = p.attributes?.POSITION
      if (ai == null) continue
      const acc = json.accessors[ai]
      if (!acc?.min || !acc?.max) continue
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], acc.min[i]); max[i] = Math.max(max[i], acc.max[i]) }
    }
  if (!isFinite(min[0])) return null
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

for (const f of readdirSync(IMG)) {
  if (!['.jpg', '.jpeg', '.png'].includes(extname(f).toLowerCase())) continue
  try {
    const b64 = readFileSync(join(IMG, f)).toString('base64')
    const dataUri = `data:${mimeOf(f)};base64,${b64}`
    console.log(`\n${f}: generating…`)
    const url = await generate(dataUri, 'the main subject')
    const glb = Buffer.from(await (await fetch(url)).arrayBuffer())
    writeFileSync(join(OUT, f + '.glb'), glb)
    const dims = glbBbox(glb)
    if (!dims) { console.log(`  ${f}: NO POSITIONS (empty mesh)`); continue }
    const ratio = Math.min(...dims) / Math.max(...dims)
    console.log(`  ${f}: dims=[${dims.map((d) => d.toFixed(3)).join(', ')}] thinness=${ratio.toFixed(3)} (${glb.length} bytes)`)
  } catch (e) {
    console.log(`  ${f}: ERROR ${e.message}`)
  }
}
console.log('\nDone. Open view.html to eyeball the GLBs in scratch/object3d-spike/glb/.')
```

- [ ] **Step 3: Run the spike**

Run: `FAL_KEY=$FAL_KEY node scratch/object3d-spike/run.mjs`
Expected: per image, a line like `portrait.jpg: dims=[1.02, 1.41, 0.18] thinness=0.128 (842301 bytes)`, and `.glb` files in `scratch/object3d-spike/glb/`. (If `submit`/`status`/`result` URLs 404, adjust to fal's current queue endpoints per https://fal.ai/models/fal-ai/sam-3/3d-objects/api — this is a spike, adapt as needed.)

- [ ] **Step 4: Eyeball the meshes (unlit, clamped) — write `view.html`**

Create `scratch/object3d-spike/view.html`:

```html
<!doctype html><meta charset="utf8"><title>spike viewer</title>
<body style="margin:0;background:#0a0a12;color:#ccc;font:14px system-ui">
<select id="pick"></select>
<div id="app" style="width:100vw;height:90vh"></div>
<script type="importmap">{"imports":{
  "three":"https://unpkg.com/three@0.169.0/build/three.module.js",
  "three/addons/":"https://unpkg.com/three@0.169.0/examples/jsm/"
}}</script>
<script type="module">
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
const app = document.getElementById('app')
const r = new THREE.WebGLRenderer({ antialias: true }); r.outputColorSpace = THREE.SRGBColorSpace
r.setSize(app.clientWidth, app.clientHeight); app.appendChild(r.domElement)
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0a12)
const cam = new THREE.PerspectiveCamera(45, app.clientWidth / app.clientHeight, 0.01, 100)
const ctl = new OrbitControls(cam, r.domElement)
ctl.enablePan = false; ctl.minAzimuthAngle = -Math.PI / 7; ctl.maxAzimuthAngle = Math.PI / 7
ctl.minPolarAngle = Math.PI * 70 / 180; ctl.maxPolarAngle = Math.PI * 100 / 180; ctl.enableDamping = true
let model = null
async function load(name) {
  if (model) scene.remove(model)
  const gltf = await new GLTFLoader().loadAsync('glb/' + name)
  model = gltf.scene
  model.traverse((o) => { if (o.isMesh) { const m = o.material; o.material = new THREE.MeshBasicMaterial({ map: m.map ?? null, vertexColors: !m.map, color: m.map ? 0xffffff : (m.color ?? 0xffffff) }); if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace } })
  const box = new THREE.Box3().setFromObject(model); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3())
  model.position.sub(c); scene.add(model)
  cam.position.set(0, 0, Math.max(s.x, s.y, s.z) * 2.2); ctl.target.set(0, 0, 0); ctl.update()
}
const files = await (await fetch('glb/')).text().catch(() => '')
const pick = document.getElementById('pick')
// If directory listing isn't available, hardcode your filenames here:
;(files.match(/href="([^"]+\.glb)"/g) || []).map((m) => m.slice(6, -1)).forEach((f) => pick.add(new Option(f, f)))
pick.onchange = () => load(pick.value); if (pick.options.length) load(pick.value)
;(function loop(){ requestAnimationFrame(loop); ctl.update(); r.render(scene, cam) })()
</script>
```

Run: `cd scratch/object3d-spike && python3 -m http.server 8099`
Then open `http://localhost:8099/view.html`. (If the dir listing doesn't populate the dropdown, hardcode the `.glb` filenames where the comment says.)

- [ ] **Step 5: GATE — record the decision (no commit; this is the human checkpoint)**

Look at each mesh under the clamped front cone. Write `scratch/object3d-spike/README.md` capturing:
- **GO / NO-GO:** does the portrait & still-life look acceptable as a leaned-into object (recognizably the artwork, not a melted blob)? If uniformly bad → **NO-GO**: stop, report to the human, reconsider (e.g. fall back to the diorama approach or drop the feature). This is the honest off-ramp.
- **`SLAB_RATIO`:** the thinness value that best separates "collapsed slab / bad" from "acceptable volume" across your samples (e.g. portraits that looked fine were ≥ 0.12; landscapes that collapsed were ≤ 0.05 → pick ~0.08). Record the per-image numbers you saw.
- **`OBJECT3D_MIN`:** based on which artworks *should* have routed to object3d, the `figure_coverage` threshold (default 0.5 unless the samples argue otherwise).
- **Variant confirmation:** `3d-objects` baked-color result looked like the painting (vs. a faceless `3d-body` mannequin) — confirm `3d-objects` is right.

**Do not commit the spike.** Report the GATE result to the controller/human. On GO, the controller writes the Phase-1 detailed plan (Tasks 2+) using the calibrated constants. On NO-GO, stop.

---

## Phase 1 — Build (task map; detailed steps authored AFTER the Phase-0 gate)

> These tasks are intentionally specified at the file/interface level only. Their per-step code depends on the spike's calibrated constants (`SLAB_RATIO`, `OBJECT3D_MIN`) and its confirmation of mesh quality/variant. The controller runs `writing-plans` a second time after the gate to expand each into bite-sized TDD steps with complete code. Listing them here locks the decomposition and interfaces.

**Task 2 — Types, enum, response `mesh_url`, `subject_prompt` field.**
Files: `shared/types.ts`, `supabase/functions/_shared/types.ts`.
Add `'object3d'` to `Realization` (both mirrors). Add `mesh_url?: string | null` to `ScanReadyResponse` + `JobStatusResponse` (NOT `ScanGeneratingResponse`). Add `subject_prompt?: string` to `RecognitionResult` (both mirrors). Gate: `npm run typecheck` + `deno check`.

**Task 3 — Recognition emits `subject_prompt`.**
Files: `supabase/functions/_shared/prompt.ts` (JSON shape + closing guidance), `supabase/functions/_shared/recognition/index.ts` (`RECOGNITION_JSON_SCHEMA` properties + required), `supabase/functions/_shared/prompt.test.ts` (assert the prompt advertises `subject_prompt`). TDD. Mirrors Milestone A Task 3.

**Task 4 — `validateGlb()` pure function + unit tests.**
Files: Create `supabase/functions/_shared/mesh/validateGlb.ts`; Test `supabase/functions/_shared/mesh/validateGlb.test.ts`.
Signature: `validateGlb(bytes: Uint8Array, slabRatio: number): { ok: boolean; reason?: string }`. Parses the GLB header + JSON chunk, unions every `POSITION` accessor `min`/`max` into a bbox, computes `min(dims)/max(dims)`; rejects when no positions / degenerate / ratio < `slabRatio`. Use the calibrated `SLAB_RATIO` as the default constant. TDD: build GLB byte fixtures for a healthy cube (accept) and a thin slab (reject) and garbage (reject). (The spike's `glbBbox` is the reference parser.)

**Task 5 — `MeshProvider` interface + SAM 3D adapter + contract test.**
Files: Create `supabase/functions/_shared/mesh/index.ts` (interface + `selected()`/`getMeshProvider()`/`hasMeshProvider()` mirroring `panorama/index.ts`), `supabase/functions/_shared/mesh/sam3d.ts` (fal queue submit+poll, `{ image_url, prompt, export_textured_glb:true }` → `model_glb.url`), `supabase/functions/_shared/mesh/sam3d.test.ts` (mocked `fetch`: assert request shape + auth header + returned url; empty-prompt → scene_type default).
Interface: `MeshInput { referenceImage; subjectPrompt }`, `MeshResult { meshUrl }`, `MeshProvider.generate`. `hasMeshProvider()` gates on `FAL_KEY`.

**Task 6 — Router: `object3d` branch + tests.**
Files: `supabase/functions/_shared/realization/route.ts`, `route.test.ts`.
Add `OBJECT3D_MIN` (calibrated) and the first-check branch: `scene_type ∈ {portrait, still-life}` and `figure_coverage ≥ OBJECT3D_MIN` → `'object3d'`; existing flat/depth logic unchanged below. Tests: portrait/still-life ≥ threshold → object3d; below → existing; all Milestone-A invariants still hold (figure-guard, abstract→flat, unknown→depth).

**Task 7 — Migration + scan ingest (mesh gen, validate, fallback, persist) + job-status.**
Files: Create `supabase/migrations/0004_mesh.sql` (add `mesh_url`; widen the realization CHECK to include `object3d` via `drop constraint if exists artworks_realization_check`/`jobs_realization_check` + re-add — confirm the auto-names with `\d artworks` first). `supabase/functions/scan/index.ts`: import `getMeshProvider`/`hasMeshProvider`/`validateGlb`; in `runGeneration`, when `realization==='object3d'` and `hasMeshProvider()`, call the mesh provider, re-host GLB to `mesh/${jobId}.glb` (`model/gltf-binary`), `validateGlb`; on pass → persist `mesh_url` + keep realization; on fail/error → recompute the non-object3d route and fall through to the existing panorama+depth generation, updating `jobs.realization`. Add `mesh_url` to the cache-hit `.select` + ready response. `supabase/functions/job-status/index.ts`: add `mesh_url` to `.select` + return. Gate: `deno check` + `npm test` unaffected. (Controller applies `0004` to the live DB as a deliberate step, like `0003`.)

**Task 8 — Client threading + readiness check.**
Files: `src/lib/api.ts` (`ScanOutcome.meshUrl`; thread on all real paths; **fix the readiness check to accept `panorama_url || mesh_url`** — today it throws "Generation finished without a panorama"), `src/App.tsx` (`World.meshUrl`, pass prop), `src/components/WorldViewer.tsx` (`meshUrl` prop + branch on `realization==='object3d'`). Gate: `npm run typecheck` + `npm run build` + `npm test`.

**Task 9 — `Object3DViewer` (GLTFLoader, unlit, clamped, auto-fit, stage, load-fail fallback).**
Files: Create `src/three/Object3DViewer.ts`; wire it in `WorldViewer.tsx`'s `object3d` branch.
`GLTFLoader` (+ `setMeshoptDecoder`, `setKTX2Loader`), force `MeshBasicMaterial`/unlit + `SRGBColorSpace`, `Box3` auto-fit camera, `OrbitControls` clamped to the front cone (±π/7 azimuth, 70–100° polar, no pan/zoom, damping), idle ±10–15° sway, reuse `DeviceOrientationController` for gyro-lean (single driver), dark vignette + `ContactShadows` plinth, FPS-watchdog pattern from `Skybox`. On GLB load error → set the same `failed` path WorldViewer already has (which offers "scan another"); ideally signal a depth/flat fallback if a panorama exists. Gate: `npm run build` + manual visual.

**Task 10 — Dev-API parity.**
Files: `dev-api/providers.ts` (`runScan`: when the chosen realization is `object3d` and `FAL_KEY` present, call the mesh path → return `{ status:'ready', mesh_url, realization:'object3d', … }`; note dev `runScan` currently returns synchronously and the plugin wraps it), `dev-api/plugin.ts` (`JobRecord` gains `mesh_url`/`realization`; `/api/job-status` returns them). Gate: local `npm run dev` scan of a portrait yields an object3d job.

**Task 11 — Env + docs.**
Files: `.env.example` (add `MESH_PROVIDER=sam3d` + `FAL_KEY=` near the panorama-provider block, with comments), `README`/env-reference if present. No code.

---

## Self-Review

**1. Spec coverage (Phase 0 + task map):**
- §3 verified API contract → Task 1 spike (real call) + Task 5 (adapter).
- §4.1 MeshProvider → Task 5. §4.2 subject_prompt → Tasks 2+3. §4.3 schema → Task 7. §4.4 enum/threading + the null-panorama readiness trap → Tasks 2 + 8. §4.5 Object3DViewer → Task 9.
- §5 routing → Task 6. §6 validation gate → Task 4 (pure) + Task 7 (wired + fallback). §7 env → Task 11. §8 dev parity → Task 10. §9 testing → folded into each task's TDD. §10 Phase-0 spike → Task 1. §11 risks → mitigations land in Tasks 1 (quality), 4/7 (validate+fallback), 9 (clamp).
- No spec section is unmapped.

**2. Placeholder scan:** Phase 0 (the runnable part) contains complete code, exact commands, and expected output. Phase 1 is deliberately a task map, explicitly deferred to a post-gate `writing-plans` pass — this is scope decomposition (like Milestone A→B), not an in-task "TODO". The gate genuinely blocks meaningful step-code (constants are spike outputs).

**3. Type consistency:** Names used consistently across tasks — `Realization`+`'object3d'`, `mesh_url`/`meshUrl`, `subject_prompt`/`subjectPrompt`, `MeshProvider`/`MeshInput`/`MeshResult`/`getMeshProvider`/`hasMeshProvider`, `validateGlb(bytes, slabRatio)`, `OBJECT3D_MIN`, `SLAB_RATIO`. The readiness-check fix (`panorama_url || mesh_url`) and the null-`panorama_url` object3d path are called out in both the spec and Task 8.

**Note for the controller:** after the Phase-0 GO, run `writing-plans` again to expand Tasks 2–11 into bite-sized TDD steps with complete code, using the spike's calibrated `SLAB_RATIO`/`OBJECT3D_MIN`. Then execute via subagent-driven-development.
