// RetroAmp · Repositorio IndexedDB (tracks, blobs, playlists, kv)
const DB_NAME = 'retroamp';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(r => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

class Repo {
  constructor(store) { this.store = store; }
  get(id) { return tx(this.store, 'readonly', s => reqP(s.get(id))); }
  getAll() { return tx(this.store, 'readonly', s => reqP(s.getAll())); }
  put(obj) { return tx(this.store, 'readwrite', s => reqP(s.put(obj))); }
  putMany(arr) { return tx(this.store, 'readwrite', s => { arr.forEach(o => s.put(o)); }); }
  del(id) { return tx(this.store, 'readwrite', s => reqP(s.delete(id))); }
}

export const Tracks = new Repo('tracks');
export const Blobs = new Repo('blobs');
export const Playlists = new Repo('playlists');
const KV = new Repo('kv');

export async function kvGet(k, def) {
  try { const r = await KV.get(k); return r ? r.v : def; } catch { return def; }
}
export function kvSet(k, v) { return KV.put({ k, v }); }

export async function storageInfo() {
  const out = { usage: 0, quota: 0, persisted: false };
  try {
    if (navigator.storage?.estimate) Object.assign(out, await navigator.storage.estimate());
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch {}
  return out;
}
export async function requestPersist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
