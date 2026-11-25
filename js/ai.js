// AI copy-paste helper (decision D2; security doc §2.3–2.4). Pure functions, unit-tested.
// B shares location-free display copies of box photos to his own Gemini or Claude app with this prompt,
// then pastes the answer back. The answer is UNTRUSTED TEXT: parsed as data only, validated, and used
// only to pre-fill fields as suggestions that B confirms or corrects. Nothing is saved automatically.

export const PROMPT_VERSION = 'names-v8';
// 5 boxes = 10 photos per share. B's phone (24 Nov 21:39) refused to share 20 photos at once (2 worked);
// Chrome on Android appears to cap a share at about 10 files (not confirmed in its docs), so batches stay at 10 photos.
export const MAX_BATCH = 5;

// boxes: [{ brand, scale }] in the order their photos are shared (front, then rear, for each box).
export function buildPrompt(boxes, { extras = false } = {}) {
  // names-v8 (B, 25 Nov): Gemini made up its own table when the instructions didn't arrive, and left out Colour and
  // Note. The headings come first and last, with a full example row; the Note asks for the kind of fact B wants.
  const head = '| Box | Car name | Year | Product code | Brand | Colour | Note |';
  const lines = boxes.map((b, i) => `Box ${i + 1}: photo ${i * 2 + 1} = box front, photo ${i * 2 + 2} = box back${b.name ? ` (already named: ${b.name})` : ''}${b.brand ? ` (brand: ${b.brand}${b.scale ? `, ${b.scale}` : ''})` : ''}`);
  return [
    'Reply with ONE table only, with exactly these 7 column headings, in this order:',
    head,
    'Example row:',
    '| Box 1 | McLaren F1 GTR 1995 Presentation | 1995 | MGT00949 | Mini GT | Orange | History: The F1 GTR won Le Mans overall at its first attempt in 1995, beating purpose-built prototypes. |',
    ...(extras ? ['', 'These cars are already named. What I need most is the Colour and the Note for each one.'] : []),
    '',
    `I'm cataloguing my die-cast model cars. There are ${boxes.length} box${boxes.length === 1 ? '' : 'es'}, ${boxes.length * 2} photos, in this order:`,
    ...lines,
    '',
    'Car name = the real car (make, model, version, livery), never the brand.',
    'Product code = this car\'s own catalogue number exactly as printed (e.g. MGT00123-L, KHMG197, PR64-240, JKY27), usually on the box back or side. Not the barcode digits, and not an assortment or case code shared by a whole set (e.g. "Asst. HRT81" or the code at the top of a Hot Wheels card). If you cannot read it clearly, write -.',
    'Hot Wheels: the car\'s own code (5 characters, e.g. JKY27) is often on the back, and on an India import sticker as "Item No.". Two cars from one set never share a code.',
    'Colour = the main colour of the car itself (not the box).',
    'Note = the single most interesting true thing about this model or the real car, at most 35 words, starting with one of:',
    '  "Casting:" (rare or famous casting, Treasure Hunt / Super Treasure Hunt, limited edition, collaboration, convention or club exclusive, first release of this casting),',
    '  "History:" (race wins, records, production numbers, why the real car mattered),',
    '  "Pop culture:" (films, games, famous owners), or "Fun fact:".',
    '  Prefer a Casting note when the model itself is special. Only what you are confident is true; otherwise -.',
    'Use - for anything you cannot read. Do not guess. No other text before or after the table.',
    '',
    `Remember: one table, headings ${head}`,
  ].join('\n');
}

// "Pop culture: Built for the film Spectre." → { kind: 'pop', label: 'Pop culture', body: 'Built for the film Spectre.' }
export function noteParts(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(fun fact|history|historical|pop culture|casting|model)\s*[:\-–—]\s*(.+)$/i);
  if (!m) return { kind: 'fun', label: 'Note', body: t };
  const k = m[1].toLowerCase();
  const kind = k.startsWith('fun') ? 'fun' : k.startsWith('hist') ? 'history' : k.startsWith('pop') ? 'pop' : 'casting';
  return { kind, label: { fun: 'Fun fact', history: 'History', pop: 'Pop culture', casting: 'Casting' }[kind], body: m[2].trim() };
}
// Notes are kept whole up to ~450 characters (B, 25 Nov: "…between 195" was cut mid-word); longer ones end at a word with "…".
const fitNote = (t) => (t.length <= 450 ? t : `${t.slice(0, 450).replace(/\s+\S*$/, '')}…`);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const blank = (s) => (!s || /^[-–—?]+$/.test(s) || /^(n\/?a|none|unknown|unreadable)$/i.test(s));

// Product codes: letters, digits and a few separators only, 2–40 characters (§2.4 validation).
export function validCode(code) { return /^[A-Za-z0-9#][A-Za-z0-9#\-/. ]{1,39}$/.test(code); }

// Which part of a reply line is which (B, 24 Nov: Gemini put the brand first, the car name in the code
// slot and the livery as brand). Each part is judged by what it looks like, not only by its position.
const sqz = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A catalogue code: short, every word code-like (digits, or a few capital letters), never a plain word
// ("1995 Presentation" is a year + a word, not a code), never a year or a barcode on its own.
const isBarcode = (w) => /^\d{11,14}$/.test(w);
export function looksLikeCode(f) {
  const t = String(f || '').trim();
  if (!t || !validCode(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 2 || t.length < 4 || t.length > 24 || (t.match(/\d/g) || []).length < 2) return false;
  if (words.some(w => /^(19|20)\d{2}$/.test(w) || isBarcode(w))) return false;
  return words.every(w => /\d/.test(w) ? !/[a-z]{4,}/i.test(w.replace(/[^a-z]/gi, ' ').split(' ').sort((a, b) => b.length - a.length)[0] || '') || /^[A-Z]{1,6}\d/.test(w) : /^[A-Z]{1,4}$/.test(w));
}
// How code-like (higher = more): letters+digits mix like MGT00988 or KHMG197 beats digits-only like 18-38322.
const codeScore = (f) => (looksLikeCode(f) ? 1 + (/[A-Z]{2,}\d/i.test(f) ? 1 : 0) : 0);
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
  // Barcode digits are dropped (the app already has the barcode); a part like "MGT00988 840456393666" keeps the code.
  const parts = fields.map(f => clean(f, 120).split(/\s+/).filter(w => !isBarcode(w)).join(' ')).filter(f => !blank(f) && !/^[=+@]/.test(f)); // formula-like parts never become text
  let code = '', brand = '', best = 0;
  for (const f of parts) { const sc = codeScore(f); if (sc > best) { best = sc; code = f; } }
  const name = [];
  for (const f of parts) {
    if (f === code) continue;
    if (looksLikeBrand(f, brandNames)) { if (!brand) brand = f; } // a brand repeated is not part of the name
    else name.push(f);
  }
  return { name: name.join(' ').slice(0, 120), code, brand };
}

// Tables with their own headings (B's real Gemini reply, 24 Nov 22:47):
// | Box | Brand | Scale | Car Name | Year | Product Code | Color / Livery | Barcode / UPC |
// Each value is taken from the column its heading names; scale and barcode columns are ignored.
function colKind(hd) {
  const k = hd.toLowerCase();
  if (/barcode|upc|ean|gtin|jan\b/.test(k)) return 'barcode';
  // "Item" is the box column (B's 2nd real reply, 24 Nov 23:01), not the code: "Item | Brand / Series | … | Product Code"
  if (/^\s*(box|boxes|item|items|#|no\.?|n|sr\.?\s*no\.?|s\.?\s*no\.?)\s*$/.test(k)) return 'box';
  if (/scale/.test(k)) return 'scale';
  if (/colou?r|livery|paint/.test(k)) return 'colour';
  if (/year/.test(k)) return 'year';
  if (/code|item\s*(no|number|#)|sku|catalog|ref|part\s*n/.test(k)) return 'code';
  if (/brand|maker|manufacturer|make\b/.test(k)) return 'brand';
  if (/note|fact|trivia|story/.test(k)) return 'carnote';
  if (/remark|comment/.test(k)) return 'notes';
  if (/name|model|car|vehicle|title/.test(k)) return 'name';
  return '';
}
const UNSURE = /\b(or similar|obscured|unclear|unreadable|partial|partially|blurred|not visible|maybe|possibly|likely|approx|guess)\b|\?/i;
function parseTable(text, expected) {
  const rows = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('|'));
  let kinds = null;
  const out = [];
  let order = 0;
  for (const row of rows) {
    const cells = row.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.replace(/\*\*/g, '').trim());
    if (cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) continue; // |---|---|
    if (!kinds) { const k = cells.map(colKind); if (k.includes('name') && k.filter(Boolean).length >= 2) kinds = k; continue; }
    order++;
    const get = (kind, max = 160) => { const i = kinds.indexOf(kind); return i >= 0 ? clean(cells[i], max) : ''; }; // notes get a longer limit
    const boxCell = get('box');
    const n = Number((boxCell.match(/\d{1,2}/) || [])[0]) || order;
    if (n < 1 || n > expected) continue;
    const notes = [];
    let name = get('name');
    if (blank(name)) name = '';
    const year = (get('year').match(/\b(19|20)\d{2}\b/) || [])[0];
    if (name && year && !name.includes(year)) name = `${name} ${year}`;
    // Code: the first code-like word; if the AI says it is unsure, it becomes a note, never a pre-filled code.
    const codeCell = get('code');
    let code = '';
    // "(Asst. HRV11)" is the assortment, not the car: left out before picking the code
    const codeText = codeCell.replace(/\(?\s*(asst|assortment|case|set)\.?[^)]*\)?/gi, ' ');
    const cand = (codeText.split(/[\s(]+/).find(w => looksLikeCode(w)) || '').replace(/[),.;]+$/, '');
    if (cand && UNSURE.test(codeCell)) notes.push(`AI wasn't sure of the code (it said: "${codeCell.slice(0, 60)}"). Read it from the box.`);
    else code = cand;
    const colour = get('colour');
    if (colour && !blank(colour)) notes.push(`Colour: ${colour.slice(0, 60)}`);
    if (!name) notes.push('no car name in the answer: type it from the box');
    const carNote = get('carnote', 2000);
    out.push({ n, name: name.slice(0, 120), code, brand: blank(get('brand')) ? '' : get('brand'), colour: blank(colour) ? '' : colour.slice(0, 60), carNote: blank(carNote) ? '' : fitNote(clean(carNote, 2000)), notes });
  }
  // The same code for two boxes in one answer is a set/assortment code (e.g. Hot Wheels "HRT81" on two different
  // cars), not either car's own code: never pre-filled, so it can't make two different cars look like duplicates.
  const seen = new Map();
  for (const it of out) if (it.code) seen.set(it.code.toUpperCase(), (seen.get(it.code.toUpperCase()) || 0) + 1);
  for (const it of out) if (it.code && seen.get(it.code.toUpperCase()) > 1) {
    it.notes.unshift(`AI gave the same code (${it.code}) for another box too: probably the set or assortment code, not this car's. Read the car's own code from the back.`);
    it.code = '';
  }
  return kinds ? out : [];
}

// Returns { items: [{ n, name, code, brand, notes: [] }], ignored: number }.
// Accepts "Box 1 | name | code | brand", "1 | ...", "1. ... | ...", and markdown table rows "| 1 | ... |".
export function parseAnswer(text, expected = MAX_BATCH, brandNames = []) {
  const items = new Map();
  let ignored = 0;
  // A table with headings wins: its columns say what each value is.
  for (const it of parseTable(text, expected)) if (!items.has(it.n)) items.set(it.n, it);
  if (items.size) return { items: [...items.values()].sort((a, b) => a.n - b.n), ignored: String(text || '').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('|')).length + 2 };
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
      || (code && !looksLikeCode(code) && fields.some(f => codeScore(clean(f, 60)) === 2))
      || (brand && looksLikeCode(brand) && !looksLikeCode(code))
      || (fields.length > 3 && !looksLikeCode(code) && fields.slice(3).some(f => looksLikeCode(clean(f, 60))));
    if (shifted) ({ name, code, brand } = sortFields(fields, brandNames));
    if (code && !validCode(code)) { notes.push(`code "${code.slice(0, 20)}" ignored (unexpected characters)`); code = ''; }
    // Barcode digits never belong in a name or code (the app reads the barcode itself): removed whatever the order.
    const noBarcode = (t) => t.split(/\s+/).filter(w => !(isBarcode(w.replace(/[()\-]/g, '')) && /^\(?[\d-]+\)?$/.test(w))).join(' ').replace(/\s*[|·,;—-]\s*$/, '').trim();
    name = noBarcode(name);
    code = isBarcode(code.replace(/[\s-]/g, '')) ? '' : noBarcode(code);
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
