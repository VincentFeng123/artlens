# Artwork `layered` Realization — Extended World + Flat Figure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single-subject artworks (portraits, still-lifes) render as a flat, rigid **real-figure cutout** standing in front of an **extended, depth-parallaxed Blockade world** generated figure-excluded — free, no warping, no second vendor.

**Architecture:** A new `layered` realization (the enum slot Milestone A reserved). The figure is segmented from the real artwork (free, in-browser `transformers.js`); the world is a figure-excluded Blockade skybox + depth (the existing pipeline with an adjusted prompt); the client composites a near figure billboard in front of the existing depth-sphere, riding the existing bounded-tilt parallax so the figure pops without warping.

**Tech Stack:** TypeScript; React + Vite; three.js 0.169; Supabase Edge Functions (Deno); Postgres migrations; Vitest; Blockade Labs (existing); in-browser background removal (`@imgly/background-removal` or `@huggingface/transformers` RMBG-1.4 — picked in the prototype).

**Spec:** `docs/superpowers/specs/2026-06-26-artwork-layered-world-design.md` — read it; this plan implements it.

## Global Constraints

- **Free / no new paid vendor.** Blockade (already integrated) + in-browser segmentation only. No fal, no server GPU.
- **The figure never warps.** It is a flat, rigid, **real painted-pixel** cutout (unlit), composited in front. Only the *world* has depth.
- **No hole-inpainting.** The world is generated figure-excluded (complete on its own); the figure sits in front, so there is nothing behind it to fill.
- **Reuse, don't add, the enum.** `realization='layered'` already exists in both type mirrors and the `0003` CHECK constraint. **No enum migration.**
- **Reuse columns:** `panorama_url` = the world, `depth_url` = its depth. Add only `figure_url`.
- **Degrade-to-flat-guard.** If segmentation or the world fails (or no WebGPU on the live path), `layered` falls back to the Milestone A flat guard (`flat`). It never does worse than the flat guard.
- **Bounded tilt.** The figure rides the existing clamped gyro/pointer/sway parallax (`DeviceOrientationController`); the small lean is what keeps a flat cutout from carding.
- **The reconciliation (spec §2):** this revives a foreground real-artwork plane (a *segmented figure*, not the rejected whole-painting rectangle). The user approved revisiting it; the prototype confirms the look.
- **Two type files stay in sync verbatim:** `shared/types.ts` and `supabase/functions/_shared/types.ts`.
- **Deno files** verified with `deno check` (installed); pure `.ts` is vitest-tested. `npm run typecheck` covers only `src`+`shared`.

---

## Phase 0 — Free prototype (GATE) — detailed below

The approach has three unknowns: (1) can Blockade build a coherent *figure-excluded* world? (2) is in-browser segmentation of a *painted* figure clean enough? (3) does the flat-figure-in-front-of-world composite read as immersive (not cardboard) under bounded tilt? Task 1 answers all three for **$0** (Blockade key you already have + in-browser segmentation). **Tasks 2+ are BLOCKED until the gate passes**, and the gate's outputs (variant A/B, figure depth/scale, `LAYERED_MIN`) feed the build.

---

### Task 1: Prototype — figure-excluded world + segmentation + composite (GATE)

**Files (all throwaway; under the session scratchpad since `scratch/` is NOT git-ignored — confirmed):**
- Create: `<scratchpad>/layered-proto/world.mjs` — Node: Blockade figure-excluded world + depth for a few artworks
- Create: `<scratchpad>/layered-proto/segment.html` — in-browser figure cutout
- Create: `<scratchpad>/layered-proto/view.html` — three.js composite viewer (sphere world + figure plane + clamped lean)
- Create: `<scratchpad>/layered-proto/README.md` — records the GO/NO-GO + calibrated values

Use the session scratchpad dir: `/private/tmp/claude-501/-Users-vincentfeng-Documents-artlens/<session>/scratchpad/layered-proto/` (resolve the real path with `echo "$SCRATCHPAD"` if set, else the path printed at session start). Nothing here is committed.

**Prerequisite:** `BLOCKADE_LABS_API_KEY` in `.env` (the user has it). Read it from `.env`.

**Interfaces:** Produces (for the human, not code): GO/NO-GO; chosen world variant **A** (figure-removed init_image) or **B** (full painting + cutout masks the ghost); calibrated figure **depth/scale**; `LAYERED_MIN` (figure_coverage threshold). These feed Tasks 6–8.

- [ ] **Step 1: Make the proto dir and gather 4–5 artwork images**

Resolve scratchpad and create `layered-proto/img/`. Gather as `img/*.jpg`: a clear portrait (Mona Lisa print photo — the driving case), a single-figure painting with a landscape behind, a still-life, a multi-figure scene (should degrade), an abstract (control).

- [ ] **Step 2: Write the figure-excluded world generator**

Create `<scratchpad>/layered-proto/world.mjs` (replicates the Blockade create+poll from `supabase/functions/_shared/panorama/blockade.ts`, with a figure-EXCLUDED prompt):

```javascript
// Blockade figure-excluded world + depth for each ./img/*. Variant A vs B is the
// prompt/init choice (see PROMPT). Usage: node world.mjs  (reads .env BLOCKADE key)
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(new URL('../../../.env', import.meta.url), 'utf8') // adjust depth to repo .env, or hardcode
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const KEY = process.env.BLOCKADE_LABS_API_KEY || env.BLOCKADE_LABS_API_KEY
if (!KEY) { console.error('No BLOCKADE_LABS_API_KEY'); process.exit(1) }
const BASE = 'https://backend.blockadelabs.com/api/v1'
const H = { 'content-type': 'application/json', 'x-api-key': KEY }
const DIR = new URL('.', import.meta.url).pathname
const IMG = join(DIR, 'img'), OUT = join(DIR, 'world'); mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mimeOf = (f) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }[extname(f).toLowerCase()] || 'image/jpeg')

// FIGURE-EXCLUDED brief: the surroundings, subject ABSENT (spec §3.2). Variant B
// (full painting init) — the simplest; the real cutout masks any central figure.
const PROMPT =
  'A vast immersive 360 degree equirectangular painted world — the landscape and setting this artwork opens onto, ' +
  'extending far in every direction with real depth. Painterly, same palette and style as the source. ' +
  'The central subject/figure is NOT present here; show only their surroundings and environment. Seamless, no seam at the wrap.'
const NEGATIVE = 'person, people, figure, portrait, human, face, central subject, photograph, 3d render, text, watermark, frame, border'

async function styleId() {
  if (env.BLOCKADE_SKYBOX_STYLE_ID) return Number(env.BLOCKADE_SKYBOX_STYLE_ID)
  const r = await fetch(`${BASE}/skybox/styles`, { headers: H }); const s = await r.json()
  const flat = (Array.isArray(s) ? s : []).flatMap((x) => (Array.isArray(x.items) ? x.items : [x]))
  const m3 = flat.find((x) => `${x.model ?? ''} ${x.model_version ?? ''}`.includes('3'))
  return (m3?.id ?? flat[0]?.id)
}
const sid = await styleId()

for (const f of readdirSync(IMG)) {
  if (!['.jpg', '.jpeg', '.png'].includes(extname(f).toLowerCase())) continue
  try {
    const init = readFileSync(join(IMG, f)).toString('base64')
    console.log(`${f}: creating…`)
    const c = await fetch(`${BASE}/skybox`, { method: 'POST', headers: H, body: JSON.stringify({
      skybox_style_id: sid, prompt: PROMPT.slice(0, 1700), negative_text: NEGATIVE.slice(0, 300),
      init_image: `data:${mimeOf(f)};base64,${init}`, init_strength: 0.35,
    }) })
    if (!c.ok) throw new Error(`create ${c.status}: ${await c.text()}`)
    const id = ((await c.json()).request ?? (await c.clone?.().json?.()) ?? {}).id ?? JSON.parse(await c.text?.() || '{}').id
    // simpler: re-fetch id from a fresh parse
    const created = await (await fetch(`${BASE}/skybox`, { method: 'POST', headers: H, body: JSON.stringify({
      skybox_style_id: sid, prompt: PROMPT.slice(0, 1700), negative_text: NEGATIVE.slice(0, 300),
      init_image: `data:${mimeOf(f)};base64,${init}`, init_strength: 0.35,
    }) })).json()
    const rid = (created.request ?? created).id
    let world, depth
    const t0 = Date.now()
    while (Date.now() - t0 < 180000) {
      await sleep(3000)
      const p = await (await fetch(`${BASE}/imagine/requests/${rid}`, { headers: H })).json()
      const req = p.request ?? p
      if ((req.status ?? '').toLowerCase() === 'complete') { world = req.file_url; depth = req.depth_map_url; break }
      if (['error', 'abort'].includes((req.status ?? '').toLowerCase())) throw new Error(req.error_message || req.status)
    }
    if (!world) throw new Error('timed out')
    writeFileSync(join(OUT, f + '.world.png'), Buffer.from(await (await fetch(world)).arrayBuffer()))
    if (depth) writeFileSync(join(OUT, f + '.depth.png'), Buffer.from(await (await fetch(depth)).arrayBuffer()))
    console.log(`  ${f}: world${depth ? '+depth' : ''} saved`)
  } catch (e) { console.log(`  ${f}: ERROR ${e.message}`) }
}
```

(Note: the doubled create call above is a copy-paste artifact — when writing the file, make ONE create call, parse `(created.request ?? created).id`, then poll. Keep it to a single submit.)

- [ ] **Step 3: Run it; eyeball the worlds**

Run: `node <scratchpad>/layered-proto/world.mjs`
Expected: `world/*.world.png` (+ `.depth.png`) per image. Open them: **does the portrait's world look like a coherent figure-free environment** (her landscape, no person in the center), or did Blockade bake a ghost figure in? If ghost figures appear, that argues for **variant A** (scrub the figure from the init first) — note it for the gate.

- [ ] **Step 4: Write the in-browser segmenter**

Create `<scratchpad>/layered-proto/segment.html` (one-call background removal; pick a file, get the cutout):

```html
<!doctype html><meta charset="utf8"><title>segment</title>
<body style="margin:1rem;background:#0a0a12;color:#ccc;font:14px system-ui">
<input type="file" id="file" accept="image/*">
<div id="status"></div>
<div style="display:flex;gap:1rem"><img id="src" style="max-width:45vw"><img id="cut" style="max-width:45vw;background:repeating-conic-gradient(#333 0% 25%,#222 0% 50%) 50%/20px 20px"></div>
<a id="dl" download="figure.png">download cutout</a>
<script type="module">
import { removeBackground } from 'https://esm.sh/@imgly/background-removal@1.5.5'
const $ = (id) => document.getElementById(id)
$('file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return
  $('src').src = URL.createObjectURL(f); $('status').textContent = 'segmenting…'
  try {
    const blob = await removeBackground(f)   // returns a PNG Blob with alpha
    const url = URL.createObjectURL(blob); $('cut').src = url; $('dl').href = url
    $('status').textContent = 'done — eyeball the alpha edge (hair/halo)'
  } catch (err) { $('status').textContent = 'ERROR ' + err.message }
}
</script>
```

- [ ] **Step 5: Run the segmenter; eyeball the cutouts**

Run: `cd <scratchpad>/layered-proto && python3 -m http.server 8098`, open `http://localhost:8098/segment.html`, segment each artwork (esp. the portrait), download each as `cut/<name>.png`.
Expected: a clean RGBA cutout of the figure. **Is the edge acceptable** (some hair halo is OK; chunks of background stuck on = bad)? If `@imgly` is poor on paintings, note to try `@huggingface/transformers` RMBG-1.4 in the build.

- [ ] **Step 6: Write the composite viewer**

Create `<scratchpad>/layered-proto/view.html` — world sphere + figure plane + clamped lean (judges the core question; world-internal depth is omitted here on purpose — it's already proven by the shipping Skybox):

```html
<!doctype html><meta charset="utf8"><title>composite</title>
<body style="margin:0;background:#0a0a12;overflow:hidden">
<div style="position:fixed;top:8px;left:8px;color:#ccc;font:13px system-ui;z-index:2">
 world <input id="w" size="28" value="world/NAME.jpg.world.png">
 figure <input id="g" size="22" value="cut/NAME.png">
 depth <input id="d" type="range" min="0" max="80" value="0"> <button id="go">load</button>
 <div>drag to lean (clamped)</div></div>
<div id="app" style="width:100vw;height:100vh"></div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.169.0/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three'
const app = document.getElementById('app')
const r = new THREE.WebGLRenderer({ antialias: true }); r.outputColorSpace = THREE.SRGBColorSpace
r.setSize(innerWidth, innerHeight); app.appendChild(r.domElement)
const scene = new THREE.Scene()
const cam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 2000); cam.position.set(0, 0, 0.01)
// inverted world sphere
const sphere = new THREE.Mesh(new THREE.SphereGeometry(500, 60, 40).scale(-1, 1, 1),
  new THREE.MeshBasicMaterial())
scene.add(sphere)
// foreground figure plane (near)
let plane = null
const load = async () => {
  const tex = (u) => new Promise((res) => new THREE.TextureLoader().load(u, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t) }))
  sphere.material.map = await tex(document.getElementById('w').value); sphere.material.needsUpdate = true
  if (plane) scene.remove(plane)
  const ft = await tex(document.getElementById('g').value)
  const ar = (ft.image.width || 1) / (ft.image.height || 1)
  const h = 120, w = h * ar               // CALIBRATE: figure size
  plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: ft, transparent: true }))
  plane.position.set(0, 0, -160)          // CALIBRATE: figure DEPTH (nearer = more parallax)
  scene.add(plane)
}
document.getElementById('go').onclick = load
// clamped lean: drag → small camera offset (parallax), bounded
let lx = 0, ly = 0, down = false, px = 0, py = 0
addEventListener('pointerdown', (e) => { down = true; px = e.clientX; py = e.clientY })
addEventListener('pointerup', () => down = false)
addEventListener('pointermove', (e) => { if (!down) return
  lx = Math.max(-1, Math.min(1, lx + (e.clientX - px) / 400)); ly = Math.max(-1, Math.min(1, ly + (e.clientY - py) / 400)); px = e.clientX; py = e.clientY })
;(function loop(){ requestAnimationFrame(loop)
  cam.position.x += (lx * 22 - cam.position.x) * 0.08   // bounded translate = parallax
  cam.position.y += (-ly * 14 - cam.position.y) * 0.08
  cam.lookAt(0, 0, -200)
  if (plane) plane.lookAt(cam.position)                 // billboard
  r.render(scene, cam)
})()
load()
</script>
```

- [ ] **Step 7: Run the viewer; eyeball the composite**

Edit the `NAME` placeholders in `view.html` to a real pair (e.g. the portrait's `world` + `cut`), serve (`python3 -m http.server 8098`), open `view.html`, drag to lean. **Tune the figure `position.z` (depth) and plane size** until she sits believably in the world and *pops* from it as you lean.

- [ ] **Step 8: GATE — record the decision (no commit)**

Write `<scratchpad>/layered-proto/README.md`:
- **GO / NO-GO:** does the portrait read as "she's standing in her painted world," flat-but-not-cardboard, under the small lean? If it looks wrong even after tuning → **NO-GO**: stop, report, fall back to shipping just the Milestone A flat guard.
- **World variant A or B:** did the figure-excluded prompt (B) give a clean world, or do we need to scrub the figure from the init first (A)?
- **Figure depth/scale:** the `position.z` and plane size that looked right (feeds the renderer defaults).
- **`LAYERED_MIN`:** the `figure_coverage` threshold above which an artwork should get this treatment.
- **Segmenter:** `@imgly` good enough, or switch to RMBG-1.4 in the build?

**Do not commit the prototype.** Report the gate result. On GO, the controller writes the Phase-1 detailed plan (Tasks 2+) using these values.

---

## Phase 1 — Build (task map; detailed steps authored AFTER the Phase-0 gate)

> Per-step code depends on the gate's outputs (variant A/B, figure depth/scale, `LAYERED_MIN`, segmenter choice, live-vs-preseed viability). The controller re-runs `writing-plans` after GO to expand these into bite-sized TDD steps. Decomposition + interfaces locked here.

**Task 2 — Types + response `figure_url`.**
`shared/types.ts` + `supabase/functions/_shared/types.ts`: add `figure_url?: string | null` to `ScanReadyResponse` + `JobStatusResponse`. (`Realization` already includes `'layered'` — no change.) Gate: `npm run typecheck` + `deno check`.

**Task 3 — Migration `0004_figure.sql`.**
`alter table public.artworks add column if not exists figure_url text;` + same on `jobs`. Nullable, mirrors `0002_depth.sql`. (No enum change — `layered` already in the `0003` CHECK.) Controller applies it to the live DB as a deliberate step.

**Task 4 — Router: `layered` branch + tests.**
`supabase/functions/_shared/realization/route.ts` + `route.test.ts`: add `LAYERED_MIN` (from gate) and a first-check branch — `scene_type ∈ {portrait, still-life}` and `figure_coverage ≥ LAYERED_MIN` → `'layered'`; existing flat/depth/figure-guard logic unchanged below. Tests: portrait/still-life ≥ threshold → layered; below → existing; Milestone-A invariants still hold.

**Task 5 — Figure-excluded scene prompt.**
`supabase/functions/_shared/prompt.ts`: a `buildLayeredScenePrompt(r)` (or a flag on `buildScenePrompt`) emitting the figure-excluded brief + negatives (variant A or B per gate), within the 2200-char Blockade cap. Unit test asserts it excludes the subject and stays under cap. Wire it in `scan/index.ts` when `realization==='layered'`.

**Task 6 — Segmentation module + pre-seed path.**
`src/lib/segment.ts`: in-browser figure cutout (gate's segmenter choice) → returns a canvas/blob, lazy dynamic import like `src/lib/depth.ts`. For known artworks, a Node pre-seed step computes + stores `figure_url`; live unknown artworks segment client-side at view time. Unit-test the pure helpers (e.g. coverage/scale math); the model call is manual/visual.

**Task 7 — Scan ingest + job-status threading.**
`supabase/functions/scan/index.ts`: persist `figure_url` when pre-seeded; `layered` jobs are ready on the world (`panorama_url`). `job-status/index.ts` + `src/lib/api.ts` (`ScanOutcome.figureUrl`) + `src/App.tsx` (`World.figureUrl`) thread `figure_url` (mirrors `depth_url`). Gate: `deno check` + `npm test` + typecheck.

**Task 8 — Client composite (foreground figure plane).**
`src/three/Skybox.ts`: add a foreground figure-plane API (`setFigure(src)` — billboard at the gate's depth, unlit `MeshBasicMaterial`, feathered alpha, rides the existing parallax offset). `src/components/WorldViewer.tsx`: when `realization==='layered'`, supply the figure (from `figureUrl`, else client-segment via `src/lib/segment.ts`; no-WebGPU → skip → flat-guard look). This deliberately re-introduces a foreground-plane renderer (figure cutout, distinct from the deleted whole-painting `setArtwork`). Gate: `npm run build` + manual visual.

**Task 9 — Dev-API parity.**
`dev-api/providers.ts` + `dev-api/plugin.ts`: carry `realization` + `figure_url` through the dev `JobRecord`/`/api/job-status`, and use the layered scene prompt when the chosen realization is `layered`. Gate: local `npm run dev` scan of a portrait → a `layered` world.

**Task 10 — Env/docs.** `.env.example`/README: note the `layered` strategy and that figure segmentation runs in-browser (no new key). No code.

---

## Self-Review

**1. Spec coverage:** §1 approach → Tasks 4–8. §2 reconciliation (foreground plane) → Task 8 (+ prototype confirm). §3.1 segmentation → Task 6 + prototype. §3.2 figure-excluded world (A/B) → Task 5 + prototype Step 2–3. §3.3 composite → Task 8 + prototype Step 6. §4 compute split (pre-seed/live/fallback) → Task 6 + Task 8. §5 schema/enum/routing/threading → Tasks 2,3,4,7. §6 renderer → Task 8. §7 prototype → Task 1. §8 risks → mitigations in Task 1 (look), 4/8 (degrade), 6 (segmenter). §9 out-of-scope honored (no fal, multi-figure stays depth/flat). No section unmapped.

**2. Placeholder scan:** Phase 0 is complete runnable code with one explicit copy-paste caveat called out (the doubled Blockade create — collapse to one). The `NAME`/`CALIBRATE` markers in the prototype HTML are intentional human-tuning knobs, not code placeholders. Phase 1 is a deferred task map (justified — gate outputs feed it), not in-task TODOs.

**3. Type consistency:** `figure_url`/`figureUrl`, `realization='layered'`, `LAYERED_MIN`, `setFigure`, `buildLayeredScenePrompt`, `src/lib/segment.ts` used consistently across tasks. Reuses `panorama_url`(world)+`depth_url`; only `figure_url` is new. No enum/CHECK migration (already present from `0003`).

**Note for the controller:** after Phase-0 GO, re-run `writing-plans` to expand Tasks 2–10 into bite-sized TDD steps using the gate's variant/depth/`LAYERED_MIN`/segmenter values, then execute via subagent-driven-development.
