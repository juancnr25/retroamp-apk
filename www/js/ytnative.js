// RetroAmp · YouTube nativo (solo APK).
// Habla directo con la API interna de YouTube desde el teléfono (sin CORS, vía CapacitorHttp)
// y reproduce el audio a través del proxy nativo /_ytproxy (soporta Range y User-Agent del cliente).
// La lista de clientes se puede actualizar sin recompilar con un JSON alojado en tu GitHub.

export const BUILTIN_CONFIG = {
  version: '2026-11-26',
  web: {
    name: 'WEB', num: 1, version: '2.20260708.00.00',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  },
  searchParams: 'EgIQAfABAQ==',
  clients: [
    {
      id: 'visionos', name: 'VISIONOS', num: 101, version: '1.02',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      extra: { deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471' },
    },
    {
      id: 'ios_producer', name: 'IOS_PRODUCER', num: 92, version: '0.147.945',
      ua: 'com.google.ios.youtubeproducer/0.147.945 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
      extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
    },
    {
      id: 'ios', name: 'IOS', num: 5, version: '21.26.4',
      ua: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
      extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
    },
    {
      id: 'android_vr', name: 'ANDROID_VR', num: 28, version: '1.62.27',
      ua: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' },
    },
  ],
};

const API = 'https://www.youtube.com/youtubei/v1';
const Cap = () => window.Capacitor;

export function nativeAvailable() {
  const c = Cap();
  return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() && typeof c.nativePromise === 'function');
}

async function http(opts) {
  const res = await Cap().nativePromise('CapacitorHttp', 'request', {
    method: 'GET', connectTimeout: 15000, readTimeout: 20000, responseType: 'text', ...opts,
  });
  let data = res.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
  return { status: res.status, data };
}

const textOf = o => !o ? '' : typeof o === 'string' ? o : o.simpleText || o.content || (o.runs || []).map(r => r.text).join('') || '';
function parseDur(s) {
  if (!s) return 0;
  const p = String(s).trim().split(':').map(Number);
  if (p.some(isNaN)) return 0;
  return p.reduce((a, v) => a * 60 + v, 0);
}
function walk(o, fn, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 40) return;
  if (Array.isArray(o)) { for (const x of o) walk(x, fn, depth + 1); return; }
  for (const k of Object.keys(o)) { fn(k, o[k]); walk(o[k], fn, depth + 1); }
}

export function parseSearch(json) {
  const out = [];
  const seen = new Set();
  walk(json, (k, v) => {
    if (k === 'videoRenderer' && v && v.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push({
        id: v.videoId,
        title: textOf(v.title),
        author: textOf(v.ownerText) || textOf(v.longBylineText) || textOf(v.shortBylineText),
        duration: parseDur(textOf(v.lengthText)),
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      });
    } else if (k === 'lockupViewModel' && v && v.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && v.contentId && !seen.has(v.contentId)) {
      seen.add(v.contentId);
      const md = v.metadata?.lockupMetadataViewModel || {};
      const rows = md.metadata?.contentMetadataViewModel?.metadataRows || [];
      let author = '';
      for (const r of rows) for (const p of (r.metadataParts || [])) {
        if (!author && p.text?.commandRuns) author = p.text.content || '';
      }
      if (!author) author = rows[0]?.metadataParts?.[0]?.text?.content || '';
      let dur = '';
      walk(v.contentImage, (kk, vv) => { if (!dur && kk === 'thumbnailBadgeViewModel' && vv?.text && /\d:\d/.test(vv.text)) dur = vv.text; });
      out.push({ id: v.contentId, title: textOf(md.title), author, duration: parseDur(dur), thumb: `https://i.ytimg.com/vi/${v.contentId}/mqdefault.jpg` });
    }
  });
  return out;
}

export class NativeYouTube {
  constructor(getConfig, setVisitor, getVisitor) {
    this.cfg = getConfig;           // devuelve el JSON de clientes vigente
    this.setVisitor = setVisitor;
    this.getVisitor = getVisitor;
    this.lastClient = null;
    this.lastErrors = [];
  }

  headersFor(c, visitor) {
    const h = {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': String(c.num),
      'X-YouTube-Client-Version': c.version,
      'Origin': 'https://www.youtube.com',
      'User-Agent': c.ua,
    };
    if (visitor) h['X-Goog-Visitor-Id'] = visitor;
    return h;
  }

  context(c, visitor) {
    const client = { clientName: c.name, clientVersion: c.version, hl: 'es', gl: 'PE', userAgent: c.ua, ...(c.extra || {}) };
    if (visitor) client.visitorData = visitor;
    return { client };
  }

  async search(q) {
    const conf = this.cfg();
    const web = conf.web;
    const visitor = this.getVisitor();
    const { status, data } = await http({
      url: `${API}/search?prettyPrint=false`, method: 'POST',
      headers: this.headersFor(web, visitor),
      data: { context: this.context(web, visitor), query: q, params: conf.searchParams || BUILTIN_CONFIG.searchParams },
    });
    if (status !== 200 || !data || typeof data !== 'object') throw new Error('búsqueda HTTP ' + status);
    const vd = data.responseContext?.visitorData;
    if (vd) this.setVisitor(vd);
    return parseSearch(data);
  }

  async ensureVisitor() {
    if (this.getVisitor()) return this.getVisitor();
    try { await this.search('música'); } catch {}
    return this.getVisitor();
  }

  // Pide el stream a cada cliente hasta que uno devuelva audio sin cifrar
  async *candidates(id, preferOpus = true) {
    const conf = this.cfg();
    const visitor = await this.ensureVisitor();
    this.lastErrors = [];
    const order = [...conf.clients];
    if (this.lastClient) order.sort((a, b) => (b.id === this.lastClient) - (a.id === this.lastClient));
    for (const c of order) {
      let data;
      try {
        const r = await http({
          url: `${API}/player?prettyPrint=false`, method: 'POST',
          headers: this.headersFor(c, visitor),
          data: {
            context: this.context(c, visitor), videoId: id,
            playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
            contentCheckOk: true, racyCheckOk: true,
          },
        });
        data = r.data;
        if (r.status !== 200 || !data || typeof data !== 'object') throw new Error('HTTP ' + r.status);
      } catch (e) { this.lastErrors.push(`${c.id}: ${e.message || e}`); continue; }
      const ps = data.playabilityStatus || {};
      if (ps.status !== 'OK') { this.lastErrors.push(`${c.id}: ${ps.status || '?'} ${ps.reason || ''}`.trim()); continue; }
      const fmts = (data.streamingData?.adaptiveFormats || []).filter(f => (f.mimeType || '').startsWith('audio/') && f.url);
      if (!fmts.length) { this.lastErrors.push(`${c.id}: sin audio directo`); continue; }
      const a = document.createElement('audio');
      const playable = fmts.filter(f => a.canPlayType(f.mimeType));
      playable.sort((x, y) => {
        const ox = /opus/.test(x.mimeType) === preferOpus ? 1 : 0, oy = /opus/.test(y.mimeType) === preferOpus ? 1 : 0;
        return (oy - ox) || ((y.bitrate || 0) - (x.bitrate || 0));
      });
      const vd = data.videoDetails || {};
      for (const f of playable.slice(0, 2)) {
        const mime = f.mimeType.split(';')[0];
        const url = `/_ytproxy?u=${encodeURIComponent(f.url)}&ua=${encodeURIComponent(c.ua)}&mime=${encodeURIComponent(mime)}&clen=${f.contentLength || 0}`;
        yield {
          url, source: 'YouTube directo (' + c.id + ')', kind: 'native', client: c.id,
          kbps: Math.round((f.averageBitrate || f.bitrate || 0) / 1000),
          meta: { title: vd.title, author: vd.author, duration: +vd.lengthSeconds || 0 },
        };
      }
    }
  }

  markGood(c) { if (c.client) this.lastClient = c.client; }

  // Descarga la configuración de clientes desde tu repositorio (para adaptarte a cambios de YouTube sin recompilar)
  static async fetchRemoteConfig(url) {
    const { status, data } = await http({ url, method: 'GET' });
    if (status !== 200 || !data || !Array.isArray(data.clients) || !data.web) throw new Error('configuración inválida (HTTP ' + status + ')');
    return data;
  }
}
