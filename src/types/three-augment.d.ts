export {}

// iOS 13+ exposes a *static* requestPermission() on the motion/orientation
// event constructors. The standard lib.dom types don't include it, so we widen
// the global Window's references to those constructors.
declare global {
  interface Window {
    DeviceOrientationEvent: typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
    }
    DeviceMotionEvent: typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
    }
    /** Legacy iOS screen-orientation angle (deprecated, kept as a fallback). */
    orientation?: number
  }
}
