interface Props {
  onEnter: () => void
  busy: boolean
}

export function LandingScreen({ onEnter, busy }: Props) {
  return (
    <div className="screen landing fade-enter">
      <p className="landing__eyebrow">Artlens</p>
      <h1 className="landing__title">
        Step inside
        <br />
        the painting
      </h1>
      <p className="landing__sub">
        Point your camera at an artwork and the world it depicts wraps around
        you. Move your phone to look around.
      </p>
      <button className="btn-primary" onClick={onEnter} disabled={busy}>
        {busy ? 'Preparing…' : 'Enter'}
      </button>
      <p className="hint">
        Best on a phone. We'll ask for camera and motion access on the next tap.
      </p>
    </div>
  )
}
