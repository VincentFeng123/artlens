// In-browser monocular depth (free, no server, no API cost) for the keyless
// panorama path. Runs Depth Anything V2 (small) via transformers.js on the
// visitor's own GPU, so the developer pays nothing and no backend is needed.
//
// WebGPU only: the WASM backend would run inference on the main thread and freeze
// the UI for seconds, so on devices without WebGPU we skip it and the sphere stays
// flat (depth is a progressive enhancement). transformers.js itself is dynamically
// imported so its weight (and the model download) only loads when actually used.
//
// This is the pragmatic single-pass approach: depth is run on the full
// equirectangular image, and its inherent pole-stretch + ±180° seam are hidden by
// the Skybox shader (pole-fade + seam-blend). A cubemap-split-and-merge would be
// more accurate at the poles, at ~6× inference + a reprojection step.

interface RawDepth {
  data: ArrayLike<number>
  width: number
  height: number
  channels: number
}
type DepthPipeline = (input: string) => Promise<{ depth: RawDepth }>

let pipePromise: Promise<DepthPipeline> | null = null

/** True when in-browser depth can run (WebGPU present). */
export function depthSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

async function getPipe(): Promise<DepthPipeline> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers')
      const pipe = await pipeline(
        'depth-estimation',
        'onnx-community/depth-anything-v2-small',
        { device: 'webgpu' },
      )
      return pipe as unknown as DepthPipeline
    })()
  }
  return pipePromise
}

const cache = new Map<string, HTMLCanvasElement>()

/**
 * Compute an equirectangular depth canvas (brighter = nearer) aligned with the
 * panorama. Cached per URL. Throws if WebGPU/the model is unavailable — callers
 * should treat failure as "render flat".
 */
export async function computeEquirectDepth(panoramaUrl: string): Promise<HTMLCanvasElement> {
  const cached = cache.get(panoramaUrl)
  if (cached) return cached

  const pipe = await getPipe()
  const out = await pipe(panoramaUrl)
  const { data, width, height, channels } = out.depth

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('depth: no 2D context')
  const img = ctx.createImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    // DAv2 emits disparity (larger = closer); the normalized map is brighter = nearer.
    const v = data[i * channels]
    const o = i * 4
    img.data[o] = v
    img.data[o + 1] = v
    img.data[o + 2] = v
    img.data[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  cache.set(panoramaUrl, canvas)
  return canvas
}
