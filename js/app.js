// Scale Model Garage — Stage 1 (quick-capture slice, D22). Screens: Garage list · Add (quick capture) · Item · Settings.
import * as store from './store.js';
import { blobs, meta, requestPersistentStorage, storageEstimate } from './idb.js';
import { preparePhoto, pickPhoto } from './images.js';
import { liveScan, scanPhoto } from './barcode.js';
import { codeCmp, barcodeCmp, gtinCheckOk, assignNamespace, duplicateCheckStatus, checkDuplicate } from './rules.js';
import { SHOT_ROLES, CONDITIONS, SCHEMA_VERSION } from './schema.js';
import { syncNow, isSyncing } from './sync.js';
import { getClientId, setClientId, hasToken, signIn, tokenMinutesLeft } from './google.js';
import { getConfig, seedLocal } from './setup.js';
import { newId } from './ids.js';

export const APP_VERSION = 's1-0.1.0';
const $ = (s, r = document) => r.querySelector(s);
const view = () => $('#view');

// ---------- small DOM helper (text only: never injects HTML from data) ----------
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
function toast(msg, ms = 1800) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), ms); }

// ---------- thumbnails ----------
const urlCache = new Map();
async function photoUrl(photo, prefer = 'thumb') {
  if (!photo) return null;
  for (const v of [prefer, 'thumb', 'display', 'original']) {
    const key = `${photo.photo_id}:${v}`;
    if (urlCache.has(key)) return urlCache.get(key);
    const b = await blobs.get(key);
    if (b) { const u = URL.createObjectURL(b); urlCache.set(key, u); return u; }
  }
  return null;
}

// ---------- reference data ----------
async function refData() {
  const [brands, lines, scales, categories] = await Promise.all(['brands', 'product_lines', 'scales', 'categories'].map(e => store.list(e)));
  scales.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  brands.sort((a, b) => a.name.localeCompare(b.name));
  return { brands, lines, scales, categories };
}
const recentBrands = () => JSON.parse(localStorage.getItem('smg.recentBrands') || '[]');
const pushRecentBrand = (id) => localStorage.setItem('smg.recentBrands', JSON.stringify([id, ...recentBrands().filter(x => x !== id)].slice(0, 5)));

// ---------- status bar ----------
async function refreshStatus() {
  const c = await store.counts();
  const pill = $('#status');
  let txt, cls;
  if (isSyncing()) { txt = 'Syncing…'; cls = 'info'; }
  else if (!navigator.onLine) { txt = c.pending ? `Offline · ${c.pending} waiting` : 'Offline'; cls = 'warn'; }
  else if (c.conflicts) { txt = `${c.conflicts} to review`; cls = 'bad'; }
  else if (c.pending) { txt = `${c.pending} to sync`; cls = 'warn'; }
  else { txt = 'All synced'; cls = 'ok'; }
  pill.textContent = txt; pill.style.color = `var(--${cls})`;
}

let lastSyncMsg = '';
async function runSync(interactive) {
  if (isSyncing()) return;
  const setMsg = (m) => { lastSyncMsg = m; const el = $('#syncMsg'); if (el) el.textContent = m; refreshStatus(); };
  try {
    const s = await syncNow({ interactive, progress: setMsg });
    setMsg(`Synced: ${s.photosUploaded} photo(s), ${s.rowsAppended} new row(s), ${s.rowsUpdated} update(s), ${s.pulled} pulled${s.conflicts ? `, ${s.conflicts} clash(es) to review` : ''}${s.errors.length ? `, ${s.errors.length} error(s) — will retry` : ''} · ${(s.ms / 1000).toFixed(1)} s`);
    if (interactive) toast(s.errors.length ? 'Synced with some errors' : 'Synced ✓');
  } catch (e) {
    setMsg(e.message);
    if (interactive) toast(e.message, 3500);
  }
  refreshStatus();
  if (location.hash.startsWith('#/item') || location.hash === '' || location.hash === '#/') route();
}
let autoTimer = null;
function autoSyncSoon() { clearTimeout(autoTimer); autoTimer = setTimeout(() => { if (navigator.onLine && hasToken()) runSync(false); }, 2500); }

// ---------- router ----------
let routeSeq = 0;
async function route() {
  const hash = location.hash || '#/';
  document.querySelectorAll('nav.bottom a').forEach(a => a.classList.toggle('on', hash.startsWith(a.getAttribute('href')) && (a.getAttribute('href') !== '#/' || hash === '#/')));
  // Render into a fresh container and swap it in only if no newer navigation started meanwhile
  // (prevents two overlapping renders from mixing their content).
  const token = ++routeSeq;
  const v = h('div');
  try {
    if (hash.startsWith('#/add')) await renderAdd(v);
    else if (hash.startsWith('#/item/')) await renderItem(v, decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('#/settings')) await renderSettings(v);
    else await renderGarage(v);
  } catch (e) {
    v.append(h('div', { class: 'banner bad' }, `Something went wrong: ${e.message}`));
    console.error(e);
  }
  if (token === routeSeq) view().replaceChildren(v);
  refreshStatus();
}

// =====================================================================
// Garage list
// =====================================================================
let garageFilter = 'all', garageSearch = '';
async function renderGarage(v) {
  const config = await getConfig();
  if (!getClientId() || !config) {
    v.append(h('div', { class: 'banner info' }, 'Welcome! Start in ', h('a', { href: '#/settings' }, 'Settings'), ': sign in with Google once, and the app sets up your SCALE GARAGE folder and sheet. You can also start capturing offline right away.'));
  }
  const [models, inventory, photos, ids, ref] = await Promise.all([store.listRecords('models'), store.list('inventory'), store.list('photos'), store.list('product_identifiers'), refData()]);
  const brandName = Object.fromEntries(ref.brands.map(b => [b.brand_id, b.name]));
  const scaleLabel = Object.fromEntries(ref.scales.map(s => [s.scale_id, s.label]));
  const active = models.filter(r => !r.data.deleted_at);
  const copies = inventory.filter(i => i.ownership_status === 'Owned');
  v.append(h('div', { class: 'row' }, h('h2', {}, 'My Garage'), h('div', { class: 'muted', style: 'text-align:right' }, `${active.length} models · ${copies.length} copies`)));
  const search = h('input', { type: 'search', placeholder: 'Search name, code, barcode, brand…', value: garageSearch, oninput: (e) => { garageSearch = e.target.value; draw(); } });
  v.append(search);
  const filters = [['all', 'All'], ['quick', 'Quick'], ['review', 'Needs review'], ['pending', 'Waiting to sync'], ['clash', 'Clashes']];
  const chips = h('div', { class: 'chips', style: 'margin:10px 0' }, filters.map(([k, label]) => h('button', { class: `chip ${garageFilter === k ? 'on' : ''}`, onclick: () => { garageFilter = k; route(); } }, label)));
  v.append(chips);
  const grid = h('div', { class: 'grid' });
  v.append(grid);
  const photosByModel = new Map();
  photos.forEach(p => { if (p.model_id) (photosByModel.get(p.model_id) || photosByModel.set(p.model_id, []).get(p.model_id)).push(p); });
  const barcodesByModel = new Map();
  ids.forEach(i => { if (i.identifier_type === 'barcode') (barcodesByModel.get(i.model_id) || barcodesByModel.set(i.model_id, []).get(i.model_id)).push(i.value_raw, i.value_cmp); });

  async function draw() {
    grid.replaceChildren();
    const q = garageSearch.trim().toLowerCase();
    let list = active.slice().sort((a, b) => String(b.data.created_at).localeCompare(String(a.data.created_at)));
    list = list.filter(r => {
      const m = r.data;
      if (garageFilter === 'quick' && m.completeness_status !== 'quick') return false;
      if (garageFilter === 'review' && m.namespace_status !== 'needs_review') return false;
      if (garageFilter === 'pending' && !r.dirty && !(photosByModel.get(m.model_id) || []).some(p => !p.original_file_id)) return false;
      if (garageFilter === 'clash' && !r.conflict) return false;
      if (!q) return true;
      const hay = [m.display_name, m.product_code, brandName[m.brand_id], m.printed_brand_text, ...(barcodesByModel.get(m.model_id) || [])].join(' ').toLowerCase();
      return hay.includes(q) || (q.replace(/\D/g, '').length >= 8 && hay.includes(barcodeCmp(q)));
    });
    if (!list.length) { grid.append(h('p', { class: 'muted' }, active.length ? 'Nothing matches.' : 'No models yet. Tap ＋ Add to catalogue your first box.')); return; }
    for (const r of list.slice(0, 300)) {
      const m = r.data;
      const ph = (photosByModel.get(m.model_id) || []).find(p => p.photo_id === m.primary_photo_id) || (photosByModel.get(m.model_id) || [])[0];
      const img = h('div', { class: 'ph' }, '📦');
      photoUrl(ph).then(u => { if (u) img.replaceChildren(h('img', { src: u, alt: '' })); });
      const nCopies = inventory.filter(i => i.model_id === m.model_id && i.ownership_status === 'Owned').length;
      const pendingPhotos = (photosByModel.get(m.model_id) || []).some(p => !p.original_file_id);
      grid.append(h('a', { class: 'tile', href: `#/item/${encodeURIComponent(m.model_id)}` }, img,
        h('div', { class: 'tx' },
          h('div', { class: 'nm' }, m.display_name || '(no name yet)'),
          h('div', { class: 'sub' }, [brandName[m.brand_id] || m.printed_brand_text || 'Brand?', scaleLabel[m.scale_id], m.product_code].filter(Boolean).join(' · ')),
          h('div', { class: 'badges' },
            m.completeness_status === 'quick' ? h('span', { class: 'b mute' }, 'Quick') : h('span', { class: 'b ok' }, 'Complete'),
            nCopies > 1 ? h('span', { class: 'b info' }, `${nCopies} copies`) : null,
            m.namespace_status === 'needs_review' ? h('span', { class: 'b warn' }, 'Needs review') : null,
            (r.dirty || pendingPhotos) ? h('span', { class: 'b warn' }, 'Waiting to sync') : null,
            r.lastError ? h('span', { class: 'b bad' }, 'Error') : null,
            r.conflict ? h('span', { class: 'b bad' }, 'Clash') : null))));
    }
    if (list.length > 300) grid.append(h('p', { class: 'muted' }, `Showing 300 of ${list.length}. Use search to narrow.`));
  }
  draw();
}

// =====================================================================
// Quick capture (D17.1, D19, D20)
// =====================================================================
let cap = null;
function freshCapture(keep = {}) {
  return { modelId: newId('models'), inventoryId: newId('inventory'), photos: {}, sealed: false, brandId: keep.brandId || '', scaleId: keep.scaleId || '', barcode: null, name: '', code: '', count: keep.count || 0, startedAt: Date.now() };
}

async function renderAdd(v) {
  if (!cap) cap = freshCapture({ scaleId: localStorage.getItem('smg.lastScale') || '', brandId: recentBrands()[0] || '' });
  const ref = await refData();
  const [models, ids] = await Promise.all([store.list('models'), store.list('product_identifiers')]);
  v.append(h('div', { class: 'row' }, h('h2', {}, 'Quick capture'), h('div', { class: 'muted', style: 'text-align:right' }, cap.count ? `${cap.count} saved this session` : 'Box by box')));

  // --- Photos ---
  v.append(h('h3', {}, 'Photos (phone camera)'));
  const shots = h('div', { class: 'shots' });
  const roles = ['box_front', 'box_rear', ...(cap.sealed ? ['box_art'] : [])];
  for (const role of roles) {
    const p = cap.photos[role];
    const tile = h('button', { class: `shot ${p ? 'done' : ''} ${role !== 'box_art' ? 'req' : ''}`, type: 'button', onclick: () => takePhoto(role) },
      p?.url ? h('img', { src: p.url, alt: '' }) : h('span', {}, '📷', h('br'), SHOT_ROLES[role].label),
      p ? h('span', { class: 'tag' }, `${SHOT_ROLES[role].label} ✓`) : null);
    shots.append(tile);
  }
  if (roles.length < 3) shots.append(h('div', {}));
  v.append(shots);
  v.append(h('label', { class: 'row', style: 'margin-top:8px;font-weight:600' },
    h('input', { type: 'checkbox', checked: cap.sealed, style: 'width:auto;min-height:auto;flex:0', onchange: (e) => { cap.sealed = e.target.checked; route(); } }),
    h('span', {}, 'Sealed box — car can\'t be seen (adds a box-art photo)')));
  const busy = h('p', { class: 'muted', id: 'capBusy' });
  v.append(busy);

  // --- Brand ---
  v.append(h('label', { class: 'f' }, 'Brand'));
  const recent = recentBrands().map(id => ref.brands.find(b => b.brand_id === id)).filter(Boolean);
  if (recent.length) v.append(h('div', { class: 'chips', style: 'margin-bottom:6px' }, recent.map(b => h('button', { type: 'button', class: `chip ${cap.brandId === b.brand_id ? 'on' : ''}`, onclick: () => { cap.brandId = b.brand_id; route(); } }, b.name))));
  const brandSel = h('select', { onchange: async (e) => {
    if (e.target.value === '__new') {
      const name = (prompt('New brand name (as printed on the box):') || '').trim();
      if (name) {
        const existing = ref.brands.find(b => b.name.toLowerCase() === name.toLowerCase());
        cap.brandId = existing ? existing.brand_id : (await store.create('brands', { name, brand_kind: 'miniature', is_code_namespace: 'yes', record_status: 'needs_review' })).brand_id;
      }
    } else cap.brandId = e.target.value;
    route();
  } }, h('option', { value: '' }, '— choose brand —'), ref.brands.map(b => h('option', { value: b.brand_id, selected: b.brand_id === cap.brandId ? true : undefined }, b.name + (b.record_status === 'needs_review' ? ' (needs review)' : ''))), h('option', { value: '__new' }, '＋ Add a new brand…'));
  v.append(brandSel);

  // --- Scale ---
  v.append(h('label', { class: 'f' }, 'Scale'));
  const main = ['1:64', '1:43', '1:18', '1:12'];
  const scaleChips = h('div', { class: 'chips' }, ref.scales.filter(s => main.includes(s.label)).map(s => h('button', { type: 'button', class: `chip ${cap.scaleId === s.scale_id ? 'on' : ''}`, onclick: () => { cap.scaleId = s.scale_id; localStorage.setItem('smg.lastScale', s.scale_id); route(); } }, s.label)));
  const more = h('select', { style: 'flex:1;min-width:140px', onchange: (e) => { if (e.target.value) { cap.scaleId = e.target.value; localStorage.setItem('smg.lastScale', e.target.value); route(); } } },
    h('option', { value: '' }, 'Other scale…'), ref.scales.filter(s => !main.includes(s.label)).map(s => h('option', { value: s.scale_id, selected: s.scale_id === cap.scaleId ? true : undefined }, s.label)));
  scaleChips.append(more);
  v.append(scaleChips);

  // --- Barcode ---
  v.append(h('label', { class: 'f' }, 'Barcode (if the box has one)'));
  const bcInfo = h('div', { class: 'muted' });
  const bcInput = h('input', { inputmode: 'numeric', placeholder: 'Scan, or type the digits', value: cap.barcode?.raw || '', oninput: (e) => { setBarcode(e.target.value, 'typed', ''); updateBc(); updateDup(); } });
  const video = h('video', { class: 'scan hide', playsinline: true, muted: true });
  const scanBtn = h('button', { type: 'button', class: 'quiet', onclick: () => doLiveScan() }, '▦ Scan barcode');
  const photoBtn = h('button', { type: 'button', class: 'quiet hide', onclick: () => doPhotoScan() }, '📷 Take photo instead');
  v.append(h('div', { class: 'row' }, scanBtn, photoBtn), video, bcInput, bcInfo);
  function setBarcode(raw, source, format) {
    raw = String(raw || '').trim();
    cap.barcode = raw ? { raw, cmp: barcodeCmp(raw), format, source, checkOk: gtinCheckOk(raw) } : null;
  }
  function updateBc() {
    const b = cap.barcode;
    if (!b) { bcInfo.textContent = ''; return; }
    if (b.source === 'typed' && b.checkOk === false) { bcInfo.textContent = '⚠ These digits don\'t add up (check digit). Please re-check, or scan instead.'; bcInfo.style.color = 'var(--warn)'; }
    else { bcInfo.textContent = b.source === 'scan' ? `✓ Scanned ${b.format || ''}` : (b.checkOk ? '✓ Check digit OK' : ''); bcInfo.style.color = 'var(--ok)'; }
  }
  updateBc();
  async function doLiveScan() {
    video.classList.remove('hide'); scanBtn.disabled = true; photoBtn.classList.add('hide');
    try {
      const r = await liveScan(video, { timeoutMs: 5000, onTick: (ms) => { bcInfo.style.color = 'var(--muted)'; bcInfo.textContent = `Scanning… ${Math.ceil((5000 - ms) / 1000)} s`; } });
      if (r) { setBarcode(r.value, 'scan', r.format); bcInput.value = r.value; updateBc(); updateDup(); }
      else { bcInfo.style.color = 'var(--warn)'; bcInfo.textContent = 'Not read. Tilt to avoid glare and try again, or take a photo instead.'; photoBtn.classList.remove('hide'); }
    } catch (e) { bcInfo.style.color = 'var(--bad)'; bcInfo.textContent = `Camera problem: ${e.message}`; photoBtn.classList.remove('hide'); }
    video.classList.add('hide'); scanBtn.disabled = false;
  }
  async function doPhotoScan() {
    const [f] = await pickPhoto({ camera: true });
    if (!f) return;
    bcInfo.textContent = 'Reading…';
    try {
      const r = await scanPhoto(f);
      if (r) { setBarcode(r.value, 'scan', r.format); bcInput.value = r.value; updateBc(); updateDup(); }
      else { bcInfo.style.color = 'var(--warn)'; bcInfo.textContent = 'No barcode found in the photo. You can type the digits.'; }
    } catch (e) { bcInfo.textContent = e.message; }
  }

  // --- Name ---
  v.append(h('label', { class: 'f' }, 'Name'));
  v.append(h('input', { placeholder: 'e.g. Range Rover 1981 Camel Trophy', value: cap.name, oninput: (e) => { cap.name = e.target.value; updateDup(); } }));

  // --- Product code (optional) ---
  const brand = ref.brands.find(b => b.brand_id === cap.brandId);
  v.append(h('label', { class: 'f' }, 'Product code (optional)'));
  v.append(h('input', { placeholder: brand?.code_example ? `e.g. ${brand.code_example}` : 'Exactly as printed', value: cap.code, autocapitalize: 'characters', oninput: (e) => { cap.code = e.target.value; codeWarn(); updateDup(); } }));
  const cw = h('div', { class: 'muted' });
  v.append(cw);
  function codeWarn() {
    const c = cap.code.trim();
    cw.textContent = /O/i.test(c) && /\d/.test(c) && brand?.code_example && !/O/i.test(brand.code_example) ? '⚠ Contains the letter O — did you mean the digit 0?' : (brand?.code_pattern_hint ? `Format: ${brand.code_pattern_hint}` : 'Without a code, duplicates can\'t be checked yet.');
    cw.style.color = cw.textContent.startsWith('⚠') ? 'var(--warn)' : 'var(--muted)';
  }
  codeWarn();

  // --- Duplicate check ---
  const dupBox = h('div', {});
  v.append(dupBox);
  async function updateDup() {
    const ns = assignNamespace(brand, null);
    const candidate = { model_id: cap.modelId, brand_id: cap.brandId, code_namespace_id: ns.id, namespace_status: ns.status, product_code: cap.code, display_name: cap.name };
    const r = checkDuplicate(candidate, models, ids, cap.barcode ? [cap.barcode.cmp] : []);
    dupBox.replaceChildren();
    if (r.status === 'duplicate') {
      const m = r.exact[0];
      const inv = await store.list('inventory');
      const n = inv.filter(i => i.model_id === m.model_id && i.ownership_status === 'Owned').length;
      const photos = (await store.list('photos')).filter(p => p.model_id === m.model_id);
      const img = h('img', { alt: '' });
      photoUrl(photos.find(p => p.photo_id === m.primary_photo_id) || photos[0]).then(u => { if (u) img.src = u; });
      dupBox.append(h('div', { class: 'banner bad' }, `✅ You already own this (${n} cop${n === 1 ? 'y' : 'ies'}).`,
        h('div', { class: 'dup' }, img, h('div', {}, h('div', {}, m.display_name || m.product_code), h('div', { class: 'muted' }, m.product_code))),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { type: 'button', onclick: () => saveCopyOf(m) }, 'Add as another copy'),
          h('a', { class: 'btn ghost', href: `#/item/${encodeURIComponent(m.model_id)}`, style: 'text-align:center;text-decoration:none' }, 'Open it'))));
    } else if (r.possible.length) {
      dupBox.append(h('div', { class: 'banner warn' }, `🟡 Possible match${r.possible.length > 1 ? 'es' : ''} (not confirmed):`,
        r.possible.slice(0, 3).map(p => h('div', { class: 'muted' }, `• ${p.model.display_name || p.model.product_code || '(no name)'} — ${p.reason}`))));
    } else if (r.status === 'no_match') {
      dupBox.append(h('div', { class: 'banner ok' }, '❌ Not in your garage yet.'));
    } else if (cap.code.trim() || cap.barcode) {
      dupBox.append(h('div', { class: 'muted', style: 'margin-top:8px' }, r.status === 'needs_review' ? 'Brand needs review, so this can\'t be confirmed as a duplicate.' : 'Not checkable yet (needs a brand and product code).'));
    }
  }
  updateDup();

  // --- Save ---
  const missing = [!cap.photos.box_front && 'box front photo', !cap.photos.box_rear && 'box rear photo', !cap.brandId && 'brand', !cap.scaleId && 'scale'].filter(Boolean);
  v.append(h('div', { class: 'muted', style: 'margin-top:14px' }, missing.length ? `Still needed: ${missing.join(', ')}.` : 'Ready to save.'));
  v.append(h('button', { class: 'wide', style: 'margin-top:8px', disabled: missing.length ? true : undefined, onclick: () => saveCapture() }, 'Save & next box'));
  v.append(h('button', { class: 'wide ghost', style: 'margin-top:8px', onclick: () => { if (confirm('Discard this box?')) { cap = freshCapture({ brandId: cap.brandId, scaleId: cap.scaleId, count: cap.count }); route(); } } }, 'Discard'));

  async function takePhoto(role) {
    const [f] = await pickPhoto({ camera: true });
    if (!f) return;
    busy.textContent = 'Preparing photo…';
    try {
      const prep = await preparePhoto(f);
      const old = cap.photos[role]; if (old?.url) URL.revokeObjectURL(old.url);
      cap.photos[role] = { photoId: newId('photos'), prep, url: URL.createObjectURL(prep.thumb), capturedAt: new Date().toISOString() };
    } catch (e) { busy.textContent = `Could not read that photo: ${e.message}`; return; }
    route();
  }
}

async function savePhotoRecords(modelId, photos) {
  const items = [];
  for (const [role, p] of Object.entries(photos)) {
    await blobs.put(`${p.photoId}:original`, p.prep.original);
    await blobs.put(`${p.photoId}:display`, p.prep.display);
    await blobs.put(`${p.photoId}:thumb`, p.prep.thumb);
    items.push({ entity: 'photos', fields: { photo_id: p.photoId, model_id: modelId, shot_role: role, photo_type: SHOT_ROLES[role].type,
      original_bytes: String(p.prep.original_bytes), original_md5: p.prep.md5, width: String(p.prep.width), height: String(p.prep.height),
      exif_orientation: String(p.prep.exif_orientation), original_has_location: p.prep.original_has_location, is_primary: role === 'box_front' ? 'yes' : 'no',
      source: 'camera', original_filename: p.prep.original_filename, captured_at: p.capturedAt, ai_processed: 'no' } });
  }
  return items;
}

async function saveCapture() {
  const ref = await refData();
  const brand = ref.brands.find(b => b.brand_id === cap.brandId);
  const ns = assignNamespace(brand, null);
  const model = { model_id: cap.modelId, brand_id: cap.brandId, printed_brand_text: brand?.name || '', code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status,
    product_code: cap.code.trim(), product_code_cmp: codeCmp(cap.code), display_name: cap.name.trim(), scale_id: cap.scaleId,
    category_id: ref.categories.find(c => c.name === 'Cars')?.category_id || '', identification_status: 'unidentified', completeness_status: 'quick',
    primary_photo_id: cap.photos.box_front?.photoId || '' };
  model.duplicate_check_status = duplicateCheckStatus(model);
  const items = [{ entity: 'models', fields: model },
    { entity: 'inventory', fields: { inventory_id: cap.inventoryId, model_id: cap.modelId, ownership_status: 'Owned', packaging_state: cap.sealed ? 'sealed' : 'unknown', acquisition_type: 'Unknown', purchase_date_precision: 'unknown', currency: 'INR' } },
    ...(await savePhotoRecords(cap.modelId, cap.photos))];
  if (cap.barcode) items.push({ entity: 'product_identifiers', fields: { model_id: cap.modelId, identifier_type: 'barcode', value_raw: cap.barcode.raw, value_cmp: cap.barcode.cmp, barcode_format: cap.barcode.format || '', check_digit_ok: cap.barcode.checkOk === null ? '' : (cap.barcode.checkOk ? 'yes' : 'no'), source: cap.barcode.source } });
  await store.createMany(items);
  pushRecentBrand(cap.brandId);
  const secs = Math.round((Date.now() - cap.startedAt) / 1000);
  logTiming(secs);
  cap = freshCapture({ brandId: cap.brandId, scaleId: cap.scaleId, count: cap.count + 1 });
  toast(`Saved ✓ (${secs} s) — next box`);
  window.scrollTo(0, 0);
  route();
  autoSyncSoon();
}

async function saveCopyOf(m) {
  await store.createMany([{ entity: 'inventory', fields: { inventory_id: cap.inventoryId, model_id: m.model_id, ownership_status: 'Owned', packaging_state: cap.sealed ? 'sealed' : 'unknown', acquisition_type: 'Unknown', purchase_date_precision: 'unknown', currency: 'INR' } },
    ...(await savePhotoRecords(m.model_id, Object.fromEntries(Object.entries(cap.photos).map(([r, p]) => [r === 'box_front' ? 'box_front' : r, p]))))
      .map(it => ({ ...it, fields: { ...it.fields, inventory_id: cap.inventoryId, is_primary: 'no' } }))]);
  cap = freshCapture({ brandId: cap.brandId, scaleId: cap.scaleId, count: cap.count + 1 });
  toast('Added as another copy ✓');
  route(); autoSyncSoon();
}

async function logTiming(secs) {
  const t = await meta.get('captureTimes', []);
  t.push(secs); await meta.set('captureTimes', t.slice(-500));
}

// =====================================================================
// Item details (add details later, D17)
// =====================================================================
async function renderItem(v, modelId) {
  const rec = await store.getRecord('models', modelId);
  if (!rec) { v.append(h('p', {}, 'Not found.'), h('a', { href: '#/' }, '← Garage')); return; }
  const m = rec.data;
  const ref = await refData();
  const inv = (await store.list('inventory')).filter(i => i.model_id === modelId);
  const photos = (await store.list('photos')).filter(p => p.model_id === modelId);
  const idfs = (await store.list('product_identifiers')).filter(i => i.model_id === modelId);
  v.append(h('a', { href: '#/' }, '← Garage'));
  v.append(h('h2', {}, m.display_name || '(no name yet)'));
  if (rec.conflict) renderConflict(v, rec);
  if (rec.lastError) v.append(h('div', { class: 'banner bad' }, `Last sync error: ${rec.lastError}`));

  const gal = h('div', { class: 'gallery' });
  for (const p of photos.sort((a, b) => Object.keys(SHOT_ROLES).indexOf(a.shot_role) - Object.keys(SHOT_ROLES).indexOf(b.shot_role))) {
    const img = h('img', { alt: '' });
    photoUrl(p, 'display').then(u => { if (u) img.src = u; });
    gal.append(h('figure', {}, img, h('figcaption', {}, `${SHOT_ROLES[p.shot_role]?.label || p.shot_role}${p.original_file_id ? '' : ' · waiting'}`)));
  }
  v.append(gal);
  const roleSel = h('select', { style: 'flex:2' }, Object.entries(SHOT_ROLES).map(([k, r]) => h('option', { value: k }, r.label)));
  v.append(h('div', { class: 'row', style: 'margin-top:8px' }, roleSel, h('button', { class: 'quiet', style: 'flex:1', onclick: async () => {
    const [f] = await pickPhoto({ camera: true }); if (!f) return;
    const prep = await preparePhoto(f);
    const role = roleSel.value; const photoId = newId('photos');
    const items = await savePhotoRecords(modelId, { [role]: { photoId, prep, capturedAt: new Date().toISOString() } });
    items[0].fields.is_primary = 'no';
    await store.createMany(items);
    toast('Photo added'); route(); autoSyncSoon();
  } }, '＋ Photo')));

  // Editable product fields
  const f = { display_name: m.display_name, brand_id: m.brand_id, scale_id: m.scale_id, product_code: m.product_code, variant: m.variant, series: m.series, notes: m.notes };
  const form = h('div', { class: 'card' }, h('h3', {}, 'Product'));
  const field = (label, el) => form.append(h('label', { class: 'f' }, label), el);
  field('Name', h('input', { value: f.display_name, oninput: e => f.display_name = e.target.value }));
  field('Brand', h('select', { onchange: e => f.brand_id = e.target.value }, h('option', { value: '' }, '—'), ref.brands.map(b => h('option', { value: b.brand_id, selected: b.brand_id === f.brand_id ? true : undefined }, b.name + (b.record_status === 'needs_review' ? ' (needs review)' : '')))));
  field('Scale', h('select', { onchange: e => f.scale_id = e.target.value }, h('option', { value: '' }, '—'), ref.scales.map(s => h('option', { value: s.scale_id, selected: s.scale_id === f.scale_id ? true : undefined }, s.label))));
  field('Product code (exactly as printed)', h('input', { value: f.product_code, autocapitalize: 'characters', oninput: e => f.product_code = e.target.value }));
  field('Variant / colour', h('input', { value: f.variant, oninput: e => f.variant = e.target.value }));
  field('Series', h('input', { value: f.series, oninput: e => f.series = e.target.value }));
  field('Notes', h('textarea', { oninput: e => f.notes = e.target.value }, f.notes || ''));
  if (idfs.length) form.append(h('p', { class: 'muted' }, `Barcode: ${idfs.filter(i => i.identifier_type === 'barcode').map(i => i.value_raw).join(', ')}`));
  form.append(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { onclick: async () => {
      const brand = ref.brands.find(b => b.brand_id === f.brand_id);
      const ns = assignNamespace(brand, null);
      const patch = { ...f, product_code: f.product_code.trim(), product_code_cmp: codeCmp(f.product_code), printed_brand_text: m.printed_brand_text || brand?.name || '',
        code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status };
      patch.duplicate_check_status = duplicateCheckStatus(patch);
      for (const k of ['brand_id', 'product_code']) if (String(m[k] || '') !== String(patch[k] || '')) await store.logChange('models', modelId, k, m[k], patch[k], 'edited in app');
      await store.update('models', modelId, patch); toast('Saved'); route(); autoSyncSoon();
    } }, 'Save'),
    h('button', { class: m.completeness_status === 'complete' ? 'quiet' : 'ghost', onclick: async () => { await store.update('models', modelId, { completeness_status: m.completeness_status === 'complete' ? 'quick' : 'complete' }); route(); autoSyncSoon(); } }, m.completeness_status === 'complete' ? 'Mark as quick' : 'Mark complete')));
  v.append(form);

  // Copies (physical)
  for (const [idx, c] of inv.entries()) {
    const cf = { ownership_status: c.ownership_status, packaging_state: c.packaging_state, condition: c.condition, packaging_condition: c.packaging_condition, storage_location: c.storage_location, purchase_price: c.purchase_price, purchase_date: c.purchase_date, purchase_source: c.purchase_source };
    const card = h('div', { class: 'card' }, h('h3', {}, `Copy ${idx + 1}${inv.length > 1 ? ` of ${inv.length}` : ''}`));
    const add = (label, el) => card.append(h('label', { class: 'f' }, label), el);
    const sel = (key, opts) => h('select', { onchange: e => cf[key] = e.target.value }, h('option', { value: '' }, '— unknown —'), opts.map(o => h('option', { value: o, selected: o === cf[key] ? true : undefined }, o)));
    add('Status', sel('ownership_status', ['Owned', 'Sold', 'Gifted', 'Traded', 'Missing']));
    add('Box', sel('packaging_state', ['sealed', 'opened', 'loose']));
    add('Condition', sel('condition', CONDITIONS));
    add('Box condition', sel('packaging_condition', CONDITIONS));
    add('Where it is stored', h('input', { value: cf.storage_location, placeholder: 'e.g. Cabinet 2, shelf 3', oninput: e => cf.storage_location = e.target.value }));
    add('Price paid (₹) — leave empty if unknown', h('input', { inputmode: 'decimal', value: cf.purchase_price, placeholder: 'Unknown', oninput: e => cf.purchase_price = e.target.value }));
    add('Date bought — leave empty if unknown', h('input', { type: 'date', value: cf.purchase_date, oninput: e => cf.purchase_date = e.target.value }));
    add('Bought from', h('input', { value: cf.purchase_source, oninput: e => cf.purchase_source = e.target.value }));
    card.append(h('button', { style: 'margin-top:12px', onclick: async () => {
      const price = String(cf.purchase_price || '').replace(/[^\d.]/g, '');
      if (cf.purchase_price && price === '') { toast('Price must be a number (or empty for unknown)'); return; }
      await store.update('inventory', c.inventory_id, { ...cf, purchase_price: price, purchase_date_precision: cf.purchase_date ? 'day' : 'unknown', acquisition_type: price ? 'Purchase' : c.acquisition_type });
      toast('Copy saved'); route(); autoSyncSoon();
    } }, 'Save copy'));
    v.append(card);
  }
  v.append(h('dl', { class: 'kv card' },
    h('dt', {}, 'Duplicate check'), h('dd', {}, { checkable: 'Checkable', not_checkable: 'Not checkable yet (no code)', needs_review: 'Brand needs review' }[m.duplicate_check_status] || m.duplicate_check_status),
    h('dt', {}, 'Added'), h('dd', {}, new Date(m.created_at).toLocaleString()),
    h('dt', {}, 'Sync'), h('dd', {}, rec.dirty ? 'Waiting to sync' : 'Synced'),
    h('dt', {}, 'ID'), h('dd', { class: 'muted' }, m.model_id)));
  v.append(h('button', { class: 'ghost wide', onclick: async () => { if (confirm('Archive this model? (It is hidden, never deleted.)')) { await store.archive('models', modelId); location.hash = '#/'; autoSyncSoon(); } } }, 'Archive'));
}

function renderConflict(v, rec) {
  const c = rec.conflict;
  const box = h('div', { class: 'banner bad' }, '⚠ Changed on another device too. Pick which value to keep:');
  for (const f of c.fields) {
    box.append(h('div', { style: 'margin-top:8px' }, h('b', {}, f), h('div', { class: 'row' },
      h('button', { class: 'small quiet', onclick: () => resolve(f, c.local[f]) }, `This phone: ${c.local[f] || '(empty)'}`),
      h('button', { class: 'small quiet', onclick: () => resolve(f, c.remote[f]) }, `Sheet: ${c.remote[f] || '(empty)'}`))));
  }
  v.append(box);
  async function resolve(field, value) {
    const fresh = await store.getRecord(rec.entity, rec.id);
    const remaining = fresh.conflict.fields.filter(x => x !== field);
    // Accept the Sheet's newer version as the new base so the next sync writes cleanly.
    const base = { ...(fresh.sync?.base || {}), ...fresh.conflict.remote, version: String(fresh.conflict.remoteVersion) };
    await store.update(rec.entity, rec.id, { [field]: value }, { local: { conflict: remaining.length ? { ...fresh.conflict, fields: remaining } : undefined, sync: { base } } });
    await store.logChange(rec.entity, rec.id, field, fresh.conflict.local[field], value, 'clash resolved by B');
    route(); autoSyncSoon();
  }
}

// =====================================================================
// Settings
// =====================================================================
async function renderSettings(v) {
  v.append(h('h2', {}, 'Settings'));
  const config = await getConfig();
  const last = await meta.get('lastSync', null);
  const c = await store.counts();

  const acct = h('div', { class: 'card' }, h('h3', {}, 'Google account'));
  const cid = h('input', { value: getClientId(), placeholder: 'OAuth Client ID (….apps.googleusercontent.com)' });
  acct.append(h('label', { class: 'f' }, 'Google Client ID (saved on this phone only)'), cid,
    h('p', { class: 'muted' }, getClientId() ? 'Found the Client ID saved by the test kit on this phone ✓' : 'Paste the Client ID from your Google Cloud project (same one the test kit used).'),
    h('div', { class: 'row' },
      h('button', { onclick: async () => { if (cid.value.trim()) setClientId(cid.value); try { await signIn(); toast('Signed in'); await runSync(true); } catch (e) { toast(e.message, 4000); } route(); } }, hasToken() ? 'Sync now' : 'Sign in & set up'),
    ),
    h('p', { class: 'muted' }, hasToken() ? `Signed in (${tokenMinutesLeft()} min left; renews on sync).` : 'Not signed in. You can still capture offline.'));
  v.append(acct);

  const sync = h('div', { class: 'card' }, h('h3', {}, 'Sync'),
    h('p', {}, `${c.pending} change(s) waiting · ${c.photosPending} photo(s) not uploaded yet${c.conflicts ? ` · ${c.conflicts} clash(es)` : ''}`),
    h('p', { class: 'muted', id: 'syncMsg' }, lastSyncMsg || (last ? `Last sync ${new Date(last.finishedAt).toLocaleString()} · ${last.errors.length ? last.errors.length + ' error(s)' : 'no errors'}` : 'Never synced.')),
    last?.errors?.length ? h('details', {}, h('summary', {}, 'Show errors'), h('pre', { style: 'white-space:pre-wrap;font-size:.8rem' }, last.errors.join('\n'))) : null,
    h('button', { onclick: () => runSync(true) }, 'Sync now'));
  v.append(sync);

  const where = h('div', { class: 'card' }, h('h3', {}, 'Your data'),
    config?.workbookId ? h('p', {}, h('a', { href: `https://docs.google.com/spreadsheets/d/${config.workbookId}`, target: '_blank', rel: 'noopener' }, 'Open SCALE_GARAGE_MASTER sheet ↗')) : h('p', { class: 'muted' }, 'Not set up yet — sign in above.'),
    config?.rootId ? h('p', {}, h('a', { href: `https://drive.google.com/drive/folders/${config.rootId}`, target: '_blank', rel: 'noopener' }, 'Open SCALE GARAGE folder ↗')) : null);
  v.append(where);

  const est = await storageEstimate();
  const persisted = await (navigator.storage?.persisted?.() ?? Promise.resolve(false));
  const times = await meta.get('captureTimes', []);
  const median = times.length ? times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)] : null;
  v.append(h('div', { class: 'card' }, h('h3', {}, 'This phone'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Storage used'), h('dd', {}, est ? `${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1073741824).toFixed(1)} GB` : '—'),
      h('dt', {}, 'Protected storage'), h('dd', {}, persisted ? 'Yes ✓' : 'No'),
      h('dt', {}, 'Capture time'), h('dd', {}, median ? `median ${median} s per box (${times.length} boxes)` : '—'),
      h('dt', {}, 'App version'), h('dd', {}, APP_VERSION),
      h('dt', {}, 'Schema version'), h('dd', {}, String(SCHEMA_VERSION))),
    persisted ? null : h('button', { class: 'quiet', style: 'margin-top:8px', onclick: async () => { const ok = await requestPersistentStorage(); toast(ok ? 'Storage protected ✓' : 'Chrome said no (try after installing the app)'); route(); } }, 'Protect storage on this phone')));
}

// ---------- start ----------
async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  requestPersistentStorage();
  await seedLocal();
  $('#syncBtn').addEventListener('click', () => runSync(true));
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { refreshStatus(); autoSyncSoon(); });
  window.addEventListener('offline', refreshStatus);
  store.onChange(refreshStatus);
  window.addEventListener('beforeunload', (e) => { if (cap && Object.keys(cap.photos).length) { e.preventDefault(); e.returnValue = ''; } });
  await route();
}
start();
