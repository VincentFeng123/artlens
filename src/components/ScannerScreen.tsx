import { useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { GlassPanel } from './GlassPanel'

interface Props {
  onCapture: (jpeg: Blob) => void
  onCancel: () => void
}

export function ScannerScreen({ onCapture, onCancel }: Props) {
  const { videoRef, ready, error, capture } = useCamera()
  const [busy, setBusy] = useState(false)

  async function handleCapture() {
    if (busy || !ready) return
    setBusy(true)
    const blob = await capture()
    if (blob) {
      onCapture(blob)
    } else {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="screen fade-enter">
        <GlassPanel className="banner">
          <p className="banner__title">Camera unavailable</p>
          <p className="banner__msg">
            {error}. Make sure the page is served over HTTPS and that camera
            access is allowed.
          </p>
          <button className="btn-ghost" onClick={onCancel}>
            Back
          </button>
        </GlassPanel>
      </div>
    )
  }

  return (
    <div className="screen scanner fade-enter">
      <video
        ref={videoRef}
        className="scanner__video"
        playsInline
        muted
        autoPlay
      />
      <div className="scanner__scrim" />
      <div className="reticle" aria-hidden>
        <span className="reticle__corner reticle__corner--tl" />
        <span className="reticle__corner reticle__corner--tr" />
        <span className="reticle__corner reticle__corner--bl" />
        <span className="reticle__corner reticle__corner--br" />
      </div>
      <p className="scanner__caption">
        {ready ? 'Frame the artwork, then capture' : 'Starting camera…'}
      </p>
      <div className="scanner__controls">
        <button
          className="shutter"
          aria-label="Capture artwork"
          onClick={handleCapture}
          disabled={!ready || busy}
        />
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
