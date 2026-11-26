// RetroAmp · Componentes de interfaz: íconos, deslizadores táctiles seguros, hojas inferiores y display de 7 segmentos

const P = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18 5.5v13L8.5 12z" fill="currentColor" stroke="none"/><rect x="5" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 5.5v13l9.5-6.5z" fill="currentColor" stroke="none"/><rect x="16.4" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M4 7h3.5c2 0 3.2 1 4.4 2.6l2.2 3c1.2 1.6 2.4 2.4 4.4 2.4H20"/><path d="M4 17h3.5c1.6 0 2.7-.6 3.7-1.8"/><path d="M14.3 8.8C15.3 7.6 16.4 7 18 7h2"/><path d="M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/>',
  repeat: '<path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19"/><path d="M16.5 4.5 19 7l-2.5 2.5"/><path d="M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5"/><path d="M7.5 19.5 5 17l2.5-2.5"/>',
  repeat1: '<path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19"/><path d="M16.5 4.5 19 7l-2.5 2.5"/><path d="M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5"/><path d="M7.5 19.5 5 17l2.5-2.5"/><path d="M11.2 10.6 12.6 10v4.4" stroke-width="1.6"/>',
  sliders: '<path d="M6 4v5M6 13v7M12 4v9M12 17v3M18 4v2M18 10v10"/><circle cx="6" cy="11" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="8" r="2"/>',
  volume: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none"/><path d="m16 10 4 4m0-4-4 4"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  more: '<circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>',
  sort: '<path d="M7 5v14M4 16l3 3 3-3M14 6h6M14 10h4.5M14 14h3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  listadd: '<path d="M4 6.5h11M4 11.5h11M4 16.5h7M17.5 14v6M14.5 17h6"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 15.5V9l6-1.2v6.2"/><circle cx="7.8" cy="15.5" r="1.3"/><circle cx="13.8" cy="14" r="1.3"/>',
  note: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  yt: '<rect x="3" y="6" width="18" height="12" rx="3.5"/><path d="M10.5 9.5v5l4.2-2.5z" fill="currentColor" stroke="none"/>',
  trash: '<path d="M5 7h14M10 4h4M7 7l1 12.5h8L17 7"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  edit: '<path d="M4.5 19.5 5.5 15 15.5 5l3.5 3.5-10 10z"/>',
  playlist: '<path d="M4 6.5h12M4 11h12M4 15.5h7"/><path d="M15 13.5v6l5-3z" fill="currentColor" stroke="none"/>',
  radio: '<rect x="3.5" y="8.5" width="17" height="11.5" rx="2.5"/><path d="M7 8.5 16.5 4"/><circle cx="15.5" cy="14.2" r="2.6"/><path d="M6.8 12.5h3.4M6.8 15.8h3.4"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  staron: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" fill="currentColor"/>',
  live: '<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.removeAttribute('data-icon');
  });
}

/* ---------- Deslizador táctil seguro ----------
   mode 'delta': solo cambia arrastrando (el valor se mueve en relación al dedo, nunca salta al tocar).
   orientation 'h' deja pasar el scroll vertical (touch-action: pan-y); 'v' bloquea el scroll en la pista.
   Doble toque restaura el valor por defecto. */
export class Slider {
  constructor(el, o) {
    this.el = el;
    this.o = Object.assign({ min: 0, max: 100, step: 1, value: 0, def: 0, orientation: 'h', mode: 'delta', zero: null, format: v => String(v), onInput: () => {}, onCommit: () => {}, label: '' }, o);
    this.v = this.o.value;
    el.classList.add('sl', 'sl-' + this.o.orientation);
    el.setAttribute('role', 'slider');
    el.setAttribute('tabindex', '0');
    if (this.o.label) el.setAttribute('aria-label', this.o.label);
    el.setAttribute('aria-valuemin', this.o.min);
    el.setAttribute('aria-valuemax', this.o.max);
    el.innerHTML = '<div class="sl-track"><div class="sl-fill"></div><div class="sl-zero"></div></div><div class="sl-thumb"><span class="sl-tip"></span></div>';
    this.fill = el.querySelector('.sl-fill');
    this.thumb = el.querySelector('.sl-thumb');
    this.tip = el.querySelector('.sl-tip');
    this.zeroEl = el.querySelector('.sl-zero');
    this._bind();
    this.render();
  }
  get value() { return this.v; }
  set(v, emit = false) {
    const o = this.o;
    v = Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step));
    v = +v.toFixed(4);
    if (v === this.v) return;
    this.v = v;
    this.render();
    if (emit) o.onInput(v);
  }
  frac(v = this.v) { return (v - this.o.min) / (this.o.max - this.o.min); }
  render() {
    const o = this.o, f = this.frac();
    const z = o.zero === null ? 0 : this.frac(o.zero);
    const a = Math.min(f, z), b = Math.max(f, z);
    if (o.orientation === 'h') {
      this.thumb.style.left = (f * 100) + '%';
      this.fill.style.left = (a * 100) + '%';
      this.fill.style.width = ((b - a) * 100) + '%';
      this.zeroEl.style.left = (z * 100) + '%';
    } else {
      this.thumb.style.bottom = (f * 100) + '%';
      this.fill.style.bottom = (a * 100) + '%';
      this.fill.style.height = ((b - a) * 100) + '%';
      this.zeroEl.style.bottom = (z * 100) + '%';
    }
    this.zeroEl.hidden = o.zero === null;
    this.tip.textContent = o.format(this.v);
    this.el.setAttribute('aria-valuenow', this.v);
    this.el.setAttribute('aria-valuetext', o.format(this.v));
  }
  _bind() {
    const el = this.el, o = this.o;
    let id = null, sx = 0, sy = 0, sv = 0, active = false, lastTap = 0, len = 1, moved = false;
    el.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      const now = Date.now();
      if (now - lastTap < 320) { this.set(o.def, true); o.onCommit(this.v); lastTap = 0; return; }
      lastTap = now;
      id = e.pointerId; sx = e.clientX; sy = e.clientY; sv = this.v; active = false; moved = false;
      const r = el.getBoundingClientRect();
      len = o.orientation === 'h' ? r.width : r.height;
      if (o.mode === 'absolute') {
        active = true; el.setPointerCapture(id); el.classList.add('dragging');
        this.set(this._abs(e, r), true);
      }
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!active) {
        const main = o.orientation === 'h' ? Math.abs(dx) : Math.abs(dy);
        const cross = o.orientation === 'h' ? Math.abs(dy) : Math.abs(dx);
        if (main > 7 && main > cross * 1.2) { active = true; el.setPointerCapture(id); el.classList.add('dragging'); sx = e.clientX; sy = e.clientY; }
        else if (cross > 10) { id = null; }
        return;
      }
      moved = true;
      if (o.mode === 'absolute') { this.set(this._abs(e, el.getBoundingClientRect()), true); return; }
      const d = o.orientation === 'h' ? (e.clientX - sx) : -(e.clientY - sy);
      this.set(sv + d / len * (o.max - o.min), true);
    });
    const end = e => {
      if (e.pointerId !== id) return;
      if (active) { el.classList.remove('dragging'); o.onCommit(this.v); }
      if (moved) lastTap = 0;
      id = null; active = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      const k = e.key;
      const big = (o.max - o.min) / 10;
      const map = { ArrowRight: o.step, ArrowUp: o.step, ArrowLeft: -o.step, ArrowDown: -o.step, PageUp: big, PageDown: -big };
      if (k in map) { e.preventDefault(); this.set(this.v + map[k], true); o.onCommit(this.v); }
      else if (k === 'Home') { this.set(o.min, true); o.onCommit(this.v); }
      else if (k === 'End') { this.set(o.max, true); o.onCommit(this.v); }
    });
  }
  _abs(e, r) {
    const o = this.o;
    const f = o.orientation === 'h' ? (e.clientX - r.left) / r.width : 1 - (e.clientY - r.top) / r.height;
    return o.min + Math.min(1, Math.max(0, f)) * (o.max - o.min);
  }
}

/* ---------- Hojas inferiores con soporte del botón Atrás ---------- */
const stack = [];
let ignorePop = 0;
export function openSheet(el, onClose) {
  if (stack.some(s => s.el === el)) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('open'));
  stack.push({ el, onClose });
  const push = () => { try { history.pushState({ sheet: stack.length }, ''); } catch {} };
  if (ignorePop > 0) setTimeout(push, 90); else push();
  document.documentElement.classList.add('sheet-open');
}
export function closeSheet(el, fromPop = false) {
  const i = el ? stack.findIndex(s => s.el === el) : stack.length - 1;
  if (i < 0) return;
  const [s] = stack.splice(i, 1);
  s.el.classList.remove('open');
  setTimeout(() => { if (!s.el.classList.contains('open')) s.el.hidden = true; }, 260);
  if (!stack.length) document.documentElement.classList.remove('sheet-open');
  if (!fromPop) { ignorePop++; try { history.back(); } catch { ignorePop--; } }
  if (s.onClose) s.onClose();
}
export function topSheet() { return stack.length ? stack[stack.length - 1].el : null; }
window.addEventListener('popstate', () => { if (ignorePop > 0) { ignorePop--; return; } if (stack.length) closeSheet(null, true); });
export function wireSheet(el) {
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('[data-close]')) closeSheet(el);
  });
  // Arrastrar la manija hacia abajo cierra
  const handle = el.querySelector('.grab');
  const panel = el.querySelector('.panel');
  if (handle && panel) {
    let y0 = null, dy = 0;
    handle.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; handle.setPointerCapture(e.pointerId); panel.style.transition = 'none'; });
    handle.addEventListener('pointermove', e => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; });
    const up = () => { if (y0 === null) return; panel.style.transition = ''; panel.style.transform = ''; if (dy > 90) closeSheet(el); y0 = null; };
    handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  }
}

/* ---------- Display de 7 segmentos (vectorial, nítido en cualquier densidad) ---------- */
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
function segPath(g, x, y, w, h, t, s) {
  const sk = h * 0.08; // inclinación tipo display de equipo de audio
  const X = (px, py) => x + px + (1 - (py - y) / h) * sk - sk / 2;
  const hs = (x0, y0, x1) => { g.moveTo(X(x0 + t / 2, y0), y0); g.lineTo(X(x0 + t, y0 - t / 2), y0 - t / 2); g.lineTo(X(x1 - t, y0 - t / 2), y0 - t / 2); g.lineTo(X(x1 - t / 2, y0), y0); g.lineTo(X(x1 - t, y0 + t / 2), y0 + t / 2); g.lineTo(X(x0 + t, y0 + t / 2), y0 + t / 2); g.closePath(); };
  const vs = (x0, y0, y1) => { const xx = x0; g.moveTo(X(xx, y0 + t / 2), y0 + t / 2); g.lineTo(X(xx + t / 2, y0 + t), y0 + t); g.lineTo(X(xx + t / 2, y1 - t), y1 - t); g.lineTo(X(xx, y1 - t / 2), y1 - t / 2); g.lineTo(X(xx - t / 2, y1 - t), y1 - t); g.lineTo(X(xx - t / 2, y0 + t), y0 + t); g.closePath(); };
  const m = y + h / 2, gap = t * 0.18;
  const segs = {
    a: () => hs(gap, y + t / 2, w - gap),
    g: () => hs(gap, m, w - gap),
    d: () => hs(gap, y + h - t / 2, w - gap),
    f: () => vs(t / 2, y + gap, m - gap),
    b: () => vs(w - t / 2, y + gap, m - gap),
    e: () => vs(t / 2, m + gap, y + h - gap),
    c: () => vs(w - t / 2, m + gap, y + h - gap),
  };
  return name => { g.beginPath(); segs[name](); };
}
export function drawSevenSeg(canvas, text, colors) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  const h = ch * 0.86, y = (ch - h) / 2;
  const dw = h * 0.5, t = h * 0.12, sp = h * 0.16, colon = h * 0.26;
  const chars = [...text];
  let total = 0;
  for (const c of chars) total += c === ':' ? colon : dw + sp;
  let x = cw - total + sp;
  for (const c of chars) {
    if (c === ':') {
      const r = t * 0.55;
      g.fillStyle = colors.on; g.shadowColor = colors.glow; g.shadowBlur = colors.blur;
      for (const yy of [y + h * 0.32, y + h * 0.7]) { g.beginPath(); g.arc(x + colon / 2 - sp / 2 + h * 0.02, yy, r, 0, Math.PI * 2); g.fill(); }
      x += colon;
      continue;
    }
    const on = SEG[c] ?? '';
    const seg = segPath(g, x, y, dw, h, t, 0);
    for (const s of 'abcdefg') {
      seg(s);
      if (on.includes(s)) { g.fillStyle = colors.on; g.shadowColor = colors.glow; g.shadowBlur = colors.blur; }
      else { g.fillStyle = colors.off; g.shadowBlur = 0; }
      g.fill();
    }
    x += dw + sp;
  }
  g.shadowBlur = 0;
}

export function vibrate(enabled, ms = 8) { if (enabled && navigator.vibrate) { try { navigator.vibrate(ms); } catch {} } }
