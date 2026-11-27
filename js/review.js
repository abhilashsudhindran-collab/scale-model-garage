// Needs review (s1-0.46.0): everything the app isn't sure about, in one list. Pure: it only reads.
// Nothing here changes data; each item says what it is and the screen offers a fix. Dismissing ("Not a problem")
// is keyed so that the item comes back if the underlying value changes (e.g. a different code is typed).
import { looksLike } from './brands.js';
import { codeCmp, barcodeCmp } from './rules.js';

export const shapeOf = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[A-Z]/g, 'A').replace(/[0-9]/g, '9');
const UNSURE_NOTE = /wasn't sure of the code/i;

// models: live (not archived) model objects · brands: brand records · ids: product_identifiers · sugg: aiSuggest map
export function buildReview({ models, brands, ids = [], sugg = {}, dismissed = {} }) {
  const items = [];
  const brandById = new Map(brands.filter(b => !b.deleted_at).map(b => [b.brand_id, b]));
  const carsOf = new Map(); for (const m of models) if (m.brand_id) (carsOf.get(m.brand_id) || carsOf.set(m.brand_id, []).get(m.brand_id)).push(m);
  const add = (it) => { if (!dismissed[it.key]) items.push(it); };

  // 1. Brands in use that aren't checked: their cars can't be duplicate-checked (D10.1 rule 4)
  for (const [bid, cars] of carsOf) {
    const b = brandById.get(bid);
    if (b && b.record_status === 'needs_review') add({ key: `brand:${bid}`, kind: 'brand', brand_id: bid, n: cars.length, title: `Brand not checked: ${b.name}`, detail: `${cars.length} ${cars.length === 1 ? 'car' : 'cars'} can't be checked for duplicates until you confirm it.` });
  }
  // 2. Brand look-alikes among brands you use ("Minigt" / "Mini GT")
  const used = [...carsOf.keys()].map(id => brandById.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
    const a = used[i], b = used[j];
    if (looksLike(a.name, b.name)) add({ key: `alike:${[a.brand_id, b.brand_id].sort().join(':')}`, kind: 'alike', brand_ids: [a.brand_id, b.brand_id], title: `Same brand? ${a.name} / ${b.name}`, detail: `${carsOf.get(a.brand_id).length} + ${carsOf.get(b.brand_id).length} cars. If they're one brand, merge them on the Brands screen.` });
  }
  // 3. Codes Gemini wasn't sure of, while the car still has no code
  for (const m of models) {
    const notes = (sugg[m.model_id]?.notes || []).filter(n => UNSURE_NOTE.test(n));
    if (notes.length && !String(m.product_code || '').trim()) add({ key: `unsure:${m.model_id}`, kind: 'unsure', model_id: m.model_id, title: `Code not sure: ${m.display_name || 'car with no name yet'}`, detail: 'Gemini couldn\'t read the code clearly. Read it from the box and type it in.' });
  }
  // 4. Codes that don't look like your other codes for the brand (needs 3+ codes, one shape used by most of them)
  for (const [bid, cars] of carsOf) {
    const coded = cars.filter(m => String(m.product_code || '').trim());
    if (coded.length < 3) continue;
    const tally = new Map(); coded.forEach(m => tally.set(shapeOf(m.product_code), (tally.get(shapeOf(m.product_code)) || 0) + 1));
    const [top, topN] = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (topN / coded.length < 0.6) continue; // no clear pattern: say nothing
    const eg = coded.find(m => shapeOf(m.product_code) === top).product_code;
    for (const m of coded) if (shapeOf(m.product_code) !== top) add({ key: `shape:${m.model_id}:${codeCmp(m.product_code)}`, kind: 'shape', model_id: m.model_id, title: `Unusual code: ${m.product_code}`, detail: `${m.display_name || 'Car with no name yet'} · your other ${brandById.get(bid)?.name || ''} codes look like ${eg}. Check the box.` });
  }
  // 5. Possible duplicates: same brand + code, or same barcode (names alone are left to To check)
  const groups = new Map(); const put = (k, mid) => (groups.get(k) || groups.set(k, new Set()).get(k)).add(mid);
  for (const m of models) { const c = codeCmp(m.product_code); if (c) put(`c:${m.brand_id || '?'}:${c}`, m.model_id); }
  const live = new Set(models.map(m => m.model_id));
  for (const i of ids) if (!i.deleted_at && i.identifier_type === 'barcode' && live.has(i.model_id) && (i.value_cmp || i.value_raw)) put(`b:${i.value_cmp || barcodeCmp(i.value_raw)}`, i.model_id);
  const seen = new Set(); const byId = new Map(models.map(m => [m.model_id, m]));
  for (const [k, set] of groups) {
    if (set.size < 2) continue;
    const mids = [...set].sort(); const gk = mids.join(':'); if (seen.has(gk)) continue; seen.add(gk);
    add({ key: `dupe:${gk}`, kind: 'dupe', model_id: mids[0], model_ids: mids, title: `${mids.map(x => byId.get(x)?.display_name || 'no name').slice(0, 2).join(' / ')}`, detail: k.startsWith('b:') ? 'Same barcode. If it is one car, merge them; if you own two, use ＋1 copies instead.' : 'Same brand and code. If it is one car, merge them; if you own two, use ＋1 copies instead.' });
  }
  const order = { brand: 0, dupe: 1, alike: 2, unsure: 3, shape: 4 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
}
