// Garage sorting (s1-0.44.0). Pure. Blanks always go last, whatever the order; text compares naturally
// ("Box 2" before "Box 10", "MGT00988" before "MGT01000"), ignoring case and accents.
export const SORTS = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'Name A–Z'], ['code', 'Product code'], ['brand', 'Brand A–Z'], ['box', 'Storage box']];
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const blankLast = (a, b, cmp) => { const ea = !String(a ?? '').trim(), eb = !String(b ?? '').trim(); return ea || eb ? (ea === eb ? 0 : ea ? 1 : -1) : cmp(a, b); };
const byText = (a, b) => blankLast(a, b, (x, y) => coll.compare(String(x).trim(), String(y).trim()));

// cars: plain model objects; brandOf(m) → brand name; boxOf(m) → first storage box label or ''.
export function sortCompare(key, { brandOf = () => '', boxOf = () => '' } = {}) {
  const newest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
  const then = (...fs) => (a, b) => { for (const f of fs) { const r = f(a, b); if (r) return r; } return 0; };
  const name = (a, b) => byText(a.display_name, b.display_name);
  switch (key) {
    case 'oldest': return (a, b) => -newest(a, b);
    case 'name': return then(name, newest);
    case 'code': return then((a, b) => byText(a.product_code, b.product_code), name, newest);
    case 'brand': return then((a, b) => byText(brandOf(a), brandOf(b)), name, newest);
    case 'box': return then((a, b) => byText(boxOf(a), boxOf(b)), name, newest);
    default: return newest;
  }
}
