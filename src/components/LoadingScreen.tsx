import { useEffect, useState } from 'react'

const LINES = [
  'Recognizing the artwork…',
  'Reading its palette and mood…',
  'Imagining the scene beyond the frame…',
  'Painting your world…',
  'Rendering in high resolution — this can take a minute…',
  'Almost there…',
]

export function LoadingScreen() {
  const [i, setI] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % LINES.length), 2600)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="screen loading fade-enter">
      <div className="loading__loader" aria-hidden>
        <div className="loaders">
          {Array.from({ length: 10 }).map((_, n) => (
            <div key={n} className="loader" />
          ))}
        </div>
        <div className="loadersB">
          {Array.from({ length: 9 }).map((_, n) => (
            <div key={n} className="loaderA">
              <div className={`ball${n}`} />
            </div>
          ))}
        </div>
      </div>
      <h2 className="loading__title">Building your world</h2>
      <p className="loading__status" key={i}>
        {LINES[i]}
      </p>
    </div>
  )
}
