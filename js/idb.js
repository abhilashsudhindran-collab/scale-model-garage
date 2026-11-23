// Local database on the phone (IndexedDB). Holds the local copy of the collection,
// unsynced changes and photo files until they are safely in Drive (brief §13.1, D5).
// Separate database name from the R0 test kit (same website origin).

const DB_NAME = 'smg-app';
const DB_VERSION = 1;

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'key' });
        s.createIndex('entity', 'entity');
        s.createIndex('dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function run(storeNames, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; }, err => { try { t.abort(); } catch {} reject(err); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Local database transaction aborted'));
  });
}

// A stored record: { key: 'models:mdl_…', entity, id, data: {...columns}, dirty: 0|1, sync: {...} }
export const records = {
  get: (entity, id) => run(['records'], 'readonly', t => reqP(t.objectStore('records').get(`${entity}:${id}`))),
  put: (rec) => run(['records'], 'readwrite', t => reqP(t.objectStore('records').put(rec))),
  putMany: (recs) => run(['records'], 'readwrite', t => { const s = t.objectStore('records'); recs.forEach(r => s.put(r)); }),
  byEntity: (entity) => run(['records'], 'readonly', t => reqP(t.objectStore('records').index('entity').getAll(entity))),
  dirty: () => run(['records'], 'readonly', t => reqP(t.objectStore('records').index('dirty').getAll(1))),
  count: () => run(['records'], 'readonly', t => reqP(t.objectStore('records').count())),
  clearAll: () => run(['records', 'blobs', 'meta'], 'readwrite', t => { ['records', 'blobs', 'meta'].forEach(n => t.objectStore(n).clear()); }),
};

// Photo files: key 'pho_…:original' | ':display' | ':thumb'
export const blobs = {
  put: (key, blob) => run(['blobs'], 'readwrite', t => reqP(t.objectStore('blobs').put({ key, blob }))),
  get: async (key) => (await run(['blobs'], 'readonly', t => reqP(t.objectStore('blobs').get(key))))?.blob || null,
  remove: (key) => run(['blobs'], 'readwrite', t => reqP(t.objectStore('blobs').delete(key))),
  keys: () => run(['blobs'], 'readonly', t => reqP(t.objectStore('blobs').getAllKeys())),
};

export const meta = {
  get: async (k, dflt = null) => { const r = await run(['meta'], 'readonly', t => reqP(t.objectStore('meta').get(k))); return r ? r.v : dflt; },
  set: (k, v) => run(['meta'], 'readwrite', t => reqP(t.objectStore('meta').put({ k, v }))),
};

export async function requestPersistentStorage() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
export async function storageEstimate() {
  try { return navigator.storage?.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}
