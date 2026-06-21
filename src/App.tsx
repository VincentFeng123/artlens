import { useCallback, useRef, useState } from 'react'
import { LandingScreen } from './components/LandingScreen'
import { ScannerScreen } from './components/ScannerScreen'
import { LoadingScreen } from './components/LoadingScreen'
import { WorldViewer } from './components/WorldViewer'
import { GlassPanel } from './components/GlassPanel'
import { requestEntryPermissions } from './lib/permissions'
import { scanArtwork } from './lib/api'
import { cropToBox } from './lib/crop'
import type { ArtworkMeta } from '../shared/types'

type Screen = 'landing' | 'scanner' | 'loading' | 'world' | 'error'

interface World {
  url: string
  depthUrl?: string
  /** Object URL of the captured frame — the real artwork shown inside the world. */
  artworkUrl?: string
  meta: ArtworkMeta
}

export function App() {
  const [screen, setScreen] = useState<Screen>('landing')
  const [busy, setBusy] = useState(false)
  const [orientationGranted, setOrientationGranted] = useState(false)
  const [world, setWorld] = useState<World | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const artworkUrlRef = useRef<string | null>(null)

  const clearArtworkUrl = useCallback(() => {
    if (artworkUrlRef.current) {
      URL.revokeObjectURL(artworkUrlRef.current)
      artworkUrlRef.current = null
    }
  }, [])

  const handleEnter = useCallback(async () => {
    setBusy(true)
    try {
      const perms = await requestEntryPermissions()
      setOrientationGranted(
        perms.orientation === 'granted' || perms.orientation === 'not-required',
      )
      setScreen('scanner')
    } finally {
      setBusy(false)
    }
  }, [])

  const handleCapture = useCallback(
    async (jpeg: Blob) => {
      setScreen('loading')
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const res = await scanArtwork(jpeg, ac.signal)
        if (ac.signal.aborted) return
        // Crop the captured frame down to just the artwork (clean centerpiece).
        const artworkBlob = await cropToBox(jpeg, res.meta?.artwork_box)
        if (ac.signal.aborted) return
        clearArtworkUrl()
        const artworkUrl = URL.createObjectURL(artworkBlob)
        artworkUrlRef.current = artworkUrl
        setWorld({ url: res.panoramaUrl, depthUrl: res.depthUrl, artworkUrl, meta: res.meta })
        setScreen('world')
      } catch (e) {
        if (ac.signal.aborted) return
        setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.')
        setScreen('error')
      }
    },
    [clearArtworkUrl],
  )

  const handleScanAnother = useCallback(() => {
    abortRef.current?.abort()
    clearArtworkUrl()
    setWorld(null)
    setScreen('scanner')
  }, [clearArtworkUrl])

  const handleRetry = useCallback(() => {
    abortRef.current?.abort()
    clearArtworkUrl()
    setScreen('scanner')
  }, [clearArtworkUrl])

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
    case 'loading':
      return <LoadingScreen />
    case 'world':
      return world ? (
        <WorldViewer
          panoramaUrl={world.url}
          depthUrl={world.depthUrl}
          artworkUrl={world.artworkUrl}
          meta={world.meta}
          orientationGranted={orientationGranted}
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
