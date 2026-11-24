// Scale Model Garage — Stage 1 (quick-capture slice, D22). Screens: Garage list · Add (quick capture) · Item · Settings.
import * as store from './store.js';
import { blobs, meta, requestPersistentStorage, storageEstimate } from './idb.js';
import { preparePhoto, pickPhoto } from './images.js';
import { liveScan, scanPhoto } from './barcode.js';
import { codeCmp, barcodeCmp, gtinCheckOk, assignNamespace, duplicateCheckStatus, checkDuplicate, searchMatch } from './rules.js';
import { SHOT_ROLES, CONDITIONS, SCHEMA_VERSION } from './schema.js';
import { syncNow, isSyncing } from './sync.js';
import { getClientId, setClientId, hasToken, signIn, tokenMinutesLeft, drive } from './google.js';
import { getConfig, seedLocal } from './setup.js';
import { newId } from './ids.js';
import { newTimer, touch, seconds } from './timing.js';
import { backupIfDue, backupNow, lastBackup } from './backup.js';
import { buildPrompt, parseAnswer, brandNote, PROMPT_VERSION, MAX_BATCH } from './ai.js';

export const APP_VERSION = 's1-0.7.0';
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
// Header pill (audit S1, S2): counts boxes, and says plainly when a sign-in is needed. Tap = sync.
async function refreshStatus() {
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
  pill.setAttribute('aria-label', `${txt}. Tap to sync.`);
  $('header.top').classList.toggle('compact', txt.length > 16); // e.g. "Sign in to sync · 3 boxes"
}

let lastSyncMsg = '';
async function runSync(interactive) {
  if (isSyncing()) return;
  const setMsg = (m) => { lastSyncMsg = m; const el = $('#syncMsg'); if (el) el.textContent = m; refreshStatus(); };
  try {
    const s = await syncNow({ interactive, progress: setMsg });
    setMsg(`Synced: ${s.photosUploaded} photo(s), ${s.rowsAppended} new row(s), ${s.rowsUpdated} update(s), ${s.pulled} pulled${s.conflicts ? `, ${s.conflicts} clash(es) to review` : ''}${s.errors.length ? `, ${s.errors.length} error(s) — will retry` : ''} · ${(s.ms / 1000).toFixed(1)} s`);
    if (interactive) toast(s.errors.length ? 'Synced with some errors — will retry' : 'Synced ✓', 1800, s.errors.length ? 'warn' : 'ok');
    // Daily/monthly sheet backup (D25) once a sync has succeeded; a failure here never affects the sync.
    try { const cfg = await getConfig(); if (cfg && !s.errors.length) { const b = await backupIfDue(cfg); if (b.daily || b.monthly) setMsg(`${lastSyncMsg} · backup made`); } }
    catch (e) { console.warn('backup', e); setMsg(`${lastSyncMsg} · backup failed: ${e.message}`); }
  } catch (e) {
    setMsg(e.message);
    if (interactive) toast(e.message, 3500, (e.retryable || e.status === 401) ? 'warn' : 'bad');
  }
  refreshStatus();
  // Re-draw lists after a sync, but never redraw a page the user is in the middle of editing (I1).
  if (location.hash.startsWith('#/item') ? !itemDirty() : (location.hash === '' || location.hash === '#/')) route();
}
let autoTimer = null;
function autoSyncSoon() { clearTimeout(autoTimer); autoTimer = setTimeout(() => { if (navigator.onLine && hasToken()) runSync(false); }, 2500); }

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
  const v = h('div');
  try {
    if (hash.startsWith('#/add')) await renderAdd(v);
    else if (hash.startsWith('#/run')) await renderRun(v);
    else if (hash.startsWith('#/name')) await renderName(v);
    else if (hash.startsWith('#/dash')) await renderDash(v);
    else if (hash.startsWith('#/item/')) await renderItem(v, decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('#/settings')) await renderSettings(v);
    else await renderGarage(v);
  } catch (e) {
    v.append(h('div', { class: 'banner bad' }, `Something went wrong: ${e.message}`));
    console.error(e);
  }
  updateNameBadge();
  if (token === routeSeq) {
    view().replaceChildren(v);
    if (prevHash !== hash) window.scrollTo(0, isGarage(hash) && prevHash?.startsWith('#/item/') ? garageScroll : 0);
  }
  refreshStatus();
}

// =====================================================================
// Garage list
// =====================================================================
let garageFilter = 'all', garageSearch = '';
let selectedPhoto = { model: null, id: null };

// Nameless boxes waiting, shown as a badge on the Name tab.
async function updateNameBadge() {
  try {
    const n = (await store.listRecords('models')).filter(r => !r.data.deleted_at && !String(r.data.display_name || '').trim()).length;
    const b = document.querySelector('#navname .badge');
    if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); }
  } catch { /* badge is a convenience only */ }
}

// Dashboard (B, 24 Nov: "get this dashboard up"). Counts are physical boxes (owned copies of
// models that aren't archived). Single-series bars: one hue, numbers in text colour, no legend.
function barList(rows, { onTap } = {}) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return h('div', { class: 'bars' }, rows.map(([label, n, key]) => h(onTap ? 'button' : 'div', { class: 'barrow', type: onTap ? 'button' : undefined, onclick: onTap ? () => onTap(key ?? label) : undefined, title: `${label}: ${n}` },
    h('span', { class: 'bl' }, label),
    h('span', { class: 'bt' }, h('span', { style: `width:${Math.max(2, Math.round((n / max) * 100))}%` })),
    h('span', { class: 'bn' }, n.toLocaleString('en-IN')))));
}
const tally = (items, keyOf) => { const m = new Map(); for (const it of items) { const k = keyOf(it); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); };
const topN = (entries, n) => entries.length <= n + 1 ? entries : [...entries.slice(0, n), ['Other', entries.slice(n).reduce((t, e) => t + e[1], 0), '__other']];

async function renderDash(v) {
  const [models, inventory, photos, ref] = await Promise.all([store.listRecords('models'), store.list('inventory'), store.list('photos'), refData()]);
  const brandName = Object.fromEntries(ref.brands.map(b => [b.brand_id, b.name]));
  const scaleLabel = Object.fromEntries(ref.scales.map(s => [s.scale_id, s.label]));
  const active = models.filter(r => !r.data.deleted_at);
  const byId = new Map(active.map(r => [r.id, r.data]));
  const copies = inventory.filter(i => i.ownership_status === 'Owned' && byId.has(i.model_id));
  const est = collectionEstimate();
  const pct = Math.min(100, Math.round((copies.length / est) * 100));
  const goGarage = (filter, search = '') => { garageFilter = filter; garageSearch = search; location.hash = '#/'; };

  v.append(h('div', { class: 'row' }, h('h2', {}, 'Dashboard'), h('div', { class: 'muted' }, 'on this phone')));
  if (!copies.length) {
    v.append(h('div', { class: 'card' }, h('p', {}, 'Nothing catalogued yet.'), h('a', { href: '#/run', class: 'btn wide' }, '📷 Start a photo run')));
    return;
  }
  // Headline
  const storage = copies.map(i => i.storage_location).filter(Boolean);
  v.append(h('div', { class: 'card hero' },
    h('div', { class: 'big' }, copies.length.toLocaleString('en-IN')),
    h('div', {}, `of about ${est.toLocaleString('en-IN')} boxes catalogued (${pct}%)`),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${pct}% catalogued` }, h('span', { style: `width:${Math.max(pct, 1)}%` })),
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

  // Pace: boxes added per day, last 7 days (from when each copy was created on this phone)
  const day = (d) => d.toISOString().slice(0, 10);
  const today = new Date(); const days = [];
  for (let k = 6; k >= 0; k--) { const d = new Date(today); d.setDate(d.getDate() - k); days.push(day(d)); }
  const perDay = days.map(d => [d, copies.filter(i => String(i.created_at || '').slice(0, 10) === d).length]);
  const week = perDay.reduce((t, x) => t + x[1], 0);
  const maxDay = Math.max(1, ...perDay.map(x => x[1]));
  const left = Math.max(0, est - copies.length);
  const activeDays = perDay.filter(x => x[1]).length;
  const perActiveDay = activeDays ? week / activeDays : 0;
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Last 7 days'),
    h('div', { class: 'cols', role: 'img', 'aria-label': perDay.map(([d, n]) => `${d}: ${n}`).join(', ') }, perDay.map(([d, n]) => h('div', { class: 'col', title: `${new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}: ${n}` },
      h('span', { class: 'cn' }, n ? String(n) : ''), h('span', { class: 'cb' }, h('span', { style: `height:${n ? Math.max(4, Math.round((n / maxDay) * 100)) : 0}%` })),
      h('span', { class: 'cd' }, new Date(d).toLocaleDateString('en-IN', { weekday: 'narrow' }))))),
    h('p', { class: 'muted' }, week ? `${plural(week, 'box', 'boxes')} this week${perActiveDay && left ? ` · at ${Math.round(perActiveDay)} a session, about ${Math.ceil(left / perActiveDay)} more sessions for the rest (rough estimate)` : ''}` : 'No boxes added this week.')));

  // By brand, by scale
  v.append(h('div', { class: 'card' }, h('h3', {}, 'By brand'),
    barList(topN(tally(copies, i => brandName[byId.get(i.model_id).brand_id] || 'Brand not set'), 8), { onTap: (k) => { if (k !== '__other') goGarage('all', k); } })));
  v.append(h('div', { class: 'card' }, h('h3', {}, 'By scale'),
    barList(tally(copies, i => scaleLabel[byId.get(i.model_id).scale_id] || 'Scale not set'), { onTap: (k) => goGarage('all', k) })));

  // Storage boxes: one tile per numbered box, in number order
  const boxes = tally(copies, i => i.storage_location || '').filter(([k]) => k).sort((a, b) => (parseInt(a[0].replace(/\D/g, ''), 10) || 0) - (parseInt(b[0].replace(/\D/g, ''), 10) || 0));
  const noBox = copies.filter(i => !i.storage_location).length;
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Storage boxes'),
    boxes.length ? h('div', { class: 'boxgrid' }, boxes.map(([k, n]) => h('button', { type: 'button', class: 'boxtile', onclick: () => goGarage('box', k) }, h('b', {}, k.replace(/^Box\s*/i, '')), h('span', {}, plural(n, 'model', 'models'))))) : h('p', { class: 'muted' }, 'No storage boxes recorded yet.'),
    noBox ? h('p', { class: 'muted' }, `${plural(noBox, 'box has', 'boxes have')} no storage box yet.`) : null));

  // Box state (sealed / opened / loose), when recorded
  const states = tally(copies.filter(i => i.packaging_state), i => ({ sealed: 'Sealed', opened: 'Opened', loose: 'Loose' }[i.packaging_state] || i.packaging_state));
  if (states.length) v.append(h('div', { class: 'card' }, h('h3', {}, 'Box state'), barList(states)));
}

async function renderGarage(v) {
  const config = await getConfig();
  if (!getClientId() || !config) {
    v.append(h('div', { class: 'banner info' }, 'Welcome! Start in ', h('a', { href: '#/settings' }, 'Settings'), ': sign in with Google once, and the app sets up your SCALE GARAGE folder and sheet. You can also start capturing offline right away.'));
  }
  const [models, inventory, photos, ids, ref] = await Promise.all([store.listRecords('models'), store.list('inventory'), store.list('photos'), store.list('product_identifiers'), refData()]);
  const brandName = Object.fromEntries(ref.brands.map(b => [b.brand_id, b.name]));
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
    h('div', { class: 'ovtext' }, h('b', {}, `${copies.length} of about ${est.toLocaleString('en-IN')}`), ' boxes catalogued', boxesUsed ? ` · ${plural(boxesUsed, 'storage box', 'storage boxes')} in use` : ''),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${pct}% catalogued` }, h('span', { style: `width:${Math.max(pct, copies.length ? 1 : 0)}%` }))));
  const nameless = active.filter(r => !String(r.data.display_name || '').trim()).length;
  if (nameless) v.append(h('a', { href: '#/name', class: 'btn quiet wide', style: 'margin-bottom:10px' }, `✎ ${plural(nameless, 'box needs', 'boxes need')} a name: name them`));
  const search = h('input', { type: 'search', placeholder: 'Search name, code, barcode, brand, scale…', value: garageSearch, oninput: (e) => { garageSearch = e.target.value; draw(); } });
  v.append(search);
  const photosByModel = new Map();
  photos.forEach(p => { if (p.model_id) (photosByModel.get(p.model_id) || photosByModel.set(p.model_id, []).get(p.model_id)).push(p); });
  const isPending = (r) => r.dirty || (photosByModel.get(r.data.model_id) || []).some(p => !p.original_file_id);
  // One scrolling row of filters (audit G5); a filter only appears when it has something in it.
  const n = { noname: active.filter(r => !String(r.data.display_name || '').trim()).length, review: active.filter(r => r.data.namespace_status === 'needs_review').length, pending: active.filter(isPending).length, clash: active.filter(r => r.conflict).length, archived: archived.length };
  if (n[garageFilter] === 0) garageFilter = 'all'; // e.g. after restoring the last archived model, don't leave an empty list
  const filters = [['all', 'All'], ['box', 'By box'], ['quick', 'Quick'], ['noname', `Needs a name (${n.noname})`, n.noname], ['review', `Needs review (${n.review})`, n.review], ['pending', `Waiting to sync (${n.pending})`, n.pending], ['clash', `Clashes (${n.clash})`, n.clash], ['archived', `Archived (${n.archived})`, n.archived]]
    .filter(([k, , c]) => c === undefined || c > 0 || garageFilter === k);
  const chips = h('div', { class: 'chips scroll', style: 'margin:10px 0' }, filters.map(([k, label]) => h('button', { class: `chip ${garageFilter === k ? 'on' : ''}`, onclick: () => { garageFilter = k; route(); } }, label)));
  v.append(chips);
  const grid = h('div', { class: 'grid' });
  v.append(grid);
  const storageByModel = new Map();
  inventory.forEach(i => { if (i.storage_location) storageByModel.set(i.model_id, `${storageByModel.get(i.model_id) || ''} ${i.storage_location}`); });
  const barcodesByModel = new Map();
  ids.forEach(i => { if (i.identifier_type === 'barcode') (barcodesByModel.get(i.model_id) || barcodesByModel.set(i.model_id, []).get(i.model_id)).push(i.value_raw, i.value_cmp); });

  async function draw() {
    grid.replaceChildren();
    const q = garageSearch.trim().toLowerCase();
    let list = (garageFilter === 'archived' ? archived : active).slice().sort((a, b) => String(b.data.created_at).localeCompare(String(a.data.created_at)));
    list = list.filter(r => {
      const m = r.data;
      if (garageFilter === 'quick' && m.completeness_status !== 'quick') return false;
      if (garageFilter === 'noname' && String(m.display_name || '').trim()) return false;
      if (garageFilter === 'review' && m.namespace_status !== 'needs_review') return false;
      if (garageFilter === 'pending' && !isPending(r)) return false;
      if (garageFilter === 'clash' && !r.conflict) return false;
      if (!q) return true;
      // "box 3" (typed, or a tap on the Dashboard) means exactly storage Box 3, not Box 30 or scale 1:43
      const boxQ = q.match(/^box\s*([a-z0-9-]+)$/i);
      if (boxQ) return String(storageByModel.get(m.model_id) || '').toLowerCase().split(/\s+(?=box)/).some(loc => loc.trim().replace(/^box\s*/, '') === boxQ[1]);
      const hay = [m.display_name, m.product_code, brandName[m.brand_id], m.printed_brand_text, scaleLabel[m.scale_id], m.variant, m.series, m.notes, storageByModel.get(m.model_id), ...(barcodesByModel.get(m.model_id) || [])].filter(Boolean).join(' ');
      return searchMatch(q, hay);
    });
    if (!list.length) { grid.append(h('p', { class: 'muted' }, active.length || archived.length ? 'Nothing matches.' : 'No models yet. Tap ＋ Add to catalogue your first box.')); return; }
    // "By box": grouped under each storage box, in box-number order; models without a box last.
    const boxesOf = (mid) => [...new Set(inventory.filter(i => i.model_id === mid && i.ownership_status === 'Owned').map(i => i.storage_location).filter(Boolean))];
    let lastGroup = null;
    if (garageFilter === 'box') {
      const key = (r) => boxesOf(r.data.model_id)[0] || '';
      const num = (k) => { const n = k.match(/\d+/); return n ? Number(n[0]) : Infinity; };
      list.sort((a, b) => { const ka = key(a), kb = key(b); if (!ka !== !kb) return ka ? -1 : 1; return num(ka) - num(kb) || ka.localeCompare(kb) || String(b.data.created_at).localeCompare(String(a.data.created_at)); });
    }
    const groupCount = (k) => list.filter(r => (boxesOf(r.data.model_id)[0] || '') === k).length;
    for (const r of list.slice(0, 300)) {
      const m = r.data;
      if (garageFilter === 'box') {
        const g = boxesOf(m.model_id)[0] || '';
        if (g !== lastGroup) { lastGroup = g; grid.append(h('h3', { class: 'group' }, `${g || 'No box yet'} · ${plural(groupCount(g), 'model', 'models')}`)); }
      }
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
            ...boxesOf(m.model_id).slice(0, 2).map(bx => h('span', { class: 'b box' }, bx)),
            m.completeness_status === 'complete' ? h('span', { class: 'b ok' }, 'Complete') : null, // "Quick" is the normal case, so no badge (G6)
            m.deleted_at ? h('span', { class: 'b mute' }, 'Archived') : null,
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
    if (!p.draftStored) { for (const v of DRAFT_VARIANTS) await blobs.put(`draft:${p.photoId}:${v}`, p.prep[v]); p.draftStored = true; }
    photos[role] = { photoId: p.photoId, capturedAt: p.capturedAt, info: Object.fromEntries(PHOTO_INFO.map(k => [k, p.prep[k]])) };
  }
  const { modelId, inventoryId, sealed, brandId, scaleId, box, barcode, name, code, count, timer } = cap;
  await meta.set(DRAFT_KEY, { modelId, inventoryId, sealed, brandId, scaleId, box, barcode, name, code, count, timer, photos });
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
  v.append(h('a', { href: '#/run', class: 'btn quiet wide', style: 'margin:4px 0 6px' }, '⚡ Photo run: photos now, names later'));

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
  const brandSel = h('select', { onchange: async (e) => {
    if (e.target.value === '__new') {
      const name = (prompt('New brand name (as printed on the box):') || '').trim();
      if (name) {
        const existing = ref.brands.find(b => b.name.toLowerCase() === name.toLowerCase());
        cap.brandId = existing ? existing.brand_id : (await store.create('brands', { name, brand_kind: 'miniature', is_code_namespace: 'yes', record_status: 'needs_review' })).brand_id;
      }
    } else cap.brandId = e.target.value;
    capTouch(); saveDraftSoon();
    route();
  } }, h('option', { value: '' }, '— choose brand —'), ref.brands.map(b => h('option', { value: b.brand_id, selected: b.brand_id === cap.brandId ? true : undefined }, b.name + (b.record_status === 'needs_review' ? ' (needs review)' : ''))), h('option', { value: '__new' }, '＋ Add a new brand…'));
  v.append(brandSel);

  // --- Scale ---
  v.append(h('label', { class: 'f' }, 'Scale'));
  const main = ['1:64', '1:43', '1:18', '1:12'];
  const scaleChips = h('div', { class: 'chips' }, ref.scales.filter(s => main.includes(s.label)).map(s => h('button', { type: 'button', class: `chip ${cap.scaleId === s.scale_id ? 'on' : ''}`, onclick: () => { cap.scaleId = s.scale_id; localStorage.setItem('smg.lastScale', s.scale_id); capTouch(); saveDraftSoon(); route(); } }, s.label)));
  const more = h('select', { style: 'flex:1;min-width:140px', onchange: (e) => { if (e.target.value) { cap.scaleId = e.target.value; localStorage.setItem('smg.lastScale', e.target.value); capTouch(); saveDraftSoon(); route(); } } },
    h('option', { value: '' }, 'Other scale…'), ref.scales.filter(s => !main.includes(s.label)).map(s => h('option', { value: s.scale_id, selected: s.scale_id === cap.scaleId ? true : undefined }, s.label)));
  scaleChips.append(more);
  v.append(scaleChips);

  // --- Storage box (optional, remembered; "Box full" moves to the next number) ---
  v.append(h('label', { class: 'f' }, 'Storage box (optional)'));
  const setBox = (b) => { cap.box = String(b).trim(); localStorage.setItem('smg.lastBox', cap.box); capTouch(); saveDraftSoon(); };
  const boxRow = h('div', { class: 'row' }, h('input', { class: 'boxin', inputmode: 'text', placeholder: 'Box number, e.g. 12', value: cap.box, 'aria-label': 'Storage box number', oninput: (e) => setBox(e.target.value) }));
  if (/^\d+$/.test(cap.box)) boxRow.append(h('button', { type: 'button', class: 'quiet', style: 'flex:0 0 auto', onclick: () => { setBox(Number(cap.box) + 1); toast(`Now filling Box ${cap.box}`); route(); } }, `Box full → ${Number(cap.box) + 1}`));
  v.append(boxRow);

  // --- Barcode ---
  v.append(h('label', { class: 'f' }, 'Barcode (if the box has one)'));
  const bcInfo = h('div', { class: 'muted' });
  const bcInput = h('input', { inputmode: 'numeric', placeholder: 'Scan, or type the digits', value: cap.barcode?.raw || '', oninput: (e) => { setBarcode(e.target.value, 'typed', ''); updateBc(); updateDup(); } });
  const video = h('video', { class: 'scan hide', playsinline: true, muted: true });
  const scanBtn = h('button', { type: 'button', class: 'quiet', onclick: () => { capTouch(); doLiveScan(); } }, '▦ Scan barcode');
  const photoBtn = h('button', { type: 'button', class: 'quiet hide', onclick: () => doPhotoScan() }, '📷 Take photo instead');
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
    else { bcInfo.textContent = b.source === 'scan' ? `✓ Scanned ${b.format || ''}` : b.source === 'rear_photo' ? '✓ Read from the box rear photo. Check it matches the box.' : (b.checkOk ? '✓ Check digit OK' : ''); bcInfo.style.color = 'var(--ok)'; }
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
  const missing = [!cap.photos.box_front && 'box front photo', !cap.photos.box_rear && 'box rear photo', !cap.brandId && 'brand', !cap.scaleId && 'scale'].filter(Boolean);
  v.append(h('div', { class: 'savebar' },
    h('div', { class: 'need' }, missing.length ? `Still needed: ${missing.join(', ')}` : 'Ready to save'),
    h('button', { class: 'save', disabled: missing.length ? true : undefined, onclick: () => saveCapture() }, 'Save & next box')));
  v.append(h('button', { class: 'wide ghost', style: 'margin-top:8px', onclick: async () => { if (confirm('Discard this box?')) { await clearDraft(); cap = freshCapture({ brandId: cap.brandId, scaleId: cap.scaleId, count: cap.count }); route(); } } }, 'Discard'));

  async function takePhoto(role) {
    if (await takeCapPhoto(role, (t) => { busy.textContent = t; })) route();
  }
}

// One photo for the box in progress (shared by Quick capture and Photo run). Returns true when a photo was added.
async function takeCapPhoto(role, say = () => {}) {
  capTouch();
  const [f] = await pickPhoto({ camera: true });
  if (!f) return false;
  capTouch();
  say('Preparing photo…');
  try {
    const prep = await preparePhoto(f);
    const old = cap.photos[role];
    if (old?.url) URL.revokeObjectURL(old.url);
    if (old?.draftStored) await dropDraftPhoto(old.photoId);
    cap.photos[role] = { photoId: newId('photos'), prep, url: URL.createObjectURL(prep.thumb), capturedAt: new Date().toISOString() };
    // The rear of the box usually carries the barcode: try to read it from the photo just taken (audit C2).
    // A scanned or typed barcode is never overwritten.
    if (role === 'box_rear' && (!cap.barcode || cap.barcode.source === 'rear_photo')) {
      say('Looking for a barcode in the photo…');
      try {
        const r = await scanPhoto(f);
        if (r) { const raw = String(r.value).trim(); cap.barcode = { raw, cmp: barcodeCmp(raw), format: r.format, source: 'rear_photo', checkOk: gtinCheckOk(raw) }; }
      } catch (e) { console.warn('barcode from rear photo:', e); }
    }
    await saveDraft();
    return true;
  } catch (e) { say(`Could not read that photo: ${e.message}`); return false; }
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
  const ref = await refData();
  const brand = ref.brands.find(b => b.brand_id === cap.brandId);
  const scale = ref.scales.find(x => x.scale_id === cap.scaleId);
  v.append(h('div', { class: 'row' }, h('h2', {}, 'Photo run'), h('a', { href: '#/add', class: 'btn ghost small', style: 'flex:0 0 auto' }, 'One box at a time')));
  v.append(h('p', { class: 'muted' }, 'Photos now, names later. Set these once; each box saves itself after its photos.'));

  // --- run settings ---
  const set = h('div', { class: 'card runset' });
  const recent = recentBrands().map(id => ref.brands.find(b => b.brand_id === id)).filter(Boolean);
  set.append(h('label', { class: 'f' }, 'Brand'));
  if (recent.length) set.append(h('div', { class: 'chips', style: 'margin-bottom:6px' }, recent.map(b => h('button', { type: 'button', class: `chip ${cap.brandId === b.brand_id ? 'on' : ''}`, onclick: () => { cap.brandId = b.brand_id; pushRecentBrand(b.brand_id); saveDraftSoon(); route(); } }, b.name))));
  set.append(h('select', { 'aria-label': 'Brand', onchange: (e) => { cap.brandId = e.target.value; if (cap.brandId) pushRecentBrand(cap.brandId); saveDraftSoon(); route(); } },
    h('option', { value: '' }, '— choose brand —'), ref.brands.map(b => h('option', { value: b.brand_id, selected: b.brand_id === cap.brandId ? true : undefined }, b.name))));
  set.append(h('label', { class: 'f' }, 'Scale'));
  set.append(h('div', { class: 'chips' }, ref.scales.filter(x => ['1:64', '1:43', '1:18', '1:12'].includes(x.label)).map(x => h('button', { type: 'button', class: `chip ${cap.scaleId === x.scale_id ? 'on' : ''}`, onclick: () => { cap.scaleId = x.scale_id; localStorage.setItem('smg.lastScale', x.scale_id); saveDraftSoon(); route(); } }, x.label))));
  set.append(h('label', { class: 'f' }, 'Storage box'));
  const setBox = (b) => { cap.box = String(b).trim(); localStorage.setItem('smg.lastBox', cap.box); saveDraftSoon(); };
  const boxRow = h('div', { class: 'row' }, h('input', { class: 'boxin', placeholder: 'Box number, e.g. 12', value: cap.box, 'aria-label': 'Storage box number', oninput: (e) => setBox(e.target.value) }));
  if (/^\d+$/.test(cap.box)) boxRow.append(h('button', { type: 'button', class: 'quiet', style: 'flex:0 0 auto', onclick: () => { setBox(Number(cap.box) + 1); toast(`Now filling Box ${cap.box}`); route(); } }, `Box full → ${Number(cap.box) + 1}`));
  set.append(boxRow);
  const setSealed = (yes) => { cap.sealed = yes; localStorage.setItem('smg.lastSealed', yes ? 'yes' : 'no'); saveDraftSoon(); route(); };
  set.append(h('div', { class: 'chips', style: 'margin-top:10px' },
    h('button', { type: 'button', class: `chip ${cap.sealed ? 'on' : ''}`, 'aria-pressed': cap.sealed ? 'true' : 'false', onclick: () => setSealed(true) }, 'Sealed box'),
    h('button', { type: 'button', class: `chip ${cap.sealed ? '' : 'on'}`, 'aria-pressed': cap.sealed ? 'false' : 'true', onclick: () => setSealed(false) }, 'Car visible')));
  // Once brand and scale are set, the settings fold into one line so the camera button stays at the top.
  if (brand && scale && !runSetOpen) {
    v.append(h('div', { class: 'runsum' },
      h('div', {}, h('b', {}, `${brand.name} · ${scale.label}`), ` · ${cap.box ? `Box ${cap.box}` : 'no storage box'} · ${cap.sealed ? 'Sealed' : 'Car visible'}`),
      ...(/^\d+$/.test(cap.box) ? [h('button', { type: 'button', class: 'small quiet', onclick: () => { setBox(Number(cap.box) + 1); toast(`Now filling Box ${cap.box}`); route(); } }, `Box full → ${Number(cap.box) + 1}`)] : []),
      h('button', { type: 'button', class: 'small ghost', onclick: () => { runSetOpen = true; route(); } }, 'Change')));
  } else {
    v.append(set);
    if (brand && scale) v.append(h('button', { class: 'wide', style: 'margin-bottom:8px', onclick: () => { runSetOpen = false; route(); } }, 'Done: start shooting'));
  }
  if (!brand || !scale) { v.append(h('div', { class: 'banner info' }, 'Choose a brand and a scale for this run to start.')); return; }

  // --- the box in progress ---
  const steps = ['box_front', 'box_rear', ...(cap.sealed && !cap.artSkipped ? ['box_art'] : [])];
  const next = steps.find(r => !cap.photos[r]);
  const say = h('p', { class: 'muted', id: 'runSay' });
  v.append(h('div', { class: 'runhead' }, h('b', {}, `Box ${cap.count + 1} of this run`), ` · ${brand.name} · ${scale.label}${cap.box ? ` · Box ${cap.box}` : ''}`));
  const strip = h('div', { class: 'shots' });
  for (const role of ['box_front', 'box_rear', ...(cap.sealed ? ['box_art'] : [])]) {
    const p = cap.photos[role];
    strip.append(h('div', { class: `shot ${p ? 'done' : ''} ${role === next ? 'nextshot' : ''}` }, p?.url ? h('img', { src: p.url, alt: '' }) : h('span', {}, SHOT_ROLES[role].label), p ? h('span', { class: 'tag' }, `${SHOT_ROLES[role].label} ✓`) : null));
  }
  v.append(strip);
  if (cap.barcode) v.append(h('p', { class: 'muted' }, `Barcode ${cap.barcode.raw} (read from the rear photo)`));
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
      h('button', { type: 'button', class: 'ghost', onclick: async () => { cap.runDecision = null; for (const r of Object.keys(cap.photos)) await dropDraftPhoto(cap.photos[r].photoId); cap.photos = {}; cap.barcode = null; cap.artSkipped = false; await saveDraft(); route(); } }, 'Retake this box')));
    v.append(box);
  } else if (next) {
    v.append(h('button', { class: 'wide runshot', onclick: async () => { runSetOpen = false; if (await takeCapPhoto(next, (t) => { say.textContent = t; })) await afterRunPhoto(); } }, `📷 ${SHOT_ROLES[next].label}`));
    if (next === 'box_art') v.append(h('button', { class: 'wide ghost', style: 'margin-top:8px', onclick: async () => { cap.artSkipped = true; await afterRunPhoto(); } }, 'Skip box art'));
  } else {
    v.append(h('button', { class: 'wide', onclick: () => afterRunPhoto() }, 'Save this box'));
  }
  if (runLast) v.append(h('button', { class: 'wide ghost', style: 'margin-top:10px', onclick: async () => {
    if (!confirm(`Undo the last box (${runLast.label})? It is archived, not deleted, and can be restored from Garage → Archived.`)) return;
    await store.archive('models', runLast.id); toast('Last box undone (archived)'); runLast = null; route(); autoSyncSoon();
  } }, `Undo last box (${runLast.label})`));
  v.append(h('p', { class: 'muted', style: 'margin-top:14px' }, h('a', { href: '#/name' }, 'Name the boxes from this run →')));

  async function afterRunPhoto() {
    const need = ['box_front', 'box_rear', ...(cap.sealed && !cap.artSkipped ? ['box_art'] : [])];
    if (need.some(r => !cap.photos[r])) { route(); return; }
    const [models, ids] = await Promise.all([store.list('models'), store.list('product_identifiers')]);
    const ns = assignNamespace(brand, null);
    const r = checkDuplicate({ model_id: cap.modelId, brand_id: cap.brandId, code_namespace_id: ns.id, namespace_status: ns.status, product_code: '', display_name: '' }, models, ids, cap.barcode ? [cap.barcode.cmp] : []);
    if (r.possible.length) { cap.runDecision = r.possible; route(); return; }
    await saveRunBox();
  }
}
async function saveRunBox() {
  const label = `run box ${cap.count + 1}`;
  const id = cap.modelId;
  await saveCapture();
  if (await store.get('models', id)) runLast = { id, label };
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
const aiState = async () => ({ batch: await meta.get('aiBatch', null), sugg: await meta.get('aiSuggest', {}) });
async function photoFileFor(p, name) {
  let b = await blobs.get(`${p.photo_id}:display`);
  if (!b && p.display_file_id && navigator.onLine && hasToken()) { try { b = await drive.download(p.display_file_id); } catch (e) { console.warn('display download', e.message); } }
  if (!b) b = await blobs.get(`${p.photo_id}:thumb`);
  return b ? new File([b], name, { type: 'image/jpeg' }) : null;
}
async function prepareAiBatch(todo, ref) {
  const pick = todo.slice(0, MAX_BATCH);
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
    files.push(ff, rf || ff); photoIds.push(front.photo_id, (rf ? rear : front).photo_id); ids.push(m.model_id);
    boxes.push({ brand: ref.brands.find(b => b.brand_id === m.brand_id)?.name, scale: ref.scales.find(x => x.scale_id === m.scale_id)?.label });
  }
  return { batchId: newId('ai_log'), ids, files, photoIds, prompt: buildPrompt(boxes) };
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

async function renderName(v) {
  const ref = await refData();
  const [models, inv, ids] = await Promise.all([store.list('models'), store.list('inventory'), store.list('product_identifiers')]);
  const todo = models.filter(m => !String(m.display_name || '').trim()).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  v.append(h('div', { class: 'row' }, h('h2', {}, 'Name them'), h('div', { class: 'muted', style: 'text-align:right' }, todo.length ? `${plural(todo.length, 'box needs', 'boxes need')} a name` : '')));
  if (!todo.length) { nameSkipped.clear(); v.append(h('div', { class: 'banner ok' }, 'Every box has a name ✓'), h('p', {}, h('a', { href: '#/' }, '← Garage'))); return; }

  // --- AI panel: prepare → share → paste answer ---
  const { batch, sugg } = await aiState();
  const aiCard = h('div', { class: 'card aicard' }, h('h3', {}, '✨ Names from Gemini or Claude'));
  const nSugg = todo.filter(x => sugg[x.model_id]).length;
  if (batch) {
    const ta = h('textarea', { placeholder: 'Paste the whole answer here', 'aria-label': 'AI answer' });
    aiCard.append(h('p', { class: 'muted' }, `Waiting for the answer for ${plural(batch.ids.length, 'box', 'boxes')}. In Gemini or Claude, copy the whole reply, then paste it here.`), ta,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'quiet', onclick: async () => { try { ta.value = await navigator.clipboard.readText(); } catch { toast('Long-press the box above and choose Paste', 3500, 'warn'); } } }, 'Paste from clipboard'),
        h('button', { type: 'button', onclick: async () => {
          const r = parseAnswer(ta.value, batch.ids.length);
          if (!r.items.length) { toast('No answer lines found. It should look like: Box 1 | name | code | brand', 4500, 'warn'); return; }
          const next = { ...(await meta.get('aiSuggest', {})) };
          for (const it of r.items) next[batch.ids[it.n - 1]] = { name: it.name, code: it.code, brand: it.brand, notes: it.notes, logId: batch.logId };
          await meta.set('aiSuggest', next);
          await store.update('ai_log', batch.logId, { ai_response_raw: ta.value.slice(0, 5000), suggested_values: JSON.stringify(r.items.map(it => ({ model_id: batch.ids[it.n - 1], name: it.name, code: it.code, brand: it.brand }))), processed_at: store.nowIso() });
          await meta.set('aiBatch', null);
          toast(`Suggestions for ${r.items.length} of ${plural(batch.ids.length, 'box', 'boxes')}: check each one`, 3500); route(); autoSyncSoon();
        } }, 'Use this answer')),
      h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: async () => { await meta.set('aiBatch', null); route(); } }, 'Cancel'));
  } else if (aiPrep) {
    const canFiles = !!(navigator.canShare && navigator.canShare({ files: aiPrep.files }));
    aiCard.append(h('p', { class: 'muted' }, `${plural(aiPrep.ids.length, 'box', 'boxes')}, ${aiPrep.files.length} photos ready (copies without location data).`),
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
        const log = await store.create('ai_log', { ai_log_id: aiPrep.batchId, capture_session_id: aiPrep.batchId, ai_tool: 'gemini_or_claude_app (copy-paste)', prompt_version: PROMPT_VERSION, input_photo_ids: aiPrep.photoIds.join(','), processed_at: store.nowIso() });
        await meta.set('aiBatch', { logId: log.ai_log_id, ids: aiPrep.ids });
        aiPrep = null; toast(copied ? 'Shared ✓ If the instructions are missing, paste them (already copied).' : 'Shared', 4000); route();
      } }, canFiles ? 'Share to Gemini or Claude' : 'Copy instructions and get the photos'),
      h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: async () => { toast(await copyText(aiPrep.prompt) ? 'Instructions copied' : 'Could not copy', 2000); } }, 'Copy the instructions only'),
      h('button', { type: 'button', class: 'ghost small', style: 'margin-top:8px', onclick: () => { aiPrep = null; route(); } }, 'Cancel'));
  } else {
    aiCard.append(h('p', { class: 'muted' }, nSugg ? `${plural(nSugg, 'box has', 'boxes have')} an AI suggestion waiting below.` : 'Send box photos to your Gemini or Claude app and paste the answer back. You check every name before it is saved.'),
      h('button', { type: 'button', class: 'quiet wide', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Preparing photos…';
        aiPrep = await prepareAiBatch(todo.filter(x => !sugg[x.model_id]), ref);
        if (!aiPrep.ids.length) { aiPrep = null; toast('No photos found to send', 3000, 'warn'); }
        route();
      } }, `Get names for the next ${Math.min(MAX_BATCH, todo.filter(x => !sugg[x.model_id]).length) || 0} boxes`));
  }
  v.append(aiCard);

  let m = todo.find(x => !nameSkipped.has(x.model_id));
  if (!m) { nameSkipped.clear(); m = todo[0]; }
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
      ...[...(sg.notes || []), note, codeNote].filter(Boolean).map(t => h('div', { class: 'muted' }, t))));
  }
  const nameIn = h('input', { placeholder: 'e.g. Nissan Skyline GT-R R34', 'aria-label': 'Name', autocapitalize: 'words', value: sg?.name || '' });
  const codeIn = h('input', { placeholder: brand?.code_example ? `e.g. ${brand.code_example}` : 'Exactly as printed', autocapitalize: 'characters', 'aria-label': 'Product code', value: m.product_code || sg?.code || '' });
  v.append(h('label', { class: 'f' }, 'Name'), nameIn, h('label', { class: 'f' }, 'Product code (optional)'), codeIn);
  const save = async () => {
    const name = nameIn.value.trim(), code = codeIn.value.trim();
    if (!name) { toast('Type a name, or tap Skip', 2500, 'warn'); return; }
    const ns = assignNamespace(brand, null);
    const patch = { display_name: name, product_code: code, product_code_cmp: codeCmp(code), code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status };
    patch.duplicate_check_status = duplicateCheckStatus(patch);
    if (code !== (m.product_code || '')) await store.logChange('models', m.model_id, 'product_code', m.product_code, code, 'named in app');
    if (code) {
      const r = checkDuplicate({ ...m, ...patch }, models, ids, []);
      if (r.status === 'duplicate') toast(`Same code as "${r.exact[0].display_name || r.exact[0].product_code}". Check both in the Garage.`, 5000, 'warn');
    }
    if (sg) {
      // Record what B confirmed against what the AI suggested (AI_LOG, security doc §2.4).
      patch.identification_status = 'confirmed';
      const log = await store.get('ai_log', sg.logId);
      if (log) { let c = {}; try { c = JSON.parse(log.confirmed_values || '{}'); } catch { c = {}; } c[m.model_id] = { name, code, edited: name !== sg.name || code !== sg.code }; await store.update('ai_log', sg.logId, { confirmed_values: JSON.stringify(c) }); }
      const rest = { ...(await meta.get('aiSuggest', {})) }; delete rest[m.model_id]; await meta.set('aiSuggest', rest);
    }
    await store.update('models', m.model_id, patch);
    toast('Named ✓'); route(); autoSyncSoon();
  };
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); codeIn.focus(); } });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  v.append(h('div', { class: 'savebar' },
    h('button', { type: 'button', class: 'ghost', onclick: () => { nameSkipped.add(m.model_id); route(); } }, 'Skip'),
    h('div', { class: 'need' }, h('a', { href: `#/item/${encodeURIComponent(m.model_id)}` }, 'Open full page')),
    h('button', { class: 'save', onclick: save }, 'Save & next')));
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
    { entity: 'inventory', fields: { inventory_id: cap.inventoryId, model_id: cap.modelId, ownership_status: 'Owned', packaging_state: cap.sealed ? 'sealed' : 'unknown', storage_location: boxLoc(cap.box), acquisition_type: 'Unknown', purchase_date_precision: 'unknown', currency: 'INR' } },
    ...(await savePhotoRecords(cap.modelId, photosToSave()))];
  if (cap.barcode) items.push({ entity: 'product_identifiers', fields: { model_id: cap.modelId, identifier_type: 'barcode', value_raw: cap.barcode.raw, value_cmp: cap.barcode.cmp, barcode_format: cap.barcode.format || '', check_digit_ok: cap.barcode.checkOk === null ? '' : (cap.barcode.checkOk ? 'yes' : 'no'), source: cap.barcode.source } });
  try { await store.createMany(items); }
  catch (e) { toast(`Not saved: ${e.message}. Your box is kept here; try again.`, 5000, 'bad'); return; }
  pushRecentBrand(cap.brandId);
  const secs = seconds(touch(cap.timer));
  await logTiming(secs);
  await clearDraft();
  cap = freshCapture({ brandId: cap.brandId, scaleId: cap.scaleId, count: cap.count + 1 });
  toast(`Saved ✓ (${secs} s)${cap.box ? ` · Box ${cap.box}` : ''} — next box`);
  window.scrollTo(0, 0);
  route();
  autoSyncSoon();
}

async function saveCopyOf(m) {
  // This box's photos are attached to the new physical copy (never made the product's main photo).
  const items = [{ entity: 'inventory', fields: { inventory_id: cap.inventoryId, model_id: m.model_id, ownership_status: 'Owned', packaging_state: cap.sealed ? 'sealed' : 'unknown', storage_location: boxLoc(cap.box), acquisition_type: 'Unknown', purchase_date_precision: 'unknown', currency: 'INR' } },
    ...(await savePhotoRecords(m.model_id, photosToSave())).map(it => ({ ...it, fields: { ...it.fields, inventory_id: cap.inventoryId, is_primary: 'no' } }))];
  try { await store.createMany(items); }
  catch (e) { toast(`Not saved: ${e.message}. Your box is kept here; try again.`, 5000, 'bad'); return; }
  const secs = seconds(touch(cap.timer));
  await logTiming(secs);
  await clearDraft();
  cap = freshCapture({ brandId: cap.brandId, scaleId: cap.scaleId, count: cap.count + 1 });
  toast(`Added as another copy ✓ (${secs} s)`);
  window.scrollTo(0, 0);
  route(); autoSyncSoon();
}

// Capture times are kept under a new key: times recorded by s1-0.1.x counted idle time (audit C4).
const TIMES_KEY = 'captureTimesV2';
async function logTiming(secs) {
  const t = await meta.get(TIMES_KEY, []);
  t.push(secs); await meta.set(TIMES_KEY, t.slice(-500));
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
  v.append(h('a', { href: '#/', class: 'back' }, '← Garage'));
  v.append(h('h2', {}, m.display_name || '(no name yet)'));
  if (m.deleted_at) v.append(h('div', { class: 'banner warn' }, h('div', { class: 'hd' }, 'Archived: hidden from your garage.'),
    h('button', { type: 'button', class: 'small', style: 'margin-top:8px', onclick: restore }, 'Restore to garage')));
  async function restore() { await store.update('models', modelId, { deleted_at: '' }); await store.logChange('models', modelId, 'deleted_at', m.deleted_at, '', 'restored in app'); toast('Restored ✓'); route(); autoSyncSoon(); }
  if (rec.conflict) renderConflict(v, rec);
  if (rec.lastError) v.append(h('div', { class: 'banner bad' }, `Last sync error: ${rec.lastError}`));

  // Photos (audit I2): tap a photo to change its label, make it the main photo, or remove it.
  if (selectedPhoto.model !== modelId) selectedPhoto = { model: modelId, id: null };
  const gal = h('div', { class: 'gallery' });
  for (const p of photos.sort((a, b) => Object.keys(SHOT_ROLES).indexOf(a.shot_role) - Object.keys(SHOT_ROLES).indexOf(b.shot_role))) {
    const img = h('img', { alt: SHOT_ROLES[p.shot_role]?.label || 'Photo' });
    photoUrl(p, 'display').then(u => { if (u) img.src = u; });
    const main = p.photo_id === m.primary_photo_id;
    gal.append(h('button', { type: 'button', class: `fig ${selectedPhoto.id === p.photo_id ? 'sel' : ''}`, 'aria-label': `Photo options: ${SHOT_ROLES[p.shot_role]?.label || p.shot_role}`,
      onclick: () => { selectedPhoto.id = selectedPhoto.id === p.photo_id ? null : p.photo_id; route(); } }, img,
      h('span', { class: 'cap' }, `${main ? '★ ' : ''}${SHOT_ROLES[p.shot_role]?.label || p.shot_role}${p.original_file_id ? '' : ' · waiting'}`)));
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
        } }, 'Remove photo'))));
  }
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
  // Typed edits are saved before any navigation or redraw (audit I1): see leaveHooks in route().
  const barcodes = idfs.filter(i => i.identifier_type === 'barcode');
  const bc0 = barcodes[0];
  const f = { display_name: m.display_name || '', brand_id: m.brand_id || '', scale_id: m.scale_id || '', product_code: m.product_code || '', variant: m.variant || '', series: m.series || '', notes: m.notes || '', barcode: bc0?.value_raw || '' };
  let productDirty = false;
  const set = (k) => (e) => { f[k] = e.target.value; productDirty = true; };
  const form = h('div', { class: 'card' }, h('h3', {}, 'Product'));
  const field = (label, el) => form.append(h('label', { class: 'f' }, label), el);
  field('Name', h('input', { value: f.display_name, oninput: set('display_name') }));
  field('Brand', h('select', { onchange: set('brand_id') }, h('option', { value: '' }, '—'), ref.brands.map(b => h('option', { value: b.brand_id, selected: b.brand_id === f.brand_id ? true : undefined }, b.name + (b.record_status === 'needs_review' ? ' (needs review)' : '')))));
  field('Scale', h('select', { onchange: set('scale_id') }, h('option', { value: '' }, '—'), ref.scales.map(s => h('option', { value: s.scale_id, selected: s.scale_id === f.scale_id ? true : undefined }, s.label))));
  field('Product code (exactly as printed)', h('input', { value: f.product_code, autocapitalize: 'characters', oninput: set('product_code') }));
  field('Variant / colour', h('input', { value: f.variant, oninput: set('variant') }));
  field('Series', h('input', { value: f.series, oninput: set('series') }));
  field('Notes', h('textarea', { oninput: set('notes') }, f.notes));
  // Barcode can be corrected (audit I2), with the same check-digit warning as quick capture.
  const bcWarn = h('div', { class: 'muted' });
  const bcCheck = () => { const ok = gtinCheckOk(f.barcode); bcWarn.textContent = f.barcode.trim() && ok === false ? '⚠ These digits don\'t add up (check digit). Please re-check.' : ''; bcWarn.style.color = 'var(--warn)'; };
  field('Barcode', h('input', { inputmode: 'numeric', value: f.barcode, placeholder: 'None yet', oninput: (e) => { set('barcode')(e); bcCheck(); } }));
  form.append(bcWarn); bcCheck();
  if (barcodes.length > 1) form.append(h('p', { class: 'muted' }, `Other barcodes: ${barcodes.slice(1).map(i => i.value_raw).join(', ')}`));
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
    const brand = ref.brands.find(b => b.brand_id === f.brand_id);
    const ns = assignNamespace(brand, null);
    const { barcode: _bc, ...fields } = f;
    const patch = { ...fields, product_code: f.product_code.trim(), product_code_cmp: codeCmp(f.product_code), printed_brand_text: m.printed_brand_text || brand?.name || '',
      code_namespace_type: ns.type, code_namespace_id: ns.id, namespace_status: ns.status };
    patch.duplicate_check_status = duplicateCheckStatus(patch);
    for (const k of ['brand_id', 'product_code']) if (String(m[k] || '') !== String(patch[k] || '')) await store.logChange('models', modelId, k, m[k], patch[k], 'edited in app');
    await store.update('models', modelId, patch);
    Object.assign(m, patch); productDirty = false;
    if (bc0) bc0.value_raw = f.barcode.trim();
  }
  form.append(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { onclick: async () => { await saveProduct(); toast('Saved ✓'); route(); autoSyncSoon(); } }, 'Save'),
    h('button', { class: m.completeness_status === 'complete' ? 'quiet' : 'ghost', onclick: async () => {
      if (productDirty) await saveProduct();
      await store.update('models', modelId, { completeness_status: m.completeness_status === 'complete' ? 'quick' : 'complete' }); route(); autoSyncSoon();
    } }, m.completeness_status === 'complete' ? 'Mark as quick' : 'Mark complete')));
  v.append(form);
  const copies = [];

  // Copies (physical)
  for (const [idx, c] of inv.entries()) {
    const cf = { ownership_status: c.ownership_status, packaging_state: c.packaging_state, condition: c.condition, packaging_condition: c.packaging_condition, storage_location: c.storage_location, purchase_price: c.purchase_price, purchase_date: c.purchase_date, purchase_source: c.purchase_source };
    const cc = { dirty: false };
    const card = h('div', { class: 'card' }, h('h3', {}, `Copy ${idx + 1}${inv.length > 1 ? ` of ${inv.length}` : ''}`));
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
    card.append(h('button', { style: 'margin-top:12px', onclick: async () => {
      if (await cc.save(false)) { toast('Copy saved ✓'); route(); autoSyncSoon(); }
    } }, 'Save copy'));
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
  v.append(h('dl', { class: 'kv card' },
    h('dt', {}, 'Duplicate check'), h('dd', {}, { checkable: 'Checkable', not_checkable: 'Not checkable yet (no code)', needs_review: 'Brand needs review' }[m.duplicate_check_status] || m.duplicate_check_status),
    h('dt', {}, 'Added'), h('dd', {}, new Date(m.created_at).toLocaleString()),
    h('dt', {}, 'Sync'), h('dd', {}, rec.dirty ? 'Waiting to sync' : 'Synced'),
    h('dt', {}, 'ID'), h('dd', { class: 'muted' }, m.model_id)));
  v.append(m.deleted_at ? h('button', { class: 'wide', onclick: restore }, 'Restore to garage')
    : h('button', { class: 'ghost wide', onclick: async () => { if (confirm('Archive this model? It is hidden from your garage, never deleted, and can be restored from Garage → Archived.')) { await store.archive('models', modelId); toast('Archived. Restore it from Garage → Archived.', 3500); location.hash = '#/'; autoSyncSoon(); } } }, 'Archive'));
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
  const ps = await store.pendingSummary();

  const acct = h('div', { class: 'card' }, h('h3', {}, 'Google account'));
  const cid = h('input', { value: getClientId(), placeholder: 'OAuth Client ID (….apps.googleusercontent.com)' });
  acct.append(h('label', { class: 'f' }, 'Google Client ID (saved on this phone only)'), cid,
    h('p', { class: 'muted' }, getClientId() ? 'Found the Client ID saved by the test kit on this phone ✓' : 'Paste the Client ID from your Google Cloud project (same one the test kit used).'),
    h('div', { class: 'row' },
      h('button', { onclick: async () => { if (cid.value.trim()) setClientId(cid.value); try { await signIn(); toast('Signed in'); await runSync(true); } catch (e) { toast(e.message, 4000, 'bad'); } route(); } }, hasToken() ? 'Sync now' : 'Sign in & set up'),
    ),
    h('p', { class: 'muted' }, hasToken() ? `Signed in (${tokenMinutesLeft()} min left; renews on sync).` : 'Not signed in. You can still capture offline.'));
  v.append(acct);

  const sync = h('div', { class: 'card' }, h('h3', {}, 'Sync'),
    h('p', {}, ps.boxes || ps.other ? `${ps.boxes ? plural(ps.boxes, 'box', 'boxes') : 'Some changes'} waiting · ${plural(ps.photos, 'photo', 'photos')} not uploaded yet${c.conflicts ? ` · ${plural(c.conflicts, 'clash', 'clashes')} to review` : ''}` : (c.conflicts ? `${plural(c.conflicts, 'clash', 'clashes')} to review` : 'Nothing waiting to sync.')),
    h('p', { class: 'muted', id: 'syncMsg' }, lastSyncMsg || (last ? `Last sync ${new Date(last.finishedAt).toLocaleString()} · ${last.errors.length ? last.errors.length + ' error(s)' : 'no errors'}` : 'Never synced.')),
    last?.errors?.length ? h('details', {}, h('summary', {}, 'Show errors'), h('pre', { style: 'white-space:pre-wrap;font-size:.8rem' }, last.errors.join('\n'))) : null,
    h('button', { onclick: () => runSync(true) }, 'Sync now'));
  v.append(sync);

  const where = h('div', { class: 'card' }, h('h3', {}, 'Your data'),
    config?.workbookId ? h('p', {}, h('a', { href: `https://docs.google.com/spreadsheets/d/${config.workbookId}`, target: '_blank', rel: 'noopener' }, 'Open SCALE_GARAGE_MASTER sheet ↗')) : h('p', { class: 'muted' }, 'Not set up yet — sign in above.'),
    config?.rootId ? h('p', {}, h('a', { href: `https://drive.google.com/drive/folders/${config.rootId}`, target: '_blank', rel: 'noopener' }, 'Open SCALE GARAGE folder ↗')) : null);
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
    } }, 'Back up now')));

  // Collection size, for the Garage progress bar.
  const estIn = h('input', { inputmode: 'numeric', value: String(collectionEstimate()), 'aria-label': 'About how many boxes in your collection' });
  v.append(h('div', { class: 'card' }, h('h3', {}, 'Your collection'),
    h('label', { class: 'f' }, 'About how many boxes in total?'), estIn,
    h('p', { class: 'muted' }, 'Used only for the progress bar on the Garage screen. A rough number is fine.'),
    h('button', { class: 'quiet', onclick: () => { const n = Number(estIn.value.replace(/\D/g, '')); if (n > 0) { localStorage.setItem('smg.collectionEstimate', String(n)); toast('Saved ✓'); } else toast('Please enter a number', 3000, 'warn'); } }, 'Save')));

  const est = await storageEstimate();
  const persisted = await (navigator.storage?.persisted?.() ?? Promise.resolve(false));
  const times = await meta.get(TIMES_KEY, []);
  const median = times.length ? times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)] : null;
  v.append(h('div', { class: 'card' }, h('h3', {}, 'This phone'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Storage used'), h('dd', {}, est ? `${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1073741824).toFixed(1)} GB` : '—'),
      h('dt', {}, 'Protected storage'), h('dd', {}, persisted ? 'Yes ✓' : 'No'),
      h('dt', {}, 'Capture time'), h('dd', {}, median ? `median ${median} s per box (${plural(times.length, 'box', 'boxes')}; time spent on each box only)` : 'Not measured yet (counts from this version on)'),
      h('dt', {}, 'App version'), h('dd', {}, APP_VERSION),
      h('dt', {}, 'Schema version'), h('dd', {}, String(SCHEMA_VERSION))),
    persisted ? null : h('button', { class: 'quiet', style: 'margin-top:8px', onclick: async () => { const ok = await requestPersistentStorage(); toast(ok ? 'Storage protected ✓' : 'Chrome said no (try after installing the app)', 3500, ok ? 'ok' : 'warn'); route(); } }, 'Protect storage on this phone')));
}

// ---------- start ----------
async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  requestPersistentStorage();
  await seedLocal();
  $('#syncBtn').addEventListener('click', () => runSync(true));
  $('#status').addEventListener('click', () => runSync(true));
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
