// Scale Model Garage — Stage 1 (quick-capture slice, D22). Screens: Garage list · Add (quick capture) · Item · Settings.
import * as store from './store.js';
import { blobs, meta, records, requestPersistentStorage, storageEstimate } from './idb.js';
import { preparePhoto, pickPhoto } from './images.js';
import { liveScan, scanPhoto } from './barcode.js';
import { codeCmp, barcodeCmp, gtinCheckOk, assignNamespace, duplicateCheckStatus, checkDuplicate, searchMatch } from './rules.js';
import { SHOT_ROLES, CONDITIONS, SCHEMA_VERSION, TABS, SYNCED_ENTITIES, headersFor } from './schema.js';
import { syncNow, isSyncing } from './sync.js';
import { getClientId, setClientId, hasToken, signIn, tokenMinutesLeft, drive } from './google.js';
import { getConfig, seedLocal } from './setup.js';
import { newId, isId } from './ids.js';
import { resolveName, moreBrands, KNOWN_BRANDS, looksLike, normName } from './brands.js';
import { COLOUR_FAMILIES, familyFrom, familyLabel, familySwatch } from './colours.js';
import { newTimer, touch, seconds, paceFromTimes } from './timing.js';
import { straighten, validQuad } from './crop.js';
import { toCsv, zip, collectionRows } from './export.js';
import { runAudit } from './audit.js';
import { growthSeries, decadeOf, tallyBy, share } from './insights.js';
import { PRIORITIES, priorityRank, ownedMatches, safeUrl, priceNum } from './wishlist.js';
import { healthScore, healthWord } from './health.js';
import { SORTS, sortCompare } from './sort.js';
import { buildReview } from './review.js';
import { suggestLine, cleanLineName } from './lines.js';
import { extractCodes, imagesOnly } from './share.js';
import { recheckTargets, runRecheck, recheckSummary } from './recheck.js';
import { EVENT_TYPES, DISPOSALS, eventLabel, copyMoney, splitByPrice, totals as moneyTotals, num as moneyNum } from './money.js';
import { driveIn, packed as packedMoment, checkMilestone, lightsHtml, motionOn } from './moments.js';
import { backupIfDue, backupNow, lastBackup, listBackups, restoreBackup } from './backup.js';
import { LOOKUP_KIND, INBOX_KIND, FORMAT as HELPER_FORMAT, LOOKUP_ENTITIES, buildLookup, helperBoxes, boxRecords, planImport, applyPlan, unzip, fileText, photoPath, PHOTO_VARIANTS, cleanInboxRecord } from './helper.js';
import { buildPrompt, parseAnswer, brandNote, noteParts, PROMPT_VERSION, MAX_BATCH, MAX_BATCH_COMBINED, COMBINED_SUFFIX } from './ai.js';

export const APP_VERSION = 's1-0.59.0';
const $ = (s, r = document) => r.querySelector(s);
const view = () => $('#view');
// Line icons instead of emoji (DV-0.1: no decorative clutter). Fixed markup, no user data.
const ICON = {
  edit: '<path d="M4 20h4l10.5-10.5-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  camera: '<path d="M4 8.5h3.2l1.8-2.5h6l1.8 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/>',
  car: '<path d="M3 15.5V12l2.2-4.5h13.6L21 12v3.5"/><path d="M3 15.5h18M6.5 18.5a1.5 1.5 0 1 0 0-.01M17.5 18.5a1.5 1.5 0 1 0 0-.01M5.5 11.5h13"/>',
};
function icon(name) { const sp = document.createElement('span'); sp.className = 'ico-in'; sp.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`; return sp; }
// Accent colour (DV-0.1): forest green, cobalt blue or burnt orange on a warm neutral base; B picks in Settings.
const ACCENTS = [['forest', 'Forest green', '#2f6a4f'], ['cobalt', 'Cobalt blue', '#2b55c9'], ['burnt', 'Burnt orange', '#b4521f']];
const applyAccent = () => { const a = localStorage.getItem('smg.accent') || 'forest'; document.documentElement.dataset.accent = ACCENTS.some(x => x[0] === a) ? a : 'forest'; };
applyAccent();

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
// kind: 'ok' (green, success) · 'warn' (amber, needs attention) · 'bad' (red, failed). Audit finding S3.
function toast(msg, ms = 1800, kind = 'ok') {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(t); setTimeout(() => t.remove(), kind === 'ok' ? ms : Math.max(ms, 3500));
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Numbered storage boxes (B, 24 Nov: models go into numbered see-through boxes). Stored on the
// physical copy as storage_location "Box 12"; B types only "12".
const boxLoc = (b) => (String(b || '').trim() ? `Box ${String(b).trim()}` : '');
const collectionEstimate = () => Number(localStorage.getItem('smg.collectionEstimate')) || 1000;

// ---------- thumbnails ----------
const urlCache = new Map();
async function photoUrl(photo, prefer = 'thumb') {
  if (!photo) return null;
  const order = photo.crop_corners ? (prefer === 'thumb' ? ['cropthumb', 'cropped'] : ['cropped', 'cropthumb']) : [];
  for (const v of [...order, prefer, 'thumb', 'display', 'original']) {
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
const forgetRecentBrand = (id) => localStorage.setItem('smg.recentBrands', JSON.stringify(recentBrands().filter(x => x !== id)));
// Quick-pick brands for a car: recent first, then the brands B owns most, then common ones. Up to 8.
// ---------- brand lists everywhere (B, 24 Nov: many brands, some with one model) ----------
// Every brand <select>: your brands A-Z, then "More brands" (well-known ones, created when picked), then "Type a new brand".
function brandOptions(all, selected, placeholder) {
  const more = moreBrands(all);
  return [h('option', { value: '' }, placeholder),
    ...all.map(b => h('option', { value: b.brand_id, selected: b.brand_id === selected ? true : undefined }, b.name + (b.record_status === 'needs_review' ? ' (needs review)' : ''))),
    more.length ? h('optgroup', { label: 'More brands' }, more.map(n => h('option', { value: 'known:' + n }, n))) : null,
    h('option', { value: '__new' }, '＋ Type a new brand…')].filter(Boolean);
}
// Turns a picked value into a brand_id, creating the brand when needed. A new brand is trusted at once (B's choice);
// a name that looks like one already stored asks "Did you mean …?" first, so one brand never gets two records.
async function pickedBrandId(value, all, sel = null) {
  if (!value) return '';
  if (!value.startsWith('known:') && value !== '__new') return value;
  const name = value === '__new' ? (prompt('New brand name, as printed on the box:') || '') : value.slice(6);
  // An old or merged brand name (kept as an alias on the Brands screen) means the brand it now points to
  const alias = (await store.list('aliases')).find(a => a.target_type === 'brand' && a.alias_cmp === normName(name) && all.some(x => x.brand_id === a.target_id));
  const r = alias ? { use: all.find(x => x.brand_id === alias.target_id) } : resolveName(name, all);
  let id = '', label = '';
  if (r.none) { if (sel) sel.value = ''; return ''; }
  if (r.use) { id = r.use.brand_id; label = r.use.name; }
  else if (r.ask && confirm(`Did you mean "${r.ask.name}"?\n\nOK = use ${r.ask.name}\nCancel = add "${r.name}" as a new brand`)) { id = r.ask.brand_id; label = r.ask.name; }
  else {
    label = r.create || r.name;
    id = (await store.create('brands', { name: label, brand_kind: 'miniature', is_code_namespace: 'yes', record_status: 'confirmed' })).brand_id;
    // History (B, 24 Nov): every new brand is logged, and goes to the front of the recent-brand shortcuts.
    await store.logChange('brands', id, 'name', '', label, value === '__new' ? 'brand added (typed)' : 'brand added (from More brands)');
    toast(`${label} added to your brands ✓`); autoSyncSoon();
  }
  pushRecentBrand(id);
  if (sel) { if (![...sel.options].some(o => o.value === id)) sel.append(h('option', { value: id }, label)); sel.value = id; }
  return id;
}
const COMMON_BRANDS = ['Hot Wheels', 'Mini GT', 'Tarmac Works', 'Bburago', 'Matchbox', 'Inno64', 'Pop Race', 'Kaido House'];
async function quickBrands(all) {
  const ms = await store.list('models');
  const used = tally(ms.filter(m => m.brand_id), m => m.brand_id).map(([id]) => id);
  const common = COMMON_BRANDS.map(n => all.find(b => b.name === n)?.brand_id).filter(Boolean);
  return [...new Set([...recentBrands(), ...used, ...common])].map(id => all.find(b => b.brand_id === id)).filter(Boolean).slice(0, 8);
}

// ---------- status bar ----------
// Header pill (audit S1, S2): counts boxes, and says plainly when a sign-in is needed. Tap = sync.
async function refreshStatus() {
  if (helperInfo) return refreshHelperStatus();
  const [c, p, config] = await Promise.all([store.counts(), store.pendingSummary(), getConfig()]);
  const pill = $('#status');
  const what = p.boxes ? plural(p.boxes, 'box', 'boxes') : (p.other ? 'changes' : '');
  let txt, cls;
  if (isSyncing()) { txt = 'Syncing…'; cls = 'info'; }
  else if (!navigator.onLine) { txt = what ? `Offline · ${what} waiting` : 'Offline'; cls = 'warn'; }
  else if (c.conflicts) { txt = `${c.conflicts} to review`; cls = 'bad'; }
  else if (what && !hasToken()) { txt = `Sign in to sync · ${what}`; cls = 'warn'; }
  else if (what) { txt = `${what} waiting`; cls = 'warn'; }
  else if (config) { txt = 'All synced'; cls = 'ok'; }
  else { txt = 'Nothing to sync'; cls = 'muted'; }
  pill.textContent = txt; pill.style.color = `var(--${cls})`;
  // Start lights (moments): fill while syncing, all green for a moment when done
  if (motionOn() && (isSyncing() || (cls === 'ok' && Date.now() - syncDoneAt < 1600))) {
    const lights = document.createElement('span'); lights.className = 'lights'; lights.setAttribute('aria-hidden', 'true');
    lights.innerHTML = lightsHtml(syncFrac, isSyncing() ? 'run' : 'done'); // fixed markup
    pill.prepend(lights);
  }
  pill.setAttribute('aria-label', `${txt}. Tap to sync.`);
  $('header.top').classList.toggle('compact', txt.length > 16); // e.g. "Sign in to sync · 3 boxes"
}

let lastSyncMsg = '', syncFrac = 0, syncDoneAt = 0;
let colourOpenFor = null; // car page: the model whose colour picker is open
let moveBoxFor = null; // car page: the model whose "Move box" panel is open
// Sync button state (B, 24 Nov): greyed out with "Syncing…" while a sync runs.
// Button look rule (B, 24 Nov 23:10): greyed = can't work now (syncing, offline); quiet = works but not needed
// (all synced: still pulls changes made on another device); bold = something for you to do (items waiting).
async function syncButtons() {
  const btns = document.querySelectorAll('.syncbtn');
  if (!btns.length) return;
  const busy = isSyncing() || syncBusy, offline = !navigator.onLine;
  let p = { boxes: 0, other: 0 };
  if (!busy && !offline) { try { p = await store.pendingSummary(); } catch {} }
  const waiting = p.boxes || p.other;
  btns.forEach(b => {
    b.disabled = busy || offline;
    b.setAttribute('aria-busy', busy ? 'true' : 'false');
    b.classList.toggle('quiet', !busy && !offline && !waiting);
    b.textContent = busy ? 'Syncing…' : offline ? 'Offline: sync later' : waiting ? `Sync now · ${p.boxes ? plural(p.boxes, 'box', 'boxes') : 'changes'}` : 'Sync now';
  });
}
window.addEventListener('online', () => syncButtons());
window.addEventListener('offline', () => syncButtons());
let syncBusy = false;
async function runSync(interactive) {
  if (helperInfo) return; // Helper mode (D32): never signs in or syncs; boxes go to the owner as files
  if (isSyncing() || syncBusy) return;
  syncBusy = true; syncButtons();
  // Keep the screen on while syncing (B, 24 Nov: a sync stopped when the phone left the app). Chrome may refuse; that is fine.
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch {}
  try { for (let attempt = 1; attempt <= 2; attempt++) { const again = await runSyncOnce(interactive, attempt); if (!again) break; await new Promise(r => setTimeout(r, 4000)); } }
  finally { try { await lock?.release(); } catch {} syncBusy = false; syncButtons(); }
  refreshStatus();
  // Re-draw lists after a sync, but never redraw a page the user is in the middle of editing (I1).
  if (location.hash.startsWith('#/item') ? !itemDirty() : (location.hash === '' || location.hash === '#/' || location.hash === '#/settings')) route(); // Settings too: its Sync card shows what is waiting
}
// Returns true when a dropped connection should be retried once (still online, app in front).
async function runSyncOnce(interactive, attempt) {
  // The status pill re-reads what's waiting; at most once a second during a sync (perf: once per photo grew with the backlog).
  let lastPill = 0;
  syncFrac = 0.05;
  const setMsg = (m) => { const ph = /photo (\d+) of (\d+)/.exec(m); syncFrac = ph ? 0.1 + 0.7 * (+ph[1] / +ph[2]) : /Reading your sheet/.test(m) ? 0.85 : /Synced:/.test(m) ? 1 : syncFrac;
    lastSyncMsg = m; const el = $('#syncMsg'); if (el) el.textContent = m; const t = Date.now(); if (t - lastPill > 1000) { lastPill = t; refreshStatus(); } };
  try {
    const s = await syncNow({ interactive, progress: setMsg });
    setMsg(`Synced: ${s.photosUploaded} photo(s), ${s.rowsAppended} new row(s), ${s.rowsUpdated} update(s), ${s.pulled} pulled${s.conflicts ? `, ${s.conflicts} clash(es) to review` : ''}${s.errors.length ? `, ${s.errors.length} error(s) — will retry` : ''} · ${(s.ms / 1000).toFixed(1)} s`);
    if (s.errors.length && attempt === 1 && navigator.onLine && !document.hidden) { setMsg(`${s.errors.length} item(s) didn't go through · trying again…`); return true; }
    if (!s.errors.length) { syncDoneAt = Date.now(); setTimeout(refreshStatus, 1700); }
    if (interactive) toast(s.errors.length ? 'Synced with some errors — will retry' : 'Synced ✓', 1800, s.errors.length ? 'warn' : 'ok');
    refreshStatus();
    // Daily/monthly sheet backup (D25) once a sync has succeeded; a failure here never affects the sync.
    try { const cfg = await getConfig(); if (cfg && !s.errors.length) { const b = await backupIfDue(cfg); if (b.daily || b.monthly) setMsg(`${lastSyncMsg} · backup made`); } }
    catch (e) { console.warn('backup', e); setMsg(`${lastSyncMsg} · backup failed: ${e.message}`); }
  } catch (e) {
    if (e.retryable && e.status !== 401 && attempt === 1 && navigator.onLine && !document.hidden) { setMsg(`${e.message} · trying again…`); return true; }
    setMsg(document.hidden && e.retryable ? `${e.message} · it carries on when you come back to the app` : e.message);
    if (interactive) toast(e.message, 3500, (e.retryable || e.status === 401) ? 'warn' : 'bad');
  }
  return false;
}
// Coming back to the app with things still waiting: carry on syncing by itself (signed in, online).
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || isSyncing() || syncBusy || !navigator.onLine || !hasToken()) return;
  const p = await store.pendingSummary(); if (p.boxes || p.other) autoSyncSoon();
});
let autoTimer = null;
function autoSyncSoon() { if (helperInfo) return; clearTimeout(autoTimer); autoTimer = setTimeout(() => { if (navigator.onLine && hasToken()) runSync(false); }, 2500); }

// ---------- router ----------
let routeSeq = 0;
// Pages with editable fields register a "save what's typed" hook; it runs before any navigation or
// redraw, so typed edits are never thrown away (audit finding I1).
let leaveHooks = [];
let itemDirty = () => false;
// Scroll (audit I3): a new page opens at the top; coming back to the Garage restores where you were.
let lastHash = null, garageScroll = 0;
const isGarage = (hh) => hh === '#/' || hh === '' || hh === '#';
async function route() {
  const prevHash = lastHash;
  const hooks = leaveHooks; leaveHooks = []; itemDirty = () => false;
  for (const fn of hooks) {
    try { await fn(); } catch (e) { console.error(e); toast(`Could not save your changes: ${e.message}`, 4000, 'bad'); }
  }
  const hash = location.hash || '#/';
  if (prevHash !== null && prevHash !== hash && isGarage(prevHash)) garageScroll = window.scrollY;
  lastHash = hash;
  document.querySelectorAll('nav.bottom a').forEach(a => a.classList.toggle('on', hash.startsWith(a.getAttribute('href')) && (a.getAttribute('href') !== '#/' || hash === '#/')));
  // Render into a fresh container and swap it in only if no newer navigation started meanwhile
  // (prevents two overlapping renders from mixing their content).
  const token = ++routeSeq;
  // view-<page> lets tablet and desktop layouts (s1-0.40.0) arrange each page; phones are unchanged
  const page = hash.slice(2).split('/')[0] || 'garage';
  const v = h('div', { class: `view view-${page}` });
  document.body.dataset.page = page;
  try {
    if (hash.startsWith('#/add')) await renderAdd(v);
    else if (hash.startsWith('#/run')) await renderRun(v);
    else if (hash.startsWith('#/name')) await renderName(v);
    else if (hash.startsWith('#/dash')) await renderDash(v);
    else if (hash.startsWith('#/item/') && helperInfo && (await store.getRecord('models', decodeURIComponent(hash.slice(7))))?.lookup) await renderLookupItem(v, decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('#/item/')) await renderItem(v, decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('#/crop/')) await renderCrop(v, decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('#/settings') && helperInfo) await renderHelperHome(v);
    else if (hash.startsWith('#/settings')) await renderSettings(v);
    else if (hash.startsWith('#/helper')) await renderHelperStart(v);
    else if (hash.startsWith('#/inbox')) await renderInbox(v);
    else if (hash.startsWith('#/brands')) await renderBrands(v);
    else if (hash.startsWith('#/wish')) await renderWish(v);
    else if (hash.startsWith('#/review')) await renderReview(v);
    else if (hash.startsWith('#/order')) await renderOrder(v);
    else if (hash.startsWith('#/share')) await renderShare(v);
    else if (hash.startsWith('#/import')) await renderImport(v);
    else if (hash.startsWith('#/showroom/')) await renderShowroom(v, decodeURIComponent(hash.slice(11)));
    else if (hash.startsWith('#/boxsheet/')) await renderBoxSheet(v, decodeURIComponent(hash.slice(11)));
    else if (hash.startsWith('#/box/')) { garageFilter = 'all'; garageSearch = `Box ${decodeURIComponent(hash.slice(6)).replace(/^box\s*/i, '').toUpperCase()}`; location.replace('#/'); return; }
    else await renderGarage(v);
    if (helperInfo && page === 'garage') v.prepend(helperBanner());
  } catch (e) {
    v.append(h('div', { class: 'banner bad' }, `Something went wrong: ${e.message}`));
    console.error(e);
  }
  updateNameBadge();
  if (token === routeSeq) {
    view().replaceChildren(v); syncButtons(); // style Sync buttons once the page is on screen
    if (prevHash !== hash) window.scrollTo(0, isGarage(hash) && prevHash?.startsWith('#/item/') ? garageScroll : 0);
  }
  refreshStatus();
}

// =====================================================================
// Garage list
// =====================================================================
let garageFilter = 'all', garageSearch = '';
// List view + sorting (s1-0.44.0): remembered on this device
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
let garageView = lsGet('smg.garageView', 'grid'), garageSort = lsGet('smg.garageSort', 'newest');
let selectedPhoto = { model: null, id: null };

// Nameless boxes waiting, shown as a badge on the Name tab.
async function updateNameBadge() {
  try {
    const n = (await store.listRecords('models')).filter(r => !r.data.deleted_at && !String(r.data.display_name || '').trim()).length;
    const b = document.querySelector('#navname .badge');
    if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); }
  } catch { /* badge is a convenience only */ }
}

// Storage-box names (B, 24 Nov: "I should be able to name the box"). Keyed by lower-case label, e.g. "box 3".
async function boxNames() {
  const m = new Map();
  for (const r of await store.list('storage_boxes')) if (!r.deleted_at && r.box_label) m.set(String(r.box_label).toLowerCase(), r);
  return m;
}
async function saveBox(label, patch) {
  const names = await boxNames();
  const rec = names.get(label.toLowerCase());
  const clean = {};
  if ('box_name' in patch) clean.box_name = String(patch.box_name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
  if ('box_size' in patch) clean.box_size = BOX_SIZES.includes(patch.box_size) ? patch.box_size : '';
  if ('box_brand' in patch) clean.box_brand = /^[A-Za-z0-9_-]{1,40}$/.test(patch.box_brand || '') ? patch.box_brand : '';
  if ('box_scale' in patch) clean.box_scale = /^[A-Za-z0-9_-]{1,40}$/.test(patch.box_scale || '') ? patch.box_scale : '';
  if ('box_packed_at' in patch) clean.box_packed_at = /^\d{4}-\d{2}-\d{2}T/.test(patch.box_packed_at || '') ? patch.box_packed_at : '';
  if ('box_label_at' in patch) clean.box_label_at = /^\d{4}-\d{2}-\d{2}T/.test(patch.box_label_at || '') ? patch.box_label_at : '';
  if (rec) {
    const changed = Object.keys(clean).filter(k => String(rec[k] || '') !== clean[k]);
    if (!changed.length) return;
    await store.update('storage_boxes', rec.storage_box_id, clean);
    for (const k of changed) await store.logChange('storage_boxes', rec.storage_box_id, k, rec[k], clean[k], 'edited in app');
  } else if (Object.values(clean).some(Boolean)) {
    const nr = await store.create('storage_boxes', { box_label: label, ...clean });
    for (const [k, val] of Object.entries(clean)) if (val) await store.logChange('storage_boxes', nr.storage_box_id, k, '', val, 'edited in app');
  }
}
const BOX_SIZES = ['S', 'M', 'L', 'XL'];
// Packing (D30): a box is "packed" once its label is done and it is closed. Only a date; cars are never locked.
const packedDate = (r) => (r?.box_packed_at ? new Date(r.box_packed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
async function setPacked(label, on) {
  await saveBox(label, { box_packed_at: on ? store.nowIso() : '' });
  if (on) packedMoment(label, (await carsInBox(label)).length);
  toast(on ? `${label} marked as packed ✓` : `${label} is open again`); autoSyncSoon();
}
function packButton(label, rec) {
  return rec?.box_packed_at
    ? h('div', { class: 'row packedrow', style: 'align-items:center;margin-top:8px' }, h('span', { style: 'flex:1' }, '✅ ', h('b', {}, 'Packed'), ` · ${packedDate(rec)}`),
        h('button', { type: 'button', class: 'ghost small', onclick: async () => { await setPacked(label, false); route(); } }, 'Open again'))
    : h('button', { type: 'button', class: 'quiet wide', style: 'margin-top:6px', onclick: async () => { await setPacked(label, true); route(); } }, '📦 Mark as packed');
}
// A storage box drawn like the real see-through box (B's sketch, 24 Nov): count big inside; size, number and name below.
const BOX_SVG = '<svg viewBox="0 0 100 66" aria-hidden="true">'
  + '<path class="rim" d="M2 11 L5 5 H95 L98 11 Z" />'            // wide lip, like the SAMLA lid edge
  + '<path class="body" d="M8 11 L13 57 H87 L92 11" />'                          // gently tapering body
  + '<path class="rib" d="M19 14 L22 50 M81 14 L78 50" />'          // vertical ribs near each end
  + '<path d="M16 57 V61 H27 V57 M73 57 V61 H84 V57" />'            // small feet
  + '</svg>';
function boxShape(count) {
  const el = h('span', { class: 'boxshape' });
  el.innerHTML = BOX_SVG; // fixed markup, no user data
  el.append(h('b', {}, typeof count === 'number' ? count.toLocaleString('en-IN') : count));
  return el;
}

// Storage boxes in use (from owned copies of models not archived), in number order.
const boxNum = (k) => { const n = String(k).match(/\d+/); return n ? Number(n[0]) : Infinity; };
async function boxesInUse() {
  const [models, inventory] = await Promise.all([store.listRecords('models'), store.list('inventory')]);
  const live = new Set(models.filter(r => !r.data.deleted_at).map(r => r.id));
  const counts = new Map();
  for (const i of inventory) if (i.ownership_status === 'Owned' && live.has(i.model_id) && i.storage_location) counts.set(i.storage_location, (counts.get(i.storage_location) || 0) + 1);
  for (const r of await store.list('storage_boxes')) if (!r.deleted_at && r.box_label && !counts.has(r.box_label)) counts.set(r.box_label, 0); // new, still empty
  return [...counts.entries()].sort((a, b) => boxNum(a[0]) - boxNum(b[0]) || a[0].localeCompare(b[0]));
}
// "＋ New box": the next number after the highest box in use, created empty, then opened.
async function newBox() {
  const used = await boxesInUse();
  const next = Math.max(0, ...used.map(([k]) => boxNum(k)).filter(Number.isFinite)) + 1;
  const label = `Box ${next}`;
  await store.create('storage_boxes', { box_label: label, box_name: '', box_size: '' });
  autoSyncSoon();
  return label;
}
// Start (or continue) a photo run straight into this box.
// The box decides the brand (B, 24 Nov): a brand box presets the brand; a mixed box asks per car.
async function applyBoxBrand(label) {
  const rec = (await boxNames()).get(label.toLowerCase());
  const bb = rec?.box_brand || '';
  if (bb === 'mixed') { localStorage.setItem('smg.brandPerCar', '1'); if (cap && !Object.keys(cap.photos || {}).length) cap.brandId = ''; }
  else if (bb) { localStorage.setItem('smg.brandPerCar', '0'); if (cap) cap.brandId = bb; pushRecentBrand(bb); }
  const bs = rec?.box_scale || '';
  if (bs === 'mixed') { localStorage.setItem('smg.scalePerCar', '1'); if (cap && !Object.keys(cap.photos || {}).length) cap.scaleId = ''; }
  else if (bs) { localStorage.setItem('smg.scalePerCar', '0'); if (cap) cap.scaleId = bs; localStorage.setItem('smg.lastScale', bs); }
}
// Import from the gallery straight into this box: the box's brand and scale are the starting choice.
async function warnIfPacked(label) {
  const rec = (await boxNames()).get(label.toLowerCase());
  if (rec?.box_packed_at) toast(`${label} is marked packed (${packedDate(rec)}). New cars still go in; tap "Open again" if you're repacking it.`, 5000, 'warn');
}
async function importBox(label) {
  await warnIfPacked(label);
  const id = label.replace(/^Box\s*/i, '');
  localStorage.setItem('smg.lastBox', id);
  if (!cap) cap = freshCapture({ count: 0 });
  cap.box = id;
  try { localStorage.removeItem('smg.import'); } catch {}
  importFiles = null;
  location.hash = '#/import';
}
async function fillBox(label) {
  await warnIfPacked(label);
  const id = label.replace(/^Box\s*/i, '');
  localStorage.setItem('smg.lastBox', id);
  if (!cap) cap = await loadDraft();
  if (!cap) cap = freshCapture({ scaleId: localStorage.getItem('smg.lastScale') || '', brandId: recentBrands()[0] || '' });
  cap.box = id;
  await applyBoxBrand(`Box ${id}`);
  saveDraftSoon();
  const perCar = localStorage.getItem('smg.brandPerCar') === '1';
  const scalePer = localStorage.getItem('smg.scalePerCar') === '1';
  runSetOpen = !((cap.brandId || perCar) && (cap.scaleId || scalePer));
  location.hash = '#/run';
}
// One tap to put the next car in any box already in use (B: moving on shouldn't need "box full").
function boxPicker(current, used, names, pick) {
  if (!used.length) return null;
  return h('div', { class: 'chips scroll', style: 'margin-top:8px' }, used.map(([k]) => {
    const id = k.replace(/^Box\s*/i, ''); const nm = names.get(k.toLowerCase())?.box_name;
    const on = String(current).toLowerCase() === id.toLowerCase();
    return h('button', { type: 'button', class: `chip ${on ? 'on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => pick(id) }, nm ? `${id} · ${nm}` : `Box ${id}`);
  }));
}
// The shelf: each storage box as a SAMLA side view, count inside; size, number, name below.
let brandNameCache = {}, scaleLabelCache = {};
// Box settings stay as B left them (open while he's setting a box up), instead of folding mid-way.
const boxSettingsOpen = new Map();
function shelfEl(boxes, names, onTap, { selected = '', scroll = false, onNew = null } = {}) {
  return h('div', { class: `shelf${scroll ? ' scrollrow' : ''}${selected && boxes.some(([k]) => k.toLowerCase() === selected.toLowerCase()) ? ' hassel' : ''}` }, ...boxes.map(([k, n]) => {
    const r = names.get(k.toLowerCase()) || {};
    const sel = selected && selected.toLowerCase() === k.toLowerCase();
    return h('button', { type: 'button', class: `boxtile${sel ? ' sel' : ''}`, 'aria-pressed': sel ? 'true' : 'false', onclick: () => onTap(k, sel), 'aria-label': `${k}${r.box_name ? ', ' + r.box_name : ''}${r.box_size ? ', size ' + r.box_size : ''}: ${plural(n, 'car', 'cars')}` },
      boxShape(n), sel ? h('span', { class: 'selck', 'aria-hidden': 'true' }, '✓') : null,
      h('span', { class: 'bxl' }, r.box_size ? h('em', {}, r.box_size) : null, k, r.box_packed_at ? h('b', { class: 'packedmark', title: `Packed ${packedDate(r)}` }, ' ✓') : null),
      (() => { const t = r.box_name || [r.box_brand === 'mixed' ? 'Mixed' : brandNameCache[r.box_brand], r.box_scale === 'mixed' ? '' : scaleLabelCache[r.box_scale]].filter(Boolean).join(' · '); return t ? h('i', {}, t) : null; })());
  }), onNew ? h('button', { type: 'button', class: 'boxtile newbox', onclick: onNew, 'aria-label': 'Add a new storage box' }, boxShape('＋'), h('span', { class: 'bxl' }, 'New box')) : null);
}

// Long Dashboard lists show the first few, then 'Show all N' (usability review UR-0.1 S2, B 27 Nov: "123").
function foldRows(nodes, keep, what) {
  if (nodes.length <= keep + 1) return nodes;
  const rest = nodes.slice(keep);
  const more = h('div', { class: 'foldrest', hidden: true }, ...rest);
  const btn = h('button', { type: 'button', class: 'small quiet foldbtn', 'aria-expanded': 'false', onclick: () => {
    const open = more.hidden; more.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Show fewer' : `Show all ${nodes.length} ${what}`;
  } }, `Show all ${nodes.length} ${what}`);
  return [...nodes.slice(0, keep), more, btn];
}

// Removing a box never deletes cars: they move to "No box yet". The box is soft-deleted and every car it held is
// logged in CHANGE_LOG with a tag, so "Restore" can put the box and its cars back (B, 24 Nov).
// ---------- Box journey (B, 25 Nov): Photos → Names → Gaps fixed → Label → Packed, per storage box ----------
async function journeyData() {
  const [models, inventory, ids, photos] = await Promise.all([store.list('models'), store.list('inventory'), store.list('product_identifiers'), store.list('photos')]);
  const live = new Map(models.filter(m => !m.deleted_at).map(m => [m.model_id, m]));
  const withBc = new Set(ids.filter(i => i.identifier_type === 'barcode' && !i.deleted_at && String(i.value_raw || '').trim()).map(i => i.model_id));
  const withFront = new Set(photos.filter(p => !p.deleted_at && p.shot_role === 'box_front').map(p => p.model_id));
  return { live, inventory, withBc, withFront };
}
function boxJourneyFrom(d, label, rec) {
  const ids = [...new Set(d.inventory.filter(i => !i.deleted_at && i.ownership_status === 'Owned' && d.live.has(i.model_id) && String(i.storage_location || '').toLowerCase() === label.toLowerCase()).map(i => i.model_id))];
  const cars = ids.map(x => d.live.get(x)); const n = cars.length;
  const noPhoto = cars.filter(m => !d.withFront.has(m.model_id)).length;
  const noName = cars.filter(m => !String(m.display_name || '').trim()).length;
  const noBrand = cars.filter(m => !m.brand_id).length, noScale = cars.filter(m => !m.scale_id).length;
  const noBc = cars.filter(m => !d.withBc.has(m.model_id) && m.barcode_absent !== 'yes').length;
  const gaps = [noBrand && plural(noBrand, 'needs a brand', 'need a brand'), noScale && plural(noScale, 'needs a scale', 'need a scale'), noBc && plural(noBc, 'needs a barcode', 'need a barcode')].filter(Boolean);
  const steps = [
    { key: 'photos', label: 'Photos', done: n > 0 && !noPhoto, todo: n ? (noPhoto ? `${plural(noPhoto, 'car has', 'cars have')} no front photo` : '') : 'No cars yet: import or fill this box' },
    { key: 'names', label: 'Names', done: n > 0 && !noName, todo: noName ? `Name ${plural(noName, 'car', 'cars')} with Gemini` : '' },
    { key: 'gaps', label: 'Gaps', done: n > 0 && !gaps.length, todo: gaps.length ? gaps.join(' · ') : '' },
    { key: 'label', label: 'Label', done: n > 0 && !!rec?.box_label_at, todo: 'Print or copy the contents sheet & label' },
    { key: 'packed', label: 'Packed', done: n > 0 && !!rec?.box_packed_at, todo: 'Tape the label on and mark it packed' },
  ];
  const next = steps.find(s => !s.done);
  return { n, steps, next, done: steps.filter(s => s.done).length };
}
function journeyTrack(j, { mini = false } = {}) {
  return h('ol', { class: `journey${mini ? ' mini' : ''}`, 'aria-label': `Box journey: ${j.done} of 5 steps done` },
    ...j.steps.map(s => h('li', { class: s.done ? 'done' : s === j.next ? 'next' : '' }, h('i', { 'aria-hidden': 'true' }, s.done ? '✓' : ''), mini ? null : h('span', {}, s.label))));
}
function journeyNext(j, label) {
  if (!j.next) return h('div', { class: 'jnext alldone' }, '🏁 This box is done: photographed, named, labelled and packed.');
  const id = encodeURIComponent(label.replace(/^Box\s*/i, ''));
  const go = { photos: () => importBox(label), names: () => { location.hash = '#/name'; }, gaps: () => { location.hash = '#/dash'; },
    label: () => { location.hash = `#/boxsheet/${id}`; }, packed: async () => { await setPacked(label, true); route(); } }[j.next.key];
  const verb = { photos: 'Import photos', names: 'Name them', gaps: 'Open To check', label: 'Open the label', packed: 'Mark as packed' }[j.next.key];
  return h('div', { class: 'jnext' }, h('div', {}, h('b', {}, `Next: ${j.next.label}`), j.next.todo ? h('div', { class: 'muted small' }, j.next.todo) : null),
    h('button', { type: 'button', class: 'small', onclick: go }, `${verb} ›`));
}

async function carsInBox(label) {
  const [models, inventory] = await Promise.all([store.listRecords('models'), store.list('inventory')]);
  const live = new Set(models.filter(r => !r.data.deleted_at).map(r => r.id));
  return inventory.filter(i => i.ownership_status === 'Owned' && live.has(i.model_id) && String(i.storage_location || '').toLowerCase() === label.toLowerCase());
}
async function removeBox(label) {
  if (helperInfo) { const own = (await store.listRecords('storage_boxes')).find(r => String(r.data.box_label).trim().toLowerCase() === label.replace(/^box\s*/i, '').trim().toLowerCase()); if (!own || own.lookup) { toast(`${label} is in the owner's garage: it can't be removed here.`, 3500, 'warn'); return false; } }
  const cars = await carsInBox(label);
  if (cars.length && !confirm(`${label} has ${plural(cars.length, 'car', 'cars')}. Remove the box?\n\nThe cars stay in your collection and move to "No box yet". You can restore the box later from Dashboard → Removed boxes.`)) return false;
  let rec = (await boxNames()).get(label.toLowerCase());
  if (!rec) rec = await store.create('storage_boxes', { box_label: label, box_name: '', box_size: '' });
  const stamp = store.nowIso();
  const tag = `box removed ${rec.storage_box_id} ${stamp}`;
  for (const i of cars) {
    await store.update('inventory', i.inventory_id, { storage_location: '' });
    await store.logChange('inventory', i.inventory_id, 'storage_location', label, '', tag);
  }
  await store.update('storage_boxes', rec.storage_box_id, { deleted_at: stamp });
  await store.logChange('storage_boxes', rec.storage_box_id, 'deleted_at', '', stamp, `removed in app (${plural(cars.length, 'car', 'cars')} moved to No box yet)`);
  autoSyncSoon();
  return true;
}
async function removedBoxes() {
  const [boxRecs, log] = await Promise.all([store.listRecords('storage_boxes'), store.list('change_log')]);
  const boxes = boxRecs.map(r => r.data); // includes removed boxes (store.list leaves them out)
  return boxes.filter(b => b.deleted_at && b.notes !== 'restored into an active box').map(b => {
    const tag = `box removed ${b.storage_box_id} ${b.deleted_at}`;
    return { box: b, cars: log.filter(c => c.reason === tag).map(c => c.record_id) };
  }).sort((a, b) => String(b.box.deleted_at).localeCompare(String(a.box.deleted_at)));
}
async function restoreBox(entry) {
  const { box, cars } = entry;
  const label = box.box_label;
  const active = (await boxNames()).get(label.toLowerCase());
  if (active && !confirm(`${label} is in use again. Put the restored cars into it as well?`)) return false;
  const inv = await store.list('inventory');
  let back = 0;
  for (const id of cars) {
    const i = inv.find(x => x.inventory_id === id);
    if (!i || i.storage_location) continue; // moved somewhere else since: leave it there
    await store.update('inventory', id, { storage_location: label });
    await store.logChange('inventory', id, 'storage_location', '', label, `box restored ${box.storage_box_id}`);
    back++;
  }
  if (active) await store.update('storage_boxes', box.storage_box_id, { notes: 'restored into an active box' });
  else await store.update('storage_boxes', box.storage_box_id, { deleted_at: '' });
  await store.logChange('storage_boxes', box.storage_box_id, 'deleted_at', box.deleted_at, '', `restored in app (${plural(back, 'car', 'cars')} back in the box)`);
  autoSyncSoon();
  return back;
}

// Dashboard (B, 24 Nov: "get this dashboard up"). Counts are physical boxes (owned copies of
// models that aren't archived). Single-series bars: one hue, numbers in text colour, no legend.
function barList(rows, { onTap } = {}) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return h('div', { class: 'bars' }, rows.map(([label, n, key, swatch]) => h(onTap ? 'button' : 'div', { class: 'barrow', type: onTap ? 'button' : undefined, onclick: onTap ? () => onTap(key ?? label) : undefined, title: `${label}: ${n}` },
    h('span', { class: 'bl' }, swatch ? h('span', { class: 'cdot', style: `background:${swatch}` }) : null, label),
    h('span', { class: 'bt' }, h('span', { style: `width:${Math.max(2, Math.round((n / max) * 100))}%` })),
    h('span', { class: 'bn' }, n.toLocaleString('en-IN')))));
}
const tally = (items, keyOf) => { const m = new Map(); for (const it of items) { const k = keyOf(it); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); };
const topN = (entries, n) => entries.length <= n + 1 ? entries : [...entries.slice(0, n), ['Other', entries.slice(n).reduce((t, e) => t + e[1], 0), '__other']];

async function renderDash(v) {
  const [models, inventory, photos, ref, ids] = await Promise.all([store.listRecords('models'), store.list('inventory'), store.list('photos'), refData(), store.list('product_identifiers')]);
  const brandName = Object.fromEntries(ref.brands.map(b => [b.brand_id, b.name]));
  brandNameCache = brandName; scaleLabelCache = Object.fromEntries(ref.scales.map(x => [x.scale_id, x.label]));
  const scaleLabel = Object.fromEntries(ref.scales.map(s => [s.scale_id, s.label]));
  const active = models.filter(r => !r.data.deleted_at);
  const byId = new Map(active.map(r => [r.id, r.data]));
  const copies = inventory.filter(i => i.ownership_status === 'Owned' && byId.has(i.model_id));
  const est = collectionEstimate();
  const pct = Math.min(100, Math.round((copies.length / est) * 100));
  const goGarage = (filter, search = '') => { garageFilter = filter; garageSearch = search; location.hash = '#/'; };

  v.append(h('div', { class: 'row' }, h('h2', {}, 'Dashboard'), h('div', { class: 'muted' }, 'on this phone')));
  if (!copies.length) {
    v.append(h('div', { class: 'card' }, h('p', {}, 'Nothing catalogued yet.'), h('a', { href: '#/run', class: 'btn wide' }, icon('camera'), 'Start a photo run')));
    return;
  }
  // Headline
  const storage = copies.map(i => i.storage_location).filter(Boolean);
  v.append(h('div', { class: 'card hero' },
    h('div', { class: 'big' }, copies.length.toLocaleString('en-IN')),
    h('div', {}, plural(copies.length, 'box', 'boxes').replace(/^[\d,]+ /, '') + ' catalogued'),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'rough progress' }, h('span', { style: `width:${Math.max(pct, 1)}%` })),
    h('div', { class: 'muted small' }, 'Bar = rough progress, based on your guess in Settings'),
    h('div', { class: 'muted' }, `${plural(active.length, 'different model', 'different models')} · ${plural(new Set(storage).size, 'storage box', 'storage boxes')} in use`)));

  // Status tiles: icon + label + number, each opens the matching list
  const named = active.filter(r => String(r.data.display_name || '').trim()).length;
  const unsentPhoto = new Set(photos.filter(p => !p.original_file_id).map(p => p.model_id));
  const pending = active.filter(r => r.dirty || unsentPhoto.has(r.id)).length;
  const review = active.filter(r => r.data.namespace_status === 'needs_review').length;
  const tile = (ico, label, n, kind, onclick) => h('button', { type: 'button', class: `stat ${n && kind ? kind : ''}`, onclick }, h('span', { class: 'si' }, ico), h('b', {}, n.toLocaleString('en-IN')), h('span', {}, label));
  v.append(h('div', { class: 'stats' },
    tile('✓', 'named', named, '', () => goGarage('all')),
    tile('✎', 'need a name', active.length - named, 'warn', () => { location.hash = '#/name'; }),
    tile('⚑', 'need review', review, 'warn', () => goGarage('review')),
    tile('⇅', 'waiting to sync', pending, 'info', () => goGarage('pending'))));

  // Wishlist (s1-0.42.0). Hidden until after the shop check (B, 26 Nov): set WISHLIST_ON to true to bring the card back.
  if (WISHLIST_ON) {
    const wl = (await store.list('wishlist')).filter(w => (w.status || 'wanted') === 'wanted');
    v.append(h('a', { href: '#/wish', class: 'card wishlink' }, h('span', { class: 'wl-ic', 'aria-hidden': 'true' }, '⭐'),
      h('span', { class: 'wl-tx' }, h('b', {}, 'Wishlist'), h('span', { class: 'muted small' }, wl.length ? `${plural(wl.length, 'car', 'cars')} you want${wl.some(w => w.priority === 'high') ? ` · ${wl.filter(w => w.priority === 'high').length} high priority` : ''}` : 'Cars you want to find')),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  }

  // Needs review (s1-0.46.0)
  {
    const { items } = await reviewItems();
    v.append(h('a', { href: '#/review', class: `card navlink reviewlink${items.length ? ' has' : ''}` }, h('span', { class: 'wl-ic', 'aria-hidden': 'true' }, items.length ? '🔎' : '✓'),
      h('span', { class: 'wl-tx' }, h('b', {}, 'Needs review'), h('span', { class: 'muted small' }, items.length ? `${plural(items.length, 'thing', 'things')} the app isn't sure about` : 'Nothing the app is unsure about')),
      items.length ? h('span', { class: 'g-count' }, String(items.length)) : null, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  }

  // To check: every gap in one list, each opens the matching Garage list
  const ctx = checkContext(active.map(r => r.data), inventory, ids, photos);

  // Data health (s1-0.43.0): one number for how complete the catalogue is; tap a gap to fix it
  {
    const unsynced = new Set(photos.filter(p => !p.deleted_at && !p.original_file_id).map(p => p.model_id));
    const live = active.map(r => ({ ...r.data, _dirty: r.dirty || unsynced.has(r.id) }));
    const parts = [
      ['photos', 'Front + barcode photo', (m) => ctx.bothPhotos.has(m.model_id), 'nophoto'],
      ['name', 'Name', (m) => !!String(m.display_name || '').trim(), 'noname'],
      ['brand', 'Brand', (m) => !!m.brand_id, 'nobrand'],
      ['scale', 'Scale', (m) => !!m.scale_id, 'noscale'],
      ['code', 'Product code (or marked none)', (m) => !!String(m.product_code || '').trim() || m.code_absent === 'yes', 'nocode'],
      ['barcode', 'Barcode (or marked none)', (m) => ctx.withBarcode.has(m.model_id) || m.barcode_absent === 'yes', 'nobarcode'],
      ['box', 'In a storage box', (m) => !ctx.ownedNoBox.has(m.model_id), 'nobox'],
      ['colour', 'Colour', (m) => !!m.colour_family, 'nocolour'],
      ['synced', 'Synced to Google', (m) => !m._dirty, 'pending'],
    ];
    const hs = healthScore(live, parts);
    if (hs.total) {
      const fixOf = Object.fromEntries(parts.map(p => [p[0], p[3]]));
      const go = (k) => (k === 'noname' ? (location.hash = '#/name') : goGarage(k));
      v.append(h('div', { class: 'card health' },
        h('div', { class: 'hl-top' },
          h('div', { class: 'hl-ring', style: `--p:${hs.score}`, role: 'img', 'aria-label': `Data health ${hs.score}%` }, h('b', {}, `${hs.score}%`)),
          h('div', { class: 'hl-tx' }, h('h3', {}, 'Data health'), h('b', {}, healthWord(hs.score)),
            h('span', { class: 'muted small' }, `${hs.complete} of ${plural(hs.total, 'car has', 'cars have')} everything · ${parts.length} things checked per car`))),
        hs.weakest.length ? h('div', { class: 'checklist' }, hs.weakest.slice(0, 3).map(p => h('button', { type: 'button', class: 'checkrow', onclick: () => go(fixOf[p.key]) },
          h('span', {}, p.label), h('b', {}, `${p.miss.toLocaleString('en-IN')} missing`), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))
          : h('p', { class: 'muted', style: 'margin:8px 0 0' }, 'Every car has everything ✓')));
    }
  }
  const gaps = CHECKS.map(([k, label, test]) => [k, label, active.filter(r => test(r.data, ctx)).length]).filter(g => g[2] > 0);
  v.append(h('div', { class: 'card tocheck' }, h('h3', {}, 'To check'),
    gaps.length ? h('div', { class: 'checklist' }, gaps.map(([k, label, n]) => h('button', { type: 'button', class: 'checkrow', onclick: () => goGarage(k) },
      h('span', {}, label), h('b', {}, n.toLocaleString('en-IN')), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))
      : h('p', { class: 'muted' }, 'Nothing to check ✓')));

  // Purchases (D12.1: unknown prices are never ₹0; the coverage is always shown)
  const month = todayIso().slice(0, 7);
  const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const priced = copies.filter(i => String(i.purchase_price || '').trim() !== '' && !isNaN(Number(i.purchase_price)));
  const thisMonth = copies.filter(i => String(i.purchase_date || '').startsWith(month));
  const tmPriced = thisMonth.filter(i => priced.includes(i));
  const txAll = await store.list('transactions'); const byInv = new Map(); txAll.forEach(t => (byInv.get(t.inventory_id) || byInv.set(t.inventory_id, []).get(t.inventory_id)).push(t));
  const T = moneyTotals(inventory.filter(i => byId.has(i.model_id)).map(i => ({ inv: i, money: copyMoney(i, byInv.get(i.inventory_id) || []) })));
  // Nothing money-related recorded yet → one line instead of six blanks (UR-0.1 S3, B 27 Nov: "123")
  if (!priced.length && !T.costKnown && !T.soldN && !T.repairs && !T.gifted) v.append(h('div', { class: 'card purchases' },
    h('div', { class: 'row', style: 'align-items:baseline' }, h('h3', { style: 'margin:0' }, 'Purchases'), h('span', { class: 'muted small' }, `no prices yet · ${plural(copies.length, 'car', 'cars')}`)),
    h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Tap "🛍 Just bought?" when you photograph a new car, or add a price on a car page under its copy. Unknown prices are never counted as ₹0.'),
    h('div', { class: 'row', style: 'gap:8px;justify-content:flex-start;margin-top:8px' }, h('a', { href: '#/order', class: 'btnlink small' }, '📦 Split an order\'s shipping'))));
  else v.append(h('div', { class: 'card purchases' }, h('h3', {}, 'Purchases'),
    h('div', { class: 'pgrid' },
      h('div', {}, h('div', { class: 'muted small' }, 'This month'), h('b', {}, thisMonth.length ? money(tmPriced.reduce((a, i) => a + Number(i.purchase_price), 0)) : '—'),
        h('div', { class: 'muted small' }, thisMonth.length ? `${plural(thisMonth.length, 'car', 'cars')}${tmPriced.length < thisMonth.length ? ` · ${tmPriced.length} with a price` : ''}` : 'nothing yet')),
      h('div', {}, h('div', { class: 'muted small' }, 'All prices known'), h('b', {}, priced.length ? money(priced.reduce((a, i) => a + Number(i.purchase_price), 0)) : '—'),
        h('div', { class: 'muted small' }, `price known for ${priced.length} of ${plural(copies.length, 'car', 'cars')}`))),
    (() => { // s1-0.48.0: cost incl. shipping − refunds, repairs, sold — each with coverage
      return h('div', { class: 'pgrid', style: 'margin-top:10px' },
        h('div', {}, h('div', { class: 'muted small' }, 'Cost incl. shipping, less refunds'), h('b', {}, T.costKnown ? rupees(T.cost) : '—'), h('div', { class: 'muted small' }, `known for ${T.costKnown} of ${plural(T.ownedN, 'car', 'cars')} owned`)),
        h('div', {}, h('div', { class: 'muted small' }, 'Sold'), h('b', {}, T.soldN ? rupees(T.proceeds) : '—'), h('div', { class: 'muted small' }, T.soldN ? `${plural(T.soldN, 'car', 'cars')} · ${T.gainKnown ? `${T.gain >= 0 ? 'gain' : 'loss'} ${rupees(Math.abs(T.gain))} on ${T.gainKnown}` : 'gain not computable'}` : 'nothing sold')),
        T.repairs ? h('div', {}, h('div', { class: 'muted small' }, 'Repairs / extras'), h('b', {}, rupees(T.repairs)), h('div', { class: 'muted small' }, 'shown apart')) : null,
        T.gifted ? h('div', {}, h('div', { class: 'muted small' }, 'Given away'), h('b', {}, String(T.gifted)), h('div', { class: 'muted small' }, 'no proceeds')) : null);
    })(),
    h('div', { class: 'row', style: 'gap:8px;justify-content:flex-start;flex-wrap:wrap;margin-top:10px' }, h('a', { href: '#/order', class: 'btnlink small' }, '📦 Split an order\'s shipping')),
    h('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'Add a purchase: tap "🛍 Just bought?" when you photograph a new car. Sold, gifts, refunds and repairs: on the car page, under each copy. Unknown prices are left out, never counted as ₹0.')));

  // By brand, by scale
  v.append(h('div', { class: 'card' }, h('div', { class: 'row', style: 'align-items:baseline' }, h('h3', {}, 'By brand'), h('a', { href: '#/brands', class: 'small' }, 'Manage brands ›')),
    barList(topN(tally(copies, i => brandName[byId.get(i.model_id).brand_id] || 'Brand not set'), 8), { onTap: (k) => { if (k !== '__other') goGarage('all', k); } })));
  v.append(h('div', { class: 'card' }, h('h3', {}, 'By scale'),
    barList(tally(copies, i => scaleLabel[byId.get(i.model_id).scale_id] || 'Scale not set'), { onTap: (k) => goGarage('all', k) })));

  // Collection insights (s1-0.41.0): only what's saved on this phone; each card says how many cars it covers
  await insightCards(v, { active, copies, byId, photos, brandName, goGarage });

  // Storage boxes: one tile per numbered box, in number order
  const boxes0 = tally(copies, i => i.storage_location || '').filter(([k]) => k);
  for (const r of await store.list('storage_boxes')) if (!r.deleted_at && r.box_label && !boxes0.some(([k]) => k === r.box_label)) boxes0.push([r.box_label, 0]);
  const boxes = boxes0.sort((a, b) => (parseInt(a[0].replace(/\D/g, ''), 10) || 0) - (parseInt(b[0].replace(/\D/g, ''), 10) || 0));
  const names = await boxNames();
  const noBox = copies.filter(i => !i.storage_location).length;
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Storage boxes · tap to open'), boxes.length > 3 ? h('p', { class: 'muted small', style: 'margin:-4px 0 6px' }, `${plural(boxes.length, 'box', 'boxes')} · swipe for more`) : null,
    shelfEl(boxes, names, (k) => goGarage('all', k), { scroll: true, onNew: async () => goGarage('all', await newBox()) }),
    (() => { // packing progress (D30)
      const used = boxes.filter(([, n]) => n > 0);
      if (!used.length) return null;
      const packed = used.filter(([k]) => names.get(k.toLowerCase())?.box_packed_at);
      const carsPacked = packed.reduce((a, [, n]) => a + n, 0);
      const loose = copies.length - carsPacked;
      const pct = copies.length ? Math.round(100 * carsPacked / copies.length) : 0;
      return h('div', { class: 'packing' },
        h('div', { class: 'row', style: 'align-items:baseline' }, h('b', { style: 'flex:1' }, `📦 Packed: ${packed.length} of ${plural(used.length, 'box', 'boxes')}`), h('span', { class: 'muted' }, `${pct}% of cars`)),
        h('div', { class: 'packbar', role: 'img', 'aria-label': `${carsPacked} of ${copies.length} cars packed` }, h('span', { style: `width:${pct}%` })),
        h('div', { class: 'muted small' }, `${plural(carsPacked, 'car', 'cars')} packed · ${loose} still to pack${noBox ? ` (${noBox} of them not in a storage box yet)` : ''}`));
    })(),
    await (async () => { // Box journey per box (B, 25 Nov)
      const used = boxes.filter(([, n]) => n > 0);
      if (!used.length) return null;
      const jd = await journeyData();
      const rows = used.map(([k]) => ({ k, rec: names.get(k.toLowerCase()), j: boxJourneyFrom(jd, k, names.get(k.toLowerCase())) }));
      const full = rows.filter(r => !r.j.next).length;
      rows.sort((x, y) => (x.j.next ? 0 : 1) - (y.j.next ? 0 : 1)); // boxes still in progress first
      return h('details', { class: 'more jlist', open: true }, h('summary', {}, `Box journey · ${full} of ${plural(rows.length, 'box', 'boxes')} done`),
        ...foldRows(rows.map(r => h('a', { href: '#/', class: 'jrow', onclick: (e) => { e.preventDefault(); goGarage('all', r.k); } },
          h('span', { class: 'jlab' }, h('b', {}, r.k), r.rec?.box_name ? h('span', { class: 'muted small' }, ` ${r.rec.box_name}`) : null),
          journeyTrack(r.j, { mini: true }), h('span', { class: 'muted small jnum' }, r.j.next ? r.j.next.label : 'Done'))), 5, 'boxes'));
    })(),
    noBox && !boxes.some(([, n]) => n > 0) ? h('p', { class: 'muted' }, `${plural(noBox, 'car is', 'cars are')} not in a storage box yet.`) : null));

  // Shooting pace (Stage 1 check 5): from photo times; the last session first
  const pc = await shootingPace();
  if (pc.medianSec != null) {
    const last = pc.sessions[pc.sessions.length - 1];
    v.append(h('div', { class: 'card pacecard' }, h('h3', {}, '⏱ Shooting pace'),
      h('p', {}, h('b', {}, `${pc.medianSec} s per box`), h('span', { class: 'muted' }, ` typical (median) · ${pc.avgSec} s on average incl. short pauses · ${plural(pc.measured + pc.sessions.length, 'box', 'boxes')} timed`)),
      h('p', { class: 'muted small' }, `Last session: ${plural(last.boxes, 'box', 'boxes')} in ${last.minutes} min · typical ${last.medianSec} s, average ${last.avgSec} s · ${new Date(last.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`),
      h('p', { class: 'muted small' }, 'Measured from when each box\'s front photo was taken. Pauses over 10 minutes start a new session.')));
  }

  // Removed boxes: history with Restore
  const gone = await removedBoxes();
  if (gone.length) v.append(h('div', { class: 'card' }, h('h3', {}, 'Removed boxes'),
    ...foldRows(gone.slice(0, 20).map(e => h('div', { class: 'row removed' },
      h('div', {}, h('b', {}, e.box.box_label), e.box.box_name ? ` · ${e.box.box_name}` : '', h('div', { class: 'muted small' }, `removed ${new Date(e.box.deleted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${plural(e.cars.length, 'car was', 'cars were')} inside`)),
      h('button', { type: 'button', class: 'small quiet', onclick: async () => { const n = await restoreBox(e); if (n !== false) { toast(`${e.box.box_label} restored · ${plural(n, 'car', 'cars')} back inside`); route(); } } }, 'Restore'))), 3, 'removed boxes')));

  // Box state (sealed / opened / loose), when recorded
  const states = tally(copies.filter(i => i.packaging_state && i.packaging_state !== 'unknown'), i => ({ sealed: 'Sealed', opened: 'Opened', loose: 'Loose' }[i.packaging_state] || i.packaging_state));
  if (states.length) v.append(h('div', { class: 'card' }, h('h3', {}, 'Box state'), barList(states)));
}

// Collection insights (s1-0.41.0). Built from saved values only: AI suggestions not yet tapped are not counted.
function columnChart(points) {
  const max = Math.max(1, ...points.map(p => p.n));
  const top = points.reduce((b, p) => (p.n > b.n ? p : b), points[0]);
  const every = Math.ceil(points.length / 6); // about six date labels under the columns
  return h('div', { class: 'cols', role: 'img', 'aria-label': points.map(p => `${p.label}: ${p.n}`).join(', ') },
    points.map((p, i) => h('div', { class: 'col', title: `${p.label}: ${plural(p.n, 'car', 'cars')}` },
      h('span', { class: 'cn' }, p === top && p.n ? String(p.n) : ''),
      h('span', { class: 'cb' }, h('span', { style: `height:${p.n ? Math.max(4, Math.round((p.n / max) * 100)) : 0}%` })),
      h('span', { class: 'cl' }, i % every === 0 || i === points.length - 1 ? p.label : ''))));
}
async function insightCards(v, { active, copies, byId, photos, brandName, goGarage }) {
  v.append(h('h3', { class: 'secthead' }, '✨ Collection insights'));
  const N = copies.length;
  const modelOf = (i) => byId.get(i.model_id);
  // At a glance: three facts
  const brands = tallyBy(copies, i => brandName[modelOf(i).brand_id] || '');
  const boxesT = tallyBy(copies, i => i.storage_location || '');
  const perModel = tallyBy(copies, i => i.model_id);
  const twins = perModel.filter(([, n]) => n > 1);
  const fact = (big, label, sub, onclick) => h(onclick ? 'button' : 'div', { type: onclick ? 'button' : undefined, class: 'fact', onclick }, h('b', {}, big), h('span', {}, label), sub ? h('span', { class: 'muted small' }, sub) : null);
  v.append(h('div', { class: 'facts' },
    brands.length ? fact(`${share(brands[0][1], N)}%`, brands[0][0], `${plural(brands[0][1], 'car', 'cars')} · top brand`, () => goGarage('all', brands[0][0])) : fact('—', 'Top brand', 'no brands set yet'),
    boxesT.length ? fact(String(boxesT[0][1]), boxesT[0][0], 'fullest storage box', () => goGarage('all', boxesT[0][0])) : fact('—', 'Fullest box', 'no boxes yet'),
    fact(String(twins.length), 'Duplicates', twins.length ? `${plural(twins.length, 'car', 'cars')} owned 2+ times · ${twins.reduce((a, [, n]) => a + n - 1, 0)} extra` : 'none yet')));

  // Cars added over time: the first photo of each car
  const firstShot = new Map();
  for (const p of photos) if (!p.deleted_at && p.captured_at && byId.has(p.model_id)) { const prev = firstShot.get(p.model_id); if (!prev || p.captured_at < prev) firstShot.set(p.model_id, p.captured_at); }
  const g = growthSeries([...firstShot.values()]);
  if (g.points.length) {
    const best = g.points.reduce((b, p) => (p.n > b.n ? p : b), g.points[0]);
    const missing = active.length - g.total;
    v.append(h('div', { class: 'card' }, h('h3', {}, g.unit === 'day' ? 'Cars added per day' : 'Cars added per month'),
      columnChart(g.points),
      h('p', { class: 'muted small', style: 'margin:8px 0 0' }, `Busiest ${g.unit}: ${best.label}, ${plural(best.n, 'car', 'cars')}. From when each car was first photographed${missing > 0 ? ` · ${plural(missing, 'car has', 'cars have')} no photo time` : ''}.`)));
  }

  // By colour (saved colours only)
  const colours = tallyBy(copies, i => modelOf(i).colour_family || '');
  const withColour = colours.reduce((a, [, n]) => a + n, 0);
  if (withColour) v.append(h('div', { class: 'card' }, h('h3', {}, 'By colour'),
    barList(topN(colours.map(([k, n]) => [familyLabel(k) || k, n, k, familySwatch(k)]), 8), { onTap: () => goGarage('colour') }),
    h('p', { class: 'muted small', style: 'margin:8px 0 0' }, `Colour saved for ${withColour} of ${plural(N, 'car', 'cars')}.`)));

  // Car notes: what kind, and who checked them
  const noted = active.filter(r => r.data.car_note && r.data.car_note_source !== 'hidden').map(r => r.data);
  if (noted.length) {
    const kinds = tallyBy(noted, m => noteParts(m.car_note).label);
    const mine = noted.filter(m => m.car_note_source === 'you').length;
    v.append(h('div', { class: 'card' }, h('h3', {}, 'Car notes'), barList(kinds),
      h('p', { class: 'muted small', style: 'margin:8px 0 0' }, `${plural(noted.length, 'car has', 'cars have')} a note, of ${active.length} · ${mine} written or edited by you, ${noted.length - mine} from Gemini.`)));
  }

  // By product line (s1-0.47.0; only when lines are set)
  const lineName = Object.fromEntries((await refData()).lines.map(l => [l.line_id, l.name]));
  const byLine = tallyBy(copies, i => { const m = modelOf(i); return lineName[m.line_id] ? `${brandName[m.brand_id] || ''} · ${lineName[m.line_id]}` : ''; });
  const withLine = byLine.reduce((a, [, n]) => a + n, 0);
  if (withLine) v.append(h('div', { class: 'card' }, h('h3', {}, 'By product line'),
    barList(topN(byLine, 8), { onTap: () => goGarage('line') }),
    h('p', { class: 'muted small', style: 'margin:8px 0 0' }, `Line set for ${withLine} of ${plural(N, 'car', 'cars')}.`)));

  // By model year (only when some years are saved)
  const decades = tallyBy(copies, i => decadeOf(modelOf(i).release_year));
  const withYear = decades.reduce((a, [, n]) => a + n, 0);
  if (withYear) v.append(h('div', { class: 'card' }, h('h3', {}, 'By model year'),
    barList(decades.sort((a, b) => a[0].localeCompare(b[0]))),
    h('p', { class: 'muted small', style: 'margin:8px 0 0' }, `Year saved for ${withYear} of ${plural(N, 'car', 'cars')}.`)));
}

// =====================================================================
// Wishlist (s1-0.42.0): cars B wants, with priority, target price and a link.
// "You may already have this" is a hint from code or name; nothing is changed or merged.
// =====================================================================
const WISHLIST_ON = false; // B, 26 Nov: Wishlist parked until after the shop check (Stage 2)
let wishEdit = null; // wishlist_id being edited, 'new' for the add form, null when closed
async function renderWish(v) {
  const [all, models, inventory, ref] = await Promise.all([store.list('wishlist'), store.list('models'), store.list('inventory'), refData()]);
  const brandName = Object.fromEntries(ref.brands.map(b => [b.brand_id, b.name]));
  const scaleLabel = Object.fromEntries(ref.scales.map(x => [x.scale_id, x.label]));
  const ownedIds = new Set(inventory.filter(i => i.ownership_status === 'Owned').map(i => i.model_id));
  const owned = models.filter(m => !m.deleted_at && ownedIds.has(m.model_id));
  const status = (w) => w.status || 'wanted';
  const wanted = all.filter(w => status(w) === 'wanted').sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const done = all.filter(w => status(w) !== 'wanted').sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  v.append(h('div', { class: 'row' }, h('h2', {}, 'Wishlist'), h('div', { class: 'muted' }, plural(wanted.length, 'car wanted', 'cars wanted'))));
  const priced = wanted.filter(w => priceNum(w.target_price) != null);
  if (wanted.length) v.append(h('p', { class: 'muted small', style: 'margin:0 2px 10px' }, priced.length ? `Target prices add up to ${money(priced.reduce((a, w) => a + priceNum(w.target_price), 0))} · price set for ${priced.length} of ${wanted.length}` : 'No target prices set yet.'));

  const form = (w) => {
    const f = { name: h('input', { type: 'text', placeholder: 'e.g. Nissan Skyline GT-R R34 V-Spec', value: w?.object_name || '', 'aria-label': 'Car name' }),
      brand: h('select', { 'aria-label': 'Brand', onchange: async (e) => { await pickedBrandId(e.target.value, ref.brands, e.target); } }, brandOptions(ref.brands, w?.brand_id || '', 'Brand (optional)')),
      scale: h('select', { 'aria-label': 'Scale' }, h('option', { value: '' }, 'Scale (optional)'), ref.scales.map(x => h('option', { value: x.scale_id, selected: x.scale_id === w?.scale_id ? true : undefined }, x.label))),
      code: h('input', { type: 'text', placeholder: 'Product code (optional)', value: w?.product_code || '', 'aria-label': 'Product code' }),
      price: h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Target price ₹ (optional)', value: w?.target_price || '', 'aria-label': 'Target price in rupees' }),
      url: h('input', { type: 'url', placeholder: 'Link to a listing (optional)', value: w?.purchase_url || '', 'aria-label': 'Link' }),
      notes: h('textarea', { rows: 2, placeholder: 'Notes (optional): colour, shop, who has it…', 'aria-label': 'Notes' }, w?.notes || '') };
    let prio = w?.priority || 'medium';
    const prioRow = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Priority' });
    const drawPrio = () => prioRow.replaceChildren(h('span', { class: 'muted small', style: 'align-self:center;margin-right:4px' }, 'Priority'),
      ...PRIORITIES.map(([k, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(prio === k), class: `chip ${prio === k ? 'on' : ''}`, onclick: () => { prio = k; drawPrio(); } }, label)));
    drawPrio();
    const save = async () => {
      const name = f.name.value.trim();
      if (!name) { toast('Give the car a name first', 2200, 'bad'); f.name.focus(); return; }
      if (f.price.value.trim() && priceNum(f.price.value) == null) { toast('Target price should be a number', 2200, 'bad'); f.price.focus(); return; }
      if (f.url.value.trim() && !safeUrl(f.url.value)) { toast('That link doesn\'t look like a web address', 2400, 'bad'); f.url.focus(); return; }
      const brandId = f.brand.value.startsWith('known:') || f.brand.value === '__new' ? '' : f.brand.value;
      const fields = { object_name: name, brand_id: brandId, scale_id: f.scale.value, product_code: f.code.value.trim(), target_price: f.price.value.trim() ? String(priceNum(f.price.value)) : '', target_currency: 'INR',
        priority: prio, purchase_url: f.url.value.trim() ? safeUrl(f.url.value) : '', notes: f.notes.value.trim() };
      if (w) await store.update('wishlist', w.wishlist_id, fields);
      else await store.create('wishlist', { ...fields, status: 'wanted' });
      wishEdit = null; toast(w ? 'Saved ✓' : `${name} added to your wishlist ⭐`); autoSyncSoon(); route();
    };
    return h('div', { class: 'card wishform' }, h('h3', {}, w ? 'Edit' : 'Add a car you want'), f.name,
      h('div', { class: 'grid2' }, f.brand, f.scale), h('div', { class: 'grid2' }, f.code, f.price), prioRow, f.url, f.notes,
      h('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' }, h('button', { type: 'button', class: 'quiet', onclick: () => { wishEdit = null; route(); } }, 'Cancel'), h('button', { type: 'button', class: 'primary', onclick: save }, w ? 'Save' : 'Add to wishlist')));
  };

  if (wishEdit === 'new') v.append(form(null));
  else v.append(h('button', { type: 'button', class: 'wide', onclick: () => { wishEdit = 'new'; route(); } }, '＋ Add a car you want'));

  const setStatus = async (w, st, msg) => { await store.update('wishlist', w.wishlist_id, { status: st }); toast(msg); autoSyncSoon(); route(); };
  const card = (w) => {
    if (wishEdit === w.wishlist_id) return form(w);
    const st = status(w);
    const facts = [brandName[w.brand_id], scaleLabel[w.scale_id], w.product_code].filter(Boolean).join(' · ');
    const url = safeUrl(w.purchase_url);
    const matches = st === 'wanted' ? ownedMatches(w, owned) : [];
    const pr = PRIORITIES.find(p => p[0] === w.priority);
    return h('div', { class: `card wish ${st}` },
      h('div', { class: 'row', style: 'align-items:flex-start;gap:8px' },
        h('div', { style: 'flex:1;min-width:0' }, h('b', { class: 'wname' }, w.object_name || '(no name)'), facts ? h('div', { class: 'muted small' }, facts) : null),
        st === 'wanted' && pr ? h('span', { class: `prio p-${pr[0]}` }, pr[1]) : h('span', { class: 'prio' }, st === 'got' ? 'Got it ✓' : 'Dropped')),
      priceNum(w.target_price) != null || url ? h('div', { class: 'row small', style: 'gap:12px;justify-content:flex-start;margin-top:6px' },
        priceNum(w.target_price) != null ? h('span', {}, 'Target ', h('b', {}, money(priceNum(w.target_price)))) : null,
        url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, `Open link ↗`) : null) : null,
      w.notes ? h('p', { class: 'small', style: 'margin:6px 0 0;white-space:pre-wrap' }, w.notes) : null,
      matches.length ? h('div', { class: 'banner warn wmatch' }, h('b', {}, matches[0].reason === 'code' ? 'You already have this code' : 'You may already have this'), ' · ',
        ...matches.slice(0, 3).flatMap((x, i) => [i ? ', ' : '', h('a', { href: `#/item/${encodeURIComponent(x.model.model_id)}` }, x.model.display_name || x.model.product_code || 'a car')]),
        matches.length > 3 ? ` and ${matches.length - 3} more` : '') : null,
      h('div', { class: 'row wacts' },
        st === 'wanted' ? h('button', { type: 'button', class: 'small', onclick: () => setStatus(w, 'got', `${w.object_name}: got it ✓ Add it in Quick capture when it arrives.`) }, '✓ Got it') : h('button', { type: 'button', class: 'small quiet', onclick: () => setStatus(w, 'wanted', 'Back on your wishlist') }, 'Want again'),
        h('button', { type: 'button', class: 'small quiet', onclick: () => { wishEdit = w.wishlist_id; route(); } }, 'Edit'),
        st === 'wanted' ? h('button', { type: 'button', class: 'small quiet', onclick: () => setStatus(w, 'dropped', 'Moved to Got / dropped') }, 'Not any more') :
          h('button', { type: 'button', class: 'small quiet', onclick: async () => { if (!confirm(`Remove "${w.object_name}" from the wishlist?`)) return; await store.archive('wishlist', w.wishlist_id); toast('Removed'); autoSyncSoon(); route(); } }, 'Remove')));
  };
  if (!all.length && wishEdit !== 'new') v.append(h('p', { class: 'muted', style: 'margin-top:14px' }, 'Nothing here yet. Add a car you\'re hunting for: if you already own one like it, the app tells you.'));
  for (const g of [['high', 'High priority'], ['medium', 'Medium'], ['low', 'Low']]) {
    const items = wanted.filter(w => (w.priority || 'medium') === g[0]);
    if (items.length) v.append(h('div', { class: 'ghead' }, h('span', { class: 'g-name' }, g[1]), h('span', { class: 'g-count' }, String(items.length))), ...items.map(card));
  }
  if (done.length) v.append(h('details', { class: 'more', style: 'margin-top:14px' }, h('summary', {}, `Got / dropped · ${done.length}`), ...done.map(card)));
  if (wishEdit && wishEdit !== 'new') setTimeout(() => v.querySelector('.wishform')?.scrollIntoView({ block: 'center' }), 0);
}

// Product lines (s1-0.47.0): a new line under a brand, logged; lines group and count only (no duplicate-check change)
async function newLine(brandId, name) {
  const t = cleanLineName(name); if (!t || !brandId) return null;
  const lines = (await store.list('product_lines')).filter(l => l.brand_id === brandId);
  const same = lines.find(l => l.name.toLowerCase() === t.toLowerCase()); if (same) return same;
  const l = await store.create('product_lines', { brand_id: brandId, name: t, is_code_namespace: 'no', code_prefix_hint: '', record_status: 'confirmed' });
  await store.logChange('product_lines', l.line_id, 'name', '', t, 'line added in app'); autoSyncSoon(); return l;
}

// Confirm a brand (D10.1 rule 4): its cars get their code namespace and become checkable for duplicates.
async function confirmBrand(b, models, why) {
  await store.update('brands', b.brand_id, { record_status: 'confirmed' });
  for (const m of models.filter(x => x.brand_id === b.brand_id && !x.deleted_at)) { const ns = assignNamespace({ ...b, record_status: 'confirmed' }, null); const patch = { code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status }; patch.duplicate_check_status = duplicateCheckStatus({ ...m, ...patch }); await store.update('models', m.model_id, patch); }
  await store.logChange('brands', b.brand_id, 'record_status', 'needs_review', 'confirmed', why); autoSyncSoon();
}

// =====================================================================
// Needs review (s1-0.46.0): everything the app isn't sure about, in one list, each with a one-tap fix.
// "Not a problem" is remembered on this device and comes back if the value changes.
// =====================================================================
async function reviewItems() {
  const [models, ref, ids, sugg, dismissed] = await Promise.all([store.list('models'), refData(), store.list('product_identifiers'), meta.get('aiSuggest', {}), meta.get('reviewDismissed', {})]);
  const live = models.filter(m => !m.deleted_at);
  return { items: buildReview({ models: live, brands: ref.brands, ids, sugg, dismissed }), live, ref, dismissed };
}
async function renderReview(v) {
  const { items, live, ref, dismissed } = await reviewItems();
  v.append(h('a', { href: '#/dash', class: 'back' }, '← Dashboard'));
  v.append(h('div', { class: 'row' }, h('h2', {}, 'Needs review'), h('div', { class: 'muted' }, items.length ? plural(items.length, 'thing', 'things') : '')));
  v.append(h('p', { class: 'muted small', style: 'margin:0 2px 12px' }, 'Things the app isn\'t sure about, so it won\'t guess. Nothing changes until you tap.'));
  if (!items.length) { v.append(h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'Nothing needs review ✓'), Object.keys(dismissed).length ? h('p', { class: 'muted small', style: 'margin:6px 0 0' }, `${plural(Object.keys(dismissed).length, 'item', 'items')} marked "Not a problem".`) : null)); return; }
  const dismiss = async (key) => { const d = { ...(await meta.get('reviewDismissed', {})) }; d[key] = new Date().toISOString(); await meta.set('reviewDismissed', d); toast('Marked "Not a problem"'); route(); };
  const openCar = (mid) => { location.hash = `#/item/${encodeURIComponent(mid)}`; };
  const ICON = { brand: '🏷', dupe: '⧉', alike: '≈', unsure: '?', shape: '⚠' };
  const HEAD = { brand: 'Brands to confirm', dupe: 'Same car twice?', alike: 'Look-alike brands', unsure: 'Codes Gemini wasn\'t sure of', shape: 'Unusual codes' };
  let last = null;
  for (const it of items) {
    if (it.kind !== last) { last = it.kind; v.append(h('div', { class: 'ghead' }, h('span', { class: 'g-name' }, HEAD[it.kind]), h('span', { class: 'g-count' }, String(items.filter(x => x.kind === it.kind).length)))); }
    const acts = [];
    if (it.kind === 'brand') {
      const b = ref.brands.find(x => x.brand_id === it.brand_id);
      acts.push(h('button', { type: 'button', class: 'small', onclick: async () => { await confirmBrand(b, live, 'confirmed in Needs review'); toast(`${b.name} confirmed ✓ ${plural(it.n, 'car', 'cars')} can now be checked`, 3000); route(); } }, `✓ ${b.name} is right`),
        h('button', { type: 'button', class: 'small quiet', onclick: () => { brandOpen = it.brand_id; location.hash = '#/brands'; } }, 'Rename or merge'));
    } else if (it.kind === 'alike') {
      acts.push(h('button', { type: 'button', class: 'small', onclick: () => { brandOpen = it.brand_ids[1]; location.hash = '#/brands'; } }, 'Merge on Brands'),
        h('button', { type: 'button', class: 'small quiet', onclick: () => dismiss(it.key) }, 'Different brands'));
    } else if (it.kind === 'dupe') {
      acts.push(h('button', { type: 'button', class: 'small', onclick: () => { mergeFor = it.model_ids[0]; openCar(it.model_ids[0]); } }, 'Compare & merge'),
        h('button', { type: 'button', class: 'small quiet', onclick: () => dismiss(it.key) }, 'Not the same car'));
    } else {
      acts.push(h('button', { type: 'button', class: 'small', onclick: () => openCar(it.model_id) }, 'Open car'),
        h('button', { type: 'button', class: 'small quiet', onclick: () => dismiss(it.key) }, it.kind === 'shape' ? 'The code is right' : 'Not a problem'));
    }
    v.append(h('div', { class: `card review r-${it.kind}` },
      h('div', { class: 'row', style: 'align-items:flex-start;gap:10px;justify-content:flex-start' }, h('span', { class: 'rv-ic', 'aria-hidden': 'true' }, ICON[it.kind]),
        h('div', { style: 'flex:1;min-width:0' }, h('b', {}, it.title), h('div', { class: 'muted small' }, it.detail))),
      h('div', { class: 'row', style: 'gap:8px;justify-content:flex-start;flex-wrap:wrap;margin-top:10px' }, acts)));
  }
}

// =====================================================================
// Orders and money (s1-0.48.0, D12.1): events per copy, order shipping split, totals with coverage.
// =====================================================================
const rupees = (n) => (n == null ? 'not computable' : `${n < 0 ? '−' : ''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`);
function moneyBlock(c, txs) {
  const m = copyMoney(c, txs);
  const box = h('div', { class: 'moneyblk' }, h('div', { class: 'muted small', style: 'font-weight:600;margin:14px 0 4px' }, 'Money and history'));
  const parts = [m.price == null ? 'Price unknown' : `Paid ${rupees(m.price)}`, m.extra ? `+ ${rupees(m.extra)} shipping/fees` : '', m.refunds ? `− ${rupees(m.refunds)} refund` : ''].filter(Boolean).join(' ');
  box.append(h('p', { class: 'small', style: 'margin:0' }, parts, m.price != null && (m.extra || m.refunds) ? h('b', {}, ` = ${rupees(m.tac)} cost`) : null));
  if (m.expenses) box.append(h('p', { class: 'small', style: 'margin:2px 0 0' }, `Repairs / extras: ${rupees(m.expenses)} (shown apart; not part of the cost)`));
  if (m.disposal && m.disposal.transaction_type !== 'GIFT_OUT') box.append(h('p', { class: 'small', style: 'margin:2px 0 0' }, `${eventLabel(m.disposal.transaction_type)}: ${rupees(m.proceeds)} after fees`, h('b', {}, m.gain == null ? ' · gain not computable' : ` · ${m.gain >= 0 ? 'gain' : 'loss'} ${rupees(Math.abs(m.gain))}`), m.gain == null ? null : h('span', { class: 'muted' }, ` (vs ${m.base})`)));
  const list = txs.filter(t => !t.deleted_at).sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)));
  for (const t of list) box.append(h('div', { class: 'txrow' }, h('span', {}, h('b', {}, eventLabel(t.transaction_type)), ` · ${t.transaction_date || 'date unknown'}`, moneyNum(t.amount) != null ? ` · ${rupees(moneyNum(t.amount))}` : '', t.counterparty ? ` · ${t.counterparty}` : '', t.notes ? h('span', { class: 'muted' }, ` · ${t.notes}`) : null),
    h('button', { type: 'button', class: 'quiet small', onclick: async () => {
      if (!confirm(`Undo "${eventLabel(t.transaction_type)}"?`)) return;
      await store.archive('transactions', t.transaction_id);
      const st = (EVENT_TYPES.find(e => e[0] === t.transaction_type) || [])[2];
      if (st && c.ownership_status === st) { await store.update('inventory', c.inventory_id, { ownership_status: 'Owned' }); await store.logChange('inventory', c.inventory_id, 'ownership_status', st, 'Owned', 'event undone'); }
      autoSyncSoon(); toast('Undone'); route(); } }, 'Undo')));
  const form = h('div', { class: 'txform', hidden: true });
  const type = h('select', { 'aria-label': 'What happened' }, EVENT_TYPES.map(([k, label]) => h('option', { value: k }, label)));
  const date = h('input', { type: 'date', value: todayIso(), 'aria-label': 'Date' });
  const amt = h('input', { inputmode: 'decimal', placeholder: 'Amount ₹', 'aria-label': 'Amount' });
  const fees = h('input', { inputmode: 'decimal', placeholder: 'Selling fees + postage you paid ₹ (optional)', 'aria-label': 'Fees' });
  const who = h('input', { placeholder: 'Who / where (optional)', 'aria-label': 'Who' });
  const note = h('input', { placeholder: 'Note (optional)', 'aria-label': 'Note' });
  const hint = h('div', { class: 'muted small' });
  const sync = () => { const e = EVENT_TYPES.find(x => x[0] === type.value); amt.hidden = !e[3]; amt.placeholder = e[3]; fees.hidden = type.value !== 'SALE';
    hint.textContent = e[2] ? `This copy will show as ${e[2]} and drop out of your owned counts. You can undo it.` : ''; };
  type.addEventListener('change', sync); sync();
  form.append(type, date, amt, fees, who, note, hint, h('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' },
    h('button', { type: 'button', class: 'quiet', onclick: () => { form.hidden = true; addBtn.hidden = false; } }, 'Cancel'),
    h('button', { type: 'button', onclick: async () => {
      const e = EVENT_TYPES.find(x => x[0] === type.value);
      const a = amt.value.trim(); if (e[3] && a && moneyNum(a) == null) { toast('Amount should be a number', 2200, 'bad'); return; }
      if (['SALE', 'REFUND', 'EXPENSE', 'TRADE_OUT'].includes(e[0]) && !a) { toast('Add the amount (₹)', 2200, 'bad'); amt.focus(); return; }
      if (fees.value.trim() && moneyNum(fees.value) == null) { toast('Fees should be a number', 2200, 'bad'); return; }
      await store.create('transactions', { inventory_id: c.inventory_id, transaction_type: e[0], transaction_date: date.value, amount: a ? String(moneyNum(a)) : '', currency: 'INR', fees: fees.value.trim() ? String(moneyNum(fees.value)) : '', counterparty: who.value.trim(), notes: note.value.trim() });
      if (e[2] && c.ownership_status !== e[2]) { await store.update('inventory', c.inventory_id, { ownership_status: e[2] }); await store.logChange('inventory', c.inventory_id, 'ownership_status', c.ownership_status, e[2], `event: ${e[1]}`); }
      autoSyncSoon(); toast(`${e[1]} saved ✓`); route(); } }, 'Save event')));
  const addBtn = h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: () => { form.hidden = false; addBtn.hidden = true; } }, '＋ Sold, gift, refund, repair…');
  box.append(addBtn, form);
  return box;
}

// Split an order's shipping/fees over several copies (by price; equal if a price is missing). Shares editable.
async function renderOrder(v) {
  const [inventory, models, orders] = await Promise.all([store.list('inventory'), store.list('models'), store.list('orders')]);
  const name = new Map(models.filter(m => !m.deleted_at).map(m => [m.model_id, m.display_name || m.product_code || 'Car with no name yet']));
  const cand = inventory.filter(i => i.ownership_status === 'Owned' && name.has(i.model_id)).sort((a, b) => String(b.purchase_date || '').localeCompare(String(a.purchase_date || '')) || String(b.created_at).localeCompare(String(a.created_at)));
  v.append(h('a', { href: '#/dash', class: 'back' }, '← Dashboard'), h('h2', {}, 'Split an order\'s shipping'),
    h('p', { class: 'muted small', style: 'margin:0 2px 12px' }, 'One parcel, several cars: type the shipping and fees once, tick the cars, and each car gets its share (by price; equal if a price is missing). Prices are never changed.'));
  const vendor = h('input', { placeholder: 'Shop / seller (optional)', 'aria-label': 'Vendor' });
  const odate = h('input', { type: 'date', value: todayIso(), 'aria-label': 'Order date' });
  const ship = h('input', { inputmode: 'decimal', placeholder: 'Shipping + fees for the whole order ₹', 'aria-label': 'Order shipping total' });
  const picked = new Set(); const manual = new Map();
  const preview = h('div');
  const listEl = h('div', { class: 'card orderlist' });
  const draw = () => {
    const sel = cand.filter(i => picked.has(i.inventory_id));
    const total = moneyNum(ship.value);
    const shares = total != null && sel.length ? splitByPrice(total, sel.map(i => i.purchase_price)) : [];
    const used = sel.map((i, k) => manual.has(i.inventory_id) ? moneyNum(manual.get(i.inventory_id)) ?? 0 : shares[k] ?? 0);
    const sum = Math.round(used.reduce((a, b) => a + b, 0) * 100) / 100;
    preview.replaceChildren(sel.length && total != null ? h('div', { class: 'card' }, h('h3', {}, `${plural(sel.length, 'car', 'cars')} · ${rupees(total)}`),
      ...sel.map((i, k) => h('div', { class: 'txrow' }, h('span', {}, name.get(i.model_id), h('span', { class: 'muted small' }, ` · ${moneyNum(i.purchase_price) != null ? rupees(moneyNum(i.purchase_price)) : 'price unknown'}`)),
        h('input', { class: 'share', inputmode: 'decimal', value: String(used[k]), 'aria-label': `Share for ${name.get(i.model_id)}`, onchange: (e) => { manual.set(i.inventory_id, e.target.value); draw(); } }))),
      Math.abs(sum - total) > 0.009 ? h('div', { class: 'banner warn', style: 'margin-top:8px' }, `Shares add up to ${rupees(sum)}, not ${rupees(total)}.`) : null,
      sel.some(i => moneyNum(i.purchase_price) == null) ? h('p', { class: 'muted small' }, 'A price is missing, so the split is equal.') : null,
      sel.some(i => i.order_id) ? h('p', { class: 'muted small' }, 'Some cars are already in an order: saving replaces their shipping share.') : null,
      h('button', { type: 'button', class: 'wide', style: 'margin-top:10px', onclick: async () => {
        const o = await store.create('orders', { vendor: vendor.value.trim(), order_date: odate.value, currency: 'INR', shipping_total: String(total), fees_total: '', notes: '' });
        for (const [k, i] of sel.entries()) { await store.update('inventory', i.inventory_id, { order_id: o.order_id, acquisition_costs: String(used[k]) }); await store.logChange('inventory', i.inventory_id, 'acquisition_costs', i.acquisition_costs || '', String(used[k]), `order ${o.order_id}`); }
        autoSyncSoon(); toast(`Order saved ✓ shipping split over ${plural(sel.length, 'car', 'cars')}`, 3000); location.hash = '#/dash'; } }, 'Save order')) : '');
  };
  ship.addEventListener('input', () => { manual.clear(); draw(); });
  listEl.append(h('h3', {}, 'Which cars came in it?'), ...cand.slice(0, 80).map(i => h('label', { class: 'pickrow' }, h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? picked.add(i.inventory_id) : picked.delete(i.inventory_id); manual.clear(); draw(); } }),
    h('span', {}, name.get(i.model_id), h('span', { class: 'muted small' }, ` · ${[i.purchase_date, moneyNum(i.purchase_price) != null ? rupees(moneyNum(i.purchase_price)) : 'price unknown', i.storage_location].filter(Boolean).join(' · ')}`)))));
  v.append(h('div', { class: 'card', style: 'display:grid;gap:8px' }, vendor, odate, ship), listEl, preview);
  if (orders.length) v.append(h('p', { class: 'muted small' }, `${plural(orders.filter(o => !o.deleted_at).length, 'order', 'orders')} saved so far.`));
}

// =====================================================================
// Share into the app (s1-0.49.0, D16): photos/text shared from WhatsApp or the gallery.
// "Do I own this?" reads barcodes from the photos and codes from the text; "Add to garage" hands the photos to Import.
// Shared items stay on this phone (cache 'smg-share') and are cleared after use.
// =====================================================================
async function sharedItems() {
  if (!('caches' in window)) return { files: [], meta: null };
  const c = await caches.open('smg-share');
  const sharedUrl = (k) => new URL(`shared/${k}`, location.href.split('#')[0]).href;
  const metaRes = await c.match(sharedUrl('meta')); if (!metaRes) return { files: [], meta: null };
  const meta = await metaRes.json(); const files = [];
  for (let i = 0; i < (meta.n || 0); i++) { const r = await c.match(sharedUrl(i)); if (!r) continue; const b = await r.blob();
    files.push(new File([b], decodeURIComponent(r.headers.get('X-Name') || `photo-${i}.jpg`), { type: b.type || 'image/jpeg', lastModified: Number(r.headers.get('X-Modified')) || Date.now() + i })); }
  return { files: imagesOnly(files), meta };
}
const clearShared = async () => { try { await caches.delete('smg-share'); } catch { /* nothing to clear */ } };
let shareResult = null; // { lines: [...] } after "Do I own this?"
async function renderShare(v) {
  const { files, meta } = await sharedItems();
  v.append(h('a', { href: '#/', class: 'back' }, '← Garage'), h('h2', {}, 'Shared with Garage'));
  if (!meta || (!files.length && !meta.text && !meta.title)) {
    v.append(h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'Nothing shared right now.'), h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'From WhatsApp or your gallery: tap Share → Garage. Photos of a box (front, then back) work best.')));
    return;
  }
  const text = [meta.title, meta.text, meta.url].filter(Boolean).join(' ');
  const urls = files.map(f => URL.createObjectURL(f));
  v.append(h('div', { class: 'card' },
    files.length ? h('div', { class: 'sharegrid' }, urls.map(u => h('img', { src: u, alt: 'Shared photo' }))) : null,
    text ? h('p', { class: 'small', style: 'margin:8px 0 0;white-space:pre-wrap;word-break:break-word' }, text.slice(0, 400)) : null,
    h('p', { class: 'muted small', style: 'margin:8px 0 0' }, `${plural(files.length, 'photo', 'photos')}${text ? ' + text' : ''} · kept on this phone only`)));
  const res = h('div');
  v.append(h('div', { class: 'row sharebtns' },
    h('button', { type: 'button', onclick: async () => {
      res.replaceChildren(h('p', { class: 'muted' }, 'Checking…'));
      const [models, ids, inventory] = await Promise.all([store.list('models'), store.list('product_identifiers'), store.list('inventory')]);
      const live = models.filter(m => !m.deleted_at);
      const owned = new Map(); inventory.filter(i => i.ownership_status === 'Owned').forEach(i => (owned.get(i.model_id) || owned.set(i.model_id, []).get(i.model_id)).push(i));
      const found = new Map(); const read = [];
      for (const f of files) { try { const r = await scanPhoto(f); if (r) read.push(barcodeCmp(String(r.value).trim())); } catch { /* not readable */ } }
      const { codes, barcodes } = extractCodes(text);
      const bcs = [...new Set([...read, ...barcodes.map(barcodeCmp)])].filter(Boolean);
      for (const i of ids) if (!i.deleted_at && i.identifier_type === 'barcode' && bcs.includes(i.value_cmp)) found.set(i.model_id, 'same barcode');
      for (const m of live) if (m.product_code && codes.some(c => codeCmp(c) === codeCmp(m.product_code))) found.set(m.model_id, found.has(m.model_id) ? 'same barcode and code' : 'same code');
      const hits = [...found].map(([id, why]) => ({ m: live.find(x => x.model_id === id), why })).filter(x => x.m);
      res.replaceChildren(h('div', { class: `card ${hits.length ? 'own-yes' : 'own-no'}` },
        h('h3', {}, hits.length ? `✅ You have ${hits.length === 1 ? 'this' : `${hits.length} matches`}` : '❓ Not found by barcode or code'),
        ...hits.map(({ m, why }) => { const cs = owned.get(m.model_id) || []; return h('a', { class: 'txrow', href: `#/item/${encodeURIComponent(m.model_id)}` },
          h('span', {}, h('b', {}, m.display_name || m.product_code || 'Car with no name yet'), h('span', { class: 'muted small' }, ` · ${why} · ${cs.length ? `${plural(cs.length, 'copy', 'copies')} owned${cs[0].storage_location ? ` · ${cs[0].storage_location}` : ''}` : 'not owned now'}`)), h('span', { class: 'chev' }, '›')); }),
        h('p', { class: 'muted small', style: 'margin:8px 0 0' }, [
          `Read: ${bcs.length ? plural(bcs.length, 'barcode', 'barcodes') : 'no barcode'}${codes.length ? `, code ${codes.slice(0, 3).join(', ')}` : ''}.`,
          hits.length ? '' : ' This only checks barcodes and codes: a car you saved without either can\'t be ruled out. Try a search by name.'].join('')),
        h('button', { type: 'button', class: 'quiet small', onclick: () => { garageFilter = 'all'; garageSearch = codes[0] || (meta.title || meta.text || '').split(/\s+/).slice(0, 3).join(' '); location.hash = '#/'; } }, 'Search my garage')));
    } }, '🔍 Do I own this?'),
    files.length ? h('button', { type: 'button', class: 'ghost', onclick: async () => {
      importFiles?.forEach(f => URL.revokeObjectURL(f.url));
      importFiles = files.slice().sort((a, b) => (a.lastModified - b.lastModified) || a.name.localeCompare(b.name)).map(file => ({ file, url: URL.createObjectURL(file) }));
      importSwap = false; await clearShared(); location.hash = '#/import'; } }, '＋ Add to garage') : null,
    h('button', { type: 'button', class: 'quiet', onclick: async () => { await clearShared(); toast('Cleared'); location.hash = '#/'; } }, 'Clear')));
  v.append(res);
}

async function renderGarage(v) {
  const config = await getConfig();
  if (!helperInfo && (!getClientId() || !config)) {
    v.append(h('div', { class: 'banner info' }, 'Welcome! Start in ', h('a', { href: '#/settings' }, 'Settings'), ': sign in with Google once, and the app sets up your SCALE GARAGE folder and sheet. You can also start capturing offline right away.'));
  }
  const [models, inventory, photos, ids, ref] = await Promise.all([store.listRecords('models'), store.list('inventory'), store.list('photos'), store.list('product_identifiers'), refData()]);
  const names = await boxNames();
  const brandName = Object.fromEntries(ref.brands.map(b => [b.brand_id, b.name]));
  brandNameCache = brandName; scaleLabelCache = Object.fromEntries(ref.scales.map(x => [x.scale_id, x.label]));
  const lineName = Object.fromEntries(ref.lines.filter(l => !l.deleted_at).map(l => [l.line_id, l.name]));
  const scaleLabel = Object.fromEntries(ref.scales.map(s => [s.scale_id, s.label]));
  const active = models.filter(r => !r.data.deleted_at);
  const archived = models.filter(r => r.data.deleted_at);
  const activeIds = new Set(active.map(r => r.id));
  const copies = inventory.filter(i => i.ownership_status === 'Owned' && activeIds.has(i.model_id)); // archived models don't count
  v.append(h('div', { class: 'row' }, h('h2', {}, 'My Garage'), h('div', { class: 'muted', style: 'text-align:right' }, `${plural(active.length, 'model', 'models')} · ${plural(copies.length, 'copy', 'copies')}`)));
  // Overview (B, 24 Nov): how far the backlog has got, and how many storage boxes are in use.
  const est = collectionEstimate();
  const boxesUsed = new Set(copies.map(i => i.storage_location).filter(Boolean)).size;
  const pct = Math.min(100, Math.round((copies.length / est) * 100));
  v.append(h('div', { class: 'overview' },
    h('div', { class: 'ovtext' }, h('b', {}, plural(copies.length, 'box', 'boxes')), ' catalogued', boxesUsed ? ` · ${plural(boxesUsed, 'storage box', 'storage boxes')} in use` : ''),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'rough progress' }, h('span', { style: `width:${Math.max(pct, copies.length ? 1 : 0)}%` }))));
  const nameless = active.filter(r => !String(r.data.display_name || '').trim()).length;
  const search = h('input', { type: 'search', placeholder: 'Search cars, codes, brands, boxes', value: garageSearch, oninput: (e) => { garageSearch = e.target.value; draw(); } });
  v.append(search);
  // The shelf on the home screen (B, 24 Nov): tap a box to see what's inside; tap it again for everything.
  {
    const used = await boxesInUse();
    const sel = (garageSearch.trim().match(/^box\s*[a-z0-9-]+$/i) || [''])[0];
    v.append(h('div', { class: 'shelfhome' }, h('div', { class: 'row' }, h('h3', {}, 'Storage boxes'), sel ? h('button', { type: 'button', class: 'quiet small', onclick: () => { garageSearch = ''; route(); } }, 'Show all') : null),
      shelfEl(used, names, (k, isSel) => { garageFilter = 'all'; garageSearch = isSel ? '' : k; route(); },
        { selected: sel, scroll: true, onNew: async () => { const label = await newBox(); garageFilter = 'all'; garageSearch = label; toast(`${label} added`); route(); } })));
    if (sel) setTimeout(() => document.querySelector('.shelfhome .boxtile.sel')?.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
  }
  if (!garageSearch.trim() && garageFilter === 'all') { const cd = await carOfTheDay(active.map(r => r.data), photos, names); if (cd) v.append(cd); }
  if (nameless) v.append(h('a', { href: '#/name', class: 'namelink' }, `✎ ${plural(nameless, 'box needs', 'boxes need')} a name: name them`, h('span', { 'aria-hidden': 'true' }, ' ›')));
  const photosByModel = new Map();
  photos.forEach(p => { if (p.model_id) (photosByModel.get(p.model_id) || photosByModel.set(p.model_id, []).get(p.model_id)).push(p); });
  const isPending = (r) => r.dirty || (photosByModel.get(r.data.model_id) || []).some(p => !p.original_file_id);
  // One scrolling row of filters (audit G5); a filter only appears when it has something in it.
  const checkCtx = checkContext(active.map(r => r.data), inventory, ids, photos);
  const n = { noname: active.filter(r => !String(r.data.display_name || '').trim()).length, review: active.filter(r => r.data.namespace_status === 'needs_review').length, pending: active.filter(isPending).length, clash: active.filter(r => r.conflict).length, archived: archived.length };
  if (n[garageFilter] === 0) garageFilter = 'all'; // e.g. after restoring the last archived model, don't leave an empty list
  const filters = [['all', 'All'], ['box', 'By box'], ['brand', 'By brand'], ['scale', 'By scale'], ['colour', 'By colour'], ...(active.some(r => r.data.line_id) ? [['line', 'By line']] : []), ['quick', 'Quick'], ['noname', `Needs a name (${n.noname})`, n.noname], ['review', `Needs review (${n.review})`, n.review], ['pending', `Waiting to sync (${n.pending})`, n.pending], ['clash', `Clashes (${n.clash})`, n.clash], ['archived', `Archived (${n.archived})`, n.archived],
    ...CHECKS.filter(c => c[0] === garageFilter).map(c => [c[0], `${c[1]} ✕`, 1])]
    .filter(([k, , c]) => c === undefined || c > 0 || garageFilter === k);
  const chips = h('div', { class: 'chips scroll', style: 'margin:10px 0' }, filters.map(([k, label]) => h('button', { class: `chip ${garageFilter === k ? 'on' : ''}`, onclick: () => { garageFilter = garageFilter === k && CHECKS.some(c => c[0] === k) ? 'all' : k; route(); } }, label)));
  v.append(chips);
  if (garageFilter === 'nobarcode') v.append(recheckCard(draw)); // s1-0.54.0: re-read saved rear photos
  // View + sort bar (s1-0.44.0)
  const sortSel = h('select', { class: 'sortsel', 'aria-label': 'Sort cars', onchange: (e) => { garageSort = e.target.value; lsSet('smg.garageSort', garageSort); draw(); } },
    SORTS.map(([k, label]) => h('option', { value: k, selected: k === garageSort ? true : undefined }, label)));
  const viewBtn = (k, label, ico) => h('button', { type: 'button', class: `seg ${garageView === k ? 'on' : ''}`, 'aria-pressed': String(garageView === k), 'aria-label': label, title: label,
    onclick: (e) => { garageView = k; lsSet('smg.garageView', k); grid.classList.toggle('list', k === 'list'); viewBar.querySelectorAll('.seg').forEach(b => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); } }, ico, h('span', {}, label));
  const viewBar = h('div', { class: 'viewbar' }, h('div', { class: 'segs', role: 'group', 'aria-label': 'Show as' }, viewBtn('grid', 'Photos', '▦'), viewBtn('list', 'List', '☰')), sortSel);
  v.append(viewBar);
  const boxHead = h('div');
  const grid = h('div', { class: `grid${garageView === 'list' ? ' list' : ''}` });
  v.append(boxHead, grid);
  const storageByModel = new Map();
  inventory.forEach(i => { if (i.storage_location) storageByModel.set(i.model_id, `${storageByModel.get(i.model_id) || ''} ${i.storage_location}`); });
  const barcodesByModel = new Map();
  ids.forEach(i => { if (!i.deleted_at && (i.identifier_type === 'barcode' || i.identifier_type === 'second_code')) (barcodesByModel.get(i.model_id) || barcodesByModel.set(i.model_id, []).get(i.model_id)).push(i.value_raw, i.value_cmp); });
  // Owned copies per model, built once (perf: the list used to scan every copy for every car).
  const ownedByModel = new Map();
  inventory.forEach(i => { if (i.ownership_status === 'Owned') (ownedByModel.get(i.model_id) || ownedByModel.set(i.model_id, []).get(i.model_id)).push(i); });
  const modelById = new Map(models.map(r => [r.id, r.data]));
  const PAGE = 120;
  let shown = PAGE, lastQuery = null;

  async function draw() {
    grid.replaceChildren();
    const q = garageSearch.trim().toLowerCase();
    if (q !== lastQuery) { shown = PAGE; lastQuery = q; } // a new search starts at the top again
    const boxesMemo = new Map();
    const boxesOf = (mid) => { let b = boxesMemo.get(mid); if (!b) { b = [...new Set((ownedByModel.get(mid) || []).map(i => i.storage_location).filter(Boolean))].sort(new Intl.Collator(undefined, { numeric: true }).compare); boxesMemo.set(mid, b); } return b; };
    const cmp = sortCompare(garageSort, { brandOf: (m) => brandName[m.brand_id] || m.printed_brand_text || '', boxOf: (m) => boxesOf(m.model_id)[0] || '' });
    let list = (garageFilter === 'archived' ? archived : active).slice().sort((a, b) => cmp(a.data, b.data));
    list = list.filter(r => {
      const m = r.data;
      if (garageFilter === 'quick' && m.completeness_status !== 'quick') return false;
      if (garageFilter === 'noname' && String(m.display_name || '').trim()) return false;
      if (garageFilter === 'review' && m.namespace_status !== 'needs_review') return false;
      if (garageFilter === 'pending' && !isPending(r)) return false;
      if (garageFilter === 'clash' && !r.conflict) return false;
      const chk = CHECKS.find(c => c[0] === garageFilter); if (chk && !chk[2](m, checkCtx)) return false;
      if (!q) return true;
      // "box 3" (typed, or a tap on the Dashboard) means exactly storage Box 3, not Box 30 or scale 1:43
      const boxQ = q.match(/^box\s*([a-z0-9-]+)$/i);
      if (boxQ) return String(storageByModel.get(m.model_id) || '').toLowerCase().split(/\s+(?=box)/).some(loc => loc.trim().replace(/^box\s*/, '') === boxQ[1]);
      const hay = [m.display_name, m.product_code, brandName[m.brand_id], lineName[m.line_id], m.printed_brand_text, scaleLabel[m.scale_id], m.variant, m.series, m.notes, storageByModel.get(m.model_id), ...(barcodesByModel.get(m.model_id) || [])].filter(Boolean).join(' ');
      return searchMatch(q, hay);
    });
    // Looking inside one storage box: a header card to name it, with what's in it at a glance.
    boxHead.replaceChildren();
    const oneBox = q.match(/^box\s*([a-z0-9-]+)$/i);
    const jdata = oneBox ? await journeyData() : null;
    if (oneBox && garageFilter !== 'archived') {
      const label = `Box ${oneBox[1].toUpperCase()}`;
      const rec = names.get(label.toLowerCase());
      const inBox = inventory.filter(i => i.ownership_status === 'Owned' && activeIds.has(i.model_id) && String(i.storage_location || '').toLowerCase() === label.toLowerCase());
      const byBrand = tally(inBox, i => brandName[modelById.get(i.model_id)?.brand_id] || 'Brand not set').map(([k, c]) => `${k} ${c}`).join(' · ');
      const nameIn = h('input', { value: rec?.box_name || '', placeholder: 'e.g. Mixed, HW Box, Le Mans racers', 'aria-label': 'Box name', maxlength: '60' });
      const save = async () => { await saveBox(label, { box_name: nameIn.value }); toast('Box name saved ✓'); autoSyncSoon(); route(); };
      nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      boxHead.append(h('div', { class: 'card boxcard' },
        h('div', { class: 'row' }, h('h2', {}, icon('box'), `${label}${rec?.box_size ? ' · ' + rec.box_size : ''}`), h('button', { type: 'button', class: 'quiet small', onclick: () => { garageSearch = ''; route(); } }, 'Close')),
        h('div', { class: 'muted' }, inBox.length ? `${plural(inBox.length, 'car', 'cars')} inside${byBrand ? ' · ' + byBrand : ''}` : 'Empty so far.'),
        ...(inBox.length ? (() => { const j = boxJourneyFrom(jdata, label, rec); return [journeyTrack(j), journeyNext(j, label)]; })() : []),
        h('button', { type: 'button', class: 'wide', style: 'margin-top:10px', onclick: () => fillBox(label) }, icon('camera'), `Fill ${label}`),
        h('button', { type: 'button', class: 'ghost wide', style: 'margin-top:6px', onclick: () => importBox(label) }, `📥 Import photos into ${label}`),
        inBox.length ? h('a', { href: `#/boxsheet/${encodeURIComponent(oneBox[1].toUpperCase())}`, class: 'btn ghost wide', style: 'margin-top:6px' }, `🧾 Contents sheet & label`) : null,
        inBox.length > 1 ? h('a', { href: `#/showroom/${encodeURIComponent(oneBox[1].toUpperCase())}`, class: 'btn ghost wide', style: 'margin-top:6px' }, `▶ Showroom: swipe through ${label}`) : null,
        inBox.length ? packButton(label, rec) : null,
        // Progressive disclosure (DV-0.1): settings stay open until the box knows its brands and scale, then fold away.
        h('details', { class: 'more', open: (boxSettingsOpen.has(label) ? boxSettingsOpen.get(label) : !(rec?.box_brand && rec?.box_scale)) ? true : undefined, ontoggle: (e) => boxSettingsOpen.set(label, e.target.open) },
        h('summary', {}, 'Box settings', h('span', { class: 'muted', style: 'font-weight:400' }, [rec?.box_brand === 'mixed' ? 'Mixed brands' : brandName[rec?.box_brand], rec?.box_scale === 'mixed' ? 'Mixed scales' : ref.scales.find(x => x.scale_id === rec?.box_scale)?.label, rec?.box_size].filter(Boolean).join(' · '))),
        h('label', { class: 'f' }, 'Which brands?'),
        (() => {
          const cur = rec?.box_brand || '';
          const setB = async (b) => { await saveBox(label, { box_brand: cur === b ? '' : b }); autoSyncSoon(); route(); };
          const quick = [...new Set([...recentBrands(), ...(cur && cur !== 'mixed' ? [cur] : [])])].map(id => ref.brands.find(b => b.brand_id === id)).filter(Boolean).slice(0, 6);
          return h('div', {},
            h('div', { class: 'chips' },
              h('button', { type: 'button', class: `chip ${cur === 'mixed' ? 'on' : ''}`, 'aria-pressed': cur === 'mixed' ? 'true' : 'false', onclick: () => setB('mixed') }, 'Mixed brands'),
              quick.map(b => h('button', { type: 'button', class: `chip ${cur === b.brand_id ? 'on' : ''}`, 'aria-pressed': cur === b.brand_id ? 'true' : 'false', onclick: () => setB(b.brand_id) }, `Only ${b.name}`))),
            h('select', { 'aria-label': 'Brand for this box', style: 'margin-top:6px', onchange: async (e) => { const id = await pickedBrandId(e.target.value, ref.brands, e.target); if (id) setB(id); } },
              brandOptions(ref.brands, cur === 'mixed' ? '' : cur, 'Only one brand: choose…')));
        })(),
        h('label', { class: 'f' }, 'Which scale?'),
        (() => {
          const cur = rec?.box_scale || '';
          const setS = async (v2) => { await saveBox(label, { box_scale: cur === v2 ? '' : v2 }); autoSyncSoon(); route(); };
          return h('div', { class: 'chips' },
            h('button', { type: 'button', class: `chip ${cur === 'mixed' ? 'on' : ''}`, 'aria-pressed': cur === 'mixed' ? 'true' : 'false', onclick: () => setS('mixed') }, 'Mixed scales'),
            ref.scales.filter(x => ['1:64', '1:43', '1:24', '1:18', '1:12'].includes(x.label)).map(x => h('button', { type: 'button', class: `chip ${cur === x.scale_id ? 'on' : ''}`, 'aria-pressed': cur === x.scale_id ? 'true' : 'false', onclick: () => setS(x.scale_id) }, `Only ${x.label}`)));
        })(),
        h('label', { class: 'f' }, 'Box size'),
        h('div', { class: 'chips sizes' }, BOX_SIZES.map(sz => h('button', { type: 'button', class: `chip ${rec?.box_size === sz ? 'on' : ''}`, 'aria-pressed': rec?.box_size === sz ? 'true' : 'false', onclick: async () => { await saveBox(label, { box_size: rec?.box_size === sz ? '' : sz }); autoSyncSoon(); route(); } }, sz))),
        h('label', { class: 'f' }, rec?.box_name ? 'Box name' : 'Name this box? (optional)'), nameIn, h('button', { type: 'button', class: 'small', style: 'margin-top:8px', onclick: save }, 'Save name'),
        h('button', { type: 'button', class: 'ghost small removebox', onclick: async () => { if (await removeBox(label)) { toast(`${label} removed. Restore it from Dashboard → Removed boxes.`, 4000); garageSearch = ''; route(); } } }, `Remove ${label}`))));
    }
    if (!list.length) { grid.append(h('p', { class: 'muted' }, oneBox ? 'No cars in this box yet.' : active.length || archived.length ? 'Nothing matches.' : 'No models yet. Tap ＋ Add to catalogue your first box.')); return; }
    // Grouped views: by storage box (number order, no box last), by brand (A–Z), by scale (smallest scale number first).
    const scaleOrder = Object.fromEntries(ref.scales.map(sc => [sc.scale_id, Number(sc.sort_order) || 0]));
    const grouping = { box: true, brand: true, scale: true, colour: true, line: true }[garageFilter] ? garageFilter : null;
    const gkey = (r) => grouping === 'box' ? (boxesOf(r.data.model_id)[0] || '') : grouping === 'brand' ? (brandName[r.data.brand_id] || '') : grouping === 'scale' ? (r.data.scale_id || '') : grouping === 'colour' ? (r.data.colour_family || '') : grouping === 'line' ? (lineName[r.data.line_id] ? `${brandName[r.data.brand_id] || ''} · ${lineName[r.data.line_id]}` : '') : '';
    const gnum = (k) => grouping === 'box' ? ((k.match(/\d+/) || [])[0] ? Number(k.match(/\d+/)[0]) : Infinity) : grouping === 'scale' ? (scaleOrder[k] ?? Infinity) : grouping === 'colour' ? (k ? COLOUR_FAMILIES.findIndex(f => f[0] === k) : Infinity) : 0;
    const glabel = (k) => grouping === 'box' ? (k ? [k, names.get(k.toLowerCase())?.box_size, names.get(k.toLowerCase())?.box_name].filter(Boolean).join(' · ') : 'No box yet') : grouping === 'brand' ? (k || 'Brand not set') : grouping === 'colour' ? (familyLabel(k) || 'No colour yet') : grouping === 'line' ? (k || 'No line set') : (scaleLabel[k] || 'Scale not set');
    const keyMemo = new Map(); const gk = (r) => { let k = keyMemo.get(r.id); if (k === undefined) { k = gkey(r); keyMemo.set(r.id, k); } return k; };
    if (grouping) list.sort((a, b) => { const ka = gk(a), kb = gk(b); if (!ka !== !kb) return ka ? -1 : 1; return gnum(ka) - gnum(kb) || ka.localeCompare(kb) || cmp(a.data, b.data); });
    // By colour: Gemini already named colours for some cars without one: one tap to use them all (B confirms).
    if (grouping === 'colour') {
      const ai = await aiColours(ref);
      const todo = list.filter(r => !r.data.colour_family && ai.get(r.data.model_id)?.family);
      if (todo.length) grid.append(h('div', { class: 'banner info colourall' },
        h('div', {}, `Gemini named the colour of ${plural(todo.length, 'car', 'cars')} with no colour yet.`),
        h('button', { type: 'button', class: 'small', style: 'margin-top:8px', onclick: async () => {
          if (!confirm(`Use Gemini's colour for ${plural(todo.length, 'car', 'cars')}? You can change any of them on its page.`)) return;
          for (const r of todo) { const c = ai.get(r.data.model_id); await setColour(r.data.model_id, c.family, c.name, 'colour from Gemini, confirmed (Use all)'); }
          toast(`Colours set for ${plural(todo.length, 'car', 'cars')} ✓`); route();
        } }, 'Use all')));
    }
    const gcount = new Map(); if (grouping) list.forEach(r => gcount.set(gk(r), (gcount.get(gk(r)) || 0) + 1));
    let lastGroup = null;
    for (const r of list.slice(0, shown)) {
      const m = r.data;
      if (grouping) {
        const g = gk(r);
        if (g !== lastGroup) {
          lastGroup = g;
          // Section header (B, 25 Nov: "should look like a heading, dividing two areas"): rule above, name, count pill
          const name = h('span', { class: 'g-name' }, glabel(g)), count = h('span', { class: 'g-count' }, plural(gcount.get(g), 'model', 'models'));
          grid.append(grouping === 'box' && g
            ? h('h3', { class: 'group' }, h('a', { href: '#/', onclick: (e) => { e.preventDefault(); garageFilter = 'all'; garageSearch = g; route(); } }, name, count, h('span', { class: 'g-go', 'aria-hidden': 'true' }, '›')))
            : h('h3', { class: 'group' }, name, count));
        }
      }
      const ph = (photosByModel.get(m.model_id) || []).find(p => p.photo_id === m.primary_photo_id) || (photosByModel.get(m.model_id) || [])[0];
      const img = h('div', { class: 'ph' }, icon('car'));
      // Straightened / rotated photos are just the box: shown whole on a light background (product-shot style),
      // so a wide box isn't cut off by the tall tile. Raw photos still fill the tile, hiding table clutter (B, 25 Nov).
      if (ph?.crop_corners) img.classList.add('fit');
      photoUrl(ph).then(u => { if (u) img.replaceChildren(h('img', { src: u, alt: '' })); });
      const nCopies = (ownedByModel.get(m.model_id) || []).length;
      const pendingPhotos = (photosByModel.get(m.model_id) || []).some(p => !p.original_file_id);
      grid.append(h('a', { class: 'tile', href: `#/item/${encodeURIComponent(m.model_id)}` }, img,
        h('div', { class: 'tx' },
          h('div', { class: 'nm' }, m.colour_family ? h('span', { class: 'cdot', title: familyLabel(m.colour_family), style: `background:${familySwatch(m.colour_family)}` }) : null, m.display_name || '(no name yet)'),
          h('div', { class: 'sub' }, [brandName[m.brand_id] || m.printed_brand_text || 'Brand?', lineName[m.line_id], scaleLabel[m.scale_id], m.product_code].filter(Boolean).join(' · ')),
          h('div', { class: 'badges' },
            ...boxesOf(m.model_id).slice(0, 2).map(bx => h('span', { class: 'b box' }, bx)),
            m.completeness_status === 'complete' ? h('span', { class: 'b ok' }, 'Complete') : null, // "Quick" is the normal case, so no badge (G6)
            m.deleted_at ? h('span', { class: 'b mute' }, 'Archived') : null,
            nCopies > 1 ? h('span', { class: 'b info' }, `${nCopies} copies`) : null,
            m.namespace_status === 'needs_review' ? h('span', { class: 'b warn' }, 'Needs review') : null,
            (r.dirty || pendingPhotos) ? h('span', { class: 'b warn' }, 'Waiting to sync') : null,
            r.lastError ? h('span', { class: 'b bad' }, 'Error') : null,
            r.conflict ? h('span', { class: 'b bad' }, 'Clash') : null))));
    }
    if (list.length > shown) {
      const rest = list.length - shown;
      grid.append(h('div', { class: 'more-row' },
        h('p', { class: 'muted' }, `Showing ${shown} of ${list.length}`),
        h('button', { type: 'button', class: 'ghost wide showmore', onclick: () => { const y = window.scrollY; shown += PAGE * 2; draw().then(() => window.scrollTo(0, y)); } }, `Show ${Math.min(rest, PAGE * 2)} more`)));
    }
  }
  draw();
}

// =====================================================================
// Quick capture (D17.1, D19, D20)
// =====================================================================
let cap = null;
let restoreList = null; // Settings → Restore from a backup: the list, once fetched
// In a photo run set to "Pick per car", each new car starts without a brand.
const nextBrandId = () => (location.hash.startsWith('#/run') && localStorage.getItem('smg.brandPerCar') === '1') ? '' : cap.brandId;
const nextScaleId = () => (location.hash.startsWith('#/run') && localStorage.getItem('smg.scalePerCar') === '1') ? '' : cap.scaleId;
let runWork = Promise.resolve(); // the photo run's save in progress, so "Done with Box N" waits for it
function freshCapture(keep = {}) {
  // "Sealed" is remembered like brand and scale (audit C1): most of the collection is sealed boxes.
  return { modelId: newId('models'), inventoryId: newId('inventory'), photos: {}, sealed: localStorage.getItem('smg.lastSealed') === 'yes', brandId: keep.brandId || '', scaleId: keep.scaleId || '', box: localStorage.getItem('smg.lastBox') || '', barcode: null, name: '', code: '', count: keep.count || 0, timer: newTimer() };
}
const capTouch = () => { if (cap) touch(cap.timer); };

// ---------- the box in progress survives a tab reload (audit finding C5) ----------
// Fields go to the phone's meta store, photo files to the blob store under "draft:" keys.
const DRAFT_KEY = 'captureDraft';
const DRAFT_VARIANTS = ['original', 'display', 'thumb'];
const PHOTO_INFO = ['md5', 'width', 'height', 'exif_orientation', 'original_has_location', 'original_bytes', 'original_filename'];
async function saveDraft() {
  if (!cap) return;
  const photos = {};
  for (const [role, p] of Object.entries(cap.photos)) {
    if (!p.prep) continue; // still being prepared: stored when ready
    if (!p.draftStored) { for (const v of DRAFT_VARIANTS) await blobs.put(`draft:${p.photoId}:${v}`, p.prep[v]); p.draftStored = true; }
    photos[role] = { photoId: p.photoId, capturedAt: p.capturedAt, info: Object.fromEntries(PHOTO_INFO.map(k => [k, p.prep[k]])) };
  }
  const { modelId, inventoryId, sealed, brandId, scaleId, box, barcode, name, code, count, timer, brandPicked, scalePicked, artSkipped } = cap;
  await meta.set(DRAFT_KEY, { modelId, inventoryId, sealed, brandId, scaleId, box, barcode, name, code, count, timer, brandPicked, scalePicked, artSkipped, photos });
}
let draftTimer = null;
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(() => saveDraft().catch(console.error), 400); }
async function dropDraftPhoto(photoId) { for (const v of DRAFT_VARIANTS) await blobs.remove(`draft:${photoId}:${v}`); }
async function clearDraft() {
  clearTimeout(draftTimer);
  const d = await meta.get(DRAFT_KEY, null);
  for (const p of Object.values(d?.photos || {})) await dropDraftPhoto(p.photoId);
  await meta.set(DRAFT_KEY, null);
}
async function loadDraft() {
  const d = await meta.get(DRAFT_KEY, null);
  if (!d || !(Object.keys(d.photos || {}).length || d.name || d.code || d.barcode)) return null;
  const c = { ...freshCapture(), ...d, timer: { ...newTimer(), ...(d.timer || {}), lastTouch: null }, photos: {}, restored: true };
  for (const [role, p] of Object.entries(d.photos || {})) {
    const [original, display, thumb] = await Promise.all(DRAFT_VARIANTS.map(v => blobs.get(`draft:${p.photoId}:${v}`)));
    if (!original || !display || !thumb) continue;
    c.photos[role] = { photoId: p.photoId, capturedAt: p.capturedAt, prep: { original, display, thumb, ...p.info }, url: URL.createObjectURL(thumb), draftStored: true };
  }
  return c;
}
// Photos actually saved for this box: a box-art photo only counts while "Sealed" is ticked (audit C6).
const photosToSave = () => Object.fromEntries(Object.entries(cap.photos).filter(([role]) => role !== 'box_art' || cap.sealed));

async function renderAdd(v) {
  if (!cap) cap = await loadDraft();
  if (!cap) cap = freshCapture({ scaleId: localStorage.getItem('smg.lastScale') || '', brandId: recentBrands()[0] || '' });
  if (cap.restored) { v.append(h('div', { class: 'banner info' }, 'Restored the box you were working on. Carry on, or tap Discard to start again.')); cap.restored = false; }
  const ref = await refData();
  const [models, ids] = await Promise.all([store.list('models'), store.list('product_identifiers')]);
  v.append(h('div', { class: 'row' }, h('h2', {}, 'Quick capture'), h('div', { class: 'muted', style: 'text-align:right' }, cap.count ? `${cap.count} saved this session` : 'Box by box')));
  v.append(h('a', { href: '#/run', class: 'btn quiet wide', style: 'margin:4px 0 6px' }, '⚡ Photo run: photos now, names later'),
    h('a', { href: '#/import', class: 'btn ghost wide', style: 'margin:0 0 6px' }, '📥 Import many from the gallery'));

  // --- Photos ---
  v.append(h('h3', {}, 'Photos (phone camera)'));
  const shots = h('div', { class: 'shots' });
  const roles = ['box_front', 'box_rear', ...(cap.sealed ? ['box_art'] : [])];
  for (const role of roles) {
    const p = cap.photos[role];
    const tile = h('button', { class: `shot ${p ? 'done' : ''} ${role !== 'box_art' ? 'req' : ''} ${shotSel === role ? 'sel' : ''}`, type: 'button', 'aria-label': p ? `${SHOT_ROLES[role].label}: options` : undefined, onclick: () => { if (p) { shotSel = shotSel === role ? null : role; route(); } else takePhoto(role); } },
      p?.url ? h('img', { src: p.url, alt: '' }) : h('span', {}, icon('camera'), SHOT_ROLES[role].label),
      p ? h('span', { class: 'tag' }, `${SHOT_ROLES[role].label} ✓`) : null);
    shots.append(tile);
  }
  if (roles.length < 3) shots.append(h('div', {}));
  v.append(shots);
  { const row = shotActionsRow(null); if (row) v.append(row); }
  const setSealed = (yes) => { cap.sealed = yes; localStorage.setItem('smg.lastSealed', yes ? 'yes' : 'no'); capTouch(); saveDraftSoon(); route(); };
  v.append(h('div', { class: 'chips', style: 'margin-top:10px', role: 'group', 'aria-label': 'Box type' },
    h('button', { type: 'button', class: `chip ${cap.sealed ? 'on' : ''}`, 'aria-pressed': cap.sealed ? 'true' : 'false', onclick: () => setSealed(true) }, 'Sealed box'),
    h('button', { type: 'button', class: `chip ${cap.sealed ? '' : 'on'}`, 'aria-pressed': cap.sealed ? 'false' : 'true', onclick: () => setSealed(false) }, 'Car visible')));
  v.append(h('div', { class: 'muted', style: 'margin-top:4px' }, cap.sealed ? 'Sealed: add a box-art photo showing the car (optional).' : 'Car visible through the box: no box-art photo needed.'));
  const busy = h('p', { class: 'muted', id: 'capBusy' });
  v.append(busy);

  // --- Brand ---
  v.append(h('label', { class: 'f' }, 'Brand'));
  const recent = recentBrands().map(id => ref.brands.find(b => b.brand_id === id)).filter(Boolean);
  if (recent.length) v.append(h('div', { class: 'chips', style: 'margin-bottom:6px' }, recent.map(b => h('button', { type: 'button', class: `chip ${cap.brandId === b.brand_id ? 'on' : ''}`, onclick: () => { cap.brandId = b.brand_id; capTouch(); saveDraftSoon(); route(); } }, b.name))));
  const brandSel = h('select', { 'aria-label': 'Brand', onchange: async (e) => {
    const id = await pickedBrandId(e.target.value, ref.brands, e.target);
    if (!id && e.target.value) { route(); return; }
    cap.brandId = id; if (id) pushRecentBrand(id);
    capTouch(); saveDraftSoon();
    route();
  } }, brandOptions(ref.brands, cap.brandId, '— choose brand —'));
  v.append(brandSel);

  // --- Scale ---
  v.append(h('label', { class: 'f' }, 'Scale'));
  const main = ['1:64', '1:43', '1:18', '1:12'];
  const scaleChips = h('div', { class: 'chips' }, ref.scales.filter(s => main.includes(s.label)).map(s => h('button', { type: 'button', class: `chip ${cap.scaleId === s.scale_id ? 'on' : ''}`, onclick: () => { cap.scaleId = s.scale_id; localStorage.setItem('smg.lastScale', s.scale_id); capTouch(); saveDraftSoon(); route(); } }, s.label)));
  const more = h('select', { style: 'flex:1;min-width:140px', onchange: (e) => { if (e.target.value) { cap.scaleId = e.target.value; localStorage.setItem('smg.lastScale', e.target.value); capTouch(); saveDraftSoon(); route(); } } },
    h('option', { value: '' }, 'Other scale…'), ref.scales.filter(s => !main.includes(s.label)).map(s => h('option', { value: s.scale_id, selected: s.scale_id === cap.scaleId ? true : undefined }, s.label)));
  scaleChips.append(more);
  v.append(scaleChips);

  // --- Storage box (optional, remembered; "Next box" moves on by one; chips jump to any box in use) ---
  v.append(h('label', { class: 'f' }, 'Storage box (optional)'));
  const setBox = (b) => { cap.box = String(b).trim(); localStorage.setItem('smg.lastBox', cap.box); capTouch(); saveDraftSoon(); };
  const boxRow = h('div', { class: 'row' }, h('input', { class: 'boxin', inputmode: 'text', placeholder: 'Box number, e.g. 12', value: cap.box, 'aria-label': 'Storage box number', oninput: (e) => setBox(e.target.value) }));
  if (/^\d+$/.test(cap.box)) boxRow.append(h('button', { type: 'button', class: 'quiet', style: 'flex:0 0 auto', onclick: () => { setBox(Number(cap.box) + 1); toast(`Now filling Box ${cap.box}`); route(); } }, `Next box → ${Number(cap.box) + 1}`));
  v.append(boxRow);
  { const used = await boxesInUse(); const pk = boxPicker(cap.box, used, await boxNames(), (id) => { setBox(id); route(); }); if (pk) v.append(pk); }
  { const bc = boughtCard(); if (bc) v.append(bc); }

  // --- Barcode ---
  v.append(h('label', { class: 'f' }, 'Barcode (if the box has one)'));
  const bcInfo = h('div', { class: 'muted' });
  const bcInput = h('input', { inputmode: 'numeric', placeholder: 'Scan, or type the digits', value: cap.barcode?.raw || '', oninput: (e) => { setBarcode(e.target.value, 'typed', ''); updateBc(); updateDup(); } });
  const video = h('video', { class: 'scan hide', playsinline: true, muted: true });
  const scanBtn = h('button', { type: 'button', class: 'quiet', onclick: () => { capTouch(); doLiveScan(); } }, '▦ Scan barcode');
  const photoBtn = h('button', { type: 'button', class: 'quiet hide', onclick: () => doPhotoScan() }, icon('camera'), 'Take photo instead');
  v.append(h('div', { class: 'row' }, scanBtn, photoBtn), video, bcInput, bcInfo);
  function setBarcode(raw, source, format) {
    raw = String(raw || '').trim();
    cap.barcode = raw ? { raw, cmp: barcodeCmp(raw), format, source, checkOk: gtinCheckOk(raw) } : null;
    capTouch(); saveDraftSoon();
  }
  function updateBc() {
    const b = cap.barcode;
    if (!b) { bcInfo.textContent = ''; return; }
    if (b.source === 'typed' && b.checkOk === false) { bcInfo.textContent = '⚠ These digits don\'t add up (check digit). Please re-check, or scan instead.'; bcInfo.style.color = 'var(--warn)'; }
    else { bcInfo.textContent = b.source === 'scan' ? `✓ Scanned ${b.format || ''}` : b.source === 'rear_photo' ? '✓ Read from the barcode photo. Check it matches the box.' : (b.checkOk ? '✓ Check digit OK' : ''); bcInfo.style.color = 'var(--ok)'; }
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
  v.append(h('input', { placeholder: 'e.g. Range Rover 1981 Camel Trophy', value: cap.name, oninput: (e) => { cap.name = e.target.value; capTouch(); saveDraftSoon(); updateDup(); } }));

  // --- Product code (optional) ---
  const brand = ref.brands.find(b => b.brand_id === cap.brandId);
  v.append(h('label', { class: 'f' }, 'Product code (optional)'));
  v.append(h('input', { placeholder: brand?.code_example ? `e.g. ${brand.code_example}` : 'Exactly as printed', value: cap.code, autocapitalize: 'characters', oninput: (e) => { cap.code = e.target.value; capTouch(); saveDraftSoon(); codeWarn(); updateDup(); } }));
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
      dupBox.append(h('div', { class: 'banner have' }, h('div', { class: 'hd' }, `✅ You already own this (${n} cop${n === 1 ? 'y' : 'ies'}).`),
        h('div', { class: 'dup' }, img, h('div', {}, h('div', {}, m.display_name || m.product_code), h('div', { class: 'muted' }, m.product_code))),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { type: 'button', onclick: () => saveCopyOf(m) }, 'Add as another copy'),
          h('a', { class: 'btn ghost', href: `#/item/${encodeURIComponent(m.model_id)}` }, 'Open it'))));
    } else if (r.possible.length) {
      // Possible match (audit D1): show it, let B open it or attach this box as a copy by his own tap.
      // Never merged automatically (D10.1 rule 5).
      const [inv, allPhotos] = await Promise.all([store.list('inventory'), store.list('photos')]);
      const box = h('div', { class: 'banner warn' }, h('div', { class: 'hd' }, `🟡 Possible match${r.possible.length > 1 ? 'es' : ''} (not confirmed). Is it the same model?`));
      for (const p of r.possible.slice(0, 3)) {
        const m = p.model;
        const label = m.display_name || m.product_code || '(no name yet)';
        const n = inv.filter(i => i.model_id === m.model_id && i.ownership_status === 'Owned').length;
        const ph = allPhotos.filter(x => x.model_id === m.model_id);
        const img = h('img', { alt: '' });
        photoUrl(ph.find(x => x.photo_id === m.primary_photo_id) || ph[0]).then(u => { if (u) img.src = u; });
        box.append(h('div', { class: 'match' },
          h('div', { class: 'dup' }, img, h('div', {}, h('div', { class: 'nm' }, label), h('div', { class: 'muted' }, `${p.reason} · ${n} cop${n === 1 ? 'y' : 'ies'} owned`))),
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { type: 'button', class: 'small', onclick: () => { if (confirm(`Add this box as another copy of "${label}"?`)) saveCopyOf(m); } }, 'Same model: add as copy'),
            h('a', { class: 'btn ghost small', href: `#/item/${encodeURIComponent(m.model_id)}` }, 'Open'))));
      }
      box.append(h('div', { class: 'muted', style: 'margin-top:8px' }, `Different model? Just carry on and save.${cap.code.trim() ? '' : ' Adding the product code lets the app confirm it.'}`));
      dupBox.append(box);
    } else if (r.status === 'no_match') {
      dupBox.append(h('div', { class: 'banner new' }, '❌ Not in your garage yet.'));
    } else if (cap.code.trim() || cap.barcode) {
      dupBox.append(h('div', { class: 'muted', style: 'margin-top:8px' }, r.status === 'needs_review' ? 'Brand needs review, so this can\'t be confirmed as a duplicate.' : 'Not checkable yet (needs a brand and product code).'));
    }
  }
  updateDup();

  // --- Save ---
  // Always-visible Save bar (audit C3): no scrolling down to save each box.
  const missing = [!cap.photos.box_front && 'box front photo', !cap.photos.box_rear && 'barcode photo', !cap.brandId && 'brand', !cap.scaleId && 'scale'].filter(Boolean);
  v.append(h('div', { class: 'savebar' },
    h('div', { class: 'need' }, missing.length ? `Still needed: ${missing.join(', ')}` : 'Ready to save'),
    h('button', { class: 'save', disabled: missing.length ? true : undefined, onclick: () => saveCapture() }, 'Save & next box')));
  v.append(h('button', { class: 'wide ghost', style: 'margin-top:8px', onclick: async () => { if (confirm('Discard this box?')) { await clearDraft(); cap = freshCapture({ brandId: cap.brandId, scaleId: cap.scaleId, count: cap.count }); route(); } } }, 'Discard'));

  async function takePhoto(role) {
    if (await takeCapPhoto(role, (t) => { busy.textContent = t; })) route();
  }
}

// Tap a taken photo -> "Retake" (camera opens; the old photo stays until a new one is taken) or "Remove".
// Same on Quick capture and Photo run (B, 24 Nov: retake or discard each photo individually).
let shotSel = null;
async function retakeShot(role, after) {
  const old = cap.photos[role]?.photoId;
  shotSel = null;
  const ok = await takeCapPhoto(role, () => {});
  if (ok && old && cap.photos[role]?.photoId !== old) await dropDraftPhoto(old);
  if (ok && after) await after(); else route();
}
async function removeShot(role) {
  const p = cap.photos[role]; shotSel = null;
  if (!p) { route(); return; }
  await dropDraftPhoto(p.photoId); delete cap.photos[role];
  if (role === 'box_rear' && cap.barcode?.source === 'rear_photo') cap.barcode = null;
  if (role === 'box_art') cap.artSkipped = false;
  cap.runDecision = null; await saveDraft(); toast(`${SHOT_ROLES[role].label} photo removed`); route();
}
function shotActionsRow(after) {
  if (!shotSel || !cap.photos[shotSel]) return null;
  const role = shotSel;
  return h('div', { class: 'shotsel' }, h('b', {}, `${SHOT_ROLES[role].label} photo`),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'small', onclick: () => retakeShot(role, after) }, icon('camera'), 'Retake'),
      h('button', { type: 'button', class: 'small quiet', onclick: () => removeShot(role) }, 'Remove'),
      h('button', { type: 'button', class: 'small ghost', onclick: () => { shotSel = null; route(); } }, 'Cancel')));
}
// One photo for the box in progress (shared by Quick capture and Photo run). Returns true when a photo was added.
async function takeCapPhoto(role, say = () => {}) {
  capTouch();
  const [f] = await pickPhoto({ camera: true });
  if (!f) return false;
  capTouch();
  // s1-0.57.0 (B, 28 Nov: "it freezes on the old screen before the photo appears"): the photo shows at once and the
  // next button is ready; the copies, the fingerprint (md5) and the barcode reading run in the background.
  // Saving the car waits for them (capReady), so nothing is skipped.
  const old = cap.photos[role];
  if (old?.url) URL.revokeObjectURL(old.url);
  if (old?.draftStored) await dropDraftPhoto(old.photoId);
  const entry = { photoId: newId('photos'), prep: null, url: URL.createObjectURL(f), capturedAt: new Date().toISOString() };
  const t0 = performance.now(), mine = cap;
  cap.photos[role] = entry;
  entry.ready = (async () => {
    try {
      entry.prep = await preparePhoto(f);
      const prepMs = performance.now() - t0;
      // The barcode close-up usually carries the barcode: read it (audit C2). A scanned or typed barcode is never overwritten.
      let found = false;
      if (role === 'box_rear' && mine === cap && cap.photos[role] === entry && (!cap.barcode || cap.barcode.source === 'rear_photo')) {
        try {
          const r = await scanPhoto(f);
          if (r && cap.photos[role] === entry) { const raw = String(r.value).trim(); cap.barcode = { raw, cmp: barcodeCmp(raw), format: r.format, source: 'rear_photo', checkOk: gtinCheckOk(raw) }; found = true; }
        } catch (e) { console.warn('barcode from rear photo:', e); }
      }
      if (mine === cap && cap.photos[role] === entry) await saveDraft();
      logPhotoTiming(role, prepMs, performance.now() - t0);
      if (found && location.hash.startsWith('#/add')) route(); // Quick capture shows the barcode it read
    } catch (e) {
      if (cap.photos[role] === entry) { delete cap.photos[role]; URL.revokeObjectURL(entry.url); }
      toast(`Could not read that photo: ${e.message}. Please take it again.`, 4500, 'bad'); route();
      throw e;
    }
  })();
  entry.ready.catch(() => {});
  return true;
}
// Every photo of the box in progress is fully prepared (copies, md5, barcode). Throws if one couldn't be read.
async function capReady() {
  const pend = Object.values(cap?.photos || {}).filter(p => p.ready && !p.prep).map(p => p.ready);
  if (pend.length) await Promise.all(pend);
}
// Photo timing (s1-0.57.0): the last few photos, shown in Settings → This phone, so a slow phone can be measured.
function logPhotoTiming(role, prepMs, totalMs) {
  try {
    const list = JSON.parse(localStorage.getItem('smg.photoTiming') || '[]');
    list.unshift({ role, prep: Math.round(prepMs), total: Math.round(totalMs), at: Date.now() });
    localStorage.setItem('smg.photoTiming', JSON.stringify(list.slice(0, 10)));
  } catch {}
}

// =====================================================================
// Photo run (B, 24 Nov: "shoot now, fill in later"). Brand, scale, storage box and sealed are set once
// for the run; each box needs only its photos and saves itself (D17.1 minimum still met: photos,
// brand, scale; name later). A barcode or name that matches something already owned pauses the run.
// Uses the same box-in-progress (cap) as Quick capture, so drafts and timing work the same way.
// =====================================================================
let runLast = null; // last model saved in this run (for "Undo last box")
let runSetOpen = true; // run settings stay open until "Done: start shooting" or the first photo
async function renderRun(v) {
  if (!cap) cap = await loadDraft();
  if (!cap) cap = freshCapture({ scaleId: localStorage.getItem('smg.lastScale') || '', brandId: recentBrands()[0] || '' });
  // Mixed box: the brand (or scale) must be chosen for THIS car after its photos. A value carried over from an
  // earlier setting or restored after Chrome reloaded the page (e.g. while the camera was open) doesn't count.
  if (localStorage.getItem('smg.brandPerCar') === '1' && !cap.brandPicked) cap.brandId = '';
  if (localStorage.getItem('smg.scalePerCar') === '1' && !cap.scalePicked) cap.scaleId = '';
  const ref = await refData();
  const brand = ref.brands.find(b => b.brand_id === cap.brandId);
  const scale = ref.scales.find(x => x.scale_id === cap.scaleId);
  // Mixed boxes (B, 24 Nov): photos first, then pick the brand for each car with its photo in view.
  const perCar = localStorage.getItem('smg.brandPerCar') === '1';
  const setPerCar = (on) => { localStorage.setItem('smg.brandPerCar', on ? '1' : '0'); if (on) cap.brandId = ''; else if (!cap.brandId) cap.brandId = recentBrands()[0] || ''; saveDraftSoon(); route(); };
  const brandReady = perCar || !!brand;
  const scalePer = localStorage.getItem('smg.scalePerCar') === '1';
  const setScalePer = (on) => { localStorage.setItem('smg.scalePerCar', on ? '1' : '0'); if (on) cap.scaleId = ''; else if (!cap.scaleId) cap.scaleId = localStorage.getItem('smg.lastScale') || ''; saveDraftSoon(); route(); };
  const scaleReady = scalePer || !!scale;
  v.append(h('div', { class: 'row' }, h('h2', {}, 'Photo run'), h('a', { href: '#/add', class: 'btn ghost small', style: 'flex:0 0 auto' }, 'One box at a time')));
  if (cap.box) {
    const bn = (await boxNames()).get(`box ${cap.box}`.toLowerCase())?.box_name;
    v.append(h('div', { class: 'banner fill' }, h('div', {}, h('b', {}, icon('box'), `Filling Box ${cap.box}`), bn ? ` · ${bn}` : ''),
      h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
        h('button', { type: 'button', class: 'small quiet', onclick: () => { runSetOpen = true; route(); setTimeout(() => document.querySelector('input.boxin')?.scrollIntoView({ block: 'center' }), 50); } }, 'Switch box'),
        h('button', { type: 'button', class: 'small', onclick: async () => {
          await runWork.catch(() => {});
          const half = Object.keys(cap.photos || {}).length;
          if (half && !confirm(`A car for Box ${cap.box} is half done (${plural(half, 'photo', 'photos')}). Leave it for now? It stays here and you can finish it later.`)) return;
          garageFilter = 'all'; garageSearch = `Box ${cap.box}`; location.hash = '#/';
        } }, `Done with Box ${cap.box}`))));
  } else v.append(h('p', { class: 'muted' }, 'Photos now, names later. Set these once; each car saves itself after its photos.'));

  // --- run settings ---
  const set = h('div', { class: 'card runset' });
  const recent = recentBrands().map(id => ref.brands.find(b => b.brand_id === id)).filter(Boolean);
  set.append(h('label', { class: 'f' }, 'Brand'));
  set.append(h('div', { class: 'chips', style: 'margin-bottom:6px' },
    h('button', { type: 'button', class: `chip ${perCar ? '' : 'on'}`, 'aria-pressed': perCar ? 'false' : 'true', onclick: () => setPerCar(false) }, 'Same brand for all'),
    h('button', { type: 'button', class: `chip ${perCar ? 'on' : ''}`, 'aria-pressed': perCar ? 'true' : 'false', onclick: () => setPerCar(true) }, 'Pick per car (mixed box)')));
  if (perCar) set.append(h('p', { class: 'muted' }, 'Take the photos, then tap the brand for each car.'));
  if (!perCar && recent.length) set.append(h('div', { class: 'chips', style: 'margin-bottom:6px' }, recent.map(b => h('button', { type: 'button', class: `chip ${cap.brandId === b.brand_id ? 'on' : ''}`, onclick: () => { cap.brandId = b.brand_id; pushRecentBrand(b.brand_id); saveDraftSoon(); route(); } }, b.name))));
  if (!perCar) set.append(h('select', { 'aria-label': 'Brand', onchange: async (e) => { const id = await pickedBrandId(e.target.value, ref.brands, e.target); if (!id && e.target.value) { route(); return; } cap.brandId = id; if (cap.brandId) pushRecentBrand(cap.brandId); saveDraftSoon(); route(); } },
    brandOptions(ref.brands, cap.brandId, '— choose brand —')));
  set.append(h('label', { class: 'f' }, 'Scale'));
  set.append(h('div', { class: 'chips', style: 'margin-bottom:6px' },
    h('button', { type: 'button', class: `chip ${scalePer ? '' : 'on'}`, 'aria-pressed': scalePer ? 'false' : 'true', onclick: () => setScalePer(false) }, 'Same scale for all'),
    h('button', { type: 'button', class: `chip ${scalePer ? 'on' : ''}`, 'aria-pressed': scalePer ? 'true' : 'false', onclick: () => setScalePer(true) }, 'Pick per car (mixed)')));
  if (!scalePer) set.append(h('div', { class: 'chips' }, ref.scales.filter(x => ['1:64', '1:43', '1:18', '1:12'].includes(x.label)).map(x => h('button', { type: 'button', class: `chip ${cap.scaleId === x.scale_id ? 'on' : ''}`, onclick: () => { cap.scaleId = x.scale_id; localStorage.setItem('smg.lastScale', x.scale_id); saveDraftSoon(); route(); } }, x.label))));
  set.append(h('label', { class: 'f' }, 'Storage box'));
  const setBox = (b) => { cap.box = String(b).trim(); localStorage.setItem('smg.lastBox', cap.box); saveDraftSoon(); };
  const boxRow = h('div', { class: 'row' }, h('input', { class: 'boxin', placeholder: 'Box number, e.g. 12', value: cap.box, 'aria-label': 'Storage box number', oninput: (e) => setBox(e.target.value) }));
  if (/^\d+$/.test(cap.box)) boxRow.append(h('button', { type: 'button', class: 'quiet', style: 'flex:0 0 auto', onclick: () => { setBox(Number(cap.box) + 1); toast(`Now filling Box ${cap.box}`); route(); } }, `Next box → ${Number(cap.box) + 1}`));
  set.append(boxRow);
  { const used = await boxesInUse(); const pk = boxPicker(cap.box, used, await boxNames(), async (id) => { setBox(id); await applyBoxBrand(`Box ${id}`); saveDraftSoon(); route(); }); if (pk) set.append(pk); }
  const setSealed = (yes) => { cap.sealed = yes; localStorage.setItem('smg.lastSealed', yes ? 'yes' : 'no'); saveDraftSoon(); route(); };
  set.append(h('div', { class: 'chips', style: 'margin-top:10px' },
    h('button', { type: 'button', class: `chip ${cap.sealed ? 'on' : ''}`, 'aria-pressed': cap.sealed ? 'true' : 'false', onclick: () => setSealed(true) }, 'Sealed box'),
    h('button', { type: 'button', class: `chip ${cap.sealed ? '' : 'on'}`, 'aria-pressed': cap.sealed ? 'false' : 'true', onclick: () => setSealed(false) }, 'Car visible')));
  // Once brand and scale are set, the settings fold into one line so the camera button stays at the top.
  if (brandReady && scaleReady && !runSetOpen) {
    v.append(h('div', { class: 'runsum' },
      h('div', {}, h('b', {}, `${perCar ? 'Mixed brands' : brand.name} · ${scalePer ? 'Mixed scales' : scale.label}`), ` · ${cap.box ? `Box ${cap.box}` : 'no storage box'} · ${cap.sealed ? 'Sealed' : 'Car visible'}`),
      !perCar && recent.length > 1 ? h('div', { class: 'chips scroll', style: 'margin:6px 0' }, recent.map(b => h('button', { type: 'button', class: `chip ${cap.brandId === b.brand_id ? 'on' : ''}`, 'aria-pressed': cap.brandId === b.brand_id ? 'true' : 'false', onclick: () => { cap.brandId = b.brand_id; pushRecentBrand(b.brand_id); saveDraftSoon(); route(); } }, b.name))) : null,
      h('button', { type: 'button', class: 'small ghost', onclick: () => { runSetOpen = true; route(); } }, 'Change')));
  } else {
    v.append(set);
    if (brandReady && scaleReady) v.append(h('button', { class: 'wide', style: 'margin-bottom:8px', onclick: () => { runSetOpen = false; route(); } }, 'Done: start shooting'));
  }
  if (!brandReady || !scaleReady) { v.append(h('div', { class: 'banner info' }, 'Choose a brand and a scale (or "Pick per car") for this run to start.')); return; }

  // --- the box in progress ---
  const steps = ['box_front', 'box_rear', ...(cap.sealed && !cap.artSkipped ? ['box_art'] : [])];
  const next = steps.find(r => !cap.photos[r]);
  const say = h('p', { class: 'muted', id: 'runSay' });
  v.append(h('div', { class: 'runhead' }, h('b', {}, `Car ${cap.count + 1} of this run`), ` · ${brand ? brand.name : 'brand after photos'} · ${scale ? scale.label : 'scale after photos'}${cap.box ? ` · Box ${cap.box}` : ''}`));
  // Extra sides (B, 28 Nov): optional photos of the car just saved, before the next car is started
  if (runLast && !Object.keys(cap.photos).length && !cap.runDecision) v.append(h('div', { class: 'card extras' },
    h('div', { class: 'small', style: 'font-weight:700' }, `＋ Another side of ${runLast.label}? (optional)`),
    h('div', { class: 'muted small', style: 'margin:2px 0 8px' }, 'Only if it shows something new: a car name, a code, damage. Plain box with just a logo? Take "Car inside": it becomes the main photo. Any photo can supply a missing barcode.'),
    h('div', { class: 'chips' }, EXTRA_SIDES.map(([role, label]) => h('button', { type: 'button', class: 'chip', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await addSidePhoto(runLast.id, role); if (r) { runLast.extras = (runLast.extras || 0) + 1; toast(`${label} added to ${runLast.label}${role === 'car_inside' ? ' · now its main photo' : ''}${r.barcode ? ` · barcode ${r.barcode} read ✓` : ''}`, 3500); } }
      catch (err) { toast(`Photo not added: ${err.message}`, 4000, 'bad'); }
      route();
    } }, icon('camera'), label))),
    runLast.extras ? h('div', { class: 'muted small', style: 'margin-top:6px' }, `${plural(runLast.extras, 'extra photo', 'extra photos')} added ✓`) : null));
  v.append(h('a', { href: '#/import', class: 'btn ghost small importlink' }, '📥 Shot them with the camera app? Import from gallery'));
  { const bc = boughtCard(); if (bc) v.append(bc); }
  const strip = h('div', { class: 'shots' });
  for (const role of ['box_front', 'box_rear', ...(cap.sealed ? ['box_art'] : [])]) {
    const p = cap.photos[role];
    const retake = p && !runSaving ? () => { shotSel = shotSel === role ? null : role; route(); } : undefined;
    strip.append(h(p ? 'button' : 'div', { type: p ? 'button' : undefined, class: `shot ${p ? 'done' : ''} ${role === next ? 'nextshot' : ''} ${shotSel === role ? 'sel' : ''}`, onclick: retake, 'aria-label': p ? `${SHOT_ROLES[role].label}: options` : undefined }, p?.url ? h('img', { src: p.url, alt: '' }) : h('span', {}, SHOT_ROLES[role].label), p ? h('span', { class: 'tag' }, `${SHOT_ROLES[role].label} ✓`) : null));
  }
  v.append(strip);
  if (!cap.photos.box_rear) v.append(h('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'Front = the side showing the car. Barcode close-up = the barcode filling about a quarter of the photo, wherever it is (back or bottom). No barcode? Photograph the back.'));
  { const row = shotActionsRow(afterRunPhoto); if (row) v.append(row); }
  const nPhotos = Object.keys(cap.photos).length;
  if (nPhotos && !runSaving) v.append(h('div', { class: 'row shotacts' },
    h('span', { class: 'muted small' }, 'Tap a photo to retake or remove it'),
    h('button', { type: 'button', class: 'small ghost', onclick: async () => {
      if (!confirm(`Discard this car (${plural(nPhotos, 'photo', 'photos')})? Nothing has been saved for it yet.`)) return;
      for (const r of Object.keys(cap.photos)) await dropDraftPhoto(cap.photos[r].photoId);
      cap.photos = {}; cap.barcode = null; cap.artSkipped = false; cap.runDecision = null; cap.brandPicked = false; cap.scalePicked = false;
      if (localStorage.getItem('smg.brandPerCar') === '1') cap.brandId = '';
      if (localStorage.getItem('smg.scalePerCar') === '1') cap.scaleId = '';
      await saveDraft(); toast('Car discarded'); route();
    } }, 'Discard this car')));
  if (cap.restored && !next && nPhotos) v.append(h('div', { class: 'banner info' }, 'This car was kept while the app reloaded. Check the photos, then save it or discard it.'));
  if (cap.barcode) v.append(h('p', { class: 'muted' }, `Barcode ${cap.barcode.raw} (read from the barcode photo)`));
  v.append(say);

  if (cap.runDecision) {
    // A barcode/name match with something already owned: B decides (never merged automatically, D10.1 rule 5).
    const allPhotos = await store.list('photos');
    const inv = await store.list('inventory');
    const box = h('div', { class: 'banner warn' }, h('div', { class: 'hd' }, '🟡 You may already own this. Same model?'));
    for (const pm of cap.runDecision.slice(0, 3)) {
      const m = pm.model; const label = m.display_name || m.product_code || '(no name yet)';
      const ph = allPhotos.filter(x => x.model_id === m.model_id);
      const img = h('img', { alt: '' }); photoUrl(ph.find(x => x.photo_id === m.primary_photo_id) || ph[0]).then(u => { if (u) img.src = u; });
      const n = inv.filter(i => i.model_id === m.model_id && i.ownership_status === 'Owned').length;
      box.append(h('div', { class: 'match' }, h('div', { class: 'dup' }, img, h('div', {}, h('div', { class: 'nm' }, label), h('div', { class: 'muted' }, `${pm.reason} · ${n} cop${n === 1 ? 'y' : 'ies'} owned`))),
        h('button', { type: 'button', class: 'small', style: 'margin-top:8px', onclick: async () => { cap.runDecision = null; runLast = null; await saveCopyOf(m); } }, 'Same model: add as copy')));
    }
    box.append(h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { type: 'button', class: 'quiet', onclick: async () => { cap.runDecision = null; await saveRunBox(); } }, 'Different model: save new'),
      h('button', { type: 'button', class: 'ghost', onclick: async () => { cap.runDecision = null; for (const r of Object.keys(cap.photos)) await dropDraftPhoto(cap.photos[r].photoId); cap.photos = {}; cap.barcode = null; cap.artSkipped = false; await saveDraft(); route(); } }, 'Retake this car')));
    v.append(box);
  } else if (!next && ((perCar && !cap.brandId) || (scalePer && !cap.scaleId))) {
    // Photos done: ask only what this box doesn't already decide (brand and/or scale); saves when both are known.
    const all = ref.brands;
    const quick = await quickBrands(all), recent = new Set(recentBrands());
    const done = async () => { saveDraftSoon(); if (cap.brandId && cap.scaleId) await afterRunPhoto(); else route(); };
    const pickBrand = async (id) => { if (!id) return; cap.brandId = id; cap.brandPicked = true; pushRecentBrand(id); await done(); };
    const pickScale = async (id) => { if (!id) return; cap.scaleId = id; cap.scalePicked = true; localStorage.setItem('smg.lastScale', id); await done(); };
    const card = h('div', { class: 'card brandpick' });
    if (perCar) {
      card.append(h('div', { class: 'hd' }, cap.brandId ? `Brand: ${all.find(b => b.brand_id === cap.brandId)?.name}` : 'Which brand is this car? (photos above)'));
      if (!cap.brandId) card.append(
        h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Tap the brand. Nothing is chosen until you tap.'),
        quick.length ? h('div', { class: 'chips', style: 'margin:10px 0' }, quick.map(b => recent.has(b.brand_id)
          ? h('span', { class: 'chipx' }, h('button', { type: 'button', class: 'chip big', onclick: () => pickBrand(b.brand_id) }, b.name),
              h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${b.name} from recent brands`, onclick: () => { forgetRecentBrand(b.brand_id); route(); } }, '×'))
          : h('button', { type: 'button', class: 'chip big', onclick: () => pickBrand(b.brand_id) }, b.name))) : '',
        h('select', { 'aria-label': 'Brand for this car', onchange: async (e) => pickBrand(await pickedBrandId(e.target.value, all, e.target)) }, brandOptions(all, '', quick.length ? '— another brand, or a new one —' : '— choose brand —')));
    }
    if (scalePer) {
      card.append(h('div', { class: 'hd', style: perCar ? 'margin-top:14px' : '' }, cap.scaleId ? `Scale: ${ref.scales.find(x => x.scale_id === cap.scaleId)?.label}` : 'Which scale?'));
      if (!cap.scaleId) card.append(h('div', { class: 'chips', style: 'margin:10px 0' }, ref.scales.filter(x => ['1:64', '1:43', '1:24', '1:18', '1:12'].includes(x.label)).map(x => h('button', { type: 'button', class: 'chip big', onclick: () => pickScale(x.scale_id) }, x.label))),
        h('select', { 'aria-label': 'Scale for this car', onchange: (e) => pickScale(e.target.value) }, h('option', { value: '' }, '— another scale —'), ref.scales.map(x => h('option', { value: x.scale_id }, x.label))));
    }
    v.append(card);
  } else if (next) {
    v.append(h('button', { class: 'wide runshot', onclick: async () => { runSetOpen = false; if (await takeCapPhoto(next, (t) => { say.textContent = t; })) await afterRunPhoto(); } }, icon('camera'), SHOT_ROLES[next].label));
    if (next === 'box_art') v.append(h('button', { class: 'wide ghost', style: 'margin-top:8px', onclick: async () => { cap.artSkipped = true; await afterRunPhoto(); } }, 'Skip box art'));
  } else {
    v.append(runSaving ? h('button', { class: 'wide', disabled: true, 'aria-busy': 'true' }, 'Saving…') : Object.values(cap.photos).some(p => !p.prep) ? h('button', { class: 'wide', disabled: true, 'aria-busy': 'true' }, 'Reading the photo…') : h('button', { class: 'wide', onclick: () => afterRunPhoto() }, 'Save this car'));
  }
  if (runLast) v.append(h('button', { class: 'wide quiet plusone', style: 'margin-top:10px', onclick: async () => {
    const { n, box } = await addCopy(runLast.id); runLast.copies = n; // same box as the car just saved
    toast(`Another ${runLast.label} added · now ${n} copies${box ? ` in ${box}` : ''} ✓`, 3000); route();
  } }, runLast.copies ? `＋1 more of ${runLast.label} (now ${runLast.copies})` : `Got another of ${runLast.label}? ＋1`));
  if (runLast) v.append(h('button', { class: 'wide ghost', style: 'margin-top:10px', onclick: async () => {
    if (!confirm(`Undo the last box (${runLast.label})? It is archived, not deleted, and can be restored from Garage → Archived.`)) return;
    await store.archive('models', runLast.id); toast('Last car undone (archived)'); runLast = null; route(); autoSyncSoon();
  } }, `Undo last car (${runLast.label})`));
  v.append(h('p', { class: 'muted', style: 'margin-top:14px' }, h('a', { href: '#/name' }, 'Name the boxes from this run →')));

  async function afterRunPhoto() { runWork = afterRunPhotoInner(); await runWork; }
  async function afterRunPhotoInner() {
    const need = ['box_front', 'box_rear', ...(cap.sealed && !cap.artSkipped ? ['box_art'] : [])];
    if (need.some(r => !cap.photos[r])) { route(); return; }
    if (Object.values(cap.photos).some(p => !p.prep)) { route(); try { await capReady(); } catch { return; } } // shows the photo, then finishes reading it
    if ((perCar && !cap.brandId) || (scalePer && !cap.scaleId)) { route(); return; } // ask what the box doesn't decide
    const [models, ids] = await Promise.all([store.list('models'), store.list('product_identifiers')]);
    const ns = assignNamespace(ref.brands.find(b => b.brand_id === cap.brandId) || brand, null);
    const r = checkDuplicate({ model_id: cap.modelId, brand_id: cap.brandId, code_namespace_id: ns.id, namespace_status: ns.status, product_code: '', display_name: '' }, models, ids, cap.barcode ? [cap.barcode.cmp] : []);
    if (r.possible.length) { cap.runDecision = r.possible; route(); return; }
    await saveRunBox();
  }
}
// Extra sides (s1-0.56.0, B 28 Nov): beyond the two required photos, only when a side shows something new.
const EXTRA_SIDES = [['car_inside', 'Car inside'], ['box_back', 'Back'], ['box_bottom', 'Bottom'], ['box_top', 'Top'], ['box_side', 'End'], ['detail', 'Damage']];
async function addSidePhoto(modelId, role) {
  const [f] = await pickPhoto({ camera: true }); if (!f) return null;
  const prep = await preparePhoto(f);
  const photoId = newId('photos');
  const items = await savePhotoRecords(modelId, { [role]: { photoId, prep, capturedAt: new Date().toISOString() } });
  items[0].fields.is_primary = 'no';
  await store.createMany(items);
  // A plain box (logo only, no picture of the car): the car itself becomes the main photo (B, 28 Nov)
  if (role === 'car_inside') { await store.update('models', modelId, { primary_photo_id: photoId }); await store.logChange('models', modelId, 'primary_photo_id', '', photoId, 'car inside the box made the main photo'); }
  const barcode = await barcodeFromPhoto(modelId, f, photoId, role);
  autoSyncSoon();
  return { photoId, barcode };
}
// Any photo can supply a missing barcode (never replaces one, never on a box marked "no barcode").
async function barcodeFromPhoto(modelId, file, photoId, role) {
  const m = await store.get('models', modelId);
  if (!m || m.barcode_absent === 'yes') return null;
  if ((await store.list('product_identifiers')).some(i => i.model_id === modelId && i.identifier_type === 'barcode' && i.value_cmp)) return null;
  let r = null; try { r = await scanPhoto(file); } catch (e) { console.warn('barcode from extra photo', e); }
  if (!r) return null;
  const raw = String(r.value).trim(), ok = gtinCheckOk(raw);
  await store.create('product_identifiers', { model_id: modelId, identifier_type: 'barcode', value_raw: raw, value_cmp: barcodeCmp(raw), barcode_format: r.format || '', check_digit_ok: ok === null ? '' : (ok ? 'yes' : 'no'), source: 'extra_photo', evidence_photo_id: photoId });
  await store.logChange('models', modelId, 'barcode', '', raw, `read from the ${(SHOT_ROLES[role]?.label || 'extra').toLowerCase()} photo`);
  return raw;
}
// ＋1 copies (B, 24 Nov): each tap adds a real copy record (own box, state, price, date), never just a number.
// A new copy starts in the given box (or the last copy's box), state copied, price and date unknown; logged.
async function addCopy(modelId, box) {
  const owned = (await store.list('inventory')).filter(i => i.model_id === modelId && i.ownership_status === 'Owned' && !i.deleted_at);
  const like = owned[owned.length - 1] || {};
  const c = await store.create('inventory', { model_id: modelId, ownership_status: 'Owned', storage_location: box ?? like.storage_location ?? '',
    packaging_state: like.packaging_state || '', purchase_date_precision: 'unknown' });
  await store.logChange('inventory', c.inventory_id, 'created', '', 'copy added', '＋1 copy');
  autoSyncSoon();
  return { n: owned.length + 1, box: c.storage_location || '' };
}
let runSaving = false; // a car is being saved: no second "Save" tap can start another save of the same car
async function saveRunBox() {
  if (runSaving) return;
  runSaving = true;
  const label = `car ${cap.count + 1}`;
  const id = cap.modelId;
  try { await saveCapture(); if (await store.get('models', id)) runLast = { id, label }; }
  finally { runSaving = false; }
  route();
}

// =====================================================================
// Name them: one nameless box at a time, big photo first (fills in after a Photo run).
// =====================================================================
const nameSkipped = new Set();

// ---------- names from Gemini or Claude (D2; security doc §2.3–2.4) ----------
// Only display copies (no location data) are shared; originals never leave Drive. The pasted answer is
// untrusted text: parsed and validated in ai.js, used only to pre-fill fields; B saves each one himself.
let aiPrep = null; // { batchId, ids, files, prompt } prepared in memory for the share tap
// Suggestions read by an older version of the reader are read again from the raw answer kept in AI_LOG
// (B, 24 Nov: wrong suggestions from out-of-order Gemini replies would otherwise stay on those cars).
const READER_VERSION = 5; // 5: "Item" = box column; same code on 2 boxes = assortment (B, 24 Nov 23:01) // 4: tables read by their headings (B's real Gemini reply, 24 Nov 22:47) // 3: "1995 Presentation" is not a code; barcode digits dropped (B, 24 Nov 22:38)
async function rereadSuggestions(ref) {
  const sugg = await meta.get('aiSuggest', {});
  const old = Object.entries(sugg).filter(([, sg]) => (sg.pv || 1) < READER_VERSION && sg.logId);
  if (!old.length) return 0;
  const photos = await store.list('photos');
  const modelOfPhoto = new Map(photos.map(p => [p.photo_id, p.model_id]));
  const names = [...ref.brands.map(x => x.name), ...ref.lines.map(x => x.name), ...KNOWN_BRANDS];
  let n = 0;
  for (const logId of new Set(old.map(([, sg]) => sg.logId))) {
    const log = await store.get('ai_log', logId);
    const order = String(log?.input_photo_ids || '').split(',').filter((_, i) => i % 2 === 0).map(id => modelOfPhoto.get(id)); // box k = its front photo
    if (!log?.ai_response_raw || !order.length) continue;
    const r = parseAnswer(log.ai_response_raw, order.length, names);
    for (const it of r.items) {
      const mid = order[it.n - 1];
      if (mid && sugg[mid] && (sugg[mid].pv || 1) < READER_VERSION) { sugg[mid] = { name: it.name, code: it.code, brand: it.brand, colour: it.colour || '', carNote: it.carNote || '', notes: it.notes, logId, pv: READER_VERSION }; n++; }
    }
  }
  for (const [mid, sg] of Object.entries(sugg)) if ((sg.pv || 1) < READER_VERSION) sugg[mid] = { ...sg, pv: READER_VERSION }; // could not re-read: leave as is, once
  await meta.set('aiSuggest', sugg);
  return n;
}
// "How Gemini did" (B, 25 Nov): every Gemini reply kept in AI_LOG is read again with today's reader and compared
// with what B saved, so old reader bugs don't count against Gemini. Cars named without AI are not counted.
const normTxt = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
async function geminiScore(ref) {
  const [logs, models, photos] = await Promise.all([store.list('ai_log'), store.list('models'), store.list('photos')]);
  const modelById = new Map(models.map(m => [m.model_id, m]));
  const modelOfPhoto = new Map(photos.map(p => [p.photo_id, p.model_id]));
  const names = [...ref.brands.map(x => x.name), ...ref.lines.map(x => x.name), ...KNOWN_BRANDS];
  const per = new Map(); // model_id -> outcome (latest reply wins)
  for (const log of logs.sort((a, b) => String(a.processed_at || '').localeCompare(String(b.processed_at || '')))) {
    let confirmed = {}; try { confirmed = JSON.parse(log.confirmed_values || '{}'); } catch {}
    if (!Object.keys(confirmed).length || !log.ai_response_raw) continue;
    const order = String(log.input_photo_ids || '').split(',').filter((_, i) => i % 2 === 0).map(id => modelOfPhoto.get(id));
    const parsed = parseAnswer(log.ai_response_raw, order.length || 10, names).items;
    for (const mid of Object.keys(confirmed)) {
      const m = modelById.get(mid); if (!m || !String(m.display_name || '').trim()) continue;
      const it = parsed.find(x => order[x.n - 1] === mid) || {};
      const sName = normTxt(it.name), mName = normTxt(m.display_name);
      const shared = sName && mName ? mName.split(' ').filter(w => sName.split(' ').includes(w)).length / mName.split(' ').length : 0;
      const savedCode = String(m.product_code || '').trim(), sCode = String(it.code || '').trim();
      const codeOk = savedCode ? normTxt(sCode) === normTxt(savedCode) : !sCode;
      const outcome = sName === mName && codeOk ? 'right' : shared >= 0.5 ? 'fix' : 'wrong';
      per.set(mid, { outcome, hasCode: !!savedCode, codeRight: !!savedCode && normTxt(sCode) === normTxt(savedCode), combined: String(log.prompt_version || '').endsWith(COMBINED_SUFFIX) });
    }
  }
  const all = [...per.values()];
  const part = (xs) => ({ n: xs.length, right: xs.filter(x => x.outcome === 'right').length, codes: xs.filter(x => x.hasCode).length, codesRight: xs.filter(x => x.codeRight).length });
  return { sep: part(all.filter(x => !x.combined)), comb: part(all.filter(x => x.combined)), n: all.length, right: all.filter(x => x.outcome === 'right').length, fix: all.filter(x => x.outcome === 'fix').length,
    wrong: all.filter(x => x.outcome === 'wrong').length, codes: all.filter(x => x.hasCode).length, codesRight: all.filter(x => x.codeRight).length };
}
// What Gemini said each car's colour is: latest AI_LOG reply read with today's reader, plus open suggestions.
async function aiColours(ref) {
  const [logs, photos, sugg] = await Promise.all([store.list('ai_log'), store.list('photos'), meta.get('aiSuggest', {})]);
  const modelOfPhoto = new Map(photos.map(p => [p.photo_id, p.model_id]));
  const names = [...ref.brands.map(x => x.name), ...ref.lines.map(x => x.name), ...KNOWN_BRANDS];
  const out = new Map();
  for (const log of logs.sort((a, b) => String(a.processed_at || '').localeCompare(String(b.processed_at || '')))) {
    if (!log.ai_response_raw) continue;
    const order = String(log.input_photo_ids || '').split(',').filter((_, i) => i % 2 === 0).map(id => modelOfPhoto.get(id));
    for (const it of parseAnswer(log.ai_response_raw, order.length || 10, names).items) {
      const mid = order[it.n - 1]; if (!mid) continue;
      const cur = out.get(mid) || {}; const fam = familyFrom(it.colour);
      out.set(mid, { ...cur, ...(fam ? { family: fam, name: it.colour } : {}), ...(it.carNote ? { note: it.carNote } : {}) });
    }
  }
  for (const [mid, sg] of Object.entries(sugg)) {
    const cur = out.get(mid) || {}; const fam = familyFrom(sg.colour);
    out.set(mid, { ...cur, ...(fam ? { family: fam, name: sg.colour } : {}), ...(sg.carNote ? { note: sg.carNote } : {}) });
  }
  return out; // model_id -> { family?, name?, note? } (what Gemini said; nothing saved)
}
async function setColour(modelId, family, name, reason) {
  const m = await store.get('models', modelId); if (!m) return;
  await store.update('models', modelId, { colour_family: family, colour_name: name || '' });
  await store.logChange('models', modelId, 'colour_family', m.colour_family || '', family, reason);
  autoSyncSoon();
}
function swatchRow(current, onPick) {
  return h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' }, COLOUR_FAMILIES.map(([k, label, bg]) =>
    h('button', { type: 'button', class: `sw ${current === k ? 'on' : ''}`, role: 'radio', 'aria-checked': current === k ? 'true' : 'false', 'aria-label': label, title: label,
      style: `background:${bg}`, onclick: () => onPick(k) })));
}
async function geminiScoreCard(ref) {
  let sc; try { sc = await geminiScore(ref); } catch (e) { console.warn('score', e); return null; }
  if (!sc.n) return null;
  const pct = (k) => Math.round(100 * k / sc.n);
  return h('details', { class: 'card more gscore' }, h('summary', {}, `How Gemini did · ${sc.right} of ${sc.n} right as suggested`),
    h('div', { class: 'scorebar', role: 'img', 'aria-label': `${sc.right} right, ${sc.fix} small fixes, ${sc.wrong} rewritten` },
      h('span', { class: 'ok', style: `width:${pct(sc.right)}%` }), h('span', { class: 'fix', style: `width:${pct(sc.fix)}%` }), h('span', { class: 'bad', style: `width:${pct(sc.wrong)}%` })),
    h('div', { class: 'scorelegend' },
      h('div', {}, h('b', {}, `✅ ${sc.right}`), ' right as suggested'),
      h('div', {}, h('b', {}, `✏️ ${sc.fix}`), ' small fixes'),
      h('div', {}, h('b', {}, `❌ ${sc.wrong}`), ' rewritten')),
    h('p', {}, h('b', {}, `Codes right: ${sc.codesRight} of ${sc.codes}`), h('span', { class: 'muted' }, ' (cars where you saved a code)')),
    sc.comb.n ? h('div', { class: 'scoresplit' }, h('b', {}, 'Separate vs combined photos'),
      h('div', {}, `Separate: ${sc.sep.right} of ${sc.sep.n} right · codes ${sc.sep.codesRight} of ${sc.sep.codes}`),
      h('div', {}, `Combined: ${sc.comb.right} of ${sc.comb.n} right · codes ${sc.comb.codesRight} of ${sc.comb.codes}`)) : null,
    h('p', { class: 'muted small' }, `Counts the ${plural(sc.n, 'car', 'cars')} you named from a Gemini answer, comparing Gemini's reply (read with today's reader) with what you saved.`));
}
const aiState = async () => ({ batch: await meta.get('aiBatch', null), sugg: await meta.get('aiSuggest', {}) });
async function photoFileFor(p, name) {
  let b = await blobs.get(`${p.photo_id}:display`);
  if (!b && p.display_file_id && navigator.onLine && hasToken()) { try { b = await drive.download(p.display_file_id); } catch (e) { console.warn('display download', e.message); } }
  if (!b) b = await blobs.get(`${p.photo_id}:thumb`);
  return b ? new File([b], name, { type: 'image/jpeg' }) : null;
}
// Combined photos became the default in s1-0.57.0 (B, 28 Nov: combined 14/14 right, codes 7/7 vs separate 9/17, 14/17)
const aiCombine = () => localStorage.getItem('smg.aiCombine') !== '0';
// The switch; changing it while a batch is prepared prepares it again in the new mode.
function combineChips() {
  const setMode = (on) => { if (aiCombine() === on) return; localStorage.setItem('smg.aiCombine', on ? '1' : '0'); if (aiPrep && aiPrep.mode === 'names') { aiPrep = null; nameAutoNext = true; } route(); };
  return h('div', { class: 'chips', style: 'margin:8px 0' },
    h('button', { type: 'button', class: `chip ${!aiCombine() ? 'on' : ''}`, onclick: () => setMode(false) }, '2 photos per box · 5 boxes'),
    h('button', { type: 'button', class: `chip ${aiCombine() ? 'on' : ''}`, onclick: () => setMode(true) }, 'Combine front + back · 10 boxes'));
}
const batchSize = () => (aiCombine() ? MAX_BATCH_COMBINED : MAX_BATCH);
// Front on the left, back on the right, same height (up to the display copy's 1600 px), one JPEG. No location data
// (made from the display copies, which have none).
async function combinePair(frontFile, rearFile, name) {
  const [a, b] = await Promise.all([createImageBitmap(frontFile), createImageBitmap(rearFile)]);
  const H = Math.min(1600, Math.max(a.height, b.height));
  const wa = Math.round(a.width * H / a.height), wb = Math.round(b.width * H / b.height), gap = 16;
  const c = document.createElement('canvas'); c.width = wa + gap + wb; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(a, 0, 0, wa, H); g.drawImage(b, wa + gap, 0, wb, H);
  a.close?.(); b.close?.();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return new File([blob], name, { type: 'image/jpeg' });
}
async function prepareAiBatch(todo, ref, { extras = false } = {}) {
  const combined = aiCombine();
  const pick = todo.slice(0, batchSize());
  const photos = await store.list('photos');
  const files = [], boxes = [], ids = [], photoIds = [];
  for (const m of pick) {
    const mine = photos.filter(p => p.model_id === m.model_id);
    const front = mine.find(p => p.photo_id === m.primary_photo_id) || mine.find(p => p.shot_role === 'box_front');
    const rear = mine.find(p => p.shot_role === 'box_rear');
    const k = ids.length + 1;
    const ff = front && await photoFileFor(front, `box${k}-front.jpg`);
    const rf = rear && await photoFileFor(rear, `box${k}-back.jpg`);
    if (!ff) continue; // a box without a usable photo can't be read
    if (combined) files.push(await combinePair(ff, rf || ff, `box${k}.jpg`)); else files.push(ff, rf || ff);
    photoIds.push(front.photo_id, (rf ? rear : front).photo_id); ids.push(m.model_id); // pairs kept in AI_LOG either way
    boxes.push({ brand: ref.brands.find(b => b.brand_id === m.brand_id)?.name, scale: ref.scales.find(x => x.scale_id === m.scale_id)?.label, name: m.display_name || '' });
  }
  return { batchId: newId('ai_log'), ids, files, photoIds, combined, mode: extras ? 'extras' : 'names', prompt: buildPrompt(boxes, { extras, combined }) };
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

// Notes & colours for cars already named (B, 24 Nov): same share → paste flow, nothing saved until B keeps it.
function extrasCard(models, ref, readings) {
  const need = models.filter(m => String(m.display_name || '').trim() && (
    (!m.car_note && m.car_note_source !== 'hidden' && !readings.get(m.model_id)?.note) || (!m.colour_family && !readings.get(m.model_id)?.family)));
  if (!need.length) return null;
  return h('div', { class: 'card extras' }, h('h3', {}, '🎉 Notes & colours'),
    h('p', { class: 'muted' }, `${plural(need.length, 'named car has', 'named cars have')} no note or colour yet. Gemini adds a fun fact, history, pop-culture or casting note, and the car's colour.`),
    h('button', { type: 'button', class: 'quiet wide', onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Preparing photos…';
      aiPrep = await prepareAiBatch(need, ref, { extras: true });
      if (!aiPrep.ids.length) { aiPrep = null; toast('No photos found to send', 3000, 'warn'); }
      route();
    } }, `Get notes & colours for the next ${Math.min(batchSize(), need.length)} cars`));
}
// Save a name (and code) for one car, with everything Gemini suggested that B accepts by saving:
// colour, note, brand for a brand-less car (single clear match only). Used by the one-at-a-time and the list view.
let nameView = 'list', nameAutoNext = false, nameFlipIn = false;
const nameDrafts = new Map(); // typed edits in the list view survive a redraw (e.g. after a discard)
async function nameList(cars, sugg, ref, models, inv, ids) {
  const wrap = h('div', { class: 'namelist' });
  const photos = await store.list('photos');
  const rows = [];
  wrap.append(h('div', { class: 'row', style: 'align-items:center;margin-bottom:6px' },
    h('h3', { style: 'flex:1;margin:0' }, `Check ${plural(cars.length, 'suggestion', 'suggestions')}`),
    h('button', { type: 'button', class: 'ghost small', onclick: () => { nameView = 'one'; route(); } }, 'One at a time')),
    h('p', { class: 'muted' }, 'Compare each name with its box photo (tap a photo to enlarge). Fix anything wrong, untick what you are unsure of, then save.'));
  // Faster naming check (25 Nov): what the app already knows, shown beside Gemini's answer. Learned only from
  // B's own cars: barcodes it scanned, codes already in the garage, and the usual shape of each brand's codes.
  const liveModels = models.filter(x => !x.deleted_at);
  const shapeOf = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[A-Z]/g, 'A').replace(/[0-9]/g, '9');
  const brandCodes = new Map(); // brand_id → [{code, shape, model_id}]
  for (const x of liveModels) if (x.brand_id && String(x.product_code || '').trim()) { const arr = brandCodes.get(x.brand_id) || []; arr.push({ code: x.product_code.trim(), shape: shapeOf(x.product_code), model_id: x.model_id, name: x.display_name }); brandCodes.set(x.brand_id, arr); }
  const bcOf = new Map(); const bcOwners = new Map();
  for (const i of ids.filter(i => i.identifier_type === 'barcode' && !i.deleted_at && String(i.value_raw || '').trim())) {
    if (!bcOf.has(i.model_id)) bcOf.set(i.model_id, String(i.value_raw).trim());
    const k = barcodeCmp(i.value_raw); const arr = bcOwners.get(k) || []; arr.push(i.model_id); bcOwners.set(k, arr);
  }
  const nameOf = (id) => liveModels.find(x => x.model_id === id)?.display_name || 'a car with no name yet';
  const checksFor = (m, code) => {
    const out = [];
    const bc = bcOf.get(m.model_id);
    if (bc) {
      const others = (bcOwners.get(barcodeCmp(bc)) || []).filter(x => x !== m.model_id && liveModels.some(y => y.model_id === x));
      out.push(others.length ? ['warn', `Barcode ${bc} is also on ${nameOf(others[0])}: same car?`] : ['ok', `Barcode ${bc} (scanned)`]);
    } else if (m.barcode_absent === 'yes') out.push(['info', 'No barcode on this box']);
    if (m.code_absent === 'yes' && !String(m.product_code || '').trim()) out.push(['info', 'No product code on this box']);
    else out.push(['info', 'No barcode read']);
    const c = String(code || '').trim();
    if (c && m.brand_id) {
      const mine = (brandCodes.get(m.brand_id) || []).filter(x => x.model_id !== m.model_id);
      const same = mine.find(x => codeCmp(x.code) === codeCmp(c));
      if (same) out.push(['warn', `Code ${c} is already in your garage: ${same.name || 'a car with no name yet'}`]);
      else if (mine.length >= 2) {
        const sh = shapeOf(c); const like = mine.filter(x => x.shape === sh);
        if (like.length) out.push(['ok', `Code looks like your other ${ref.brands.find(b => b.brand_id === m.brand_id)?.name || ''} codes`]);
        else { const tally = new Map(); mine.forEach(x => tally.set(x.shape, (tally.get(x.shape) || 0) + 1)); const top = [...tally].sort((a, b) => b[1] - a[1])[0][0]; const eg = mine.find(x => x.shape === top).code;
          out.push(['warn', `Unusual for your ${ref.brands.find(b => b.brand_id === m.brand_id)?.name || ''} codes (they look like ${eg}): check the back`]); }
      }
    }
    return out;
  };
  for (const m of cars) {
    const sg = sugg[m.model_id];
    const brand = ref.brands.find(b => b.brand_id === m.brand_id);
    const ph = photos.filter(p => p.model_id === m.model_id && !p.deleted_at);
    const front = ph.find(p => p.photo_id === m.primary_photo_id) || ph.find(p => p.shot_role === 'box_front') || ph[0];
    const rear = ph.find(p => p.shot_role === 'box_rear');
    const img = h('img', { alt: 'Box front', class: 'nl-ph' });
    if (front) photoUrl(front, 'display').then(u => { if (u) img.src = u; });
    let showing = 'front';
    img.addEventListener('click', () => img.classList.toggle('big'));
    // the back (where the code is) beside the front, so it can be checked without a tap
    const back = rear ? h('img', { alt: 'Box back', class: 'nl-ph nl-back' }) : null;
    if (back) { photoUrl(rear, 'display').then(u => { if (u) back.src = u; }); back.addEventListener('click', () => back.classList.toggle('big')); }
    const flip = rear ? h('button', { type: 'button', class: 'ghost small nl-flip', onclick: () => { showing = showing === 'front' ? 'rear' : 'front'; flip.textContent = showing === 'front' ? 'See barcode photo' : 'See front'; photoUrl(showing === 'front' ? front : rear, 'display').then(u => { if (u) img.src = u; }); } }, 'See back') : null;
    const dr = nameDrafts.get(m.model_id) || {};
    const nameIn = h('input', { value: dr.name ?? (m.display_name || sg.name || ''), 'aria-label': 'Name', autocapitalize: 'words' });
    const codeIn = h('input', { value: dr.code ?? (m.product_code || sg.code || ''), 'aria-label': 'Product code', autocapitalize: 'characters', placeholder: 'Code (optional)' });
    const tick = h('input', { type: 'checkbox', checked: dr.tick === false ? undefined : true, 'aria-label': 'Save this one' });
    const keep = () => nameDrafts.set(m.model_id, { name: nameIn.value, code: codeIn.value, tick: tick.checked });
    nameIn.addEventListener('input', keep); codeIn.addEventListener('input', keep); tick.addEventListener('change', keep);
    const codeNote = m.product_code && sg.code && sg.code !== m.product_code ? `AI read "${sg.code}"; keeping the saved code.` : null;
    const chk = h('div', { class: 'nl-checks' });
    const drawChecks = () => chk.replaceChildren(...checksFor(m, codeIn.value).map(([k, t]) => h('div', { class: `nl-chip ${k}` }, k === 'ok' ? '✓ ' : k === 'warn' ? '⚠ ' : '', t)));
    drawChecks(); codeIn.addEventListener('input', drawChecks);
    const nameNote = m.display_name && sg.name && normTxt(sg.name) !== normTxt(m.display_name) ? `Gemini read the name as "${sg.name}"; keeping yours.` : null;
    const notes = [...(sg.notes || []), brandNote(sg.brand, brand?.name), codeNote, nameNote].filter(Boolean);
    const fam = familyFrom(sg.colour);
    const card = h('div', { class: 'nl-row' },
      h('div', { class: 'nl-top' }, h('div', { class: 'nl-left' }, h('div', { class: 'nl-pair' }, img, back), h('span', { class: 'muted small' }, back ? 'Front · Barcode' : 'Front')),
        h('div', { class: 'nl-f' },
          h('div', { class: 'muted small' }, [brand?.name || (sg.brand ? `${sg.brand}?` : 'Brand not set'), ref.scales.find(x => x.scale_id === m.scale_id)?.label, inv.find(i => i.model_id === m.model_id && i.storage_location)?.storage_location].filter(Boolean).join(' · ')),
          nameIn, codeIn, chk,
          fam ? h('div', { class: 'muted small' }, h('span', { class: 'cdot', style: `background:${familySwatch(fam)}` }), ` ${sg.colour}`) : null,
          sg.carNote && !m.car_note ? h('div', { class: 'muted small nl-carnote' }, `Note: ${sg.carNote.length > 110 ? sg.carNote.slice(0, 108) + '…' : sg.carNote}`) : null,
          ...notes.map(t => h('div', { class: 'muted small nl-note' }, t)))),
      h('div', { class: 'row', style: 'align-items:center;margin-top:8px' }, h('label', { class: 'nl-tick', style: 'flex:1;margin:0' }, tick, ' Save this one'),
        h('button', { type: 'button', class: 'ghost small', onclick: async () => { const rest = { ...(await meta.get('aiSuggest', {})) }; delete rest[m.model_id]; await meta.set('aiSuggest', rest); nameDrafts.delete(m.model_id); toast('Suggestion discarded. This car can go in the next Gemini batch.', 3000); route(); } }, 'Discard suggestion')));
    if (nameFlipIn && motionOn()) { card.classList.add('flipin'); card.style.animationDelay = `${rows.length * 120}ms`; }
    tick.addEventListener('change', () => card.classList.toggle('off', !tick.checked));
    if (!tick.checked) card.classList.add('off');
    rows.push({ m, sg, nameIn, codeIn, tick });
    wrap.append(card);
  }
  const btn = h('button', { class: 'save', id: 'nameSaveAll', onclick: async () => {
    const go = rows.filter(r => r.tick.checked);
    if (go.some(r => !r.nameIn.value.trim())) { toast('A ticked car has no name: type one or untick it', 3500, 'warn'); return; }
    if (!go.length) { toast('Nothing ticked', 2000, 'warn'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    for (const r of go) { const kept = r.m.display_name && r.nameIn.value.trim() === r.m.display_name; await applyName(r.m, r.nameIn.value.trim(), r.codeIn.value.trim(), kept ? { ...r.sg, name: r.m.display_name } : r.sg, ref, models, ids); nameDrafts.delete(r.m.model_id); }
    nameAutoNext = true;
    toast(`Named ${plural(go.length, 'car', 'cars')} ✓${go.length < rows.length ? ` · ${rows.length - go.length} left for later` : ''}`, 3000);
    route(); autoSyncSoon();
  } }, `Save ${rows.length}`);
  function sync() { const n = rows.filter(r => r.tick.checked).length; btn.textContent = n ? `Save ${n}` : 'Nothing ticked'; btn.classList.toggle('quiet', !n); }
  rows.forEach(r => r.tick.addEventListener('change', sync));
  sync();
  nameFlipIn = false;
  wrap.append(h('div', { class: 'savebar' }, h('div', { class: 'need' }, 'Unticked ones stay here for later'), btn));
  return wrap;
}

async function applyName(m, name, code, sg, ref, models, ids) {
  const brand = ref.brands.find(b => b.brand_id === m.brand_id);
  const ns = assignNamespace(brand, null);
  const patch = { display_name: name, product_code: code, product_code_cmp: codeCmp(code), code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status };
  patch.duplicate_check_status = duplicateCheckStatus(patch);
  if (code !== (m.product_code || '')) await store.logChange('models', m.model_id, 'product_code', m.product_code, code, 'named in app');
  if (code) {
    const r = checkDuplicate({ ...m, ...patch }, models, ids, []);
    if (r.status === 'duplicate') toast(`Same code as "${r.exact[0].display_name || r.exact[0].product_code}". Check both in the Garage.`, 5000, 'warn');
  }
  const fam = familyFrom(sg?.colour);
  if (fam && !m.colour_family) { patch.colour_family = fam; patch.colour_name = sg.colour; }
  if (sg?.carNote && !m.car_note && m.car_note_source !== 'hidden') { patch.car_note = sg.carNote; patch.car_note_source = 'gemini'; }
  // Imported with "brands later": take the brand Gemini read, only when exactly one of B's brands is in it
  if (!m.brand_id && sg?.brand) {
    const hits = ref.brands.filter(b => normName(b.name).length >= 2 && normName(sg.brand).includes(normName(b.name)));
    if (hits.length === 1) { const nb = hits[0]; const ns2 = assignNamespace(nb, null); Object.assign(patch, { brand_id: nb.brand_id, printed_brand_text: m.printed_brand_text || nb.name, code_namespace_type: ns2.type, code_namespace_id: ns2.id, namespace_status: ns2.status }); patch.duplicate_check_status = duplicateCheckStatus({ ...m, ...patch }); }
  }
  if (sg) {
    // Record what B confirmed against what the AI suggested (AI_LOG, security doc §2.4).
    patch.identification_status = 'confirmed';
    const log = await store.get('ai_log', sg.logId);
    if (log) { let c = {}; try { c = JSON.parse(log.confirmed_values || '{}'); } catch { c = {}; } c[m.model_id] = { name, code, edited: name !== sg.name || code !== sg.code }; await store.update('ai_log', sg.logId, { confirmed_values: JSON.stringify(c) }); }
    const rest = { ...(await meta.get('aiSuggest', {})) }; delete rest[m.model_id]; await meta.set('aiSuggest', rest);
    const asked = { ...(await meta.get('aiAsked', {})) }; asked[m.model_id] = store.nowIso(); await meta.set('aiAsked', asked);
  }
  await store.update('models', m.model_id, patch);
}

async function renderName(v) {
  const ref = await refData();
  try { const n = await rereadSuggestions(ref); if (n) toast(`${plural(n, 'AI suggestion', 'AI suggestions')} read again with the improved reader`, 3500); } catch (e) { console.warn('re-read', e); }
  const [models, inv, ids] = await Promise.all([store.list('models'), store.list('inventory'), store.list('product_identifiers')]);
  // One Gemini round does everything (B, 25 Nov: "a single step… take care of all these aspects"): any car missing a
  // name, code, colour or note goes in the same round; nameless boxes first. A named car already asked about isn't
  // sent again (a box may truly have no code), unless B sends it from its car page.
  const { batch, sugg } = await aiState();
  const readings = await aiColours(ref);
  const asked = await meta.get('aiAsked', {});
  const live = models.filter(m => !m.deleted_at);
  const nameless = live.filter(m => !String(m.display_name || '').trim()).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const incomplete = live.filter(m => String(m.display_name || '').trim() && !asked[m.model_id] && (
    (!String(m.product_code || '').trim() && m.code_absent !== 'yes') || (!m.colour_family && !readings.get(m.model_id)?.family) || (!m.car_note && m.car_note_source !== 'hidden' && !readings.get(m.model_id)?.note)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const todo = [...nameless, ...incomplete];
  v.append(h('div', { class: 'row' }, h('h2', {}, 'Name them'), h('div', { class: 'muted', style: 'text-align:right' }, [nameless.length ? `${plural(nameless.length, 'box needs', 'boxes need')} a name` : '', incomplete.length ? `${plural(incomplete.length, 'named car misses', 'named cars miss')} a code, colour or note` : ''].filter(Boolean).join(' · '))));
  const scoreCard = await geminiScoreCard(ref);
  // Cars Gemini already tried that still have no product code (B, 28 Nov): ask again, or type it from the box
  const noCodeAsked = live.filter(m => asked[m.model_id] && !String(m.product_code || '').trim() && m.code_absent !== 'yes');
  const askAgainCard = noCodeAsked.length ? h('div', { class: 'card askagain' },
    h('div', { style: 'font-weight:700' }, `${plural(noCodeAsked.length, 'car', 'cars')} still without a product code`),
    h('p', { class: 'muted small', style: 'margin:4px 0 8px' }, 'Gemini had a go but found none. Ask again (combined photos read codes better), or type it from the box: it is printed near the barcode. Some boxes have no code at all.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'small', onclick: async () => {
        const a = { ...(await meta.get('aiAsked', {})) }; for (const m of noCodeAsked) delete a[m.model_id]; await meta.set('aiAsked', a);
        toast(`${plural(noCodeAsked.length, 'car goes', 'cars go')} back to Gemini`, 2500); route();
      } }, `✨ Ask Gemini again (${noCodeAsked.length})`),
      h('button', { type: 'button', class: 'small quiet', onclick: () => { garageFilter = 'nocode'; garageSearch = ''; location.hash = '#/'; } }, 'Type them in'))) : null;
  if (!todo.length && !batch && !aiPrep && !live.some(m => sugg[m.model_id])) { nameSkipped.clear(); v.append(h('div', { class: 'banner ok' }, 'Every car has its name, code, colour and note (or Gemini has had a go) ✓'), ...(askAgainCard ? [askAgainCard] : []), scoreCard || '', h('p', {}, h('a', { href: '#/' }, '← Garage'))); return; }

  // --- AI panel: prepare → share → paste answer ---
  const aiCard = h('div', { class: 'card aicard' }, h('h3', {}, '✨ Names, codes, colours and notes from Gemini'));
  const nSugg = todo.filter(x => sugg[x.model_id]).length;
  if (batch) {
    const ta = h('textarea', { placeholder: 'Paste the whole answer here', 'aria-label': 'AI answer' });
    // Gemini's app keeps the photos but drops the text shared with them (B, 24–25 Nov): without the instructions
    // it makes up its own table, with no Colour or Note. So the reminder is big and the instructions one tap away.
    aiCard.append(h('div', { class: 'banner warn pastehint' },
        h('div', { class: 'hd' }, 'In Gemini: paste the instructions with the photos'),
        h('div', {}, 'Gemini\'s app often drops them. Long-press the message box in Gemini → Paste → send.'),
        batch.prompt ? h('button', { type: 'button', class: 'small', style: 'margin-top:8px', onclick: async () => { toast(await copyText(batch.prompt) ? 'Instructions copied ✓ Paste them in Gemini' : 'Could not copy', 2500); } }, 'Copy the instructions again') : null),
      h('p', { class: 'muted' }, `Then copy Gemini's whole reply for ${plural(batch.ids.length, 'box', 'boxes')} and paste it here.`), ta,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { type: 'button', onclick: async () => { try { ta.value = await navigator.clipboard.readText(); } catch { toast('Long-press the box above and choose Paste', 3500, 'warn'); return; } if (ta.value.trim()) aiCard.querySelector('.useanswer').click(); else toast('Nothing copied yet. In Gemini, tap Copy under the reply.', 3500, 'warn'); } }, '📋 Paste & use'),
        h('button', { type: 'button', class: 'quiet useanswer', onclick: async () => {
          const r = parseAnswer(ta.value, batch.ids.length, [...ref.brands.map(x => x.name), ...ref.lines.map(x => x.name), ...KNOWN_BRANDS]);
          if (!r.items.length) { toast('No answer lines found. It should look like: Box 1 | name | code | brand', 4500, 'warn'); return; }
          if (batch.mode === 'extras') { // named cars: keep the reply; notes and colours are read from it on each car page
            await store.update('ai_log', batch.logId, { ai_response_raw: ta.value.slice(0, 5000), suggested_values: JSON.stringify(r.items.map(it => ({ model_id: batch.ids[it.n - 1], colour: it.colour, note: it.carNote }))) });
            await meta.set('aiBatch', null);
            toast(`Notes and colours read for ${plural(r.items.length, 'car', 'cars')}: open a car to see its note; Garage → By colour → Use all`, 5000); route(); autoSyncSoon(); return;
          }
          const next = { ...(await meta.get('aiSuggest', {})) };
          for (const it of r.items) next[batch.ids[it.n - 1]] = { name: it.name, code: it.code, brand: it.brand, colour: it.colour || '', carNote: it.carNote || '', notes: it.notes, logId: batch.logId, pv: READER_VERSION };
          await meta.set('aiSuggest', next);
          await store.update('ai_log', batch.logId, { ai_response_raw: ta.value.slice(0, 5000), suggested_values: JSON.stringify(r.items.map(it => ({ model_id: batch.ids[it.n - 1], name: it.name, code: it.code, brand: it.brand }))), processed_at: store.nowIso() });
          await meta.set('aiBatch', null);
          nameFlipIn = true;
          toast(`Suggestions for ${r.items.length} of ${plural(batch.ids.length, 'box', 'boxes')}: check each one`, 3500); route(); autoSyncSoon();
        } }, 'Use this answer')),
      h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: async () => { await meta.set('aiBatch', null); route(); } }, 'Cancel'));
  } else if (aiPrep) {
    const canFiles = !!(navigator.canShare && navigator.canShare({ files: aiPrep.files }));
    aiCard.append(aiPrep.mode === 'names' ? combineChips() : '', h('p', { class: 'muted' }, `${plural(aiPrep.ids.length, 'box', 'boxes')}, ${aiPrep.files.length} photos ready (copies without location data).`),
      h('button', { type: 'button', class: 'wide', onclick: async () => {
        const copied = await copyText(aiPrep.prompt);
        try {
          if (canFiles) await navigator.share({ files: aiPrep.files, text: aiPrep.prompt, title: 'Box names' });
          else throw new Error('no-file-share');
        } catch (e) {
          if (e.name === 'AbortError') { toast('Share cancelled'); return; }
          toast(copied ? 'This phone can\'t share photos from here. Instructions copied; download the photos below.' : 'Sharing isn\'t available here.', 5000, 'warn');
          aiCard.append(h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' }, aiPrep.files.map(f => h('a', { class: 'btn quiet small', href: URL.createObjectURL(f), download: f.name }, f.name))));
          return;
        }
        const log = await store.create('ai_log', { ai_log_id: aiPrep.batchId, capture_session_id: aiPrep.batchId, ai_tool: 'gemini_or_claude_app (copy-paste)', prompt_version: PROMPT_VERSION + (aiPrep.combined ? COMBINED_SUFFIX : ''), input_photo_ids: aiPrep.photoIds.join(','), processed_at: store.nowIso() });
        await meta.set('aiBatch', { logId: log.ai_log_id, ids: aiPrep.ids, mode: aiPrep.mode, prompt: aiPrep.prompt });
        aiPrep = null; toast(copied ? 'Shared ✓ If the instructions are missing, paste them (already copied).' : 'Shared', 4000); route();
      } }, canFiles ? 'Share to Gemini or Claude' : 'Copy instructions and get the photos'),
      h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: async () => { toast(await copyText(aiPrep.prompt) ? 'Instructions copied' : 'Could not copy', 2000); } }, 'Copy the instructions only'),
      h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: () => { aiPrep = null; route(); } }, 'Cancel'));
  } else {
    const left = todo.filter(x => !sugg[x.model_id]);
    if (nameAutoNext && left.length) { // straight after "Save all": the next photos are got ready without a tap
      nameAutoNext = false;
      aiPrep = await prepareAiBatch(left, ref);
      if (aiPrep.ids.length) { route(); return; }
      aiPrep = null;
    }
    nameAutoNext = false;
    aiCard.append(h('p', { class: 'muted' }, nSugg ? `${plural(nSugg, 'box has', 'boxes have')} an AI suggestion waiting below.` : 'One round: share the photos, paste Gemini\'s answer, check, save. Each car gets its name, code, colour and note together; nothing is saved until you check it.'),
      combineChips(),
      h('button', { type: 'button', class: nSugg ? 'quiet wide' : 'wide', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Preparing photos…';
        aiPrep = await prepareAiBatch(todo.filter(x => !sugg[x.model_id]), ref);
        if (!aiPrep.ids.length) { aiPrep = null; toast('No photos found to send', 3000, 'warn'); }
        route();
      } }, `Do the next ${plural(Math.min(batchSize(), todo.filter(x => !sugg[x.model_id]).length) || 0, 'box', 'boxes')} with Gemini`));
  }
  if (batch?.mode === 'extras' || aiPrep?.mode === 'extras') aiCard.querySelector('h3').textContent = '🎉 Notes & colours from Gemini';
  v.append(aiCard);
  if (!todo.length) { if (scoreCard) v.append(scoreCard); return; }

  // Check all suggestions on one page (faster rounds, 25 Nov): one look per car, one Save for the batch.
  const withSugg = live.filter(x => sugg[x.model_id]).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (withSugg.length >= 1 && (nameView === 'list' || withSugg.some(x => String(x.display_name || '').trim()))) {
    v.append(await nameList(withSugg, sugg, ref, models, inv, ids));
    if (scoreCard) v.append(scoreCard);
    return;
  }
  if (withSugg.length >= 2) v.append(h('button', { type: 'button', class: 'ghost small', style: 'margin:0 0 8px', onclick: () => { nameView = 'list'; route(); } }, `Check all ${withSugg.length} suggestions on one page`));
  if (!nameless.length) { if (scoreCard) v.append(scoreCard); return; }
  let m = nameless.find(x => !nameSkipped.has(x.model_id));
  if (!m) { nameSkipped.clear(); m = nameless[0]; }
  const brand = ref.brands.find(b => b.brand_id === m.brand_id);
  const scaleL = ref.scales.find(x => x.scale_id === m.scale_id)?.label;
  const box = inv.find(i => i.model_id === m.model_id && i.storage_location)?.storage_location;
  const photos = (await store.list('photos')).filter(p => p.model_id === m.model_id);
  const front = photos.find(p => p.photo_id === m.primary_photo_id) || photos.find(p => p.shot_role === 'box_front') || photos[0];
  const big = h('img', { class: 'namebig', alt: 'Box front' });
  photoUrl(front, 'display').then(u => { if (u) big.src = u; });
  v.append(big);
  const others = h('div', { class: 'gallery', style: 'margin-top:6px' });
  for (const p of photos.filter(p => p !== front)) {
    const im = h('img', { alt: SHOT_ROLES[p.shot_role]?.label || '' }); photoUrl(p, 'display').then(u => { if (u) im.src = u; });
    others.append(h('button', { type: 'button', class: 'fig', onclick: () => { const t = big.src; big.src = im.src; im.src = t; } }, im, h('span', { class: 'cap' }, `${SHOT_ROLES[p.shot_role]?.label || ''} · tap to swap`)));
  }
  v.append(others);
  const bc = ids.find(i => i.model_id === m.model_id && i.identifier_type === 'barcode');
  v.append(h('p', { class: 'muted' }, [brand?.name, scaleL, box, bc ? `barcode ${bc.value_raw}` : null].filter(Boolean).join(' · ')));
  const sg = sugg[m.model_id];
  if (sg) {
    const note = brandNote(sg.brand, brand?.name);
    // A code already saved is never replaced by an AI reading; a different reading is a note only.
    const codeNote = m.product_code && sg.code && sg.code !== m.product_code ? `AI read the code as "${sg.code}". Keeping the code already saved.` : null;
    v.append(h('div', { class: 'banner info' }, h('div', { class: 'hd' }, '✨ Suggested by AI: check it against the box before saving'),
      ...[...(sg.notes || []), note, codeNote].filter(Boolean).map(t => h('div', { class: 'muted' }, t)),
      h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: async () => {
        const rest = { ...(await meta.get('aiSuggest', {})) }; delete rest[m.model_id]; await meta.set('aiSuggest', rest);
        toast('Suggestion discarded. This car can go in the next Gemini batch.', 3000); route();
      } }, 'Discard suggestion')));
  }
  const nameIn = h('input', { placeholder: 'e.g. Nissan Skyline GT-R R34', 'aria-label': 'Name', autocapitalize: 'words', value: sg?.name || '' });
  const codeIn = h('input', { placeholder: brand?.code_example ? `e.g. ${brand.code_example}` : 'Exactly as printed', autocapitalize: 'characters', 'aria-label': 'Product code', value: m.product_code || sg?.code || '' });
  v.append(h('label', { class: 'f' }, 'Name'), nameIn, h('label', { class: 'f' }, 'Product code (optional)'), codeIn);
  const save = async () => {
    const name = nameIn.value.trim(), code = codeIn.value.trim();
    if (!name) { toast('Type a name, or tap Skip', 2500, 'warn'); return; }
    await applyName(m, name, code, sg, ref, models, ids);
    toast('Named ✓'); route(); autoSyncSoon();
  };
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); codeIn.focus(); } });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  v.append(h('div', { class: 'savebar' },
    h('button', { type: 'button', class: 'ghost', onclick: () => { nameSkipped.add(m.model_id); route(); } }, 'Skip'),
    h('div', { class: 'need' }, h('a', { href: `#/item/${encodeURIComponent(m.model_id)}` }, 'Open full page')),
    h('button', { class: `save ${nameIn.value.trim() ? '' : 'quiet'}`, id: 'nameSave', onclick: save }, 'Save & next')));
  nameIn.addEventListener('input', () => $('#nameSave')?.classList.toggle('quiet', !nameIn.value.trim()));
  // (Notes & colours now come in the same Gemini round as names and codes, s1-0.39.0)
  if (scoreCard) v.append(scoreCard);
  setTimeout(() => nameIn.focus(), 50);
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

// Moments after cars are added: drive into the box (with its new count), then any milestone flag.
async function celebrateSave(box) {
  try {
    const [models, inv] = await Promise.all([store.list('models'), store.list('inventory')]);
    const live = new Set(models.filter(m => !m.deleted_at).map(m => m.model_id));
    const label = boxLoc(box);
    if (label) driveIn(inv.filter(i => !i.deleted_at && i.ownership_status === 'Owned' && live.has(i.model_id) && i.storage_location === label).length);
    setTimeout(() => checkMilestone(live.size), label ? 1500 : 0);
  } catch (e) { console.warn('moment', e); }
}

// ---------- Car of the day + Showroom (B's picks from the Garage delight kit, 25 Nov) ----------
const NOTE_ICON = { fun: '🎉', history: '🏛', pop: '🎬', casting: '🧩' };
const noteOf = (m, readings) => (m.car_note_source === 'hidden' ? '' : (m.car_note || readings?.get(m.model_id)?.note || ''));
// Photos grouped by car once per photo list (s1-0.50.0: was a full scan of every photo for every car).
const photosByCar = new WeakMap();
const photosOf = (m, photos) => {
  let map = photosByCar.get(photos);
  if (!map) { map = new Map(); for (const p of photos) { if (p.deleted_at) continue; const a = map.get(p.model_id); if (a) a.push(p); else map.set(p.model_id, [p]); } photosByCar.set(photos, map); }
  return map.get(m.model_id) || [];
};
const frontPhoto = (m, photos) => { const mine = photosOf(m, photos); return mine.find(p => p.photo_id === m.primary_photo_id) || mine.find(p => p.shot_role === 'box_front') || mine[0]; };
// Same car all day, a different one tomorrow: a stable pick from today's date among named cars with a photo.
function dayPick(n, dateStr) { let x = 0; for (const ch of dateStr) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return n ? x % n : -1; }
async function carOfTheDay(models, photos, names) {
  const today = new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem('smg.cotdHide') === today) return null; } catch {}
  const pool = models.filter(m => !m.deleted_at && String(m.display_name || '').trim() && frontPhoto(m, photos)).sort((a, b) => a.model_id.localeCompare(b.model_id));
  if (pool.length < 3) return null;
  const m = pool[dayPick(pool.length, today)];
  const ref = await refData();
  const readings = await aiColours(ref).catch(() => new Map());
  const brand = ref.brands.find(b => b.brand_id === m.brand_id)?.name || m.printed_brand_text || '';
  const scale = ref.scales.find(x => x.scale_id === m.scale_id)?.label || '';
  const inv = (await store.list('inventory')).find(i => i.model_id === m.model_id && i.storage_location && !i.deleted_at);
  const note = noteOf(m, readings); const np = note ? noteParts(note) : null;
  const img = h('img', { alt: '', class: 'cd-img' });
  photoUrl(frontPhoto(m, photos), 'display').then(u => { if (u) img.src = u; }).catch(() => {});
  const card = h('div', { class: 'cotd', role: 'button', tabindex: '0', 'aria-label': `Car of the day: ${m.display_name}. Tap to flip.` });
  const flip = () => card.classList.toggle('on');
  card.addEventListener('click', (e) => { if (!e.target.closest('a,.cd-x')) flip(); });
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  card.append(h('div', { class: 'cd-in' },
    h('div', { class: 'cd-fr' }, img, h('div', { class: 'cd-txt' }, h('span', { class: 'cd-k' }, 'Car of the day'),
      h('b', {}, m.display_name), h('span', { class: 'cd-sub' }, [brand, scale, inv?.storage_location].filter(Boolean).join(' · ')), h('span', { class: 'cd-tap' }, note ? 'Tap for the story ↻' : 'Tap to flip ↻'))),
    h('div', { class: 'cd-bk' },
      np ? h('div', { class: 'cd-tag' }, NOTE_ICON[np.kind], ' ', np.label) : h('div', { class: 'cd-tag' }, 'No note yet'),
      h('p', {}, np ? np.body : 'Name tab → Notes & colours asks Gemini for a fun fact, history or casting note.'),
      h('div', { class: 'row', style: 'margin-top:auto' }, np && m.car_note_source !== 'you' && !m.car_note ? h('span', { class: 'muted small' }, 'from Gemini, not checked') : null,
        h('a', { href: `#/item/${encodeURIComponent(m.model_id)}`, class: 'btn ghost small' }, 'Open car')))),
    h('button', { type: 'button', class: 'cd-x', 'aria-label': 'Hide car of the day until tomorrow', onclick: () => { try { localStorage.setItem('smg.cotdHide', today); } catch {} route(); } }, '×'));
  return card;
}

let showroomTimer = null;
async function renderShowroom(v, id) {
  clearTimeout(showroomTimer);
  const label = `Box ${String(id).replace(/^box\s*/i, '').toUpperCase()}`;
  const ref = await refData();
  const [models, inv, photos] = await Promise.all([store.list('models'), store.list('inventory'), store.list('photos')]);
  const live = new Map(models.filter(m => !m.deleted_at).map(m => [m.model_id, m]));
  const ids = [...new Set(inv.filter(i => !i.deleted_at && i.ownership_status === 'Owned' && live.has(i.model_id) && String(i.storage_location || '').toLowerCase() === label.toLowerCase()).map(i => i.model_id))];
  const brandName = (m) => ref.brands.find(b => b.brand_id === m.brand_id)?.name || m.printed_brand_text || '';
  const cars = ids.map(x => live.get(x)).sort((a, b) => brandName(a).localeCompare(brandName(b)) || String(a.display_name || '~').localeCompare(String(b.display_name || '~')));
  const back = `#/box/${encodeURIComponent(label.replace(/^Box\s*/i, ''))}`;
  if (!cars.length) { v.append(h('p', {}, `${label} is empty. `, h('a', { href: back }, 'Back'))); return; }
  const readings = await aiColours(ref).catch(() => new Map());
  let i = 0;
  const stage = h('div', { class: 'showroom', role: 'dialog', 'aria-label': `Showroom: ${label}` });
  const ticks = h('div', { class: 'sr-ticks' }), img = h('img', { class: 'sr-img', alt: '' }), info = h('div', { class: 'sr-info' });
  const close = () => { clearTimeout(showroomTimer); location.hash = back; };
  stage.append(h('div', { class: 'sr-top' }, ticks, h('div', { class: 'row', style: 'align-items:center' }, h('b', { class: 'sr-box', style: 'flex:1' }, label),
      h('button', { type: 'button', class: 'sr-x', 'aria-label': 'Close showroom', onclick: close }, '×'))),
    h('div', { class: 'sr-photo' }, img), info,
    h('button', { type: 'button', class: 'sr-prev', 'aria-label': 'Previous car', onclick: () => show(i - 1) }), h('button', { type: 'button', class: 'sr-next', 'aria-label': 'Next car', onclick: () => show(i + 1) }));
  const show = (k) => {
    clearTimeout(showroomTimer);
    if (k >= cars.length) { close(); return; }
    i = Math.max(0, k); const m = cars[i];
    ticks.replaceChildren(...cars.map((_, j) => h('i', { class: j < i ? 'd' : j === i ? (motionOn() ? 'c' : 'd') : '' })));
    img.classList.remove('in'); img.removeAttribute('src');
    const ph = frontPhoto(m, photos); if (ph) photoUrl(ph, 'display').then(u => { if (u && cars[i] === m) { img.src = u; void img.offsetWidth; img.classList.add('in'); } }).catch(() => {});
    const fam = m.colour_family; const note = noteOf(m, readings); const np = note ? noteParts(note) : null;
    const n = inv.filter(x => x.model_id === m.model_id && !x.deleted_at && x.ownership_status === 'Owned').length;
    info.replaceChildren(
      h('div', { class: 'sr-k' }, [brandName(m), ref.scales.find(x => x.scale_id === m.scale_id)?.label, m.product_code].filter(Boolean).join(' · ')),
      h('h2', { class: 'sr-name' }, fam ? h('span', { class: 'cdot', style: `background:${familySwatch(fam)}` }) : null, m.display_name || 'Name not set', n > 1 ? h('span', { class: 'sr-n' }, ` ×${n}`) : null),
      np ? h('p', { class: 'sr-note' }, h('b', {}, `${NOTE_ICON[np.kind]} ${np.label} · `), np.body) : '', // '' not null: replaceChildren prints null as text
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('span', { class: 'muted small' }, `${i + 1} of ${cars.length}`),
        h('a', { href: `#/item/${encodeURIComponent(m.model_id)}`, class: 'btn ghost small', onclick: () => clearTimeout(showroomTimer) }, 'Open car')));
    if (motionOn()) showroomTimer = setTimeout(() => { if (location.hash.startsWith('#/showroom/')) show(i + 1); }, 5000);
  };
  // swipe left / right
  let x0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); });
  stage.tabIndex = -1;
  stage.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === 'Escape') close(); });
  v.append(stage); show(0); setTimeout(() => stage.focus(), 0);
}

// ---------- Box contents sheet & label (D30: pack the boxes) ----------
// One page per storage box: a big label to tape on the box, then every car inside (photo, brand, name, code, scale,
// colour, copies). Print or save as PDF from the phone's print menu, or copy as text for WhatsApp/notes.
async function renderBoxSheet(v, id) {
  const label = `Box ${String(id).replace(/^box\s*/i, '').toUpperCase()}`;
  const ref = await refData();
  const rec = (await boxNames()).get(label.toLowerCase());
  const models = (await store.list('models')).filter(m => !m.deleted_at);
  const modelById = new Map(models.map(m => [m.model_id, m]));
  const inv = (await store.list('inventory')).filter(i => !i.deleted_at && i.ownership_status === 'Owned' && modelById.has(i.model_id) && String(i.storage_location || '').toLowerCase() === label.toLowerCase());
  const photos = (await store.list('photos')).filter(p => !p.deleted_at);
  const brandName = Object.fromEntries(ref.brands.map(b => [b.brand_id, b.name]));
  const scaleLabel = Object.fromEntries(ref.scales.map(sc => [sc.scale_id, sc.label]));
  const copies = new Map(); for (const i of inv) copies.set(i.model_id, (copies.get(i.model_id) || 0) + 1);
  const rows = [...copies.keys()].map(id2 => modelById.get(id2)).map(m => ({ m, brand: brandName[m.brand_id] || m.printed_brand_text || '', n: copies.get(m.model_id) }))
    .sort((a, b) => (!a.brand - !b.brand) || a.brand.localeCompare(b.brand) || (!a.m.display_name - !b.m.display_name) || String(a.m.display_name || '').localeCompare(String(b.m.display_name || '')));
  const total = inv.length;
  const brandsLine = rec?.box_brand === 'mixed' || !rec?.box_brand ? [...new Set(rows.map(r => r.brand).filter(Boolean))].slice(0, 4).join(' · ') + (new Set(rows.map(r => r.brand)).size > 4 ? ' · …' : '') : brandName[rec.box_brand];
  const scalesLine = [...new Set(rows.map(r => scaleLabel[r.m.scale_id]).filter(Boolean))].join(' · ');
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  // Box journey: printing or copying the sheet counts as the Label step (once; the date of the first time)
  const markLabelled = async () => { if (!rec?.box_label_at) { await saveBox(label, { box_label_at: store.nowIso() }); autoSyncSoon(); } };
  const asText = () => [`${label}${rec?.box_name ? ' · ' + rec.box_name : ''} — ${plural(total, 'car', 'cars')} (${today})`,
    ...rows.map((r, k) => `${k + 1}. ${[r.brand, r.m.display_name || 'Name not set', r.m.product_code, scaleLabel[r.m.scale_id], r.m.colour_name || (r.m.colour_family ? familyLabel(r.m.colour_family) : '')].filter(Boolean).join(' · ')}${r.n > 1 ? ` ×${r.n}` : ''}`)].join('\n');
  v.append(h('div', { class: 'noprint' }, h('a', { href: '#/', class: 'back', onclick: () => { garageFilter = 'all'; garageSearch = label; } }, `← ${label}`)),
    h('div', { class: 'row noprint', style: 'gap:8px;margin:8px 0 14px' },
      h('button', { type: 'button', style: 'flex:1', onclick: async () => { await markLabelled(); window.print(); } }, '🖨 Print or save as PDF'),
      h('button', { type: 'button', class: 'quiet', style: 'flex:1', onclick: async () => { const ok = await copyText(asText()); if (ok) await markLabelled(); toast(ok ? 'List copied ✓' : 'Could not copy', 2000, 'ok'); } }, 'Copy as text')));
  const sheet = h('div', { class: 'boxsheet' });
  // QR to this box's car list (scan with the phone camera once the box is packed). Loaded only here, so the app
  // itself never depends on the library to open.
  const qrBox = h('div', { class: 'bl-qr' });
  const boxUrl = `${location.origin}${location.pathname}#/box/${encodeURIComponent(label.replace(/^Box\s*/i, ''))}`;
  import('./qr.js').then(({ qrSvg }) => { qrBox.innerHTML = qrSvg(boxUrl, { label: `QR code: open ${label} in Scale Model Garage` }); qrBox.dataset.url = boxUrl; })
    .catch((e) => { console.warn('qr', e); qrBox.remove(); });
  sheet.append(h('div', { class: 'boxlabel' }, qrBox,
    h('div', { class: 'bl-num' }, label.toUpperCase()),
    rec?.box_name ? h('div', { class: 'bl-name' }, rec.box_name) : null,
    h('div', { class: 'bl-meta' }, [plural(total, 'car', 'cars'), brandsLine, scalesLine].filter(Boolean).join(' · ')),
    h('div', { class: 'bl-date' }, `Packed list · ${today}`), h('div', { class: 'bl-scan' }, 'Scan the code to see what\'s inside')));
  const missing = rows.filter(r => !r.m.display_name).length;
  if (missing) sheet.append(h('div', { class: 'banner warn noprint' }, `${plural(missing, 'car has', 'cars have')} no name yet. Name them first for a complete list, or print as is.`));
  const list = h('ol', { class: 'bs-list' });
  for (const r of rows) {
    const ph = photos.filter(p => p.model_id === r.m.model_id).sort((a, b) => (a.shot_role === 'box_front' ? -1 : 0) - (b.shot_role === 'box_front' ? -1 : 0))[0];
    const img = h('img', { alt: '', class: ph?.crop_corners ? 'fit' : '' });
    if (ph) photoUrl(ph).then(u => { if (u) img.src = u; }).catch(() => {});
    list.append(h('li', {},
      h('div', { class: 'bs-ph' }, ph ? img : null),
      h('div', { class: 'bs-tx' },
        h('div', { class: 'bs-nm' }, r.m.colour_family ? h('span', { class: 'cdot', style: `background:${familySwatch(r.m.colour_family)}` }) : null, r.m.display_name || h('span', { class: 'muted' }, 'Name not set'), r.n > 1 ? h('b', { class: 'bs-n' }, ` ×${r.n}`) : null),
        h('div', { class: 'bs-sub' }, [r.brand || 'Brand not set', scaleLabel[r.m.scale_id], r.m.product_code].filter(Boolean).join(' · ')))));
  }
  sheet.append(rows.length ? list : h('p', { class: 'muted' }, 'This box is empty.'));
  v.append(sheet);
  if (rows.length) v.append(h('div', { class: 'noprint', style: 'margin-top:14px' }, packButton(label, rec)));
}

// ---------- Import from the gallery (D30, 25 Nov: backlog speed) ----------
// B shoots many boxes with the phone's camera app (front, back, front, back…), then imports them all into one
// storage box. Photos are paired in the order they were taken; each car is saved exactly like a Photo run car
// (same photo copies, barcode from the rear photo, same records). Nothing is merged automatically.
let importFiles = null, importSwap = false, importBusy = false;
const importSet = () => { try { return JSON.parse(localStorage.getItem('smg.import') || '{}'); } catch { return {}; } };
const importSave = (o) => { try { localStorage.setItem('smg.import', JSON.stringify({ ...importSet(), ...o })); } catch {} };
async function renderImport(v) {
  const ref = await refData();
  if (!cap) cap = freshCapture({ count: 0 });
  const st = importSet();
  const box = cap.box || localStorage.getItem('smg.lastBox') || '';
  const rec = box ? (await boxNames()).get(`box ${box}`.toLowerCase()) || (await boxNames()).get(String(box).toLowerCase()) : null;
  const brandId = st.brandId !== undefined ? st.brandId : (rec && rec.box_brand && rec.box_brand !== 'mixed' ? rec.box_brand : cap.brandId || '');
  const scaleId = st.scaleId !== undefined ? st.scaleId : (rec && rec.box_scale && rec.box_scale !== 'mixed' ? rec.box_scale : cap.scaleId || '');
  const sealed = !!st.sealed;
  const per = sealed ? 3 : 2;
  v.append(h('a', { href: '#/run', class: 'back' }, '← Photo run'), h('h2', {}, '📥 Import from gallery'),
    h('div', { class: 'banner info' }, h('div', { class: 'hd' }, 'How it works'),
      h('div', {}, `1. With your phone's camera app, photograph each box: front, then a close-up of the barcode (wherever it is: back or bottom)${sealed ? ', then the box art' : ''}. Keep that order.`),
      h('div', {}, '2. Pick all those photos here. The app pairs them in the order they were taken.'),
      h('div', {}, '3. Check the pairs, then import. Name them with Gemini afterwards.')));
  if (importBusy) { v.append(h('p', { id: 'importMsg' }, 'Importing…')); return; }
  // settings
  const set = h('div', { class: 'card' },
    h('div', {}, h('b', {}, box ? `Into Box ${String(box).replace(/^box\s*/i, '')}` : 'No storage box chosen'), ' · ', h('a', { href: '#/run', class: 'tap' }, 'change')),
    h('label', { class: 'f' }, 'Brand'),
    h('select', { 'aria-label': 'Brand for imported cars', onchange: async (e) => { const v2 = e.target.value; const id = v2 === 'later' ? '' : await pickedBrandId(v2, ref.brands, e.target); importSave({ brandId: v2 === 'later' ? '' : id }); route(); } },
      h('option', { value: 'later', selected: !brandId ? true : undefined }, 'Different brands: set them later'), ...brandOptions(ref.brands, brandId, 'Pick one brand…').slice(1)),
    h('label', { class: 'f' }, 'Scale'),
    h('div', { class: 'chips' }, ref.scales.slice(0, 8).map(sc => h('button', { type: 'button', class: `chip ${scaleId === sc.scale_id ? 'on' : ''}`, onclick: () => { importSave({ scaleId: sc.scale_id }); route(); } }, sc.label)),
      h('button', { type: 'button', class: `chip ${!scaleId ? 'on' : ''}`, onclick: () => { importSave({ scaleId: '' }); route(); } }, 'Mixed: later')),
    h('div', { class: 'chips', style: 'margin-top:10px' },
      h('button', { type: 'button', class: `chip ${!sealed ? 'on' : ''}`, onclick: () => { importSave({ sealed: false }); route(); } }, '2 photos per car (front, barcode close-up)'),
      h('button', { type: 'button', class: `chip ${sealed ? 'on' : ''}`, onclick: () => { importSave({ sealed: true }); route(); } }, '3 photos (+ box art)')));
  v.append(set);
  v.append(h('button', { type: 'button', class: importFiles ? 'quiet wide' : 'wide', onclick: async () => {
    const files = await pickPhoto({ camera: false, multiple: true });
    if (!files.length) return;
    importFiles?.forEach(f => URL.revokeObjectURL(f.url));
    importFiles = files.sort((a, b) => (a.lastModified - b.lastModified) || a.name.localeCompare(b.name)).map(file => ({ file, url: URL.createObjectURL(file) }));
    importSwap = false; route();
  } }, importFiles ? 'Pick different photos' : 'Pick photos from the gallery'));
  if (!importFiles) return;
  const groups = []; for (let i = 0; i + per <= importFiles.length; i += per) groups.push(importFiles.slice(i, i + per));
  const left = importFiles.length % per;
  v.append(h('div', { class: 'row', style: 'align-items:center;margin:12px 0 6px' },
    h('b', { style: 'flex:1' }, `${importFiles.length} photos → ${plural(groups.length, 'car', 'cars')}`),
    h('button', { type: 'button', class: 'quiet small', onclick: () => { importSwap = !importSwap; route(); } }, importSwap ? '↺ Undo swap' : '⇄ Swap front and barcode')));
  if (left) v.append(h('div', { class: 'banner warn' }, `${plural(left, 'photo is', 'photos are')} left over at the end and won't be imported. Check the order, or pick again.`));
  const grid = h('div', { class: 'importgrid' });
  groups.forEach((g, k) => {
    const order = importSwap ? [g[1], g[0], ...g.slice(2)] : g;
    grid.append(h('div', { class: 'importcar' }, h('div', { class: 'muted small' }, `Car ${k + 1}`),
      h('div', { class: 'importpair' }, order.map((f, j) => h('figure', {}, h('img', { src: f.url, alt: '', loading: 'lazy' }), h('figcaption', {}, ['Front', 'Back', 'Art'][j]))))));
  });
  v.append(grid);
  if (!groups.length) return;
  v.append(h('button', { type: 'button', class: 'wide', style: 'margin-top:12px', onclick: async () => {
    if (!confirm(`Import ${plural(groups.length, 'car', 'cars')}${box ? ` into Box ${String(box).replace(/^box\s*/i, '')}` : ''}?`)) return;
    importBusy = true; route();
    const say = (t) => { const el = $('#importMsg'); if (el) el.textContent = t; };
    let done = 0, withBc = 0;
    try {
      for (const [k, g] of groups.entries()) {
        say(`Importing car ${k + 1} of ${groups.length}…`);
        const order = importSwap ? [g[1], g[0], ...g.slice(2)] : g;
        cap = freshCapture({ brandId, scaleId, count: cap.count });
        cap.box = box; cap.sealed = sealed;
        const roles = ['box_front', 'box_rear', ...(sealed ? ['box_art'] : [])];
        for (const [j, f] of order.entries()) {
          const prep = await preparePhoto(f.file);
          cap.photos[roles[j]] = { photoId: newId('photos'), prep, url: '', capturedAt: new Date(f.file.lastModified || Date.now()).toISOString() };
          if (roles[j] === 'box_rear') { try { const r = await scanPhoto(f.file); if (r) { const raw = String(r.value).trim(); cap.barcode = { raw, cmp: barcodeCmp(raw), format: r.format, source: 'rear_photo', checkOk: gtinCheckOk(raw) }; } } catch (e) { console.warn('import barcode', e); } }
        }
        const hadBc = !!cap.barcode;
        if (await saveCapture({ quiet: true })) { done++; if (hadBc) withBc++; }
      }
    } finally { importBusy = false; }
    importFiles?.forEach(f => URL.revokeObjectURL(f.url)); importFiles = null;
    celebrateSave(box);
    toast(`Imported ${plural(done, 'car', 'cars')} ✓ · barcode read on ${withBc} of ${done}${withBc < done ? ' (see To check → No barcode)' : ''}`, 5000);
    location.hash = '#/name';
  } }, `Import ${plural(groups.length, 'car', 'cars')}`));
}

// ---------- Just bought (B, 25 Nov: ~20 new cars a month; record price, date and shop when buying) ----------
// Shop and date are set once and kept for the session (several cars from one shop); the price is per car.
// It switches itself off on another day, so older cars are never recorded as bought today by mistake.
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
function boughtGet() { try { const b = JSON.parse(localStorage.getItem('smg.bought') || '{}'); return b.on && b.day === todayIso() ? b : { ...b, on: false }; } catch { return { on: false }; } }
function boughtSet(o) { try { localStorage.setItem('smg.bought', JSON.stringify(o)); } catch {} }
function recentShops() { try { return JSON.parse(localStorage.getItem('smg.shops') || '[]'); } catch { return []; } }
function rememberShop(name) { const t = String(name || '').trim(); if (!t) return; try { localStorage.setItem('smg.shops', JSON.stringify([t, ...recentShops().filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 6))); } catch {} }
function boughtFields() {
  const b = boughtGet(); if (!b.on || helperInfo) return {};
  const price = String(cap.price || '').replace(/[^\d.]/g, '');
  return { acquisition_type: 'Purchase', purchase_price: price, purchase_date: b.date || todayIso(), purchase_date_precision: 'day', purchase_source: b.source || '' };
}
function boughtCard() {
  if (helperInfo) return null; // Helper mode: prices are the owner's business
  const b = boughtGet();
  if (!b.on) return h('button', { type: 'button', class: 'quiet small boughtbtn', onclick: () => { boughtSet({ on: true, day: todayIso(), date: todayIso(), source: b.source || '' }); route(); } }, '🛍 Just bought? Add price and shop');
  const shopIn = h('input', { value: b.source || '', placeholder: 'Shop or seller', 'aria-label': 'Bought from', oninput: (e) => boughtSet({ ...boughtGet(), source: e.target.value }) });
  return h('div', { class: 'card bought' },
    h('div', { class: 'row', style: 'align-items:center' }, h('h3', { style: 'margin:0' }, '🛍 Just bought'),
      h('button', { type: 'button', class: 'ghost small', onclick: () => { boughtSet({ ...boughtGet(), on: false }); route(); } }, 'Not a purchase')),
    h('label', { class: 'f' }, 'Price for this car (₹)'),
    h('input', { inputmode: 'decimal', value: cap.price || '', placeholder: 'Leave empty if you don\'t know', 'aria-label': 'Price paid', oninput: (e) => { cap.price = e.target.value; saveDraftSoon(); } }),
    h('label', { class: 'f' }, 'Bought from'), shopIn,
    recentShops().length ? h('div', { class: 'chips', style: 'margin-top:6px' }, recentShops().map(t => h('button', { type: 'button', class: `chip ${t === b.source ? 'on' : ''}`, onclick: () => { boughtSet({ ...boughtGet(), source: t }); route(); } }, t))) : null,
    h('label', { class: 'f' }, 'Date'),
    h('input', { type: 'date', value: b.date || todayIso(), max: todayIso(), 'aria-label': 'Date bought', oninput: (e) => boughtSet({ ...boughtGet(), date: e.target.value }) }),
    h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Shop and date stay for the next cars today; the price is per car.'));
}

async function saveCapture({ quiet = false } = {}) {
  try { await capReady(); } catch { return false; }
  const ref = await refData();
  const brand = ref.brands.find(b => b.brand_id === cap.brandId);
  const ns = assignNamespace(brand, null);
  const model = { model_id: cap.modelId, brand_id: cap.brandId, printed_brand_text: brand?.name || '', code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status,
    product_code: cap.code.trim(), product_code_cmp: codeCmp(cap.code), display_name: cap.name.trim(), scale_id: cap.scaleId,
    category_id: ref.categories.find(c => c.name === 'Cars')?.category_id || '', identification_status: 'unidentified', completeness_status: 'quick',
    primary_photo_id: cap.photos.box_front?.photoId || '' };
  model.duplicate_check_status = duplicateCheckStatus(model);
  const items = [{ entity: 'models', fields: model },
    { entity: 'inventory', fields: { inventory_id: cap.inventoryId, model_id: cap.modelId, ownership_status: 'Owned', packaging_state: cap.sealed ? 'sealed' : 'unknown', storage_location: boxLoc(cap.box), acquisition_type: 'Unknown', purchase_date_precision: 'unknown', currency: 'INR', ...boughtFields() } },
    ...(await savePhotoRecords(cap.modelId, photosToSave()))];
  if (cap.barcode) items.push({ entity: 'product_identifiers', fields: { model_id: cap.modelId, identifier_type: 'barcode', value_raw: cap.barcode.raw, value_cmp: cap.barcode.cmp, barcode_format: cap.barcode.format || '', check_digit_ok: cap.barcode.checkOk === null ? '' : (cap.barcode.checkOk ? 'yes' : 'no'), source: cap.barcode.source } });
  try { await store.createMany(items); }
  catch (e) { toast(`Not saved: ${e.message}. Your box is kept here; try again.`, 5000, 'bad'); return false; }
  pushRecentBrand(cap.brandId);
  const secs = seconds(touch(cap.timer));
  if (!quiet) await logTiming(secs); // gallery imports aren't timed per box here: their pace comes from photo times
  await clearDraft();
  if (boughtGet().on) rememberShop(boughtGet().source);
  const savedBox = cap.box;
  cap = freshCapture({ brandId: nextBrandId(), scaleId: nextScaleId(), count: cap.count + 1 });
  if (!quiet) { toast(`Saved ✓ (${secs} s)${cap.box ? ` · Box ${cap.box}` : ''} — next car`); window.scrollTo(0, 0); route(); celebrateSave(savedBox); }
  autoSyncSoon();
  return true;
}

async function saveCopyOf(m) {
  try { await capReady(); } catch { return; }
  // This box's photos are attached to the new physical copy (never made the product's main photo).
  const items = [{ entity: 'inventory', fields: { inventory_id: cap.inventoryId, model_id: m.model_id, ownership_status: 'Owned', packaging_state: cap.sealed ? 'sealed' : 'unknown', storage_location: boxLoc(cap.box), acquisition_type: 'Unknown', purchase_date_precision: 'unknown', currency: 'INR', ...boughtFields() } },
    ...(await savePhotoRecords(m.model_id, photosToSave())).map(it => ({ ...it, fields: { ...it.fields, inventory_id: cap.inventoryId, is_primary: 'no' } }))];
  try { await store.createMany(items); }
  catch (e) { toast(`Not saved: ${e.message}. Your box is kept here; try again.`, 5000, 'bad'); return; }
  const secs = seconds(touch(cap.timer));
  await logTiming(secs);
  await clearDraft();
  if (boughtGet().on) rememberShop(boughtGet().source);
  cap = freshCapture({ brandId: nextBrandId(), scaleId: nextScaleId(), count: cap.count + 1 });
  toast(`Added as another copy ✓ (${secs} s)`);
  window.scrollTo(0, 0);
  route(); autoSyncSoon();
}

// Capture times are kept under a new key: times recorded by s1-0.1.x counted idle time (audit C4).
const TIMES_KEY = 'captureTimesV2';
// Shooting pace from the time each box's front photo was taken (Photo run: in the app; camera app: the photo file's time).
async function shootingPace() {
  const [models, photos] = await Promise.all([store.list('models'), store.list('photos')]);
  const live = new Set(models.filter(m => !m.deleted_at).map(m => m.model_id));
  const firstFront = new Map();
  for (const p of photos) if (!p.deleted_at && p.shot_role === 'box_front' && live.has(p.model_id) && p.captured_at) {
    const prev = firstFront.get(p.model_id); if (!prev || p.captured_at < prev) firstFront.set(p.model_id, p.captured_at);
  }
  return paceFromTimes([...firstFront.values()]);
}
const paceText = (pc) => (pc.medianSec == null ? null : `median ${pc.medianSec} s per box (${plural(pc.measured + pc.sessions.length, 'box', 'boxes')} in ${plural(pc.sessions.length, 'session', 'sessions')}, from photo times)`);
async function logTiming(secs) {
  const t = await meta.get(TIMES_KEY, []);
  t.push(secs); await meta.set(TIMES_KEY, t.slice(-500));
}

// =====================================================================
// Item details (add details later, D17)
// =====================================================================
// Wide layout = tablet and up. Crossing the line (rotating a tablet, resizing a window) redraws the page.
const WIDE_Q = window.matchMedia ? matchMedia('(min-width: 760px)') : null;
const wideLayout = () => !!WIDE_Q?.matches;
WIDE_Q?.addEventListener?.('change', () => route());
async function renderItem(v, modelId) {
  const rec = await store.getRecord('models', modelId);
  if (!rec) { v.append(h('p', {}, 'Not found.'), h('a', { href: '#/' }, '← Garage')); return; }
  const m = rec.data;
  const ref = await refData();
  const inv = (await store.list('inventory')).filter(i => i.model_id === modelId);
  const photos = (await store.list('photos')).filter(p => p.model_id === modelId);
  const idfs = (await store.list('product_identifiers')).filter(i => i.model_id === modelId);
  v.append(h('a', { href: '#/', class: 'back' }, '← Garage'));
  // Product page (DV-0.1, Apple Store / Discogs): name and identity first, one big photo, facts, details on demand.
  const brandN = ref.brands.find(b => b.brand_id === m.brand_id)?.name || m.printed_brand_text || '';
  const scaleN = ref.scales.find(x => x.scale_id === m.scale_id)?.label || '';
  v.append(h('div', { class: 'pdp-head' },
    h('div', { class: 'pdp-kicker' }, [brandN, scaleN].filter(Boolean).join(' · ') || 'Brand and scale not set'),
    h('h2', {}, m.display_name || '(no name yet)',
      // Colour swatch next to the name (B, 25 Nov); tap to change it
      !m.deleted_at ? h('button', { type: 'button', class: `namesw ${m.colour_family ? '' : 'empty'}`, 'aria-label': m.colour_family ? `Colour: ${familyLabel(m.colour_family)}. Tap to change` : 'Set colour',
        title: m.colour_family ? familyLabel(m.colour_family) : 'Set colour', style: m.colour_family ? `background:${familySwatch(m.colour_family)}` : '',
        onclick: () => { colourOpenFor = colourOpenFor === modelId ? null : modelId; route(); } }, m.colour_family ? '' : '+') : null),
    m.product_code || idfs.some(i => i.identifier_type === 'second_code' && !i.deleted_at) ? h('div', { class: 'pdp-code' }, m.product_code || '', (() => { const sc = idfs.find(i => i.identifier_type === 'second_code' && !i.deleted_at); return sc ? h('span', { class: 'pdp-code2', title: 'Second code on the box' }, sc.value_raw) : null; })()) : null));
  const colourSlot = h('div'); v.append(colourSlot); // the colour picker opens here, right under the name
  if (!m.deleted_at && mergeFor !== modelId) {
    const top = (await mergeCandidates(m))[0];
    if (top && top.score >= 2) v.append(h('div', { class: 'banner info samecar' },
      h('div', {}, `Looks like the same car as `, h('a', { href: `#/item/${encodeURIComponent(top.m.model_id)}` }, top.m.display_name || '(no name)'), ` (${top.why.join(', ')}).`),
      h('button', { type: 'button', class: 'small', style: 'margin-top:8px', onclick: () => { mergeFor = modelId; route(); setTimeout(() => $('#mergePanel')?.scrollIntoView({ behavior: 'smooth' }), 300); } }, 'Compare & merge')));
  }
  // Car note (B, 24 Nov): fun fact / history / pop culture / casting, a sub-note under the name.
  // Gemini's note is shown labelled "from Gemini, not checked" until B keeps, edits or hides it.
  const aiAll = m.deleted_at ? {} : ((await aiColours(ref)).get(modelId) || {});
  if (!m.deleted_at) {
    const kept = m.car_note && m.car_note_source !== 'hidden' ? m.car_note : '';
    const shown = kept || (m.car_note_source !== 'hidden' ? aiAll.note || '' : '');
    const fromAi = !kept || m.car_note_source === 'gemini';
    const saveNote = async (text, source, reason) => {
      await store.update('models', modelId, { car_note: text, car_note_source: source });
      await store.logChange('models', modelId, 'car_note', m.car_note || '', text, reason); autoSyncSoon(); route();
    };
    const editNote = () => { const t = prompt('Note about this car (fun fact, history, pop culture, casting):', shown); if (t !== null) saveNote(t.trim(), t.trim() ? 'you' : 'hidden', 'note edited in app'); };
    if (shown) {
      const np = noteParts(shown);
      v.append(h('div', { class: `carnote ${np.kind}` },
        h('div', { class: 'cn-tag' }, { fun: '🎉', history: '🏛', pop: '🎬', casting: '🧩' }[np.kind], ' ', np.label),
        h('div', { class: 'cn-body' }, np.body),
        h('div', { class: 'cn-foot' }, fromAi ? h('span', { class: 'muted small' }, 'from Gemini, not checked') : null,
          !kept ? h('button', { type: 'button', class: 'ghost small', onclick: () => saveNote(shown, 'gemini', 'note from Gemini, kept') }, 'Keep') : null,
          h('button', { type: 'button', class: 'ghost small', onclick: editNote }, 'Edit'),
          h('button', { type: 'button', class: 'ghost small', onclick: () => saveNote('', 'hidden', 'note hidden') }, 'Hide'))));
    } else v.append(h('button', { type: 'button', class: 'ghost small addnote', onclick: editNote }, '＋ Add a note'));
  }
  // Edit and Remove at the top (B, 24 Nov: "no options to delete or modify this entry" - they were below the fold).
  const owned = inv.filter(i => i.ownership_status === 'Owned');
  const archiveModel = async () => { if (confirm('Remove this car from your garage?\n\nIt is archived, not deleted: you can bring it back any time from Garage → Archived.')) { await store.archive('models', modelId); toast('Removed. Bring it back from Garage → Archived.', 3500); location.hash = '#/'; autoSyncSoon(); } };
  if (!m.deleted_at) v.append(h('div', { class: 'pdp-actions' },
    h('button', { type: 'button', class: 'quiet small', onclick: () => { const d = $('#pdpDetails'); if (d) { d.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => d.querySelector('input')?.focus({ preventScroll: true }), 450); } } }, icon('edit'), 'Edit details'),
    owned.length ? h('button', { type: 'button', class: `quiet small ${moveBoxFor === modelId ? 'on' : ''}`, 'aria-expanded': moveBoxFor === modelId ? 'true' : 'false', onclick: () => { moveBoxFor = moveBoxFor === modelId ? null : modelId; route(); } }, icon('box'), 'Move box') : null,
    h('button', { type: 'button', class: 'ghost small', onclick: archiveModel }, icon('trash'), 'Remove')));
  // Move to another storage box (B, 24 Nov): pick an existing box, a new one, or none. One row per copy when there are several.
  if (!m.deleted_at && moveBoxFor === modelId && owned.length) {
    const [used, names] = await Promise.all([boxesInUse(), boxNames()]);
    const moveCard = h('div', { class: 'card movebox' }, h('div', { class: 'hd' }, owned.length > 1 ? 'Move which copy, to which box?' : 'Move to which box?'));
    const moveCopy = async (c, label) => {
      const old = c.storage_location || '';
      if (label === old) { moveBoxFor = null; route(); return; }
      const rec = label ? names.get(label.toLowerCase()) : null;
      const brandName = (id) => ref.brands.find(b => b.brand_id === id)?.name;
      const scaleName = (id) => ref.scales.find(x => x.scale_id === id)?.label;
      const clash = [rec?.box_brand && rec.box_brand !== 'mixed' && m.brand_id && rec.box_brand !== m.brand_id ? `only ${brandName(rec.box_brand)}` : '',
        rec?.box_scale && rec.box_scale !== 'mixed' && m.scale_id && rec.box_scale !== m.scale_id ? `only ${scaleName(rec.box_scale)}` : ''].filter(Boolean);
      if (clash.length && !confirm(`${label} is set for ${clash.join(' and ')}. Move this car there anyway?`)) return;
      await store.update('inventory', c.inventory_id, { storage_location: label });
      await store.logChange('inventory', c.inventory_id, 'storage_location', old, label, 'moved to another box');
      toast(label ? `Moved to ${label} ✓` : 'Taken out of its box ✓'); moveBoxFor = null; autoSyncSoon(); route();
    };
    owned.forEach((c, i) => {
      if (owned.length > 1) moveCard.append(h('p', { class: 'muted small', style: 'margin:10px 0 0' }, `Copy ${i + 1} · now ${c.storage_location || 'no box'}`));
      moveCard.append(h('div', { class: 'chips', style: 'margin:8px 0' },
        used.map(([label, n]) => { const nm = names.get(label.toLowerCase())?.box_name; const on = label === c.storage_location;
          return h('button', { type: 'button', class: `chip ${on ? 'on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => moveCopy(c, label) }, [label, nm].filter(Boolean).join(' · ') + ` (${n})`); }),
        h('button', { type: 'button', class: 'chip', onclick: async () => moveCopy(c, await newBox()) }, '＋ New box'),
        c.storage_location ? h('button', { type: 'button', class: 'chip', onclick: () => moveCopy(c, '') }, 'No box') : null));
    });
    moveCard.append(h('button', { type: 'button', class: 'ghost small', onclick: () => { moveBoxFor = null; route(); } }, 'Cancel'));
    v.append(moveCard);
  }
  if (m.deleted_at) v.append(h('div', { class: 'banner warn' }, h('div', { class: 'hd' }, 'Archived: hidden from your garage.'),
    h('button', { type: 'button', class: 'small', style: 'margin-top:8px', onclick: restore }, 'Restore to garage')));
  async function restore() { await store.update('models', modelId, { deleted_at: '' }); await store.logChange('models', modelId, 'deleted_at', m.deleted_at, '', 'restored in app'); toast('Restored ✓'); route(); autoSyncSoon(); }
  if (rec.conflict) renderConflict(v, rec);
  if (rec.lastError) v.append(h('div', { class: 'banner bad' }, `Last sync error: ${rec.lastError}`));

  // Photos (audit I2): tap a photo to change its label, make it the main photo, or remove it.
  if (selectedPhoto.model !== modelId) selectedPhoto = { model: modelId, id: null };
  const heroP = photos.find(p => p.photo_id === (selectedPhoto.id || m.primary_photo_id)) || photos.find(p => p.shot_role === 'box_front') || photos[0];
  if (heroP) { const himg = h('img', { alt: SHOT_ROLES[heroP.shot_role]?.label || 'Photo' }); photoUrl(heroP, 'display').then(u => { if (u) himg.src = u; }); v.append(h('div', { class: 'pdp-hero' }, himg)); }
  else v.append(h('div', { class: 'pdp-hero empty' }, icon('car'), h('span', { class: 'muted' }, 'No photo yet')));
  const gal = h('div', { class: 'gallery thumbs' });
  for (const p of photos.sort((a, b) => Object.keys(SHOT_ROLES).indexOf(a.shot_role) - Object.keys(SHOT_ROLES).indexOf(b.shot_role))) {
    const img = h('img', { alt: SHOT_ROLES[p.shot_role]?.label || 'Photo', class: p.crop_corners ? 'fit' : '' });
    photoUrl(p, 'display').then(u => { if (u) img.src = u; });
    const main = p.photo_id === m.primary_photo_id;
    gal.append(h('button', { type: 'button', class: `fig ${selectedPhoto.id === p.photo_id ? 'sel' : ''}`, 'aria-label': `Photo options: ${SHOT_ROLES[p.shot_role]?.label || p.shot_role}`,
      onclick: () => { selectedPhoto.id = selectedPhoto.id === p.photo_id ? null : p.photo_id; route(); } }, img,
      h('span', { class: 'cap' }, `${main ? '★ ' : ''}${SHOT_ROLES[p.shot_role]?.label || p.shot_role}${p.crop_corners ? ' · edited' : ''}${p.original_file_id ? '' : ' · waiting'}`)));
  }
  v.append(gal);
  const sp = photos.find(p => p.photo_id === selectedPhoto.id);
  if (sp) {
    const isMain = sp.photo_id === m.primary_photo_id;
    v.append(h('div', { class: 'card' }, h('h3', {}, 'This photo'),
      h('label', { class: 'f' }, 'Label'),
      h('select', { onchange: async (e) => { const role = e.target.value; await store.update('photos', sp.photo_id, { shot_role: role, photo_type: SHOT_ROLES[role].type }); await store.logChange('photos', sp.photo_id, 'shot_role', sp.shot_role, role, 'relabelled in app'); toast('Label changed ✓'); route(); autoSyncSoon(); } },
        Object.entries(SHOT_ROLES).map(([k, r]) => h('option', { value: k, selected: k === sp.shot_role ? true : undefined }, r.label))),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'quiet', disabled: isMain ? true : undefined, onclick: async () => { await store.update('models', modelId, { primary_photo_id: sp.photo_id }); await store.logChange('models', modelId, 'primary_photo_id', m.primary_photo_id, sp.photo_id, 'main photo changed in app'); toast('Main photo set ✓'); route(); autoSyncSoon(); } }, isMain ? '★ Main photo' : 'Make main photo'),
        h('button', { type: 'button', class: 'ghost', onclick: async () => {
          if (!confirm('Remove this photo from the model? (It is hidden; a copy already in Drive stays there.)')) return;
          await store.archive('photos', sp.photo_id);
          if (!sp.original_file_id) for (const vv of ['original', 'display', 'thumb']) await blobs.remove(`${sp.photo_id}:${vv}`);
          if (isMain) { const next = photos.find(p => p.photo_id !== sp.photo_id && p.shot_role === 'box_front') || photos.find(p => p.photo_id !== sp.photo_id); await store.update('models', modelId, { primary_photo_id: next?.photo_id || '' }); }
          await store.logChange('photos', sp.photo_id, 'deleted_at', '', 'removed', 'photo removed in app');
          selectedPhoto.id = null; toast('Photo removed'); route(); autoSyncSoon();
        } }, 'Remove photo')),
      h('div', { class: 'row rotrow', style: 'margin-top:10px' },
        ...[[-1, '↺ Rotate left'], [1, 'Rotate right ↻']].map(([dir, label]) => h('button', { type: 'button', class: 'quiet', onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'Rotating…';
          try { if (await rotatePhoto(sp, dir)) toast('Rotated ✓ The original is kept.', 2000); } catch (err) { toast(`Couldn't rotate: ${err.message}`, 4000, 'bad'); }
          route();
        } }, label))),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('a', { class: 'btn quiet', href: `#/crop/${encodeURIComponent(sp.photo_id)}` }, sp.crop_corners ? 'Adjust straightening' : 'Crop / straighten'),
        sp.crop_corners ? h('button', { type: 'button', class: 'ghost', onclick: async () => {
          await store.update('photos', sp.photo_id, { crop_corners: '', cropped_file_id: '' });
          await store.logChange('photos', sp.photo_id, 'crop_corners', sp.crop_corners, '', 'straightening undone in app');
          for (const k of ['cropped', 'cropthumb']) { await blobs.remove(`${sp.photo_id}:${k}`); urlCache.delete(`${sp.photo_id}:${k}`); }
          toast('Back to the original photo'); route(); autoSyncSoon();
        } }, 'Back to original') : null)));
  }
  const roleSel = h('select', { style: 'flex:2' }, Object.entries(SHOT_ROLES).map(([k, r]) => h('option', { value: k }, r.label)));
  v.append(h('div', { class: 'row', style: 'margin-top:8px' }, roleSel, h('button', { class: 'quiet', style: 'flex:1', onclick: async () => {
    const [f] = await pickPhoto({ camera: true }); if (!f) return;
    const prep = await preparePhoto(f);
    const role = roleSel.value; const photoId = newId('photos');
    const items = await savePhotoRecords(modelId, { [role]: { photoId, prep, capturedAt: new Date().toISOString() } });
    items[0].fields.is_primary = 'no';
    await store.createMany(items);
    const bc = await barcodeFromPhoto(modelId, f, photoId, role);
    toast(bc ? `Photo added · barcode ${bc} read ✓` : 'Photo added'); route(); autoSyncSoon();
  } }, '＋ Photo')));
  const facts = [plural(owned.length, 'copy', 'copies'), ...new Set(owned.map(i => ({ sealed: 'Sealed', opened: 'Opened', loose: 'Loose' }[i.packaging_state])).filter(Boolean)),
    ...new Set(owned.map(i => i.storage_location).filter(Boolean)), idfs.find(i => i.identifier_type === 'barcode')?.value_raw ? `Barcode ${idfs.find(i => i.identifier_type === 'barcode').value_raw}` : null,
    m.completeness_status === 'complete' ? 'Complete' : 'Quick entry'].filter(Boolean);
  // Colour (B, 24 Nov): swatch row; Gemini's colour offered when none is set yet.
  if (!m.deleted_at) {
    const ai = aiAll.family ? aiAll : null;
    const cBlock = h('div', { class: 'colourblock' },
      h('div', { class: 'row', style: 'align-items:center;gap:8px' }, h('span', { class: 'f', style: 'margin:0' }, 'Colour'),
        m.colour_family ? h('span', { class: 'muted' }, [familyLabel(m.colour_family), m.colour_name && m.colour_name.toLowerCase() !== familyLabel(m.colour_family).toLowerCase() ? m.colour_name : ''].filter(Boolean).join(' · ')) : h('span', { class: 'muted' }, 'not set')),
      !m.colour_family && ai ? h('div', { class: 'aicolour' }, h('span', { class: 'dot', style: `background:${familySwatch(ai.family)}` }), `Gemini said: ${ai.name}`,
        h('button', { type: 'button', class: 'quiet small', onclick: async () => { await setColour(modelId, ai.family, ai.name, 'colour from Gemini, confirmed'); colourOpenFor = null; toast(`Colour: ${familyLabel(ai.family)} ✓`); route(); } }, `Use ${familyLabel(ai.family)}`)) : null,
      colourOpenFor === modelId ? swatchRow(m.colour_family, async (k) => { await setColour(modelId, k === m.colour_family ? '' : k, k === m.colour_family ? '' : (ai?.family === k ? ai.name : ''), 'colour set in app'); colourOpenFor = null; route(); }) : null);
    var colourBlock = cBlock;
  }
  v.append(h('div', { class: 'facts' }, facts.map(t => /^Box /.test(t) ? h('a', { class: 'fact', href: '#/', onclick: (e) => { e.preventDefault(); garageFilter = 'all'; garageSearch = t; location.hash = '#/'; } }, icon('box'), t) : h('span', { class: 'fact' }, t))));

  // shown under the name only while the picker is open, or while Gemini's colour waits for a tap
  if (typeof colourBlock !== 'undefined' && colourBlock && (colourOpenFor === modelId || (!m.colour_family && aiAll.family))) colourSlot.append(colourBlock);
  // Editable product fields
  // Typed edits are saved before any navigation or redraw (audit I1): see leaveHooks in route().
  const barcodes = idfs.filter(i => i.identifier_type === 'barcode');
  const bc0 = barcodes[0];
  const sc0 = idfs.find(i => i.identifier_type === 'second_code'); // s1-0.45.0: e.g. Hot Wheels "-4B10" under the code
  const f = { line_id: m.line_id || '', display_name: m.display_name || '', brand_id: m.brand_id || '', scale_id: m.scale_id || '', product_code: m.product_code || '', variant: m.variant || '', series: m.series || '', notes: m.notes || '', barcode: bc0?.value_raw || '', barcode_absent: m.barcode_absent || '', code_absent: m.code_absent || '', second_code: sc0?.value_raw || '' };
  let productDirty = false;
  const set = (k) => (e) => { f[k] = e.target.value; productDirty = true; markDirty(); };
  const markDirty = () => $('#pdpSave')?.classList.remove('quiet');
  const form = h('div', { class: 'card', id: 'pdpDetails' }, h('h3', {}, 'Details'));
  const field = (label, el) => form.append(h('label', { class: 'f' }, label), el);
  field('Name', h('input', { value: f.display_name, oninput: set('display_name') }));
  field('Brand', h('select', { onchange: async (e) => { const v = e.target.value; const id = v.startsWith('known:') || v === '__new' ? await pickedBrandId(v, ref.brands, e.target) : v; if (v && !id) { e.target.value = f.brand_id; return; } if (f.brand_id !== id) f.line_id = ''; f.brand_id = id; productDirty = true; markDirty(); drawLine(); } }, brandOptions(ref.brands, f.brand_id, '—')));
  field('Scale', h('select', { onchange: set('scale_id') }, h('option', { value: '' }, '—'), ref.scales.map(s => h('option', { value: s.scale_id, selected: s.scale_id === f.scale_id ? true : undefined }, s.label))));
  // "No product code on this box" (s1-0.58.0, B 28 Nov): some boxes print no code at all. Shown only while the code is
  // empty; typing a code clears it on save. Stops To check / Data health / Ask Gemini again treating the car as unfinished.
  const noCode = h('label', { class: 'checkline', style: 'display:flex;gap:8px;align-items:center;margin:-4px 0 10px' },
    h('input', { type: 'checkbox', 'aria-label': 'No product code on this box', checked: f.code_absent === 'yes' ? true : undefined, onchange: (e) => { f.code_absent = e.target.checked ? 'yes' : ''; productDirty = true; markDirty(); } }),
    'No product code printed on this box? Tick so the app stops asking.');
  const showNoCode = () => { noCode.style.display = String(f.product_code || '').trim() ? 'none' : 'flex'; };
  field('Product code (exactly as printed)', h('input', { value: f.product_code, autocapitalize: 'characters', oninput: (e) => { set('product_code')(e); drawLine(); showNoCode(); } }));
  form.append(noCode); showNoCode();
  // Product line (s1-0.47.0): lines of the chosen brand; a hint when the code starts like a known line (one tap)
  const lineWrap = h('div');
  form.append(h('label', { class: 'f' }, 'Product line (optional)'), lineWrap);
  function drawLine() {
    const mine = ref.lines.filter(l => l.brand_id === f.brand_id && !l.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
    const sel = h('select', { 'aria-label': 'Product line', disabled: f.brand_id ? undefined : true, onchange: async (e) => {
      if (e.target.value === '__new') { const t = prompt('New product line for this brand (e.g. Silver Series, Premium):', ''); const l = t ? await newLine(f.brand_id, t) : null; if (l) { ref.lines.push(l); f.line_id = l.line_id; productDirty = true; markDirty(); } drawLine(); return; }
      f.line_id = e.target.value; productDirty = true; markDirty(); drawLine(); } },
      h('option', { value: '' }, f.brand_id ? (mine.length ? 'No line' : 'No lines yet for this brand') : 'Choose a brand first'),
      mine.map(l => h('option', { value: l.line_id, selected: l.line_id === f.line_id ? true : undefined }, l.name)),
      f.brand_id ? h('option', { value: '__new' }, '＋ New line…') : null);
    const hint = !f.line_id ? suggestLine(f.product_code, mine) : null;
    lineWrap.replaceChildren(sel, ...(hint ? [h('div', { class: 'banner info', style: 'margin-top:6px' }, `Code starts like ${hint.name} (${hint.code_prefix_hint}…). `,
      h('button', { type: 'button', class: 'small quiet', onclick: () => { f.line_id = hint.line_id; productDirty = true; markDirty(); drawLine(); } }, `Set ${hint.name}`))] : [])); // spread: replaceChildren would print a null as the text "null"
  }
  // Progressive disclosure: the less-used fields fold away while empty; anything already filled stays visible.
  const moreBox = h('details', { class: 'more inner', open: (f.variant || f.series || f.notes || f.barcode || f.barcode_absent || f.second_code || garageFilter === 'nobarcode') ? true : undefined }, h('summary', {}, 'More details', h('span', { class: 'muted', style: 'font-weight:400' }, 'variant, series, notes, barcode, second code')));
 drawLine();
  form.append(moreBox);
  const field2 = (label, el) => moreBox.append(h('label', { class: 'f' }, label), el);
  field2('Variant / colour', h('input', { value: f.variant, oninput: set('variant') }));
  field2('Series', h('input', { value: f.series, oninput: set('series') }));
  field2('Notes', h('textarea', { oninput: set('notes') }, f.notes));
  // Barcode can be corrected (audit I2), with the same check-digit warning as quick capture.
  const bcWarn = h('div', { class: 'muted' });
  const bcCheck = () => { const ok = gtinCheckOk(f.barcode); bcWarn.textContent = f.barcode.trim() && ok === false ? '⚠ These digits don\'t add up (check digit). Please re-check.' : ''; bcWarn.style.color = 'var(--warn)'; };
  // "No barcode on this box" only shows while the barcode is empty (B, 25 Nov: next to a real barcode it read like a claim)
  const noBc = h('label', { class: 'checkline', style: 'display:flex;gap:8px;align-items:center;margin-top:8px' },
    h('input', { type: 'checkbox', 'aria-label': 'No barcode on this box', checked: f.barcode_absent === 'yes' ? true : undefined, onchange: (e) => { f.barcode_absent = e.target.checked ? 'yes' : ''; productDirty = true; markDirty(); } }),
    'No barcode on this box? Tick so the app stops asking.');
  const showNoBc = () => { noBc.style.display = String(f.barcode || '').trim() ? 'none' : 'flex'; };
  field2('Barcode', h('input', { inputmode: 'numeric', value: f.barcode, placeholder: 'None yet', oninput: (e) => { set('barcode')(e); bcCheck(); showNoBc(); } }));
  moreBox.append(bcWarn); bcCheck();
  moreBox.append(noBc); showNoBc();
  if (barcodes.length > 1) moreBox.append(h('p', { class: 'muted' }, `Other barcodes: ${barcodes.slice(1).map(i => i.value_raw).join(', ')}`));
  // Second code (s1-0.45.0): a smaller code printed near the product code (Hot Wheels "-4B10"). Kept exactly as
  // printed, separate from the product code, never used for the duplicate check (D11: alternate identifiers apart).
  field2('Second code on the box (optional)', h('input', { value: f.second_code, autocapitalize: 'characters', placeholder: 'e.g. -4B10', 'aria-label': 'Second code', oninput: set('second_code') }));
  moreBox.append(h('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'A smaller code near the product code. Kept separate: it never changes the product code or the duplicate check.'));
  async function saveSecondCode() {
    const nv = f.second_code.trim(), ov = sc0?.value_raw || '';
    if (nv === ov) return;
    const fields = { value_raw: nv, value_cmp: codeCmp(nv), source: 'typed' };
    if (sc0 && nv) await store.update('product_identifiers', sc0.identifier_id, fields);
    else if (sc0) await store.archive('product_identifiers', sc0.identifier_id);
    else await store.create('product_identifiers', { model_id: modelId, identifier_type: 'second_code', ...fields });
    await store.logChange('models', modelId, 'second_code', ov, nv, 'edited in app');
  }
  async function saveBarcode() {
    const nb = f.barcode.trim(), ob = bc0?.value_raw || '';
    if (nb === ob) return;
    const ck = gtinCheckOk(nb), fields = { value_raw: nb, value_cmp: barcodeCmp(nb), check_digit_ok: ck === null ? '' : (ck ? 'yes' : 'no'), barcode_format: '', source: 'typed' };
    if (bc0 && nb) await store.update('product_identifiers', bc0.identifier_id, fields);
    else if (bc0) await store.archive('product_identifiers', bc0.identifier_id);
    else await store.create('product_identifiers', { model_id: modelId, identifier_type: 'barcode', ...fields });
    await store.logChange('models', modelId, 'barcode', ob, nb, 'edited in app');
  }
  async function saveProduct() {
    await saveBarcode();
    await saveSecondCode();
    const brand = ref.brands.find(b => b.brand_id === f.brand_id);
    const ns = assignNamespace(brand, null);
    const { barcode: _bc, second_code: _sc, ...fields } = f;
    if (f.product_code.trim()) f.code_absent = ''; // a typed code wins over "no code on this box"
    const patch = { ...fields, code_absent: f.code_absent || '', product_code: f.product_code.trim(), product_code_cmp: codeCmp(f.product_code), printed_brand_text: m.printed_brand_text || brand?.name || '',
      code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status };
    patch.duplicate_check_status = duplicateCheckStatus(patch);
    for (const k of ['brand_id', 'product_code', 'line_id', 'code_absent']) if (String(m[k] || '') !== String(patch[k] || '')) await store.logChange('models', modelId, k, m[k], patch[k], 'edited in app');
    await store.update('models', modelId, patch);
    Object.assign(m, patch); productDirty = false;
    if (bc0) bc0.value_raw = f.barcode.trim();
  }
  form.append(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { id: 'pdpSave', class: 'quiet', onclick: async () => { if (!productDirty) { toast('Nothing changed'); return; } await saveProduct(); toast('Saved ✓'); route(); autoSyncSoon(); } }, 'Save'),
    h('button', { class: m.completeness_status === 'complete' ? 'quiet' : 'ghost', onclick: async () => {
      if (productDirty) await saveProduct();
      await store.update('models', modelId, { completeness_status: m.completeness_status === 'complete' ? 'quick' : 'complete' }); route(); autoSyncSoon();
    } }, m.completeness_status === 'complete' ? 'Mark as quick' : 'Mark complete')));
  v.append(form);
  const copies = [];
  // Copies header with ＋ Add a copy (B, 24 Nov: "I buy another one later")
  if (!m.deleted_at) v.append(h('div', { class: 'row copyhead' },
    h('h3', {}, owned.length === 1 ? '1 copy' : `${owned.length} copies`),
    h('button', { type: 'button', class: 'quiet small', onclick: async () => {
      const { n, box } = await addCopy(modelId); toast(`Copy ${n} added${box ? ` to ${box}` : ''} ✓ · set its box, state and price below`, 3500); route();
    } }, '＋ Add a copy')));

  // Copies (physical)
  const allTx = await store.list('transactions');
  for (const [idx, c] of inv.entries()) {
    const cf = { ownership_status: c.ownership_status, packaging_state: c.packaging_state, condition: c.condition, packaging_condition: c.packaging_condition, storage_location: c.storage_location, purchase_price: c.purchase_price, purchase_date: c.purchase_date, purchase_source: c.purchase_source };
    const cc = { dirty: false };
    const csum = [c.storage_location, { sealed: 'sealed', opened: 'opened', loose: 'loose' }[c.packaging_state], c.purchase_price ? `₹${c.purchase_price}` : 'price unknown', c.ownership_status !== 'Owned' ? c.ownership_status : ''].filter(Boolean).join(' · ');
    const card = h('details', { class: 'card more copy' }, h('summary', {}, `${inv.length > 1 ? `Copy ${idx + 1} of ${inv.length}` : 'Your copy'}`, h('span', { class: 'muted', style: 'font-weight:400' }, csum)));
    const add = (label, el) => card.append(h('label', { class: 'f' }, label), el);
    const sel = (key, opts) => h('select', { onchange: e => { cf[key] = e.target.value; cc.dirty = true; } }, h('option', { value: '' }, '— unknown —'), opts.map(o => h('option', { value: o, selected: o === cf[key] ? true : undefined }, o)));
    add('Status', sel('ownership_status', ['Owned', 'Sold', 'Gifted', 'Traded', 'Missing']));
    add('Box', sel('packaging_state', ['sealed', 'opened', 'loose']));
    add('Condition', sel('condition', CONDITIONS));
    add('Box condition', sel('packaging_condition', CONDITIONS));
    add('Storage box / place', h('input', { value: cf.storage_location, placeholder: 'e.g. Box 12', oninput: e => { cf.storage_location = e.target.value; cc.dirty = true; } }));
    add('Price paid (₹) — leave empty if unknown', h('input', { inputmode: 'decimal', value: cf.purchase_price, placeholder: 'Unknown', oninput: e => { cf.purchase_price = e.target.value; cc.dirty = true; } }));
    add('Date bought — leave empty if unknown', h('input', { type: 'date', value: cf.purchase_date, oninput: e => { cf.purchase_date = e.target.value; cc.dirty = true; } }));
    add('Bought from', h('input', { value: cf.purchase_source, oninput: e => { cf.purchase_source = e.target.value; cc.dirty = true; } }));
    // quiet = saving on the way out: an invalid price is left unchanged, everything else is kept.
    cc.save = async (quiet) => {
      let price = String(cf.purchase_price || '').replace(/[^\d.]/g, '');
      if (cf.purchase_price && price === '') {
        toast('Price must be a number (or empty for unknown) — price not saved', 3500, 'warn');
        if (!quiet) return false;
        price = c.purchase_price || '';
      }
      await store.update('inventory', c.inventory_id, { ...cf, purchase_price: price, purchase_date_precision: cf.purchase_date ? 'day' : 'unknown', acquisition_type: price ? 'Purchase' : c.acquisition_type });
      cc.dirty = false;
      return true;
    };
    copies.push(cc);
    card.append(h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { onclick: async () => { if (await cc.save(false)) { toast('Copy saved ✓'); route(); autoSyncSoon(); } } }, 'Save copy'),
      inv.length > 1 ? h('button', { class: 'ghost small', onclick: async () => {
        if (!confirm('Remove this copy (added by mistake)?\n\nIt is archived, not deleted. If you sold or gave it away, set Status to Sold or Gifted instead, so your history stays right.')) return;
        await store.archive('inventory', c.inventory_id);
        await store.logChange('inventory', c.inventory_id, 'deleted_at', '', 'archived', 'copy removed');
        toast('Copy removed (archived)'); route(); autoSyncSoon();
      } }, 'Remove this copy') : null));
    card.append(moneyBlock(c, allTx.filter(t => t.inventory_id === c.inventory_id)));
    v.append(card);
  }
  const dirtyHere = () => productDirty || copies.some(x => x.dirty);
  itemDirty = dirtyHere;
  leaveHooks.push(async () => {
    if (!dirtyHere()) return; // checks this page's own state (route() resets itemDirty before hooks run)
    if (productDirty) await saveProduct();
    for (const x of copies) if (x.dirty) await x.save(true);
    toast('Your changes were saved ✓');
    autoSyncSoon();
  });
  v.append(h('details', { class: 'card more' }, h('summary', {}, 'Record info'), h('dl', { class: 'kv' },
    h('dt', {}, 'Duplicate check'), h('dd', {}, { checkable: 'Checkable', not_checkable: 'Not checkable yet (no code)', needs_review: 'Brand needs review' }[m.duplicate_check_status] || m.duplicate_check_status),
    h('dt', {}, 'Added'), h('dd', {}, new Date(m.created_at).toLocaleString()),
    h('dt', {}, 'Sync'), h('dd', {}, rec.dirty ? 'Waiting to sync' : 'Synced'),
    h('dt', {}, 'ID'), h('dd', { class: 'muted' }, m.model_id)),
    !m.deleted_at ? h('button', { type: 'button', class: 'quiet small', style: 'margin-top:10px', onclick: () => { mergeFor = modelId; route(); } }, 'Merge with another entry…') : null));
  if (!m.deleted_at && mergeFor === modelId) v.append(await mergePanel(m, ref));
  v.append(m.deleted_at ? h('button', { class: 'wide', onclick: restore }, 'Restore to garage')
    : h('button', { class: 'ghost wide', onclick: archiveModel }, 'Remove from garage'));
  // Tablet / desktop (s1-0.40.0): photos on the left (sticky), name, actions and details on the right.
  if (wideLayout()) {
    const kids = [...v.children];
    const start = kids.findIndex(k => k.classList?.contains('pdp-hero'));
    const end = kids.indexOf(roleSel.closest('.row'));
    if (start >= 0 && end >= start) {
      const left = h('div', { class: 'pdp-left' }), right = h('div', { class: 'pdp-right' });
      kids.forEach((k, i) => (i >= start && i <= end ? left : right).append(k));
      v.append(h('div', { class: 'pdp-cols' }, left, right));
    }
  }
}

// ---------- To check (roadmap DR-0.2 next build #2) ----------
// One place for every gap, each opening the matching Garage list. Cheap checks only, so it stays fast at 1,000+ cars.
// Re-check barcodes on saved cars (s1-0.54.0, B 28 Nov); logic in recheck.js. Shown on Garage → To check → No barcode.
let recheckStop = false;
function recheckCard(redraw) {
  const card = h('div', { class: 'card recheck' });
  (async () => {
    const [models, ids, photos] = await Promise.all([store.list('models'), store.list('product_identifiers'), store.list('photos')]);
    // Photos already re-checked with this reader and nothing found aren't downloaded again (meta, per device)
    const done = new Set(await meta.get('recheckNone_v1', []));
    // s1-0.59.0: every photo that can carry a barcode (close-up, then extra sides); a car is offered again when it
    // gets a photo that hasn't been read yet (e.g. a Bottom photo added later)
    const all = recheckTargets(models, ids, photos, done), targets = all.filter(t => !t.done);
    const nPhotos = targets.reduce((a, t) => a + t.photos.length, 0);
    if (!all.length) { card.remove(); return; }
    if (!targets.length) { card.append(h('p', { class: 'muted small', style: 'margin:0' }, `${plural(all.length, 'car was', 'cars were')} already re-checked: no barcode found in their photos. Add a closer photo of the barcode, type it on the car page, or tick "No barcode on this box".`)); return; }
    const status = h('p', { class: 'muted small', 'aria-live': 'polite', style: 'margin:6px 0 0' });
    const stopBtn = h('button', { type: 'button', class: 'small quiet', hidden: true, onclick: () => { recheckStop = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; } }, 'Stop');
    const go = h('button', { type: 'button', class: 'small', onclick: async () => {
      recheckStop = false; go.disabled = true; stopBtn.hidden = false;
      const owners = new Map(); ids.filter(i => !i.deleted_at && i.identifier_type === 'barcode' && i.value_cmp).forEach(i => owners.set(i.value_cmp, i.model_id));
      const sum = await runRecheck(targets, {
        getOriginal: async (p) => { // on the phone if not yet synced; otherwise fetched from Drive (signs in once if needed)
          const local = await blobs.get(`${p.photo_id}:original`); if (local) return local;
          if (!p.original_file_id || !navigator.onLine) return null;
          if (!hasToken()) await signIn();
          return drive.download(p.original_file_id);
        },
        scan: (b) => scanPhoto(b),
        cmp: barcodeCmp, checkOk: gtinCheckOk,
        otherOwner: (cmp, mid) => { const o = owners.get(cmp); return o && o !== mid ? { model_id: o } : null; },
        save: async (m, f, p) => {
          await store.create('product_identifiers', { model_id: m.model_id, identifier_type: 'barcode', value_raw: f.raw, value_cmp: f.cmp, barcode_format: f.format, check_digit_ok: f.checkOk === null ? '' : (f.checkOk ? 'yes' : 'no'), source: 'rear_photo_recheck', evidence_photo_id: p.photo_id });
          await store.logChange('models', m.model_id, 'barcode', '', f.raw, `read again from the ${(SHOT_ROLES[p.shot_role]?.label || 'barcode').toLowerCase()} photo (re-check)`);
          owners.set(f.cmp, owners.get(f.cmp) || m.model_id);
        },
        onProgress: ({ i, n, found }) => { status.textContent = `Checking ${i} of ${n}… found ${found}`; },
        onNone: (p) => done.add(p.photo_id),
        stopped: () => recheckStop,
      });
      await meta.set('recheckNone_v1', [...done]);
      toast(recheckSummary(sum), 6000);
      if (sum.found) autoSyncSoon();
      redraw();
    } }, `🔁 Re-check ${plural(targets.length, 'car', 'cars')}`);
    const skipped = all.length - targets.length;
    card.append(
      h('p', { style: 'margin:0' }, h('b', {}, 'Barcode missed?'), ' The app reads photos better since s1-0.53.0. Re-check these cars\' barcode close-up and any extra side photos (Back, Bottom, End, Top); the first barcode found is added, never replaces one.'),
      h('p', { class: 'muted small', style: 'margin:4px 0 8px' }, `${plural(nPhotos, 'photo', 'photos')} to read at most; synced ones are downloaded from your Drive (about 3 MB each, up to ~${Math.max(1, Math.round(nPhotos * 2.9))} MB) and not kept on the phone. Best on Wi-Fi.`),
      h('div', { class: 'row', style: 'gap:8px;justify-content:flex-start' }, go, stopBtn), status,
      skipped ? h('p', { class: 'muted small', style: 'margin:6px 0 0' }, `${plural(skipped, 'other car was', 'other cars were')} already re-checked: no barcode found.`) : '');
  })().catch(() => card.remove());
  return card;
}

const CHECKS = [
  ['nobrand', 'No brand', (m) => !m.brand_id],
  ['noscale', 'No scale', (m) => !m.scale_id],
  ['nocode', 'No product code', (m) => !String(m.product_code || '').trim() && m.code_absent !== 'yes'],
  // a box with no barcode printed on it is marked on the car page and leaves this list
  ['nobarcode', 'No barcode', (m, x) => !x.withBarcode.has(m.model_id) && m.barcode_absent !== 'yes'],
  ['nobox', 'Not in a storage box', (m, x) => x.ownedNoBox.has(m.model_id)],
  ['nocolour', 'No colour', (m) => !m.colour_family],
  ['nophoto', 'Missing front or barcode photo', (m, x) => !x.bothPhotos.has(m.model_id)],
  ['dupes', 'Possible duplicates', (m, x) => x.dupes.has(m.model_id)],
];
function checkContext(models, inventory, ids, photos = []) {
  const roles = new Map(); for (const p of photos) if (!p.deleted_at && p.model_id) (roles.get(p.model_id) || roles.set(p.model_id, new Set()).get(p.model_id)).add(p.shot_role);
  const bothPhotos = new Set([...roles].filter(([, r]) => r.has('box_front') && r.has('box_rear')).map(([k]) => k));
  const owned = inventory.filter(i => i.ownership_status === 'Owned' && !i.deleted_at);
  const ownedNoBox = new Set(owned.filter(i => !String(i.storage_location || '').trim()).map(i => i.model_id));
  // possible duplicates: two or more entries sharing a code, a barcode or a name (years ignored)
  const groups = new Map(); const add = (k, mid) => { if (!k) return; (groups.get(k) || groups.set(k, new Set()).get(k)).add(mid); };
  for (const m of models) { add(m.product_code_cmp && `c:${m.product_code_cmp}`, m.model_id); add(nameKey(m.display_name) && `n:${nameKey(m.display_name)}`, m.model_id); }
  for (const i of ids) if (i.identifier_type === 'barcode' && !i.deleted_at) add(`b:${i.value_cmp || i.value_raw}`, i.model_id);
  const live = new Set(models.map(m => m.model_id)); const dupes = new Set();
  for (const g of groups.values()) { const inG = [...g].filter(x => live.has(x)); if (inG.length > 1) inG.forEach(x => dupes.add(x)); }
  const withBarcode = new Set(ids.filter(i => i.identifier_type === 'barcode' && !i.deleted_at && String(i.value_raw || '').trim()).map(i => i.model_id));
  return { ownedNoBox, dupes, withBarcode, bothPhotos };
}

// ---------- Brands screen (roadmap DR-0.2 next build #3) ----------
// Rename, merge look-alikes, mark checked. Printed brand text on each car is never changed (D10.1 rule 1);
// an old or merged name is kept as an alias so it is still recognised; every change is logged.
let brandOpen = null;
async function addBrandAlias(text, brandId) {
  const t = String(text || '').trim(); if (!t) return;
  const al = await store.list('aliases');
  if (al.some(a => a.target_type === 'brand' && a.target_id === brandId && a.alias_cmp === normName(t))) return;
  await store.create('aliases', { alias_text: t, alias_cmp: normName(t), target_type: 'brand', target_id: brandId, source: 'brands screen' });
}
async function mergeBrand(fromId, toId) {
  const ref = await refData();
  const from = ref.brands.find(b => b.brand_id === fromId), to = ref.brands.find(b => b.brand_id === toId);
  const models = (await store.list('models')).filter(m => m.brand_id === fromId);
  for (const m of models) {
    const ns = assignNamespace(to, null);
    const patch = { brand_id: toId, code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status };
    patch.duplicate_check_status = duplicateCheckStatus({ ...m, ...patch });
    await store.update('models', m.model_id, patch);
    await store.logChange('models', m.model_id, 'brand_id', fromId, toId, `brand merged: ${from?.name} → ${to?.name}`);
  }
  for (const b of await store.list('storage_boxes')) if (b.box_brand === fromId) await store.update('storage_boxes', b.storage_box_id, { box_brand: toId });
  await addBrandAlias(from?.name, toId);
  await store.archive('brands', fromId);
  await store.logChange('brands', fromId, 'merged_into', '', toId, `merged into ${to?.name}: ${models.length} cars`);
  autoSyncSoon();
  return models.length;
}
// Product lines under a brand (s1-0.47.0): see, add, rename, mark checked. Lines group and count only.
function linesBlock(b, ref, models) {
  const lines = ref.lines.filter(l => l.brand_id === b.brand_id && !l.deleted_at).sort((x, y) => x.name.localeCompare(y.name));
  const n = (lid) => models.filter(m => !m.deleted_at && m.line_id === lid).length;
  return h('div', { class: 'lines' }, h('div', { class: 'muted small', style: 'margin:10px 0 4px;font-weight:600' }, 'Product lines'),
    lines.length ? lines.map(l => h('div', { class: 'linerow' },
      h('span', { class: 'ln' }, l.name, l.code_prefix_hint ? h('span', { class: 'muted small' }, ` · codes start ${l.code_prefix_hint}`) : null, l.record_status === 'needs_review' ? h('span', { class: 'tag warn' }, 'not checked') : null),
      h('span', { class: 'muted small' }, plural(n(l.line_id), 'car', 'cars')),
      n(l.line_id) ? h('button', { type: 'button', class: 'quiet small', onclick: () => { garageFilter = 'line'; garageSearch = l.name; location.hash = '#/'; } }, 'See') : null,
      l.record_status === 'needs_review' ? h('button', { type: 'button', class: 'quiet small', onclick: async () => { await store.update('product_lines', l.line_id, { record_status: 'confirmed' }); await store.logChange('product_lines', l.line_id, 'record_status', 'needs_review', 'confirmed', 'checked in Brands'); autoSyncSoon(); toast(`${l.name} checked ✓`); route(); } }, 'It\'s right') : null,
      h('button', { type: 'button', class: 'quiet small', onclick: async () => { const t = cleanLineName(prompt(`Rename "${l.name}" to:`, l.name)); if (!t || t === l.name) return; await store.update('product_lines', l.line_id, { name: t, record_status: 'confirmed' }); await store.logChange('product_lines', l.line_id, 'name', l.name, t, 'renamed in Brands'); autoSyncSoon(); toast('Renamed ✓'); route(); } }, 'Rename')))
      : h('p', { class: 'muted small', style: 'margin:0' }, 'No lines yet.'),
    h('button', { type: 'button', class: 'ghost small', style: 'margin-top:6px', onclick: async () => { const t = prompt(`New product line for ${b.name} (e.g. Premium, Silver Series):`, ''); if (!t) return; const l = await newLine(b.brand_id, t); if (l) { toast(`${l.name} added ✓`); route(); } } }, `＋ Add a line to ${b.name}`));
}

async function renderBrands(v) {
  const ref = await refData();
  const models = await store.list('models');
  const count = new Map(); models.forEach(m => m.brand_id && count.set(m.brand_id, (count.get(m.brand_id) || 0) + 1));
  const brands = ref.brands.slice().sort((a, b) => (count.get(b.brand_id) || 0) - (count.get(a.brand_id) || 0) || a.name.localeCompare(b.name));
  v.append(h('a', { href: '#/settings', class: 'back' }, '← Settings'), h('div', { class: 'row' }, h('h2', {}, 'Brands'),
    h('div', { class: 'muted' }, `${plural(brands.filter(b => count.get(b.brand_id)).length, 'brand', 'brands')} in use`)));
  // Look-alike names among brands in use: maybe the same brand typed two ways
  const used = brands.filter(b => count.get(b.brand_id));
  const pairs = [];
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) if (looksLike(used[i].name, used[j].name)) pairs.push([used[i], used[j]]);
  if (pairs.length) v.append(h('div', { class: 'card' }, h('h3', {}, 'Same brand?'),
    h('p', { class: 'muted' }, 'These names look alike. Merge only if they are really one brand.'),
    ...pairs.map(([a, b]) => h('div', { class: 'row', style: 'align-items:center;margin-top:8px' },
      h('div', { style: 'flex:1' }, h('b', {}, a.name), ` (${count.get(a.brand_id)}) · `, h('b', {}, b.name), ` (${count.get(b.brand_id)})`),
      h('button', { type: 'button', class: 'quiet small', onclick: () => { brandOpen = b.brand_id; route(); setTimeout(() => $(`[data-brand="${b.brand_id}"]`)?.scrollIntoView({ behavior: 'smooth' }), 300); } }, 'Look')))));
  const list = h('div', { class: 'card brandlist' });
  for (const b of brands) {
    const n = count.get(b.brand_id) || 0, open = brandOpen === b.brand_id;
    const row = h('div', { class: `brandrow ${open ? 'open' : ''}`, 'data-brand': b.brand_id },
      h('button', { type: 'button', class: 'brandhead', 'aria-expanded': open ? 'true' : 'false', onclick: () => { brandOpen = open ? null : b.brand_id; route(); } },
        h('span', { class: 'bn' }, b.name), b.record_status === 'needs_review' ? h('span', { class: 'tag warn' }, 'needs review') : null,
        h('span', { class: 'muted' }, n ? plural(n, 'car', 'cars') : 'no cars'), h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '⌃' : '›')));
    if (open) {
      const others = brands.filter(o => o.brand_id !== b.brand_id);
      const target = h('select', { 'aria-label': `Merge ${b.name} into` }, h('option', { value: '' }, 'Merge into…'), others.map(o => h('option', { value: o.brand_id }, `${o.name}${count.get(o.brand_id) ? ` (${count.get(o.brand_id)})` : ''}`)));
      row.append(h('div', { class: 'brandacts' },
        n ? h('button', { type: 'button', class: 'quiet small', onclick: () => { garageFilter = 'all'; garageSearch = b.name; location.hash = '#/'; } }, `See ${plural(n, 'car', 'cars')}`) : null,
        h('button', { type: 'button', class: 'quiet small', onclick: async () => {
          const t = (prompt(`Rename "${b.name}" to:`, b.name) || '').replace(/\s+/g, ' ').trim();
          if (!t || t === b.name) return;
          const r = resolveName(t, others);
          if (r.use || r.ask) { toast(`"${(r.use || r.ask).name}" already exists: use "Merge into" instead`, 4000, 'warn'); return; }
          await store.update('brands', b.brand_id, { name: t, record_status: 'confirmed' });
          await addBrandAlias(b.name, b.brand_id);
          await store.logChange('brands', b.brand_id, 'name', b.name, t, 'renamed in Brands'); autoSyncSoon();
          toast(`Renamed to ${t} ✓ (the old name still works)`, 3000); route();
        } }, 'Rename'),
        b.record_status === 'needs_review' ? h('button', { type: 'button', class: 'quiet small', onclick: async () => {
          await confirmBrand(b, models, 'checked in Brands'); toast(`${b.name} checked ✓`); route();
        } }, 'Mark as checked') : null,
        h('div', { class: 'row', style: 'width:100%;margin-top:6px' }, target, h('button', { type: 'button', class: 'small', onclick: async () => {
          const to = others.find(o => o.brand_id === target.value); if (!to) { toast('Pick the brand to merge into', 2500, 'warn'); return; }
          if (!confirm(`Merge "${b.name}" into "${to.name}"?\n\n${plural(n, 'car moves', 'cars move')} to ${to.name}. "${b.name}" is kept as another name for ${to.name}, and the brand text printed on each car is not changed.`)) return;
          const moved = await mergeBrand(b.brand_id, to.brand_id); brandOpen = to.brand_id; toast(`Merged ✓ ${plural(moved, 'car', 'cars')} now ${to.name}`, 3500); route();
        } }, 'Merge')),
        !n ? h('button', { type: 'button', class: 'ghost small', onclick: async () => { await store.archive('brands', b.brand_id); await store.logChange('brands', b.brand_id, 'deleted_at', '', 'archived', 'unused brand removed'); autoSyncSoon(); brandOpen = null; route(); } }, 'Remove (no cars)') : null));
    }
    if (open) row.append(linesBlock(b, ref, models));
    list.append(row);
  }
  v.append(list);
}

// ---------- Merge two entries (B, 24 Nov) ----------
// Two entries that are the same car become one car with all their copies and photos. Only ever by B's choice
// (D10.1 rule 5: no automatic merging). The emptied entry is archived, never deleted; every move is logged.
const nameKey = (t) => normTxt(t).replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
async function mergeCandidates(m) {
  const [models, ids] = await Promise.all([store.list('models'), store.list('product_identifiers')]);
  const bc = (mid) => new Set(ids.filter(i => i.model_id === mid && i.identifier_type === 'barcode').map(i => i.value_cmp || i.value_raw));
  const mine = bc(m.model_id), myKey = nameKey(m.display_name), myWords = new Set(myKey.split(' ').filter(w => w.length > 1));
  const out = [];
  for (const o of models) {
    if (o.model_id === m.model_id) continue;
    const why = [];
    let score = 0;
    if (m.product_code_cmp && o.product_code_cmp === m.product_code_cmp) { score += 3; why.push('same code'); }
    if ([...bc(o.model_id)].some(b => mine.has(b))) { score += 3; why.push('same barcode'); }
    const k = nameKey(o.display_name);
    if (myKey && k === myKey) { score += 2; why.push('same name'); }
    else if (myWords.size) { const w = k.split(' ').filter(x => myWords.has(x)).length / myWords.size; if (w >= 0.6) { score += 1; why.push('similar name'); } }
    if (score && o.brand_id && o.brand_id === m.brand_id) score += 0.5;
    out.push({ m: o, score, why });
  }
  return out.sort((a, b) => b.score - a.score || String(a.m.display_name).localeCompare(String(b.m.display_name)));
}
async function mergeInto(sourceId, targetId) {
  const [src, tgt] = await Promise.all([store.get('models', sourceId), store.get('models', targetId)]);
  if (!src || !tgt) throw new Error('entry not found');
  const [inv, photos, ids] = await Promise.all([store.list('inventory'), store.list('photos'), store.list('product_identifiers')]);
  let copies = 0, pics = 0;
  for (const c of inv.filter(i => i.model_id === sourceId)) { await store.update('inventory', c.inventory_id, { model_id: targetId }); await store.logChange('inventory', c.inventory_id, 'model_id', sourceId, targetId, 'merged'); copies++; }
  for (const p of photos.filter(x => x.model_id === sourceId)) { await store.update('photos', p.photo_id, { model_id: targetId }); await store.logChange('photos', p.photo_id, 'model_id', sourceId, targetId, 'merged'); pics++; }
  const have = new Set(ids.filter(i => i.model_id === targetId).map(i => `${i.identifier_type}:${i.value_cmp || i.value_raw}`));
  for (const i of ids.filter(x => x.model_id === sourceId)) {
    if (have.has(`${i.identifier_type}:${i.value_cmp || i.value_raw}`)) await store.archive('product_identifiers', i.identifier_id);
    else await store.update('product_identifiers', i.identifier_id, { model_id: targetId });
  }
  // Fill only what the kept entry is missing; nothing it already has is overwritten.
  const patch = {};
  for (const k of ['product_code', 'product_code_cmp', 'variant', 'series', 'release_year', 'colour_family', 'colour_name', 'car_note', 'car_note_source', 'primary_photo_id'])
    if (!String(tgt[k] || '').trim() && String(src[k] || '').trim()) patch[k] = src[k];
  if (patch.product_code) patch.duplicate_check_status = duplicateCheckStatus({ ...tgt, ...patch });
  if (Object.keys(patch).length) await store.update('models', targetId, patch);
  await store.update('models', sourceId, { notes: [src.notes, `Merged into "${tgt.display_name || targetId}" (${new Date().toLocaleDateString()})`].filter(Boolean).join(' · ') });
  await store.archive('models', sourceId);
  await store.logChange('models', sourceId, 'merged_into', '', targetId, `merged into ${tgt.display_name || targetId}: ${copies} copies, ${pics} photos`);
  autoSyncSoon();
  return { copies, pics };
}
let mergeFor = null; // car page: the model whose merge panel is open
async function mergePanel(m, ref) {
  const cands = await mergeCandidates(m);
  const [inv, photos] = await Promise.all([store.list('inventory'), store.list('photos')]);
  const brandN = (id) => ref.brands.find(b => b.brand_id === id)?.name || '';
  const nCopies = inv.filter(i => i.model_id === m.model_id).length, nPhotos = photos.filter(p => p.model_id === m.model_id).length;
  const list = h('div', { class: 'mergelist' });
  const draw = (q) => {
    const t = normTxt(q);
    const rows = (t ? cands.filter(c => normTxt([c.m.display_name, c.m.product_code, brandN(c.m.brand_id)].join(' ')).includes(t)) : cands.filter(c => c.score > 0)).slice(0, 8);
    list.replaceChildren(...(rows.length ? rows.map(c => {
      const box = inv.find(i => i.model_id === c.m.model_id && i.storage_location)?.storage_location;
      return h('button', { type: 'button', class: 'mergerow', onclick: async () => {
        if (!confirm(`Merge this entry into "${c.m.display_name || '(no name)'}"?\n\nIts ${plural(nCopies, 'copy', 'copies')} and ${plural(nPhotos, 'photo', 'photos')} move there; anything that entry is missing (code, colour, note) is filled in. This entry is then archived (Garage → Archived), not deleted.`)) return;
        try { const r = await mergeInto(m.model_id, c.m.model_id); mergeFor = null; toast(`Merged ✓ ${plural(r.copies, 'copy', 'copies')} and ${plural(r.pics, 'photo', 'photos')} moved`, 3500); location.hash = `#/item/${encodeURIComponent(c.m.model_id)}`; }
        catch (e) { toast(`Couldn't merge: ${e.message}`, 4000, 'bad'); }
      } }, h('div', { class: 'nm' }, c.m.display_name || '(no name)'),
        h('div', { class: 'muted small' }, [brandN(c.m.brand_id), c.m.product_code, box, c.why.join(', ')].filter(Boolean).join(' · ')));
    }) : [h('p', { class: 'muted' }, t ? 'No entry matches that search.' : 'No likely matches. Search by name or code.')]));
  };
  const q = h('input', { type: 'search', placeholder: 'Search the entry to merge into', 'aria-label': 'Search entry to merge into', oninput: (e) => draw(e.target.value) });
  draw('');
  return h('div', { class: 'card mergepanel', id: 'mergePanel' }, h('h3', {}, 'Merge into another entry'),
    h('p', { class: 'muted' }, `Pick the entry to keep. This one's ${plural(nCopies, 'copy', 'copies')} and ${plural(nPhotos, 'photo', 'photos')} move into it.`),
    q, list, h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: () => { mergeFor = null; route(); } }, 'Cancel'));
}

// ---------- Export downloads ----------
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
async function exportCollection() {
  const [models, inventory, photos, identifiers, brands, scales, boxes] = await Promise.all(['models', 'inventory', 'photos', 'product_identifiers', 'brands', 'scales', 'storage_boxes'].map(e => store.list(e)));
  const rows = collectionRows({ models, inventory, photos, identifiers, brands, scales, boxes });
  download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `Scale Model Garage collection ${stamp()}.csv`);
  toast(`Exported ${plural(rows.length - 1, 'row', 'rows')} ✓`);
}
async function exportEverything() {
  const files = [];
  for (const [tab, t] of Object.entries(TABS)) {
    if (!SYNCED_ENTITIES.includes(t.entity)) continue;
    const head = headersFor(tab), rows = await store.list(t.entity, { includeDeleted: true });
    files.push({ name: `${tab}.csv`, text: toCsv([head, ...rows.map(r => head.map(k => r[k] ?? ''))]) });
  }
  files.push({ name: 'README.txt', text: `Scale Model Garage export, ${new Date().toString()}\r\nApp version ${APP_VERSION}. One CSV per tab, same columns as your Google Sheet (SCALE_GARAGE_MASTER). Archived and removed rows are included (deleted_at is filled in). Photos are not included: they stay in your Google Drive (SCALE GARAGE folders); the PHOTOS tab holds their Drive file IDs.\r\n` });
  download(new Blob([zip(files)], { type: 'application/zip' }), `Scale Model Garage export ${stamp()}.zip`);
  toast(`Exported ${plural(files.length - 1, 'tab', 'tabs')} ✓`);
}

// =====================================================================
// Crop / straighten (D14, D19): drag four corners onto the box; the app makes a straight copy.
// The original is never changed; the copy is stored as `cropped` (uploaded) + `cropthumb` (phone only).
// =====================================================================
// The display copy (1600 px); after a sync the phone may only have the thumbnail, so fetch it from Drive.
async function photoSource(p) {
  let src = await blobs.get(`${p.photo_id}:display`);
  if (!src && p.display_file_id && navigator.onLine) {
    try { if (!hasToken()) await signIn(); src = await drive.download(p.display_file_id); await blobs.put(`${p.photo_id}:display`, src); } catch (e) { console.warn('display download', e); }
  }
  return src || await blobs.get(`${p.photo_id}:original`);
}
// Rotate a quarter turn (B, 25 Nov). Same idea as straightening: the corners are turned and a new straight copy is
// made, so it combines with any straightening, the original is never changed, and "Back to original" undoes it.
async function rotatePhoto(p, dir) {
  const src = await photoSource(p);
  if (!src) { toast('The full photo is not on this phone. Connect to the internet and sign in, then try again.', 4500, 'warn'); return false; }
  let q = [[0, 0], [1, 0], [1, 1], [0, 1]];
  try { const saved = JSON.parse(p.crop_corners || 'null'); if (Array.isArray(saved) && saved.length === 4) q = saved; } catch { /* full photo */ }
  q = dir > 0 ? [q[3], q[0], q[1], q[2]] : [q[1], q[2], q[3], q[0]]; // clockwise: the old bottom-left becomes the top-left
  const bmp = await createImageBitmap(src); const W = bmp.width, H = bmp.height; bmp.close?.();
  const out = await straighten(src, q.map(([x, y]) => [x * W, y * H]));
  await blobs.put(`${p.photo_id}:cropped`, out.cropped); await blobs.put(`${p.photo_id}:cropthumb`, out.cropthumb);
  for (const k of ['cropped', 'cropthumb']) urlCache.delete(`${p.photo_id}:${k}`);
  const corners = JSON.stringify(q.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]));
  await store.update('photos', p.photo_id, { crop_corners: corners, cropped_file_id: '' });
  await store.logChange('photos', p.photo_id, 'crop_corners', p.crop_corners || '', corners, dir > 0 ? 'rotated right in app' : 'rotated left in app');
  autoSyncSoon();
  return true;
}
async function renderCrop(v, photoId) {
  const p = (await store.list('photos')).find(x => x.photo_id === photoId);
  if (!p) { v.append(h('p', {}, 'Photo not found.'), h('a', { href: '#/' }, '← Garage')); return; }
  const back = `#/item/${encodeURIComponent(p.model_id)}`;
  v.append(h('a', { href: back, class: 'back' }, '← Back'), h('h2', {}, 'Straighten photo'),
    h('p', { class: 'muted' }, 'Drag the four corners onto the corners of the box. A magnifier helps you place them exactly.'));
  // Source: the display copy (1600 px). After a sync the phone may only have the thumbnail, so fetch it from Drive.
  const src = await photoSource(p);
  if (!src) { v.append(h('div', { class: 'banner warn' }, 'The full photo is not on this phone. Connect to the internet and sign in, then try again.')); return; }
  const url = URL.createObjectURL(src);
  const img = h('img', { src: url, alt: 'Photo to straighten', draggable: 'false' });
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'cropsvg'); svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS(NS, 'polygon'); poly.setAttribute('class', 'cropq'); svg.append(poly);
  const stage = h('div', { class: 'cropstage' }, img, svg);
  const mag = h('canvas', { class: 'cropmag', width: '240', height: '240', 'aria-hidden': 'true' });
  stage.append(mag);
  let q = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
  try { const saved = JSON.parse(p.crop_corners || 'null'); if (Array.isArray(saved) && saved.length === 4) q = saved; } catch { /* use defaults */ }
  const start = q.map(x => [...x]);
  const handles = q.map((_, i) => { const d = h('button', { type: 'button', class: 'croph', 'aria-label': ['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'][i] }); stage.append(d); return d; });
  const draw = () => {
    poly.setAttribute('points', q.map(([x, y]) => `${x},${y}`).join(' '));
    handles.forEach((d, i) => { d.style.left = `${q[i][0] * 100}%`; d.style.top = `${q[i][1] * 100}%`; });
    stage.classList.toggle('bad', !validQuad(q.map(([x, y]) => [x * (img.naturalWidth || 1), y * (img.naturalHeight || 1)])));
  };
  const magDraw = (i) => {
    const c = mag.getContext('2d'), W = img.naturalWidth, H = img.naturalHeight;
    const cx = q[i][0] * W, cy = q[i][1] * H;
    c.clearRect(0, 0, 240, 240); c.save(); c.beginPath(); c.arc(120, 120, 118, 0, Math.PI * 2); c.clip();
    const span = (W / img.clientWidth) * 80; // ~80 css px of photo around the corner, shown 3x
    c.drawImage(img, cx - span / 2, cy - span / 2, span, span, 0, 0, 240, 240);
    c.restore();
    // Crosshair (B: "not visible"): bold accent lines with a white outline and a gap in the middle, so the exact
    // point stays visible on any photo, light or dark.
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f6a4f';
    const arms = [[120, 70, 120, 108], [120, 132, 120, 170], [70, 120, 108, 120], [132, 120, 170, 120]];
    c.lineCap = 'round';
    for (const [w, col] of [[9, '#ffffff'], [4.5, accent]]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); for (const [x1, y1, x2, y2] of arms) { c.moveTo(x1, y1); c.lineTo(x2, y2); } c.stroke(); }
    c.beginPath(); c.arc(120, 120, 4, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 2; c.strokeStyle = accent; c.stroke();
    c.beginPath(); c.arc(120, 120, 117, 0, Math.PI * 2); c.lineWidth = 4; c.strokeStyle = accent; c.stroke();
    // Follows the finger, offset towards the middle of the photo: never under the finger, never on another corner.
    const sw = stage.clientWidth, sh = stage.clientHeight, hx = q[i][0] * sw, hy = q[i][1] * sh;
    const dx = sw / 2 - hx, dy = sh / 2 - hy, len = Math.hypot(dx, dy) || 1, dist = Math.min(130, len * 0.9), R = 66;
    const mx = Math.max(R + 4, Math.min(sw - R - 4, hx + dx / len * dist)), my = Math.max(R + 4, Math.min(sh - R - 4, hy + dy / len * dist));
    mag.style.left = `${mx - R}px`; mag.style.top = `${my - R}px`;
    mag.classList.add('on');
  };
  handles.forEach((d, i) => {
    d.addEventListener('pointerdown', (e) => { e.preventDefault(); d.setPointerCapture(e.pointerId); d.classList.add('drag'); magDraw(i); });
    d.addEventListener('pointermove', (e) => {
      if (!d.hasPointerCapture(e.pointerId)) return;
      const r = img.getBoundingClientRect();
      q[i] = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
      draw(); magDraw(i);
    });
    const end = (e) => { if (d.hasPointerCapture?.(e.pointerId)) d.releasePointerCapture(e.pointerId); d.classList.remove('drag'); mag.classList.remove('on'); };
    d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
  });
  img.addEventListener('load', draw);
  v.append(stage);
  const saveBtn = h('button', { class: 'wide', style: 'margin-top:14px', onclick: async () => {
    const W = img.naturalWidth, H = img.naturalHeight, quad = q.map(([x, y]) => [x * W, y * H]);
    if (!validQuad(quad)) { toast('The corners cross over. Put them in order: top-left, top-right, bottom-right, bottom-left.', 4500, 'warn'); return; }
    saveBtn.disabled = true; saveBtn.textContent = 'Straightening…';
    try {
      const out = await straighten(src, quad);
      await blobs.put(`${p.photo_id}:cropped`, out.cropped); await blobs.put(`${p.photo_id}:cropthumb`, out.cropthumb);
      for (const k of ['cropped', 'cropthumb']) urlCache.delete(`${p.photo_id}:${k}`);
      const corners = JSON.stringify(q.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]));
      await store.update('photos', p.photo_id, { crop_corners: corners, cropped_file_id: '' });
      await store.logChange('photos', p.photo_id, 'crop_corners', p.crop_corners || '', corners, 'straightened in app');
      toast('Straightened ✓ The original is kept.'); location.hash = back; autoSyncSoon();
    } catch (e) { toast(`Couldn't straighten: ${e.message}`, 4000, 'bad'); saveBtn.disabled = false; saveBtn.textContent = 'Save straightened copy'; }
  } }, 'Save straightened copy');
  v.append(saveBtn, h('div', { class: 'row', style: 'margin-top:8px' },
    h('button', { type: 'button', class: 'quiet', onclick: () => { q = start.map(x => [...x]); draw(); } }, 'Reset corners'),
    h('a', { class: 'btn ghost', href: back }, 'Cancel')));
  v.append(h('p', { class: 'muted', style: 'margin-top:10px' }, 'Your original photo is never changed. You can undo this later from the photo\'s options.'));
  draw();
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
// Sync check (Stage 1 check 2): read-only comparison of this phone with the Sheet and Drive.
const TAB_WORDS = { MODELS: ['car', 'cars'], INVENTORY: ['copy', 'copies'], PHOTOS: ['photo record', 'photo records'], PRODUCT_IDENTIFIERS: ['barcode', 'barcodes'], STORAGE_BOXES: ['storage box', 'storage boxes'], BRANDS: ['brand', 'brands'], PRODUCT_LINES: ['product line', 'product lines'], SCALES: ['scale', 'scales'], CATEGORIES: ['category', 'categories'], AI_LOG: ['Gemini round', 'Gemini rounds'], CHANGE_LOG: ['change-log row', 'change-log rows'], ALIASES: ['brand alias', 'brand aliases'] };
function auditSummary(a) {
  const when = new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const cars = a.tabs.MODELS?.sheetRows ?? 0;
  const lines = [];
  for (const [tab, t] of Object.entries(a.tabs)) {
    const [one, many] = TAB_WORDS[tab] || [`${tab.toLowerCase()} row`, `${tab.toLowerCase()} rows`];
    if (t.missing.length) lines.push(`❌ ${plural(t.missing.length, `${one} is`, `${many} are`)} on this phone but not in the sheet`);
    if (t.dupes.length) lines.push(`❌ ${plural(t.dupes.length, `${one} appears`, `${many} appear`)} twice in the sheet`);
  }
  for (const [k, txt] of [['missing', 'missing from Drive'], ['trashed', 'in the Drive bin'], ['changed', 'different from what was uploaded']]) if (a.photos[k].length) lines.push(`❌ ${plural(a.photos[k].length, 'photo file is', 'photo files are')} ${txt}`);
  const extra = Object.values(a.tabs).reduce((n, t) => n + t.extra.length, 0);
  return h('div', { class: `banner ${a.ok ? 'ok' : 'warn'} auditres`, style: 'margin-top:8px' },
    h('div', { class: 'hd' }, a.ok ? `✅ All good: ${plural(cars, 'car', 'cars')} in the sheet once${a.photos.checked ? `, ${a.photos.ok} photo files intact` : ''}` : `${plural(a.problems, 'problem', 'problems')} found`),
    ...lines.map(t => h('div', {}, t)),
    a.pending ? h('div', { class: 'muted' }, `${plural(a.pending, 'change is', 'changes are')} still waiting to sync, so they weren't checked. Sync, then check again.`) : null,
    a.photos.notUploaded ? h('div', { class: 'muted' }, `${plural(a.photos.notUploaded, 'photo is', 'photos are')} not uploaded yet.`) : null,
    extra ? h('div', { class: 'muted' }, `${plural(extra, 'row', 'rows')} in the sheet ${extra === 1 ? 'is' : 'are'} not on this phone (normal if you also use another device).`) : null,
    h('div', { class: 'muted small' }, `Checked ${when} · reads only, changes nothing`));
}
async function auditCard() {
  const last = await meta.get('lastAudit', null);
  const card = h('div', { class: 'card', id: 'auditCard' }, h('h3', {}, 'Check sync'),
    h('p', { class: 'muted' }, 'Compares this phone with your sheet and Drive: every car once, nothing missing, photo files intact.'));
  const res = h('div', {}, last ? auditSummary(last) : '');
  const msg = h('p', { class: 'muted', id: 'auditMsg' });
  const nPhotos = (await store.list('photos')).filter(p => p.original_file_id).length;
  const files = h('input', { type: 'checkbox', 'aria-label': 'Also check photo files', checked: nPhotos <= 400 ? true : undefined });
  const btn = h('button', { type: 'button', class: 'quiet wide', disabled: hasToken() ? undefined : true, onclick: async () => {
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const a = await runAudit({ checkFiles: files.checked, progress: (t) => { msg.textContent = t; } });
      await meta.set('lastAudit', a); msg.textContent = ''; res.replaceChildren(auditSummary(a));
    } catch (e) { msg.textContent = ''; toast(`Check stopped: ${e.message}`, 5000, 'bad'); }
    btn.disabled = false; btn.textContent = 'Check again';
  } }, last ? 'Check again' : 'Check that everything reached Google');
  card.append(h('label', { style: 'display:flex;gap:8px;align-items:center;margin:0 0 8px' }, files, `Also check ${plural(nPhotos, 'photo file', 'photo files')} on Drive${nPhotos > 400 ? ' (slower: one Drive request per photo)' : ''}`), btn, msg, res);
  if (!hasToken()) card.append(h('p', { class: 'muted small' }, 'Sign in above to run the check.'));
  return card;
}

async function renderSettings(v) {
  v.append(h('h2', {}, 'Settings'));
  const config = await getConfig();
  const last = await meta.get('lastSync', null);
  const c = await store.counts();
  const ps = await store.pendingSummary();

  const acct = h('div', { class: 'card' }, h('h3', {}, 'Google account'));
  const cid = h('input', { value: getClientId(), placeholder: 'OAuth Client ID (….apps.googleusercontent.com)', 'aria-label': 'Google Client ID' });
  const cidBlock = [h('label', { class: 'f' }, 'Google Client ID (saved on this phone only)'), cid,
    h('p', { class: 'muted' }, getClientId() ? 'Saved on this phone ✓' : 'Paste the Client ID from your Google Cloud project (same one the test kit used).')];
  // Signed in: one status line, the Client ID folded away, and no second Sync button (the Sync card has it).
  if (hasToken()) acct.append(h('p', {}, `Signed in ✓`), h('p', { class: 'muted' }, `${tokenMinutesLeft()} min left; renews by itself on sync.`),
    h('details', { class: 'more' }, h('summary', {}, 'Change Client ID'), ...cidBlock,
      h('button', { class: 'quiet small', onclick: () => { if (cid.value.trim()) { setClientId(cid.value); toast('Client ID saved'); } } }, 'Save Client ID')));
  else acct.append(...cidBlock, h('p', { class: 'muted' }, 'Not signed in. You can still capture offline.'),
    h('button', { class: 'wide', onclick: async () => { if (cid.value.trim()) setClientId(cid.value); try { await signIn(); toast('Signed in'); await runSync(true); } catch (e) { toast(e.message, 4000, 'bad'); } route(); } }, 'Sign in & set up'));
  v.append(acct);

  const sync = h('div', { class: 'card' }, h('h3', {}, 'Sync'),
    h('p', {}, ps.boxes || ps.other ? `${ps.boxes ? plural(ps.boxes, 'box', 'boxes') : 'Some changes'} waiting${ps.photos ? ` · ${plural(ps.photos, 'photo', 'photos')} not uploaded yet` : ''}${c.conflicts ? ` · ${plural(c.conflicts, 'clash', 'clashes')} to review` : ''}` : (c.conflicts ? `${plural(c.conflicts, 'clash', 'clashes')} to review` : 'Nothing waiting to sync.')),
    h('p', { class: 'muted', id: 'syncMsg' }, lastSyncMsg || (last ? `Last sync ${new Date(last.finishedAt).toLocaleString()} · ${last.errors.length ? last.errors.length + ' error(s)' : 'no errors'}` : 'Never synced.')),
    last?.errors?.length ? h('details', {}, h('summary', {}, 'Show errors'), h('pre', { style: 'white-space:pre-wrap;font-size:.8rem' }, last.errors.join('\n'))) : null,
    hasToken() ? h('button', { class: 'syncbtn', onclick: () => runSync(true) }, 'Sync now')
      : h('p', { class: 'muted' }, 'Sign in above to sync.')); // signed out: one bold button on the page, not two
  v.append(sync);
  v.append(await auditCard());

  v.append(await helperCard());
  v.append(h('a', { href: '#/brands', class: 'card linkcard' }, h('span', {}, h('b', {}, 'Brands'), h('span', { class: 'muted' }, ' · rename, merge look-alikes')), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  const where = h('div', { class: 'card' }, h('h3', {}, 'Your data'),
    config?.workbookId ? h('p', {}, h('a', { href: `https://docs.google.com/spreadsheets/d/${config.workbookId}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open SCALE_GARAGE_MASTER sheet ↗')) : h('p', { class: 'muted' }, 'Not set up yet — sign in above.'),
    config?.rootId ? h('p', {}, h('a', { href: `https://drive.google.com/drive/folders/${config.rootId}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open SCALE GARAGE folder ↗')) : null);
  v.append(where);

  // Backups (D25): automatic after a successful sync (daily, monthly) + on demand.
  const lb = await lastBackup();
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'not yet');
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Backups'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Daily copy'), h('dd', {}, when(lb.dailyAt)),
      h('dt', {}, 'Monthly copy'), h('dd', {}, lb.monthlyMonth || 'not yet'),
      h('dt', {}, 'Manual copy'), h('dd', {}, when(lb.manualAt))),
    h('p', { class: 'muted' }, 'A copy of your sheet goes to SCALE GARAGE › 06_BACKUPS after a sync, once a day (7 kept) and once a month (12 kept). Photos stay in Drive and are not copied.'),
    h('button', { class: 'quiet', disabled: config?.workbookId ? undefined : true, onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Backing up…';
      try { if (!hasToken()) await signIn(); await backupNow(await getConfig()); toast('Backup made ✓'); }
      catch (err) { toast(`Backup failed: ${err.message}`, 4000, 'bad'); }
      route();
    } }, 'Back up now'),
    // Restore (D25): pick a copy; the current sheet is kept and backed up first; nothing is deleted.
    restoreList === null
      ? h('button', { class: 'ghost', style: 'margin-top:10px', disabled: config?.workbookId ? undefined : true, onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'Finding backups…';
          try { if (!hasToken()) await signIn(); restoreList = await listBackups(); } catch (err) { toast(`Couldn't list backups: ${err.message}`, 4000, 'bad'); }
          route();
        } }, 'Restore from a backup…')
      : h('div', { class: 'restore' }, h('h3', {}, 'Restore from a backup'),
          h('p', { class: 'muted' }, 'Pick a copy. Your current sheet is backed up first and kept in Drive, renamed "(replaced …)". Nothing is deleted. Photos are not affected.'),
          restoreList.length ? restoreList.slice(0, 30).map(b => h('div', { class: 'row removed' },
            h('div', {}, h('b', {}, b.at ? new Date(b.at.length > 10 ? b.at : b.at + 'T00:00').toLocaleString('en-IN', b.at.length > 10 ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }) : b.name),
              h('div', { class: 'muted small' }, { manual: 'Made with "Back up now"', daily: 'Daily copy', monthly: 'Monthly copy' }[b.kind])),
            h('button', { type: 'button', class: 'small quiet', onclick: (e) => doRestore(b, e.target) }, 'Restore'))) : h('p', { class: 'muted' }, 'No backups yet. They appear after your first sync.'),
          h('button', { type: 'button', class: 'small ghost', style: 'margin-top:8px', onclick: () => { restoreList = null; route(); } }, 'Cancel'))));

  async function doRestore(b, btn) {
    const p = await store.pendingSummary();
    if (p.boxes || p.other) { toast('Sync first: some changes on this phone are not in your sheet yet.', 4500, 'warn'); return; }
    const label = btn.closest('.row').querySelector('b').textContent;
    if (!confirm(`Restore the backup from ${label}?\n\n• Your current sheet is backed up first and kept in Drive, renamed "(replaced …)".\n• The app then shows the collection as it was in that backup.\n• Photos stay in Drive. Nothing is deleted.`)) return;
    btn.disabled = true; btn.textContent = 'Restoring…';
    try {
      if (!hasToken()) await signIn();
      await restoreBackup(await getConfig(), b, { pending: p });
      await seedLocal();
      restoreList = null;
      await runSync(true);
      await store.logChange('workbook', (await getConfig()).workbookId, 'restored_from', '', b.name, 'restored in app; previous sheet kept as "(replaced …)"');
      autoSyncSoon();
      toast(`Restored the backup from ${label} ✓`, 4500);
      location.hash = '#/';
    } catch (err) { toast(`Restore failed: ${err.message}`, 5000, 'bad'); btn.disabled = false; btn.textContent = 'Restore'; }
  }

  // Export (brief R6): never locked in. Both files are made on the phone from what is stored here.
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Export'),
    h('p', { class: 'muted' }, 'Download your collection. Opens in Excel, Google Sheets or Numbers. Made on this phone from what is stored here; sync first for the latest.'),
    h('button', { class: 'quiet wide', onclick: () => exportCollection() }, 'Collection list (CSV, one row per car)'),
    h('button', { class: 'ghost wide', style: 'margin-top:8px', onclick: () => exportEverything() }, 'Everything (ZIP, every tab as CSV)')));

  // Collection size, for the Garage progress bar.
  const curAccent = document.documentElement.dataset.accent;
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Look'),
    h('p', { class: 'muted' }, 'Accent colour, used for the main buttons and where you are in the app.'),
    h('div', { class: 'swatches' }, ACCENTS.map(([k, label, hex]) => h('button', { type: 'button', class: `swatch ${curAccent === k ? 'on' : ''}`, style: `background:${hex}`, 'aria-label': label, 'aria-pressed': curAccent === k ? 'true' : 'false', title: label, onclick: () => { localStorage.setItem('smg.accent', k); applyAccent(); route(); } }))),
    h('p', { class: 'muted', style: 'margin-top:8px' }, ACCENTS.find(x => x[0] === curAccent)?.[1] || ''),
    h('label', { class: 'f', style: 'margin-top:12px' }, 'Moments (car drives into its box, start lights, chequered flag…)'),
    (() => { const off = (() => { try { return localStorage.getItem('smg.motion') === 'off'; } catch { return false; } })();
      const set = (v) => { try { localStorage.setItem('smg.motion', v); } catch {} route(); };
      return h('div', { class: 'chips' }, h('button', { type: 'button', class: `chip ${!off ? 'on' : ''}`, onclick: () => set('on') }, 'On'), h('button', { type: 'button', class: `chip ${off ? 'on' : ''}`, onclick: () => set('off') }, 'Off')); })(),
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? h('p', { class: 'muted small' }, 'Your phone asks for less motion, so moments stay off.') : null));
  const estIn = h('input', { inputmode: 'numeric', value: String(collectionEstimate()), 'aria-label': 'About how many boxes in your collection' });
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Your collection'),
    h('label', { class: 'f' }, 'Rough guess: how many boxes in total?'), estIn,
    h('p', { class: 'muted' }, 'Only sets how full the progress bars look. It is never shown as a target. Raise it any time as the collection grows.'),
    h('button', { class: 'quiet', onclick: () => { const n = Number(estIn.value.replace(/\D/g, '')); if (n > 0) { localStorage.setItem('smg.collectionEstimate', String(n)); toast('Saved ✓'); } else toast('Please enter a number', 3000, 'warn'); } }, 'Save')));

  const est = await storageEstimate();
  const persisted = await (navigator.storage?.persisted?.() ?? Promise.resolve(false));
  const times = await meta.get(TIMES_KEY, []);
  const median = times.length ? times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)] : null;
  v.append(h('div', { class: 'card' }, h('h3', {}, 'This phone'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Storage used'), h('dd', {}, est ? `${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1073741824).toFixed(1)} GB` : '—'),
      h('dt', {}, 'Protected storage'), h('dd', {}, persisted ? 'Yes ✓' : 'No'),
      h('dt', {}, 'Capture time'), h('dd', {}, median ? `median ${median} s per box (${plural(times.length, 'box', 'boxes')}; time spent on each box in the app)` : 'Not measured yet (counts from this version on)'),
      h('dt', {}, 'Shooting pace'), h('dd', {}, paceText(await shootingPace()) || 'Not enough photos yet'),
      h('dt', {}, 'Last photos'), h('dd', {}, (() => { try { const l = JSON.parse(localStorage.getItem('smg.photoTiming') || '[]').slice(0, 4); return l.length ? l.map(x => `${SHOT_ROLES[x.role]?.label || x.role}: ${(x.total / 1000).toFixed(1)} s`).join(' · ') + ' (prepared in the background)' : 'Not measured yet'; } catch { return '—'; } })()),
      h('dt', {}, 'App version'), h('dd', {}, APP_VERSION),
      h('dt', {}, 'Schema version'), h('dd', {}, String(SCHEMA_VERSION))),
    persisted ? null : h('button', { class: 'quiet', style: 'margin-top:8px', onclick: async () => { const ok = await requestPersistentStorage(); toast(ok ? 'Storage protected ✓' : 'Chrome said no (try after installing the app)', 3500, ok ? 'ok' : 'warn'); route(); } }, 'Protect storage on this phone')));
}

// =====================================================================
// Helper mode (D32, helper-mode-plan.md). A helper catalogues the backlog on THEIR phone: no sign-in, no sync.
// Owner: Settings → Helper → "File for a helper" (lookup: what you own, no money) and "Import a helper's boxes".
// Helper: opens #/helper, loads the file, fills boxes, sends one file per box (the Send tab).
// =====================================================================
let helperInfo = null; // { made_at, cars, photos, loaded_at } once this phone is in Helper mode
let inboxState = null; // owner side: the helper files being reviewed
function applyHelperLook() {
  document.body.classList.toggle('helper', !!helperInfo);
  const a = document.querySelector('nav.bottom a[href="#/settings"]');
  if (a?.lastChild?.nodeType === 3) a.lastChild.textContent = helperInfo ? 'Send' : 'Settings';
}
async function allRecs() { return (await Promise.all(SYNCED_ENTITIES.map(e => store.listRecords(e)))).flat(); }
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
const boxTitle = (label) => label || 'Cars not in a storage box';
// Share sheet when the phone can share files (Drive, WhatsApp…), otherwise a download. Returns false if cancelled.
async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type || 'application/zip' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return false; console.warn('share', e); }
  download(blob, name);
  return 'downloaded';
}
async function helperToSend() {
  const sent = await meta.get('helperSent', {});
  return helperBoxes(await allRecs()).map(b => ({ ...b, sent: sent[b.label] || null, state: !sent[b.label] ? 'new' : sent[b.label].signature === b.signature ? 'sent' : 'changed' }));
}
async function refreshHelperStatus() {
  const pill = $('#status');
  let n = 0; try { n = (await helperToSend()).filter(b => b.state !== 'sent').length; } catch {}
  pill.textContent = n ? `Helper · ${plural(n, 'box', 'boxes')} to send` : 'Helper mode';
  pill.style.color = `var(--${n ? 'warn' : 'ok'})`;
  pill.setAttribute('aria-label', `${pill.textContent}. Tap to send.`);
}
function helperBanner() {
  return h('div', { class: 'banner info helperbanner' }, h('div', { class: 'hd' }, 'Helper mode'),
    h('div', {}, `You're cataloguing for the owner. Their cars are here so you can spot ones they already have. Fill a box, then send it from the Send tab.`));
}

// ---------- owner: the lookup file ----------
async function exportForHelper(btn) {
  btn.disabled = true; btn.textContent = 'Making the file…';
  try {
    const tables = {}; for (const e of LOOKUP_ENTITIES) tables[e] = await store.list(e);
    const L = buildLookup(tables);
    const files = [], made = store.nowIso();
    let withPhoto = 0;
    for (const id of L.photoIds) {
      const b = await blobs.get(`${id}:thumb`);
      if (b) { files.push({ name: photoPath(id, 'thumb'), bytes: new Uint8Array(await b.arrayBuffer()) }); withPhoto++; }
    }
    const manifest = { kind: LOOKUP_KIND, format: HELPER_FORMAT, app_version: APP_VERSION, made_at: made, cars: L.tables.models.length, photos: withPhoto };
    files.unshift({ name: 'manifest.json', text: JSON.stringify(manifest) }, { name: 'lookup.json', text: JSON.stringify(L.tables) });
    const blob = new Blob([zip(files)], { type: 'application/zip' });
    await meta.set('helperLookupMade', { at: made, cars: manifest.cars, photos: withPhoto, bytes: blob.size });
    const how = await shareOrDownload(blob, `Garage helper file ${stamp()}.zip`, 'Scale Model Garage: file for your helper');
    if (how) toast(`Helper file ready ✓ ${plural(manifest.cars, 'car', 'cars')}, ${withPhoto} with a photo · ${mb(blob.size)}`, 4500);
  } catch (e) { toast(`Couldn't make the helper file: ${e.message}`, 4500, 'bad'); }
  route();
}
async function helperCard() {
  const made = await meta.get('helperLookupMade', null);
  const link = new URL('#/helper', location.href.split('#')[0]).href;
  return h('div', { class: 'card helpercard' }, h('h3', {}, 'Helper'),
    h('p', { class: 'muted' }, 'Someone helping you catalogue, on their own phone. They never sign in or see prices: they get a file of what you own (names, codes, barcodes, small box photos) to spot duplicates, and send you one file per storage box.'),
    h('ol', { class: 'steps small' },
      h('li', {}, 'Make the helper file just before you hand over (it\'s a snapshot) and send it to them.'),
      h('li', {}, 'They open the helper link on their phone and load the file.'),
      h('li', {}, 'Split the work by box number, so nobody does the same car twice.'),
      h('li', {}, 'When they send a box, import it here and check it.')),
    h('button', { type: 'button', class: 'wide', onclick: (e) => exportForHelper(e.target) }, 'Make the file for a helper'),
    made ? h('p', { class: 'muted small' }, `Last made ${new Date(made.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${plural(made.cars, 'car', 'cars')} · ${mb(made.bytes)}`) : null,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('code', { class: 'helperlink' }, link),
      h('button', { type: 'button', class: 'quiet small', onclick: async () => toast(await copyText(link) ? 'Helper link copied ✓' : 'Copy the link by hand', 2500, 'ok') }, 'Copy link')),
    h('a', { href: '#/inbox', class: 'btn ghost wide', style: 'margin-top:10px' }, "Import a helper's boxes…"));
}

// ---------- helper: loading the owner's file ----------
async function phoneHasOwnGarage() {
  if (await getConfig()) return true;
  return (await store.listRecords('models')).some(r => !r.lookup);
}
async function loadLookup(file) {
  const files = unzip(new Uint8Array(await file.arrayBuffer()));
  const man = JSON.parse(fileText(files, 'manifest.json') || 'null');
  if (man?.kind === INBOX_KIND) throw new Error('This is a box file from a helper. The owner imports it in Settings → Helper.');
  if (man?.kind !== LOOKUP_KIND) throw new Error('This is not a helper file from Scale Model Garage');
  if (man.format > HELPER_FORMAT) throw new Error('This file is from a newer app version. Reopen the app to update it, then try again.');
  const tables = JSON.parse(fileText(files, 'lookup.json'));
  // A newer file replaces the older one; what the helper made is never touched
  const old = (await allRecs()).filter(r => r.lookup && !r.dirty);
  await records.removeMany(old);
  const recs = [];
  for (const [entity, rows] of Object.entries(tables)) {
    if (!LOOKUP_ENTITIES.includes(entity)) continue;
    const idCol = TABS[Object.keys(TABS).find(k => TABS[k].entity === entity)].id;
    for (const row of rows) recs.push({ key: `${entity}:${row[idCol]}`, entity, id: row[idCol], data: { ...store.blank(entity), ...row }, dirty: 0, lookup: true, sync: { base: null } });
  }
  await records.putMany(recs);
  let photos = 0;
  for (const f of files) { const m = /^photos\/(pho_[^-]+)-thumb\.jpg$/.exec(f.name); if (m) { await blobs.put(`${m[1]}:thumb`, new Blob([f.bytes], { type: 'image/jpeg' })); photos++; } }
  helperInfo = { made_at: man.made_at, cars: man.cars, photos, loaded_at: store.nowIso(), app_version: man.app_version };
  await meta.set('helper', helperInfo);
  urlCache.clear(); store.notifyChange(); applyHelperLook();
  return helperInfo;
}
function lookupPicker(after) {
  const inp = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const i = await loadLookup(f); toast(`Loaded ✓ ${plural(i.cars, 'car', 'cars')} from the owner's garage`, 3500); after(); }
    catch (err) { toast(err.message, 5000, 'bad'); }
  } });
  return [inp, () => inp.click()];
}
async function renderHelperStart(v) {
  v.append(h('h2', {}, 'Helper mode'));
  if (helperInfo) { v.append(h('p', {}, 'This phone is already in Helper mode.'), h('a', { href: '#/settings', class: 'btn wide' }, 'Go to Send')); return; }
  if (await phoneHasOwnGarage()) {
    v.append(h('div', { class: 'banner bad' }, h('div', { class: 'hd' }, 'This phone has its own garage'),
      h('div', {}, 'Helper mode is for a helper\'s phone. To help someone, use a phone that hasn\'t been set up with a garage.')), h('a', { href: '#/', class: 'back' }, '← Garage'));
    return;
  }
  const [inp, pickFile] = lookupPicker(() => { location.hash = '#/'; });
  v.append(h('p', {}, 'You\'re helping someone catalogue their scale model collection.'),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Load the file'), ' the owner sent you (a .zip). It shows what they already own, so you can spot duplicates. Nothing is uploaded and you don\'t sign in.'),
      h('li', {}, h('b', {}, 'Fill a storage box: '), 'Garage → tap the box → Fill box. For each car take the front, then a close-up of the barcode (back or bottom).'),
      h('li', {}, h('b', {}, 'Send the box'), ' from the Send tab when it\'s done. Send each box when you finish it, so nothing is lost.')),
    h('p', { class: 'muted small' }, 'Tip: install this page on your home screen (browser menu → Install app / Add to Home Screen) so it opens like an app.'),
    inp, h('button', { type: 'button', class: 'wide', onclick: pickFile }, "Load the owner's file"));
}

// ---------- helper: the Send tab ----------
async function sendBox(b, btn) {
  btn.disabled = true; btn.textContent = 'Packing…';
  try {
    const recs = await allRecs();
    const part = boxRecords(recs, b.label);
    const files = [];
    for (const id of part.photoIds) for (const variant of PHOTO_VARIANTS) {
      const blob = await blobs.get(`${id}:${variant}`);
      if (blob) files.push({ name: photoPath(id, variant), bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    const manifest = { kind: INBOX_KIND, format: HELPER_FORMAT, app_version: APP_VERSION, made_at: store.nowIso(), box: b.label, helper_device: store.deviceId(), cars: b.cars, copies: b.copies, photos: part.photoIds.length };
    files.unshift({ name: 'manifest.json', text: JSON.stringify(manifest) }, { name: 'records.json', text: JSON.stringify(part.records) });
    const blob = new Blob([zip(files)], { type: 'application/zip' });
    const safe = (b.label || 'no box').replace(/[^\w -]+/g, '').trim();
    const how = await shareOrDownload(blob, `Garage helper ${safe} ${stamp()}.zip`, `Scale Model Garage: ${boxTitle(b.label)}`);
    if (!how) { toast('Not sent', 2000, 'warn'); route(); return; }
    const sent = await meta.get('helperSent', {});
    sent[b.label] = { signature: part.signature, at: store.nowIso(), bytes: blob.size, how };
    await meta.set('helperSent', sent);
    toast(how === 'shared' ? `${boxTitle(b.label)} shared ✓ ${mb(blob.size)}` : `${boxTitle(b.label)} saved to Downloads ✓ ${mb(blob.size)}: send it to the owner`, 4500);
  } catch (e) { toast(`Couldn't pack ${boxTitle(b.label)}: ${e.message}`, 5000, 'bad'); }
  route();
}
async function renderHelperHome(v) {
  v.append(h('h2', {}, 'Send to the owner'));
  const boxes = await helperToSend();
  const todo = boxes.filter(b => b.state !== 'sent');
  const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (!boxes.length) v.append(h('div', { class: 'card' }, h('p', {}, 'Nothing to send yet.'), h('p', { class: 'muted' }, 'Fill a box first: Garage → tap a box → Fill box.')));
  else {
    v.append(h('p', { class: 'muted' }, todo.length ? `${plural(todo.length, 'box', 'boxes')} to send. Send each box when it's done.` : 'Everything you made has been sent ✓'));
    for (const b of boxes) {
      const extra = b.copies - b.cars;
      v.append(h('div', { class: `card sendbox ${b.state}` },
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, boxTitle(b.label)),
          h('span', { class: `pillish ${b.state}` }, b.state === 'sent' ? `Sent ✓ ${when(b.sent.at)}` : b.state === 'changed' ? 'Changed since you sent it' : 'Not sent yet')),
        h('p', { class: 'muted small', style: 'margin:4px 0 8px' }, [plural(b.cars, 'new car', 'new cars'), extra > 0 ? plural(extra, 'extra copy', 'extra copies') : '', plural(b.photos, 'photo', 'photos')].filter(Boolean).join(' · ')),
        h('button', { type: 'button', class: b.state === 'sent' ? 'quiet wide' : 'wide', onclick: (e) => sendBox(b, e.target) }, b.state === 'sent' ? 'Send again' : `Send ${boxTitle(b.label)}`)));
    }
  }
  const est = await storageEstimate();
  const persisted = await (navigator.storage?.persisted?.() ?? Promise.resolve(false));
  v.append(h('div', { class: 'card' }, h('h3', {}, 'This phone'),
    h('dl', { class: 'kv' },
      h('dt', {}, "Owner's file"), h('dd', {}, helperInfo?.made_at ? `made ${when(helperInfo.made_at)} · ${plural(helperInfo.cars || 0, 'car', 'cars')}` : '—'),
      h('dt', {}, 'Storage used'), h('dd', {}, est ? `${mb(est.usage)} of ${(est.quota / 1073741824).toFixed(1)} GB` : '—'),
      h('dt', {}, 'Protected storage'), h('dd', {}, persisted ? 'Yes ✓' : 'No'),
      h('dt', {}, 'App version'), h('dd', {}, APP_VERSION)),
    persisted ? null : h('button', { class: 'quiet', style: 'margin-top:8px', onclick: async () => { const ok = await requestPersistentStorage(); toast(ok ? 'Storage protected ✓' : 'The browser said no (try after installing the app)', 3500, ok ? 'ok' : 'warn'); route(); } }, 'Protect storage on this phone')));
  const [inp, pickFile] = lookupPicker(() => route());
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Newer file from the owner'),
    h('p', { class: 'muted' }, 'If the owner sends you a newer file, load it here. What you made stays.'), inp,
    h('button', { type: 'button', class: 'quiet wide', onclick: pickFile }, 'Load a newer file')));
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Finished helping?'),
    todo.length ? h('p', { class: 'muted' }, `Send ${todo.length === 1 ? 'the last box' : `the ${todo.length} boxes`} first. Leaving Helper mode clears everything on this phone.`)
      : h('p', { class: 'muted' }, 'Leaving Helper mode clears the owner\'s file and your photos from this phone.'),
    h('button', { type: 'button', class: 'ghost wide', disabled: todo.length ? true : undefined, onclick: async () => {
      if (!confirm('Leave Helper mode?\n\nEverything on this phone (the owner\'s file and your photos) is cleared. Everything you made was sent.')) return;
      await records.clearAll(); try { localStorage.clear(); } catch {}
      helperInfo = null; location.hash = '#/'; location.reload();
    } }, 'Leave Helper mode')));
}
// The owner's car, seen on the helper's phone: look, don't touch; ＋1 adds a copy the owner will check.
async function renderLookupItem(v, modelId) {
  const m = await store.get('models', modelId);
  const ref = await refData();
  const inv = (await store.listRecords('inventory')).filter(r => r.data.model_id === modelId && !r.data.deleted_at);
  const photos = (await store.list('photos')).filter(p => p.model_id === modelId);
  const idfs = (await store.list('product_identifiers')).filter(i => i.model_id === modelId);
  const brandN = ref.brands.find(b => b.brand_id === m.brand_id)?.name || m.printed_brand_text || '';
  const scaleN = ref.scales.find(x => x.scale_id === m.scale_id)?.label || '';
  v.append(h('a', { href: '#/', class: 'back' }, '← Garage'),
    h('div', { class: 'pdp-head' }, h('div', { class: 'pdp-kicker' }, [brandN, scaleN].filter(Boolean).join(' · ') || 'Brand and scale not set'), h('h2', {}, m.display_name || '(no name yet)'),
      m.product_code ? h('div', { class: 'muted' }, m.product_code) : null));
  const url = await photoUrl(photos.find(p => p.photo_id === m.primary_photo_id) || photos[0]);
  if (url) v.append(h('div', { class: 'pdp-photo' }, h('img', { src: url, alt: m.display_name || 'Box front' })));
  const mine = inv.filter(r => !r.lookup), theirs = inv.filter(r => r.lookup);
  const where = [...new Set(theirs.map(r => r.data.storage_location || 'no box'))].join(', ');
  v.append(h('div', { class: 'banner have' }, h('div', { class: 'hd' }, `The owner has ${plural(theirs.length, 'copy', 'copies')}`), h('div', {}, where ? `In ${where}.` : ''),
    idfs.filter(i => i.identifier_type === 'barcode').length ? h('div', { class: 'muted small' }, `Barcode ${idfs.filter(i => i.identifier_type === 'barcode').map(i => i.value_raw).join(', ')}`) : null,
    mine.length ? h('div', { style: 'margin-top:6px' }, `You added ${plural(mine.length, 'more copy', 'more copies')}: ${mine.map(r => r.data.storage_location || 'no box').join(', ')}`) : null));
  const boxIn = h('input', { inputmode: 'numeric', value: cap?.box || '', placeholder: 'Box number', 'aria-label': 'Box number for the extra copy', style: 'max-width:9rem' });
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Found another one of these?'),
    h('p', { class: 'muted' }, 'Add it as an extra copy. The owner checks it when they import your box.'),
    h('div', { class: 'row' }, boxIn, h('button', { type: 'button', onclick: async () => {
      const b = String(boxIn.value || '').replace(/^box\s*/i, '').trim();
      if (!b) { toast('Which box is it going in?', 2500, 'warn'); return; }
      await store.create('inventory', { model_id: modelId, ownership_status: 'Owned', storage_location: boxLoc(b), packaging_state: '', purchase_date_precision: 'unknown' });
      toast(`＋1 copy in Box ${b} ✓ Send Box ${b} when it's done`, 3500); route();
    } }, '＋1 copy')),
    h('p', { class: 'muted small' }, "This car is in the owner's garage, so it can't be changed here.")));
}

// ---------- owner: importing a helper's boxes ----------
async function readInbox(fileList) {
  const pkgs = [], photoFiles = new Map(), seen = new Set(), records0 = [];
  for (const f of fileList) {
    const files = unzip(new Uint8Array(await f.arrayBuffer()));
    const man = JSON.parse(fileText(files, 'manifest.json') || 'null');
    if (man?.kind === LOOKUP_KIND) throw new Error(`${f.name} is the file you made for your helper, not a box from them.`);
    if (man?.kind !== INBOX_KIND) throw new Error(`${f.name} is not a helper box file from Scale Model Garage`);
    if (man.format > HELPER_FORMAT) throw new Error(`${f.name} is from a newer app version. Reopen the app to update it.`);
    let list = []; try { list = JSON.parse(fileText(files, 'records.json') || '[]'); } catch { throw new Error(`${f.name} is damaged (records can't be read)`); }
    for (const raw of Array.isArray(list) ? list : []) {
      const r = cleanInboxRecord(raw, (e) => Object.keys(store.blank(e)), isId); // only what a box file may carry, known columns only
      if (!r) continue;
      const k = `${r.entity}:${Object.values(r.data)[0]}`; if (seen.has(k)) continue; seen.add(k); records0.push(r);
    }
    for (const x of files) if (x.name.startsWith('photos/')) photoFiles.set(x.name, x.bytes);
    pkgs.push({ name: f.name, manifest: man });
  }
  const live = {};
  for (const e of ['models', 'product_identifiers', 'inventory', 'brands', 'product_lines', 'storage_boxes', 'photos', 'aliases']) live[e] = await store.list(e, { includeDeleted: e === 'inventory' || e === 'photos' });
  return { pkgs, photoFiles, plan: planImport({ records: records0 }, live) };
}
async function renderInbox(v) {
  v.append(h('a', { href: '#/settings', class: 'back' }, '← Settings'), h('h2', {}, "Import a helper's boxes"));
  if (helperInfo) { v.append(h('p', {}, 'Not on a helper\'s phone: the owner imports boxes.')); return; }
  const pick = h('input', { type: 'file', accept: '.zip,application/zip', multiple: true, hidden: true, onchange: async (e) => {
    const fl = [...(e.target.files || [])]; if (!fl.length) return;
    try { inboxState = await readInbox(fl); } catch (err) { toast(err.message, 5000, 'bad'); }
    route();
  } });
  if (!inboxState) {
    v.append(h('p', { class: 'muted' }, 'Pick the box files your helper sent you (one or several). Nothing goes into your garage until you check it and tap Import.'), pick,
      h('button', { type: 'button', class: 'wide', onclick: () => pick.click() }, 'Pick helper box files'));
    return;
  }
  const { pkgs, photoFiles, plan } = inboxState;
  const ref = await refData();
  const models = await store.list('models');
  const nameOf = (id) => { const m = models.find(x => x.model_id === id); return m ? (m.display_name || m.product_code || 'a car with no name yet') : 'a car'; };
  const brandName = (id) => ref.brands.find(b => b.brand_id === id)?.name || plan.brands.find(b => b.create && b.data.brand_id === id)?.name || '';
  const urls = new Map();
  const thumbOf = (row) => { const p = row.photos.find(x => x.shot_role === 'box_front') || row.photos[0]; if (!p) return null;
    const bytes = photoFiles.get(photoPath(p.photo_id, 'thumb')) || photoFiles.get(photoPath(p.photo_id, 'display')); if (!bytes) return null;
    if (!urls.has(p.photo_id)) urls.set(p.photo_id, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))); return urls.get(p.photo_id); };
  v.append(h('p', { class: 'muted' }, `${plural(pkgs.length, 'file', 'files')}: ${pkgs.map(p => boxTitle(p.manifest.box)).join(', ')}`));
  const newBrands = plan.brands.filter(b => b.create), sameBrands = plan.brands.filter(b => b.use);
  if (newBrands.length || sameBrands.length) v.append(h('div', { class: 'banner info' },
    newBrands.length ? h('div', {}, `New brand${newBrands.length > 1 ? 's' : ''} from your helper: ${newBrands.map(b => b.name).join(', ')} (added only if you import a car that uses it; shown under Needs review to check).`) : null,
    sameBrands.length ? h('div', {}, `Matched to your brands: ${sameBrands.map(b => `${b.name} → ${b.use}`).join(', ')}.`) : null));
  const STATUS = { new: ['New car', 'new'], possible: ['Might be one you have', 'warn'], duplicate: ['You already have this', 'have'], copy: ['Another copy of your car', 'have'], already: ['Already imported', 'muted'], missing: ["Its car isn't in your garage any more", 'muted'] };
  const list = h('div', { class: 'inboxlist' });
  const count = () => plan.rows.filter(r => r.choice !== 'skip').length;
  const goBtn = h('button', { type: 'button', class: 'wide' });
  const setGo = () => { const n = count(); goBtn.textContent = n ? `Import ${plural(n, 'car', 'cars')}` : 'Nothing chosen to import'; goBtn.disabled = !n || undefined; };
  for (const row of plan.rows) {
    const [label, cls] = STATUS[row.status];
    const m = row.model;
    const title = row.kind === 'copy' ? nameOf(row.target) : (m.display_name || m.product_code || '(no name yet)');
    const sub = [row.kind === 'copy' ? brandName(models.find(x => x.model_id === row.target)?.brand_id) : brandName(m.brand_id), row.kind === 'car' ? m.product_code : '', row.box, row.inventory.length > 1 ? `×${row.inventory.length}` : ''].filter(Boolean).join(' · ');
    const why = row.status === 'duplicate' ? `Same code as your ${nameOf(row.target)}.` : row.status === 'possible' ? `Like your ${nameOf(row.target)} (${row.dup.possible[0].reason}).` : row.status === 'copy' ? 'Your helper marked it as another copy.' : '';
    const chips = h('div', { class: 'chips' });
    const drawChips = () => {
      const opts = row.status === 'already' || row.status === 'missing' ? [] : row.kind === 'copy' ? [['copy', 'Add copy'], ['skip', 'Skip']]
        : [['new', 'Add as a new car'], ...(row.target ? [['copy', `Copy of your ${nameOf(row.target)}`]] : []), ['skip', 'Skip']];
      chips.replaceChildren(...opts.map(([k, t]) => h('button', { type: 'button', class: `chip ${row.choice === k ? 'on' : ''}`, 'aria-pressed': row.choice === k ? 'true' : 'false', onclick: () => { row.choice = k; drawChips(); setGo(); } }, t)));
    };
    drawChips();
    const img = thumbOf(row);
    list.append(h('div', { class: `card inboxrow ${row.status}` },
      h('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:nowrap' },
        img ? h('img', { src: img, alt: '', class: 'inboxthumb' }) : h('div', { class: 'inboxthumb none' }),
        h('div', { style: 'flex:1;min-width:0' }, h('b', {}, title), h('div', { class: 'muted small' }, sub), h('div', { class: `small st-${cls}`, style: 'font-weight:700;margin-top:2px' }, label), why ? h('div', { class: 'muted small' }, why) : null)),
      chips));
  }
  v.append(list);
  goBtn.onclick = async () => {
    goBtn.disabled = true; goBtn.textContent = 'Importing…';
    try {
      const out = applyPlan(plan);
      await store.importRecords(out.records);
      let pics = 0;
      for (const id of out.photoIds) for (const variant of PHOTO_VARIANTS) {
        const bytes = photoFiles.get(photoPath(id, variant));
        if (bytes) { await blobs.put(`${id}:${variant}`, new Blob([bytes], { type: 'image/jpeg' })); if (variant === 'original') pics++; }
      }
      const boxes = pkgs.map(p => boxTitle(p.manifest.box)).join(', ');
      for (const r of out.records.filter(x => x.entity === 'models' || x.entity === 'inventory')) await store.logChange(r.entity, r.data[r.entity === 'models' ? 'model_id' : 'inventory_id'], 'created', '', 'imported from helper', `helper box file: ${boxes}`);
      urls.forEach(u => URL.revokeObjectURL(u)); inboxState = null;
      toast(`Imported ✓ ${plural(out.cars, 'new car', 'new cars')}, ${plural(out.copies, 'copy', 'copies')}, ${plural(pics, 'photo', 'photos')} · syncing`, 4500);
      autoSyncSoon(); location.hash = '#/';
    } catch (e) { toast(`Import failed: ${e.message}. Nothing was lost; try again.`, 5000, 'bad'); setGo(); }
  };
  setGo();
  v.append(h('div', { class: 'savebar' }, goBtn), h('button', { type: 'button', class: 'ghost wide', style: 'margin-top:8px', onclick: () => { urls.forEach(u => URL.revokeObjectURL(u)); inboxState = null; route(); } }, 'Cancel'));
}

// ---------- start ----------
async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  requestPersistentStorage();
  await seedLocal();
  helperInfo = await meta.get('helper', null);
  // s1-0.57.0: combined photos become the default once, even if separate was picked during the trial
  try { if (!localStorage.getItem('smg.combineV1')) { localStorage.setItem('smg.aiCombine', '1'); localStorage.setItem('smg.combineV1', '1'); } } catch {}
  applyHelperLook();
  $('#status').addEventListener('click', () => { if (helperInfo) location.hash = '#/settings'; else runSync(true); });
  setInterval(refreshStatus, 30_000); // sign-in expiry has no event of its own
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { refreshStatus(); autoSyncSoon(); });
  window.addEventListener('offline', refreshStatus);
  store.onChange(refreshStatus);
  // The box in progress is kept as a draft (C5); only unsaved item-page edits need a warning here.
  window.addEventListener('beforeunload', (e) => { if (itemDirty()) { e.preventDefault(); e.returnValue = ''; } });
  await route();
}
start();
