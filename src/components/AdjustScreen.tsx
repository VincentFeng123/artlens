import { useEffect, useRef, useState } from 'react'
import { CornerEditor } from '../lib/cornerEditor'
import { ensureCv, detect, warp } from '../lib/rectify'
import { DossierControls } from './DossierControls'
import { getPref, setPref } from '../lib/contentPref'

interface Props {
  /** The freshly captured photo. */
  capture: Blob
  /** Called with the flattened, straight-on artwork (fed to the generator). */
  onConfirm: (rectified: Blob) => void
  /** Go back and take another photo. */
  onRetake: () => void
}

const MAX_SOURCE_DIM = 2560 // working resolution cap (detection speed / memory)

/** Load a blob into a source canvas, respecting EXIF orientation, capped in size. */
async function blobToSourceCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = rej
      img.src = URL.createObjectURL(blob)
    })
  }
  const bw = (bmp as ImageBitmap).width || (bmp as HTMLImageElement).naturalWidth
  const bh = (bmp as ImageBitmap).height || (bmp as HTMLImageElement).naturalHeight
  const scl = Math.min(1, MAX_SOURCE_DIM / Math.max(bw, bh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bw * scl)
  canvas.height = Math.round(bh * scl)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  if ('close' in bmp) bmp.close()
  return canvas
}

export function AdjustScreen({ capture, onConfirm, onRetake }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<CornerEditor | null>(null)
  const sourceRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'working' | 'error'>('loading')
  const [statusText, setStatusText] = useState('Reading photo…')
  const [pref, setLocalPref] = useState(getPref)

  useEffect(() => {
    let cancelled = false
    const editor = new CornerEditor(canvasRef.current!)
    editorRef.current = editor

    ;(async () => {
      try {
        const source = await blobToSourceCanvas(capture)
        if (cancelled) return
        sourceRef.current = source
        setStatusText('Loading the detector…')
        await ensureCv()
        if (cancelled) return
        setStatusText('Detecting edges…')
        // Let the status paint before the synchronous OpenCV work.
        await new Promise((r) => setTimeout(r, 20))
        if (cancelled) return
        editor.setImage(source, detect(source))
        setStatus('ready')
      } catch (e) {
        console.error(e)
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      editor.dispose()
    }
  }, [capture])

  const reDetect = () => {
    const s = sourceRef.current
    if (s && status === 'ready') editorRef.current?.setImage(s, detect(s))
  }

  const rotate90 = () => {
    const s = sourceRef.current
    if (!s || status !== 'ready') return
    const out = document.createElement('canvas')
    out.width = s.height
    out.height = s.width
    const ctx = out.getContext('2d')!
    ctx.translate(out.width, 0)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(s, 0, 0)
    sourceRef.current = out
    editorRef.current?.setImage(out, detect(out))
  }

  const buildWorld = () => {
    const s = sourceRef.current
    const editor = editorRef.current
    if (!s || !editor || status !== 'ready') return
    setStatus('working')
    setStatusText('Flattening the artwork…')
    // Defer so the status paints before the synchronous warp.
    setTimeout(() => {
      try {
        const out = warp(s, editor.getCorners())
        out.toBlob(
          (blob) => {
            if (blob) onConfirm(blob)
            else setStatus('error')
          },
          'image/jpeg',
          0.92,
        )
      } catch (e) {
        console.error(e)
        setStatus('error')
      }
    }, 30)
  }

  if (status === 'error') {
    return (
      <div className="screen fade-enter">
        <div className="glass banner">
          <p className="banner__title">Couldn't read that photo</p>
          <p className="banner__msg">Try again with the artwork well-lit and in frame.</p>
          <button className="btn-primary" onClick={onRetake}>
            Retake
          </button>
        </div>
      </div>
    )
  }

  const busy = status !== 'ready'

  return (
    <div className="screen adjust fade-enter">
      <div className="adjust__wrap">
        <canvas ref={canvasRef} className="adjust__canvas" />
        {busy && (
          <div className="adjust__veil">
            <div className="adjust__spinner" aria-hidden />
            <p className="adjust__veil-text">{statusText}</p>
          </div>
        )}
      </div>
      <p className="adjust__hint">Drag the four corners onto the artwork's edges.</p>
      <div className="adjust__controls">
        <DossierControls
          value={pref}
          onChange={(next) => { setPref(next); setLocalPref(next) }}
        />
      </div>
      <div className="adjust__toolbar">
        <button className="btn-ghost" onClick={reDetect} disabled={busy}>
          Re-detect
        </button>
        <button className="btn-ghost" onClick={rotate90} disabled={busy}>
          Rotate 90°
        </button>
        <button className="btn-ghost" onClick={onRetake}>
          Retake
        </button>
        <button className="btn-primary" onClick={buildWorld} disabled={busy}>
          Step inside →
        </button>
      </div>
    </div>
  )
}
