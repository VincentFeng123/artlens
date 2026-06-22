import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseCamera {
  videoRef: React.RefObject<HTMLVideoElement>
  ready: boolean
  error: string | null
  /** Draw the current frame to a canvas (full stream res), export JPEG. */
  capture: () => Promise<Blob | null>
}

// Capture at the full camera-stream resolution (~1080p). The corner-detection +
// rectification pass wants the detail, and the rectified result is the generator's
// init_image — a 1024px crop looked soft. 2048 is above the 1080p stream so frames
// pass through un-downscaled.
const MAX_EDGE = 2048
const JPEG_QUALITY = 0.92

export function useCamera(): UseCamera {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera not supported on this device/browser.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        setReady(true)
      } catch (e) {
        setError(
          e instanceof Error
            ? `${e.name === 'NotAllowedError' ? 'Camera access denied' : e.message}`
            : 'Could not start the camera.',
        )
      }
    }

    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const capture = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return null

    const vw = video.videoWidth
    const vh = video.videoHeight
    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh))
    const w = Math.round(vw * scale)
    const h = Math.round(vh * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)

    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
    )
  }, [])

  return { videoRef, ready, error, capture }
}
