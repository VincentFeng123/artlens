import * as THREE from 'three'

export type LookMode = 'pointer' | 'device'

export interface LookControls {
  /** Apply the latest look direction to the camera. Call once per frame. */
  update(): void
  /** Attach deviceorientation listeners. Call only after permission is granted. */
  enableDeviceOrientation(): void
  /** Current active mode (flips to 'device' once real sensor data arrives). */
  getMode(): LookMode
  dispose(): void
}

/**
 * Look-around controller for an equirectangular skybox.
 *
 * - Pointer drag works immediately (desktop + as the gyro fallback).
 * - Device orientation, once enabled and producing data, takes over and the
 *   classic DeviceOrientationControls quaternion algorithm drives the camera
 *   (this controller was removed from three.js core, so it's reimplemented here).
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
  const target = new THREE.Vector3()

  const onPointerDown = (e: PointerEvent) => {
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

  let deviceEnabled = false
  const enableDeviceOrientation = () => {
    if (deviceEnabled) return
    deviceEnabled = true
    window.addEventListener('deviceorientation', onDeviceOrientation)
    window.addEventListener('orientationchange', onScreenOrientation)
    screen.orientation?.addEventListener('change', onScreenOrientation)
  }

  const update = () => {
    if (mode === 'device' && device.has) {
      euler.set(device.beta, device.alpha, -device.gamma, 'YXZ')
      camera.quaternion.setFromEuler(euler)
      camera.quaternion.multiply(q1)
      camera.quaternion.multiply(q0.setFromAxisAngle(zee, -screenAngle))
    } else {
      const phi = THREE.MathUtils.degToRad(90 - lat)
      const theta = THREE.MathUtils.degToRad(lon)
      target.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      )
      camera.lookAt(target)
    }
  }

  const dispose = () => {
    dom.removeEventListener('pointerdown', onPointerDown)
    dom.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    dom.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('deviceorientation', onDeviceOrientation)
    window.removeEventListener('orientationchange', onScreenOrientation)
    screen.orientation?.removeEventListener('change', onScreenOrientation)
  }

  return { update, enableDeviceOrientation, getMode: () => mode, dispose }
}

function readScreenAngle(): number {
  const angle = screen.orientation?.angle ?? window.orientation ?? 0
  return THREE.MathUtils.degToRad(angle)
}
