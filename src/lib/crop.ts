// Crop a captured frame down to just the artwork, using the bounding box the
// vision model returned. Runs client-side on a canvas (free, no server image
// lib). Defensive about the box: handles the 0..1000 scale some models use,
// clamps to the image, pads slightly, and falls back to the original on anything
// suspicious.

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Normalize a model bounding box to clamped 0..1 {x,y,w,h}. */
function normalizeBox(b: Box): Box | null {
  let { x, y, w, h } = b
  if (![x, y, w, h].every((n) => typeof n === 'number' && isFinite(n))) return null
  // Some models (e.g. Gemini) emit 0..1000 instead of 0..1.
  if (Math.max(x, y, w, h) > 2) {
    x /= 1000
    y /= 1000
    w /= 1000
    h /= 1000
  }
  const c01 = (n: number) => Math.min(1, Math.max(0, n))
  x = c01(x)
  y = c01(y)
  w = c01(w)
  h = c01(h)
  if (x + w > 1) w = 1 - x
  if (y + h > 1) h = 1 - y
  // Reject degenerate or near-full boxes (no point cropping the whole frame).
  if (w < 0.05 || h < 0.05) return null
  if (w > 0.98 && h > 0.98) return null
  return { x, y, w, h }
}

/**
 * Crop `blob` to the artwork box. Returns a new JPEG blob, or the original blob
 * unchanged if the box is missing/invalid or cropping fails.
 */
export async function cropToBox(blob: Blob, box: Box | undefined, padFrac = 0.02): Promise<Blob> {
  if (!box) return blob
  const norm = normalizeBox(box)
  if (!norm) return blob

  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const W = img.naturalWidth
    const H = img.naturalHeight
    let x = (norm.x - padFrac) * W
    let y = (norm.y - padFrac) * H
    let w = (norm.w + padFrac * 2) * W
    let h = (norm.h + padFrac * 2) * H
    x = Math.max(0, x)
    y = Math.max(0, y)
    w = Math.min(W - x, w)
    h = Math.min(H - y, h)
    if (w < 8 || h < 8) return blob

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w)
    canvas.height = Math.round(h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height)

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    )
    return out ?? blob
  } catch {
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('crop: failed to load image'))
    img.src = url
  })
}
