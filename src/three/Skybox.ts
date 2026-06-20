import * as THREE from 'three'
import { createLookControls, type LookControls, type LookMode } from './DeviceOrientationController'

export interface SkyboxOptions {
  /** Attach device-orientation control immediately (permission already granted). */
  enableDeviceOrientation?: boolean
  /** Long-edge cap for the panorama texture (mobile GPU memory). Default 4096. */
  maxTextureSize?: number
}

/**
 * Inverted-sphere skybox: the camera sits at the center of a sphere whose
 * normals face inward, so an equirectangular panorama renders on the inside.
 * Owns its own <canvas> (created fresh each instance to avoid WebGL
 * context-reuse issues under React StrictMode double-mounting).
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
  private texture: THREE.Texture | null = null
  private raf = 0
  private readonly onResize = () => this.resize()

  constructor(container: HTMLElement, opts: SkyboxOptions = {}) {
    this.container = container
    this.maxTextureSize = opts.maxTextureSize ?? 4096

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'world__canvas'
    container.appendChild(this.canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
    this.camera.position.set(0, 0, 0)

    this.geometry = new THREE.SphereGeometry(500, 60, 40)
    this.geometry.scale(-1, 1, 1) // flip normals inward
    this.material = new THREE.MeshBasicMaterial({ color: 0x05050c })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.scene.add(this.mesh)

    this.controls = createLookControls(this.camera, this.canvas)
    if (opts.enableDeviceOrientation) this.controls.enableDeviceOrientation()

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
    const source = downscaleIfNeeded(img, this.maxTextureSize)

    const texture = new THREE.Texture(source)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true

    const previous = this.texture
    this.texture = texture
    this.material.map = texture
    this.material.color.set(0xffffff)
    this.material.needsUpdate = true
    previous?.dispose()
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private start(): void {
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.controls.dispose()
    this.texture?.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // required: texture drawn into WebGL
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load panorama: ${url}`))
    img.src = url
  })
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
