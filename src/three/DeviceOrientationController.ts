import * as THREE from 'three'

export type LookMode = 'pointer' | 'device'

export interface LookControls {
  /** Apply the latest look direction + parallax offset to the camera. Call once per frame. */
  update(): void
  /** Attach deviceorientation listeners. Call only after permission is granted. */
  enableDeviceOrientation(): void
  /** Current active mode (flips to 'device' once real sensor data arrives). */
  getMode(): LookMode
  /** The current bounded look-offset (rotation + parallax translation). Currently unused externally. */
  getOffset(): THREE.Vector3
  /** Enable/disable the fake-parallax translation and scale its magnitude. */
  setParallax(enabled: boolean, scale?: number): void
  dispose(): void
}

/**
 * Look-around controller for an equirectangular skybox.
 *
 * - Pointer drag works immediately (desktop + as the gyro fallback).
 * - Device orientation, once enabled and producing data, takes over and the
 *   classic DeviceOrientationControls quaternion algorithm drives the camera
 *   (this controller was removed from three.js core, so it's reimplemented here).
 *
 * On top of rotation it adds a small, bounded camera **translation** so a
 * depth-displaced sphere shows real parallax. A phone reports rotation only, so
 * the translation is faked from three sources, summed and clamped:
 *   1. gyro micro-translation (tilt deltas → a tiny dolly),
 *   2. pointer parallax (cursor position → a lean, desktop),
 *   3. a slow auto-sway so depth reads even when the user is perfectly still.
 * `prefers-reduced-motion` disables the autonomous sway (user-driven parallax stays).
 */
export function createLookControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
): LookControls {
  let mode: LookMode = 'pointer'

  // ── Pointer-drag fallback ────────────────────────────────────────────────
  let lon = 0
  let lat = 0
  let dragging = false
  let lastX = 0
  let lastY = 0
  const SENS = 0.13
  const dir = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()

  const onPointerDown = (e: PointerEvent) => {
    askMotionPermission() // first natural touch unlocks gyro look on iOS (no button)
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    dom.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || mode === 'device') return
    lon -= (e.clientX - lastX) * SENS
    lat += (e.clientY - lastY) * SENS
    lat = Math.max(-85, Math.min(85, lat))
    lastX = e.clientX
    lastY = e.clientY
  }
  const onPointerUp = (e: PointerEvent) => {
    dragging = false
    dom.releasePointerCapture?.(e.pointerId)
  }

  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  dom.addEventListener('pointercancel', onPointerUp)

  // ── Parallax (fake bounded 6DoF) ─────────────────────────────────────────
  let parallaxEnabled = true
  let parallaxScale = 1
  const reducedMotion =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches

  const offset = new THREE.Vector3() // current, eased
  const targetOffset = new THREE.Vector3()
  let pointerNx = 0 // normalised cursor position, -1..1
  let pointerNy = 0
  let gyroBaseInit = false
  let betaBase = 0
  let gammaBase = 0
  const t0 = now()

  // Desktop parallax: track the cursor anywhere on the page (independent of drag).
  const onPointerParallax = (e: PointerEvent) => {
    pointerNx = (e.clientX / window.innerWidth) * 2 - 1
    pointerNy = (e.clientY / window.innerHeight) * 2 - 1
  }
  window.addEventListener('pointermove', onPointerParallax)

  // ── Device orientation ───────────────────────────────────────────────────
  const device = { alpha: 0, beta: 0, gamma: 0, has: false }
  let screenAngle = readScreenAngle()

  const zee = new THREE.Vector3(0, 0, 1)
  const euler = new THREE.Euler()
  const q0 = new THREE.Quaternion()
  // -90° about X — orients the camera to look at the horizon.
  const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))

  const onDeviceOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    device.alpha = THREE.MathUtils.degToRad(e.alpha)
    device.beta = THREE.MathUtils.degToRad(e.beta)
    device.gamma = THREE.MathUtils.degToRad(e.gamma)
    if (!device.has) {
      device.has = true
      mode = 'device'
    }
  }
  const onScreenOrientation = () => {
    screenAngle = readScreenAngle()
  }

  // Bind BOTH event names: some Androids leave `deviceorientation` null and only
  // populate `deviceorientationabsolute`, so listening to just one silently fails.
  let listenersOn = false
  const attachOrientation = () => {
    if (listenersOn) return
    listenersOn = true
    window.addEventListener('deviceorientation', onDeviceOrientation)
    window.addEventListener('deviceorientationabsolute', onDeviceOrientation as EventListener)
    window.addEventListener('orientationchange', onScreenOrientation)
    screen.orientation?.addEventListener('change', onScreenOrientation)
  }

  // iOS 13+ gates the sensor behind a permission that MUST be requested from a user
  // gesture. We ask on the first touch in the world (the user's natural drag), so
  // gyro look turns on by itself — no button. No-op on Android / desktop.
  let motionAsked = false
  const askMotionPermission = () => {
    if (motionAsked) return
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined
    if (DOE && typeof DOE.requestPermission === 'function') {
      motionAsked = true
      DOE.requestPermission()
        .then((r) => {
          if (r === 'granted') attachOrientation()
          else motionAsked = false // let a later gesture retry
        })
        .catch(() => {
          motionAsked = false
        })
    }
  }

  // Called by the Skybox at mount: attach immediately (works on Android, and on iOS
  // once permission is granted — by the landing screen or the first touch above).
  const enableDeviceOrientation = () => {
    attachOrientation()
  }

  // ── Per-frame ────────────────────────────────────────────────────────────
  const clamp = THREE.MathUtils.clamp

  const computeOffset = () => {
    targetOffset.set(0, 0, 0)
    if (parallaxEnabled) {
      // Auto-sway (autonomous → off under reduced-motion).
      if (!reducedMotion) {
        const s = (now() - t0) / 1000
        const A = 5 * parallaxScale
        targetOffset.x += A * Math.sin(s * 0.31)
        targetOffset.y += A * 0.6 * Math.sin(s * 0.23 + 1.7)
        targetOffset.z += A * 0.4 * Math.sin(s * 0.17)
      }
      // Gyro micro-translation (phone): tilt deltas vs a self-centering baseline.
      if (mode === 'device' && device.has) {
        if (!gyroBaseInit) {
          betaBase = device.beta
          gammaBase = device.gamma
          gyroBaseInit = true
        }
        betaBase += (device.beta - betaBase) * 0.01
        gammaBase += (device.gamma - gammaBase) * 0.01
        const kG = 70 * parallaxScale
        targetOffset.x += clamp(device.gamma - gammaBase, -0.5, 0.5) * kG
        targetOffset.y += -clamp(device.beta - betaBase, -0.5, 0.5) * kG
      } else {
        // Pointer parallax (desktop / fine pointer): cursor position → a lean.
        const kP = 13 * parallaxScale
        targetOffset.x += pointerNx * kP
        targetOffset.y += -pointerNy * kP
      }
      // Clamp to a comfortable bubble — beyond this, single-mesh stretch shows.
      const maxR = 26 * parallaxScale
      if (targetOffset.length() > maxR) targetOffset.setLength(maxR)
    }
    offset.lerp(targetOffset, 0.08)
  }

  const update = () => {
    computeOffset()
    camera.position.copy(offset)

    if (mode === 'device' && device.has) {
      euler.set(device.beta, device.alpha, -device.gamma, 'YXZ')
      camera.quaternion.setFromEuler(euler)
      camera.quaternion.multiply(q1)
      camera.quaternion.multiply(q0.setFromAxisAngle(zee, -screenAngle))
    } else {
      const phi = THREE.MathUtils.degToRad(90 - lat)
      const theta = THREE.MathUtils.degToRad(lon)
      dir.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      )
      // Look from the (offset) camera position so the direction stays stable.
      camera.lookAt(lookTarget.copy(offset).add(dir))
    }
  }

  const setParallax = (enabled: boolean, scale?: number) => {
    parallaxEnabled = enabled
    if (scale != null) parallaxScale = scale
  }

  const dispose = () => {
    dom.removeEventListener('pointerdown', onPointerDown)
    dom.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    dom.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('pointermove', onPointerParallax)
    window.removeEventListener('deviceorientation', onDeviceOrientation)
    window.removeEventListener('deviceorientationabsolute', onDeviceOrientation as EventListener)
    window.removeEventListener('orientationchange', onScreenOrientation)
    screen.orientation?.removeEventListener('change', onScreenOrientation)
  }

  return {
    update,
    enableDeviceOrientation,
    getMode: () => mode,
    getOffset: () => offset,
    setParallax,
    dispose,
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function readScreenAngle(): number {
  const angle = screen.orientation?.angle ?? window.orientation ?? 0
  return THREE.MathUtils.degToRad(angle)
}
