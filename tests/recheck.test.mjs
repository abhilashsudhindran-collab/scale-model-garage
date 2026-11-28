// s1-0.54.0 / s1-0.59.0: re-check barcodes on saved cars — target rules (all barcode-carrying photos, in order,
// skipping photos already read) and runner behaviour (first barcode wins, stop, summary).
import assert from 'node:assert/strict';
import { recheckTargets, runRecheck, recheckSummary, BARCODE_ROLES } from '../js/recheck.js';
assert.deepEqual(BARCODE_ROLES, ['box_rear', 'label', 'box_back', 'box_bottom', 'box_side', 'box_top']);
const models = [
  { model_id: 'a' }, { model_id: 'b' }, { model_id: 'c', barcode_absent: 'yes' }, { model_id: 'd', deleted_at: '2026-11-01' },
  { model_id: 'e' }, { model_id: 'f' }, { model_id: 'g' }, { model_id: 'h' },
];
const ids = [{ model_id: 'b', identifier_type: 'barcode', value_raw: '123' }, { model_id: 'e', identifier_type: 'barcode', value_raw: '9', deleted_at: 'x' },
  { model_id: 'f', identifier_type: 'second_code', value_raw: '-4B10' }];
const P = (id, m, role, extra = {}) => ({ photo_id: id, model_id: m, shot_role: role, original_file_id: 'F' + id, ...extra });
const photos = [
  P('a_bot', 'a', 'box_bottom'), P('a_rear', 'a', 'box_rear'), P('a_front', 'a', 'box_front'), P('a_old', 'a', 'box_rear', { deleted_at: 'x' }), P('a_car', 'a', 'car_inside'),
  P('b_rear', 'b', 'box_rear'), P('c_rear', 'c', 'box_rear'), P('d_rear', 'd', 'box_rear'),
  P('e_rear', 'e', 'box_rear'), P('f_top', 'f', 'box_top'), P('g_front', 'g', 'box_front'), P('h_rear', 'h', 'box_rear'),
];
const t = recheckTargets(models, ids, photos);
assert.deepEqual(t.map(x => x.model.model_id), ['a', 'e', 'f', 'h'], 'no barcode, not marked absent, live, with a barcode-carrying photo (front-only g left out)');
assert.deepEqual(t[0].photos.map(p => p.photo_id), ['a_rear', 'a_bot'], 'close-up first, then extra sides; front, car and archived photos not read');
assert.deepEqual(t[2].photos.map(p => p.photo_id), ['f_top'], 'a car with only an extra side photo is included');
const t2 = recheckTargets(models, ids, photos, new Set(['a_rear', 'h_rear']));
assert.deepEqual(t2[0].photos.map(p => p.photo_id), ['a_bot'], 'photos already read with nothing found are skipped …');
assert.ok(t2.find(x => x.model.model_id === 'h').done, '… and a car with nothing left to read is marked done');

const saved = [], fetched = [];
const deps = (over = {}) => ({
  getOriginal: async (p) => { fetched.push(p.photo_id); return p.photo_id === 'f_top' ? null : new Blob(['x']); },
  scan: async (b) => ({ value: ' 4006381333931 ', format: 'ean_13' }),
  cmp: (r) => r.replace(/\D/g, ''), checkOk: () => true,
  otherOwner: (cmp, mid) => (mid === 'e' ? { model_id: 'zz' } : null),
  save: async (m, f, p) => saved.push([m.model_id, f.raw, p.photo_id]),
  ...over,
});
const s = await runRecheck(t, deps());
assert.equal(s.found, 3); assert.equal(s.cars, 4); assert.equal(s.missing, 1); assert.equal(s.clash, 1);
assert.deepEqual(saved.map(x => x[0] + ':' + x[2]), ['a:a_rear', 'e:e_rear', 'h:h_rear'], 'first barcode found wins');
assert.ok(!fetched.includes('a_bot'), 'once found, the car\'s other photos are not downloaded');
assert.match(recheckSummary(s), /Found 3 barcodes · 4 cars, 3 photos read · 1 also on another car \(see Needs review\) · 1 photo couldn't be fetched/);

// close-up has nothing → the Bottom photo is tried and its barcode used; the empty close-up is reported
saved.length = 0; fetched.length = 0;
const none = [];
const s2 = await runRecheck([t[0]], deps({ scan: async (b) => (fetched[fetched.length - 1] === 'a_bot' ? { value: '5012345678900', format: 'ean_13' } : null), onNone: (p) => none.push(p.photo_id) }));
assert.deepEqual(saved, [['a', '5012345678900', 'a_bot']], 'barcode on the Bottom photo is found when the close-up has none');
assert.deepEqual(none, ['a_rear']);
assert.equal(s2.checked, 2);

saved.length = 0;
const s3 = await runRecheck(t, deps({ scan: async () => null }));
assert.equal(s3.found, 0); assert.equal(saved.length, 0, 'nothing found → nothing saved');
const s4 = await runRecheck(t, deps({ scan: async () => { throw new Error('bad image'); } }));
assert.equal(s4.failed, 4, 'a photo that cannot be read is counted, not fatal');
let calls = 0; const s5 = await runRecheck(t, deps({ stopped: () => calls++ >= 1 }));
assert.ok(s5.stopped && s5.cars === 1, 'Stop ends after the current car');
const prog = []; await runRecheck(t2, deps({ onProgress: (x) => prog.push(x.i + '/' + x.n) }));
assert.deepEqual(prog, ['1/3', '2/3', '3/3'], 'done cars are not counted');
console.log('recheck: all checks passed');
