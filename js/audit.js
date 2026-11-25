// Sync check (Stage 1 acceptance check 2: "every entry in the Sheet once, photos intact, 0 duplicates, 0 missing").
// READ-ONLY: it reads the Sheet and asks Drive about each original photo; it never writes, moves or deletes anything.
import { records } from './idb.js';
import { sheets, drive } from './google.js';
import { getConfig } from './setup.js';
import { TABS, SYNCED_ENTITIES, tabOfEntity } from './schema.js';

// Pure: compare the ids this phone has synced with the ids found in one Sheet tab.
export function compareTab(localSyncedIds, sheetIds) {
  const seen = new Map();
  for (const id of sheetIds) if (id) seen.set(id, (seen.get(id) || 0) + 1);
  const local = new Set(localSyncedIds);
  return {
    sheetRows: sheetIds.filter(Boolean).length,
    dupes: [...seen].filter(([, n]) => n > 1).map(([id]) => id),
    missing: [...local].filter(id => !seen.has(id)),          // synced on this phone, not in the Sheet
    extra: [...seen.keys()].filter(id => !local.has(id)),       // in the Sheet, not on this phone (e.g. another device)
  };
}

// Pure: what one original photo's Drive answer means.
export function photoVerdict(localMd5, driveFile) {
  if (!driveFile) return 'missing';
  if (driveFile.trashed) return 'trashed';
  if (localMd5 && driveFile.md5Checksum && driveFile.md5Checksum !== localMd5) return 'changed';
  return 'ok';
}

export async function runAudit({ checkFiles = true, progress = () => {} } = {}) {
  const config = await getConfig();
  if (!config?.workbookId) throw new Error('Not set up yet: sign in and sync once first.');
  const tabs = SYNCED_ENTITIES.map(tabOfEntity);
  progress('Reading your sheet…');
  const res = await sheets.batchGet(config.workbookId, tabs.map(t => `${t}!A1:ZZ`));
  const out = { at: new Date().toISOString(), tabs: {}, pending: 0, photos: { checked: 0, ok: 0, missing: [], trashed: [], changed: [], notUploaded: 0 } };
  const recsByEntity = {};
  for (const [k, tab] of tabs.entries()) {
    const entity = TABS[tab].entity;
    const values = res.valueRanges?.[k]?.values || [];
    const headers = (values[0] || []).map(x => String(x ?? ''));
    const col = headers.indexOf(TABS[tab].id);
    const sheetIds = col < 0 ? [] : values.slice(1).map(r => String(r[col] ?? '').trim());
    const recs = await records.byEntity(entity); // starter brands/scales included: they are in the sheet too
    recsByEntity[entity] = recs;
    out.pending += recs.filter(r => r.dirty && !r.seed).length;
    out.tabs[tab] = { entity, local: recs.length, ...compareTab(recs.filter(r => !r.dirty).map(r => r.id), sheetIds) };
  }
  const photos = recsByEntity.photos || [];
  out.photos.notUploaded = photos.filter(r => !r.data.original_file_id).length;
  if (checkFiles) {
    const todo = photos.filter(r => r.data.original_file_id);
    for (let i = 0; i < todo.length; i += 5) {
      progress(`Checking photo files ${Math.min(i + 5, todo.length)} of ${todo.length}…`);
      await Promise.all(todo.slice(i, i + 5).map(async (r) => {
        let f = null;
        try { f = await drive.get(r.data.original_file_id, 'id,trashed,md5Checksum'); }
        catch (e) { if (e.status !== 404) throw e; }
        const v = photoVerdict(r.data.original_md5, f);
        out.photos.checked++;
        if (v === 'ok') out.photos.ok++; else out.photos[v].push(r.id);
      }));
    }
  }
  const t = Object.values(out.tabs);
  out.problems = t.reduce((a, x) => a + x.dupes.length + x.missing.length, 0) + out.photos.missing.length + out.photos.trashed.length + out.photos.changed.length;
  out.ok = out.problems === 0;
  return out;
}
