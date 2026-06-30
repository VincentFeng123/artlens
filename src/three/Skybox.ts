import * as THREE from 'three'
import { createLookControls, type LookControls, type LookMode } from './DeviceOrientationController'
import { featherSeam } from './seam'

export interface SkyboxOptions {
  /** Long-edge cap for the panorama texture (mobile GPU memory). Default 4096. */
  maxTextureSize?: number
}

const BASE_FOV = 75 // vertical fov in landscape (gives a wide horizontal there)
const PORTRAIT_HFOV = 92 // target HORIZONTAL fov on a tall phone, else it goes telephoto-narrow
const FOV_MAX = 100 // cap the vertical fov so portrait never fisheyes
const ENTRY_EXTRA = 9 // entry starts this much wider, easing in to the target fov
const ENTRY_MS = 750
const DISPLACE_LERP = 0.06 // per-frame ease of the depth "inflate"

/** Device capability tier — chooses tessellation, pixel ratio, and parallax. */
interface Tier {
  segW: number
  segH: number
  pixelCap: number
  /** Max inward push of near content, in world units (sphere radius is 500). */
  displace: number
  /** Parallax magnitude scale (0 disables). */
  parallax: number
}

/**
 * Inverted-sphere skybox: the camera sits at the center of a sphere whose
 * normals face inward, so an equirectangular panorama renders on the inside.
 *
 * When a depth map is supplied (Blockade's free map or one computed in-browser),
 * the sphere is tessellated and its vertices are pushed radially inward by depth
 * in a patched MeshBasicMaterial vertex shader — turning the flat skybox into a
 * depth-parallax scene. With no depth it renders identically to a plain skybox.
 * Owns its own <canvas> (created fresh each instance to avoid WebGL context-reuse
 * issues under React StrictMode double-mounting).
 */
export class Skybox {
  private readonly container: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly geometry: THREE.SphereGeometry
  private readonly material: THREE.MeshBasicMaterial
  private readonly mesh: THREE.Mesh
  private readonly controls: LookControls
  private readonly maxTextureSize: number
  private readonly tier: Tier
  private texture: THREE.Texture | null = null
  private depthTexture: THREE.Texture | null = null
  private readonly fallbackDepth: THREE.DataTexture
  private disposed = false
  private raf = 0
  private readonly onResize = () => this.resize()

  // Depth-displacement uniforms, shared into the patched shader by reference.
  private readonly depthU = {
    depthMap: { value: null as THREE.Texture | null },
    uHasDepth: { value: 0 },
    uDisplace: { value: 0 },
    uDepthSign: { value: 1 },
    uPoleFade: { value: 0.12 },
    uSeamEps: { value: 0.012 },
  }
  private displaceTarget = 0
  private displaceCur = 0

  // Entry "step into the painting" FOV ease.
  private entering = false
  private entryStart = 0

  // FPS watchdog → graceful degradation.
  private frames = 0
  private fpsStart = 0
  private lowStreak = 0
  private degradeStep = 0

  constructor(container: HTMLElement, opts: SkyboxOptions = {}) {
    this.container = container
    this.maxTextureSize = opts.maxTextureSize ?? 4096
    this.tier = pickTier()

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'world__canvas'
    container.appendChild(this.canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.tier.pixelCap))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x05050c, 1) // dark, so a seam/pole gap never flashes bright

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 1000)
    this.camera.position.set(0, 0, 0)

    this.geometry = new THREE.SphereGeometry(500, this.tier.segW, this.tier.segH)
    this.geometry.scale(-1, 1, 1) // flip normals inward

    // 1×1 black depth so the sampler is always bound (uHasDepth gates its use).
    this.fallbackDepth = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    this.fallbackDepth.needsUpdate = true
    this.depthU.depthMap.value = this.fallbackDepth

    // fog:false keeps the panorama crisp.
    this.material = new THREE.MeshBasicMaterial({ color: 0x05050c, fog: false })
    this.patchMaterial(this.material)
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.scene.add(this.mesh)

    this.controls = createLookControls(this.camera, this.canvas)
    this.controls.setParallax(this.tier.parallax > 0, this.tier.parallax)
    // Always wire gyro look: it activates by itself on Android, and on iOS after the
    // landing-screen permission or the user's first touch (no button needed).
    this.controls.enableDeviceOrientation()

    this.resize()
    window.addEventListener('resize', this.onResize)
    this.start()
  }

  enableDeviceOrientation(): void {
    this.controls.enableDeviceOrientation()
  }

  getMode(): LookMode {
    return this.controls.getMode()
  }

  /** Load an equirectangular panorama (remote or local) as the skybox texture. */
  async loadPanorama(url: string): Promise<void> {
    const img = await loadImage(url)
    if (this.disposed) return // unmounted while the image was loading
    const source = featherPanorama(downscaleIfNeeded(img, this.maxTextureSize))

    const texture = new THREE.Texture(source)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.wrapS = THREE.RepeatWrapping // sample across the ±180° join → no edge seam
    texture.needsUpdate = true

    const previous = this.texture
    this.texture = texture
    this.material.map = texture
    this.material.color.set(0xffffff)
    this.material.needsUpdate = true
    previous?.dispose()
  }

  /**
   * Supply a depth map (equirectangular, aligned with the panorama). Accepts a URL
   * or a ready canvas (the in-browser path). It is normalized (percentile-clipped +
   * lightly blurred, brighter = nearer) and the displacement ramps in.
   * `invert: true` when the source encodes far = bright.
   */
  async loadDepth(src: string | HTMLCanvasElement, opts: { invert?: boolean } = {}): Promise<void> {
    const img = typeof src === 'string' ? await loadImage(src) : src
    const canvas = normalizeDepth(img)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.NoColorSpace // depth is data, not colour
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.wrapS = THREE.RepeatWrapping // valid wrap for the ±180° seam blend
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true

    const previous = this.depthTexture
    this.depthTexture = tex
    this.depthU.depthMap.value = tex
    this.depthU.uDepthSign.value = opts.invert ? -1 : 1
    this.depthU.uHasDepth.value = 1
    this.displaceTarget = this.tier.displace
    previous?.dispose()
  }

  /** Play the one-shot entry: a subtle FOV pull-in ("stepping into the painting"). */
  playEntry(): void {
    this.entering = true
    this.entryStart = nowMs()
  }

  private patchMaterial(material: THREE.MeshBasicMaterial): void {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.depthMap = this.depthU.depthMap
      shader.uniforms.uHasDepth = this.depthU.uHasDepth
      shader.uniforms.uDisplace = this.depthU.uDisplace
      shader.uniforms.uDepthSign = this.depthU.uDepthSign
      shader.uniforms.uPoleFade = this.depthU.uPoleFade
      shader.uniforms.uSeamEps = this.depthU.uSeamEps
      shader.vertexShader =
        'uniform sampler2D depthMap;\n' +
        'uniform float uHasDepth;\n' +
        'uniform float uDisplace;\n' +
        'uniform float uDepthSign;\n' +
        'uniform float uPoleFade;\n' +
        'uniform float uSeamEps;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            '#ifdef USE_UV',
            'if (uHasDepth > 0.5) {',
            '  float d = texture2D(depthMap, uv).r;',
            '  if (uv.x < uSeamEps || uv.x > 1.0 - uSeamEps) {',
            '    float dw = texture2D(depthMap, vec2(fract(uv.x + 0.5), uv.y)).r;',
            '    d = mix(d, dw, 0.5);',
            '  }',
            '  d = uDepthSign > 0.0 ? d : (1.0 - d);', // standardize: brighter = nearer
            '  float lat = abs(uv.y - 0.5) * 2.0;', // 0 at equator, 1 at poles
            '  float poleW = 1.0 - smoothstep(1.0 - uPoleFade, 1.0, lat);',
            '  float seamW = smoothstep(0.0, uSeamEps, min(uv.x, 1.0 - uv.x));', // 0 at the wrap
            '  float disp = d * uDisplace * poleW * seamW;', // fade to 0 at the seam so the wrap edges never separate
            '  transformed -= normalize(position) * disp;',
            '}',
            '#endif',
          ].join('\n'),
        )
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    if (!this.entering) this.camera.fov = this.targetFov()
    this.camera.updateProjectionMatrix()
  }

  /**
   * Comfortable vertical fov for the current aspect. A tall portrait phone at a
   * fixed 75° vertical fov only shows a ~39° horizontal slice — the world reads as
   * tiny and zoomed-in. In portrait we aim for a wide HORIZONTAL fov and derive the
   * vertical from it (capped so it never fisheyes). Landscape keeps the base fov.
   */
  private targetFov(): number {
    const aspect = this.camera.aspect || 1
    if (aspect >= 1) return BASE_FOV
    const h = THREE.MathUtils.degToRad(PORTRAIT_HFOV)
    const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect))
    return Math.min(v, FOV_MAX)
  }

  private start(): void {
    this.fpsStart = nowMs()
    const loop = () => {
      this.raf = requestAnimationFrame(loop)

      this.controls.update()

      // Ease the depth displacement in (and out, if degraded).
      this.displaceCur += (this.displaceTarget - this.displaceCur) * DISPLACE_LERP
      this.depthU.uDisplace.value = this.displaceCur

      // Entry FOV pull-in: start a touch wider than the target and ease in.
      if (this.entering) {
        const t = Math.min(1, (nowMs() - this.entryStart) / ENTRY_MS)
        const e = 1 - Math.pow(1 - t, 3) // easeOutCubic
        this.camera.fov = this.targetFov() + ENTRY_EXTRA * (1 - e)
        this.camera.updateProjectionMatrix()
        if (t >= 1) this.entering = false
      }

      this.watchdog()
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  /** Rolling-FPS watchdog: step down quality if the device can't keep up. */
  private watchdog(): void {
    this.frames++
    const elapsed = nowMs() - this.fpsStart
    if (elapsed < 1000) return
    const fps = (this.frames * 1000) / elapsed
    this.frames = 0
    this.fpsStart = nowMs()
    if (fps >= 28 || this.degradeStep >= 2) {
      this.lowStreak = 0
      return
    }
    if (++this.lowStreak < 2) return
    this.lowStreak = 0
    if (this.degradeStep === 0) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1)) // biggest fill-rate win
      this.degradeStep = 1
    } else {
      this.controls.setParallax(false) // recenters; static depth remains
      this.displaceTarget = 0
      this.degradeStep = 2
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.controls.dispose()
    this.texture?.dispose()
    this.depthTexture?.dispose()
    this.fallbackDepth.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }
}

/** Pick a capability tier from coarse device signals. */
function pickTier(): Tier {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || (coarse ? 4 : 8)
  const dpr = window.devicePixelRatio || 1
  const weak = coarse && (cores <= 4 || dpr <= 1.5)

  if (!coarse && cores >= 8) {
    return { segW: 160, segH: 96, pixelCap: 2, displace: 180, parallax: 1 }
  }
  if (weak) {
    return { segW: 96, segH: 64, pixelCap: 1.5, displace: 110, parallax: 0.5 }
  }
  return { segW: 128, segH: 80, pixelCap: 2, displace: 150, parallax: 0.8 }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // required: texture drawn into WebGL
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

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

function downscaleIfNeeded(
  img: HTMLImageElement,
  maxEdge: number,
): HTMLImageElement | HTMLCanvasElement {
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  if (longest <= maxEdge) return img
  const scale = maxEdge / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return img
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Normalize a depth image into a clean displacement source: downscale to a small
 * grayscale field, clip outliers (2nd/98th percentile) so sky/specular pixels
 * don't crush the range, renormalize to [0,1], and 3×3 box-blur to soften edges
 * (suppresses rubber-sheet stretch at depth discontinuities).
 */
function normalizeDepth(
  img: HTMLImageElement | HTMLCanvasElement,
  w = 512,
  h = 256,
): HTMLCanvasElement {
  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sctx = src.getContext('2d')!
  sctx.drawImage(img, 0, 0, w, h)
  const data = sctx.getImageData(0, 0, w, h)
  const px = data.data
  const n = w * h

  // Luminance per pixel.
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    lum[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]
  }

  // Percentile clip (2% / 98%).
  const sorted = Float32Array.from(lum).sort()
  const lo = sorted[Math.floor(n * 0.02)]
  const hi = sorted[Math.floor(n * 0.98)]
  const range = Math.max(1e-3, hi - lo)
  const norm = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    norm[i] = Math.min(1, Math.max(0, (lum[i] - lo) / range))
  }

  // 3×3 box blur.
  const out = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let cnt = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += norm[yy * w + xx]
          cnt++
        }
      }
      out[y * w + x] = sum / cnt
    }
  }

  for (let i = 0; i < n; i++) {
    const v = Math.round(out[i] * 255)
    const o = i * 4
    px[o] = v
    px[o + 1] = v
    px[o + 2] = v
    px[o + 3] = 255
  }
  sctx.putImageData(data, 0, 0)
  return src
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
