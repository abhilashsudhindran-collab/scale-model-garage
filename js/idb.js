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
//
// Read cache (perf at 1,000+ boxes): every screen lists whole tables, so the last list of each
// table is kept in memory and handed out as a fresh copy (callers may change what they get).
// Any write drops that table's cached list - here and, via BroadcastChannel, in other open tabs.
// A list read that overlaps a write is not cached (generation check), so the cache never holds stale rows.
const cache = new Map();   // entity -> array of records
const gen = new Map();     // entity -> write counter
let allGen = 0;            // bumped by clearAll
const chan = (() => { try { return new BroadcastChannel('smg-records'); } catch { return null; } })();
function dropLocal(entities) {
  if (entities === '*') { cache.clear(); allGen++; return; }
  for (const e of entities) { cache.delete(e); gen.set(e, (gen.get(e) || 0) + 1); }
}
if (chan) chan.onmessage = (ev) => dropLocal(ev.data);
function drop(entities) {
  dropLocal(entities);
  try { chan?.postMessage(entities === '*' ? '*' : [...entities]); } catch {}
}
// Copy for callers (s1-0.50.0 speed check: ~3x faster than structuredClone on 1,500-car tables). Records are plain
// objects/arrays of text and numbers; anything else (a Date, Blob…) falls back to structuredClone, so nothing is shared.
const deepClone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
function clone(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) { const a = new Array(x.length); for (let i = 0; i < x.length; i++) a[i] = clone(x[i]); return a; }
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== null) return deepClone(x);
  const o = {};
  for (const k in x) { const v = x[k]; o[k] = v === null || typeof v !== 'object' ? v : clone(v); }
  return o;
}
export const _cloneForTest = clone;
const entitiesOf = (recs) => new Set(recs.map(r => r.entity));

export const records = {
  get: (entity, id) => run(['records'], 'readonly', t => reqP(t.objectStore('records').get(`${entity}:${id}`))),
  put: async (rec) => { drop([rec.entity]); try { return await run(['records'], 'readwrite', t => reqP(t.objectStore('records').put(rec))); } finally { drop([rec.entity]); } },
  putMany: async (recs) => { if (!recs.length) return; const es = entitiesOf(recs); drop(es); try { return await run(['records'], 'readwrite', t => { const s = t.objectStore('records'); recs.forEach(r => s.put(r)); }); } finally { drop(es); } },
  byEntity: async (entity) => {
    const hit = cache.get(entity);
    if (hit) return clone(hit);
    const g = gen.get(entity) || 0, ag = allGen;
    const rows = await run(['records'], 'readonly', t => reqP(t.objectStore('records').index('entity').getAll(entity)));
    if ((gen.get(entity) || 0) === g && allGen === ag) cache.set(entity, clone(rows));
    return rows;
  },
  dirty: () => run(['records'], 'readonly', t => reqP(t.objectStore('records').index('dirty').getAll(1))),
  count: () => run(['records'], 'readonly', t => reqP(t.objectStore('records').count())),
  clearAll: async () => { drop('*'); try { return await run(['records', 'blobs', 'meta'], 'readwrite', t => { ['records', 'blobs', 'meta'].forEach(n => t.objectStore(n).clear()); }); } finally { drop('*'); } },
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
