// Re-check barcodes on saved cars (s1-0.54.0, B 28 Nov). s1-0.53.0 made photo reading retry on zoomed sections, but
// only for photos read from then on. This re-reads the rear photo of every car still in To check → No barcode.
// Rules: only cars with NO barcode and not marked "no barcode on this box"; a found barcode is ADDED, never replaces
// one; every fill is logged (CHANGE_LOG, source 'rear_photo_recheck'); a barcode that another car already has is
// still saved but reported, so Needs review shows it ("same car twice"). Nothing is merged.
// After a sync the phone keeps only a small thumbnail of a rear photo (too small to read), so the full original is
// downloaded from Drive (~3 MB each), read, and thrown away again (not kept on the phone).

/** Cars to re-check: live, no barcode, not marked barcode-absent, with a live rear photo. */
export function recheckTargets(models, ids, photos) {
  const hasBc = new Set(ids.filter(i => !i.deleted_at && i.identifier_type === 'barcode' && String(i.value_raw || '').trim()).map(i => i.model_id));
  const byModel = new Map();
  for (const p of photos) { if (p.deleted_at) continue; const a = byModel.get(p.model_id); if (a) a.push(p); else byModel.set(p.model_id, [p]); }
  const out = [];
  for (const m of models) {
    if (m.deleted_at || hasBc.has(m.model_id) || m.barcode_absent === 'yes') continue;
    const ph = byModel.get(m.model_id) || [];
    const rear = ph.find(p => p.shot_role === 'box_rear') || null;
    if (rear) out.push({ model: m, photo: rear });
  }
  return out;
}

/** Runs the re-check one car at a time. deps: { getOriginal(photo) → Blob|null, scan(blob) → {value, format}|null,
 *  save(model, found, photo) → Promise, otherOwner(cmp, modelId) → model|null, cmp(raw) → string, checkOk(raw),
 *  onProgress({ i, n, found }), onNone(photo) (read fine, no barcode), stopped() → bool }. Returns a summary; never throws for one bad photo. */
export async function runRecheck(targets, deps) {
  const sum = { checked: 0, found: 0, clash: 0, missing: 0, failed: 0, stopped: false, filled: [] };
  for (let i = 0; i < targets.length; i++) {
    if (deps.stopped?.()) { sum.stopped = true; break; }
    const { model, photo } = targets[i];
    deps.onProgress?.({ i: i + 1, n: targets.length, found: sum.found });
    let blob = null;
    try { blob = await deps.getOriginal(photo); } catch { blob = null; }
    if (!blob) { sum.missing++; continue; }
    let r = null;
    try { r = await deps.scan(blob); } catch { sum.failed++; continue; }
    sum.checked++;
    if (!r || !String(r.value || '').trim()) { deps.onNone?.(photo); continue; }
    const raw = String(r.value).trim(), cmp = deps.cmp(raw);
    const other = deps.otherOwner?.(cmp, model.model_id) || null;
    try { await deps.save(model, { raw, cmp, format: r.format || '', checkOk: deps.checkOk(raw) }, photo); } catch { sum.failed++; continue; }
    sum.found++; if (other) sum.clash++;
    sum.filled.push({ model_id: model.model_id, barcode: raw, clashWith: other ? other.model_id : '' });
  }
  return sum;
}

/** One-line result for the toast. */
export function recheckSummary(s) {
  const parts = [`Found ${s.found} barcode${s.found === 1 ? '' : 's'} in ${s.checked} photo${s.checked === 1 ? '' : 's'}`];
  if (s.clash) parts.push(`${s.clash} also on another car (see Needs review)`);
  if (s.missing) parts.push(`${s.missing} photo${s.missing === 1 ? '' : 's'} couldn't be fetched`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.stopped) parts.push('stopped');
  return parts.join(' · ');
}
