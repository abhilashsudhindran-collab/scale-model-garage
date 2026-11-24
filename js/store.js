// Data layer: the one place screens read and write records. Works fully offline.
// Each record is kept locally with a "base" copy of what the Sheet held at the last sync,
// which the sync engine uses for clash handling (D23).
import { records } from './idb.js';
import { newId } from './ids.js';
import { TABS, tabOfEntity, idColOfEntity } from './schema.js';

export const nowIso = () => new Date().toISOString();

export function deviceId() {
  let d = localStorage.getItem('smg.deviceId');
  if (!d) {
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'desktop';
    d = `${mobile}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('smg.deviceId', d);
  }
  return d;
}

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch {} });

// Every column of the entity's tab, empty string by default ("unknown is empty, never 0").
export function blank(entity) {
  const t = TABS[tabOfEntity(entity)];
  const o = {};
  for (const c of [t.id, 'created_at', 'updated_at', 'version', 'deleted_at', 'device_id', ...t.cols]) o[c] = '';
  return o;
}

export async function create(entity, fields = {}) {
  const idCol = idColOfEntity(entity);
  const ts = nowIso();
  const data = { ...blank(entity), ...fields, [idCol]: fields[idCol] || newId(entity), created_at: ts, updated_at: ts, version: 1, deleted_at: '', device_id: deviceId() };
  await records.put({ key: `${entity}:${data[idCol]}`, entity, id: data[idCol], data, dirty: 1, sync: { base: null } });
  emit();
  return data;
}

export async function createMany(items) { // [{entity, fields}] in one local transaction
  const ts = nowIso(), out = [], recs = [];
  for (const { entity, fields } of items) {
    const idCol = idColOfEntity(entity);
    const data = { ...blank(entity), ...fields, [idCol]: fields[idCol] || newId(entity), created_at: ts, updated_at: ts, version: 1, deleted_at: '', device_id: deviceId() };
    recs.push({ key: `${entity}:${data[idCol]}`, entity, id: data[idCol], data, dirty: 1, sync: { base: null } });
    out.push(data);
  }
  await records.putMany(recs);
  emit();
  return out;
}

export async function update(entity, id, patch, { local = {} } = {}) {
  const rec = await records.get(entity, id);
  if (!rec) throw new Error(`Record not found: ${entity} ${id}`);
  rec.data = { ...rec.data, ...patch, updated_at: nowIso(), device_id: deviceId() };
  Object.assign(rec, local);
  rec.dirty = 1;
  await records.put(rec);
  emit();
  return rec.data;
}

// Local-only fields (upload progress, conflicts) without marking the row as changed.
export async function setLocal(entity, id, local) {
  const rec = await records.get(entity, id);
  if (!rec) return;
  Object.assign(rec, local);
  await records.put(rec);
  emit();
}

export const archive = (entity, id) => update(entity, id, { deleted_at: nowIso() });

export async function get(entity, id) { return (await records.get(entity, id))?.data || null; }
export async function getRecord(entity, id) { return records.get(entity, id); }

export async function list(entity, { includeDeleted = false } = {}) {
  const all = await records.byEntity(entity);
  return all.map(r => r.data).filter(d => includeDeleted || !d.deleted_at);
}
export async function listRecords(entity) { return records.byEntity(entity); }

export async function counts() {
  const dirty = await records.dirty();
  const photos = await records.byEntity('photos');
  return {
    pending: dirty.length,
    photosPending: photos.filter(p => p.dirty || !p.data.original_file_id).length,
    conflicts: (await Promise.all(['models', 'inventory', 'product_identifiers', 'brands'].map(e => records.byEntity(e)))).flat().filter(r => r.conflict).length,
    errors: dirty.filter(r => r.lastError).length,
  };
}

// What is waiting to sync, in the user's terms (audit finding S1): boxes, not internal rows.
// Seed reference rows (scales, brands, categories made at install) and the change log are never counted.
export async function pendingSummary() {
  const dirty = (await records.dirty()).filter(r => !r.seed && r.entity !== 'change_log');
  const boxes = new Set();
  let photos = 0, other = 0;
  for (const r of dirty) {
    if (r.entity === 'models') boxes.add(r.id);
    else if (['inventory', 'photos', 'product_identifiers'].includes(r.entity) && r.data.model_id) boxes.add(r.data.model_id);
    else other++;
    if (r.entity === 'photos') photos++;
  }
  return { boxes: boxes.size, photos, other };
}

export async function logChange(entity, recordId, field, oldValue, newValue, reason = '') {
  return create('change_log', { entity, record_id: recordId, field, old_value: String(oldValue ?? ''), new_value: String(newValue ?? ''), reason, changed_at: nowIso() });
}

export { emit as notifyChange };
