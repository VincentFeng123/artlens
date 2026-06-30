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
