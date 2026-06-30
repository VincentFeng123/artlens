import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Skybox } from '../three/Skybox'
import type { LookMode } from '../three/DeviceOrientationController'
import { type ArtworkMeta, type GlossaryTerm, type Locale, type Realization, type SymbolNote } from '../../shared/types'
import { paletteColor } from '../lib/paletteColor'
import { cropManyToBoxes } from '../lib/crop'
import { getPref } from '../lib/contentPref'
import { localizeDossier } from '../lib/localize'
import { termRegex } from '../lib/glossary'

interface Props {
  panoramaUrl: string
  /** Equirectangular depth PNG for parallax; when absent, computed in-browser. */
  depthUrl?: string
  /**
   * Render strategy from the router. 'flat' suppresses depth displacement so a
   * prominent figure isn't rubber-sheeted; undefined/'depth' keep today's
   * behavior. ('layered' is Milestone B and also keeps depth for now.)
   */
  realization?: Realization
  meta: ArtworkMeta
  /**
   * The flattened, straight-on artwork — the exact image recognition saw, so
   * symbolism boxes line up. Used to crop real fragments into the sheet; absent
   * for demo/cached worlds, in which case those rows fall back to text only.
   */
  sourceImage?: Blob
  artworkId?: string
  onScanAnother: () => void
}

interface DragState {
  startY: number
  base: number // openness at gesture start: 0 (peek) or 1 (full)
  p: number // live openness 0..1
  moved: number // max travel, to distinguish tap from drag
  lastY: number
  lastT: number
  vy: number // px/ms, upward positive
}

export function WorldViewer({
  panoramaUrl,
  depthUrl,
  realization,
  meta: initialMeta,
  sourceImage,
  artworkId,
  onScanAnother,
}: Props) {
  const [meta, setMeta] = useState<ArtworkMeta>(initialMeta)
  // The dossier language/level is chosen before entry (on the Adjust screen) and
  // fixed for the session — read once; the effect below fetches that variant so
  // the world opens already in the chosen language.
  const [pref] = useState(getPref)
  // Reset to the base when a new artwork is scanned.
  useEffect(() => { setMeta(initialMeta) }, [initialMeta])

  useEffect(() => {
    let cancelled = false
    if (pref.lang === 'en' && pref.level === 'medium') { setMeta(initialMeta); return }
    localizeDossier({ artworkId, lang: pref.lang, level: pref.level, base: initialMeta })
      .then((m) => { if (!cancelled) setMeta(m) })
    return () => { cancelled = true }
  }, [pref.lang, pref.level, artworkId, initialMeta])

  const hostRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<LookMode>('pointer')
  const [failed, setFailed] = useState(false)

  // Detail crops live behind the sheet: generate once it's first opened (a closed
  // scan pays nothing), then keep them. `loupe` holds the URL of an enlarged crop.
  const [hasOpened, setHasOpened] = useState(false)
  const symbolCrops = useSymbolCrops(sourceImage, meta.symbolism, hasOpened)
  const [loupe, setLoupe] = useState<string | null>(null)
  const [activeColor, setActiveColor] = useState<number | null>(null)

  // Bottom-sheet state: `open` is the snapped target; `dragP` is the live
  // openness (0..1) while a drag is in flight (null when settled).
  const [open, setOpen] = useState(false)
  const [dragP, setDragP] = useState<number | null>(null)
  const drag = useRef<DragState | null>(null)
  // True only once the card has fully risen and settled at the top. Drives the
  // top corners square — they stay rounded while it's still moving.
  const [atTop, setAtTop] = useState(false)

  // When fully closed-and-settled the card is "parked": pulled out of view so
  // its grabber can never peek above the bottom (which read as a 2nd pull-tab).
  const [parked, setParked] = useState(true)
  const parkTimer = useRef<number | null>(null)
  const unpark = () => {
    if (parkTimer.current != null) {
      window.clearTimeout(parkTimer.current)
      parkTimer.current = null
    }
    setParked(false)
  }
  const schedulePark = () => {
    if (parkTimer.current != null) window.clearTimeout(parkTimer.current)
    parkTimer.current = window.setTimeout(() => {
      setParked(true)
      parkTimer.current = null
    }, 460)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sky = new Skybox(host)
    let cancelled = false

    void (async () => {
      try {
        // Load the panorama with one retry — transient image/network blips
        // shouldn't drop the whole world.
        try {
          await sky.loadPanorama(panoramaUrl)
        } catch (firstErr) {
          if (cancelled) return
          console.warn('panorama load failed; retrying once', firstErr)
          await new Promise((r) => setTimeout(r, 500))
          if (cancelled) return
          await sky.loadPanorama(panoramaUrl)
        }
        if (cancelled) return
        sky.playEntry() // step into the world immediately on the flat sphere

        // Depth → parallax, fully decoupled from the panorama: it loads later, in
        // the background, and ANY failure is swallowed (the sphere just stays
        // flat). Prefer the backend's map (Blockade); otherwise compute one
        // in-browser. Opt out entirely with localStorage['artlens:depth']='0'.
        const depthEnabled = (() => {
          try {
            return localStorage.getItem('artlens:depth') !== '0'
          } catch {
            return true
          }
        })()
        // Flat-figure guard: when the router chose 'flat' (e.g. a prominent
        // figure), never bind depth — the single connected mesh would smear the
        // silhouette under parallax. Leave the sphere flat.
        if (!depthEnabled || realization === 'flat') return

        if (depthUrl) {
          sky.loadDepth(depthUrl).catch((e) =>
            console.warn('depth load failed; rendering flat', e),
          )
        } else if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
          // WebGPU only (the WASM backend would freeze the main thread). Deferred
          // so the heavy model load never competes with first paint.
          window.setTimeout(() => {
            if (cancelled) return
            import('../lib/depth')
              .then((m) => m.computeEquirectDepth(panoramaUrl))
              .then((canvas) => {
                if (!cancelled) return sky.loadDepth(canvas)
              })
              .catch((e) => console.warn('in-browser depth failed; rendering flat', e))
          }, 800)
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) setFailed(true)
      }
    })()

    const probe = window.setInterval(() => setMode(sky.getMode()), 400)

    return () => {
      cancelled = true
      window.clearInterval(probe)
      sky.dispose()
    }
  }, [panoramaUrl, depthUrl, realization])

  // Escape closes the loupe first if it's up, otherwise the sheet.
  useEffect(() => {
    if (!open && !loupe) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (loupe) setLoupe(null)
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, loupe])

  // Un-park the instant we open; re-park once the close animation has settled
  // (covers backdrop/Escape closes that don't go through the pointer handlers).
  useEffect(() => {
    if (open) {
      unpark()
      setHasOpened(true)
    } else {
      schedulePark()
      setAtTop(false) // round the corners as soon as it leaves the top
    }
    return () => {
      if (parkTimer.current != null) window.clearTimeout(parkTimer.current)
    }
  }, [open])

  // Pull-to-dismiss: when the open sheet is scrolled to the very top and the user
  // keeps pulling DOWN (touch) or scroll-wheels UP (desktop), the sheet follows
  // the gesture and slides away on release — instead of dead-ending at the top.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return

    let lastY = 0
    let lastT = 0
    let vy = 0 // upward-positive px/ms, matching the grabber drag
    let p = 1
    let engaged = false
    let engageY = 0

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      lastY = e.touches[0].clientY
      lastT = e.timeStamp
      vy = 0
      p = 1
      engaged = false
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const y = e.touches[0].clientY
      const dt = e.timeStamp - lastT
      if (dt > 0) vy = (lastY - y) / dt
      if (!engaged) {
        // Engage only at the very top while moving down; otherwise scroll natively.
        if (el.scrollTop <= 0 && y - lastY > 1) {
          engaged = true
          engageY = y
          setAtTop(false)
          unpark()
        } else {
          lastY = y
          lastT = e.timeStamp
          return
        }
      }
      e.preventDefault() // we own the gesture now — no native rubber-band
      const h = window.innerHeight || 1
      p = Math.max(0, Math.min(1, 1 - (y - engageY) / h))
      setDragP(p)
      lastY = y
      lastT = e.timeStamp
    }
    const end = () => {
      if (!engaged) return
      engaged = false
      const next = vy < -0.4 ? false : vy > 0.4 ? true : p > 0.5
      setDragP(null)
      setOpen(next)
      if (next) unpark()
      else schedulePark()
    }

    let wheelAccum = 0
    const onWheel = (e: WheelEvent) => {
      if (el.scrollTop > 0 || e.deltaY >= 0) {
        wheelAccum = 0
        return
      }
      wheelAccum += -e.deltaY // scrolling up past the top
      if (wheelAccum > 60) {
        wheelAccum = 0
        setOpen(false)
        schedulePark()
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      el.removeEventListener('wheel', onWheel)
    }
    // Re-bind when open flips; setters/unpark/schedulePark behave statelessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Drag handling (shared by the peek and the card grabber) ───────────────
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button != null && e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    unpark() // reveal the card so it can rise with the drag
    setAtTop(false) // round the corners the instant a drag starts
    const base = open ? 1 : 0
    drag.current = {
      startY: e.clientY,
      base,
      p: base,
      moved: 0,
      lastY: e.clientY,
      lastT: e.timeStamp,
      vy: 0,
    }
    setDragP(base)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const h = window.innerHeight || 1
    const p = Math.max(0, Math.min(1, d.base + (d.startY - e.clientY) / h))
    const dt = e.timeStamp - d.lastT
    if (dt > 0) d.vy = (d.lastY - e.clientY) / dt
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    d.moved = Math.max(d.moved, Math.abs(e.clientY - d.startY))
    d.p = p
    setDragP(p)
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    if (!d) {
      setDragP(null)
      return
    }
    let next: boolean
    if (d.moved < 6) {
      next = !open // treat as a tap
    } else if (d.vy > 0.4) {
      next = true // flick up
    } else if (d.vy < -0.4) {
      next = false // flick down
    } else {
      next = d.p > 0.5
    }
    setOpen(next)
    setDragP(null)
    if (next) unpark()
    else schedulePark()
  }

  const openness = dragP ?? (open ? 1 : 0)
  const dragging = dragP !== null
  // Only the card slides; the peek stays pinned to the bottom and fades.
  const cardStyle: CSSProperties = {
    // Slide fully out of view when closed: 100% of its height plus extra px so
    // its upward-cast top shadow also clears the bottom edge (no fade — it just
    // leaves the screen entirely).
    transform: `translateY(calc(${(1 - openness) * 100}% + ${(1 - openness) * 96}px))`,
    // Square the top corners only once settled at the top (rounded otherwise).
    borderRadius: atTop ? 0 : undefined,
    transition: dragging ? 'none' : undefined,
    visibility: parked ? 'hidden' : 'visible',
  }

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }

  const subline = [meta.artist, meta.artist_life].filter(Boolean).join(' · ')
  const pct = Math.round((meta.confidence || 0) * 100)
  const eyebrow = meta.demo
    ? 'Demo world'
    : meta.recognized
      ? `Identified${pct > 0 ? ` · ${pct}% match` : ''}`
      : 'Interpreted scene'
  // Glance line: a hook, never metadata.
  const glance = meta.hook || meta.story || 'Step inside the painting'
  // Symbolism + hidden details now sit in the lean-in (above the divider), so the
  // "Go deeper" rule marks only the deep prose cuts below it.
  const hasRabbitHole = Boolean(
    meta.process || meta.why_made || meta.legacy || meta.debates,
  )
  const hasCatalog = Boolean(
    meta.year ||
      meta.medium ||
      meta.dimensions ||
      meta.location ||
      meta.provenance ||
      meta.style,
  )
  const glossary = meta.glossary ?? []
  const paletteNotes = meta.palette_notes ?? []
  // First-occurrence-only across the whole card: a term is chipped once, topmost.
  const usedTerms = new Set<string>()

  return (
    <div className="screen world fade-enter">
      <div ref={hostRef} className="world__host" />

      {/* Top: blurred dark gradient behind a chrome-free title + scan button.
          The bar itself is pointer-transparent so look-around drag still works
          at the top of the scene; only the + button captures input. */}
      <header className="world__top" style={{ opacity: 1 - openness }}>
        <div className="world__top-scrim" aria-hidden />
        <div className="world__top-row">
          <div className="world__id">
            <h1 className="world__title">{meta.title}</h1>
            {meta.artist && <p className="world__artist">{meta.artist}</p>}
          </div>
          <button
            className="world__scan"
            aria-label="Scan another artwork"
            onClick={onScanAnother}
            style={{ pointerEvents: open ? 'none' : undefined }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <p className="world__hint" style={{ opacity: 1 - openness }}>
        {mode === 'device' ? 'Move your phone to look around' : 'Drag — or move your phone — to look around'}
      </p>

      {/* Dimming backdrop, revealed as the sheet rises */}
      <button
        className="world__backdrop"
        aria-label="Close details"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
        style={{
          opacity: openness * 0.62,
          pointerEvents: openness > 0.02 ? 'auto' : 'none',
        }}
      />

      {/* Bottom: gradient peek that drags up into the full-screen dossier */}
      <section className="world__sheet" aria-label="Artwork details">
        <div
          className="world__peek"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          style={{ opacity: 1 - openness, pointerEvents: open ? 'none' : 'auto' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen(true)
            }
          }}
          {...dragHandlers}
        >
          <span className="world__handle" />
          <div className="world__peek-body">
            <div className="world__peek-info">
              {meta.palette.length > 0 && (
                <span className="world__dots" aria-hidden>
                  {meta.palette.slice(0, 5).map((c, i) => (
                    <span
                      key={i}
                      className="world__dot"
                      style={{ background: meta.palette_hex?.[i] ?? paletteColor(c) }}
                    />
                  ))}
                </span>
              )}
              <span className="world__peek-text">{glance}</span>
            </div>
            <span className="world__peek-cue">Details ↑</span>
          </div>
        </div>

        <article
          className={`world__card${open ? ' is-open' : ''}`}
          style={cardStyle}
          aria-hidden={!open}
          onTransitionEnd={(e) => {
            // Square the corners the moment the rise finishes (not mid-flight).
            if (e.propertyName === 'transform' && open && drag.current === null) {
              setAtTop(true)
            }
          }}
        >
          {/* Progressive-blur top edge: stacked blur layers (increasing radius
              toward the top) + an opaque tint lip, so content blurs and dissolves
              into the frosted top as it scrolls — never a hard cut. */}
          <div className="world__topbar" aria-hidden>
            <div className="world__blur world__blur--1" />
            <div className="world__blur world__blur--2" />
            <div className="world__blur world__blur--3" />
            <div className="world__blur world__blur--4" />
            <div className="world__topbar-tint" />
          </div>

          <div className="world__scroll" ref={scrollRef}>
            <header className="world__hero">
              <p className="world__eyebrow">{eyebrow}</p>
              <h2 className="world__hero-title">{meta.title}</h2>
              {subline && <p className="world__hero-sub">{subline}</p>}
              {meta.hook && <p className="world__hook">{meta.hook}</p>}
            </header>

            {/* Lean-in: the story */}
            {meta.story && (
              <Section label="The story">
                <p className="world__prose">
                  {injectGlossary(meta.story, glossary, usedTerms, meta.lang ?? 'en')}
                </p>
              </Section>
            )}

            {/* The visual heart: each symbol as a real fragment of the painting,
                plus a tap-to-reveal "did you notice". Lives in the lean-in now. */}
            {(meta.symbolism.length > 0 || meta.hidden_details.length > 0) && (
              <Section label="What you're really seeing">
                {meta.symbolism.length > 0 && (
                  <ul className="world__sym">
                    {meta.symbolism.map((s, i) => {
                      const crop = symbolCrops[i]
                      return (
                        <li key={i} className="world__sym-item">
                          {crop && (
                            <button
                              type="button"
                              className="world__sym-thumb-btn"
                              aria-label={`Enlarge detail: ${s.detail}`}
                              onClick={() => setLoupe(crop)}
                            >
                              <img
                                className="world__sym-thumb"
                                src={crop}
                                alt={s.detail}
                                loading="lazy"
                              />
                            </button>
                          )}
                          <span className="world__sym-text">
                            <span className="world__sym-detail">{s.detail}</span>
                            <span className="world__sym-meaning">{s.meaning}</span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {meta.hidden_details.length > 0 && (
                  <ul className="world__missed">
                    {meta.hidden_details.map((d, i) => (
                      <li key={i}>
                        <HiddenDetail text={d} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {(meta.brushwork || meta.materiality || meta.scale_note) && (
              <Section label="How it was made">
                {meta.brushwork && (
                  <p className="world__prose">
                    {injectGlossary(meta.brushwork, glossary, usedTerms, meta.lang ?? 'en')}
                  </p>
                )}
                {meta.materiality && (
                  <p className="world__prose">
                    {injectGlossary(meta.materiality, glossary, usedTerms, meta.lang ?? 'en')}
                  </p>
                )}
                {meta.scale_note && <p className="world__note">{meta.scale_note}</p>}
              </Section>
            )}

            {meta.palette.length > 0 && (
              <Section label="Palette">
                <ul className="world__palette">
                  {meta.palette.map((c, i) => {
                    const note = paletteNotes[i]
                    const active = activeColor === i
                    const chip = (
                      <>
                        <span
                          className="world__swatch-chip"
                          style={{ background: meta.palette_hex?.[i] ?? paletteColor(c) }}
                        />
                        <span className="world__swatch-name">{c}</span>
                      </>
                    )
                    return (
                      <li key={i} className="world__swatch">
                        {note ? (
                          <button
                            type="button"
                            className={`world__swatch-btn${active ? ' is-active' : ''}`}
                            aria-expanded={active}
                            onClick={() => setActiveColor(active ? null : i)}
                          >
                            {chip}
                          </button>
                        ) : (
                          <span className="world__swatch-btn">{chip}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {activeColor != null && paletteNotes[activeColor] && (
                  <p className="world__swatch-note">{paletteNotes[activeColor]}</p>
                )}
              </Section>
            )}

            {/* Rabbit hole */}
            {hasRabbitHole && (
              <div className="world__depth" aria-hidden>
                <span>Go deeper</span>
              </div>
            )}

            {meta.process && (
              <Section label="Underneath">
                <p className="world__prose">
                  {injectGlossary(meta.process, glossary, usedTerms, meta.lang ?? 'en')}
                </p>
              </Section>
            )}

            {meta.why_made && (
              <Section label="Why it was made">
                <p className="world__prose">
                  {injectGlossary(meta.why_made, glossary, usedTerms, meta.lang ?? 'en')}
                </p>
              </Section>
            )}

            {(meta.legacy || meta.debates) && (
              <Section label="Why it still matters">
                {meta.legacy && (
                  <p className="world__prose">
                    {injectGlossary(meta.legacy, glossary, usedTerms, meta.lang ?? 'en')}
                  </p>
                )}
                {meta.debates && (
                  <p className="world__prose">
                    <span className="world__inline-label">Still argued — </span>
                    {injectGlossary(meta.debates, glossary, usedTerms, meta.lang ?? 'en')}
                  </p>
                )}
              </Section>
            )}

            {hasCatalog && (
              <Section label="The facts">
                <dl className="world__catalog">
                  <Fact label="Year" value={meta.year} />
                  <Fact label="Medium" value={meta.medium} />
                  <Fact label="Size" value={meta.dimensions} />
                  <Fact label="Where it lives" value={meta.location} />
                  <Fact label="Provenance" value={meta.provenance} />
                  <Fact label="Style" value={meta.style} />
                </dl>
              </Section>
            )}

            {meta.similar_works.length > 0 && (
              <Section label="If you liked this">
                <ul className="world__similar">
                  {meta.similar_works.map((w, i) => (
                    <li key={i} className="world__similar-item">
                      <span className="world__similar-idx">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="world__similar-text">
                        <span className="world__similar-title">{w.title}</span>
                        {w.artist && (
                          <span className="world__similar-artist">{w.artist}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <footer className="world__card-footer">
              {meta.demo
                ? 'A curated demo world — connect a recognition key to step inside real paintings.'
                : 'Story written by Artlens from the scanned artwork.'}
            </footer>

            <a
              className="world__form-link"
              href="https://docs.google.com/forms/d/1JIrjDdK7nsQmr2ncYkApgFtv5UNDvdGMJbcayx3OS_c/viewform"
              target="_blank"
              rel="noopener noreferrer"
            >
              Fill out our form →
            </a>
          </div>
        </article>
      </section>

      {/* Loupe: an enlarged crop of a detail, over a dimming scrim. Tap to close. */}
      {loupe && (
        <button
          className="world__loupe"
          aria-label="Close detail"
          onClick={() => setLoupe(null)}
        >
          <img className="world__loupe-img" src={loupe} alt="" />
        </button>
      )}

      {failed && (
        <div className="world__failed">
          <p className="banner__title">Couldn't load the world</p>
          <p className="banner__msg">
            The panorama failed to load. Try scanning again.
          </p>
          <button className="btn-ghost" onClick={onScanAnother}>
            Scan another
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Crop a real fragment of the artwork for each symbol's box, decoding the source
 * once. Returns one object URL per symbol (null where there's no usable crop).
 * Gated on `enabled` so a closed sheet pays nothing; revokes URLs on cleanup.
 */
function useSymbolCrops(
  sourceImage: Blob | undefined,
  symbolism: SymbolNote[],
  enabled: boolean,
): Array<string | null> {
  const [urls, setUrls] = useState<Array<string | null>>([])
  useEffect(() => {
    if (!enabled || !sourceImage || symbolism.length === 0) {
      setUrls([])
      return
    }
    let cancelled = false
    const made: string[] = []
    void cropManyToBoxes(
      sourceImage,
      symbolism.map((s) => s.box),
    ).then((blobs) => {
      if (cancelled) return
      setUrls(
        blobs.map((b) => {
          if (!b) return null
          const u = URL.createObjectURL(b)
          made.push(u)
          return u
        }),
      )
    })
    return () => {
      cancelled = true
      made.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [sourceImage, symbolism, enabled])
  return urls
}

/**
 * Wrap the first occurrence of up to `cap` glossary terms in `text` as tappable
 * chips (case-insensitive, simple plural-aware, whole-word). `used` is shared
 * across the card so each term is chipped once, in the topmost block it appears.
 */
function injectGlossary(
  text: string,
  glossary: GlossaryTerm[],
  used: Set<string>,
  lang: Locale = 'en',
  cap = 2,
): ReactNode {
  if (!text || glossary.length === 0) return text
  const avail = glossary.filter(
    (g) => g.term && g.definition && !used.has(g.term.toLowerCase()),
  )
  if (avail.length === 0) return text

  const nodes: ReactNode[] = []
  let rest = text
  let injected = 0
  while (injected < cap && rest) {
    let best: { idx: number; matched: string; g: GlossaryTerm } | null = null
    for (const g of avail) {
      if (used.has(g.term.toLowerCase())) continue
      const m = rest.match(termRegex(g.term, lang))
      if (!m || m.index == null) continue
      if (
        !best ||
        m.index < best.idx ||
        (m.index === best.idx && g.term.length > best.g.term.length)
      ) {
        best = { idx: m.index, matched: m[0], g }
      }
    }
    if (!best) break
    if (best.idx > 0) nodes.push(rest.slice(0, best.idx))
    nodes.push(
      <GlossaryChip key={`g-${injected}-${best.g.term}`} definition={best.g.definition}>
        {best.matched}
      </GlossaryChip>,
    )
    used.add(best.g.term.toLowerCase())
    rest = rest.slice(best.idx + best.matched.length)
    injected++
  }
  if (rest) nodes.push(rest)
  return nodes.length > 0 ? nodes : text
}

/** An inline art term — dotted underline; tap toggles a one-line definition. */
function GlossaryChip({
  definition,
  children,
}: {
  definition: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])
  return (
    <span className="world__gloss" ref={ref}>
      <button
        type="button"
        className="world__gloss-term"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <span className="world__gloss-pop" role="tooltip">
          {definition}
        </span>
      )}
    </span>
  )
}

/** A "did you notice…" line: blurred until tapped, then revealed. */
function HiddenDetail({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <button
      type="button"
      className={`world__missed-item${revealed ? ' is-revealed' : ''}`}
      aria-expanded={revealed}
      onClick={() => setRevealed(true)}
    >
      <span className="world__missed-cue">Did you notice…</span>
      <span className="world__missed-text">{text}</span>
    </button>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="world__section">
      <p className="world__label">{label}</p>
      {children}
    </section>
  )
}

/** One catalogue row — renders nothing when the value is empty. */
function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="world__fact-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
