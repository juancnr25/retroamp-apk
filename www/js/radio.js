// RetroAmp · Radios en vivo del Perú
// Fuente de la lista: directorio comunitario Radio Browser + lista propia de emisoras peruanas con
// identificadores estables de Mediastream (los enlaces del directorio a veces traen sesiones vencidas).
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

// Emisoras peruanas con su identificador de Mediastream (no vence) o enlace directo estable.
// match: textos que identifican la emisora en el directorio (sin tildes, minúsculas).
export const CURATED = [
  { title: 'Ritmo Romántica 93.1', md: '6839e2376607bdf6b2fcde27', tags: 'Lima · baladas, romántica', match: ['ritmo romantica'] },
  { title: 'Radio Moda 97.3', md: '6839e1c82cc4c480fcd318dd', tags: 'Lima · pop, urbano', match: ['radio moda', 'moda 97'] },
  { title: 'Radio Oxígeno', md: '5fab0687bcd6c2389ee9480c', tags: 'Lima · rock y pop clásico', match: ['oxigeno'] },
  { title: 'Radiomar', md: '6839e261d2efddf5bfbc2d3d', tags: 'Lima · salsa', match: ['radiomar', 'radio mar'] },
  { title: 'La Inolvidable 93.7', md: '6839e24cf4eacd81ada4e6b4', tags: 'Lima · baladas del recuerdo', match: ['la inolvidable 93', 'radio la inolvidable'] },
  { title: 'Nueva Q', md: '6839e1f153fcf56d988d5943', tags: 'Lima · cumbia', match: ['nueva q'] },
  { title: 'Radio Planeta', md: '6839e274f40e6b9832e37633', tags: 'Lima · pop en inglés', match: ['radio planeta', 'planeta 107'] },
  { title: 'Radio Corazón 94.3', md: '5fada514fc16c006bd63370f', tags: 'Lima · baladas', match: ['radio corazon', 'corazon 94'] },
  { title: 'Studio 92', md: '5fada553978fe1080e3ac5ea', tags: 'Lima · pop, urbano', match: ['studio 92'] },
  { title: 'Radio Felicidad 88.9', md: '5fad731fcf097a068af3c8f7', tags: 'Lima · baladas en inglés', match: ['felicidad'] },
  { title: 'Onda Cero', md: '5fada54116646e098d97e6a5', tags: 'Lima · urbano', match: ['onda cero'] },
  { title: 'RPP Noticias', md: '5fab3416b5f9ef165cfab6e9', tags: 'Lima · noticias', match: ['rpp noticias'] },
  { title: 'Radio Exitosa', url: 'https://neptuno-2-audio.mediaserver.digital/79525baf-b0f5-4013-a8bd-3c5c293c6561', tags: 'Lima · noticias', match: ['exitosa'] },
];

// Respaldo conocido de Ritmo Romántica en StreamTheWorld (audio AAC continuo)
const EXTRA = [
  { match: 'ritmo romantica', urls: ['https://playerservices.streamtheworld.com/api/livestream-redirect/CRP_RITAAC.aac', 'https://playerservices.streamtheworld.com/api/livestream-redirect/CRP_RIT_SC'] },
];

const MD_ID = /mdstrm\.com\/(?:audio|live-stream-playlist|live-audio-aw|live-audio|live-stream)\/([0-9a-f]{24})/i;
// Enlaces con sesión temporal: vencen y no se deben usar como fuente principal
const EXPIRING = /[?&](ote|listeningSessionID|listenerId|sid|uid|zt)=/i;

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Fuentes en orden de preferencia para una emisora:
// 1) audio continuo estable de Mediastream, 2) enlace del directorio, 3) respaldos, 4) HLS por segmentos.
export function radioSources(st) {
  const out = [];
  const add = (url, type) => { if (url && !out.some(o => o.url === url && o.type === type)) out.push({ url, type }); };
  const urls = [st.url, ...(st.alt || [])].filter(Boolean).map(u => u.trim());
  const ids = new Set(st.md ? [st.md] : []);
  for (const u of urls) { const m = u.match(MD_ID); if (m) ids.add(m[1].toLowerCase()); }
  for (const id of ids) add(`https://mdstrm.com/audio/${id}/icecast.audio`, 'stream');
  for (const u of urls) if (!/\.m3u8(\?|$)/i.test(u) && !EXPIRING.test(u)) add(u, 'stream');
  const n = norm(st.title);
  for (const e of EXTRA) if (n.includes(e.match)) e.urls.forEach(x => add(x, 'stream'));
  for (const id of ids) add(`https://mdstrm.com/audio/${id}/live.m3u8`, 'hls');
  for (const u of urls) if (/\.m3u8(\?|$)/i.test(u) && !EXPIRING.test(u)) add(u, 'hls');
  // Último intento con lo que diga el directorio, aunque parezca temporal
  for (const u of urls) if (EXPIRING.test(u)) add(u, /\.m3u8(\?|$)/i.test(u) ? 'hls' : 'stream');
  return out;
}

function nativeHttp() {
  const c = window.Capacitor;
  return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() && typeof c.nativePromise === 'function' ? c : null;
}

async function getJSON(url, ms = 10000) {
  const cap = nativeHttp();
  if (cap) {
    const r = await cap.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', headers: { 'User-Agent': 'RetroAmp/1.2' }, responseType: 'text', connectTimeout: ms, readTimeout: ms });
    let d = r.data;
    if (typeof d === 'string') d = JSON.parse(d);
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    return d;
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export function toStation(x) {
  return {
    id: 'radio:' + x.stationuuid,
    uuid: x.stationuuid,
    kind: 'radio',
    title: (x.name || 'Radio').trim(),
    artist: [x.state, (x.tags || '').split(',').filter(Boolean).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    url: x.url_resolved || x.url,
    alt: x.url && x.url !== x.url_resolved ? [x.url] : [],
    favicon: x.favicon || '',
    codec: (x.codec || '').toUpperCase(),
    bitrate: +x.bitrate || 0,
    hls: !!x.hls,
    votes: +x.votes || 0,
    clicks: +x.clickcount || 0,
    homepage: x.homepage || '',
  };
}

function curatedStation(c, i) {
  const slug = norm(c.title).replace(/[^a-z0-9]+/g, '-');
  return {
    id: 'radio:pe-' + slug, uuid: 'pe-' + slug, kind: 'radio', title: c.title, artist: c.tags,
    url: c.url || `https://mdstrm.com/audio/${c.md}/icecast.audio`, md: c.md || null, alt: [],
    favicon: '', codec: 'AAC', bitrate: 128, hls: false, votes: 0, clicks: 0, homepage: '', rank: 1e6 - i,
  };
}

// Une la lista propia con el directorio: el directorio aporta logos; la lista propia, enlaces estables
export function mergePeru(dir) {
  const out = [];
  const used = new Set();
  CURATED.forEach((c, i) => {
    const base = curatedStation(c, i);
    const hit = dir.find(s => !used.has(s.uuid) && c.match.some(m => norm(s.title).includes(m)));
    if (hit) {
      used.add(hit.uuid);
      out.push({ ...hit, title: c.title, artist: hit.artist || c.tags, md: c.md || null, url: base.url, alt: [hit.url, ...(hit.alt || [])], rank: base.rank });
    } else out.push(base);
  });
  const seen = new Set(out.map(s => norm(s.title)));
  for (const s of dir) {
    if (used.has(s.uuid)) continue;
    const k = norm(s.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...s, rank: s.clicks + s.votes * 2 });
  }
  return out.sort((a, b) => b.rank - a.rank);
}

export class Radios {
  constructor() { this.mirror = null; }

  async call(path) {
    const order = this.mirror ? [this.mirror, ...MIRRORS.filter(m => m !== this.mirror)] : MIRRORS;
    let last;
    for (const m of order) {
      try { const d = await getJSON(m + path); this.mirror = m; return d; } catch (e) { last = e; }
    }
    throw last || new Error('directorio de radios sin respuesta');
  }

  // Radios del Perú: las conocidas primero (con enlaces estables), luego el resto por popularidad.
  // Si el directorio no responde, igual devuelve la lista propia.
  async peru() {
    let dir = [];
    try {
      const d = await this.call('/json/stations/search?countrycode=PE&hidebroken=true&order=clickcount&reverse=true&limit=400');
      dir = (Array.isArray(d) ? d : []).map(toStation).filter(s => s.url);
    } catch { dir = []; }
    return mergePeru(dir);
  }

  async search(q) {
    const d = await this.call(`/json/stations/search?name=${encodeURIComponent(q)}&hidebroken=true&order=clickcount&reverse=true&limit=60`);
    return (Array.isArray(d) ? d : []).map(toStation).filter(s => s.url);
  }

  click(uuid) { if (uuid && !uuid.startsWith('pe-')) this.call('/json/url/' + uuid).catch(() => {}); }
}
