// Unit tests for js/audit.js pure parts (s1-0.31.0 sync check).
import { compareTab, photoVerdict } from '../js/audit.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
let r = compareTab(['a', 'b', 'c'], ['a', 'b', 'c']);
eq([r.sheetRows, r.dupes, r.missing, r.extra], [3, [], [], []], 'all present once');
r = compareTab(['a', 'b', 'c'], ['a', 'a', 'c', '', 'z']);
eq(r.dupes, ['a'], 'duplicate id found');
eq(r.missing, ['b'], 'missing id found');
eq(r.extra, ['z'], 'row not on this phone reported as extra');
eq(r.sheetRows, 4, 'blank ids ignored in the row count');
eq(photoVerdict('x1', { md5Checksum: 'x1', trashed: false }), 'ok', 'photo intact');
eq(photoVerdict('x1', null), 'missing', 'photo missing');
eq(photoVerdict('x1', { md5Checksum: 'x1', trashed: true }), 'trashed', 'photo in the bin');
eq(photoVerdict('x1', { md5Checksum: 'y2', trashed: false }), 'changed', 'photo changed');
eq(photoVerdict('', { md5Checksum: 'y2' }), 'ok', 'no local checksum: existence only');
console.log(fails ? `${fails} of ${n} audit tests FAILED` : `All ${n} audit tests passed`);
process.exit(fails ? 1 : 0);
