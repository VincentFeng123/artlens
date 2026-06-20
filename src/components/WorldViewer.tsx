import { useEffect, useRef, useState } from 'react'
import { Skybox } from '../three/Skybox'
import type { LookMode } from '../three/DeviceOrientationController'
import { GlassPanel } from './GlassPanel'

interface Props {
  panoramaUrl: string
  title: string
  artist: string
  /** Whether device-orientation control may be enabled (permission granted). */
  orientationGranted: boolean
  onScanAnother: () => void
}

export function WorldViewer({
  panoramaUrl,
  title,
  artist,
  orientationGranted,
  onScanAnother,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<LookMode>('pointer')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sky = new Skybox(host, { enableDeviceOrientation: orientationGranted })
    let cancelled = false

    sky.loadPanorama(panoramaUrl).catch((e) => {
      console.error(e)
      if (!cancelled) setFailed(true)
    })

    const probe = window.setInterval(() => setMode(sky.getMode()), 400)

    return () => {
      cancelled = true
      window.clearInterval(probe)
      sky.dispose()
    }
  }, [panoramaUrl, orientationGranted])

  return (
    <div className="screen world fade-enter">
      <div ref={hostRef} className="world__host" />

      <div className="world__overlay-top">
        <GlassPanel className="world__meta">
          <p className="world__meta-title">{title}</p>
          <p className="world__meta-artist">{artist}</p>
        </GlassPanel>
      </div>

      <p className="world__hint">
        {mode === 'device'
          ? 'Move your phone to look around'
          : 'Drag to look around'}
      </p>

      <div className="world__overlay-bottom">
        <button className="btn-ghost" onClick={onScanAnother}>
          Scan another
        </button>
      </div>

      {failed && (
        <div className="world__overlay-top" style={{ top: '50%' }}>
          <GlassPanel className="banner">
            <p className="banner__title">Couldn't load the world</p>
            <p className="banner__msg">
              The panorama failed to load. Try scanning again.
            </p>
            <button className="btn-ghost" onClick={onScanAnother}>
              Scan another
            </button>
          </GlassPanel>
        </div>
      )}
    </div>
  )
}
