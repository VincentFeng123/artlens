import { useEffect, useState } from 'react'

const LINES = [
  'Recognizing the artwork…',
  'Reading its palette and mood…',
  'Imagining the scene beyond the frame…',
  'Building your world…',
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
      <div className="loading__orb" aria-hidden />
      <h2 className="loading__title">Building your world</h2>
      <p className="loading__status" key={i}>
        {LINES[i]}
      </p>
    </div>
  )
}
