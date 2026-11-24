// Brands beyond the starter list (B, 24 Nov: "so many other brands, some with a single model").
// A brand B adds is trusted at once (B's choice, 24 Nov): no "Needs review", duplicate check works.
// The guard against two records for one brand ("Mini-GT" vs "Mini GT", "Burago" vs "Bburago") is
// the look-alike check below, which asks "Did you mean …?" before a new brand is made.

// Well-known die-cast brands offered in every brand list under "More brands". Picking one creates it.
export const KNOWN_BRANDS = [
  'Almost Real', 'Auto World', 'BM Creations', 'Busch', 'Cararama', 'CMC', 'Corgi', 'Diecast Masters', 'Era Car',
  'GreenLight', 'GT Spirit', 'Herpa', 'Hobby Japan', 'Ignition Model', 'IXO', 'Jada', 'Johnny Lightning', 'Kinsmart',
  'Kyosho', 'Looksmart', 'M2 Machines', 'Maisto', 'Majorette', 'Matchbox', 'Matrix', 'Micro Turbo', 'Minichamps',
  'Motormax', 'NEO', 'Norev', 'Otto Mobile', 'Para64', 'Racing Champions', 'Rastar', 'Schuco', 'Siku', 'Spark',
  'Stance Hunters', 'Time Micro', 'Top Speed', 'TrueScale Miniatures', 'Welly',
];

// "Mini-GT", "mini gt", "MINI GT " all become "minigt".
export const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Same brand written differently (exact after normalising).
export const sameName = (a, b) => normName(a) === normName(b) && normName(a) !== '';

// Probably the same brand: one or two letters off, or one name starts the other ("Tarmac" / "Tarmac Works").
export function looksLike(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = Math.min(x.length, y.length);
  if (short >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  return lev(x, y) <= (short <= 5 ? 1 : 2);
}

// What to do with a typed or picked name, given the brands already stored (objects with .name).
// { use: brand } an existing record (same name) · { ask: brand } a look-alike to confirm · { create: name }
export function resolveName(name, existing) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!normName(clean)) return { none: true };
  const same = existing.find(b => sameName(b.name, clean));
  if (same) return { use: same };
  const like = existing.find(b => looksLike(b.name, clean));
  if (like) return { ask: like, name: clean };
  return { create: clean };
}

// Known brands not already stored, for the "More brands" part of a list.
export const moreBrands = (existing) => KNOWN_BRANDS.filter(n => !existing.some(b => sameName(b.name, n)));
