// RetroAmp · Aplicación principal
import { Tracks, Blobs, Playlists, kvGet, kvSet, storageInfo, requestPersist } from './db.js';
import { AudioEngine, EQ_FREQS, EQ_LABELS, PRESETS, DEFAULT_DSP } from './engine.js';
import { readTags, probeDuration } from './meta.js';
import { transcode, loadFFmpeg, isCached, isLoaded, RARE_EXT } from './decoder.js';
import { YouTube, DEFAULT_PIPED, DEFAULT_INVIDIOUS, parseYouTubeId } from './youtube.js';

const VERSION = window.RETROAMP_VERSION || '1.0.0';
const $ = id => document.getElementById(id);
const Cap = window.Capacitor;
const NATIVE = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
// Puente al plugin nativo (APK). Se usa nativePromise del bridge de Capacitor, sin empaquetador.
const Native = NATIVE && typeof Cap.nativePromise === 'function' ? {
  scan: () => Cap.nativePromise('RetroNative', 'scan', {}),
  startService: o => Cap.nativePromise('RetroNative', 'startService', o || {}),
  stopService: () => Cap.nativePromise('RetroNative', 'stopService', {}),
} : null;
const LIB = '__lib';

const DEFAULT_SETTINGS = {
  theme: 'dark', haptics: true, resume: true,
  ytServer: '', ytPriority: 'server', ytFormat: 'opus',
  pipedList: DEFAULT_PIPED, invList: DEFAULT_INVIDIOUS,
  vizMode: 0, showWins: { winEq: true, winDsp: true, winPl: true, winYt: true }, shaded: {},
  customPresets: {}, libSort: 'added', remain: false,
};

let settings = structuredClone(DEFAULT_SETTINGS);
const audio = $('audio');
const engine = new AudioEngine(audio);
const yt = new YouTube(() => settings);
const tracks = new Map();
let playlists = [];

const player = {
  plId: LIB, list: [], order: [], pos: -1,
  shuffle: false, repeat: 0, // 0 no, 1 todo, 2 una
  cur: null, objUrl: null, coverUrl: null, kbps: 0, token: 0, loading: false,
};
let viewIds = [];
let selectedId = null;

/* ================= Utilidades ================= */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const extOf = n => ((n || '').split('.').pop() || '').toLowerCase();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const host = u => { try { return new URL(u).host; } catch { return u; } };
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav', webm: 'audio/webm', weba: 'audio/webm' };

let toastT;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms);
}
function buzz(ms = 8) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch {} } }

const saveSettings = () => kvSet('settings', settings);
let dspSaveT;
const saveDsp = () => { clearTimeout(dspSaveT); dspSaveT = setTimeout(() => kvSet('dsp', engine.s), 300); };

/* ================= Hojas (menús y diálogos) ================= */
function openSheet(title, build) {
  $('sheetTitle').textContent = title;
  const body = $('sheetBody');
  body.innerHTML = '';
  build(body);
  $('sheet').hidden = false;
}
function closeSheet() { $('sheet').hidden = true; }
function sheetButton(body, label, fn, cls = '') {
  const b = document.createElement('button');
  b.className = 'tog ' + cls; b.textContent = label;
  b.onclick = () => { closeSheet(); fn(); };
  body.appendChild(b);
  return b;
}
function askText(title, placeholder = '', value = '') {
  return new Promise(resolve => {
    openSheet(title, body => {
      const inp = document.createElement('input');
      inp.className = 'lcd-input'; inp.placeholder = placeholder; inp.value = value;
      const ok = document.createElement('button'); ok.className = 'tog'; ok.textContent = 'ACEPTAR';
      const done = () => { closeSheet(); resolve(inp.value.trim() || null); };
      ok.onclick = done;
      inp.onkeydown = e => { if (e.key === 'Enter') done(); };
      body.append(inp, ok);
      setTimeout(() => inp.focus(), 50);
    });
    $('sheet').dataset.cancel = '1';
    sheetCancel = () => resolve(null);
  });
}
function confirmSheet(title, msg, okLabel = 'SÍ, CONTINUAR') {
  return new Promise(resolve => {
    openSheet(title, body => {
      const p = document.createElement('p'); p.className = 'muted'; p.style.fontFamily = 'VT323,monospace'; p.style.fontSize = '18px'; p.textContent = msg;
      body.appendChild(p);
      sheetButton(body, okLabel, () => resolve(true), 'danger');
      sheetButton(body, 'CANCELAR', () => resolve(false));
    });
    sheetCancel = () => resolve(false);
  });
}
let sheetCancel = null;
document.querySelectorAll('.sheet').forEach(sh => {
  sh.addEventListener('click', e => {
    if (e.target === sh || e.target.closest('[data-close]')) {
      sh.hidden = true;
      if (sh.id === 'sheet' && sheetCancel) { const c = sheetCancel; sheetCancel = null; c(); }
    }
  });
});

/* ================= Tema y ventanas ================= */
const THEMES = ['dark', 'light', 'neon'];
const THEME_COLOR = { dark: '#15161a', light: '#dfe3ea', neon: '#000000' };
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  document.querySelector('meta[name=theme-color]').setAttribute('content', THEME_COLOR[settings.theme]);
  document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('active', b.dataset.themeSet === settings.theme));
  vizColors = null;
  drawCurve();
}
function applyWindows() {
  for (const [id, show] of Object.entries(settings.showWins)) {
    $(id)?.classList.toggle('hidden', !show);
    const b = document.querySelector(`[data-win="${id}"]`);
    if (b) b.setAttribute('aria-pressed', String(!!show));
  }
  for (const [id, sh] of Object.entries(settings.shaded || {})) $(id)?.classList.toggle('shaded', !!sh);
}

/* ================= Ecualizador ================= */
const sliders = [];
function makeVSlider(label, get, set) {
  const wrap = document.createElement('div'); wrap.className = 'vs';
  const val = document.createElement('div'); val.className = 'vs-val';
  const track = document.createElement('div'); track.className = 'vs-track';
  const fill = document.createElement('div'); fill.className = 'vs-fill';
  const thumb = document.createElement('div'); thumb.className = 'vs-thumb';
  const lbl = document.createElement('span'); lbl.className = 'vs-lbl'; lbl.textContent = label;
  track.append(fill, thumb); wrap.append(val, track, lbl);
  const render = () => {
    const v = get();
    const pos = (12 - v) / 24 * 100;
    thumb.style.top = pos + '%';
    fill.style.top = Math.min(pos, 50) + '%';
    fill.style.bottom = (100 - Math.max(pos, 50)) + '%';
    val.textContent = (v > 0 ? '+' : '') + (Math.round(v * 2) / 2);
  };
  let drag = false, lastTap = 0;
  const fromY = y => {
    const r = track.getBoundingClientRect();
    const v = 12 - clamp((y - r.top) / r.height, 0, 1) * 24;
    return Math.round(v * 2) / 2;
  };
  track.addEventListener('pointerdown', e => {
    const now = Date.now();
    if (now - lastTap < 300) { set(0); render(); lastTap = 0; return; }
    lastTap = now;
    drag = true; track.setPointerCapture(e.pointerId);
    set(fromY(e.clientY)); render();
  });
  track.addEventListener('pointermove', e => { if (drag) { set(fromY(e.clientY)); render(); } });
  const end = () => { drag = false; };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  sliders.push(render);
  render();
  return wrap;
}

function buildEq() {
  const box = $('eqSliders');
  box.innerHTML = '';
  box.appendChild(makeVSlider('PREAMP', () => engine.s.preamp, v => { engine.update({ preamp: v }); afterDsp(); }));
  const sep = document.createElement('div'); sep.className = 'eq-sep'; box.appendChild(sep);
  EQ_FREQS.forEach((f, i) => {
    box.appendChild(makeVSlider(EQ_LABELS[i], () => engine.s.eq[i], v => { engine.setBand(i, v); afterDsp(); }));
  });
}

// Curva calculada con filtros espejo en un OfflineAudioContext (no requiere gesto del usuario)
let mirror = null;
const curveFreqs = new Float32Array(160).map((_, i) => 20 * Math.pow(1000, i / 159));
function getMirror() {
  if (mirror) return mirror;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const c = new OAC(1, 128, 48000);
  const mk = (type, f) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; return b; };
  mirror = {
    eq: EQ_FREQS.map((f, i) => { const b = mk(i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking', f); b.Q.value = 1.05; return b; }),
    bass: mk('lowshelf', 110), treble: mk('highshelf', 7500),
  };
  return mirror;
}
function drawCurve() {
  const cv = $('eqCurve');
  const w = cv.width = cv.clientWidth * devicePixelRatio || 300;
  const h = cv.height = cv.clientHeight * devicePixelRatio || 44;
  const g = cv.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = cs.getPropertyValue('--lcd-dim');
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  const m = getMirror();
  if (!m) return;
  const s = engine.s;
  m.eq.forEach((b, i) => { b.gain.value = s.eqOn && !s.pure ? s.eq[i] : 0; });
  m.bass.gain.value = s.pure ? 0 : s.bass; m.treble.gain.value = s.pure ? 0 : s.treble;
  const n = curveFreqs.length, mag = new Float32Array(n), ph = new Float32Array(n), tot = new Float32Array(n).fill(1);
  for (const f of [...m.eq, m.bass, m.treble]) { f.getFrequencyResponse(curveFreqs, mag, ph); for (let i = 0; i < n; i++) tot[i] *= mag[i]; }
  const pre = s.pure ? 0 : s.preamp + engine.headroomDb();
  g.strokeStyle = cs.getPropertyValue('--lcd-fg');
  g.lineWidth = 2 * devicePixelRatio;
  g.shadowColor = cs.getPropertyValue('--lcd-fg'); g.shadowBlur = settings.theme === 'light' ? 0 : 4;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const db = 20 * Math.log10(tot[i]) + pre;
    const x = i / (n - 1) * w;
    const y = h / 2 - clamp(db / 18, -1, 1) * (h / 2 - 3);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
}

function syncDspUI() {
  const s = engine.s;
  $('eqOn').setAttribute('aria-pressed', String(s.eqOn));
  $('eqAuto').setAttribute('aria-pressed', String(s.autoHeadroom));
  $('dBass').value = s.bass; $('oBass').textContent = (s.bass > 0 ? '+' : '') + s.bass + ' dB';
  $('dTreble').value = s.treble; $('oTreble').textContent = (s.treble > 0 ? '+' : '') + s.treble + ' dB';
  $('dWidth').value = Math.round(s.width * 100); $('oWidth').textContent = Math.round(s.width * 100) + ' %';
  $('dRevMix').value = Math.round(s.reverbMix * 100); $('oRevMix').textContent = Math.round(s.reverbMix * 100) + ' %';
  $('dRevSize').value = s.reverbSize; $('oRevSize').textContent = (+s.reverbSize).toFixed(1) + ' s';
  $('dLoud').setAttribute('aria-pressed', String(s.loudness));
  $('dLim').setAttribute('aria-pressed', String(s.limiter));
  $('dPure').setAttribute('aria-pressed', String(s.pure));
  $('vol').value = Math.round(s.volume * 100);
  $('bal').value = Math.round(s.balance * 100);
  sliders.forEach(r => r());
  const active = !s.pure && (s.eqOn && s.eq.some(v => v) || s.bass || s.treble || s.loudness || s.width !== 1 || s.reverbMix > 0 || s.preamp);
  $('ledDsp').classList.toggle('on', !!active);
  $('ledStereo').textContent = s.width === 0 && !s.pure ? 'MONO' : 'STEREO';
  $('ledStereo').classList.toggle('on', !!player.cur);
  drawCurve();
}
function afterDsp() { syncDspUI(); saveDsp(); }

function wireDsp() {
  $('eqOn').onclick = () => { engine.update({ eqOn: !engine.s.eqOn }); afterDsp(); };
  $('eqAuto').onclick = () => { engine.update({ autoHeadroom: !engine.s.autoHeadroom }); afterDsp(); toast(engine.s.autoHeadroom ? 'AUTO: compensación de ganancia activa' : 'AUTO desactivado'); };
  $('eqPresets').onclick = openPresets;
  const bind = (id, fn) => $(id).addEventListener('input', e => { fn(+e.target.value); afterDsp(); });
  bind('dBass', v => engine.update({ bass: v }));
  bind('dTreble', v => engine.update({ treble: v }));
  bind('dWidth', v => engine.update({ width: v / 100 }));
  bind('dRevMix', v => engine.update({ reverbMix: v / 100 }));
  bind('dRevSize', v => engine.update({ reverbSize: v }));
  bind('vol', v => engine.update({ volume: v / 100 }));
  bind('bal', v => engine.update({ balance: Math.abs(v) < 6 ? 0 : v / 100 }));
  $('bal').addEventListener('dblclick', () => { engine.update({ balance: 0 }); afterDsp(); });
  $('dLoud').onclick = () => { engine.update({ loudness: !engine.s.loudness }); afterDsp(); };
  $('dLim').onclick = () => { engine.update({ limiter: !engine.s.limiter }); afterDsp(); };
  $('dPure').onclick = () => { engine.update({ pure: !engine.s.pure }); afterDsp(); toast(engine.s.pure ? 'MODO PURO: salida sin procesar' : 'Procesamiento DSP activo'); };
  $('dReset').onclick = () => {
    const keep = { volume: engine.s.volume, eq: engine.s.eq, preamp: engine.s.preamp, eqOn: engine.s.eqOn, preset: engine.s.preset, autoHeadroom: engine.s.autoHeadroom };
    engine.update({ ...structuredClone(DEFAULT_DSP), ...keep });
    afterDsp();
  };
}

function openPresets() {
  openSheet('PRESETS', body => {
    const all = { ...PRESETS, ...settings.customPresets };
    for (const [name, vals] of Object.entries(all)) {
      const custom = name in settings.customPresets;
      sheetButton(body, (engine.s.preset === name ? '● ' : '') + name + (custom ? '  (tuyo)' : ''), () => {
        engine.update({ eq: [...vals.slice(0, 10)], preamp: vals[10] ?? 0, preset: name });
        afterDsp(); toast('Preset: ' + name);
      });
    }
    sheetButton(body, '+ GUARDAR AJUSTE ACTUAL…', async () => {
      const name = await askText('NOMBRE DEL PRESET', 'Mi preset');
      if (!name) return;
      settings.customPresets[name] = [...engine.s.eq, engine.s.preamp];
      engine.s.preset = name; saveSettings(); saveDsp(); toast('Preset guardado');
    });
    if (Object.keys(settings.customPresets).length) {
      sheetButton(body, '− BORRAR UN PRESET TUYO…', () => {
        openSheet('BORRAR PRESET', b2 => {
          for (const n of Object.keys(settings.customPresets)) sheetButton(b2, n, () => { delete settings.customPresets[n]; saveSettings(); toast('Preset borrado'); }, 'danger');
        });
      });
    }
  });
}

/* ================= Biblioteca y listas ================= */
async function loadLibrary() {
  const all = await Tracks.getAll();
  tracks.clear();
  all.forEach(t => tracks.set(t.id, t));
  playlists = (await Playlists.getAll()).sort((a, b) => a.created - b.created);
}

function libraryIds() {
  const arr = [...tracks.values()].filter(t => t.kind !== 'yt');
  const by = settings.libSort;
  const cmp = {
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', 'es'),
    artist: (a, b) => (a.artist || '').localeCompare(b.artist || '', 'es') || (a.title || '').localeCompare(b.title || '', 'es'),
    duration: (a, b) => (a.duration || 0) - (b.duration || 0),
  }[by] || (() => 0);
  return arr.sort(cmp).map(t => t.id);
}
function currentListIds(plId = player.plId) {
  if (plId === LIB) return libraryIds();
  const pl = playlists.find(p => p.id === plId);
  return pl ? pl.trackIds.filter(id => tracks.has(id)) : [];
}

function renderPlSelect() {
  const sel = $('plSelect');
  const libCount = [...tracks.values()].filter(t => t.kind !== 'yt').length;
  sel.innerHTML = `<option value="${LIB}">BIBLIOTECA (${libCount})</option>` +
    playlists.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${p.trackIds.length})</option>`).join('');
  if (player.plId !== LIB && !playlists.some(p => p.id === player.plId)) player.plId = LIB;
  sel.value = player.plId;
}

function renderList() {
  const ul = $('playlist');
  const q = $('plFilter').value.trim().toLowerCase();
  const ids = currentListIds();
  viewIds = ids;
  const curId = player.cur?.id;
  let total = 0;
  const rows = [];
  ids.forEach((id, i) => {
    const t = tracks.get(id);
    if (!t) return;
    total += t.duration || 0;
    const label = (t.artist ? t.artist + ' - ' : '') + (t.title || t.name || id);
    if (q && !label.toLowerCase().includes(q) && !(t.album || '').toLowerCase().includes(q)) return;
    const tag = t.kind === 'yt' ? '<small>[YT]</small>' : t.kind === 'device' ? '' : (t.ytId ? '<small>[YT↓]</small>' : '');
    rows.push(`<li data-id="${esc(id)}" class="${id === curId ? 'cur' : ''}${id === selectedId ? ' sel' : ''}"><span class="t">${i + 1}. ${esc(label)}${tag}</span><span class="d">${t.duration ? fmt(t.duration) : '--:--'}</span><button class="m" data-menu aria-label="Opciones">⋮</button></li>`);
  });
  if (!rows.length) {
    rows.push(`<li class="empty">${ids.length ? 'Sin coincidencias.' : player.plId === LIB
      ? (NATIVE ? 'Biblioteca vacía. Toca ESCANEAR MÚSICA para leer los audios del teléfono o + ARCHIVOS para elegirlos.' : 'Biblioteca vacía. Toca + ARCHIVOS (o el botón ⏏) para agregar audios del dispositivo, o busca en YouTube.')
      : 'Lista vacía. Agrega pistas desde la biblioteca (⋮ → Añadir a lista) o desde YouTube.'}</li>`);
  }
  ul.innerHTML = rows.join('');
  $('plTotal').textContent = `${ids.length} pistas · ${fmt(total)}`;
}

function refreshLists() { renderPlSelect(); renderList(); }

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const added = [];
  let i = 0;
  for (const f of files) {
    i++;
    toast(`Importando ${i}/${files.length}: ${f.name}`, 8000);
    try {
      const id = 'loc:' + uid();
      const ext = extOf(f.name);
      const tags = await readTags(f, f.name);
      let duration = 0;
      if (!RARE_EXT.includes(ext)) {
        const u = URL.createObjectURL(f);
        duration = await probeDuration(u);
        URL.revokeObjectURL(u);
      }
      const t = {
        id, kind: 'local', name: f.name, ext, title: tags.title, artist: tags.artist, album: tags.album,
        duration, size: f.size, mime: f.type || MIME[ext] || 'application/octet-stream', sampleRate: tags.sampleRate || 0,
        addedAt: Date.now() + i, hasCover: !!tags.cover,
      };
      await Blobs.put({ id, blob: f, cover: tags.cover || null });
      await Tracks.put(t);
      tracks.set(id, t);
      added.push(id);
    } catch (e) {
      console.warn(e);
      toast('No se pudo importar ' + f.name);
    }
  }
  const pl = playlists.find(p => p.id === player.plId);
  if (pl) { pl.trackIds.push(...added); await Playlists.put(pl); }
  refreshLists();
  toast(`${added.length} audio(s) agregados`);
  requestPersist();
}

async function scanDevice() {
  if (!Native) return;
  toast('Escaneando música del teléfono…', 10000);
  try {
    const r = await Native.scan();
    const list = r.tracks || [];
    const seen = new Set();
    const now = Date.now();
    const batch = list.map((x, i) => {
      const id = 'dev:' + x.id;
      seen.add(id);
      const prev = tracks.get(id);
      const t = {
        id, kind: 'device', uri: x.uri, name: x.name || '', ext: extOf(x.name), title: x.title || x.name,
        artist: x.artist && x.artist !== '<unknown>' ? x.artist : '', album: x.album || '', duration: (x.duration || 0) / 1000,
        size: x.size || 0, mime: x.mime || '', addedAt: prev?.addedAt || (x.dateAdded ? x.dateAdded * 1000 : now - i), hasCover: false,
      };
      tracks.set(id, t);
      return t;
    });
    await Tracks.putMany(batch);
    for (const t of [...tracks.values()]) {
      if (t.kind === 'device' && !seen.has(t.id)) { tracks.delete(t.id); await Tracks.del(t.id); }
    }
    refreshLists();
    toast(`${batch.length} audios encontrados en el teléfono`);
  } catch (e) {
    toast('Escaneo cancelado: ' + (e.message || e));
  }
}

async function addToPlaylistSheet(ids) {
  openSheet('AÑADIR A LISTA', body => {
    for (const p of playlists) sheetButton(body, `${p.name} (${p.trackIds.length})`, async () => {
      p.trackIds.push(...ids); await Playlists.put(p); refreshLists(); toast(`Añadido a ${p.name}`);
    });
    sheetButton(body, '+ NUEVA LISTA…', async () => {
      const name = await askText('NUEVA LISTA', 'Nombre de la lista');
      if (!name) return;
      const p = { id: 'pl:' + uid(), name, trackIds: [...ids], created: Date.now() };
      playlists.push(p); await Playlists.put(p); refreshLists(); toast(`Lista "${name}" creada`);
    });
  });
}

function trackMenu(id) {
  const t = tracks.get(id);
  if (!t) return;
  openSheet((t.title || 'PISTA').slice(0, 40).toUpperCase(), body => {
    sheetButton(body, '▶ REPRODUCIR', () => playFromView(id));
    sheetButton(body, '+ AÑADIR A LISTA…', () => addToPlaylistSheet([id]));
    if (t.kind === 'yt') sheetButton(body, '⬇ GUARDAR EN BIBLIOTECA (SIN CONEXIÓN)', () => downloadYouTube({ id: t.ytId, title: t.title, author: t.artist, duration: t.duration, thumb: t.thumb }));
    const pl = playlists.find(p => p.id === player.plId);
    if (pl) sheetButton(body, '− QUITAR DE ESTA LISTA', async () => {
      const k = pl.trackIds.indexOf(id); if (k >= 0) pl.trackIds.splice(k, 1);
      await Playlists.put(pl); refreshLists();
    });
    sheetButton(body, 'ⓘ INFORMACIÓN', () => showInfo(t));
    if (t.kind !== 'yt') sheetButton(body, '✕ QUITAR DE BIBLIOTECA', async () => {
      const ok = await confirmSheet('QUITAR', t.kind === 'device'
        ? 'Se quitará de la biblioteca de RetroAmp. El archivo del teléfono no se borra.'
        : 'Se borrará la copia guardada en RetroAmp. Esta acción no se puede deshacer.');
      if (!ok) return;
      await Tracks.del(id); await Blobs.del(id); await Blobs.del('conv:' + id).catch(() => {});
      tracks.delete(id);
      for (const p of playlists) { const before = p.trackIds.length; p.trackIds = p.trackIds.filter(x => x !== id); if (p.trackIds.length !== before) await Playlists.put(p); }
      refreshLists();
    }, 'danger');
  });
}

function showInfo(t) {
  openSheet('INFORMACIÓN', body => {
    const rows = [
      ['Título', t.title], ['Artista', t.artist], ['Álbum', t.album], ['Archivo', t.name],
      ['Origen', t.kind === 'yt' ? 'YouTube (streaming)' : t.kind === 'device' ? 'Teléfono' : t.ytId ? 'YouTube (guardado)' : 'Importado'],
      ['Formato', (t.converted ? 'FLAC (convertido desde ' + (t.ext || '?').toUpperCase() + ')' : (t.ext || t.mime || '').toUpperCase())],
      ['Duración', t.duration ? fmt(t.duration) : '—'], ['Tamaño', t.size ? (t.size / 1048576).toFixed(2) + ' MB' : '—'],
      ['Bitrate aprox.', t.size && t.duration ? Math.round(t.size * 8 / t.duration / 1000) + ' kbps' : '—'],
    ].filter(r => r[1]);
    const pre = document.createElement('pre'); pre.className = 'test-out';
    pre.textContent = rows.map(r => `${r[0].padEnd(15)} ${r[1]}`).join('\n');
    body.appendChild(pre);
  });
}

function plMenu() {
  const pl = playlists.find(p => p.id === player.plId);
  openSheet('LISTAS', body => {
    sheetButton(body, '+ NUEVA LISTA…', async () => {
      const name = await askText('NUEVA LISTA', 'Nombre de la lista');
      if (!name) return;
      const p = { id: 'pl:' + uid(), name, trackIds: [], created: Date.now() };
      playlists.push(p); await Playlists.put(p); player.plId = p.id; refreshLists();
    });
    if (pl) {
      sheetButton(body, '✎ RENOMBRAR LISTA…', async () => {
        const name = await askText('RENOMBRAR', 'Nombre', pl.name);
        if (!name) return; pl.name = name; await Playlists.put(pl); refreshLists();
      });
      sheetButton(body, '⧉ QUITAR DUPLICADOS', async () => {
        pl.trackIds = [...new Set(pl.trackIds)]; await Playlists.put(pl); refreshLists();
      });
      sheetButton(body, '✕ ELIMINAR LISTA', async () => {
        if (!(await confirmSheet('ELIMINAR LISTA', `Se eliminará la lista "${pl.name}". Las pistas siguen en la biblioteca.`))) return;
        await Playlists.del(pl.id); playlists = playlists.filter(p => p !== pl); player.plId = LIB; refreshLists();
      }, 'danger');
    } else {
      sheetButton(body, '+ AÑADIR TODA LA BIBLIOTECA A UNA LISTA…', () => addToPlaylistSheet(libraryIds()));
    }
  });
}

function sortMenu() {
  const pl = playlists.find(p => p.id === player.plId);
  const opts = [['added', 'FECHA DE INGRESO'], ['title', 'TÍTULO'], ['artist', 'ARTISTA'], ['duration', 'DURACIÓN']];
  openSheet('ORDENAR', body => {
    for (const [k, label] of opts) sheetButton(body, (settings.libSort === k && !pl ? '● ' : '') + label, async () => {
      if (pl) {
        const tmp = settings.libSort; settings.libSort = k;
        const order = libraryIds(); settings.libSort = tmp;
        const rank = new Map(order.map((id, i) => [id, i]));
        pl.trackIds.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
        await Playlists.put(pl);
      } else { settings.libSort = k; saveSettings(); }
      renderList();
    });
    if (pl) sheetButton(body, '⇅ INVERTIR ORDEN', async () => { pl.trackIds.reverse(); await Playlists.put(pl); renderList(); });
  });
}

/* ================= Reproducción ================= */
function buildOrder(startIdx) {
  const n = player.list.length;
  player.order = [...Array(n).keys()];
  if (player.shuffle) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [player.order[i], player.order[j]] = [player.order[j], player.order[i]]; }
    const k = player.order.indexOf(startIdx);
    if (k > 0) { player.order.splice(k, 1); player.order.unshift(startIdx); }
    player.pos = startIdx >= 0 ? 0 : -1;
  } else player.pos = startIdx;
}

function playFromView(id) {
  engine.init(); engine.resume();
  player.list = [...viewIds];
  const idx = player.list.indexOf(id);
  buildOrder(idx);
  playTrack(id);
}

function loadSrc(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const ok = () => { done(); resolve(); };
    const bad = () => { const err = audio.error; done(); reject(new Error(err ? `media error ${err.code}` : 'error')); };
    const to = setTimeout(() => { done(); reject(new Error('tiempo de espera agotado')); }, timeout);
    function done() { clearTimeout(to); audio.removeEventListener('canplay', ok); audio.removeEventListener('loadedmetadata', ok); audio.removeEventListener('error', bad); }
    audio.addEventListener('canplay', ok);
    audio.addEventListener('loadedmetadata', ok);
    audio.addEventListener('error', bad);
    audio.src = url;
    audio.load();
  });
}

function setObjUrl(blob) {
  if (player.objUrl) URL.revokeObjectURL(player.objUrl);
  player.objUrl = URL.createObjectURL(blob);
  return player.objUrl;
}

async function blobFor(t) {
  if (t.kind === 'local') { const r = await Blobs.get(t.id); if (!r) throw new Error('Archivo no encontrado en la biblioteca'); return r.blob; }
  if (t.kind === 'device') {
    const conv = await Blobs.get('conv:' + t.id);
    if (conv) return conv.blob;
    const res = await fetch(Cap.convertFileSrc(t.uri));
    if (!res.ok) throw new Error('No se pudo leer el archivo del teléfono');
    const b = await res.blob();
    return b.type ? b : new Blob([b], { type: t.mime || MIME[t.ext] || '' });
  }
  throw new Error('Origen no soportado');
}

async function convertAndStore(t, blob) {
  const out = await transcode(blob, t.name || ('audio.' + (t.ext || 'bin')), (msg) => setMarqueeText(msg.toUpperCase() + ' ***'));
  if (t.kind === 'local') {
    const prev = await Blobs.get(t.id);
    await Blobs.put({ id: t.id, blob: out, cover: prev?.cover || null });
    t.converted = true; t.size = out.size; t.mime = 'audio/flac';
  } else {
    await Blobs.put({ id: 'conv:' + t.id, blob: out });
    t.converted = true;
  }
  await Tracks.put(t);
  return out;
}

async function playTrack(id, { autoplay = true, startAt = 0 } = {}) {
  const t = tracks.get(id);
  if (!t) return;
  const token = ++player.token;
  player.cur = t; player.kbps = 0; player.loading = true;
  selectedId = null;
  updateDisplay(); renderList(); scrollToCurrent();
  setMarqueeText('CARGANDO… ***');
  try {
    if (t.kind === 'yt') {
      await playYouTubeStream(t, token);
    } else {
      let blob = await blobFor(t);
      if (token !== player.token) return;
      const rare = RARE_EXT.includes(t.ext) && !t.converted;
      if (rare) blob = await convertAndStore(t, blob);
      if (token !== player.token) return;
      try {
        await loadSrc(setObjUrl(blob));
      } catch (e) {
        if (t.converted) throw e;
        toast('Formato no nativo: usando el decodificador universal…', 4000);
        blob = await convertAndStore(t, blob);
        if (token !== player.token) return;
        await loadSrc(setObjUrl(blob));
      }
      if (!t.duration && isFinite(audio.duration)) { t.duration = audio.duration; Tracks.put(t); }
      player.kbps = t.size && t.duration ? Math.round(t.size * 8 / t.duration / 1000) : 0;
    }
    if (token !== player.token) return;
    if (startAt) { try { audio.currentTime = startAt; } catch {} }
    player.loading = false;
    updateDisplay(); updateMediaSession(); saveSession();
    if (autoplay) await doPlay();
  } catch (e) {
    if (token !== player.token) return;
    player.loading = false;
    console.warn(e);
    toast('Error: ' + (e.message || e), 4500);
    setMarqueeText('ERROR AL CARGAR · ' + (t.title || '') + ' ***');
    updateDisplay();
  }
}

async function playYouTubeStream(t, token) {
  let ok = false;
  const tried = [];
  for await (const c of yt.candidates(t.ytId)) {
    if (token !== player.token) return;
    $('ytStatus').textContent = 'Conectando: ' + host(c.source);
    setMarqueeText('CONECTANDO CON ' + host(c.source).toUpperCase() + '… ***');
    try {
      await loadSrc(c.url, c.kind === 'server' ? 30000 : 15000);
      yt.markGood(c);
      player.kbps = c.kbps || 0;
      if (c.meta) {
        if (c.meta.title && (!t.title || t.title.startsWith('Video '))) t.title = c.meta.title;
        if (c.meta.author && !t.artist) t.artist = c.meta.author;
        if (c.meta.duration && !t.duration) t.duration = c.meta.duration;
        if (tracks.has(t.id)) Tracks.put(t);
      }
      $('ytStatus').textContent = 'Fuente: ' + host(c.source) + (c.kbps ? ` · ${c.kbps} kbps` : '');
      ok = true; break;
    } catch (e) { tried.push(host(c.source)); }
  }
  if (!ok) {
    $('ytStatus').textContent = 'Sin respuesta de: ' + (tried.join(', ') || 'ninguna fuente configurada');
    throw new Error('No se pudo obtener el audio. Revisa tu servidor o actualiza las instancias en Ajustes.');
  }
  if (!t.duration && isFinite(audio.duration)) t.duration = audio.duration;
}

async function doPlay() {
  engine.init();
  await engine.resume();
  try { await audio.play(); } catch (e) { toast('Toca ▶ para reproducir'); }
}

function nextIndex(dir) {
  const n = player.order.length;
  if (!n) return -1;
  let p = player.pos + dir;
  if (p >= n) { if (player.repeat === 1) { if (player.shuffle) { buildOrder(-1); p = 0; } else p = 0; } else return -1; }
  if (p < 0) p = player.repeat === 1 ? n - 1 : 0;
  return p;
}
function go(dir) {
  if (!player.list.length) { if (viewIds.length) playFromView(viewIds[0]); return; }
  if (dir < 0 && audio.currentTime > 4) { audio.currentTime = 0; return; }
  const p = nextIndex(dir);
  if (p < 0) { stop(); return; }
  player.pos = p;
  playTrack(player.list[player.order[p]]);
}
function stop() {
  audio.pause();
  try { audio.currentTime = 0; } catch {}
  updateDisplay();
}

audio.addEventListener('ended', () => {
  if (player.repeat === 2) { audio.currentTime = 0; doPlay(); return; }
  const p = nextIndex(1);
  if (p < 0) { updateDisplay(); nativeService(false); return; }
  player.pos = p;
  playTrack(player.list[player.order[p]]);
});
audio.addEventListener('play', () => { updateDisplay(); nativeService(true); startViz(); });
audio.addEventListener('pause', () => { updateDisplay(); if (!player.loading) nativeService(false); });
audio.addEventListener('timeupdate', () => { updateTime(); saveSessionSoon(); });
audio.addEventListener('durationchange', updateTime);

// El servicio se detiene con retraso: entre canciones Android no permite reiniciarlo desde segundo plano
let svcStopT = null;
function nativeService(on) {
  if (!Native) return;
  clearTimeout(svcStopT);
  if (!on) {
    svcStopT = setTimeout(() => { if (audio.paused && !player.loading) nativeService.raw(false); }, 60000);
    return;
  }
  nativeService.raw(true);
}
nativeService.raw = on => {
  try {
    const p = on
      ? Native.startService({ title: player.cur ? ((player.cur.artist ? player.cur.artist + ' - ' : '') + player.cur.title) : 'RetroAmp' })
      : Native.stopService();
    p && p.catch && p.catch(() => {});
  } catch {}
}

/* ================= Display ================= */
let marqueeKey = '';
function setMarqueeText(txt) {
  if (txt === marqueeKey) return;
  marqueeKey = txt;
  const m = $('marquee');
  m.textContent = txt;
  m.style.animationDuration = Math.max(8, txt.length * 0.22) + 's';
}

function updateDisplay() {
  const t = player.cur;
  const playing = !audio.paused && !audio.ended;
  $('dispState').textContent = player.loading ? '…' : playing ? '▶' : (audio.currentTime > 0 ? 'Ⅱ' : '■');
  if (t && !player.loading) {
    const n = player.list.indexOf(t.id) + 1;
    setMarqueeText(`${n > 0 ? n + '. ' : ''}${t.artist ? t.artist + ' - ' : ''}${t.title || t.name} (${fmt(t.duration || audio.duration)})  ***  `);
  }
  $('dispKbps').textContent = player.kbps ? String(player.kbps).padStart(3, ' ') : '---';
  const khz = t?.sampleRate || engine.sampleRate || 0;
  $('dispKhz').textContent = khz ? Math.round(khz / 1000) : '--';
  $('ledSrc').textContent = !t ? 'LOCAL' : t.kind === 'yt' ? 'YOUTUBE' : t.kind === 'device' ? 'TELÉFONO' : t.ytId ? 'YT·GUARDADO' : 'LOCAL';
  $('ledSrc').classList.toggle('on', !!t);
  $('ledStereo').classList.toggle('on', !!t);
  $('btnShuffle').setAttribute('aria-pressed', String(player.shuffle));
  $('btnRepeat').setAttribute('aria-pressed', String(player.repeat > 0));
  $('btnRepeat').textContent = player.repeat === 2 ? 'REPETIR 1' : 'REPETIR';
  updateTime();
}

let seeking = false;
function updateTime() {
  const d = audio.duration, c = audio.currentTime;
  const el = $('dispTime');
  const shown = settings.remain && isFinite(d) ? d - c : c;
  const s = Math.floor(Math.max(0, shown));
  const mm = Math.floor(s / 60), ss = s % 60;
  el.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  el.classList.toggle('remain', settings.remain && isFinite(d));
  if (!seeking) $('seek').value = isFinite(d) && d > 0 ? Math.round(c / d * 1000) : 0;
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(d) && d > 0) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: audio.playbackRate }); } catch {}
  }
}

function scrollToCurrent() {
  const li = $('playlist').querySelector('li.cur');
  if (li) li.scrollIntoView({ block: 'nearest' });
}

async function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = player.cur;
  if (!t) return;
  let art = [];
  if (player.coverUrl) { URL.revokeObjectURL(player.coverUrl); player.coverUrl = null; }
  try {
    if (t.thumb) art = [{ src: t.thumb, sizes: '320x180', type: 'image/jpeg' }];
    else if (t.hasCover) {
      const r = await Blobs.get(t.id);
      if (r?.cover) { player.coverUrl = URL.createObjectURL(r.cover); art = [{ src: player.coverUrl, sizes: '512x512', type: r.cover.type }]; }
    }
  } catch {}
  if (!art.length) art = [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || t.name || 'RetroAmp', artist: t.artist || '', album: t.album || 'RetroAmp', artwork: art });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const h = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  h('play', () => doPlay());
  h('pause', () => audio.pause());
  h('stop', () => stop());
  h('previoustrack', () => go(-1));
  h('nexttrack', () => go(1));
  h('seekbackward', d => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
  h('seekforward', d => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
  h('seekto', d => { if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime); else audio.currentTime = d.seekTime; });
}

/* ================= Visualizador ================= */
const viz = $('viz');
const vctx = viz.getContext('2d');
let vizColors = null, vizRunning = false, peaks = new Array(19).fill(0), lastMeter = 0, clipHold = 0;
let freqBuf = null, timeBuf = null;
function getVizColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = vctx.createLinearGradient(0, viz.height, 0, 0);
  g.addColorStop(0, cs.getPropertyValue('--viz1').trim());
  g.addColorStop(0.6, cs.getPropertyValue('--viz2').trim());
  g.addColorStop(1, cs.getPropertyValue('--viz3').trim());
  return { grad: g, peak: cs.getPropertyValue('--peak').trim(), line: cs.getPropertyValue('--lcd-fg').trim(), dim: cs.getPropertyValue('--lcd-dim').trim() };
}
function startViz() { if (!vizRunning) { vizRunning = true; requestAnimationFrame(drawViz); } }
function drawViz(ts) {
  const W = viz.width, H = viz.height;
  if (!vizColors) vizColors = getVizColors();
  vctx.clearRect(0, 0, W, H);
  const a = engine.analyser;
  const active = a && !audio.paused && !document.hidden;
  if (a && settings.vizMode === 0) {
    if (!freqBuf) freqBuf = new Uint8Array(a.frequencyBinCount);
    if (active) a.getByteFrequencyData(freqBuf); else freqBuf.fill(0);
    const nb = 19, bw = 6, gap = 2;
    const hz = engine.sampleRate / a.fftSize;
    for (let i = 0; i < nb; i++) {
      const f0 = 40 * Math.pow(16000 / 40, i / nb), f1 = 40 * Math.pow(16000 / 40, (i + 1) / nb);
      const b0 = Math.max(1, Math.floor(f0 / hz)), b1 = Math.max(b0 + 1, Math.ceil(f1 / hz));
      let v = 0;
      for (let b = b0; b < b1 && b < freqBuf.length; b++) v = Math.max(v, freqBuf[b]);
      const hgt = Math.round((v / 255) * H);
      const x = i * (bw + gap);
      vctx.fillStyle = vizColors.grad;
      vctx.fillRect(x, H - hgt, bw, hgt);
      peaks[i] = Math.max(peaks[i] - 0.6, hgt);
      vctx.fillStyle = vizColors.peak;
      if (peaks[i] > 1) vctx.fillRect(x, H - Math.round(peaks[i]) - 1, bw, 1);
    }
  } else if (a && settings.vizMode === 1) {
    if (!timeBuf) timeBuf = new Uint8Array(a.fftSize);
    if (active) a.getByteTimeDomainData(timeBuf); else timeBuf.fill(128);
    vctx.strokeStyle = vizColors.line; vctx.lineWidth = 1;
    vctx.beginPath();
    for (let x = 0; x < W; x++) {
      const v = timeBuf[Math.floor(x / W * timeBuf.length)] / 255;
      const y = v * H;
      x ? vctx.lineTo(x, y) : vctx.moveTo(x, y);
    }
    vctx.stroke();
  }
  if (engine.ready && ts - lastMeter > 90) {
    lastMeter = ts;
    const m = engine.meters();
    if (m.clip) clipHold = ts + 600;
    $('ledClip').classList.toggle('on', ts < clipHold && !audio.paused);
    $('ledLim').classList.toggle('on', m.gr < -0.5 && !audio.paused);
  }
  if (!audio.paused || peaks.some(p => p > 1)) requestAnimationFrame(drawViz);
  else { vizRunning = false; $('ledClip').classList.remove('on'); $('ledLim').classList.remove('on'); }
}

/* ================= YouTube ================= */
let ytItems = [];
async function ytSearch(q) {
  if (!q) return;
  $('ytStatus').textContent = 'Buscando…';
  $('ytResults').innerHTML = '';
  try {
    const r = await yt.search(q);
    ytItems = r.items;
    $('ytStatus').textContent = `${r.items.length} resultados · fuente: ${host(r.source)}`;
    renderYt();
  } catch (e) {
    $('ytStatus').textContent = 'Sin resultados: ninguna fuente respondió. Revisa Ajustes → YouTube.';
    console.warn(e.details || e);
  }
}
function renderYt() {
  $('ytResults').innerHTML = ytItems.map((x, i) => `
    <li data-i="${i}">
      <img src="${esc(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <div class="yt-info">
        <div class="yt-title">${esc(x.title)}</div>
        <div class="yt-meta">${esc(x.author)}${x.duration ? ' · ' + fmt(x.duration) : ''}</div>
        <div class="yt-actions">
          <button class="tog" data-act="play">▶ REPRODUCIR</button>
          <button class="tog" data-act="list">+ LISTA</button>
          <button class="tog" data-act="save">⬇ GUARDAR</button>
        </div>
      </div>
    </li>`).join('');
}
function ytTrack(x) {
  const id = 'yt:' + x.id;
  let t = tracks.get(id);
  if (!t) t = { id, kind: 'yt', ytId: x.id, title: x.title, artist: x.author, duration: x.duration || 0, thumb: x.thumb, addedAt: Date.now() };
  return t;
}
function ytPlay(x) {
  engine.init(); engine.resume();
  const t = ytTrack(x);
  tracks.set(t.id, t);
  player.list = [t.id];
  buildOrder(0);
  playTrack(t.id);
}
async function ytAddToList(x) {
  const t = ytTrack(x);
  tracks.set(t.id, t);
  await Tracks.put(t);
  addToPlaylistSheet([t.id]);
}
async function downloadYouTube(x) {
  toast('Descargando audio…', 60000);
  for await (const c of yt.candidates(x.id)) {
    try {
      const res = await fetch(c.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = +res.headers.get('content-length') || 0;
      const reader = res.body.getReader();
      const chunks = []; let got = 0, lastT = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        const now = Date.now();
        if (now - lastT > 400) { lastT = now; toast(`Descargando ${host(c.source)}: ${total ? Math.round(got / total * 100) + ' %' : (got / 1048576).toFixed(1) + ' MB'}`, 60000); }
      }
      if (got < 30000) throw new Error('respuesta demasiado pequeña');
      const ctype = (res.headers.get('content-type') || '').split(';')[0];
      const type = ctype.startsWith('audio/') ? ctype : (c.url.includes('opus') || ctype.includes('webm') ? 'audio/webm' : 'audio/mp4');
      const blob = new Blob(chunks, { type });
      const id = 'loc:' + uid();
      const ext = type.includes('webm') ? 'webm' : 'm4a';
      const t = {
        id, kind: 'local', ytId: x.id, name: `${x.title}.${ext}`, ext, title: x.title, artist: x.author || '', album: 'YouTube',
        duration: x.duration || c.meta?.duration || 0, size: blob.size, mime: type, addedAt: Date.now(), hasCover: false, thumb: x.thumb,
      };
      let cover = null;
      try { const r = await fetch(x.thumb, { mode: 'cors' }); if (r.ok) { cover = await r.blob(); t.hasCover = true; delete t.thumb; } } catch {}
      await Blobs.put({ id, blob, cover });
      await Tracks.put(t);
      tracks.set(id, t);
      yt.markGood(c);
      refreshLists();
      toast('Guardado en la biblioteca: ' + x.title, 3500);
      requestPersist();
      return;
    } catch (e) { console.warn('descarga', c.source, e); }
  }
  toast('No se pudo descargar desde ninguna fuente', 4000);
}

/* ================= Ajustes ================= */
async function openSettings() {
  $('sHaptics').checked = settings.haptics;
  $('sResume').checked = settings.resume;
  $('sServer').value = settings.ytServer;
  $('sPriority').value = settings.ytPriority;
  $('sFormat').value = settings.ytFormat;
  $('sPiped').value = settings.pipedList.join('\n');
  $('sInv').value = settings.invList.join('\n');
  $('sDecoderState').textContent = isLoaded() ? 'Cargado' : (await isCached()) ? 'Descargado (listo sin conexión)' : 'No descargado';
  const st = await storageInfo();
  $('sStorage').textContent = `Usado: ${(st.usage / 1048576).toFixed(1)} MB de ${(st.quota / 1073741824).toFixed(1)} GB · ${st.persisted ? 'protegido contra borrado automático' : 'no protegido'}`;
  applyTheme();
  $('settings').hidden = false;
}
function wireSettings() {
  $('btnSettings').onclick = openSettings;
  $('btnTheme').onclick = () => { settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length]; applyTheme(); saveSettings(); toast('Fondo: ' + { dark: 'OSCURO', light: 'BLANCO', neon: 'VERDE NEÓN' }[settings.theme]); };
  document.querySelectorAll('[data-theme-set]').forEach(b => b.onclick = () => { settings.theme = b.dataset.themeSet; applyTheme(); saveSettings(); });
  $('sHaptics').onchange = e => { settings.haptics = e.target.checked; saveSettings(); };
  $('sResume').onchange = e => { settings.resume = e.target.checked; saveSettings(); };
  $('sServer').onchange = e => { settings.ytServer = e.target.value.trim().replace(/\/+$/, ''); saveSettings(); };
  $('sPriority').onchange = e => { settings.ytPriority = e.target.value; saveSettings(); };
  $('sFormat').onchange = e => { settings.ytFormat = e.target.value; saveSettings(); };
  const lines = v => v.split(/\s+/).map(s => s.trim().replace(/\/+$/, '')).filter(s => /^https?:\/\//.test(s));
  $('sPiped').onchange = e => { settings.pipedList = lines(e.target.value); saveSettings(); };
  $('sInv').onchange = e => { settings.invList = lines(e.target.value); saveSettings(); };
  $('sServerTest').onclick = async () => {
    settings.ytServer = $('sServer').value.trim().replace(/\/+$/, ''); saveSettings();
    if (!settings.ytServer) { $('sServerState').textContent = 'Escribe la dirección primero'; return; }
    $('sServerState').textContent = 'Probando…';
    try {
      const j = await yt.pingServer(settings.ytServer);
      $('sServerState').textContent = `OK · yt-dlp ${j.yt_dlp || '?'} · JS: ${j.js_runtime || 'ninguno'}`;
    } catch (e) { $('sServerState').textContent = 'Sin respuesta (' + (e.message || e) + ')'; }
  };
  $('sDiscover').onclick = async () => {
    $('sTestOut').hidden = false; $('sTestOut').textContent = 'Consultando listas oficiales de instancias…';
    const r = await yt.discover();
    if (r.piped.length) settings.pipedList = r.piped.slice(0, 12);
    if (r.inv.length) settings.invList = r.inv.slice(0, 12);
    saveSettings();
    $('sPiped').value = settings.pipedList.join('\n'); $('sInv').value = settings.invList.join('\n');
    $('sTestOut').textContent = `Piped: ${r.piped.length} encontradas · Invidious: ${r.inv.length} con API pública`;
  };
  $('sTestAll').onclick = async () => {
    const out = $('sTestOut'); out.hidden = false; out.textContent = '';
    const log = s => { out.textContent += s + '\n'; };
    const srcs = yt.sources();
    log(`Probando ${srcs.length} fuentes con búsqueda "test"…`);
    await Promise.all(srcs.map(async s => {
      const t0 = performance.now();
      try {
        const items = await yt['_search_' + s.type](s.base, 'test');
        log(`✔ ${host(s.base).padEnd(30)} ${s.type.padEnd(7)} ${Math.round(performance.now() - t0)} ms · ${items.length} res.`);
      } catch (e) { log(`✘ ${host(s.base).padEnd(30)} ${s.type.padEnd(7)} ${e.message || e}`); }
    }));
    log('Listo. Las fuentes que fallan se saltan solas.');
  };
  $('sDecoder').onclick = async () => {
    try { await loadFFmpeg((m) => { $('sDecoderState').textContent = m; }); $('sDecoderState').textContent = 'Cargado y guardado sin conexión'; }
    catch (e) { $('sDecoderState').textContent = 'Error: ' + (e.message || e); }
  };
  $('sPersist').onclick = async () => { const ok = await requestPersist(); toast(ok ? 'Biblioteca protegida' : 'El navegador no concedió la protección (instala la app para mejorar esto)'); openSettings(); };
  $('sWipe').onclick = async () => {
    if (!(await confirmSheet('BORRAR TODO', 'Se borrarán todas las pistas importadas, listas y descargas guardadas en RetroAmp. Los archivos de tu teléfono no se tocan. No se puede deshacer.'))) return;
    audio.pause(); audio.removeAttribute('src');
    for (const t of [...tracks.values()]) { await Tracks.del(t.id); await Blobs.del(t.id); await Blobs.del('conv:' + t.id); }
    for (const p of playlists) await Playlists.del(p.id);
    tracks.clear(); playlists = []; player.list = []; player.cur = null; player.plId = LIB;
    refreshLists(); updateDisplay(); $('settings').hidden = true; toast('Biblioteca borrada');
  };
  let sleepT = null, sleepEnd = 0, sleepTick = null;
  $('sSleep').onchange = e => {
    clearTimeout(sleepT); clearInterval(sleepTick); $('sleepLeft').textContent = '';
    const min = +e.target.value;
    if (!min) return;
    sleepEnd = Date.now() + min * 60000;
    sleepTick = setInterval(() => { $('sleepLeft').textContent = Math.ceil((sleepEnd - Date.now()) / 60000) + ' min restantes'; }, 15000);
    $('sleepLeft').textContent = min + ' min restantes';
    sleepT = setTimeout(async () => {
      const v0 = engine.s.volume;
      for (let i = 20; i >= 0; i--) { engine.update({ volume: v0 * i / 20 }); await new Promise(r => setTimeout(r, 500)); }
      audio.pause(); engine.update({ volume: v0 }); syncDspUI();
      clearInterval(sleepTick); $('sSleep').value = '0'; $('sleepLeft').textContent = '';
      toast('Temporizador: reproducción detenida');
    }, min * 60000);
    toast(`Se detendrá en ${min} minutos`);
  };
}

/* ================= Sesión ================= */
let sessT = 0;
function saveSessionSoon() {
  const now = Date.now();
  if (now - sessT < 5000) return;
  sessT = now; saveSession();
}
function saveSession() {
  if (!player.cur || player.cur.kind === 'yt') return;
  kvSet('session', { plId: player.plId, list: player.list, trackId: player.cur.id, time: audio.currentTime || 0, shuffle: player.shuffle, repeat: player.repeat });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); else if (!audio.paused) startViz(); });
window.addEventListener('pagehide', saveSession);

/* ================= Eventos de UI ================= */
function wireUI() {
  $('btnPlay').onclick = () => {
    engine.init(); engine.resume();
    if (player.cur && audio.src) { if (audio.paused) doPlay(); else audio.currentTime = 0; }
    else if (viewIds.length) playFromView(selectedId || viewIds[0]);
    else toast('Agrega audios o busca en YouTube');
  };
  $('btnPause').onclick = () => { if (audio.paused && player.cur) doPlay(); else audio.pause(); };
  $('btnStop').onclick = stop;
  $('btnPrev').onclick = () => { engine.init(); go(-1); };
  $('btnNext').onclick = () => { engine.init(); go(1); };
  $('btnEject').onclick = () => $('fileInput').click();
  $('plAdd').onclick = () => $('fileInput').click();
  $('plScan').onclick = scanDevice;
  $('plSort').onclick = sortMenu;
  $('plMenu').onclick = plMenu;
  $('fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('btnShuffle').onclick = () => {
    player.shuffle = !player.shuffle;
    const curIdx = player.cur ? player.list.indexOf(player.cur.id) : -1;
    buildOrder(curIdx); updateDisplay();
  };
  $('btnRepeat').onclick = () => { player.repeat = (player.repeat + 1) % 3; updateDisplay(); };
  $('dispTime').onclick = () => { settings.remain = !settings.remain; saveSettings(); updateTime(); };
  viz.onclick = () => { settings.vizMode = (settings.vizMode + 1) % 3; saveSettings(); peaks.fill(0); startViz(); };

  const seek = $('seek');
  seek.addEventListener('input', () => {
    seeking = true;
    const d = audio.duration;
    if (isFinite(d)) $('dispTime').textContent = fmt(seek.value / 1000 * d).padStart(5, '0');
  });
  seek.addEventListener('change', () => {
    const d = audio.duration;
    if (isFinite(d)) audio.currentTime = seek.value / 1000 * d;
    seeking = false;
  });

  document.querySelectorAll('[data-win]').forEach(b => b.onclick = () => {
    const id = b.dataset.win;
    settings.showWins[id] = !settings.showWins[id];
    applyWindows(); saveSettings();
    if (id === 'winEq' && settings.showWins[id]) drawCurve();
  });
  document.querySelectorAll('.shade').forEach(b => b.onclick = () => {
    const win = b.closest('.win');
    settings.shaded = settings.shaded || {};
    settings.shaded[win.id] = !settings.shaded[win.id];
    applyWindows(); saveSettings();
    if (win.id === 'winEq') drawCurve();
  });

  $('plSelect').onchange = e => { player.plId = e.target.value; selectedId = null; renderList(); };
  $('plFilter').addEventListener('input', renderList);

  const ul = $('playlist');
  let lastTapId = null, lastTapT = 0;
  ul.addEventListener('click', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('[data-menu]')) { trackMenu(id); return; }
    // Un toque reproduce (en móvil); en escritorio también funciona doble clic
    const now = Date.now();
    if (matchMedia('(pointer: coarse)').matches || (lastTapId === id && now - lastTapT < 400)) { playFromView(id); lastTapId = null; return; }
    lastTapId = id; lastTapT = now; selectedId = id; renderList();
  });
  let lpT;
  ul.addEventListener('contextmenu', e => { const li = e.target.closest('li[data-id]'); if (li) { e.preventDefault(); trackMenu(li.dataset.id); } });
  ul.addEventListener('touchstart', e => { const li = e.target.closest('li[data-id]'); if (li) lpT = setTimeout(() => { buzz(20); trackMenu(li.dataset.id); }, 550); }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev => ul.addEventListener(ev, () => clearTimeout(lpT), { passive: true }));

  $('ytForm').onsubmit = e => { e.preventDefault(); $('ytQuery').blur(); ytSearch($('ytQuery').value.trim()); };
  $('ytResults').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const x = ytItems[+b.closest('li').dataset.i];
    if (!x) return;
    if (b.dataset.act === 'play') ytPlay(x);
    else if (b.dataset.act === 'list') ytAddToList(x);
    else if (b.dataset.act === 'save') downloadYouTube(x);
  });

  // Vibración háptica
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('button, .tog, .tbtn, .vs-track, input[type=range], select, li[data-id]')) buzz(8);
  }, { passive: true });
  document.addEventListener('input', e => { if (e.target.matches('input[type=search], input[type=url], input:not([type]), textarea, .lcd-input')) buzz(4); });

  // Atajos de teclado (Z X C V B L, espacio, flechas)
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    const map = { z: () => $('btnPrev').click(), x: () => $('btnPlay').click(), c: () => $('btnPause').click(), v: stop, b: () => $('btnNext').click(), l: () => $('fileInput').click(),
      ' ': () => $('btnPause').click(), arrowright: () => { audio.currentTime += 5; }, arrowleft: () => { audio.currentTime -= 5; },
      arrowup: () => { engine.update({ volume: clamp(engine.s.volume + 0.05, 0, 1) }); afterDsp(); }, arrowdown: () => { engine.update({ volume: clamp(engine.s.volume - 0.05, 0, 1) }); afterDsp(); } };
    if (map[k]) { e.preventDefault(); map[k](); }
  });

  // Arrastrar y soltar archivos (escritorio)
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

  window.addEventListener('resize', () => drawCurve());
}

/* ================= Inicio ================= */
async function init() {
  document.documentElement.classList.toggle('is-native', NATIVE);
  $('verLbl').textContent = 'v' + VERSION + (NATIVE ? ' · APK' : '');
  $('verLbl2').textContent = 'v' + VERSION;
  const saved = await kvGet('settings', null);
  if (saved) settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved, showWins: { ...DEFAULT_SETTINGS.showWins, ...(saved.showWins || {}) } };
  const dsp = await kvGet('dsp', null);
  if (dsp) engine.s = { ...structuredClone(DEFAULT_DSP), ...dsp, eq: (dsp.eq || DEFAULT_DSP.eq).slice(0, 10) };
  applyTheme(); applyWindows();
  buildEq(); wireDsp(); wireSettings(); wireUI();
  syncDspUI();
  await loadLibrary();
  refreshLists();
  updateDisplay();

  if (settings.resume) {
    const s = await kvGet('session', null);
    if (s && s.trackId && tracks.has(s.trackId)) {
      player.plId = playlists.some(p => p.id === s.plId) ? s.plId : LIB;
      renderPlSelect(); renderList();
      player.list = (s.list || []).filter(id => tracks.has(id));
      if (!player.list.length) player.list = [...viewIds];
      player.shuffle = !!s.shuffle; player.repeat = s.repeat || 0;
      buildOrder(player.list.indexOf(s.trackId));
      playTrack(s.trackId, { autoplay: false, startAt: s.time || 0 });
    }
  }

  // Compartir desde YouTube hacia la app (PWA instalada)
  const qs = new URLSearchParams(location.search);
  const shared = qs.get('url') || qs.get('text') || qs.get('title');
  if (shared) {
    const id = parseYouTubeId(shared);
    if (id) {
      settings.showWins.winYt = true; applyWindows();
      $('ytQuery').value = shared;
      ytSearch(shared).then(() => toast('Enlace recibido: toca ▶ REPRODUCIR o ⬇ GUARDAR', 4000));
    }
    history.replaceState(null, '', location.pathname);
  }

  if (!NATIVE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
window.__retroamp = { engine, player, tracks, yt, settings: () => settings };
