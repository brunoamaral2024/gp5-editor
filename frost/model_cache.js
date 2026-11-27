// IndexedDB cache for converted NAM -> FCM records (fork addition).
const DB = 'frost-model-cache', STORE = 'models', VERSION = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VERSION);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function cacheGet(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      tx.onsuccess = () => res(tx.result ? new Uint8Array(tx.result) : null);
      tx.onerror = () => rej(tx.error);
    });
  } catch { return null; }
}
export async function cachePut(key, bytes) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    return true;
  } catch { return false; }
}
export async function cacheStats() {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const s = d.transaction(STORE, 'readonly').objectStore(STORE).count();
      s.onsuccess = () => res(s.result);
      s.onerror = () => rej(s.error);
    });
  } catch { return 0; }
}