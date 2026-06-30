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
