// RetroAmp · Radios en vivo (directorio comunitario Radio Browser, enfocado en Perú)
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

// Radios peruanas destacadas: se muestran primero cuando aparecen en el directorio
export const FEATURED = [
  'ritmo romantica', 'la zona', 'moda', 'oxigeno', 'rpp', 'exitosa', 'radio felicidad', 'nueva q', 'onda cero',
  'la karibena', 'radiomar', 'la inolvidable', 'corazon', 'planeta', 'studio 92', 'panamericana', 'la mega', 'radio mar plus',
  'z rock', 'capital', 'nacional', 'la exitosa', 'radio uno', 'karibeña',
];

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

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
    favicon: x.favicon || '',
    codec: (x.codec || '').toUpperCase(),
    bitrate: +x.bitrate || 0,
    hls: !!x.hls,
    votes: +x.votes || 0,
    clicks: +x.clickcount || 0,
    homepage: x.homepage || '',
  };
}

function rank(st) {
  const n = norm(st.title);
  const i = FEATURED.findIndex(f => n.includes(f));
  return (i >= 0 ? 100000 - i * 1000 : 0) + st.clicks + st.votes * 2;
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

  // Radios del Perú ordenadas: destacadas primero, luego por popularidad
  async peru() {
    const d = await this.call('/json/stations/search?countrycode=PE&hidebroken=true&order=clickcount&reverse=true&limit=400');
    const seen = new Set();
    const list = (Array.isArray(d) ? d : []).map(toStation).filter(s => {
      if (!s.url || s.hls) return false;
      const k = norm(s.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return list.sort((a, b) => rank(b) - rank(a));
  }

  async search(q) {
    const d = await this.call(`/json/stations/search?name=${encodeURIComponent(q)}&hidebroken=true&order=clickcount&reverse=true&limit=60`);
    return (Array.isArray(d) ? d : []).map(toStation).filter(s => s.url && !s.hls);
  }

  // Avisa al directorio que la radio se escuchó (ayuda a mantener la lista ordenada)
  click(uuid) { this.call('/json/url/' + uuid).catch(() => {}); }
}
