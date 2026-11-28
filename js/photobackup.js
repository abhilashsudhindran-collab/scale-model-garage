// Photo backup reminder (s1-0.60.0, B 28 Nov; D25: "photos: manual quarterly download"). Sheet copies are made
// automatically, but original photos are only in Drive: a copy in the same Drive doesn't protect against losing the
// account, so D25 asks for a download every 3 months. Nothing reminded B; this works out when it's due.
// Rule: due 90 days after the last time B marked it done; never done → 90 days after the first synced photo.

export const EVERY_DAYS = 90;
const DAY = 86400000;

/** { dueAt: Date|null, due: bool, days: int } — days = until due (≥ 0) or overdue (< 0); dueAt null when no
 *  photo has been synced yet (nothing to back up). */
export function photoBackupDue({ lastAt, firstPhotoAt, now = new Date() }) {
  const base = lastAt ? new Date(lastAt) : firstPhotoAt ? new Date(firstPhotoAt) : null;
  if (!base || isNaN(base)) return { dueAt: null, due: false, days: 0 };
  const dueAt = new Date(base.getTime() + EVERY_DAYS * DAY);
  const days = Math.ceil((dueAt - now) / DAY);
  return { dueAt, due: days <= 0, days };
}

/** Rough size of the SCALE GARAGE folder to download: originals ~2.9 MB + display ~0.36 MB + thumb ~0.03 MB per
 *  photo (D13.1 measurements on B's phone), plus cropped copies ~0.6 MB. An estimate, shown as such. */
export function folderSizeGB(photos) {
  let mb = 0;
  for (const p of photos) { if (p.deleted_at || !p.original_file_id) continue; mb += 3.3 + (p.cropped_file_id ? 0.6 : 0); }
  return mb / 1024;
}

/** The newest of two ISO dates (this device's and the sheet's), or ''. */
export function newest(a, b) {
  const ta = a ? Date.parse(a) : NaN, tb = b ? Date.parse(b) : NaN;
  if (isNaN(ta)) return isNaN(tb) ? '' : b;
  if (isNaN(tb)) return a;
  return ta >= tb ? a : b;
}
