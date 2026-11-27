/* Open Notes — handwriting engine (vector strokes, pressure, eraser, lasso)
 * Strokes are stored in logical units: the page is always 1000 units wide,
 * so drawings scale with the device width (phone, tablet, desktop).
 * Stroke: { t: tool, c: color, w: base width, a: alpha, p: [[x, y, width], ...] }
 */
const INK_W = 1000;
const VARIABLE = { pen: 1, fountain: 1, brush: 1 };

class Ink {
  constructor({ page, canvas, live, lassoBox, scroller }) {
    this.page = page; this.canvas = canvas; this.live = live;
    this.lassoBox = lassoBox; this.scroller = scroller;
    this.ctx = canvas.getContext('2d');
    this.lctx = live.getContext('2d');
    this.strokes = [];
    this.tool = 'pen';            // pen | highlighter | eraser | lasso
    this.penType = 'pen';         // pen | pencil | fountain | brush
    this.cfg = {
      pen: { c: '#1a1a1a', w: 3 }, pencil: { c: '#3a3a3a', w: 2.5 },
      fountain: { c: '#1d3f8f', w: 3.5 }, brush: { c: '#c62828', w: 6 },
      highlighter: { c: '#ffe14d', w: 18 }
    };
    this.eraserMode = 'stroke';   // stroke | area
    this.eraserSize = 20;
    this.active = false;
    this.stylusOnly = false;
    this.history = []; this.future = [];
    this.onChange = () => {};
    this.onHistory = () => {};
    this.cur = null; this.curBox = null;
    this.touches = new Map();
    this.lastPen = 0;
    this.sel = null;
    this.dpr = 1;
    this.cssW = 0; this.cssH = 0;
    this._bind();
  }

  get scale() { return this.cssW / INK_W; }

  setActive(on) {
    this.active = on;
    this.live.style.pointerEvents = on ? 'auto' : 'none';
    this.page.classList.toggle('drawing', on);
    if (!on) this.clearSelection();
  }

  load(strokes) {
    this.strokes = strokes || [];
    this.history = []; this.future = [];
    this.clearSelection();
    this.resize(true);
    this.onHistory();
  }

  maxY() {
    let m = 0;
    for (const s of this.strokes) for (const p of s.p) if (p[1] > m) m = p[1];
    return m;
  }

  /* Fit canvases to the page. Height grows with text and drawings. */
  resize(force, extra = 0) {
    const content = this.page.querySelector('.note-content');
    const textBottom = content ? content.offsetTop + content.offsetHeight + 80 : 0;
    const w = this.page.clientWidth;
    const s = w / INK_W;
    const h = Math.ceil(Math.max(textBottom, this.scroller.clientHeight - 8, this.maxY() * s + 400, this.cssH * (force ? 0 : 1)) + extra);
    if (!force && w === this.cssW && h <= this.cssH) return;
    this.cssW = w; this.cssH = h;
    this.page.style.minHeight = h + 'px';
    // Keep the backing store under ~16M pixels (mobile limits).
    this.dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(16e6 / Math.max(1, w * h)));
    for (const c of [this.canvas, this.live]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.render();
    if (this.sel) this._placeLasso();
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const s of this.strokes) Ink.draw(ctx, s);
    if (this.sel) this._drawSelectionGlow();
  }

  static draw(ctx, s) {
    const p = s.p;
    if (!p.length) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = s.t === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.c || '#000';
    ctx.fillStyle = s.c || '#000';
    ctx.globalAlpha = s.a == null ? 1 : s.a;
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0][0], p[0][1], (p[0][2] || s.w) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (VARIABLE[s.t]) {
      // variable width: short quadratic segments between midpoints
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        const prev = i > 1 ? p[i - 2] : a;
        const m0x = (prev[0] + a[0]) / 2, m0y = (prev[1] + a[1]) / 2;
        const m1x = (a[0] + b[0]) / 2, m1y = (a[1] + b[1]) / 2;
        ctx.beginPath();
        ctx.lineWidth = (a[2] + b[2]) / 2;
        ctx.moveTo(i > 1 ? m0x : a[0], i > 1 ? m0y : a[1]);
        ctx.quadraticCurveTo(a[0], a[1], m1x, m1y);
        if (i === p.length - 1) ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = s.w;
      if (s.t === 'highlighter') { ctx.lineCap = 'square'; ctx.globalCompositeOperation = 'multiply'; }
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      const l = p[p.length - 1];
      ctx.lineTo(l[0], l[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Small preview image for the notes list. */
  static thumb(strokes, w = 300, h = 400, bg = '#fff') {
    if (!strokes || !strokes.length) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const t = tmp.getContext('2d');
    const k = w / INK_W;
    t.setTransform(k, 0, 0, k, 0, 0);
    for (const s of strokes) Ink.draw(t, s);
    ctx.drawImage(tmp, 0, 0);
    return c.toDataURL('image/webp', 0.7);
  }

  /* ---------- history ---------- */
  snapshot() {
    this.history.push(JSON.stringify(this.strokes));
    if (this.history.length > 80) this.history.shift();
    this.future = [];
    this.onHistory();
  }
  canUndo() { return this.history.length > 0; }
  canRedo() { return this.future.length > 0; }
  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.strokes));
    this.strokes = JSON.parse(this.history.pop());
    this.clearSelection(); this.render(); this.onChange(); this.onHistory();
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.strokes));
    this.strokes = JSON.parse(this.future.pop());
    this.clearSelection(); this.render(); this.onChange(); this.onHistory();
  }
  clearAll() {
    if (!this.strokes.length) return;
    this.snapshot();
    this.strokes = [];
    this.clearSelection(); this.render(); this.onChange();
  }

  /* ---------- input ---------- */
  _pt(e) {
    const r = this.live.getBoundingClientRect();
    const s = this.scale;
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5, e.timeStamp];
  }

  _bind() {
    const L = this.live;
    L.addEventListener('pointerdown', e => this._down(e));
    L.addEventListener('pointermove', e => this._move(e));
    L.addEventListener('pointerup', e => this._up(e));
    L.addEventListener('pointercancel', e => this._up(e, true));
    L.addEventListener('contextmenu', e => e.preventDefault());
  }

  _isPan(e) {
    if (e.pointerType !== 'touch') return false;
    if (this.stylusOnly) return true;
    if (Date.now() - this.lastPen < 1500) return true;   // palm rejection
    return this.touches.size >= 2;
  }

  _down(e) {
    if (!this.active) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._isPan(e)) {
        if (this.cur && this.cur.touch) { this._cancelStroke(); }
        return;
      }
    }
    if (e.button > 0 && e.pointerType === 'mouse') return;
    if (e.pointerType === 'pen') this.lastPen = Date.now();
    e.preventDefault();
    try { this.live.setPointerCapture(e.pointerId); } catch (_) {}
    const pt = this._pt(e);

    if (this.tool === 'lasso') {
      this.clearSelection();
      this.cur = { lasso: true, id: e.pointerId, p: [pt] };
      return;
    }
    if (this.tool === 'eraser' && this.eraserMode === 'stroke') {
      this.cur = { strokeErase: true, id: e.pointerId, changed: false };
      this._eraseAt(pt);
      return;
    }
    const stroke = this._newStroke();
    this.cur = { stroke, id: e.pointerId, touch: e.pointerType === 'touch', last: pt };
    stroke.p.push([pt[0], pt[1], this._width(stroke, pt, 0)]);
    this._drawLive();
  }

  _move(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId) && this._isPan(e)) {
      const t = this.touches.get(e.pointerId);
      const dy = (e.clientY - t.y) / Math.max(1, this.touches.size === 0 ? 1 : 1);
      this.scroller.scrollTop -= dy;
      t.x = e.clientX; t.y = e.clientY;
      return;
    }
    if (!this.cur || this.cur.id !== e.pointerId) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const pt = this._pt(ev);
      if (this.cur.lasso) { this.cur.p.push(pt); continue; }
      if (this.cur.strokeErase) { this._eraseAt(pt); continue; }
      const s = this.cur.stroke, last = this.cur.last;
      const dx = pt[0] - last[0], dy = pt[1] - last[1];
      const dist = Math.hypot(dx, dy);
      if (dist < 0.8) continue;
      const dt = Math.max(1, pt[3] - last[3]);
      s.p.push([pt[0], pt[1], this._width(s, pt, dist / dt)]);
      this.cur.last = pt;
    }
    if (this.cur.lasso) this._drawLasso();
    else if (!this.cur.strokeErase) this._drawLive();
    // grow the page when writing near the bottom
    const yCss = (this.cur.last ? this.cur.last[1] : 0) * this.scale;
    if (yCss > this.cssH - 250) this.resize(false, 600);
  }

  _up(e, cancelled) {
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    if (!this.cur || this.cur.id !== e.pointerId) return;
    const cur = this.cur;
    this.cur = null;
    if (cur.lasso) { this._finishLasso(cur.p); return; }
    if (cur.strokeErase) { if (cur.changed) this.onChange(); return; }
    this._clearLive();
    if (cancelled && cur.stroke.p.length < 2) return;
    this.snapshot();
    this.strokes.push(cur.stroke);
    const k = this.scale * this.dpr;
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    Ink.draw(this.ctx, cur.stroke);
    this.onChange();
  }

  _cancelStroke() {
    this._clearLive();
    this.cur = null;
  }

  _newStroke() {
    if (this.tool === 'eraser') return { t: 'erase', c: '#000', w: this.eraserSize, a: 1, p: [] };
    if (this.tool === 'highlighter') {
      const h = this.cfg.highlighter;
      return { t: 'highlighter', c: h.c, w: h.w, a: 0.45, p: [] };
    }
    const t = this.penType, c = this.cfg[t];
    return { t, c: c.c, w: c.w, a: t === 'pencil' ? 0.82 : 1, p: [] };
  }

  _width(s, pt, speed) {
    const pr = pt[2];
    switch (s.t) {
      case 'pen': return s.w * (0.55 + pr * 0.9);
      case 'fountain': return Math.max(0.6, s.w * (0.35 + pr * 1.3) * Math.max(0.45, 1.25 - speed * 0.35));
      case 'brush': return Math.max(0.8, s.w * (0.25 + pr * 1.6) * Math.max(0.4, 1.3 - speed * 0.3));
      default: return s.w;
    }
  }

  _drawLive() {
    const s = this.cur.stroke;
    if (s.t === 'erase') {
      // area eraser works directly on the main canvas
      const k = this.scale * this.dpr;
      this.ctx.setTransform(k, 0, 0, k, 0, 0);
      const n = s.p.length;
      Ink.draw(this.ctx, { ...s, p: s.p.slice(Math.max(0, n - 3)) });
      return;
    }
    this._clearLive();
    const k = this.scale * this.dpr;
    this.lctx.setTransform(k, 0, 0, k, 0, 0);
    Ink.draw(this.lctx, s);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.p) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
    const m = s.w * 2 + 10;
    this.curBox = [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m];
  }

  _clearLive() {
    const c = this.lctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.curBox) {
      const k = this.scale * this.dpr, b = this.curBox;
      c.clearRect(b[0] * k, b[1] * k, b[2] * k, b[3] * k);
      this.curBox = null;
    } else c.clearRect(0, 0, this.live.width, this.live.height);
  }

  _eraseAt(pt) {
    const r = this.eraserSize / 2;
    let hit = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (s.t === 'erase') continue;
      const rr = r + s.w / 2;
      const p = s.p;
      for (let j = 0; j < p.length; j++) {
        const a = p[j], b = p[j + 1] || a;
        if (distSeg(pt[0], pt[1], a[0], a[1], b[0], b[1]) <= rr) {
          if (!hit && !this.cur.changed) this.snapshot();
          this.strokes.splice(i, 1);
          hit = true;
          break;
        }
      }
    }
    if (hit) { this.cur.changed = true; this.render(); }
  }

  /* ---------- lasso selection ---------- */
  _drawLasso() {
    const p = this.cur.p;
    this._clearLive();
    const c = this.lctx, k = this.scale * this.dpr;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.save();
    c.setLineDash([8, 6]);
    c.lineWidth = 2 / this.scale;
    c.strokeStyle = '#f2711c';
    c.fillStyle = 'rgba(242,113,28,0.07)';
    c.beginPath();
    c.moveTo(p[0][0], p[0][1]);
    for (const q of p) c.lineTo(q[0], q[1]);
    c.closePath(); c.fill(); c.stroke();
    c.restore();
    this.curBox = null;
  }

  _finishLasso(poly) {
    this._clearLive();
    if (poly.length < 3) return;
    const idx = [];
    this.strokes.forEach((s, i) => {
      if (s.t === 'erase') return;
      let inside = 0;
      for (const p of s.p) if (pointInPoly(p[0], p[1], poly)) inside++;
      if (inside > 0 && inside >= s.p.length * 0.5) idx.push(i);
    });
    if (!idx.length) return;
    this.sel = { idx };
    this._computeBox();
    this.render();
    this._placeLasso();
  }

  _computeBox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of this.sel.idx) for (const p of this.strokes[i].p) {
      const h = p[2] / 2;
      x0 = Math.min(x0, p[0] - h); y0 = Math.min(y0, p[1] - h);
      x1 = Math.max(x1, p[0] + h); y1 = Math.max(y1, p[1] + h);
    }
    this.sel.box = [x0 - 6, y0 - 6, x1 + 6, y1 + 6];
  }

  _drawSelectionGlow() {}

  _placeLasso() {
    const b = this.sel.box, s = this.scale, el = this.lassoBox;
    el.hidden = false;
    el.style.left = b[0] * s + 'px';
    el.style.top = b[1] * s + 'px';
    el.style.width = (b[2] - b[0]) * s + 'px';
    el.style.height = (b[3] - b[1]) * s + 'px';
    if (!el._ready) this._initLassoBox();
  }

  _initLassoBox() {
    const el = this.lassoBox;
    el._ready = true;
    el.innerHTML = `<div class="lasso-actions">
        <button data-la="color">${icon('palette')}<span>Cor</span></button>
        <button data-la="dup">${icon('duplicate')}<span>Duplicar</span></button>
        <button data-la="del">${icon('trash')}<span>Excluir</span></button>
      </div><div class="lasso-handle" data-la="scale">${icon('scale')}</div>`;
    let drag = null;
    el.addEventListener('pointerdown', e => {
      const btn = e.target.closest('button[data-la]');
      if (btn) return;
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const scale = !!e.target.closest('[data-la="scale"]');
      drag = { x: e.clientX, y: e.clientY, scale, orig: this.sel.idx.map(i => JSON.parse(JSON.stringify(this.strokes[i].p))), box: this.sel.box.slice(), widths: this.sel.idx.map(i => this.strokes[i].w) };
      this.snapshot();
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / this.scale, dy = (e.clientY - drag.y) / this.scale;
      const [bx, by, bx1, by1] = drag.box;
      this.sel.idx.forEach((si, n) => {
        const s = this.strokes[si], o = drag.orig[n];
        if (drag.scale) {
          const f = Math.max(0.15, Math.min(((bx1 - bx) + dx) / (bx1 - bx), ((by1 - by) + dy) / (by1 - by)));
          s.p = o.map(p => [bx + (p[0] - bx) * f, by + (p[1] - by) * f, p[2] * f]);
          s.w = drag.widths[n] * f;
        } else s.p = o.map(p => [p[0] + dx, p[1] + dy, p[2]]);
      });
      this._computeBox(); this.render(); this._placeLasso();
    });
    const end = () => { if (drag) { drag = null; this.onChange(); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-la]');
      if (!b || !this.sel) return;
      const a = b.dataset.la;
      if (a === 'del') {
        this.snapshot();
        const set = new Set(this.sel.idx);
        this.strokes = this.strokes.filter((_, i) => !set.has(i));
        this.clearSelection(); this.render(); this.onChange();
      } else if (a === 'dup') {
        this.snapshot();
        const start = this.strokes.length;
        for (const i of this.sel.idx) {
          const c = JSON.parse(JSON.stringify(this.strokes[i]));
          c.p = c.p.map(p => [p[0] + 30, p[1] + 30, p[2]]);
          this.strokes.push(c);
        }
        this.sel.idx = this.sel.idx.map((_, n) => start + n);
        this._computeBox(); this.render(); this._placeLasso(); this.onChange();
      } else if (a === 'color') {
        this.onPickColor && this.onPickColor(b, color => {
          this.snapshot();
          for (const i of this.sel.idx) if (this.strokes[i].t !== 'highlighter') this.strokes[i].c = color;
          this.render(); this.onChange();
        });
      }
    });
  }

  clearSelection() {
    if (!this.sel) return;
    this.sel = null;
    this.lassoBox.hidden = true;
  }
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
