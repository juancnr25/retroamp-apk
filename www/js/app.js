// RetroAmp 1.1 · Aplicación principal
import { Tracks, Blobs, Playlists, kvGet, kvSet, storageInfo, requestPersist } from './db.js';
import { AudioEngine, EQ_FREQS, EQ_LABELS, PRESETS, DEFAULT_DSP } from './engine.js';
import { readTags, probeDuration } from './meta.js';
import { transcode, loadFFmpeg, isCached, isLoaded, RARE_EXT } from './decoder.js';
import { YouTube, DEFAULT_PIPED, DEFAULT_INVIDIOUS, parseYouTubeId } from './youtube.js';
import { NativeYouTube, BUILTIN_CONFIG, nativeAvailable } from './ytnative.js';
import { icon, hydrateIcons, Slider, openSheet, closeSheet, wireSheet, drawSevenSeg, vibrate } from './ui.js';

const VERSION = window.RETROAMP_VERSION || '1.1.0';
const $ = id => document.getElementById(id);
const Cap = window.Capacitor;
const NATIVE = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
const Native = NATIVE && typeof Cap.nativePromise === 'function' ? {
  scan: () => Cap.nativePromise('RetroNative', 'scan', {}),
  startService: o => Cap.nativePromise('RetroNative', 'startService', o || {}),
  stopService: () => Cap.nativePromise('RetroNative', 'stopService', {}),
} : null;

const DEFAULT_SETTINGS = {
  theme: 'dark', haptics: true, resume: true,
  ytServer: '', ytPriority: 'server', ytFormat: 'opus', usePublic: !NATIVE,
  pipedList: DEFAULT_PIPED, invList: DEFAULT_INVIDIOUS,
  clientsUrl: 'https://raw.githubusercontent.com/juancnr25/retroamp-apk/main/yt-clients.json',
  ytClients: null, ytClientsAt: 0, visitor: null, visitorAt: 0,
  vizMode: 0, customPresets: {}, libSort: 'added', remain: false, tab: 'lib',
};

let settings = structuredClone(DEFAULT_SETTINGS);
const audio = $('audio');
const engine = new AudioEngine(audio);
const yt = new YouTube(() => settings);
const ytn = nativeAvailable() ? new NativeYouTube(
  () => (settings.ytClients && Array.isArray(settings.ytClients.clients)) ? settings.ytClients : BUILTIN_CONFIG,
  v => { settings.visitor = v; settings.visitorAt = Date.now(); saveSettings(); },
  () => (settings.visitor && Date.now() - settings.visitorAt < 6 * 3600e3) ? settings.visitor : null,
) : null;

const tracks = new Map();
let playlists = [];
const player = { list: [], order: [], pos: -1, shuffle: false, repeat: 0, cur: null, objUrl: null, coverUrl: null, kbps: 0, token: 0, loading: false };
const view = { tab: 'lib', plId: null };
let viewIds = [];
let locked = false;

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
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

let toastT;
function toast(msg, ms = 2800) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms);
}
const buzz = (ms = 8) => vibrate(settings.haptics, ms);
const saveSettings = () => kvSet('settings', settings);
let dspSaveT;
const saveDsp = () => { clearTimeout(dspSaveT); dspSaveT = setTimeout(() => kvSet('dsp', engine.s), 300); };

/* ================= Menús y diálogos ================= */
function menu(title, items) {
  $('menuTitle').textContent = title;
  const body = $('menuBody');
  body.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    const b = document.createElement('button');
    b.className = 'mi' + (it.danger ? ' danger' : '') + (it.sel ? ' sel' : '');
    b.innerHTML = icon(it.icon || 'check') + `<span>${esc(it.label)}</span>`;
    b.onclick = () => { closeSheet($('sheetMenu')); setTimeout(() => it.action(), 30); };
    body.appendChild(b);
  }
  openSheet($('sheetMenu'));
}
function askText(title, placeholder = '', value = '', okLabel = 'Guardar') {
  return new Promise(resolve => {
    let done = false;
    $('menuTitle').textContent = title;
    const body = $('menuBody');
    body.innerHTML = '';
    const inp = document.createElement('input');
    inp.className = 'input'; inp.placeholder = placeholder; inp.value = value;
    const ok = document.createElement('button'); ok.className = 'btn accent'; ok.textContent = okLabel;
    const finish = v => { if (done) return; done = true; resolve(v); };
    ok.onclick = () => { const v = inp.value.trim() || null; finish(v); closeSheet($('sheetMenu')); };
    inp.onkeydown = e => { if (e.key === 'Enter') ok.click(); };
    body.append(inp, ok);
    openSheet($('sheetMenu'), () => finish(null));
    setTimeout(() => inp.focus(), 280);
  });
}
function confirmBox(title, msg, okLabel) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    $('menuTitle').textContent = title;
    const body = $('menuBody');
    body.innerHTML = `<p>${esc(msg)}</p>`;
    const ok = document.createElement('button'); ok.className = 'mi danger'; ok.innerHTML = icon('trash') + `<span>${esc(okLabel)}</span>`;
    const no = document.createElement('button'); no.className = 'mi'; no.innerHTML = icon('close') + '<span>Cancelar</span>';
    ok.onclick = () => { finish(true); closeSheet($('sheetMenu')); };
    no.onclick = () => { finish(false); closeSheet($('sheetMenu')); };
    body.append(ok, no);
    openSheet($('sheetMenu'), () => finish(false));
  });
}

/* ================= Tema ================= */
const THEMES = ['dark', 'light', 'neon'];
const THEME_NAME = { dark: 'Grafito', light: 'Blanco', neon: 'Verde neón' };
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  document.querySelector('meta[name=theme-color]').setAttribute('content', { dark: '#1a1d23', light: '#e9ebef', neon: '#050806' }[settings.theme]);
  document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('active', b.dataset.themeSet === settings.theme));
  vizColors = null; lastTimeText = '';
  updateTime(true); drawCurve(); drawViz(performance.now(), true);
}

/* ================= Sonido: ecualizador y efectos ================= */
const eqSliders = [];
let preampSlider;
function buildEq() {
  const box = $('eqSliders');
  box.innerHTML = '';
  const col = (label, get, set) => {
    const c = document.createElement('div'); c.className = 'eq-col';
    const v = document.createElement('div'); v.className = 'eq-val';
    const s = document.createElement('div');
    const l = document.createElement('div'); l.className = 'eq-lbl'; l.textContent = label;
    c.append(v, s, l); box.appendChild(c);
    const showV = x => { v.textContent = (x > 0 ? '+' : '') + (Math.round(x * 2) / 2); };
    const sl = new Slider(s, {
      orientation: 'v', min: -12, max: 12, step: 0.5, value: get(), def: 0, zero: 0, label: label + ' dB',
      format: x => (x > 0 ? '+' : '') + x + ' dB',
      onInput: x => { set(x); showV(x); afterDsp(false); }, onCommit: () => afterDsp(true),
    });
    sl.showV = showV; showV(get());
    return sl;
  };
  preampSlider = col('Pre', () => engine.s.preamp, x => engine.update({ preamp: x }));
  const sep = document.createElement('div'); sep.className = 'eq-sep'; box.appendChild(sep);
  EQ_FREQS.forEach((f, i) => eqSliders.push(col(EQ_LABELS[i].replace('K', 'k'), () => engine.s.eq[i], x => engine.setBand(i, x))));
}

const fx = {};
function buildFx() {
  const box = $('fxSliders');
  const row = (key, label, o) => {
    const r = document.createElement('div'); r.className = 'fx-row';
    const sp = document.createElement('span'); sp.textContent = label;
    const s = document.createElement('div');
    const out = document.createElement('output');
    r.append(sp, s, out); box.appendChild(r);
    fx[key] = new Slider(s, { ...o, label, onInput: v => { o.apply(v); out.textContent = o.format(v); afterDsp(false); }, onCommit: () => afterDsp(true) });
    fx[key].out = out; out.textContent = o.format(o.value);
  };
  const s = engine.s;
  const db = v => (v > 0 ? '+' : '') + v + ' dB';
  row('bass', 'Graves', { min: -12, max: 12, step: 0.5, value: s.bass, def: 0, zero: 0, format: db, apply: v => engine.update({ bass: v }) });
  row('treble', 'Agudos', { min: -12, max: 12, step: 0.5, value: s.treble, def: 0, zero: 0, format: db, apply: v => engine.update({ treble: v }) });
  row('width', 'Estéreo', { min: 0, max: 200, step: 5, value: Math.round(s.width * 100), def: 100, zero: 100, format: v => v + ' %', apply: v => engine.update({ width: v / 100 }) });
  row('revMix', 'Reverb', { min: 0, max: 100, step: 1, value: Math.round(s.reverbMix * 100), def: 0, format: v => v + ' %', apply: v => engine.update({ reverbMix: v / 100 }) });
  row('revSize', 'Sala', { min: 0.5, max: 6, step: 0.1, value: s.reverbSize, def: 2.2, format: v => (+v).toFixed(1) + ' s', apply: v => engine.update({ reverbSize: v }) });

  const vb = $('volSliders');
  const vrow = (key, label, o) => {
    const r = document.createElement('div'); r.className = 'fx-row';
    const sp = document.createElement('span'); sp.textContent = label;
    const sd = document.createElement('div'); const out = document.createElement('output');
    r.append(sp, sd, out); vb.appendChild(r);
    fx[key] = new Slider(sd, { ...o, label, onInput: v => { o.apply(v); out.textContent = o.format(v); afterDsp(false); }, onCommit: () => afterDsp(true) });
    fx[key].out = out; out.textContent = o.format(o.value);
  };
  vrow('volume', 'Volumen', { min: 0, max: 100, step: 1, value: Math.round(s.volume * 100), def: 80, format: v => v + ' %', apply: v => engine.update({ volume: v / 100 }) });
  vrow('balance', 'Balance', { min: -100, max: 100, step: 1, value: Math.round(s.balance * 100), def: 0, zero: 0, format: v => v === 0 ? 'Centro' : (v < 0 ? 'I ' + -v : 'D ' + v), apply: v => engine.update({ balance: v / 100 }) });
}

function renderPresets() {
  const box = $('presets');
  const all = { ...PRESETS, ...settings.customPresets };
  box.innerHTML = Object.keys(all).map(n => `<button class="pchip${engine.s.preset === n ? ' on' : ''}" data-preset="${esc(n)}">${esc(n)}</button>`).join('') +
    '<button class="pchip add" data-preset-add>Guardar actual</button>';
}

function syncDspUI() {
  const s = engine.s;
  $('eqOn').checked = s.eqOn; $('eqAuto').checked = s.autoHeadroom;
  $('fxLoud').checked = s.loudness; $('fxLim').checked = s.limiter; $('fxPure').checked = s.pure;
  eqSliders.forEach((sl, i) => { sl.set(s.eq[i]); sl.showV(s.eq[i]); });
  if (preampSlider) { preampSlider.set(s.preamp); preampSlider.showV(s.preamp); }
  const setFx = (k, v) => { if (fx[k]) { fx[k].set(v); fx[k].out.textContent = fx[k].o.format(fx[k].value); } };
  setFx('bass', s.bass); setFx('treble', s.treble); setFx('width', Math.round(s.width * 100));
  setFx('revMix', Math.round(s.reverbMix * 100)); setFx('revSize', s.reverbSize);
  setFx('volume', Math.round(s.volume * 100)); setFx('balance', Math.round(s.balance * 100));
  const active = !s.pure && ((s.eqOn && s.eq.some(v => v)) || s.bass || s.treble || s.loudness || s.width !== 1 || s.reverbMix > 0 || s.preamp);
  $('flagDsp').classList.toggle('on', !!active);
  $('flagStereo').textContent = s.width === 0 && !s.pure ? 'Mono' : 'Estéreo';
  $('soundSub').textContent = s.pure ? 'Modo puro' : !s.eqOn ? 'Ecualizador apagado' : (s.preset || 'Personalizado');
  $('volSub').textContent = Math.round(s.volume * 100) + ' %';
  $('volIcon').innerHTML = icon(s.volume === 0 ? 'mute' : 'volume');
  drawCurve();
}
function afterDsp(commit) {
  syncChipsOnly();
  drawCurve();
  if (commit) { syncDspUI(); renderPresets(); saveDsp(); }
}
function syncChipsOnly() {
  const s = engine.s;
  $('volSub').textContent = Math.round(s.volume * 100) + ' %';
  $('soundSub').textContent = s.pure ? 'Modo puro' : !s.eqOn ? 'Ecualizador apagado' : (s.preset || 'Personalizado');
}

// Curva calculada con filtros espejo (no requiere tocar el audio real)
let mirror = null;
const curveFreqs = new Float32Array(200).map((_, i) => 20 * Math.pow(1000, i / 199));
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
  if (!cv.clientWidth) return;
  const dpr = devicePixelRatio || 1;
  const w = cv.width = Math.round(cv.clientWidth * dpr), h = cv.height = Math.round(cv.clientHeight * dpr);
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const vfd = cssVar('--vfd');
  g.strokeStyle = cssVar('--vfd-dim'); g.lineWidth = 1 * dpr;
  for (const db of [-12, -6, 0, 6, 12]) { const y = h / 2 - db / 15 * (h / 2 - 6 * dpr); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  const m = getMirror(); if (!m) return;
  const s = engine.s;
  m.eq.forEach((b, i) => { b.gain.value = s.eqOn && !s.pure ? s.eq[i] : 0; });
  m.bass.gain.value = s.pure ? 0 : s.bass; m.treble.gain.value = s.pure ? 0 : s.treble;
  const n = curveFreqs.length, mag = new Float32Array(n), ph = new Float32Array(n), tot = new Float32Array(n).fill(1);
  for (const f of [...m.eq, m.bass, m.treble]) { f.getFrequencyResponse(curveFreqs, mag, ph); for (let i = 0; i < n; i++) tot[i] *= mag[i]; }
  const pre = s.pure ? 0 : s.preamp + engine.headroomDb();
  const pts = [];
  for (let i = 0; i < n; i++) {
    const db = 20 * Math.log10(tot[i]) + pre;
    pts.push([i / (n - 1) * w, h / 2 - clamp(db / 15, -1, 1) * (h / 2 - 6 * dpr)]);
  }
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, cssVar('--vfd-mid')); grad.addColorStop(1, 'transparent');
  g.beginPath(); g.moveTo(0, h / 2); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(w, h / 2); g.closePath();
  g.globalAlpha = .35; g.fillStyle = grad; g.fill(); g.globalAlpha = 1;
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  g.strokeStyle = vfd; g.lineWidth = 2 * dpr; g.shadowColor = cssVar('--vfd-glow'); g.shadowBlur = 6 * dpr; g.stroke(); g.shadowBlur = 0;
}

function wireSound() {
  $('btnSound').onclick = () => { openSheet($('sheetSound')); requestAnimationFrame(() => { drawCurve(); }); };
  $('btnVolume').onclick = () => openSheet($('sheetVolume'));
  document.querySelectorAll('[data-sound]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-sound]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $('soundEq').hidden = b.dataset.sound !== 'eq'; $('soundFx').hidden = b.dataset.sound !== 'fx';
    if (b.dataset.sound === 'eq') drawCurve();
  });
  $('eqOn').onchange = e => { engine.update({ eqOn: e.target.checked }); afterDsp(true); };
  $('eqAuto').onchange = e => { engine.update({ autoHeadroom: e.target.checked }); afterDsp(true); };
  $('fxLoud').onchange = e => { engine.update({ loudness: e.target.checked }); afterDsp(true); };
  $('fxLim').onchange = e => { engine.update({ limiter: e.target.checked }); afterDsp(true); };
  $('fxPure').onchange = e => { engine.update({ pure: e.target.checked }); afterDsp(true); };
  $('fxReset').onclick = () => {
    const keep = { volume: engine.s.volume, eq: engine.s.eq, preamp: engine.s.preamp, eqOn: engine.s.eqOn, preset: engine.s.preset, autoHeadroom: engine.s.autoHeadroom };
    engine.update({ ...structuredClone(DEFAULT_DSP), ...keep }); afterDsp(true); toast('Efectos restablecidos');
  };
  $('presets').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-preset-add')) {
      const name = await askText('Guardar ajuste del ecualizador', 'Nombre, por ejemplo Auto');
      if (!name) return;
      settings.customPresets[name] = [...engine.s.eq, engine.s.preamp];
      engine.s.preset = name; saveSettings(); afterDsp(true); toast('Ajuste guardado: ' + name);
      return;
    }
    const name = b.dataset.preset;
    const vals = PRESETS[name] || settings.customPresets[name];
    if (!vals) return;
    engine.update({ eq: [...vals.slice(0, 10)], preamp: vals[10] ?? 0, preset: name, eqOn: true });
    afterDsp(true);
  });
  // Mantener presionado un ajuste propio lo borra
  let lp;
  $('presets').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-preset]'); if (!b || !(b.dataset.preset in settings.customPresets)) return;
    lp = setTimeout(async () => {
      buzz(20);
      if (await confirmBox('Borrar ajuste', `Se borrará el ajuste "${b.dataset.preset}".`, 'Borrar')) { delete settings.customPresets[b.dataset.preset]; saveSettings(); renderPresets(); }
    }, 650);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('presets').addEventListener(ev, () => clearTimeout(lp)));
}

/* ================= Biblioteca y listas ================= */
async function loadLibrary() {
  const all = await Tracks.getAll();
  tracks.clear();
  all.forEach(t => tracks.set(t.id, t));
  playlists = (await Playlists.getAll()).sort((a, b) => a.created - b.created);
}
function libraryIds(sortKey = settings.libSort) {
  const arr = [...tracks.values()].filter(t => t.kind !== 'yt');
  const cmp = {
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', 'es'),
    artist: (a, b) => (a.artist || '').localeCompare(b.artist || '', 'es') || (a.title || '').localeCompare(b.title || '', 'es'),
    duration: (a, b) => (a.duration || 0) - (b.duration || 0),
  }[sortKey] || (() => 0);
  return arr.sort(cmp).map(t => t.id);
}
const curPlaylist = () => view.tab === 'lists' && view.plId ? playlists.find(p => p.id === view.plId) : null;
function currentIds() {
  const pl = curPlaylist();
  if (pl) return pl.trackIds.filter(id => tracks.has(id));
  return libraryIds();
}

function setTab(tab) {
  view.tab = tab; settings.tab = tab; saveSettings();
  const idx = ['lib', 'lists', 'yt'].indexOf(tab);
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('tabInk').style.transform = `translateX(${idx * 100}%)`;
  const showTracks = tab === 'lib' || (tab === 'lists' && view.plId);
  $('paneTracks').hidden = !showTracks;
  $('paneLists').hidden = !(tab === 'lists' && !view.plId);
  $('paneYt').hidden = tab !== 'yt';
  $('listHead').hidden = !(tab === 'lists' && view.plId);
  if (showTracks) renderTracks(); else if (tab === 'lists') renderLists();
}

function renderTracks() {
  const ul = $('tracks');
  const q = $('filter').value.trim().toLowerCase();
  const ids = currentIds();
  viewIds = ids;
  const pl = curPlaylist();
  if (pl) $('listTitle').textContent = pl.name;
  const curId = player.cur?.id;
  let total = 0;
  const rows = [];
  ids.forEach((id, i) => {
    const t = tracks.get(id); if (!t) return;
    total += t.duration || 0;
    const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
    if (q && !hay.includes(q)) return;
    const badge = t.kind === 'yt' ? '<span class="badge">YouTube</span>' : t.ytId ? '<span class="badge">Guardado</span>' : '';
    const isCur = id === curId;
    rows.push(`<li class="trk${isCur ? ' cur' : ''}" data-id="${esc(id)}">
      <span class="n">${isCur ? '<span class="eqmini"><i></i><i></i><i></i></span>' : i + 1}</span>
      <div class="meta"><div class="tt">${esc(t.title || t.name || id)}${badge}</div><div class="ar">${esc(t.artist || t.album || (t.kind === 'device' ? 'Teléfono' : 'Artista desconocido'))}</div></div>
      <span class="d">${t.duration ? fmt(t.duration) : ''}</span>
      <button class="m" data-menu aria-label="Opciones">${icon('more')}</button></li>`);
  });
  if (!rows.length) {
    rows.push(ids.length ? '<li class="empty">Nada coincide con la búsqueda.</li>' : pl
      ? '<li class="empty"><b>Lista vacía</b>Agrega pistas desde la biblioteca con el botón de opciones de cada canción, o desde YouTube.</li>'
      : `<li class="empty"><b>Tu biblioteca está vacía</b>${NATIVE ? 'Escanea la música del teléfono o elige archivos sueltos.' : 'Elige audios del dispositivo o busca en la pestaña YouTube.'}<br>
        ${NATIVE ? '<button class="btn accent" data-empty="scan">' + icon('scan') + 'Escanear música</button> ' : ''}<button class="btn" data-empty="add">${icon('plus')}Elegir archivos</button></li>`);
  }
  ul.innerHTML = rows.join('');
  ul.classList.toggle('paused', audio.paused);
  $('count').textContent = ids.length ? `${ids.length} ${ids.length === 1 ? 'pista' : 'pistas'} · ${fmt(total)}` : '';
}

function renderLists() {
  const ul = $('lists');
  if (!playlists.length) { ul.innerHTML = '<li class="empty" style="display:block"><b>Sin listas todavía</b>Crea una lista y agrega canciones desde la biblioteca o desde YouTube.</li>'; return; }
  ul.innerHTML = playlists.map(p => {
    const dur = p.trackIds.reduce((a, id) => a + (tracks.get(id)?.duration || 0), 0);
    return `<li data-pl="${esc(p.id)}"><span class="cover">${icon('playlist')}</span><div><div class="tt">${esc(p.name)}</div><div class="ar">${p.trackIds.length} pistas · ${fmt(dur)}</div></div><span></span><button class="m ibtn" data-plmenu aria-label="Opciones">${icon('more')}</button></li>`;
  }).join('');
}
function refreshLists() { if (view.tab === 'lists' && !view.plId) renderLists(); else if (view.tab !== 'yt') renderTracks(); }

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const added = [];
  let i = 0;
  for (const f of files) {
    i++;
    toast(`Importando ${i} de ${files.length}: ${f.name}`, 8000);
    try {
      const id = 'loc:' + uid();
      const ext = extOf(f.name);
      const tags = await readTags(f, f.name);
      let duration = 0;
      if (!RARE_EXT.includes(ext)) { const u = URL.createObjectURL(f); duration = await probeDuration(u); URL.revokeObjectURL(u); }
      const t = { id, kind: 'local', name: f.name, ext, title: tags.title, artist: tags.artist, album: tags.album, duration, size: f.size,
        mime: f.type || MIME[ext] || 'application/octet-stream', sampleRate: tags.sampleRate || 0, addedAt: Date.now() + i, hasCover: !!tags.cover };
      await Blobs.put({ id, blob: f, cover: tags.cover || null });
      await Tracks.put(t);
      tracks.set(id, t); added.push(id);
    } catch (e) { console.warn(e); toast('No se pudo importar ' + f.name); }
  }
  const pl = curPlaylist();
  if (pl) { pl.trackIds.push(...added); await Playlists.put(pl); }
  refreshLists();
  toast(`${added.length} ${added.length === 1 ? 'audio agregado' : 'audios agregados'}`);
  requestPersist();
}

async function scanDevice() {
  if (!Native) return;
  toast('Leyendo la música del teléfono…', 10000);
  try {
    const r = await Native.scan();
    const list = r.tracks || [];
    const seen = new Set(); const now = Date.now();
    const batch = list.map((x, i) => {
      const id = 'dev:' + x.id; seen.add(id);
      const prev = tracks.get(id);
      const t = { id, kind: 'device', uri: x.uri, name: x.name || '', ext: extOf(x.name), title: x.title || x.name,
        artist: x.artist && x.artist !== '<unknown>' ? x.artist : '', album: x.album || '', duration: (x.duration || 0) / 1000,
        size: x.size || 0, mime: x.mime || '', addedAt: prev?.addedAt || (x.dateAdded ? x.dateAdded * 1000 : now - i), hasCover: false, converted: prev?.converted };
      tracks.set(id, t); return t;
    });
    await Tracks.putMany(batch);
    for (const t of [...tracks.values()]) if (t.kind === 'device' && !seen.has(t.id)) { tracks.delete(t.id); await Tracks.del(t.id); }
    refreshLists();
    toast(`${batch.length} canciones encontradas en el teléfono`);
  } catch (e) { toast('No se pudo leer la música: ' + (e.message || e), 4500); }
}

function addToPlaylist(ids) {
  menu('Agregar a una lista', [
    ...playlists.map(p => ({ icon: 'playlist', label: `${p.name} (${p.trackIds.length})`, action: async () => { p.trackIds.push(...ids); await Playlists.put(p); refreshLists(); toast('Agregado a ' + p.name); } })),
    { icon: 'plus', label: 'Nueva lista…', action: async () => {
      const name = await askText('Nueva lista', 'Nombre de la lista', '', 'Crear');
      if (!name) return;
      const p = { id: 'pl:' + uid(), name, trackIds: [...ids], created: Date.now() };
      playlists.push(p); await Playlists.put(p); refreshLists(); toast(`Lista "${name}" creada`);
    } },
  ]);
}

function trackMenu(id) {
  const t = tracks.get(id); if (!t) return;
  const pl = curPlaylist();
  menu(t.title || 'Pista', [
    { icon: 'play', label: 'Reproducir', action: () => playFromView(id) },
    { icon: 'listadd', label: 'Agregar a una lista', action: () => addToPlaylist([id]) },
    t.kind === 'yt' ? { icon: 'download', label: 'Guardar para escuchar sin conexión', action: () => downloadYouTube({ id: t.ytId, title: t.title, author: t.artist, duration: t.duration, thumb: t.thumb }) } : null,
    pl ? { icon: 'close', label: 'Quitar de esta lista', action: async () => { const k = pl.trackIds.indexOf(id); if (k >= 0) pl.trackIds.splice(k, 1); await Playlists.put(pl); refreshLists(); } } : null,
    { icon: 'info', label: 'Información', action: () => showInfo(t) },
    t.kind !== 'yt' ? { icon: 'trash', label: 'Quitar de la biblioteca', danger: true, action: async () => {
      const ok = await confirmBox('Quitar de la biblioteca', t.kind === 'device'
        ? 'RetroAmp deja de mostrarla. El archivo sigue en tu teléfono.'
        : 'Se borra la copia guardada en RetroAmp. No se puede deshacer.', 'Quitar');
      if (!ok) return;
      await Tracks.del(id); await Blobs.del(id); await Blobs.del('conv:' + id);
      tracks.delete(id);
      for (const p of playlists) { const n = p.trackIds.length; p.trackIds = p.trackIds.filter(x => x !== id); if (p.trackIds.length !== n) await Playlists.put(p); }
      refreshLists();
    } } : null,
  ]);
}

function showInfo(t) {
  $('menuTitle').textContent = 'Información';
  const rows = [
    ['Título', t.title], ['Artista', t.artist], ['Álbum', t.album], ['Archivo', t.name],
    ['Origen', t.kind === 'yt' ? 'YouTube en línea' : t.kind === 'device' ? 'Teléfono' : t.ytId ? 'YouTube guardado' : 'Importado'],
    ['Formato', t.converted ? 'FLAC convertido desde ' + (t.ext || '?').toUpperCase() : (t.ext || t.mime || '').toUpperCase()],
    ['Duración', t.duration ? fmt(t.duration) : ''], ['Tamaño', t.size ? (t.size / 1048576).toFixed(2) + ' MB' : ''],
    ['Bitrate', t.size && t.duration ? Math.round(t.size * 8 / t.duration / 1000) + ' kbps' : ''],
  ].filter(r => r[1]);
  $('menuBody').innerHTML = `<pre class="log">${rows.map(r => `${r[0].padEnd(10)} ${esc(r[1])}`).join('\n')}</pre>`;
  openSheet($('sheetMenu'));
}

function listMenu(pl) {
  menu(pl.name, [
    { icon: 'play', label: 'Reproducir la lista', action: () => { view.plId = pl.id; setTab('lists'); if (viewIds.length) playFromView(viewIds[0]); } },
    { icon: 'edit', label: 'Cambiar nombre', action: async () => { const n = await askText('Cambiar nombre', 'Nombre', pl.name); if (!n) return; pl.name = n; await Playlists.put(pl); refreshLists(); } },
    { icon: 'sort', label: 'Invertir orden', action: async () => { pl.trackIds.reverse(); await Playlists.put(pl); refreshLists(); } },
    { icon: 'check', label: 'Quitar duplicados', action: async () => { pl.trackIds = [...new Set(pl.trackIds)]; await Playlists.put(pl); refreshLists(); } },
    { icon: 'trash', label: 'Eliminar la lista', danger: true, action: async () => {
      if (!(await confirmBox('Eliminar lista', `Se elimina "${pl.name}". Las canciones siguen en la biblioteca.`, 'Eliminar'))) return;
      await Playlists.del(pl.id); playlists = playlists.filter(p => p !== pl);
      if (view.plId === pl.id) view.plId = null;
      setTab('lists');
    } },
  ]);
}

function sortMenu() {
  const pl = curPlaylist();
  const opts = [['added', 'Agregadas recientemente'], ['title', 'Título'], ['artist', 'Artista'], ['duration', 'Duración']];
  menu('Ordenar por', opts.map(([k, label]) => ({
    icon: 'sort', label, sel: !pl && settings.libSort === k,
    action: async () => {
      if (pl) {
        const rank = new Map(libraryIds(k).map((id, i) => [id, i]));
        pl.trackIds.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
        await Playlists.put(pl);
      } else { settings.libSort = k; saveSettings(); }
      renderTracks();
    },
  })));
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
  buildOrder(player.list.indexOf(id));
  playTrack(id);
}

function loadSrc(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const ok = () => { done(); resolve(); };
    const bad = () => { const err = audio.error; done(); reject(new Error(err ? `código ${err.code}` : 'error')); };
    const to = setTimeout(() => { done(); reject(new Error('sin respuesta')); }, timeout);
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
  if (t.kind === 'local') { const r = await Blobs.get(t.id); if (!r) throw new Error('el archivo ya no está en la biblioteca'); return r.blob; }
  if (t.kind === 'device') {
    const conv = await Blobs.get('conv:' + t.id);
    if (conv) return conv.blob;
    const res = await fetch(Cap.convertFileSrc(t.uri));
    if (!res.ok) throw new Error('no se pudo leer el archivo del teléfono');
    const b = await res.blob();
    return b.type ? b : new Blob([b], { type: t.mime || MIME[t.ext] || '' });
  }
  throw new Error('origen no soportado');
}
async function convertAndStore(t, blob) {
  const out = await transcode(blob, t.name || ('audio.' + (t.ext || 'bin')), msg => setMarquee(msg));
  if (t.kind === 'local') {
    const prev = await Blobs.get(t.id);
    await Blobs.put({ id: t.id, blob: out, cover: prev?.cover || null });
    t.converted = true; t.size = out.size; t.mime = 'audio/flac';
  } else { await Blobs.put({ id: 'conv:' + t.id, blob: out }); t.converted = true; }
  await Tracks.put(t);
  return out;
}

async function playTrack(id, { autoplay = true, startAt = 0 } = {}) {
  const t = tracks.get(id); if (!t) return;
  const token = ++player.token;
  player.cur = t; player.kbps = 0; player.loading = true;
  // Detiene la canción anterior mientras carga la nueva: así su final no salta a otra pista
  if (!audio.paused) audio.pause();
  updateDisplay(); renderIfTracks(); scrollToCurrent();
  setMarquee('Cargando…');
  try {
    if (t.kind === 'yt') await playYouTubeStream(t, token);
    else {
      let blob = await blobFor(t);
      if (token !== player.token) return;
      if (RARE_EXT.includes(t.ext) && !t.converted) blob = await convertAndStore(t, blob);
      if (token !== player.token) return;
      try { await loadSrc(setObjUrl(blob)); }
      catch (e) {
        if (t.converted) throw e;
        toast('Formato no nativo: convirtiendo con el decodificador universal…', 4000);
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
    toast(e.message || String(e), 6000);
    setMarquee('No se pudo cargar: ' + (t.title || ''));
    updateDisplay();
  }
}

async function* ytCandidates(id) {
  const preferOpus = settings.ytFormat !== 'm4a';
  if (ytn) yield* ytn.candidates(id, preferOpus);
  yield* yt.candidates(id);
}

async function playYouTubeStream(t, token) {
  const tried = [];
  for await (const c of ytCandidates(t.ytId)) {
    if (token !== player.token) return;
    const label = c.kind === 'native' ? c.source : host(c.source);
    setMarquee('Conectando con ' + label + '…');
    try {
      try { await loadSrc(c.url, c.kind === 'server' ? 30000 : 20000); }
      catch (e) {
        if (c.kind !== 'native') throw e;
        // Plan B nativo: descarga completa por el proxy y reproduce desde memoria
        setMarquee('Descargando audio…');
        const r = await fetch(c.url);
        if (!r.ok) throw new Error('proxy HTTP ' + r.status);
        const b = await r.blob();
        if (b.size < 20000) throw new Error('respuesta vacía');
        if (token !== player.token) return;
        await loadSrc(setObjUrl(b), 15000);
      }
      if (c.kind === 'native') ytn.markGood(c); else yt.markGood(c);
      player.kbps = c.kbps || 0;
      if (c.meta) {
        if (c.meta.title && (!t.title || t.title.startsWith('Video '))) t.title = c.meta.title;
        if (c.meta.author && (!t.artist || t.artist === 'Enlace pegado')) t.artist = c.meta.author;
        if (c.meta.duration && !t.duration) t.duration = c.meta.duration;
        if (tracks.has(t.id)) Tracks.put(t);
      }
      $('ytStatus').textContent = 'Sonando desde ' + label + (c.kbps ? ` · ${c.kbps} kbps` : '');
      if (!t.duration && isFinite(audio.duration)) t.duration = audio.duration;
      return;
    } catch (e) { tried.push(`${label}: ${e.message || e}`); }
  }
  const nativeErr = ytn ? ytn.lastErrors : [];
  const detail = [...nativeErr, ...tried].slice(0, 4).join(' · ');
  $('ytStatus').textContent = detail ? 'Falló: ' + detail : 'No hay fuentes de YouTube configuradas';
  throw new Error(NATIVE
    ? 'YouTube no entregó el audio. Toca Ajustes, Probar YouTube directo, para ver el motivo.'
    : 'Para YouTube en la versión web necesitas tu servidor yt-dlp (Ajustes, YouTube).');
}

async function doPlay() {
  engine.init(); await engine.resume();
  try { await audio.play(); } catch { toast('Toca reproducir para empezar'); }
}
function nextIndex(dir) {
  const n = player.order.length;
  if (!n) return -1;
  let p = player.pos + dir;
  if (p >= n) { if (player.repeat === 1) { if (player.shuffle) buildOrder(-1); p = 0; } else return -1; }
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
function stop() { audio.pause(); try { audio.currentTime = 0; } catch {} updateDisplay(); }
function togglePlay() {
  engine.init(); engine.resume();
  if (player.cur && audio.src) { if (audio.paused) doPlay(); else audio.pause(); }
  else if (viewIds.length) playFromView(viewIds[0]);
  else toast('Agrega audios o busca en YouTube');
}

audio.addEventListener('ended', () => {
  if (player.loading) return;
  if (player.repeat === 2) { audio.currentTime = 0; doPlay(); return; }
  const p = nextIndex(1);
  if (p < 0) { updateDisplay(); nativeService(false); return; }
  player.pos = p;
  playTrack(player.list[player.order[p]]);
});
audio.addEventListener('play', () => { updateDisplay(); nativeService(true); startViz(); $('tracks').classList.remove('paused'); });
audio.addEventListener('pause', () => { updateDisplay(); if (!player.loading) nativeService(false); $('tracks').classList.add('paused'); });
audio.addEventListener('timeupdate', () => { updateTime(); saveSessionSoon(); });
audio.addEventListener('durationchange', () => updateTime(true));

let svcStopT = null;
function nativeService(on) {
  if (!Native) return;
  clearTimeout(svcStopT);
  if (!on) { svcStopT = setTimeout(() => { if (audio.paused && !player.loading) callService(false); }, 60000); return; }
  callService(true);
}
function callService(on) {
  try {
    const p = on ? Native.startService({ title: player.cur ? ((player.cur.artist ? player.cur.artist + ' · ' : '') + player.cur.title) : 'RetroAmp' }) : Native.stopService();
    p && p.catch && p.catch(() => {});
  } catch {}
}

/* ================= Display ================= */
let marqueeText = '';
function setMarquee(txt) {
  if (txt === marqueeText) return;
  marqueeText = txt;
  const box = document.querySelector('.vfd-title');
  const m = $('marquee');
  m.textContent = txt;
  box.classList.remove('scroll');
  requestAnimationFrame(() => {
    if (m.scrollWidth > box.clientWidth - 20) {
      m.textContent = txt + '     ·     ' + txt;
      box.style.setProperty('--marq', Math.max(10, txt.length * 0.32) + 's');
      box.classList.add('scroll');
    }
  });
}
function updateDisplay() {
  const t = player.cur;
  const playing = !audio.paused && !audio.ended;
  $('vfdState').innerHTML = player.loading ? '' : icon(playing ? 'play' : 'pause');
  $('vfdState').style.opacity = t ? 1 : 0;
  $('btnPlay').querySelector('.ic-play').innerHTML = icon(playing ? 'pause' : 'play');
  $('btnPlay').setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  if (t && !player.loading) setMarquee(`${t.artist ? t.artist + ' · ' : ''}${t.title || t.name}`);
  $('vfdKbps').textContent = player.kbps ? `${player.kbps} kbps` : '--- kbps';
  const khz = t?.sampleRate || engine.sampleRate || 0;
  $('vfdKhz').textContent = khz ? `${(khz / 1000).toFixed(khz % 1000 ? 1 : 0)} kHz` : '-- kHz';
  $('flagSrc').textContent = !t ? 'Local' : t.kind === 'yt' ? 'YouTube' : t.kind === 'device' ? 'Teléfono' : t.ytId ? 'YouTube' : 'Local';
  $('flagSrc').classList.toggle('on', !!t);
  $('flagStereo').classList.toggle('on', !!t);
  $('btnShuffle').setAttribute('aria-pressed', String(player.shuffle));
  $('btnRepeat').setAttribute('aria-pressed', String(player.repeat > 0));
  $('btnRepeat').querySelector('.ic-rep').innerHTML = icon(player.repeat === 2 ? 'repeat1' : 'repeat');
  $('btnRepeat').setAttribute('aria-label', ['Repetir: no', 'Repetir: todo', 'Repetir: una'][player.repeat]);
  updateTime(true);
}

let lastTimeText = '';
let seekSlider;
function updateTime(force = false) {
  const d = audio.duration, c = audio.currentTime;
  const dragging = seekSlider && seekSlider.el.classList.contains('dragging');
  const shown = dragging && isFinite(d) ? seekSlider.value / 1000 * d : c;
  const remain = settings.remain && isFinite(d);
  const v = Math.max(0, Math.floor(remain ? d - shown : shown));
  const mm = Math.min(99, Math.floor(v / 60)), ss = v % 60;
  const txt = (remain ? '-' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  if (force || txt !== lastTimeText) {
    lastTimeText = txt;
    drawSevenSeg($('vfdTime'), txt, { on: cssVar('--vfd'), off: cssVar('--vfd-dim'), glow: cssVar('--vfd-glow'), blur: parseFloat(cssVar('--glow')) || 0 });
  }
  $('tCur').textContent = fmt(shown);
  $('tDur').textContent = isFinite(d) ? fmt(d) : (player.cur?.duration ? fmt(player.cur.duration) : '0:00');
  if (seekSlider && !dragging) seekSlider.set(isFinite(d) && d > 0 ? c / d * 1000 : 0);
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(d) && d > 0) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: audio.playbackRate }); } catch {}
  }
}
// Marca la pista actual sin redibujar la lista (no se pierden toques durante el cambio de canción)
function renderIfTracks() {
  if ($('paneTracks').hidden) return;
  const ul = $('tracks');
  const curId = player.cur?.id;
  let found = false;
  ul.querySelectorAll('li.trk').forEach((li, i) => {
    const isCur = li.dataset.id === curId;
    if (isCur) found = true;
    if (li.classList.contains('cur') === isCur) return;
    li.classList.toggle('cur', isCur);
    const n = li.querySelector('.n');
    n.innerHTML = isCur ? '<span class="eqmini"><i></i><i></i><i></i></span>' : String(viewIds.indexOf(li.dataset.id) + 1);
  });
  if (!found && curId && viewIds.includes(curId)) renderTracks();
}
function scrollToCurrent() { const li = $('tracks').querySelector('li.cur'); if (li) li.scrollIntoView({ block: 'nearest' }); }

async function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = player.cur; if (!t) return;
  let art = [];
  if (player.coverUrl) { URL.revokeObjectURL(player.coverUrl); player.coverUrl = null; }
  try {
    if (t.thumb) art = [{ src: t.thumb, sizes: '320x180', type: 'image/jpeg' }];
    else if (t.hasCover) { const r = await Blobs.get(t.id); if (r?.cover) { player.coverUrl = URL.createObjectURL(r.cover); art = [{ src: player.coverUrl, sizes: '512x512', type: r.cover.type }]; } }
  } catch {}
  if (!art.length) art = [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || t.name || 'RetroAmp', artist: t.artist || '', album: t.album || 'RetroAmp', artwork: art });
}
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
  h('play', () => doPlay()); h('pause', () => audio.pause()); h('stop', () => stop());
  h('previoustrack', () => go(-1)); h('nexttrack', () => go(1));
  h('seekbackward', d => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
  h('seekforward', d => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
  h('seekto', d => { audio.currentTime = d.seekTime; });
}

/* ================= Visualizador ================= */
const viz = $('viz');
let vizColors = null, vizRunning = false, peaks = new Float32Array(32), levels = new Float32Array(32), lastMeter = 0, clipHold = 0, freqBuf = null, timeBuf = null;
function startViz() { if (!vizRunning) { vizRunning = true; requestAnimationFrame(drawViz); } }
function drawViz(ts, once = false) {
  const dpr = devicePixelRatio || 1;
  const W = Math.round(viz.clientWidth * dpr), H = Math.round(viz.clientHeight * dpr);
  if (!W) { vizRunning = false; return; }
  if (viz.width !== W || viz.height !== H) { viz.width = W; viz.height = H; vizColors = null; }
  const g = viz.getContext('2d');
  if (!vizColors) {
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, cssVar('--vfd')); grad.addColorStop(1, cssVar('--viz-hi'));
    vizColors = { grad, dim: cssVar('--vfd-dim'), vfd: cssVar('--vfd'), glow: cssVar('--vfd-glow'), blur: parseFloat(cssVar('--glow')) || 0 };
  }
  g.clearRect(0, 0, W, H);
  const a = engine.analyser;
  const active = a && !audio.paused && !document.hidden;
  const nb = 32, gap = Math.max(2, Math.round(W / nb * 0.28)), bw = (W - gap * (nb - 1)) / nb;
  if (settings.vizMode === 0) {
    if (a) { if (!freqBuf) freqBuf = new Uint8Array(a.frequencyBinCount); if (active) a.getByteFrequencyData(freqBuf); else freqBuf.fill(0); }
    const hz = engine.sampleRate && a ? engine.sampleRate / a.fftSize : 1;
    for (let i = 0; i < nb; i++) {
      let v = 0;
      if (a) {
        const f0 = 35 * Math.pow(16000 / 35, i / nb), f1 = 35 * Math.pow(16000 / 35, (i + 1) / nb);
        const b0 = Math.max(1, Math.floor(f0 / hz)), b1 = Math.max(b0 + 1, Math.ceil(f1 / hz));
        for (let b = b0; b < b1 && b < freqBuf.length; b++) v = Math.max(v, freqBuf[b]);
      }
      const target = (v / 255) * H;
      levels[i] = target > levels[i] ? target : levels[i] * 0.86;
      const x = i * (bw + gap), hh = Math.max(2 * dpr, levels[i]);
      g.fillStyle = vizColors.dim;
      g.fillRect(x, H - 2 * dpr, bw, 2 * dpr);
      g.fillStyle = vizColors.grad; g.shadowColor = vizColors.glow; g.shadowBlur = vizColors.blur * dpr * .6;
      const r = Math.min(bw / 2, 3 * dpr);
      g.beginPath(); g.roundRect ? g.roundRect(x, H - hh, bw, hh, [r, r, 0, 0]) : g.rect(x, H - hh, bw, hh); g.fill();
      g.shadowBlur = 0;
      peaks[i] = Math.max(peaks[i] - 0.9 * dpr, levels[i]);
      if (peaks[i] > 3 * dpr) { g.fillStyle = vizColors.vfd; g.globalAlpha = .9; g.fillRect(x, H - peaks[i] - 3 * dpr, bw, 1.6 * dpr); g.globalAlpha = 1; }
    }
  } else if (settings.vizMode === 1) {
    if (a) { if (!timeBuf) timeBuf = new Uint8Array(a.fftSize); if (active) a.getByteTimeDomainData(timeBuf); else timeBuf.fill(128); }
    g.strokeStyle = vizColors.vfd; g.lineWidth = 2 * dpr; g.shadowColor = vizColors.glow; g.shadowBlur = vizColors.blur * dpr;
    g.beginPath();
    for (let x = 0; x < W; x += 2) {
      const v = timeBuf ? timeBuf[Math.floor(x / W * timeBuf.length)] / 255 : .5;
      const y = H / 2 + (v - .5) * H * 1.6;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke(); g.shadowBlur = 0;
  }
  if (engine.ready && ts - lastMeter > 90) {
    lastMeter = ts;
    const m = engine.meters();
    if (m.clip) clipHold = ts + 700;
    $('flagClip').classList.toggle('on', ts < clipHold && !audio.paused);
    $('flagLim').classList.toggle('on', m.gr < -0.5 && !audio.paused);
  }
  if (once) return;
  const decaying = levels.some(v => v > 1) || peaks.some(p => p > 1);
  if (!audio.paused || decaying) requestAnimationFrame(drawViz);
  else { vizRunning = false; $('flagClip').classList.remove('on'); $('flagLim').classList.remove('on'); }
}

/* ================= YouTube ================= */
let ytItems = [];
async function ytSearch(q) {
  if (!q) return;
  $('ytStatus').textContent = 'Buscando…';
  $('ytResults').innerHTML = '';
  const id = parseYouTubeId(q);
  if (id) { ytItems = [{ id, title: 'Video ' + id, author: 'Enlace pegado', duration: 0, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` }]; $('ytStatus').textContent = 'Enlace listo para reproducir'; renderYt(); return; }
  const errors = [];
  if (ytn) {
    try {
      const items = await ytn.search(q);
      if (items.length) { ytItems = items; $('ytStatus').textContent = `${items.length} resultados de YouTube`; renderYt(); return; }
      errors.push('directo: sin resultados');
    } catch (e) { errors.push('directo: ' + (e.message || e)); }
  }
  try {
    const r = await yt.search(q);
    ytItems = r.items;
    $('ytStatus').textContent = `${r.items.length} resultados · ${host(r.source)}`;
    renderYt();
  } catch (e) {
    errors.push(...(e.details || []));
    $('ytStatus').textContent = NATIVE
      ? 'YouTube no respondió. Revisa tu conexión o toca Ajustes, Probar YouTube directo.'
      : 'Sin respuesta. En la versión web configura tu servidor yt-dlp en Ajustes.';
    console.warn(errors);
  }
}
function renderYt() {
  $('ytResults').innerHTML = ytItems.map((x, i) => `
    <li data-i="${i}">
      <img src="${esc(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div>
        <div class="tt">${esc(x.title)}</div>
        <div class="ar">${esc(x.author)}${x.duration ? ' · ' + fmt(x.duration) : ''}</div>
        <div class="acts">
          <button class="btn accent" data-act="play">${icon('play')}Escuchar</button>
          <button class="btn" data-act="list" aria-label="Agregar a una lista">${icon('listadd')}</button>
          <button class="btn" data-act="save" aria-label="Guardar sin conexión">${icon('download')}</button>
        </div>
      </div>
    </li>`).join('');
}
function ytTrack(x) {
  const id = 'yt:' + x.id;
  return tracks.get(id) || { id, kind: 'yt', ytId: x.id, title: x.title, artist: x.author, duration: x.duration || 0, thumb: x.thumb, addedAt: Date.now() };
}
function ytPlay(x) {
  engine.init(); engine.resume();
  const t = ytTrack(x);
  tracks.set(t.id, t);
  player.list = [t.id]; buildOrder(0);
  playTrack(t.id);
}
async function ytAddToList(x) { const t = ytTrack(x); tracks.set(t.id, t); await Tracks.put(t); addToPlaylist([t.id]); }
async function downloadYouTube(x) {
  toast('Descargando audio…', 60000);
  for await (const c of ytCandidates(x.id)) {
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
        if (now - lastT > 400) { lastT = now; toast(`Descargando ${total ? Math.round(got / total * 100) + ' %' : (got / 1048576).toFixed(1) + ' MB'}`, 60000); }
      }
      if (got < 30000) throw new Error('respuesta demasiado pequeña');
      const ctype = (res.headers.get('content-type') || '').split(';')[0];
      const type = ctype.startsWith('audio/') ? ctype : (ctype.includes('webm') ? 'audio/webm' : 'audio/mp4');
      const blob = new Blob(chunks, { type });
      const id = 'loc:' + uid();
      const ext = type.includes('webm') ? 'webm' : type.includes('mpeg') ? 'mp3' : 'm4a';
      const title = (c.meta?.title && x.title.startsWith('Video ')) ? c.meta.title : x.title;
      const t = { id, kind: 'local', ytId: x.id, name: `${title}.${ext}`, ext, title, artist: (x.author === 'Enlace pegado' ? c.meta?.author : x.author) || '', album: 'YouTube',
        duration: x.duration || c.meta?.duration || 0, size: blob.size, mime: type, addedAt: Date.now(), hasCover: false, thumb: x.thumb };
      let cover = null;
      try { const r = await fetch(x.thumb, { mode: 'cors' }); if (r.ok) { cover = await r.blob(); t.hasCover = true; delete t.thumb; } } catch {}
      await Blobs.put({ id, blob, cover });
      await Tracks.put(t); tracks.set(id, t);
      refreshLists();
      toast('Guardado en tu biblioteca: ' + title, 3500);
      requestPersist();
      return;
    } catch (e) { console.warn('descarga', c.source, e); }
  }
  toast('No se pudo descargar. Revisa Ajustes, YouTube.', 4500);
}

/* ================= Ajustes ================= */
async function openSettings() {
  $('sHaptics').checked = settings.haptics; $('sResume').checked = settings.resume;
  $('sServer').value = settings.ytServer; $('sFormat').value = settings.ytFormat;
  $('sPiped').value = settings.pipedList.join('\n'); $('sInv').value = settings.invList.join('\n');
  $('sUsePublic').checked = settings.usePublic; $('sClientsUrl').value = settings.clientsUrl;
  $('ytModeHint').textContent = NATIVE
    ? 'La app pide el audio directo a YouTube desde tu teléfono. Si YouTube cambia algo, toca Actualizar clientes o usa tu servidor yt-dlp como respaldo.'
    : 'En la versión web el navegador no puede hablar directo con YouTube. Usa tu servidor yt-dlp en Termux (http://127.0.0.1:8765) o instala la APK.';
  $('sDecoderState').textContent = isLoaded() ? 'Listo' : (await isCached()) ? 'Descargado' : '';
  const st = await storageInfo();
  $('sStorage').textContent = `Usas ${(st.usage / 1048576).toFixed(1)} MB de ${(st.quota / 1073741824).toFixed(1)} GB disponibles. ${st.persisted ? 'Protegida: el sistema no la borrará para liberar espacio.' : 'Sin protección: el sistema podría borrarla si se queda sin espacio.'}`;
  $('verLbl').textContent = 'v' + VERSION + (NATIVE ? ' (APK)' : '');
  applyTheme();
  openSheet($('sheetSettings'));
}
function log(msg, reset = false) { const l = $('sLog'); l.hidden = false; if (reset) l.textContent = ''; l.textContent += msg + '\n'; l.scrollTop = l.scrollHeight; }

function wireSettings() {
  $('btnSettings').onclick = openSettings;
  $('btnTheme').onclick = () => { settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length]; applyTheme(); saveSettings(); toast('Fondo ' + THEME_NAME[settings.theme]); };
  document.querySelectorAll('[data-theme-set]').forEach(b => b.onclick = () => { settings.theme = b.dataset.themeSet; applyTheme(); saveSettings(); });
  $('sHaptics').onchange = e => { settings.haptics = e.target.checked; saveSettings(); };
  $('sResume').onchange = e => { settings.resume = e.target.checked; saveSettings(); };
  $('sServer').onchange = e => { settings.ytServer = e.target.value.trim().replace(/\/+$/, ''); saveSettings(); };
  $('sFormat').onchange = e => { settings.ytFormat = e.target.value; saveSettings(); };
  $('sUsePublic').onchange = e => { settings.usePublic = e.target.checked; saveSettings(); };
  $('sClientsUrl').onchange = e => { settings.clientsUrl = e.target.value.trim(); saveSettings(); };
  const lines = v => v.split(/\s+/).map(s => s.trim().replace(/\/+$/, '')).filter(s => /^https?:\/\//.test(s));
  $('sPiped').onchange = e => { settings.pipedList = lines(e.target.value); saveSettings(); };
  $('sInv').onchange = e => { settings.invList = lines(e.target.value); saveSettings(); };

  $('sServerTest').onclick = async () => {
    settings.ytServer = $('sServer').value.trim().replace(/\/+$/, ''); saveSettings();
    if (!settings.ytServer) { $('sServerState').textContent = 'Escribe la dirección primero'; return; }
    $('sServerState').textContent = 'Probando…';
    try { const j = await yt.pingServer(settings.ytServer); $('sServerState').textContent = `Conectado. yt-dlp ${j.yt_dlp || '?'}, motor JS ${j.js_runtime || 'ninguno'}`; }
    catch (e) { $('sServerState').textContent = 'Sin respuesta: ' + (e.message || e); }
  };

  $('sTestNative').onclick = async () => {
    if (!ytn) return;
    log('Probando YouTube directo…', true);
    try {
      const t0 = performance.now();
      const items = await ytn.search('lofi');
      log(`Búsqueda: ${items.length} resultados en ${Math.round(performance.now() - t0)} ms`);
      if (!items.length) { log('YouTube no devolvió resultados.'); return; }
      const vid = items[0].id;
      log(`Probando audio de: ${items[0].title}`);
      let ok = false;
      for await (const c of ytn.candidates(vid, settings.ytFormat !== 'm4a')) {
        log(`Cliente ${c.client}: URL obtenida (${c.kbps} kbps). Probando descarga…`);
        try {
          const r = await fetch(c.url, { headers: { Range: 'bytes=0-65535' } });
          const n = (await r.arrayBuffer()).byteLength;
          log(`  HTTP ${r.status}, ${n} bytes recibidos`);
          if (r.ok && n > 1000) { ok = true; ytn.markGood(c); break; }
        } catch (e) { log('  Error: ' + (e.message || e)); }
      }
      ytn.lastErrors.forEach(e => log('  ' + e));
      log(ok ? 'Resultado: YouTube directo funciona.' : 'Resultado: ningún cliente entregó audio. Toca Actualizar clientes o configura tu servidor yt-dlp.');
    } catch (e) { log('Error: ' + (e.message || e)); }
  };
  $('sUpdateClients').onclick = async () => {
    log('Descargando configuración de clientes…', true);
    try {
      const cfg = await NativeYouTube.fetchRemoteConfig(settings.clientsUrl);
      settings.ytClients = cfg; settings.ytClientsAt = Date.now(); saveSettings();
      log(`Listo: versión ${cfg.version || '?'} con ${cfg.clients.length} clientes (${cfg.clients.map(c => c.id).join(', ')}).`);
    } catch (e) { log('No se pudo actualizar: ' + (e.message || e) + '. Revisa que el repositorio sea público y la dirección.'); }
  };
  $('sDiscover').onclick = async () => {
    log('Consultando listas oficiales de instancias…', true);
    const r = await yt.discover();
    if (r.piped.length) settings.pipedList = r.piped.slice(0, 12);
    if (r.inv.length) settings.invList = r.inv.slice(0, 12);
    saveSettings();
    $('sPiped').value = settings.pipedList.join('\n'); $('sInv').value = settings.invList.join('\n');
    log(`Piped: ${r.piped.length} · Invidious con API: ${r.inv.length}`);
  };
  $('sTestAll').onclick = async () => {
    log('Probando fuentes con la búsqueda "test"…', true);
    if (ytn) { try { const t0 = performance.now(); const it = await ytn.search('test'); log(`✓ YouTube directo  ${Math.round(performance.now() - t0)} ms, ${it.length} resultados`); } catch (e) { log('✗ YouTube directo  ' + (e.message || e)); } }
    await Promise.all(yt.sources().map(async s => {
      const t0 = performance.now();
      try { const items = await yt['_search_' + s.type](s.base, 'test'); log(`✓ ${host(s.base)}  ${Math.round(performance.now() - t0)} ms, ${items.length} resultados`); }
      catch (e) { log(`✗ ${host(s.base)}  ${e.message || e}`); }
    }));
    log('Las fuentes que fallan se saltan solas.');
  };
  $('sDecoder').onclick = async () => {
    try { await loadFFmpeg(m => { $('sDecoderState').textContent = m; }); $('sDecoderState').textContent = 'Listo, disponible sin conexión'; }
    catch (e) { $('sDecoderState').textContent = 'Error: ' + (e.message || e); }
  };
  $('sPersist').onclick = async () => { const ok = await requestPersist(); toast(ok ? 'Biblioteca protegida' : 'El sistema no concedió la protección. Instalar la app ayuda.'); closeSheet($('sheetSettings')); };
  $('sWipe').onclick = async () => {
    closeSheet($('sheetSettings'));
    if (!(await confirmBox('Borrar biblioteca', 'Se borran las pistas importadas, las listas y las descargas de RetroAmp. Los archivos de tu teléfono no se tocan. No se puede deshacer.', 'Borrar todo'))) return;
    audio.pause(); audio.removeAttribute('src');
    for (const t of [...tracks.values()]) { await Tracks.del(t.id); await Blobs.del(t.id); await Blobs.del('conv:' + t.id); }
    for (const p of playlists) await Playlists.del(p.id);
    tracks.clear(); playlists = []; player.list = []; player.cur = null; view.plId = null;
    setTab(view.tab); updateDisplay(); setMarquee('Biblioteca vacía'); toast('Biblioteca borrada');
  };
}

// Actualiza la configuración de clientes de YouTube en segundo plano una vez al día
async function autoUpdateClients() {
  if (!ytn || !settings.clientsUrl || Date.now() - (settings.ytClientsAt || 0) < 24 * 3600e3) return;
  try { const cfg = await NativeYouTube.fetchRemoteConfig(settings.clientsUrl); settings.ytClients = cfg; settings.ytClientsAt = Date.now(); saveSettings(); }
  catch { settings.ytClientsAt = Date.now() - 20 * 3600e3; }
}

/* ================= Temporizador ================= */
let sleepT = null, sleepEnd = 0, sleepTick = null;
function setSleep(min) {
  clearTimeout(sleepT); clearInterval(sleepTick);
  $('flagSleep').hidden = true; $('timerSub').textContent = 'No';
  if (!min) return;
  sleepEnd = Date.now() + min * 60000;
  const tick = () => { const m = Math.max(0, Math.ceil((sleepEnd - Date.now()) / 60000)); $('timerSub').textContent = `En ${m} min`; $('flagSleep').textContent = `Apagado ${m}′`; $('flagSleep').hidden = false; $('flagSleep').classList.add('on'); };
  tick(); sleepTick = setInterval(tick, 15000);
  sleepT = setTimeout(async () => {
    const v0 = engine.s.volume;
    for (let i = 20; i >= 0; i--) { engine.update({ volume: v0 * i / 20 }); await new Promise(r => setTimeout(r, 500)); }
    audio.pause(); engine.update({ volume: v0 });
    setSleep(0); toast('Temporizador: música detenida');
  }, min * 60000);
  toast(`La música se detendrá en ${min} minutos`);
}

/* ================= Sesión ================= */
let sessT = 0;
function saveSessionSoon() { const now = Date.now(); if (now - sessT < 5000) return; sessT = now; saveSession(); }
function saveSession() {
  if (!player.cur || player.cur.kind === 'yt') return;
  kvSet('session', { list: player.list, trackId: player.cur.id, time: audio.currentTime || 0, shuffle: player.shuffle, repeat: player.repeat });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); else if (!audio.paused) startViz(); });
window.addEventListener('pagehide', saveSession);

/* ================= Bloqueo ================= */
function setLocked(v) {
  locked = v;
  $('lockVeil').hidden = !v;
  $('btnLock').classList.toggle('on', v);
  $('btnLock').innerHTML = icon(v ? 'lock' : 'unlock');
  $('btnLock').setAttribute('aria-label', v ? 'Controles bloqueados' : 'Bloquear controles');
}

/* ================= Eventos ================= */
function wireUI() {
  $('btnPlay').onclick = togglePlay;
  $('btnPrev').onclick = () => { engine.init(); go(-1); };
  $('btnNext').onclick = () => { engine.init(); go(1); };
  $('btnShuffle').onclick = () => {
    player.shuffle = !player.shuffle;
    buildOrder(player.cur ? player.list.indexOf(player.cur.id) : -1);
    updateDisplay(); toast(player.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado', 1500);
  };
  $('btnRepeat').onclick = () => { player.repeat = (player.repeat + 1) % 3; updateDisplay(); toast(['Repetir desactivado', 'Repetir toda la lista', 'Repetir esta canción'][player.repeat], 1500); };
  $('vfdTime').onclick = () => { settings.remain = !settings.remain; saveSettings(); updateTime(true); };
  viz.onclick = () => { settings.vizMode = (settings.vizMode + 1) % 3; saveSettings(); peaks.fill(0); levels.fill(0); drawViz(performance.now(), true); startViz(); };
  $('btnTimer').onclick = () => menu('Apagar la música en', [0, 15, 30, 45, 60, 90].map(m => ({ icon: 'timer', label: m ? `${m} minutos` : 'Desactivar', action: () => setSleep(m) })));

  seekSlider = new Slider($('seek'), {
    mode: 'absolute', min: 0, max: 1000, step: 1, value: 0, def: 0, label: 'Posición',
    format: v => fmt(v / 1000 * (audio.duration || 0)),
    onInput: () => updateTime(), onCommit: v => { const d = audio.duration; if (isFinite(d)) audio.currentTime = v / 1000 * d; },
  });
  $('seek').classList.add('seekbar');

  // Bloqueo: un toque bloquea, desbloquear exige mantener presionado
  $('btnLock').onclick = () => { if (!locked) { setLocked(true); buzz(15); } };
  let holdT;
  const ub = $('btnUnlock');
  ub.addEventListener('pointerdown', e => { ub.setPointerCapture(e.pointerId); ub.classList.add('holding'); holdT = setTimeout(() => { buzz(25); setLocked(false); ub.classList.remove('holding'); }, 800); });
  ['pointerup', 'pointercancel'].forEach(ev => ub.addEventListener(ev, () => { clearTimeout(holdT); ub.classList.remove('holding'); }));

  document.querySelectorAll('.tab').forEach(b => b.onclick = () => { if (b.dataset.tab === 'lists' && view.tab === 'lists') view.plId = null; setTab(b.dataset.tab); });
  $('btnAdd').onclick = () => $('fileInput').click();
  $('btnScan').onclick = scanDevice;
  $('btnSort').onclick = sortMenu;
  $('fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('filter').addEventListener('input', renderTracks);
  $('btnListBack').onclick = () => { view.plId = null; setTab('lists'); };
  $('btnListMenu').onclick = () => { const pl = curPlaylist(); if (pl) listMenu(pl); };
  $('btnNewList').onclick = async () => {
    const name = await askText('Nueva lista', 'Nombre de la lista', '', 'Crear');
    if (!name) return;
    const p = { id: 'pl:' + uid(), name, trackIds: [], created: Date.now() };
    playlists.push(p); await Playlists.put(p); view.plId = p.id; setTab('lists');
  };
  $('lists').addEventListener('click', e => {
    const li = e.target.closest('li[data-pl]'); if (!li) return;
    const pl = playlists.find(p => p.id === li.dataset.pl); if (!pl) return;
    if (e.target.closest('[data-plmenu]')) { listMenu(pl); return; }
    view.plId = pl.id; $('filter').value = ''; setTab('lists');
  });

  const ul = $('tracks');
  ul.addEventListener('click', e => {
    const emp = e.target.closest('[data-empty]');
    if (emp) { emp.dataset.empty === 'scan' ? scanDevice() : $('fileInput').click(); return; }
    const li = e.target.closest('li[data-id]'); if (!li) return;
    if (e.target.closest('[data-menu]')) { trackMenu(li.dataset.id); return; }
    playFromView(li.dataset.id);
  });
  ul.addEventListener('contextmenu', e => { const li = e.target.closest('li[data-id]'); if (li) { e.preventDefault(); trackMenu(li.dataset.id); } });

  $('ytForm').onsubmit = e => { e.preventDefault(); $('ytQuery').blur(); ytSearch($('ytQuery').value.trim()); };
  $('ytResults').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const x = ytItems[+b.closest('li').dataset.i]; if (!x) return;
    if (b.dataset.act === 'play') ytPlay(x);
    else if (b.dataset.act === 'list') ytAddToList(x);
    else downloadYouTube(x);
  });

  document.addEventListener('pointerdown', e => { if (e.target.closest('button, .sl, .switch, li[data-id]')) buzz(8); }, { passive: true });
  document.addEventListener('input', e => { if (e.target.matches('input[type=search], input[type=url], input:not([type]), textarea')) buzz(4); });

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select') || locked) return;
    const k = e.key;
    const map = {
      ' ': togglePlay, ArrowRight: () => { audio.currentTime += 5; }, ArrowLeft: () => { audio.currentTime -= 5; },
      ArrowUp: () => { engine.update({ volume: clamp(engine.s.volume + 0.05, 0, 1) }); afterDsp(true); },
      ArrowDown: () => { engine.update({ volume: clamp(engine.s.volume - 0.05, 0, 1) }); afterDsp(true); },
      n: () => go(1), p: () => go(-1),
    };
    if (map[k]) { e.preventDefault(); map[k](); }
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { updateTime(true); drawCurve(); drawViz(performance.now(), true); }, 120); });

  ['sheetSound', 'sheetVolume', 'sheetMenu', 'sheetSettings'].forEach(id => wireSheet($(id)));
}

/* ================= Inicio ================= */
async function init() {
  document.documentElement.classList.toggle('is-native', NATIVE);
  hydrateIcons();
  const saved = await kvGet('settings', null);
  if (saved) settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  const dsp = await kvGet('dsp', null);
  if (dsp) engine.s = { ...structuredClone(DEFAULT_DSP), ...dsp, eq: (dsp.eq || DEFAULT_DSP.eq).slice(0, 10) };
  buildEq(); buildFx(); renderPresets();
  wireSound(); wireSettings(); wireUI();
  setLocked(false);
  await document.fonts?.ready?.catch?.(() => {});
  applyTheme(); syncDspUI();
  await loadLibrary();
  setTab(settings.tab || 'lib');
  updateDisplay();

  if (settings.resume) {
    const s = await kvGet('session', null);
    if (s && s.trackId && tracks.has(s.trackId)) {
      player.list = (s.list || []).filter(id => tracks.has(id));
      if (!player.list.length) player.list = [...viewIds];
      player.shuffle = !!s.shuffle; player.repeat = s.repeat || 0;
      buildOrder(player.list.indexOf(s.trackId));
      playTrack(s.trackId, { autoplay: false, startAt: s.time || 0 });
    }
  }

  const qs = new URLSearchParams(location.search);
  const shared = qs.get('url') || qs.get('text') || qs.get('title');
  if (shared && parseYouTubeId(shared)) { setTab('yt'); $('ytQuery').value = shared; ytSearch(shared); }
  if (shared) history.replaceState(null, '', location.pathname);

  if (!NATIVE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  autoUpdateClients();
}

init();
window.__retroamp = { engine, player, tracks, yt, ytn, settings: () => settings, setLocked };
