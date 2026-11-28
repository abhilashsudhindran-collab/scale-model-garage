// Helper mode (D32, helper-mode-plan.md): one other person helps catalogue the backlog on their OWN phone.
// No sign-in, no sync: B gives them a LOOKUP file (what B owns, no money), they catalogue offline, and send
// back one INBOX file per storage box. B imports it with a review step; nothing enters B's garage without B's tap.
// Pure functions (no browser storage or screens) so they can be unit-tested.
import { codeCmp, assignNamespace, duplicateCheckStatus, checkDuplicate } from './rules.js';
import { normName } from './brands.js';

export const LOOKUP_KIND = 'smg-helper-lookup';
export const INBOX_KIND = 'smg-helper-inbox';
export const FORMAT = 1;

// ---------- reading our own ZIP files (stored entries, no compression, as written by export.js zip()) ----------
export function unzip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let end = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('This is not a ZIP file');
  const n = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const dec = new TextDecoder(), out = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged ZIP file');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error('This file was not made by the app (compressed ZIP)');
    const lName = dv.getUint16(local + 26, true), lExtra = dv.getUint16(local + 28, true);
    const start = local + 30 + lName + lExtra;
    out.push({ name, bytes: u8.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
export const fileText = (files, name) => { const f = files.find(x => x.name === name); return f ? new TextDecoder().decode(f.bytes) : null; };

// ---------- the LOOKUP file B makes ----------
// Only what a duplicate check and a box needs. Never: prices, purchases, orders, money events, AI log, change log,
// storage notes, car notes, wishlist, original photos (they hold the GPS location). Archived rows are left out.
const COMMON = ['created_at', 'updated_at', 'version', 'deleted_at'];
export const LOOKUP_FIELDS = {
  brands: ['brand_id', 'company_id', 'name', 'brand_kind', 'is_code_namespace', 'code_pattern_hint', 'code_example', 'record_status'],
  product_lines: ['line_id', 'brand_id', 'name', 'is_code_namespace', 'code_prefix_hint', 'record_status'],
  scales: ['scale_id', 'label', 'ratio_denominator', 'sort_order', 'active'],
  categories: ['category_id', 'name', 'parent_id', 'sort_order', 'active'],
  aliases: ['alias_id', 'alias_text', 'alias_cmp', 'target_type', 'target_id'],
  models: ['model_id', 'brand_id', 'line_id', 'printed_brand_text', 'code_namespace_type', 'code_namespace_id', 'namespace_status', 'product_code', 'product_code_cmp',
    'display_name', 'scale_id', 'category_id', 'variant', 'colour_family', 'colour_name', 'primary_photo_id', 'completeness_status', 'duplicate_check_status', 'barcode_absent', 'code_absent'],
  product_identifiers: ['identifier_id', 'model_id', 'identifier_type', 'value_raw', 'value_cmp', 'barcode_format', 'check_digit_ok'],
  inventory: ['inventory_id', 'model_id', 'ownership_status', 'storage_location', 'packaging_state'],
  storage_boxes: ['storage_box_id', 'box_label', 'box_name', 'box_size', 'box_brand', 'box_scale'],
  photos: ['photo_id', 'model_id', 'shot_role', 'photo_type', 'is_primary'],
};
export const LOOKUP_ENTITIES = Object.keys(LOOKUP_FIELDS);
const pick = (row, cols) => { const o = {}; for (const c of [...cols, ...COMMON]) o[c] = row[c] ?? ''; return o; };

// tables: { entity: [rows] } as stored on B's phone. Returns { tables, photoIds } — photoIds = box-front photos to include.
export function buildLookup(tables) {
  const live = (e) => (tables[e] || []).filter(r => !r.deleted_at);
  const models = live('models');
  const modelIds = new Set(models.map(m => m.model_id));
  const out = {};
  out.brands = live('brands').map(r => pick(r, LOOKUP_FIELDS.brands));
  out.product_lines = live('product_lines').map(r => pick(r, LOOKUP_FIELDS.product_lines));
  out.scales = live('scales').map(r => pick(r, LOOKUP_FIELDS.scales));
  out.categories = live('categories').map(r => pick(r, LOOKUP_FIELDS.categories));
  out.aliases = live('aliases').filter(a => a.target_type === 'brand').map(r => pick(r, LOOKUP_FIELDS.aliases));
  out.models = models.map(r => pick(r, LOOKUP_FIELDS.models));
  out.product_identifiers = live('product_identifiers').filter(i => modelIds.has(i.model_id)).map(r => pick(r, LOOKUP_FIELDS.product_identifiers));
  out.inventory = live('inventory').filter(i => modelIds.has(i.model_id) && (i.ownership_status || 'Owned') === 'Owned').map(r => pick(r, LOOKUP_FIELDS.inventory));
  out.storage_boxes = live('storage_boxes').map(r => pick(r, LOOKUP_FIELDS.storage_boxes));
  // One picture per car: its main box-front photo (the small preview, no location data)
  const photos = live('photos');
  const byId = new Map(photos.map(p => [p.photo_id, p]));
  const front = [];
  for (const m of models) {
    const p = byId.get(m.primary_photo_id) || photos.find(x => x.model_id === m.model_id && x.shot_role === 'box_front');
    if (p) front.push(p);
  }
  out.photos = front.map(r => pick(r, LOOKUP_FIELDS.photos));
  return { tables: out, photoIds: front.map(p => p.photo_id) };
}

// ---------- the helper's own work, per storage box ----------
// recs: every stored record on the helper's phone ({ entity, id, data, dirty, seed, lookup }).
// The helper's own rows are the changed ones that didn't come from B's lookup file or the app's starter lists.
export const isOwn = (r) => r.dirty && !r.lookup && !r.seed && !r.data.deleted_at;
const boxKey = (loc) => String(loc || '').trim();

export function helperBoxes(recs) {
  const own = recs.filter(isOwn);
  const by = new Map();
  for (const inv of own.filter(r => r.entity === 'inventory')) {
    const k = boxKey(inv.data.storage_location);
    const e = by.get(k) || { label: k, inventory: [], models: new Set() };
    e.inventory.push(inv); e.models.add(inv.data.model_id); by.set(k, e);
  }
  return [...by.values()].map(e => {
    const parts = boxRecords(recs, e.label);
    return { label: e.label, cars: parts.records.filter(r => r.entity === 'models').length, copies: e.inventory.length,
      photos: parts.photoIds.length, signature: parts.signature };
  }).sort((a, b) => (a.label === '' ? 1 : b.label === '' ? -1 : String(a.label).localeCompare(String(b.label), undefined, { numeric: true })));
}

// Everything the helper made for one box: cars, their copies, photos, barcodes, and any brand / line / box they added.
export function boxRecords(recs, label) {
  const own = recs.filter(isOwn);
  const want = boxKey(label);
  const inv = own.filter(r => r.entity === 'inventory' && boxKey(r.data.storage_location) === want);
  const invIds = new Set(inv.map(r => r.id));
  const modelIds = new Set(inv.map(r => r.data.model_id));
  const models = own.filter(r => r.entity === 'models' && modelIds.has(r.id));
  const ownModelIds = new Set(models.map(r => r.id));
  const photos = own.filter(r => r.entity === 'photos' && (invIds.has(r.data.inventory_id) || (ownModelIds.has(r.data.model_id) && !r.data.inventory_id)));
  const ids = own.filter(r => r.entity === 'product_identifiers' && ownModelIds.has(r.data.model_id));
  const brandIds = new Set(models.map(r => r.data.brand_id).filter(Boolean)), lineIds = new Set(models.map(r => r.data.line_id).filter(Boolean));
  const brands = own.filter(r => r.entity === 'brands' && brandIds.has(r.id));
  const lines = own.filter(r => r.entity === 'product_lines' && lineIds.has(r.id));
  const boxes = own.filter(r => r.entity === 'storage_boxes' && `Box ${String(r.data.box_label).trim()}` === want);
  const all = [...brands, ...lines, ...boxes, ...models, ...inv, ...ids, ...photos];
  const signature = all.map(r => `${r.entity}:${r.id}:${r.data.updated_at}`).sort().join('|');
  return { records: all.map(r => ({ entity: r.entity, data: r.data })), photoIds: photos.map(r => r.id), signature };
}

// ---------- B imports an inbox file ----------
// pkg: { manifest, records: [{entity, data}] }. live: B's tables { models, product_identifiers, inventory, brands, product_lines, storage_boxes, photos, aliases }.
// Returns { rows: [...one per car or copy], brands: [{helper, use|create}], lines, boxes } — nothing is changed.
export function planImport(pkg, live) {
  const recs = pkg.records || [];
  const of = (e) => recs.filter(r => r.entity === e).map(r => r.data);
  const has = (e, idCol) => new Set((live[e] || []).map(r => r[idCol]));
  const liveModels = (live.models || []).filter(m => !m.deleted_at);
  const liveModelIds = has('models', 'model_id'), liveInv = has('inventory', 'inventory_id');
  const liveBrands = (live.brands || []).filter(b => !b.deleted_at);
  const aliasTo = new Map((live.aliases || []).filter(a => a.target_type === 'brand' && !a.deleted_at).map(a => [a.alias_cmp, a.target_id]));

  // Brands the helper added: same name (or an old name kept as an alias) → B's brand; otherwise a new brand marked "needs review"
  const brandMap = new Map(), brandPlan = [];
  for (const b of of('brands')) {
    if (liveBrands.some(x => x.brand_id === b.brand_id)) { brandMap.set(b.brand_id, b.brand_id); continue; }
    const same = liveBrands.find(x => normName(x.name) === normName(b.name)) || liveBrands.find(x => x.brand_id === aliasTo.get(normName(b.name)));
    if (same) { brandMap.set(b.brand_id, same.brand_id); brandPlan.push({ name: b.name, use: same.name }); }
    else { brandMap.set(b.brand_id, b.brand_id); brandPlan.push({ name: b.name, create: true, data: { ...b, record_status: 'needs_review' } }); }
  }
  const brandOf = (id) => (id ? brandMap.get(id) || id : '');
  const brandRec = (id) => liveBrands.find(x => x.brand_id === id) || brandPlan.find(p => p.create && p.data.brand_id === id)?.data || null;

  const lineMap = new Map(), linePlan = [];
  for (const l of of('product_lines')) {
    const bid = brandOf(l.brand_id);
    const same = (live.product_lines || []).find(x => !x.deleted_at && (x.line_id === l.line_id || (x.brand_id === bid && normName(x.name) === normName(l.name))));
    if (same) lineMap.set(l.line_id, same.line_id);
    else { lineMap.set(l.line_id, l.line_id); linePlan.push({ name: l.name, data: { ...l, brand_id: bid, record_status: 'needs_review' } }); }
  }
  const liveBoxLabels = new Set((live.storage_boxes || []).filter(b => !b.deleted_at).map(b => String(b.box_label).trim().toLowerCase()));
  const boxPlan = of('storage_boxes').filter(b => !liveBoxLabels.has(String(b.box_label).trim().toLowerCase()));

  // A row whose ID already exists in B's garage is never written over (only brand-new rows are imported)
  const livePho = has('photos', 'photo_id'), liveIdf = has('product_identifiers', 'identifier_id');
  const models = of('models'), inventory = of('inventory');
  const photos = of('photos').filter(p => !livePho.has(p.photo_id)), ids = of('product_identifiers').filter(i => !liveIdf.has(i.identifier_id));
  const rows = [];
  for (const m0 of models) {
    const inv = inventory.filter(i => i.model_id === m0.model_id);
    const pics = photos.filter(p => p.model_id === m0.model_id);
    const bars = ids.filter(i => i.model_id === m0.model_id && i.identifier_type === 'barcode').map(i => i.value_cmp).filter(Boolean);
    const brand = brandRec(brandOf(m0.brand_id));
    const ns = assignNamespace(brand, null);
    const m = { ...m0, brand_id: brandOf(m0.brand_id), line_id: m0.line_id ? (lineMap.get(m0.line_id) || '') : '',
      code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status, product_code_cmp: codeCmp(m0.product_code) };
    m.duplicate_check_status = duplicateCheckStatus(m);
    const row = { kind: 'car', model: m, inventory: inv, photos: pics, identifiers: ids.filter(i => i.model_id === m0.model_id), box: inv[0]?.storage_location || '' };
    if (liveModelIds.has(m0.model_id) || (inv.length && inv.every(i => liveInv.has(i.inventory_id)))) { row.status = 'already'; row.choice = 'skip'; }
    else {
      row.inventory = inv.filter(i => !liveInv.has(i.inventory_id));
      const d = checkDuplicate(m, liveModels, live.product_identifiers || [], bars);
      row.dup = d;
      if (d.exact.length) { row.status = 'duplicate'; row.target = d.exact[0].model_id; row.choice = 'copy'; }
      else if (d.possible.length) { row.status = 'possible'; row.target = d.possible[0].model.model_id; row.choice = 'new'; }
      else { row.status = 'new'; row.choice = 'new'; }
    }
    rows.push(row);
  }
  // Copies of cars B already had ("same model: add as copy" or ＋1 on the helper's phone, against B's lookup)
  const pkgModelIds = new Set(models.map(m => m.model_id));
  for (const i of inventory.filter(x => !pkgModelIds.has(x.model_id))) {
    const row = { kind: 'copy', inventory: [i], photos: photos.filter(p => p.inventory_id === i.inventory_id), identifiers: [], box: i.storage_location || '', target: i.model_id };
    if (liveInv.has(i.inventory_id)) { row.status = 'already'; row.choice = 'skip'; }
    else if (!liveModels.some(m => m.model_id === i.model_id)) { row.status = 'missing'; row.choice = 'skip'; }
    else { row.status = 'copy'; row.choice = 'copy'; }
    rows.push(row);
  }
  return { rows, brands: brandPlan, lines: linePlan, boxes: boxPlan };
}

// Turns the plan + B's choices into the rows to store. choice per row: 'new' | 'copy' | 'skip' (row.target = the car to copy onto).
// Returns { records: [{entity, data}], photoIds: [ids whose files to store], cars, copies }.
export function applyPlan(plan) {
  const out = [], photoIds = [];
  let cars = 0, copies = 0;
  const used = plan.rows.filter(r => r.choice !== 'skip');
  // A new brand / line / box is added only when a car being imported uses it
  const brandsUsed = new Set(used.filter(r => r.choice === 'new').map(r => r.model.brand_id));
  for (const b of plan.brands) if (b.create && brandsUsed.has(b.data.brand_id)) out.push({ entity: 'brands', data: b.data });
  const linesUsed = new Set(used.filter(r => r.choice === 'new').map(r => r.model.line_id).filter(Boolean));
  for (const l of plan.lines) if (linesUsed.has(l.data.line_id)) out.push({ entity: 'product_lines', data: l.data });
  const boxesUsed = new Set(used.map(r => String(r.box).trim().toLowerCase()));
  for (const b of plan.boxes) if (boxesUsed.has(`box ${String(b.box_label).trim().toLowerCase()}`)) out.push({ entity: 'storage_boxes', data: b });
  for (const r of used) {
    if (r.choice === 'new' && r.kind === 'car') {
      cars++; copies += r.inventory.length;
      out.push({ entity: 'models', data: r.model });
      r.inventory.forEach(i => out.push({ entity: 'inventory', data: i }));
      r.identifiers.forEach(i => out.push({ entity: 'product_identifiers', data: i }));
      r.photos.forEach(p => { out.push({ entity: 'photos', data: p }); photoIds.push(p.photo_id); });
    } else if (r.choice === 'copy' && r.target) {
      // Another physical copy of B's car: its photos stay with this copy, never become the car's main photo
      copies += r.inventory.length;
      const firstInv = r.inventory[0]?.inventory_id || '';
      r.inventory.forEach(i => out.push({ entity: 'inventory', data: { ...i, model_id: r.target } }));
      r.photos.forEach(p => { out.push({ entity: 'photos', data: { ...p, model_id: r.target, inventory_id: p.inventory_id || firstInv, is_primary: 'no' } }); photoIds.push(p.photo_id); });
    }
  }
  return { records: out, photoIds, cars, copies };
}

// What a box file may carry, and only the columns the app knows. Drive file IDs are cleared so every photo is
// uploaded fresh to B's Drive (a box file can't point a record at some other file).
export const INBOX_ENTITIES = ['brands', 'product_lines', 'storage_boxes', 'models', 'inventory', 'product_identifiers', 'photos'];
const DRIVE_COLS = ['original_file_id', 'display_file_id', 'thumb_file_id', 'cropped_file_id', 'uploaded_at', 'crop_corners'];
export function cleanInboxRecord(r, columnsOf, isId) {
  if (!r || typeof r !== 'object' || !INBOX_ENTITIES.includes(r.entity) || !r.data || typeof r.data !== 'object') return null;
  const cols = columnsOf(r.entity);
  const data = {};
  for (const c of cols) { const v = r.data[c]; data[c] = v === null || v === undefined ? '' : (typeof v === 'object' ? '' : String(v)); }
  if (!isId(data[cols[0]])) return null;
  if (r.entity === 'photos') for (const c of DRIVE_COLS) data[c] = '';
  data.deleted_at = '';
  return { entity: r.entity, data };
}

// Photo files inside the inbox ZIP
export const PHOTO_VARIANTS = ['original', 'display', 'thumb'];
export const photoPath = (photoId, variant) => `photos/${photoId}-${variant}.jpg`;
