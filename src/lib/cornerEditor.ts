// A draggable 4-corner overlay on a display <canvas>, ported from the RECTO editor
// (image-detection/cornerEditor.js) and recoloured for artlens' dark-glass UI.
// Corners are stored in SOURCE-image pixels, ordered [TL, TR, BR, BL]. Uses Pointer
// Events so touch and mouse behave identically, with a magnifier loupe for precision.

import type { Pt } from './rectify'

const HANDLE_R = 9 // visual handle radius (css px)
const HIT_R = 28 // touch-friendly grab radius (css px)
const LOUPE_R = 62 // magnifier radius (css px)
const LOUPE_ZOOM = 2.6

const LIGHT = 'rgba(240,243,250,0.96)'
const DARK = 'rgba(10,12,20,0.85)'
const ACCENT = 'rgba(120,210,230,0.98)'

export class CornerEditor {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private source: HTMLCanvasElement | null = null
  private corners: Pt[] = []
  private scale = 1 // source px -> display px
  private dispW = 0
  private dispH = 0
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2)
  private active = -1
  private readonly onResize = () => {
    if (this.source) {
      this.layout()
      this.draw()
    }
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    window.addEventListener('resize', this.onResize)
    this.bindPointer()
  }

  setImage(sourceCanvas: HTMLCanvasElement, corners: Pt[]): void {
    this.source = sourceCanvas
    this.corners = corners.map((p) => ({ x: p.x, y: p.y }))
    this.active = -1
    this.layout()
    this.draw()
  }

  getCorners(): Pt[] {
    return this.corners.map((p) => ({ x: p.x, y: p.y }))
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize)
  }

  private layout(): void {
    if (!this.source) return
    const maxW = this.canvas.parentElement?.clientWidth || 320
    const maxH = Math.max(260, Math.min(window.innerHeight * 0.6, 760))
    const ar = this.source.width / this.source.height
    let w = maxW
    let h = w / ar
    if (h > maxH) {
      h = maxH
      w = h * ar
    }
    this.dispW = Math.round(w)
    this.dispH = Math.round(h)
    this.scale = this.dispW / this.source.width
    this.canvas.style.width = this.dispW + 'px'
    this.canvas.style.height = this.dispH + 'px'
    this.canvas.width = Math.round(this.dispW * this.dpr)
    this.canvas.height = Math.round(this.dispH * this.dpr)
  }

  private toDisp(p: Pt): Pt {
    return { x: p.x * this.scale, y: p.y * this.scale }
  }

  private draw(): void {
    if (!this.source) return
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.dispW, this.dispH)
    ctx.drawImage(this.source, 0, 0, this.dispW, this.dispH)

    const d = this.corners.map((p) => this.toDisp(p))

    // Dim everything outside the quad (evenodd: outer rect minus the quad).
    const mask = new Path2D()
    mask.rect(0, 0, this.dispW, this.dispH)
    mask.moveTo(d[0].x, d[0].y)
    for (let i = 1; i < 4; i++) mask.lineTo(d[i].x, d[i].y)
    mask.closePath()
    ctx.fillStyle = 'rgba(6,8,14,0.6)'
    ctx.fill(mask, 'evenodd')

    // Quad outline: solid light line + dashed accent over it.
    ctx.beginPath()
    ctx.moveTo(d[0].x, d[0].y)
    for (let i = 1; i < 4; i++) ctx.lineTo(d[i].x, d[i].y)
    ctx.closePath()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = LIGHT
    ctx.stroke()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1
    ctx.strokeStyle = ACCENT
    ctx.stroke()
    ctx.setLineDash([])

    d.forEach((p, i) => this.drawHandle(p, i === this.active))
    if (this.active >= 0) this.drawLoupe(d[this.active])
  }

  private drawHandle(p: Pt, isActive: boolean): void {
    const ctx = this.ctx
    const r = isActive ? HANDLE_R + 2 : HANDLE_R
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = isActive ? ACCENT : LIGHT
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = isActive ? LIGHT : DARK
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.strokeStyle = isActive ? LIGHT : 'rgba(10,12,20,0.6)'
    ctx.beginPath()
    ctx.moveTo(p.x - r + 2, p.y)
    ctx.lineTo(p.x + r - 2, p.y)
    ctx.moveTo(p.x, p.y - r + 2)
    ctx.lineTo(p.x, p.y + r - 2)
    ctx.stroke()
  }

  private drawLoupe(active: Pt): void {
    if (!this.source) return
    const ctx = this.ctx
    const margin = 12
    const cx = active.x < this.dispW / 2 ? this.dispW - LOUPE_R - margin : LOUPE_R + margin
    let cy = LOUPE_R + margin
    if (active.y < LOUPE_R * 2 + margin) cy = this.dispH - LOUPE_R - margin

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.fillStyle = '#0a0c14'
    ctx.fill()
    const z = LOUPE_ZOOM
    ctx.drawImage(this.source, cx - active.x * z, cy - active.y * z, this.dispW * z, this.dispH * z)
    ctx.restore()

    ctx.lineWidth = 2
    ctx.strokeStyle = DARK
    ctx.beginPath()
    ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.strokeStyle = ACCENT
    ctx.beginPath()
    ctx.moveTo(cx - 11, cy)
    ctx.lineTo(cx + 11, cy)
    ctx.moveTo(cx, cy - 11)
    ctx.lineTo(cx, cy + 11)
    ctx.stroke()
  }

  private eventPos(e: PointerEvent): Pt {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private nearest(pos: Pt): number {
    let idx = -1
    let min = HIT_R
    this.corners.forEach((c, i) => {
      const dp = this.toDisp(c)
      const dd = Math.hypot(dp.x - pos.x, dp.y - pos.y)
      if (dd < min) {
        min = dd
        idx = i
      }
    })
    return idx
  }

  private bindPointer(): void {
    const c = this.canvas
    c.style.touchAction = 'none'

    c.addEventListener('pointerdown', (e) => {
      const idx = this.nearest(this.eventPos(e))
      if (idx >= 0) {
        this.active = idx
        try {
          c.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        e.preventDefault()
        this.draw()
      }
    })

    c.addEventListener('pointermove', (e) => {
      if (this.active < 0 || !this.source) return
      e.preventDefault()
      const pos = this.eventPos(e)
      const sx = Math.max(0, Math.min(this.source.width, pos.x / this.scale))
      const sy = Math.max(0, Math.min(this.source.height, pos.y / this.scale))
      this.corners[this.active] = { x: sx, y: sy }
      this.draw()
    })

    const release = (e: PointerEvent) => {
      if (this.active < 0) return
      this.active = -1
      try {
        c.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      this.draw()
    }
    c.addEventListener('pointerup', release)
    c.addEventListener('pointercancel', release)
  }
}
