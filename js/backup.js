// Backups (decision D25): a copy of the SCALE_GARAGE_MASTER sheet is made in 06_BACKUPS when the app
// syncs and the last daily copy is over 24 h old (keep 7), plus one per calendar month (keep 12),
// plus "Back up now" (kept until B deletes them). ₹0: Drive copies only, within drive.file scope.
// Photos are NOT copied (D25: quarterly manual download, e.g. Google Takeout).
// Restoring is manual for now: open a backup copy from Drive (06_BACKUPS) and use it; no in-app restore yet.
import { drive, sheets } from './google.js';
import { meta } from './idb.js';
import { SETTINGS_TAB, WORKBOOK_NAME } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP = { daily: 7, monthly: 12 };
const TAG = 'smgBackup';

async function makeCopy(config, kind, now) {
  const d = new Date(now);
  const stamp = d.toISOString().slice(0, 10) + (kind === 'manual' ? ` ${d.toTimeString().slice(0, 5).replace(':', '')}` : '');
  const folder = config.folders?.[`06_BACKUPS/${kind.toUpperCase()}`];
  if (!folder) throw new Error('Backup folder missing (run Sync once to finish setup)');
  const f = await drive.copy(config.workbookId, `${WORKBOOK_NAME} backup ${kind} ${stamp}`, folder);
  await drive.update(f.id, { appProperties: { [TAG]: kind } });
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
