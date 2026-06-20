// Generates public/demo-panorama.png — a self-contained equirectangular (2:1)
// "world" used by demo mode. No network, fully deterministic, and seam-correct:
// every longitude-dependent term is a sum of integer-frequency sines of the
// angle, so the left and right edges (lon = 0 and lon = 2π) match exactly.
//
// Run via `npm run gen:demo` (also runs automatically on predev / prebuild).

import { PNG } from 'pngjs'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public')
const OUT_FILE = join(OUT_DIR, 'demo-panorama.png')

const W = 2048
const H = 1024
const TAU = Math.PI * 2

// ── small deterministic helpers ───────────────────────────────────────────
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
// hash a 2D integer cell to 0..1 — used only for faint stars
const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

// Vertical gradient stops (latitude 0 = zenith/top, 1 = nadir/bottom).
// Each stop is [lat, [r, g, b]].
const STOPS = [
  [0.0, [6, 8, 24]], // deep night zenith
  [0.32, [20, 18, 52]], // indigo
  [0.46, [58, 38, 86]], // violet pre-horizon
  [0.52, [120, 74, 104]], // warm horizon glow
  [0.58, [44, 32, 64]], // dusk falloff
  [0.78, [16, 14, 32]], // lower sky
  [1.0, [5, 5, 12]], // nadir
]

function gradient(lat) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [l0, c0] = STOPS[i]
    const [l1, c1] = STOPS[i + 1]
    if (lat >= l0 && lat <= l1) {
      const t = smoothstep(l0, l1, lat)
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]
    }
  }
  return STOPS[STOPS.length - 1][1].slice()
}

// A wavy aurora ribbon. `center`/`thickness` are in latitude units; the wave is
// a sum of integer-frequency sines of longitude → seamless across the wrap.
function ribbon(lon, lat, opts) {
  const wave =
    opts.amp1 * Math.sin(opts.f1 * lon + opts.p1) +
    opts.amp2 * Math.sin(opts.f2 * lon + opts.p2)
  const c = opts.center + wave
  const d = (lat - c) / opts.thickness
  const band = Math.exp(-d * d)
  // gentle longitudinal brightness shimmer, also seam-safe
  const shimmer = 0.65 + 0.35 * Math.sin(opts.f3 * lon + opts.p3)
  return band * shimmer * opts.intensity
}

const png = new PNG({ width: W, height: H })

for (let y = 0; y < H; y++) {
  const lat = y / (H - 1)
  for (let x = 0; x < W; x++) {
    const lon = (x / W) * TAU // x/W (not W-1) so column 0 == column W (seam)

    let [r, g, b] = gradient(lat)

    // Aurora ribbon 1 — teal/green
    const a1 = ribbon(lon, lat, {
      center: 0.34,
      thickness: 0.05,
      amp1: 0.05,
      f1: 2,
      p1: 0.4,
      amp2: 0.03,
      f2: 3,
      p2: 2.1,
      f3: 5,
      p3: 0.0,
      intensity: 1.0,
    })
    r += a1 * 40
    g += a1 * 150
    b += a1 * 120

    // Aurora ribbon 2 — magenta/violet, higher and thinner
    const a2 = ribbon(lon, lat, {
      center: 0.22,
      thickness: 0.04,
      amp1: 0.04,
      f1: 3,
      p1: 1.7,
      amp2: 0.025,
      f2: 5,
      p2: 0.6,
      f3: 4,
      p3: 1.2,
      intensity: 0.8,
    })
    r += a2 * 150
    g += a2 * 50
    b += a2 * 150

    // Soft warm glow centered behind the viewer (lon = π) — far from the seam,
    // symmetric, so the wrap stays clean.
    const glow =
      Math.exp(-((lon - Math.PI) ** 2) / 0.7) * smoothstep(0.62, 0.48, lat)
    r += glow * 70
    g += glow * 40
    b += glow * 30

    // Faint stars in the upper sky only.
    if (lat < 0.45) {
      const hv = hash2(x, y)
      if (hv > 0.9985) {
        const tw = (hv - 0.9985) / 0.0015 // 0..1
        const s = 90 + tw * 120
        r += s
        g += s
        b += s * 0.95
      }
    }

    const idx = (W * y + x) << 2
    png.data[idx] = Math.round(clamp01(r / 255) * 255)
    png.data[idx + 1] = Math.round(clamp01(g / 255) * 255)
    png.data[idx + 2] = Math.round(clamp01(b / 255) * 255)
    png.data[idx + 3] = 255
  }
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, PNG.sync.write(png))
console.log(`✓ demo panorama written: ${OUT_FILE} (${W}×${H})`)
