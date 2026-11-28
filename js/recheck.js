// Re-check barcodes on saved cars (s1-0.54.0, B 28 Nov). s1-0.53.0 made photo reading retry on zoomed sections, but
// only for photos read from then on. This re-reads the barcode-carrying photos of every car still in To check → No
// barcode (s1-0.59.0: the Barcode close-up, then any extra side photos, first barcode found wins).
// Rules: only cars with NO barcode and not marked "no barcode on this box"; a found barcode is ADDED, never replaces
// one; every fill is logged (CHANGE_LOG, source 'rear_photo_recheck'); a barcode that another car already has is
// still saved but reported, so Needs review shows it ("same car twice"). Nothing is merged.
// After a sync the phone keeps only a small thumbnail of a photo (too small to read), so the full original is
// downloaded from Drive (~3 MB each), read, and thrown away again (not kept on the phone).

// Photos that can carry a barcode, in the order they are tried (s1-0.59.0: since s1-0.56.0 a barcode can be on an
// extra side photo, not only the Barcode close-up). Front, box art and car photos are not read.
export const BARCODE_ROLES = ['box_rear', 'label', 'box_back', 'box_bottom', 'box_side', 'box_top'];

/** Cars to re-check: live, no barcode, not marked barcode-absent, with at least one live photo that can carry a
 *  barcode and hasn't already been read with nothing found (skip = Set of photo ids). Photos in BARCODE_ROLES order. */
export function recheckTargets(models, ids, photos, skip = new Set()) {
  const hasBc = new Set(ids.filter(i => !i.deleted_at && i.identifier_type === 'barcode' && String(i.value_raw || '').trim()).map(i => i.model_id));
  const byModel = new Map();
  for (const p of photos) { if (p.deleted_at || !BARCODE_ROLES.includes(p.shot_role)) continue; const a = byModel.get(p.model_id); if (a) a.push(p); else byModel.set(p.model_id, [p]); }
  const out = [];
  for (const m of models) {
    if (m.deleted_at || hasBc.has(m.model_id) || m.barcode_absent === 'yes') continue;
    const ph = (byModel.get(m.model_id) || []).sort((a, b) => BARCODE_ROLES.indexOf(a.shot_role) - BARCODE_ROLES.indexOf(b.shot_role));
    if (!ph.length) continue;
    const todo = ph.filter(p => !skip.has(p.photo_id));
    out.push({ model: m, photos: todo, done: todo.length === 0 });
  }
  return out;
}

/** Runs the re-check one car at a time. deps: { getOriginal(photo) → Blob|null, scan(blob) → {value, format}|null,
 *  save(model, found, photo) → Promise, otherOwner(cmp, modelId) → model|null, cmp(raw) → string, checkOk(raw),
 *  onProgress({ i, n, found }), onNone(photo) (read fine, no barcode), stopped() → bool }. Returns a summary; never throws for one bad photo. */
export async function runRecheck(targets, deps) {
  const sum = { cars: 0, checked: 0, found: 0, clash: 0, missing: 0, failed: 0, stopped: false, filled: [] };
  const todo = targets.filter(t => !t.done && t.photos.length);
  let n = 0;
  for (const { model, photos } of todo) {
    if (deps.stopped?.()) { sum.stopped = true; break; }
    deps.onProgress?.({ i: ++n, n: todo.length, found: sum.found });
    sum.cars++;
    for (const photo of photos) { // first photo with a barcode wins; the rest of this car's photos aren't fetched
      let blob = null;
      try { blob = await deps.getOriginal(photo); } catch { blob = null; }
      if (!blob) { sum.missing++; continue; }
      let r = null;
      try { r = await deps.scan(blob); } catch { sum.failed++; continue; }
      sum.checked++;
      if (!r || !String(r.value || '').trim()) { deps.onNone?.(photo); continue; }
      const raw = String(r.value).trim(), cmp = deps.cmp(raw);
      const other = deps.otherOwner?.(cmp, model.model_id) || null;
      try { await deps.save(model, { raw, cmp, format: r.format || '', checkOk: deps.checkOk(raw) }, photo); } catch { sum.failed++; break; }
      sum.found++; if (other) sum.clash++;
      sum.filled.push({ model_id: model.model_id, barcode: raw, clashWith: other ? other.model_id : '', role: photo.shot_role });
      break;
    }
  }
  return sum;
}

/** One-line result for the toast. */
export function recheckSummary(s) {
  const parts = [`Found ${s.found} barcode${s.found === 1 ? '' : 's'} · ${s.cars} car${s.cars === 1 ? '' : 's'}, ${s.checked} photo${s.checked === 1 ? '' : 's'} read`];
  if (s.clash) parts.push(`${s.clash} also on another car (see Needs review)`);
  if (s.missing) parts.push(`${s.missing} photo${s.missing === 1 ? '' : 's'} couldn't be fetched`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.stopped) parts.push('stopped');
  return parts.join(' · ');
}
