// First-time setup in B's Google Drive: SCALE GARAGE folders + SCALE_GARAGE_MASTER workbook (schema v1, seeds).
// Re-running is safe: existing folders/workbook are found by their app tags (drive.file only sees files this app made).
import { drive, sheets } from './google.js';
import { meta, records } from './idb.js';
import { TABS, SETTINGS_TAB, headersFor, FOLDERS, BACKUP_SUBFOLDERS, ROOT_FOLDER, WORKBOOK_NAME, SCHEMA_VERSION,
  SEED_SCALES, SEED_CATEGORIES, SEED_BRANDS, SEED_LINES, idColOfEntity } from './schema.js';
import { seedId } from './ids.js';
import { blank, deviceId, nowIso } from './store.js';

const TAG = 'smgRole';
export const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function findTagged(role) {
  const r = await drive.list(`appProperties has { key='${TAG}' and value='${role}' } and trashed=false`);
  // Never accept a backup copy as the main sheet or a folder (backups carry smgBackup).
  return (r.files || []).find(f => !f.appProperties?.smgBackup)?.id || null;
}

async function ensureFolder(role, name, parent) {
  const existing = await findTagged(role);
  if (existing) return existing;
  return (await drive.createFolder(name, parent, { [TAG]: role })).id;
}

export async function getConfig() { return meta.get('config', null); }

// Returns config { rootId, folders:{name:id}, workbookId, created: bool }
// Bump when TABS gains a tab, so existing workbooks get it on the next sync.
const TABS_VERSION = 2;
// Add any tabs missing from an older workbook, with their header row (never delete).
async function addMissingTabs(workbookId) {
  const tabNames = [...Object.keys(TABS), SETTINGS_TAB.name];
  const m = await sheets.meta(workbookId);
  const have = new Set(m.sheets.map(s => s.properties.title));
  const missing = tabNames.filter(t => !have.has(t));
  if (missing.length) {
    await sheets.addTabs(workbookId, missing);
    await sheets.batchUpdate(workbookId, missing.map(t => ({ range: `${t}!A1`, values: [t === SETTINGS_TAB.name ? SETTINGS_TAB.cols : headersFor(t)] })));
  }
  return missing;
}

export async function ensureSetup(progress = () => {}) {
  const cached = await getConfig();
  if (cached?.workbookId) {
    // Cheap check that the workbook still exists and isn't trashed.
    try {
      const f = await drive.get(cached.workbookId, 'id,trashed');
      if (!f.trashed) {
        // A newer app version may need tabs an older workbook lacks (e.g. STORAGE_BOXES): add them once.
        if (cached.tabsVersion !== TABS_VERSION) {
          progress('Adding new tabs to your sheet…');
          await addMissingTabs(cached.workbookId);
          const upd = { ...cached, tabsVersion: TABS_VERSION };
          await meta.set('config', upd);
          return upd;
        }
        return cached;
      }
    } catch (e) { if (e.status && e.status !== 404) throw e; }
  }
  progress('Finding or creating your SCALE GARAGE folder…');
  const rootId = await ensureFolder('root', ROOT_FOLDER);
  const folders = {};
  for (const f of FOLDERS) folders[f] = await ensureFolder(`folder:${f}`, f, rootId);
  for (const s of BACKUP_SUBFOLDERS) folders[`06_BACKUPS/${s}`] = await ensureFolder(`folder:06_BACKUPS/${s}`, s, folders['06_BACKUPS']);

  let workbookId = await findTagged('workbook');
  let created = false;
  const tabNames = [...Object.keys(TABS), SETTINGS_TAB.name];
  if (!workbookId) {
    progress('Creating the SCALE_GARAGE_MASTER sheet…');
    const ss = await sheets.create(WORKBOOK_NAME, tabNames);
    workbookId = ss.spreadsheetId;
    await drive.update(workbookId, { appProperties: { [TAG]: 'workbook' } });
    const f = await drive.get(workbookId, 'id,parents');
    await drive.move(workbookId, folders['00_DATABASE'], (f.parents || []).join(','));
    await writeHeadersAndSeeds(workbookId);
    created = true;
  } else {
    // Resume a setup that was interrupted (e.g. the phone reloaded the page mid-setup):
    // make sure the workbook sits in 00_DATABASE and has its headers + SETTINGS rows.
    progress('Checking your SCALE_GARAGE_MASTER sheet…');
    const f = await drive.get(workbookId, 'id,parents');
    if (!(f.parents || []).includes(folders['00_DATABASE'])) await drive.move(workbookId, folders['00_DATABASE'], (f.parents || []).join(','));
    const probe = await sheets.batchGet(workbookId, [`${SETTINGS_TAB.name}!A1:A1`]);
    const settingsEmpty = !probe.valueRanges?.[0]?.values?.length;
    await addMissingTabs(workbookId);
    if (settingsEmpty) { progress('Finishing sheet setup…'); await writeHeadersAndSeeds(workbookId); }
  }
  const config = { rootId, folders, workbookId, created, setupAt: nowIso(), tabsVersion: TABS_VERSION };
  await meta.set('config', config);
  return config;
}

// Seed reference data on the phone (works before sign-in / offline). Deterministic IDs mean a second
// device creates identical rows, so sync matches them instead of adding duplicates.
export async function seedLocal() {
  const have = await records.byEntity('scales');
  if (have.length) return false;
  const ts = nowIso(), dev = deviceId();
  const recs = [];
  const add = (entity, name, fields) => {
    const idCol = idColOfEntity(entity);
    const data = { ...blank(entity), ...fields, [idCol]: seedId(entity, name), created_at: ts, updated_at: ts, version: 1, device_id: dev };
    recs.push({ key: `${entity}:${data[idCol]}`, entity, id: data[idCol], data, dirty: 1, sync: { base: null }, seed: true });
    return data[idCol];
  };
  SEED_SCALES.forEach((label, i) => add('scales', label, { label, ratio_denominator: /^1:(\d+)$/.test(label) ? label.split(':')[1] : '', sort_order: String(i + 1), active: 'yes' }));
  SEED_CATEGORIES.forEach((name, i) => add('categories', name, { name, sort_order: String(i + 1), active: 'yes' }));
  const brandIds = {};
  SEED_BRANDS.forEach(b => { brandIds[b.name] = add('brands', b.name, { ...b, brand_kind: 'miniature', is_code_namespace: 'yes', record_status: 'confirmed' }); });
  SEED_LINES.forEach(l => add('product_lines', `${l.brand}|${l.name}`, { brand_id: brandIds[l.brand], name: l.name, is_code_namespace: 'no', code_prefix_hint: l.code_prefix_hint, record_status: l.record_status }));
  await records.putMany(recs);
  return true;
}

async function writeHeadersAndSeeds(workbookId) {
  const data = [];
  for (const tab of Object.keys(TABS)) {
    const headers = headersFor(tab);
    data.push({ range: `${tab}!A1:${colLetter(headers.length)}1`, values: [headers] });
  }
  const ts = nowIso();
  data.push({ range: `${SETTINGS_TAB.name}!A1:C7`, values: [SETTINGS_TAB.cols,
    ['schema_version', String(SCHEMA_VERSION), ts], ['collection_currency', 'INR', ts], ['ownership_cost_includes_expenses', 'no', ts],
    ['last_backup_at', '', ts], ['backup_keep_daily', '7', ts], ['backup_keep_monthly', '12', ts]] });
  await sheets.batchUpdate(workbookId, data);
  await seedLocal(); // seed rows are then appended by the next sync
}
