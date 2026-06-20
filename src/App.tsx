import { useCallback, useRef, useState } from 'react'
import { LandingScreen } from './components/LandingScreen'
import { ScannerScreen } from './components/ScannerScreen'
import { LoadingScreen } from './components/LoadingScreen'
import { WorldViewer } from './components/WorldViewer'
import { GlassPanel } from './components/GlassPanel'
import { requestEntryPermissions } from './lib/permissions'
import { scanArtwork } from './lib/api'

type Screen = 'landing' | 'scanner' | 'loading' | 'world' | 'error'

interface World {
  url: string
  title: string
  artist: string
}

export function App() {
  const [screen, setScreen] = useState<Screen>('landing')
  const [busy, setBusy] = useState(false)
  const [orientationGranted, setOrientationGranted] = useState(false)
  const [world, setWorld] = useState<World | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef<AbortController | null>(null)

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

  const handleCapture = useCallback(async (jpeg: Blob) => {
    setScreen('loading')
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await scanArtwork(jpeg, ac.signal)
      if (ac.signal.aborted) return
      setWorld({ url: res.panoramaUrl, title: res.title, artist: res.artist })
      setScreen('world')
    } catch (e) {
      if (ac.signal.aborted) return
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.')
      setScreen('error')
    }
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
    case 'loading':
      return <LoadingScreen />
    case 'world':
      return world ? (
        <WorldViewer
          panoramaUrl={world.url}
          title={world.title}
          artist={world.artist}
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
