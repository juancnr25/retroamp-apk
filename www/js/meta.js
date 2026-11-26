// RetroAmp · Lectura de etiquetas (ID3v2 en MP3, Vorbis comment en FLAC/OGG) y duración
const dec = (enc, bytes) => {
  try {
    if (enc === 0) return new TextDecoder('latin1').decode(bytes);
    if (enc === 1) return new TextDecoder('utf-16').decode(bytes);
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
};
const clean = s => (s || '').replace(/\u0000+$/g, '').replace(/\u0000/g, ' / ').trim();
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

function findTerm(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
  } else {
    for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
  }
  return b.length;
}

function parseID3(b) {
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
  const ver = b[3];
  const flags = b[5];
  const size = syncsafe(b, 6);
  let p = 10;
  if (flags & 0x40) { p += ver === 4 ? syncsafe(b, 10) : be32(b, 10) + 4; }
  const end = Math.min(b.length, 10 + size);
  const out = {};
  const map = ver === 2
    ? { TT2: 'title', TP1: 'artist', TAL: 'album' }
    : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
  while (p < end) {
    let id, fsize, hdr;
    if (ver === 2) {
      id = String.fromCharCode(b[p], b[p + 1], b[p + 2]);
      fsize = (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5];
      hdr = 6;
    } else {
      id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
      fsize = ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
      hdr = 10;
    }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || fsize <= 0) break;
    const data = b.subarray(p + hdr, Math.min(end, p + hdr + fsize));
    if (map[id]) {
      out[map[id]] = clean(dec(data[0], data.subarray(1)));
    } else if ((id === 'APIC' || id === 'PIC') && !out.cover) {
      try {
        const enc = data[0];
        let q = 1, mime;
        if (id === 'PIC') { mime = 'image/' + String.fromCharCode(data[1], data[2], data[3]).toLowerCase(); q = 4; }
        else { const z = findTerm(data, 1, 0); mime = dec(0, data.subarray(1, z)) || 'image/jpeg'; q = z + 1; }
        q += 1; // tipo de imagen
        const t = findTerm(data, q, enc);
        q = t + (enc === 1 || enc === 2 ? 2 : 1);
        if (mime === 'image/jpg') mime = 'image/jpeg';
        out.cover = new Blob([data.slice(q)], { type: mime.includes('/') ? mime : 'image/jpeg' });
      } catch {}
    }
    p += hdr + fsize;
  }
  return out;
}

function parseVorbisComments(b, o, out) {
  const le32 = i => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
  const vlen = le32(o); o += 4 + vlen;
  const n = le32(o); o += 4;
  for (let i = 0; i < n && o < b.length; i++) {
    const len = le32(o); o += 4;
    const s = new TextDecoder().decode(b.subarray(o, o + len)); o += len;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1);
    if (k === 'TITLE') out.title = v;
    else if (k === 'ARTIST') out.artist = v;
    else if (k === 'ALBUM') out.album = v;
  }
}

function parseFLAC(b) {
  if (!(b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43)) return null;
  const out = {};
  let p = 4;
  while (p + 4 <= b.length) {
    const last = b[p] & 0x80, type = b[p] & 0x7f;
    const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    const body = p + 4;
    if (body + len > b.length) break;
    if (type === 0) {
      const sr = (b[body + 10] << 12) | (b[body + 11] << 4) | (b[body + 12] >> 4);
      out.sampleRate = sr;
    } else if (type === 4) parseVorbisComments(b, body, out);
    else if (type === 6 && !out.cover) {
      try {
        let q = body + 4;
        const ml = be32(b, q); q += 4;
        const mime = new TextDecoder().decode(b.subarray(q, q + ml)); q += ml;
        const dl = be32(b, q); q += 4 + dl + 16;
        const il = be32(b, q); q += 4;
        out.cover = new Blob([b.slice(q, q + il)], { type: mime || 'image/jpeg' });
      } catch {}
    }
    p = body + len;
    if (last) break;
  }
  return out;
}

export function fromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(?:\d{1,3}[\s.\-]+)?(.+?)\s+-\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base.replace(/^\d{1,3}[\s.\-]+/, ''), artist: '' };
}

export async function readTags(blob, name = '') {
  let tags = {};
  try {
    const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const size = syncsafe(head, 6) + 10;
      const buf = new Uint8Array(await blob.slice(0, Math.min(size, 16 * 1024 * 1024)).arrayBuffer());
      tags = parseID3(buf) || {};
    } else if (head[0] === 0x66 && head[1] === 0x4C && head[2] === 0x61 && head[3] === 0x43) {
      const buf = new Uint8Array(await blob.slice(0, Math.min(blob.size, 8 * 1024 * 1024)).arrayBuffer());
      tags = parseFLAC(buf) || {};
    } else if (head[0] === 0x4F && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) {
      const buf = new Uint8Array(await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer());
      const sig = [3, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]; // \x03vorbis
      const opus = [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]; // OpusTags
      for (let i = 0; i < buf.length - 8; i++) {
        if (sig.every((v, j) => buf[i + j] === v)) { parseVorbisComments(buf, i + 7, tags); break; }
        if (opus.every((v, j) => buf[i + j] === v)) { parseVorbisComments(buf, i + 8, tags); break; }
      }
    }
  } catch {}
  const fn = fromFilename(name);
  return {
    title: tags.title || fn.title || name,
    artist: tags.artist || fn.artist || '',
    album: tags.album || '',
    cover: tags.cover || null,
    sampleRate: tags.sampleRate || 0,
  };
}

export function probeDuration(url, timeout = 6000) {
  return new Promise(resolve => {
    const a = new Audio();
    let done = false;
    const fin = v => { if (done) return; done = true; a.removeAttribute('src'); try { a.load(); } catch {} resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => fin(0);
    setTimeout(() => fin(0), timeout);
    a.src = url;
  });
}
