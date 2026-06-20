export type PermissionState =
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'not-required'

export interface EntryPermissions {
  camera: PermissionState
  orientation: PermissionState
}

/**
 * Request camera + device-orientation access on the single "Enter" gesture.
 *
 * On iOS 13+, DeviceOrientationEvent.requestPermission() MUST be invoked from
 * inside a user-gesture handler — so it is called first, synchronously, before
 * any await. Camera is then primed (acquired + immediately released) so its
 * permission prompt also appears on this gesture; the scanner re-acquires its
 * own stream afterwards (no second prompt once granted).
 */
export async function requestEntryPermissions(): Promise<EntryPermissions> {
  const result: EntryPermissions = {
    camera: 'unsupported',
    orientation: 'not-required',
  }

  // 1) Orientation — kick off the (async) permission call synchronously.
  let orientationPromise: Promise<PermissionState> | null = null
  if ('DeviceOrientationEvent' in window) {
    const DOE = window.DeviceOrientationEvent
    if (typeof DOE.requestPermission === 'function') {
      orientationPromise = DOE.requestPermission()
        .then((r): PermissionState => (r === 'granted' ? 'granted' : 'denied'))
        .catch((): PermissionState => 'denied')
    } else {
      // Android / desktop: no gating — orientation events fire freely.
      result.orientation = 'not-required'
    }
  } else {
    result.orientation = 'unsupported'
  }

  // 2) Camera — prime the permission on this same gesture.
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      stream.getTracks().forEach((t) => t.stop())
      result.camera = 'granted'
    } catch {
      result.camera = 'denied'
    }
  }

  if (orientationPromise) result.orientation = await orientationPromise
  return result
}
