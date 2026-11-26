// RetroAmp · Decodificador universal (ffmpeg.wasm bajo demanda)
// El núcleo (~31 MB) se descarga solo la primera vez y queda guardado en Cache Storage.
const CORE_VERSION = '0.12.10';
const CDNS = [
  ...(self.RETROAMP_FFMPEG_BASE ? [self.RETROAMP_FFMPEG_BASE] : []),
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
];
const CACHE = 'retroamp-ffmpeg-v1';

export const NATIVE_EXT = ['mp3', 'm4a', 'aac', 'mp4', 'ogg', 'oga', 'opus', 'flac', 'wav', 'webm', 'weba', 'm4b'];
export const RARE_EXT = ['wma', 'ape', 'aif', 'aiff', 'aifc', 'alac', 'wv', 'tta', 'mpc', 'ac3', 'eac3', 'dts', 'amr', 'mka', 'mp2', 'mpga', 'au', 'snd', 'caf', 'ra', 'rm', 'spx', 'tak', 'dsf', 'dff', 'mid', '3gp', '3ga', 'awb', 'voc', 'w64', 'xm', 'mod', 's3m', 'it'];

let ffmpeg = null;
let loading = null;

export function isLoaded() { return !!ffmpeg; }

export async function isCached() {
  try {
    if (!('caches' in window)) return false;
    const c = await caches.open(CACHE);
    return !!(await c.match(CDNS[0] + '/ffmpeg-core.wasm') || await c.match(CDNS[1] + '/ffmpeg-core.wasm'));
  } catch { return false; }
}

async function fetchCached(file, mime, onProgress) {
  let lastErr;
  for (const base of CDNS) {
    const url = `${base}/${file}`;
    try {
      let cache = null;
      if ('caches' in window) {
        cache = await caches.open(CACHE);
        const hit = await cache.match(url);
        if (hit) return URL.createObjectURL(new Blob([await hit.arrayBuffer()], { type: mime }));
      }
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = +res.headers.get('content-length') || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        if (onProgress && total) onProgress(got / total);
      }
      const blob = new Blob(chunks, { type: mime });
      if (cache) { try { await cache.put(url, new Response(blob, { headers: { 'Content-Type': mime } })); } catch {} }
      return URL.createObjectURL(blob);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No se pudo descargar el decodificador');
}

export async function loadFFmpeg(onStatus = () => {}) {
  if (ffmpeg) return ffmpeg;
  if (loading) return loading;
  loading = (async () => {
    onStatus('Cargando decodificador…', 0);
    const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
    const f = new FFmpeg();
    const coreURL = await fetchCached('ffmpeg-core.js', 'text/javascript');
    const wasmURL = await fetchCached('ffmpeg-core.wasm', 'application/wasm', p => onStatus(`Descargando decodificador ${Math.round(p * 100)} %`, p));
    await f.load({ coreURL, wasmURL });
    ffmpeg = f;
    onStatus('Decodificador listo', 1);
    return f;
  })();
  try { return await loading; } catch (e) { loading = null; throw e; }
}

// Convierte cualquier formato soportado por ffmpeg a FLAC estéreo (sin pérdida)
export async function transcode(blob, name, onStatus = () => {}) {
  const f = await loadFFmpeg(onStatus);
  const ext = ((name || '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const inName = `in_${Date.now()}.${ext}`;
  const outName = `out_${Date.now()}.flac`;
  const onProg = ({ progress }) => onStatus(`Convirtiendo ${Math.max(0, Math.min(100, Math.round(progress * 100)))} %`, progress);
  f.on('progress', onProg);
  try {
    await f.writeFile(inName, new Uint8Array(await blob.arrayBuffer()));
    const code = await f.exec(['-hide_banner', '-i', inName, '-vn', '-map', '0:a:0', '-ac', '2', '-c:a', 'flac', '-compression_level', '0', outName]);
    if (code !== 0) throw new Error('ffmpeg no pudo decodificar este archivo');
    const data = await f.readFile(outName);
    return new Blob([data.buffer], { type: 'audio/flac' });
  } finally {
    f.off('progress', onProg);
    try { await f.deleteFile(inName); } catch {}
    try { await f.deleteFile(outName); } catch {}
  }
}
