import * as THREE from 'three'

export interface AtmosphereOptions {
  /** Number of dust motes (tier-dependent). */
  count: number
  /** Tint (averaged from the artwork palette). */
  color: number
  /** Emotional register — nudges drift speed/density. */
  mood?: string
}

/**
 * Cheap "life" layer: a field of slow-drifting dust motes plus a palette-tinted
 * fog. The motes sit at a finite radius (much nearer than the 500-unit photosphere)
 * so they parallax *more* than the panorama as the camera offset moves — an
 * instant, honest depth cue. One draw call. The fog only affects the motes (the
 * photosphere sets `material.fog = false`), so the artwork stays crisp.
 */
export class Atmosphere {
  readonly points: THREE.Points
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.PointsMaterial
  private readonly sprite: THREE.Texture
  private readonly drift: number

  constructor(private readonly scene: THREE.Scene, opts: AtmosphereOptions) {
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    this.drift = reduced ? 0 : moodDrift(opts.mood)

    const n = Math.max(0, opts.count)
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      // Uniform direction on the sphere, radius in a near shell (60..340) so the
      // motes are well inside the photosphere and parallax strongly.
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = 60 + Math.random() * 280
      const s = Math.sqrt(1 - u * u)
      positions[i * 3] = r * s * Math.cos(theta)
      positions[i * 3 + 1] = r * u
      positions[i * 3 + 2] = r * s * Math.sin(theta)
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    this.sprite = makeSoftSprite()
    this.material = new THREE.PointsMaterial({
      color: opts.color,
      map: this.sprite,
      size: 3,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    this.points.renderOrder = 1
    scene.add(this.points)

    // Subtle palette fog — affects only fog-enabled materials (the motes).
    scene.fog = new THREE.FogExp2(opts.color, 0.0016)
  }

  /** Slow autonomous drift so depth reads even when the user is perfectly still. */
  update(dtSeconds: number): void {
    if (this.drift === 0) return
    this.points.rotation.y += this.drift * dtSeconds
    this.points.rotation.x += this.drift * 0.35 * dtSeconds
  }

  dispose(): void {
    this.scene.remove(this.points)
    this.scene.fog = null
    this.geometry.dispose()
    this.material.dispose()
    this.sprite.dispose()
  }
}

/** Calm moods drift slow and wide; tense moods quicker. Radians/second. */
function moodDrift(mood?: string): number {
  const m = (mood ?? '').toLowerCase()
  if (/turbulent|tense|violent|frenzied|storm|anxious|chaotic/.test(m)) return 0.03
  if (/serene|calm|still|quiet|peaceful|weightless|tranquil/.test(m)) return 0.008
  return 0.015
}

/** A soft round sprite so motes are gentle glows, not hard squares. */
function makeSoftSprite(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
