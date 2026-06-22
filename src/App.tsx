import { useCallback, useRef, useState } from 'react'
import { LandingScreen } from './components/LandingScreen'
import { ScannerScreen } from './components/ScannerScreen'
import { AdjustScreen } from './components/AdjustScreen'
import { LoadingScreen } from './components/LoadingScreen'
import { WorldViewer } from './components/WorldViewer'
import { GlassPanel } from './components/GlassPanel'
import { requestEntryPermissions } from './lib/permissions'
import { scanArtwork } from './lib/api'
import type { ArtworkMeta } from '../shared/types'

type Screen = 'landing' | 'scanner' | 'adjust' | 'loading' | 'world' | 'error'

interface World {
  url: string
  depthUrl?: string
  meta: ArtworkMeta
}

export function App() {
  const [screen, setScreen] = useState<Screen>('landing')
  const [busy, setBusy] = useState(false)
  const [capture, setCapture] = useState<Blob | null>(null)
  const [world, setWorld] = useState<World | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const handleEnter = useCallback(async () => {
    setBusy(true)
    try {
      // Primes camera access, and grants the iOS motion permission early so gyro look
      // works the moment you enter a world (the world also re-asks on first touch).
      await requestEntryPermissions()
      setScreen('scanner')
    } finally {
      setBusy(false)
    }
  }, [])

  // Captured a frame → go adjust the artwork corners before generating.
  const handleCapture = useCallback((jpeg: Blob) => {
    setCapture(jpeg)
    setScreen('adjust')
  }, [])

  // Corners confirmed → rectified artwork goes to the generator (Blockade init_image).
  const handleAdjustConfirm = useCallback(async (rectified: Blob) => {
    setScreen('loading')
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await scanArtwork(rectified, ac.signal)
      if (ac.signal.aborted) return
      setWorld({ url: res.panoramaUrl, depthUrl: res.depthUrl, meta: res.meta })
      setScreen('world')
    } catch (e) {
      if (ac.signal.aborted) return
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.')
      setScreen('error')
    }
  }, [])

  const handleRetake = useCallback(() => {
    abortRef.current?.abort()
    setScreen('scanner')
  }, [])

  const handleScanAnother = useCallback(() => {
    abortRef.current?.abort()
    setWorld(null)
    setScreen('scanner')
  }, [])

  const handleRetry = useCallback(() => {
    abortRef.current?.abort()
    setScreen('scanner')
  }, [])

  switch (screen) {
    case 'landing':
      return <LandingScreen onEnter={handleEnter} busy={busy} />
    case 'scanner':
      return (
        <ScannerScreen
          onCapture={handleCapture}
          onCancel={() => setScreen('landing')}
        />
      )
    case 'adjust':
      return capture ? (
        <AdjustScreen
          capture={capture}
          onConfirm={handleAdjustConfirm}
          onRetake={handleRetake}
        />
      ) : null
    case 'loading':
      return <LoadingScreen />
    case 'world':
      return world ? (
        <WorldViewer
          panoramaUrl={world.url}
          depthUrl={world.depthUrl}
          meta={world.meta}
          onScanAnother={handleScanAnother}
        />
      ) : null
    case 'error':
      return (
        <div className="screen fade-enter">
          <GlassPanel className="banner">
            <p className="banner__title">Couldn't build your world</p>
            <p className="banner__msg">{errorMsg}</p>
            <button className="btn-primary" onClick={handleRetry}>
              Try again
            </button>
          </GlassPanel>
        </div>
      )
  }
}
