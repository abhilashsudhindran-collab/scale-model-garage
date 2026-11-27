// Unit tests for js/sort.js (s1-0.44.0).
import { sortCompare } from '../js/sort.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const cars = [
  { id: 'a', display_name: 'toyota Supra', product_code: 'MGT01000', created_at: '2026-11-24T10:00', b: 'Mini GT', box: 'Box 10' },
  { id: 'b', display_name: '', product_code: '', created_at: '2026-11-25T10:00', b: '', box: '' },
  { id: 'c', display_name: 'Ferrari 250', product_code: 'MGT00988', created_at: '2026-11-23T10:00', b: 'Bburago', box: 'Box 2' },
  { id: 'd', display_name: 'Écurie Ford GT', product_code: 'JKY27', created_at: '2026-11-22T10:00', b: 'Hot Wheels', box: 'Box 2' },
];
const ctx = { brandOf: (m) => m.b, boxOf: (m) => m.box };
const ids = (k) => cars.slice().sort(sortCompare(k, ctx)).map(c => c.id);
eq(ids('newest'), ['b', 'a', 'c', 'd'], 'newest first');
eq(ids('oldest'), ['d', 'c', 'a', 'b'], 'oldest first');
eq(ids('name'), ['d', 'c', 'a', 'b'], 'name A–Z ignores case and accents; nameless last');
eq(ids('code'), ['d', 'c', 'a', 'b'], 'codes in natural order; no code last');
eq(ids('brand'), ['c', 'd', 'a', 'b'], 'brand A–Z; no brand last');
eq(ids('box'), ['d', 'c', 'a', 'b'], 'Box 2 before Box 10; same box by name; no box last');
eq(ids('unknown'), ids('newest'), 'unknown key falls back to newest');
console.log(fails ? `${fails} of ${n} sort tests FAILED` : `All ${n} sort tests passed`);
process.exit(fails ? 1 : 0);
