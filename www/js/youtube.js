// RetroAmp · Fuentes de YouTube (híbrido: servidor propio yt-dlp + Piped + Invidious)
export const DEFAULT_PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi.drgns.space',
];
export const DEFAULT_INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.f5.si',
  'https://invidious.privacyredirect.com',
  'https://yewtu.be',
];

const trim = u => (u || '').trim().replace(/\/+$/, '');

export function parseYouTubeId(text) {
  if (!text) return null;
  const s = text.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/|\/v\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const thumbOf = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

async function getJSON(url, ms = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function canPlay(mime) {
  const a = document.createElement('audio');
  return !!a.canPlayType(mime);
}
const OPUS_OK = () => canPlay('audio/webm; codecs="opus"');

export class YouTube {
  constructor(getSettings) {
    this.cfg = getSettings;
    this.lastGood = { piped: null, inv: null };
    this.lastSource = '';
  }

  // Orden de fuentes según preferencia
  sources() {
    const c = this.cfg();
    const srv = trim(c.ytServer);
    const piped = (c.pipedList || DEFAULT_PIPED).map(trim).filter(Boolean);
    const inv = (c.invList || DEFAULT_INVIDIOUS).map(trim).filter(Boolean);
    const sticky = (list, good) => good && list.includes(good) ? [good, ...list.filter(x => x !== good)] : list;
    const usePublic = c.usePublic !== false;
    const pub = !usePublic ? [] : [
      ...sticky(piped, this.lastGood.piped).map(u => ({ type: 'piped', base: u })),
      ...sticky(inv, this.lastGood.inv).map(u => ({ type: 'inv', base: u })),
    ];
    const own = srv ? [{ type: 'server', base: srv }] : [];
    return c.ytPriority === 'public' ? [...pub, ...own] : [...own, ...pub];
  }

  async search(q) {
    const id = parseYouTubeId(q);
    if (id) return { items: [{ id, title: 'Video ' + id, author: 'Enlace pegado', duration: 0, thumb: thumbOf(id) }], source: 'enlace' };
    const errors = [];
    for (const s of this.sources()) {
      try {
        const items = await this['_search_' + s.type](s.base, q);
        if (items && items.length) {
          if (s.type !== 'server') this.lastGood[s.type] = s.base;
          this.lastSource = s.base;
          return { items, source: s.base };
        }
      } catch (e) { errors.push(`${s.base}: ${e.message}`); }
    }
    const err = new Error('Ninguna fuente respondió');
    err.details = errors;
    throw err;
  }

  async _search_server(base, q) {
    const j = await getJSON(`${base}/search?q=${encodeURIComponent(q)}&n=20`, 25000);
    return (j.items || []).map(x => ({ id: x.id, title: x.title, author: x.author || '', duration: x.duration || 0, thumb: x.thumb || thumbOf(x.id) }));
  }

  async _search_piped(base, q) {
    const j = await getJSON(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`);
    return (j.items || []).filter(x => x.type === 'stream' && x.url).map(x => {
      const id = (x.url.match(/v=([A-Za-z0-9_-]{11})/) || [])[1];
      return { id, title: x.title, author: x.uploaderName || '', duration: x.duration > 0 ? x.duration : 0, thumb: thumbOf(id) };
    }).filter(x => x.id);
  }

  async _search_inv(base, q) {
    const j = await getJSON(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`);
    return (Array.isArray(j) ? j : []).filter(x => x.type === 'video' && x.videoId).map(x => ({
      id: x.videoId, title: x.title, author: x.author || '', duration: x.lengthSeconds || 0, thumb: thumbOf(x.videoId),
    }));
  }

  // Generador de candidatos de stream de audio, en orden de preferencia
  async *candidates(id) {
    const preferOpus = this.cfg().ytFormat !== 'm4a' && OPUS_OK();
    for (const s of this.sources()) {
      try {
        if (s.type === 'server') {
          yield { url: `${s.base}/stream/${id}?fmt=${preferOpus ? 'opus' : 'm4a'}`, source: s.base, kind: 'server', kbps: 0 };
        } else if (s.type === 'piped') {
          const j = await getJSON(`${s.base}/streams/${id}`);
          const streams = (j.audioStreams || []).filter(a => a.url && canPlay((a.mimeType || 'audio/mp4') + (a.codec ? `; codecs="${a.codec}"` : '')));
          streams.sort((a, b) => score(b, preferOpus) - score(a, preferOpus));
          for (const a of streams.slice(0, 2)) {
            yield { url: a.url, source: s.base, kind: 'piped', kbps: Math.round((a.bitrate || 0) / 1000), meta: { title: j.title, author: j.uploader, duration: j.duration } };
          }
        } else if (s.type === 'inv') {
          const j = await getJSON(`${s.base}/api/v1/videos/${id}?fields=adaptiveFormats,title,author,lengthSeconds`);
          const fmts = (j.adaptiveFormats || []).filter(f => (f.type || '').startsWith('audio/') && canPlay(f.type));
          fmts.sort((a, b) => scoreInv(b, preferOpus) - scoreInv(a, preferOpus));
          for (const f of fmts.slice(0, 2)) {
            yield { url: `${s.base}/latest_version?id=${id}&itag=${f.itag}&local=true`, source: s.base, kind: 'inv', kbps: Math.round((+f.bitrate || 0) / 1000), meta: { title: j.title, author: j.author, duration: j.lengthSeconds } };
          }
        }
      } catch { /* siguiente fuente */ }
    }
  }

  markGood(c) { if (c.kind === 'piped') this.lastGood.piped = c.source; if (c.kind === 'inv') this.lastGood.inv = c.source; this.lastSource = c.source; }

  async pingServer(base) {
    const j = await getJSON(`${trim(base)}/ping`, 5000);
    return j;
  }

  // Descubre instancias públicas activas (listas oficiales de Piped e Invidious)
  async discover() {
    const out = { piped: [], inv: [] };
    try {
      const p = await getJSON('https://piped-instances.kavin.rocks/', 10000);
      out.piped = (p || []).map(x => trim(x.api_url)).filter(Boolean);
    } catch {}
    try {
      const v = await getJSON('https://api.invidious.io/instances.json?sort_by=health', 10000);
      out.inv = (v || []).filter(([, d]) => d && d.api && d.type === 'https').map(([, d]) => trim(d.uri)).filter(Boolean);
    } catch {}
    return out;
  }
}

function score(a, preferOpus) {
  const isOpus = /opus/i.test(a.codec || a.mimeType || a.format || '');
  return (a.bitrate || 0) / 1000 + (isOpus === preferOpus ? 1000 : 0);
}
function scoreInv(f, preferOpus) {
  const isOpus = /opus/i.test(f.type || '');
  return (+f.bitrate || 0) / 1000 + (isOpus === preferOpus ? 1000 : 0);
}
