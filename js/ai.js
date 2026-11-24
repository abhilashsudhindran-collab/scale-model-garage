// AI copy-paste helper (decision D2; security doc §2.3–2.4). Pure functions, unit-tested.
// B shares location-free display copies of box photos to his own Gemini or Claude app with this prompt,
// then pastes the answer back. The answer is UNTRUSTED TEXT: parsed as data only, validated, and used
// only to pre-fill fields as suggestions that B confirms or corrects. Nothing is saved automatically.

export const PROMPT_VERSION = 'names-v3';
// 5 boxes = 10 photos per share. B's phone (24 Nov 21:39) refused to share 20 photos at once (2 worked);
// Chrome on Android appears to cap a share at about 10 files (not confirmed in its docs), so batches stay at 10 photos.
export const MAX_BATCH = 5;

// boxes: [{ brand, scale }] in the order their photos are shared (front, then rear, for each box).
export function buildPrompt(boxes) {
  const lines = boxes.map((b, i) => `Box ${i + 1}: photo ${i * 2 + 1} = box front, photo ${i * 2 + 2} = box back${b.brand ? ` (brand: ${b.brand}${b.scale ? `, ${b.scale}` : ''})` : ''}`);
  const fmt = 'Box 1 | car name and year as printed | product code as printed | brand as printed';
  return [
    `Reply with one line per box in exactly this format, nothing else:`,
    fmt,
    'Example: Box 1 | Toyota Supra (A80) 1997 Castrol | MGT00123-L | Mini GT',
    'The car name is the real car (make, model, version, livery), never the brand. Keep the 4 parts in this order.',
    'The product code is the maker\'s catalogue number (letters + digits, e.g. MGT00123-L, KHMG197, HKT123), usually on the box back or side near the barcode. It is not the barcode digits.',
    '',
    `I'm cataloguing my die-cast model car boxes. There are ${boxes.length} box${boxes.length === 1 ? '' : 'es'}, ${boxes.length * 2} photos, in this order:`,
    ...lines,
    '',
    'Rules: copy the product code exactly (keep dashes, letters O vs digit 0 as printed). Use - for anything you cannot read clearly. Do not guess. No bullet points, no headings, no other text.',
    `Start your reply with "Box 1 |".`,
  ].join('\n');
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const blank = (s) => (!s || /^[-–—?]+$/.test(s) || /^(n\/?a|none|unknown|unreadable)$/i.test(s));

// Product codes: letters, digits and a few separators only, 2–40 characters (§2.4 validation).
export function validCode(code) { return /^[A-Za-z0-9#][A-Za-z0-9#\-/. ]{1,39}$/.test(code); }

// Which part of a reply line is which (B, 24 Nov: Gemini put the brand first, the car name in the code
// slot and the livery as brand). Each part is judged by what it looks like, not only by its position.
const sqz = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function looksLikeCode(f) {
  const t = String(f || '').trim();
  if (!t || !validCode(t) || /^(19|20)\d{2}$/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length <= 2 && t.length >= 4 && t.length <= 24 && (t.match(/\d/g) || []).length >= 2;
}
export function looksLikeBrand(f, brandNames = []) {
  const t = String(f || '').trim();
  if (!t || t.split(/\s+/).length > 6) return false;
  const k = sqz(t);
  // the whole part is brand names (e.g. "Kaido House × Mini GT", "Hot Wheels"), nothing else
  // Extras that often ride along with a brand: "(TSM Model)", "by TSM", "Models", "×", "x".
  const bare = sqz(t.replace(/\([^)]*\)/g, ' ').replace(/\b(by|tsm|true\s*scale(\s*miniatures)?|models?|diecast|die-cast|collection|limited|edition)\b/gi, ' '));
  let rest = bare;
  for (const b of [...brandNames].sort((a, c) => sqz(c).length - sqz(a).length)) { const bb = sqz(b); if (bb.length >= 2 && rest.includes(bb)) rest = rest.split(bb).join(''); }
  return rest !== bare && rest.replace(/x/g, '').length <= 2;
}
function sortFields(fields, brandNames) {
  const parts = fields.map(f => clean(f, 120)).filter(f => !blank(f) && !/^[=+@]/.test(f)); // formula-like parts never become text
  let code = '', brand = '';
  const name = [];
  for (const f of parts) {
    if (!code && looksLikeCode(f)) code = f;
    else if (!brand && looksLikeBrand(f, brandNames)) brand = f;
    else name.push(f);
  }
  return { name: name.join(' ').slice(0, 120), code, brand };
}

// Returns { items: [{ n, name, code, brand, notes: [] }], ignored: number }.
// Accepts "Box 1 | name | code | brand", "1 | ...", "1. ... | ...", and markdown table rows "| 1 | ... |".
export function parseAnswer(text, expected = MAX_BATCH, brandNames = []) {
  const items = new Map();
  let ignored = 0;
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 200)) {
    let line = raw.trim().replace(/^[*•>\s]+/, '').replace(/\*\*/g, '');
    if (!line) continue;
    if (line.startsWith('|')) line = line.replace(/^\|/, '').replace(/\|\s*$/, '');
    const parts = line.split('|').map(p => p.trim());
    const head = parts[0].match(/^(?:box\s*)?#?(\d{1,2})\s*[.):\-]?\s*(.*)$/i);
    if (!head || parts.length < 2) { ignored++; continue; }
    const n = Number(head[1]);
    if (n < 1 || n > expected) { ignored++; continue; }
    // "1 | name | code | brand" (number alone) or "1. name | code | brand" (number glued to the name)
    const fields = head[2] ? [head[2], ...parts.slice(1)] : parts.slice(1);
    const notes = [];
    let name = clean(fields[0], 120);
    let code = clean(fields[1], 60);
    let brand = clean(fields[2], 60);
    if (blank(name)) name = '';
    if (blank(code)) code = '';
    if (blank(brand)) brand = '';
    // Parts out of order (brand where the name should be, a car name where the code should be, extra parts): sort by look.
    // Only on clear evidence: the brand sits in the name slot, or a code sits where the brand or an extra part is.
    const wordy = (f) => f.split(/\s+/).length >= 3 && /[a-z]{3}/i.test(f); // a car name, not a code
    const shifted = (name && looksLikeBrand(name, brandNames))
      || (code && wordy(code))
      || (brand && looksLikeCode(brand) && !looksLikeCode(code))
      || (fields.length > 3 && !looksLikeCode(code) && fields.slice(3).some(f => looksLikeCode(clean(f, 60))));
    if (shifted) ({ name, code, brand } = sortFields(fields, brandNames));
    if (code && !validCode(code)) { notes.push(`code "${code.slice(0, 20)}" ignored (unexpected characters)`); code = ''; }
    if (!name) notes.push('no car name in the answer: type it from the box');
    if (!items.has(n)) items.set(n, { n, name, code, brand, notes });
  }
  // Second pass: labelled lists ("Car Name: …", "Product Code: …", "Brand: …"), which Gemini often
  // sends instead of the requested lines. Grouped by "Box N" headings or by the photo names it cites.
  for (const it of parseLabelled(text, expected)) if (!items.has(it.n)) items.set(it.n, it);
  return { items: [...items.values()].sort((a, b) => a.n - b.n), ignored };
}

const PHOTO_REF = /\bbox\s*(\d{1,2})[-_ ]?(?:front|back)(?:\.jpe?g)?(?:\s*\+\d+)?/gi;
function labelKind(key) {
  const k = key.toLowerCase();
  if (/import|distribut|seller|retail/.test(k)) return '';
  if (/year/.test(k)) return 'year';
  if (/code|item\s*no|item\s*number|catalog|\bref\b|sku|product\s*(no|number)|model\s*(no|number)/.test(k)) return 'code';
  if (/brand|maker|manufacturer/.test(k)) return 'brand';
  if (/name|model|car|vehicle|title/.test(k)) return 'name';
  return '';
}
function parseLabelled(text, expected) {
  const boxes = new Map();
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 300)) {
    let line = raw.replace(/\*\*|__/g, '').trim();
    let hint = null;
    line = line.replace(PHOTO_REF, (_, n) => { hint = hint ?? Number(n); return ' '; }).trim();
    line = line.replace(/^[*•○◦●▪\-–>#\s]+/, '').trim();
    if (!line) continue;
    const hd = line.match(/^box\s*#?(\d{1,2})\b\s*[:.)\-–]?\s*(.*)$/i);
    if (hd) { current = Number(hd[1]); line = hd[2].trim(); if (!line) continue; }
    const kv = line.match(/^([A-Za-z][A-Za-z /&.]{1,30}?)\s*[:：]\s*(.+)$/);
    if (!kv) continue;
    const kind = labelKind(kv[1]);
    if (!kind) continue;
    const n = current ?? hint ?? (expected === 1 ? 1 : null);
    if (!n || n < 1 || n > expected) continue;
    const b = boxes.get(n) || {};
    const val = clean(kv[2], kind === 'name' ? 120 : 60);
    if (!(kind in b) && !blank(val)) b[kind] = val;
    boxes.set(n, b);
  }
  const out = [];
  for (const [n, b] of boxes) {
    if (!b.name && !b.code) continue;
    const notes = [];
    let name = b.name || '';
    const year = (b.year || '').match(/\b(19|20)\d{2}\b/)?.[0];
    if (name && year && !name.includes(year)) name = name.includes(' (') ? name.replace(' (', ` ${year} (`) : `${name} ${year}`;
    let code = b.code || '';
    if (code && !validCode(code)) { notes.push(`code "${code.slice(0, 20)}" ignored (unexpected characters)`); code = ''; }
    out.push({ n, name: name.slice(0, 120), code, brand: b.brand || '', notes });
  }
  return out;
}

// Brand as read by the AI vs the canonical brand B chose: only a note, never a change (D10.1 rule 2).
export function brandNote(aiBrand, canonical) {
  if (!aiBrand || !canonical) return '';
  const sq = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sq(aiBrand).includes(sq(canonical)) || sq(canonical).includes(sq(aiBrand)) ? '' : `AI read the brand as "${aiBrand}" (yours: ${canonical}). Check the box.`;
}
