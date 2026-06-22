// cornerEditor.js
// A draggable 4-corner overlay drawn on a display <canvas>.
// Corners are stored in SOURCE image pixel coordinates, ordered [TL, TR, BR, BL].
// Uses Pointer Events so mouse and touch behave identically.

const HANDLE_R = 9;    // visual handle radius (css px)
const HIT_R = 28;      // touch-friendly grab radius (css px)
const LOUPE_R = 62;    // magnifier radius (css px)
const LOUPE_ZOOM = 2.6;

const PAPER = "rgba(244,239,227,0.95)";
const INK = "rgba(28,27,24,0.85)";
const ACCENT = "rgba(204,59,31,0.95)";

export class CornerEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.source = null;
    this.corners = [];
    this.scale = 1;          // source px -> display px
    this.dispW = 0;
    this.dispH = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.active = -1;

    this._onResize = () => {
      if (this.source) { this.layout(); this.draw(); }
    };
    window.addEventListener("resize", this._onResize);
    this._bindPointer();
  }

  setImage(sourceCanvas, corners) {
    this.source = sourceCanvas;
    this.corners = corners.map((p) => ({ x: p.x, y: p.y }));
    this.active = -1;
    this.layout();
    this.draw();
  }

  getCorners() {
    return this.corners.map((p) => ({ x: p.x, y: p.y }));
  }

  layout() {
    const maxW = this.canvas.parentElement.clientWidth || 320;
    const maxH = Math.max(260, Math.min(window.innerHeight * 0.62, 760));
    const ar = this.source.width / this.source.height;
    let w = maxW, h = w / ar;
    if (h > maxH) { h = maxH; w = h * ar; }
    this.dispW = Math.round(w);
    this.dispH = Math.round(h);
    this.scale = this.dispW / this.source.width;
    this.canvas.style.width = this.dispW + "px";
    this.canvas.style.height = this.dispH + "px";
    this.canvas.width = Math.round(this.dispW * this.dpr);
    this.canvas.height = Math.round(this.dispH * this.dpr);
  }

  _toDisp(p) {
    return { x: p.x * this.scale, y: p.y * this.scale };
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.dispW, this.dispH);
    ctx.drawImage(this.source, 0, 0, this.dispW, this.dispH);

    const d = this.corners.map((p) => this._toDisp(p));

    // Dim everything outside the quad (evenodd: outer rect minus the quad).
    const mask = new Path2D();
    mask.rect(0, 0, this.dispW, this.dispH);
    mask.moveTo(d[0].x, d[0].y);
    for (let i = 1; i < 4; i++) mask.lineTo(d[i].x, d[i].y);
    mask.closePath();
    ctx.fillStyle = "rgba(20,18,15,0.55)";
    ctx.fill(mask, "evenodd");

    // Quad outline: solid paper line + dashed accent over it.
    ctx.beginPath();
    ctx.moveTo(d[0].x, d[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(d[i].x, d[i].y);
    ctx.closePath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAPER;
    ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    ctx.setLineDash([]);

    d.forEach((p, i) => this._drawHandle(p, i === this.active));
    if (this.active >= 0) this._drawLoupe(d[this.active]);
  }

  _drawHandle(p, isActive) {
    const ctx = this.ctx;
    const r = isActive ? HANDLE_R + 2 : HANDLE_R;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? ACCENT : PAPER;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isActive ? PAPER : INK;
    ctx.stroke();
    // crosshair inside the handle
    ctx.lineWidth = 1;
    ctx.strokeStyle = isActive ? PAPER : "rgba(28,27,24,0.6)";
    ctx.beginPath();
    ctx.moveTo(p.x - r + 2, p.y);
    ctx.lineTo(p.x + r - 2, p.y);
    ctx.moveTo(p.x, p.y - r + 2);
    ctx.lineTo(p.x, p.y + r - 2);
    ctx.stroke();
  }

  _drawLoupe(active) {
    const ctx = this.ctx;
    const margin = 12;
    // Park the loupe in a corner away from the finger.
    let cx = active.x < this.dispW / 2 ? this.dispW - LOUPE_R - margin : LOUPE_R + margin;
    let cy = LOUPE_R + margin;
    if (active.y < LOUPE_R * 2 + margin) cy = this.dispH - LOUPE_R - margin;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "#100f0d";
    ctx.fill();
    const z = LOUPE_ZOOM;
    // Map the active handle (display coords) to the loupe centre.
    ctx.drawImage(
      this.source,
      cx - active.x * z,
      cy - active.y * z,
      this.dispW * z,
      this.dispH * z
    );
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy);
    ctx.lineTo(cx + 11, cy);
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx, cy + 11);
    ctx.stroke();
  }

  _eventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _nearest(pos) {
    let idx = -1, min = HIT_R;
    this.corners.forEach((c, i) => {
      const dp = this._toDisp(c);
      const dd = Math.hypot(dp.x - pos.x, dp.y - pos.y);
      if (dd < min) { min = dd; idx = i; }
    });
    return idx;
  }

  _bindPointer() {
    const c = this.canvas;
    c.style.touchAction = "none";

    c.addEventListener("pointerdown", (e) => {
      const idx = this._nearest(this._eventPos(e));
      if (idx >= 0) {
        this.active = idx;
        try { c.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        this.draw();
      }
    });

    c.addEventListener("pointermove", (e) => {
      if (this.active < 0) return;
      e.preventDefault();
      const pos = this._eventPos(e);
      const sx = Math.max(0, Math.min(this.source.width, pos.x / this.scale));
      const sy = Math.max(0, Math.min(this.source.height, pos.y / this.scale));
      this.corners[this.active] = { x: sx, y: sy };
      this.draw();
    });

    const release = (e) => {
      if (this.active < 0) return;
      this.active = -1;
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
      this.draw();
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
  }
}
