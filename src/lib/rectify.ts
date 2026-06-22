// Artwork detection + perspective rectification, ported from the RECTO pipeline
// (image-detection/cvPipeline.js). Lazily loads the vendored OpenCV.js (+ jscanify)
// from /vendor, finds the artwork's quadrilateral in a photo, and warps it to a
// flat, straight-on image — the clean `init_image` we hand to Blockade so the
// generated world is faithful to the painting (no floating cutout in the scene).
//
// All corner arrays are ordered [TL, TR, BR, BL] in SOURCE-image pixels.

export interface Pt {
  x: number
  y: number
}

declare global {
  interface Window {
    // OpenCV.js + jscanify attach themselves to window as runtime globals.
    cv?: any
    jscanify?: any
  }
}

let cvReady: Promise<void> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.dataset.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(s)
  })
}

/**
 * Lazily load OpenCV.js (~10MB, vendored) + jscanify and resolve once the runtime
 * is ready. Cached, so the cost is paid once per session (the first scan).
 */
export function ensureCv(): Promise<void> {
  if (!cvReady) {
    cvReady = (async () => {
      await injectScript('/vendor/opencv.js')
      // NEVER `await window.cv`: the OpenCV Module is a self-referential thenable
      // that hangs the microtask queue. Poll until its API is initialized.
      await new Promise<void>((resolve) => {
        const t = window.setInterval(() => {
          const cv = window.cv
          if (cv && cv.Mat && typeof cv.imread === 'function') {
            window.clearInterval(t)
            resolve()
          }
        }, 50)
      })
      try {
        await injectScript('/vendor/jscanify.js') // optional fallback detector
      } catch {
        /* jscanify is a bonus; OpenCV alone still detects */
      }
    })()
  }
  return cvReady
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

// Order 4 arbitrary points into [TL, TR, BR, BL].
function orderQuad(pts: Pt[]): Pt[] {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x))
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]] // TL, TR, BR, BL
}

function quadArea(q: Pt[]): number {
  let s = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

// True if the quad is essentially the whole image frame (not a useful crop).
function nearImageBorder(q: Pt[], w: number, h: number, tol: number): boolean {
  const c = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  return q.every((p, i) => dist(p, c[i]) < tol)
}

// Primary detector: Canny edges → contours → approxPolyDP, keep the largest
// convex quadrilateral. Precise when the artwork has clean edges.
function detectByPolygon(srcCanvas: HTMLCanvasElement): Pt[] | null {
  const cv = window.cv
  const src = cv.imread(srcCanvas)
  const gray = new cv.Mat()
  const blur = new cv.Mat()
  const edges = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  let result: Pt[] | null = null
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(blur, edges, 60, 180)
    const k = cv.Mat.ones(5, 5, cv.CV_8U)
    cv.dilate(edges, edges, k)
    k.delete()
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    const imgArea = src.cols * src.rows
    let bestArea = 0
    let best: Pt[] | null = null
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      const peri = cv.arcLength(c, true)
      const approx = new cv.Mat()
      cv.approxPolyDP(c, approx, 0.02 * peri, true)
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts: Pt[] = []
        for (let j = 0; j < 4; j++) {
          pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
        }
        const area = quadArea(pts)
        if (area > bestArea && area > imgArea * 0.12 && area < imgArea * 0.999) {
          bestArea = area
          best = pts
        }
      }
      approx.delete()
      c.delete()
    }
    if (best) result = orderQuad(best)
  } catch {
    result = null
  } finally {
    src.delete()
    gray.delete()
    blur.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
  }
  return result
}

// Fallback detector: jscanify (largest contour → extreme point per quadrant).
function detectByJscanify(srcCanvas: HTMLCanvasElement): Pt[] | null {
  const cv = window.cv
  const J = window.jscanify
  if (!J) return null
  let scanner: any
  try {
    scanner = new J()
  } catch {
    return null
  }
  const src = cv.imread(srcCanvas)
  let result: Pt[] | null = null
  try {
    const contour = scanner.findPaperContour(src)
    if (contour) {
      const c = scanner.getCornerPoints(contour)
      if (c && c.topLeftCorner && c.topRightCorner && c.bottomRightCorner && c.bottomLeftCorner) {
        result = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner].map(
          (p: Pt) => ({ x: p.x, y: p.y }),
        )
      }
    }
  } catch {
    result = null
  } finally {
    src.delete()
  }
  return result
}

/** A sensible inset rectangle, used when auto-detection finds nothing useful. */
export function defaultQuad(w: number, h: number): Pt[] {
  const ix = w * 0.12
  const iy = h * 0.12
  return [
    { x: ix, y: iy },
    { x: w - ix, y: iy },
    { x: w - ix, y: h - iy },
    { x: ix, y: h - iy },
  ]
}

/** Best artwork quad in source coords, or a sensible inset default. Needs ensureCv(). */
export function detect(srcCanvas: HTMLCanvasElement): Pt[] {
  const w = srcCanvas.width
  const h = srcCanvas.height
  const tol = Math.max(w, h) * 0.02
  let q = detectByPolygon(srcCanvas)
  if (q && nearImageBorder(q, w, h, tol)) q = null // ignore "whole frame" hits
  if (!q) {
    const j = detectByJscanify(srcCanvas)
    if (j && !nearImageBorder(j, w, h, tol) && quadArea(j) > w * h * 0.1) q = j
  }
  return q || defaultQuad(w, h)
}

/**
 * Warp `corners` ([TL,TR,BR,BL] in source coords) to a flat rectangle in a new
 * canvas. Output size comes from the corner geometry so the result isn't stretched.
 */
export function warp(srcCanvas: HTMLCanvasElement, corners: Pt[], maxDim = 4000): HTMLCanvasElement {
  const cv = window.cv
  const [tl, tr, br, bl] = corners
  let outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)))
  let outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)))
  outW = Math.max(1, outW)
  outH = Math.max(1, outH)
  const scl = Math.min(1, maxDim / Math.max(outW, outH))
  outW = Math.max(1, Math.round(outW * scl))
  outH = Math.max(1, Math.round(outH * scl))

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH

  const src = cv.imread(srcCanvas)
  const dst = new cv.Mat()
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y])
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH])
  const M = cv.getPerspectiveTransform(srcTri, dstTri)
  try {
    cv.warpPerspective(
      src,
      dst,
      M,
      new cv.Size(outW, outH),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    )
    cv.imshow(out, dst)
  } finally {
    src.delete()
    dst.delete()
    srcTri.delete()
    dstTri.delete()
    M.delete()
  }
  return out
}
