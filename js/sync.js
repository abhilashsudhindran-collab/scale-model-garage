// Sync engine (architecture §3.3). Proven patterns from R0 6b:
// - photos uploaded idempotently (tagged with their photo ID; looked up only if an earlier attempt may have uploaded),
// - md5 checked against Drive's checksum,
// - rows written idempotently (an ID already in the Sheet is updated, never appended twice),
// - each tab read ONCE per run, writes batched (Sheets quota 60/min per user; D18),
// - clashes: version check; different fields merge, same field → B decides (D23),
// - queued data is never discarded (brief §13.3).
import { drive, sheets, hasToken, signIn, ApiError } from './google.js';
import { records, blobs, meta } from './idb.js';
import { ensureSetup, colLetter } from './setup.js';
import { TABS, headersFor, SYNCED_ENTITIES, tabOfEntity, idColOfEntity, SHOT_ROLES } from './schema.js';
import { md5Blob } from './md5.js';
import { nowIso, notifyChange } from './store.js';

let running = null;
export const isSyncing = () => !!running;

const str = (v) => (v === null || v === undefined ? '' : String(v));
const rowToObj = (headers, row) => { const o = {}; headers.forEach((h, i) => { o[h] = str(row[i]); }); return o; };

export const PHOTO_POOL = 3;

export function syncNow(opts = {}) {
  if (running) return running;
  running = doSync(opts).finally(() => { running = null; notifyChange(); });
  return running;
}

async function doSync({ interactive = false, progress = () => {} } = {}) {
  const t0 = Date.now();
  const summary = { startedAt: nowIso(), photosUploaded: 0, filesReused: 0, rowsAppended: 0, rowsUpdated: 0, pulled: 0, conflicts: 0, errors: [] };
  if (!navigator.onLine) throw new ApiError('No internet connection — items stay safely on the phone', 0, true);
  if (!hasToken()) {
    if (!interactive) throw new ApiError('Sign-in needed — tap Sync now', 401, false);
    progress('Signing in…');
    await signIn();
  }
  const config = await ensureSetup(progress);

  // 1. Photos: upload files first (rows need the Drive file IDs).
  const photoRecs = (await records.byEntity('photos')).filter(r => r.dirty && !r.data.deleted_at);
  // Up to PHOTO_POOL photos upload at the same time (s1-0.34.0; was one at a time). Each photo keeps its own
  // safety: "attempted" mark before upload, look-before-retry, checksum check. A sign-in failure stops the rest.
  const queue = photoRecs.slice(); let started = 0, fatal = null;
  const worker = async () => {
    while (queue.length && !fatal) {
      const rec = queue.shift();
      progress(`Uploading photo ${++started} of ${photoRecs.length}…`);
      try { await uploadPhoto(rec, config, summary); }
      catch (e) {
        rec.lastError = e.message; await records.put(rec);
        summary.errors.push(`Photo ${rec.id}: ${e.message}`);
        if (!e.retryable && e.status === 401) fatal = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PHOTO_POOL, photoRecs.length) }, worker));
  if (fatal) throw fatal;

  // 2. Read every synced tab in ONE request.
  progress('Reading your sheet…');
  const tabs = SYNCED_ENTITIES.map(tabOfEntity);
  const res = await sheets.batchGet(config.workbookId, tabs.map(t => `${t}!A1:ZZ`));
  const remote = {};
  for (let k = 0; k < tabs.length; k++) {
    const values = res.valueRanges?.[k]?.values || [];
    const headers = (values[0] || []).map(str);
    const byId = new Map();
    for (let r = 1; r < values.length; r++) {
      const obj = rowToObj(headers, values[r]);
      const id = obj[TABS[tabs[k]].id];
      if (id) byId.set(id, { row: r + 1, obj });
    }
    remote[tabs[k]] = { headers, byId, lastRow: values.length };
  }

  // 3. Make sure every expected column exists (add missing at the end; never delete).
  const headerFixes = [];
  for (const tab of tabs) {
    const want = headersFor(tab);
    const have = remote[tab].headers;
    const missing = want.filter(h => !have.includes(h));
    if (missing.length || !have.length) {
      const full = have.length ? [...have, ...missing] : want;
      remote[tab].headers = full;
      headerFixes.push({ range: `${tab}!A1:${colLetter(full.length)}1`, values: [full] });
    }
  }
  if (headerFixes.length) await sheets.batchUpdate(config.workbookId, headerFixes);

  // 4. Push local changes.
  const dirty = (await records.dirty()).filter(r => SYNCED_ENTITIES.includes(r.entity));
  const appends = {}; const updates = []; const done = [];
  for (const rec of dirty) {
    if (rec.entity === 'photos' && !rec.data.original_file_id) {
      // Removed before it was ever uploaded: nothing to write to the Sheet; stop counting it as waiting.
      if (rec.data.deleted_at) await records.put({ ...rec, dirty: 0 });
      continue; // otherwise its files are not up yet
    }
    const tab = tabOfEntity(rec.entity);
    const R = remote[tab];
    const hit = R.byId.get(rec.id);
    let toWrite;
    if (!hit) {
      toWrite = { ...rec.data, version: Number(rec.data.version) || 1 };
      (appends[tab] ||= []).push({ rec, obj: toWrite });
      continue;
    }
    const remoteObj = hit.obj;
    const base = rec.sync?.base;
    const rv = Number(remoteObj.version) || 0;
    const META = ['created_at', 'updated_at', 'version', 'device_id'];
    if (!base && headersFor(tab).every(f => META.includes(f) || str(rec.data[f]) === str(remoteObj[f]))) {
      // Already in the Sheet with the same content (e.g. seed rows, or a write whose reply was lost): just mark synced.
      done.push({ rec, obj: { ...remoteObj } });
      continue;
    }
    if (!base || rv === (Number(base.version) || 0)) {
      toWrite = { ...rec.data, version: rv + 1 };
    } else {
      // Remote changed since our last sync: field-by-field merge (D23).
      const fields = headersFor(tab).filter(h => !['version', 'updated_at', 'device_id'].includes(h));
      const localChanged = fields.filter(f => str(rec.data[f]) !== str(base[f]));
      const conflicts = localChanged.filter(f => str(remoteObj[f]) !== str(base[f]) && str(remoteObj[f]) !== str(rec.data[f]));
      if (conflicts.length) {
        rec.conflict = { fields: conflicts, local: Object.fromEntries(conflicts.map(f => [f, str(rec.data[f])])), remote: Object.fromEntries(conflicts.map(f => [f, str(remoteObj[f])])), remoteVersion: rv, at: nowIso() };
        await records.put(rec);
        summary.conflicts++;
        continue;
      }
      const merged = { ...remoteObj };
      localChanged.forEach(f => { merged[f] = rec.data[f]; });
      toWrite = { ...merged, updated_at: rec.data.updated_at, device_id: rec.data.device_id, version: rv + 1 };
    }
    updates.push({ range: `${tab}!A${hit.row}:${colLetter(R.headers.length)}${hit.row}`, values: [R.headers.map(h => str(toWrite[h]))] });
    done.push({ rec, obj: toWrite });
    summary.rowsUpdated++;
  }

  progress('Saving to your sheet…');
  if (updates.length) await sheets.batchUpdate(config.workbookId, updates);
  for (const [tab, items] of Object.entries(appends)) {
    const R = remote[tab];
    await sheets.append(config.workbookId, `${tab}!A1`, items.map(x => R.headers.map(h => str(x.obj[h]))));
    summary.rowsAppended += items.length;
    done.push(...items);
  }
  // Mark written rows as synced in ONE database transaction (perf: one per row took ~1 min for 1,500 cars).
  if (done.length) {
    const current = new Map();
    for (const ent of new Set(done.map(d => d.rec.entity))) for (const r of await records.byEntity(ent)) current.set(r.key, r);
    const puts = done.map(({ rec, obj }) => {
      const fresh = current.get(rec.key);
      // If B edited it again while we were syncing, keep it dirty; the base still moves forward.
      const editedMeanwhile = fresh && fresh.data.updated_at !== rec.data.updated_at;
      const data = editedMeanwhile ? { ...fresh.data, version: obj.version } : { ...obj };
      return { ...(fresh || rec), data, dirty: editedMeanwhile ? 1 : 0, sync: { base: { ...obj } }, lastError: undefined, conflict: undefined };
    });
    await records.putMany(puts);
  }

  // 5. Pull rows changed elsewhere (e.g. laptop) into the phone's copy.
  const local = new Map();
  for (const ent of SYNCED_ENTITIES) for (const r of await records.byEntity(ent)) local.set(r.key, r);
  const pulls = [];
  const writtenKeys = new Set(done.map(d => d.rec.key));
  for (const tab of tabs) {
    const entity = TABS[tab].entity;
    for (const [id, { obj }] of remote[tab].byId) {
      const key = `${entity}:${id}`;
      const l = local.get(key);
      if (writtenKeys.has(key)) continue;
      if (!l) { pulls.push({ key, entity, id, data: obj, dirty: 0, sync: { base: { ...obj } } }); continue; }
      if (!l.dirty && (Number(obj.version) || 0) > (Number(l.data.version) || 0)) pulls.push({ ...l, data: obj, sync: { base: { ...obj } } });
    }
  }
  if (pulls.length) await records.putMany(pulls);
  summary.pulled = pulls.length;

  // 5b. Photos on another device (audit G3): fetch missing thumbnails (~33 KB each) so tiles show real
  //     photos on the laptop or after clearing Chrome. Capped per sync so a first sync stays quick.
  summary.thumbsFetched = 0;
  const haveBlobs = new Set(await blobs.keys());
  for (const r of await records.byEntity('photos')) {
    if (summary.thumbsFetched >= 60) break;
    if (r.data.crop_corners && r.data.cropped_file_id && !haveBlobs.has(`${r.id}:cropped`) && !haveBlobs.has(`${r.id}:cropthumb`)) {
      try { await blobs.put(`${r.id}:cropped`, await drive.download(r.data.cropped_file_id)); summary.thumbsFetched++; } catch (e) { console.warn('cropped download', r.id, e.message); }
    }
    if (r.data.deleted_at || !r.data.thumb_file_id || haveBlobs.has(`${r.id}:thumb`)) continue;
    try {
      progress(`Fetching photo previews… ${summary.thumbsFetched + 1}`);
      await blobs.put(`${r.id}:thumb`, await drive.download(r.data.thumb_file_id));
      summary.thumbsFetched++;
    } catch (e) { console.warn('thumbnail download', r.id, e.message); }
  }

  // 6. Free phone storage: once a photo row is safely in the Sheet, drop the local original
  //    (and display copy, except box fronts kept for the offline shop check). Thumbnails stay.
  // Only touches photos that still have a big file here (perf: trying every photo on every sync grew with the collection).
  const stillHere = new Set(await blobs.keys());
  for (const r of await records.byEntity('photos')) {
    if (r.dirty || !r.data.original_file_id || !r.data.thumb_file_id) continue;
    if (stillHere.has(`${r.id}:original`)) await blobs.remove(`${r.id}:original`);
    if (r.data.shot_role !== 'box_front' && stillHere.has(`${r.id}:display`)) await blobs.remove(`${r.id}:display`);
  }

  summary.ms = Date.now() - t0;
  summary.finishedAt = nowIso();
  await meta.set('lastSync', summary);
  return summary;
}

async function uploadPhoto(rec, config, summary) {
  const d = rec.data;
  const up = rec.upload || {};
  const folderId = config.folders[SHOT_ROLES[d.shot_role]?.folder || '01_MODEL_IMAGES'];
  const variants = [['original', 'original_file_id'], ['display', 'display_file_id'], ['thumb', 'thumb_file_id']];
  if (d.crop_corners) variants.push(['cropped', 'cropped_file_id']); // straightened copy (D14), when there is one
  for (const [variant, col] of variants) {
    if (d[col]) continue;
    const blob = await blobs.get(`${rec.id}:${variant}`);
    if (!blob && variant === 'cropped') continue; // made on another device and not here: nothing to upload
    if (!blob) throw new ApiError(`Photo file missing on phone (${variant})`, 0, false);
    const localMd5 = variant === 'original' ? d.original_md5 : await md5Blob(blob);
    let fileId = null;
    if (up[variant]?.attempted) {
      // An earlier attempt may have uploaded it but lost the reply (F1 case): look before uploading again.
      const found = await drive.list(`appProperties has { key='smgPhotoId' and value='${rec.id}' } and appProperties has { key='smgVariant' and value='${variant}' } and trashed=false`);
      const f = found.files?.find(x => x.md5Checksum === localMd5);
      if (f) { fileId = f.id; summary.filesReused++; }
    }
    if (!fileId) {
      up[variant] = { attempted: nowIso() }; rec.upload = up; await records.put(rec);
      const name = `${d.shot_role || 'photo'}_${rec.id}${variant === 'original' ? '' : '_' + variant}.jpg`;
      const r = await drive.upload(blob, { name, parents: [folderId], mimeType: blob.type || 'image/jpeg', appProperties: { smgPhotoId: rec.id, smgVariant: variant } });
      if (r.md5Checksum && r.md5Checksum !== localMd5) throw new ApiError(`Checksum mismatch after upload (${variant}) — will retry`, 0, true);
      fileId = r.id;
      if (variant === 'original') summary.photosUploaded++;
    }
    d[col] = fileId;
    rec.data = d; await records.put(rec);
  }
  d.uploaded_at = d.uploaded_at || nowIso();
  rec.data = d; rec.lastError = undefined; await records.put(rec);
}
