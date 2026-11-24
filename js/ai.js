// AI copy-paste helper (decision D2; security doc §2.3–2.4). Pure functions, unit-tested.
// B shares location-free display copies of box photos to his own Gemini or Claude app with this prompt,
// then pastes the answer back. The answer is UNTRUSTED TEXT: parsed as data only, validated, and used
// only to pre-fill fields as suggestions that B confirms or corrects. Nothing is saved automatically.

export const PROMPT_VERSION = 'names-v1';
export const MAX_BATCH = 10;

// boxes: [{ brand, scale }] in the order their photos are shared (front, then rear, for each box).
export function buildPrompt(boxes) {
  const lines = boxes.map((b, i) => `Box ${i + 1}: photo ${i * 2 + 1} = box front, photo ${i * 2 + 2} = box back${b.brand ? ` (brand: ${b.brand}${b.scale ? `, ${b.scale}` : ''})` : ''}`);
  return [
    `I'm cataloguing my die-cast model car boxes. There are ${boxes.length} box${boxes.length === 1 ? '' : 'es'}, ${boxes.length * 2} photos, in this order:`,
    ...lines,
    '',
    'For each box, read what is printed on the box and reply ONLY with one line per box, exactly like this:',
    'Box 1 | car name and year as printed | product code as printed | brand as printed',
    '',
    'Rules: copy the product code exactly (keep dashes, letters O vs digit 0 as printed). Use - for anything you cannot read clearly. Do not guess. No other text.',
  ].join('\n');
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const blank = (s) => (!s || /^[-–—?]+$/.test(s) || /^(n\/?a|none|unknown|unreadable)$/i.test(s));

// Product codes: letters, digits and a few separators only, 2–40 characters (§2.4 validation).
export function validCode(code) { return /^[A-Za-z0-9#][A-Za-z0-9#\-/. ]{1,39}$/.test(code); }

// Returns { items: [{ n, name, code, brand, notes: [] }], ignored: number }.
// Accepts "Box 1 | name | code | brand", "1 | ...", "1. ... | ...", and markdown table rows "| 1 | ... |".
export function parseAnswer(text, expected = MAX_BATCH) {
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
    const brand = clean(fields[2], 60);
    if (blank(name)) name = '';
    if (blank(code)) code = '';
    if (code && !validCode(code)) { notes.push(`code "${code.slice(0, 20)}" ignored (unexpected characters)`); code = ''; }
    if (!items.has(n)) items.set(n, { n, name, code, brand: blank(brand) ? '' : brand, notes });
  }
  return { items: [...items.values()].sort((a, b) => a.n - b.n), ignored };
}

// Brand as read by the AI vs the canonical brand B chose: only a note, never a change (D10.1 rule 2).
export function brandNote(aiBrand, canonical) {
  if (!aiBrand || !canonical) return '';
  const sq = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sq(aiBrand).includes(sq(canonical)) || sq(canonical).includes(sq(aiBrand)) ? '' : `AI read the brand as "${aiBrand}" (yours: ${canonical}). Check the box.`;
}
