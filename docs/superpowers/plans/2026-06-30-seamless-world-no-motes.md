# Seamless World + Remove Dust Motes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the immersive 360° world read as continuous all the way around (feather the panorama wrap seam) and remove the floating dust motes.

**Architecture:** A pure `featherSeam` pixel function cross-blends a narrow band across the ±180° wrap at texture-load so the panorama becomes tileable (kills the visible divider). The `Atmosphere` dust-mote layer is deleted and all references removed.

**Tech Stack:** TypeScript, three.js 0.169 (`src/three/Skybox.ts`), React (`src/components/WorldViewer.tsx`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-30-seamless-world-no-motes-design.md` — read it; this plan implements it.

## Global Constraints

- The seam fix is **client-side render only** — no panorama regeneration, no new assets.
- `featherSeam` is a **pure function over an RGBA `Uint8ClampedArray`** (no DOM), so it's vitest-testable in the node env.
- Default feather band = `round(w * 0.04)` (~4% each side); `band <= 0` or `w < 2*band` → no-op.
- The per-row edge average must be captured from the **original** column 0 and column w−1 **before** writing any pixel in that row.
- Texture settings stay: `wrapS = RepeatWrapping`, `LinearFilter`, `generateMipmaps = false`.
- Removing `Atmosphere` must leave **no dangling references** (`Atmosphere`, `atmosphere`, `setAtmosphere`, `motes`, `avgPaletteColor`).
- Gates: `npm run typecheck` exits 0; `npm run build` succeeds; `npm test` green. (Edge functions untouched — no `deno check` needed.)

## File structure
- **Create:** `src/three/seam.ts` (`featherSeam`), `src/three/seam.test.ts`.
- **Modify:** `src/three/Skybox.ts` (wire featherSeam into `loadPanorama`; remove Atmosphere wiring + `motes` tier field), `src/components/WorldViewer.tsx` (remove `setAtmosphere` call + `avgPaletteColor`).
- **Delete:** `src/three/Atmosphere.ts`.

---

### Task 1: `featherSeam` pure function + test

**Files:** Create `src/three/seam.ts`; Test `src/three/seam.test.ts`.

**Interfaces — Produces:** `featherSeam(data: Uint8ClampedArray, w: number, h: number, band?: number): void` (mutates `data` in place).

- [ ] **Step 1: Write the failing test**

Create `src/three/seam.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { featherSeam } from './seam'

function px(d: Uint8ClampedArray, w: number, x: number, y: number): number[] {
  const o = (y * w + x) * 4
  return [d[o], d[o + 1], d[o + 2], d[o + 3]]
}

describe('featherSeam', () => {
  it('converges the wrap edges (col 0 ≈ col w-1) and leaves the interior untouched', () => {
    const w = 20, h = 2, band = 4
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        const v = x === 0 ? 0 : x === w - 1 ? 255 : 128 // hard left/right discontinuity, gray interior
        data[o] = data[o + 1] = data[o + 2] = v
        data[o + 3] = 255
      }
    }
    featherSeam(data, w, h, band)
    const left = px(data, w, 0, 0)
    const right = px(data, w, w - 1, 0)
    expect(Math.abs(left[0] - right[0])).toBeLessThanOrEqual(1) // seam gone — edges meet
    expect(px(data, w, 10, 0)).toEqual([128, 128, 128, 255])     // interior untouched
  })

  it('is a no-op for band <= 0', () => {
    const w = 8, h = 1
    const data = new Uint8ClampedArray(w * h * 4).fill(50)
    const copy = data.slice()
    featherSeam(data, w, h, 0)
    expect(data).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run it — fails**

Run: `npm test`
Expected: FAIL (`./seam` module not found).

- [ ] **Step 3: Implement**

Create `src/three/seam.ts`:

```typescript
/**
 * Make an equirectangular RGBA buffer horizontally tileable by feathering the
 * ±180° wrap. Over a band of `band` columns at each edge, ramp each pixel toward
 * the per-row average of the two ORIGINAL edge columns, so column 0 and column
 * w-1 converge (no visible seam) while the interior is untouched. Mutates `data`.
 *
 * @param data RGBA pixels, row-major, length w*h*4
 * @param band number of columns to feather at EACH edge (default ~4% of width)
 */
export function featherSeam(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  band: number = Math.round(w * 0.04),
): void {
  if (band <= 0 || w < 2 * band || h <= 0) return
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    const lo = row                    // column 0
    const ro = row + (w - 1) * 4      // column w-1
    // Capture the per-row edge average from the ORIGINAL edge columns first —
    // both columns get overwritten below.
    const avg = [
      (data[lo] + data[ro]) / 2,
      (data[lo + 1] + data[ro + 1]) / 2,
      (data[lo + 2] + data[ro + 2]) / 2,
      (data[lo + 3] + data[ro + 3]) / 2,
    ]
    for (let i = 0; i < band; i++) {
      const t = i / band // 0 at the very edge → 1 at the inner edge of the band
      const lx = row + i * 4               // left band column
      const rx = row + (w - 1 - i) * 4     // right band column (mirrored)
      for (let c = 0; c < 4; c++) {
        data[lx + c] = avg[c] + (data[lx + c] - avg[c]) * t // lerp(avg, orig, t)
        data[rx + c] = avg[c] + (data[rx + c] - avg[c]) * t
      }
    }
  }
}
```

- [ ] **Step 4: Run it — passes**

Run: `npm test`
Expected: PASS (the 2 featherSeam tests + the existing suite).

- [ ] **Step 5: Commit**

```bash
git add src/three/seam.ts src/three/seam.test.ts
git commit -m "feat: featherSeam — make equirect panorama tileable across the wrap"
```

---

### Task 2: Wire `featherSeam` into `Skybox.loadPanorama`

**Files:** Modify `src/three/Skybox.ts`.

**Interfaces — Consumes:** `featherSeam` (Task 1).

- [ ] **Step 1: Import featherSeam**

At the top of `src/three/Skybox.ts`, after the existing imports (the `Atmosphere` import is removed in Task 3 — leave it for now), add:

```typescript
import { featherSeam } from './seam'
```

- [ ] **Step 2: Route the panorama source through the seam feather**

In `loadPanorama` (currently lines 150–169), change the `source` line from:

```typescript
    const source = downscaleIfNeeded(img, this.maxTextureSize)
```

to:

```typescript
    const source = featherPanorama(downscaleIfNeeded(img, this.maxTextureSize))
```

- [ ] **Step 3: Add the `featherPanorama` canvas helper**

Add this module-level function near `downscaleIfNeeded` in `src/three/Skybox.ts`:

```typescript
/**
 * Draw the panorama to a canvas and feather the ±180° wrap seam so the texture
 * is tileable (no visible divider where the left and right edges meet). Falls
 * back to the original source if a 2D context / pixel access isn't available.
 */
function featherPanorama(
  src: HTMLImageElement | HTMLCanvasElement,
): HTMLImageElement | HTMLCanvasElement {
  const w = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth
  const h = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight
  if (!w || !h) return src
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  try {
    ctx.drawImage(src, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h) // throws if the canvas is tainted
    featherSeam(imageData.data, w, h)
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } catch {
    return src // cross-origin taint or other failure → use the un-feathered source
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → exits 0.
Run: `npm run build` → succeeds.
Run: `npm test` → still green.

- [ ] **Step 5: Commit**

```bash
git add src/three/Skybox.ts
git commit -m "feat: feather the panorama wrap seam at load (continuous 360 world)"
```

---

### Task 3: Remove the dust motes (Atmosphere layer)

**Files:** Delete `src/three/Atmosphere.ts`; Modify `src/three/Skybox.ts`, `src/components/WorldViewer.tsx`.

- [ ] **Step 1: Delete the Atmosphere module**

```bash
git rm src/three/Atmosphere.ts
```

- [ ] **Step 2: Remove the Atmosphere wiring from `Skybox.ts`**

Make these edits in `src/three/Skybox.ts`:
- Delete the import line `import { Atmosphere } from './Atmosphere'`.
- Delete the field `private atmosphere: Atmosphere | null = null`.
- Delete the entire `setAtmosphere(...)` method (the JSDoc + method body, ~lines 128–139).
- In the render loop, delete the line `this.atmosphere?.update(dt)`.
- In `dispose()`, delete the line `this.atmosphere?.dispose()`.
- Remove `motes` from the `Tier` interface (the `motes: number` line + its doc comment) and remove the `motes: …` entry from each of the three `pickTier` return objects.
- Update the comment on the material (`// fog:false keeps the panorama crisp — only the atmosphere motes are fogged.`) to just `// fog:false keeps the panorama crisp.` (the motes are gone).

- [ ] **Step 3: Remove the `setAtmosphere` call + `avgPaletteColor` from `WorldViewer.tsx`**

In `src/components/WorldViewer.tsx`:
- Delete the line `sky.setAtmosphere({ color: avgPaletteColor(meta.palette), mood: meta.mood })` (currently line ~143).
- Delete the `avgPaletteColor` function (currently starting line ~50) — confirm via grep it has no other caller first.

- [ ] **Step 4: Verify no dangling references**

Run:
```bash
grep -rnE "Atmosphere|setAtmosphere|avgPaletteColor|\bmotes\b" src/ || echo "clean — no dangling refs"
```
Expected: `clean — no dangling refs` (or only unrelated matches; there should be none).

Run: `npm run typecheck` → exits 0.
Run: `npm run build` → succeeds.
Run: `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add -A src/three/Skybox.ts src/components/WorldViewer.tsx src/three/Atmosphere.ts
git commit -m "feat: remove floating dust motes (delete Atmosphere layer)"
```

---

## Manual visual verification (after Task 3)

`npm run dev`, scan/load a world (or the demo): (1) look 180° behind the front view — the previous vertical divider should be gone / continuous; (2) no floating motes anywhere; (3) the front artwork stays crisp; (4) gyro/lean parallax still works. If a faint *geometric* crease remains at the seam with depth on, apply spec §2.3 (widen `uSeamEps` from `0.012` to ~`0.03` in the `depthU` defaults) and re-check.

## Self-Review

**1. Spec coverage:** §2.1 featherSeam → Task 1. §2.2 Skybox integration → Task 2. §2.3 (conditional depth tweak) → manual-verification note (applied only if a crease remains, per spec). §3 remove Atmosphere → Task 3. §4 error handling → featherSeam no-op guards (Task 1) + featherPanorama try/catch + context-null fallback (Task 2). §5 testing → Task 1 unit test + the verify steps + manual section. No spec section unmapped.

**2. Placeholder scan:** every code step has complete code; verify steps give exact commands + expected output. The §2.3 depth tweak is deferred to manual verification exactly as the spec scoped it (conditional), not an in-task TODO.

**3. Type consistency:** `featherSeam(data, w, h, band?)` signature identical in Task 1 (def + test) and Task 2 (call via `featherPanorama`). `featherPanorama` returns `HTMLImageElement | HTMLCanvasElement`, matching what `new THREE.Texture(source)` already accepts. Removed symbols (`Atmosphere`, `atmosphere`, `setAtmosphere`, `motes`, `avgPaletteColor`) are all eliminated in Task 3 with a grep gate.
