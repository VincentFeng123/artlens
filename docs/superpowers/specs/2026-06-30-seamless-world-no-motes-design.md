# Seamless World + Remove Dust Motes — Design

**Date:** 2026-06-30
**Status:** Approved design, pre-implementation.

Two fixes to the immersive 360° world (`src/three/`): (1) eliminate the visible **wrap seam** so the world reads as continuous all the way around, and (2) **remove the floating dust motes** ("flakes").

---

## 1. Problem

### 1.1 The seam ("divider")
The world is an equirectangular panorama mapped onto an inverted sphere (`Skybox.ts`). The visible vertical line is the **±180° wrap seam** — where the panorama's left and right edges meet (behind the front view, "where the artwork begins and ends meet"). The texture uses `RepeatWrapping`, which makes *sampling* across the join continuous, but it cannot fix *content* that doesn't line up: Blockade's panorama is not perfectly tileable, so the far-left and far-right pixels differ in colour/value → a visible discontinuity. (A secondary contributor may be a faint geometric crease from the depth shader fading displacement to zero exactly at the seam.)

### 1.2 The flakes
A field of drifting dust motes + a faint palette fog (`Atmosphere.ts`, a `THREE.Points` layer added via `Skybox.setAtmosphere`). The user wants them gone entirely.

## 2. Fix 1 — feather the wrap seam at texture load

A **pure pixel function** + a `Skybox` integration point. Make the panorama tileable by cross-blending a narrow band across the wrap so column 0 ≈ column W−1.

### 2.1 `featherSeam` (pure, testable)
New `src/three/seam.ts`:

```ts
/**
 * Make an equirectangular RGBA buffer horizontally tileable by feathering the
 * ±180° wrap: over a band of `band` columns at each edge, ramp each pixel toward
 * the per-row average of the two edge columns, so the far-left and far-right
 * columns converge (no seam) while the interior is untouched. Mutates `data`.
 */
export function featherSeam(data: Uint8ClampedArray, w: number, h: number, band: number): void
```

Algorithm (per row `y`, per channel): **first** capture the original edge columns `L = pixel(0,y)`, `R = pixel(w-1,y)` and `avg = (L+R)/2` **before writing any pixel in that row** (column 0 and column w−1 get overwritten below, so the average must be read first or the right-band blend would use an already-mutated column 0).
- Left band `x ∈ [0, band)`: `out(x,y) = lerp(avg, orig(x,y), x/band)` — `x=0` → `avg`, `x=band` → original.
- Right band `x ∈ [w-band, w)`: `out(x,y) = lerp(orig(x,y), avg, (x-(w-band))/band)` — inner edge → original, `x=w-1` → `~avg`.

Result: the two edges meet at the shared average (continuous wrap), feathering back to the original within `band`. Default `band = round(w * 0.04)` (~4% each side; tunable). `band ≤ 0` is a no-op.

### 2.2 Skybox integration
In `Skybox.loadPanorama`, after decoding/downscaling the image to a canvas (it already creates a texture from an image/canvas — route it through a canvas), call `getImageData → featherSeam(data, w, h, band) → putImageData` before building the `THREE.Texture`. If a 2D context isn't available, skip the blend and use the original image (no crash). Keep the existing `wrapS = RepeatWrapping` / `LinearFilter` / `generateMipmaps = false`.

### 2.3 Secondary (apply only if a crease remains)
The depth shader computes `seamW = smoothstep(0, uSeamEps, min(uv.x, 1-uv.x))`, zeroing displacement at the seam. If, after the content feather, a faint geometric crease is still visible with depth on, widen the smoothing band (raise `uSeamEps` modestly, e.g. 0.012 → ~0.03) so the displacement ramps in more gently. This is a one-line tweak, applied **only if** the visual check shows a residual crease — not by default (it slightly reduces parallax in a narrow band near the back).

## 3. Fix 2 — remove the dust motes (Atmosphere)

- **Delete** `src/three/Atmosphere.ts`.
- **`Skybox.ts`:** remove the `import { Atmosphere }`, the `atmosphere` field, the `setAtmosphere` method, the `this.atmosphere?.update(dt)` call in the loop, and the `this.atmosphere?.dispose()` in `dispose`. Remove `motes` from the `Tier` interface + each `pickTier` return (it's only consumed by Atmosphere). No `scene.fog` is set anymore (the photosphere already renders `fog: false`).
- **`WorldViewer.tsx`:** remove the `sky.setAtmosphere({ ... })` call and the now-unused `avgPaletteColor` helper if nothing else uses it (check — it's used only to feed the atmosphere tint).

## 4. Error handling

- `featherSeam` with `band ≤ 0` or `w < 2*band` → no-op / clamps; never throws.
- Canvas 2D context unavailable in `loadPanorama` → skip the feather, use the original texture (current behavior); world still renders.
- Removing Atmosphere cannot fail; verify no dangling references (`atmosphere`, `setAtmosphere`, `motes`, `Atmosphere`) remain via grep + `tsc`.

## 5. Testing

- **`src/three/seam.test.ts`** (vitest, node env — pure array math, no DOM): build a synthetic RGBA buffer (e.g. `w=20,h=2`) with a deliberate left/right discontinuity (left column black, right column white); after `featherSeam(data, w, h, band=4)`, assert `pixel(0,y) ≈ pixel(w-1,y)` (within a tolerance) and that interior columns outside the band are unchanged.
- **Build/typecheck:** `npm run build` + `npm run typecheck` green after the Atmosphere removal (no dangling refs).
- **Manual visual:** load a real panorama → the back-of-world seam is no longer a visible line; no floating motes anywhere; the front artwork stays crisp.

## 6. Out of scope

- Regenerating panoramas seamlessly at the source (Blockade) — this is a client-side render fix.
- The pole (zenith/nadir) artifacts — separate from the horizontal wrap seam; unchanged.
- Replacing the motes with a different ambience — they're removed, not swapped.
- Touching the depth-parallax behavior beyond the optional, conditional `uSeamEps` widening in §2.3.
