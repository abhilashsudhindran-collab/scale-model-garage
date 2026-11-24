// Backups (decision D25): a copy of the SCALE_GARAGE_MASTER sheet is made in 06_BACKUPS when the app
// syncs and the last daily copy is over 24 h old (keep 7), plus one per calendar month (keep 12),
// plus "Back up now" (kept until B deletes them). ₹0: Drive copies only, within drive.file scope.
// Photos are NOT copied (D25: quarterly manual download, e.g. Google Takeout).
// Restore (D25, s1-0.14.0): restoreBackup() makes a chosen copy the main sheet again; nothing is ever deleted.
import { drive, sheets } from './google.js';
import { meta, records } from './idb.js';
import { SETTINGS_TAB, WORKBOOK_NAME } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP = { daily: 7, monthly: 12 };
const TAG = 'smgBackup';

async function makeCopy(config, kind, now) {
  const d = new Date(now);
  const stamp = d.toISOString().slice(0, 10) + (kind === 'manual' ? ` ${d.toTimeString().slice(0, 5).replace(':', '')}` : '');
  const folder = config.folders?.[`06_BACKUPS/${kind.toUpperCase()}`];
  if (!folder) throw new Error('Backup folder missing (run Sync once to finish setup)');
  // Tagged as a backup in the copy request itself, and the main-sheet tag (smgRole) removed, so a copy
  // can never be mistaken for the main sheet, even for a moment.
  const tags = { [TAG]: kind, smgRole: null };
  const f = await drive.copy(config.workbookId, `${WORKBOOK_NAME} backup ${kind} ${stamp}`, folder, tags);
  await drive.update(f.id, { appProperties: tags });
  return f.id;
}

// Oldest copies beyond the limit go to Drive's trash (recoverable for ~30 days), never deleted outright.
async function prune(kind) {
  const r = await drive.list(`appProperties has { key='${TAG}' and value='${kind}' } and trashed=false`, 'files(id,name)');
  const files = (r.files || []).sort((a, b) => b.name.localeCompare(a.name)); // names carry the date: newest first
  for (const f of files.slice(KEEP[kind])) await drive.update(f.id, { trashed: true });
}

async function recordInSheet(config, at) {
  const r = await sheets.batchGet(config.workbookId, [`${SETTINGS_TAB.name}!A1:A60`]);
  const rows = r.valueRanges?.[0]?.values || [];
  const i = rows.findIndex(x => x[0] === 'last_backup_at');
  if (i >= 0) await sheets.batchUpdate(config.workbookId, [{ range: `${SETTINGS_TAB.name}!B${i + 1}:C${i + 1}`, values: [[at, at]] }]);
}

export const lastBackup = () => meta.get('lastBackup', {});

// Called after a successful sync. Returns { daily, monthly } = which copies were made.
// Only one check runs at a time: two syncs finishing together must not make two copies.
let running = null;
export async function backupIfDue(config, now = Date.now()) {
  if (running) { await running.catch(() => {}); return { daily: false, monthly: false }; }
  running = checkAndCopy(config, now);
  try { return await running; } finally { running = null; }
}
async function checkAndCopy(config, now) {
  const last = await lastBackup();
  const month = new Date(now).toISOString().slice(0, 7);
  const out = { daily: false, monthly: false };
  if (!last.dailyAt || now - Date.parse(last.dailyAt) > DAY_MS) { await makeCopy(config, 'daily', now); await prune('daily'); out.daily = true; }
  if (last.monthlyMonth !== month) { await makeCopy(config, 'monthly', now); await prune('monthly'); out.monthly = true; }
  if (out.daily || out.monthly) {
    const at = new Date(now).toISOString();
    await meta.set('lastBackup', { ...last, ...(out.daily ? { dailyAt: at } : {}), ...(out.monthly ? { monthlyMonth: month } : {}) });
    await recordInSheet(config, at);
  }
  return out;
}

export async function backupNow(config, now = Date.now()) {
  await makeCopy(config, 'manual', now);
  const at = new Date(now).toISOString();
  await meta.set('lastBackup', { ...(await lastBackup()), manualAt: at });
  await recordInSheet(config, at);
}

// ---------- Restore (D25: restore must work before the collection depends on backups) ----------
// Lists backup copies newest first: [{ id, name, kind, at }]. The date comes from the copy's name.
export async function listBackups() {
  const out = [];
  for (const kind of ['manual', 'daily', 'monthly']) {
    const r = await drive.list(`appProperties has { key='${TAG}' and value='${kind}' } and trashed=false`, 'files(id,name,appProperties)');
    for (const f of r.files || []) {
      const m = f.name.match(/(\d{4}-\d{2}-\d{2})(?: (\d{2})(\d{2}))?$/);
      out.push({ id: f.id, name: f.name, kind, at: m ? `${m[1]}${m[2] ? `T${m[2]}:${m[3]}` : ''}` : '' });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind));
}

// Makes `backup` the main sheet. Steps, safest first:
//   1. refuse unless everything on this phone is synced (nothing unsynced can be lost);
//   2. a fresh "manual" backup of the current sheet;
//   3. copy the chosen backup into 00_DATABASE as the new main sheet (tagged as the workbook);
//   4. the current main sheet is kept, renamed "(replaced …)" and untagged, never deleted;
//   5. this phone's database is rebuilt from the restored sheet by the next sync (photos stay in Drive).
export async function restoreBackup(config, backup, { pending, now = Date.now() } = {}) {
  if (pending && (pending.boxes || pending.other)) throw new Error('Sync first: some changes on this phone have not reached your sheet yet.');
  const stamp = new Date(now).toISOString();
  await backupNow(config, now);
  const fresh = await drive.copy(backup.id, WORKBOOK_NAME, config.folders['00_DATABASE'], { smgRole: 'workbook', [TAG]: null });
  await drive.update(fresh.id, { appProperties: { smgRole: 'workbook', [TAG]: null } });
  const d = new Date(now), pad = (n) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; // B's own clock
  await drive.update(config.workbookId, { name: `${WORKBOOK_NAME} (replaced ${local})`, appProperties: { smgRole: 'replaced' } });
  const lb = await lastBackup();
  await records.clearAll();
  const next = { ...config, workbookId: fresh.id, tabsVersion: undefined, restoredAt: stamp, restoredFrom: backup.name, replacedId: config.workbookId };
  await meta.set('config', next);
  await meta.set('lastBackup', lb);
  return next;
}
