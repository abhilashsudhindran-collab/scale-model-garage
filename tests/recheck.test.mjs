// s1-0.54.0: re-check barcodes on saved cars — target rules and runner behaviour.
import assert from 'node:assert/strict';
import { recheckTargets, runRecheck, recheckSummary } from '../js/recheck.js';
const models = [
  { model_id: 'a' }, { model_id: 'b' }, { model_id: 'c', barcode_absent: 'yes' }, { model_id: 'd', deleted_at: '2026-11-01' },
  { model_id: 'e' }, { model_id: 'f' }, { model_id: 'g' },
];
const ids = [{ model_id: 'b', identifier_type: 'barcode', value_raw: '123' }, { model_id: 'e', identifier_type: 'barcode', value_raw: '9', deleted_at: 'x' },
  { model_id: 'f', identifier_type: 'second_code', value_raw: '-4B10' }];
const photos = ['a', 'b', 'c', 'd', 'e', 'f'].map(m => ({ photo_id: 'p' + m, model_id: m, shot_role: 'box_rear', original_file_id: 'F' + m }))
  .concat([{ photo_id: 'pgf', model_id: 'g', shot_role: 'box_front' }, { photo_id: 'pax', model_id: 'a', shot_role: 'box_rear', deleted_at: 'x' }]);
const t = recheckTargets(models, ids, photos);
assert.deepEqual(t.map(x => x.model.model_id), ['a', 'e', 'f'], 'no barcode, not marked absent, live, with a rear photo (archived barcode / second code do not count)');
assert.equal(t[0].photo.photo_id, 'pa', 'uses the live rear photo');

const saved = [];
const deps = (over = {}) => ({
  getOriginal: async (p) => (p.photo_id === 'pf' ? null : new Blob(['x'])),
  scan: async () => ({ value: ' 4006381333931 ', format: 'ean_13' }),
  cmp: (r) => r.replace(/\D/g, ''), checkOk: () => true,
  otherOwner: (cmp, mid) => (mid === 'e' ? { model_id: 'zz' } : null),
  save: async (m, f) => saved.push([m.model_id, f.raw, f.cmp, f.format]),
  ...over,
});
const s = await runRecheck(t, deps());
assert.equal(s.found, 2); assert.equal(s.checked, 2); assert.equal(s.missing, 1); assert.equal(s.clash, 1);
assert.deepEqual(saved, [['a', '4006381333931', '4006381333931', 'ean_13'], ['e', '4006381333931', '4006381333931', 'ean_13']], 'trimmed value saved per car');
assert.match(recheckSummary(s), /Found 2 barcodes in 2 photos · 1 also on another car \(see Needs review\) · 1 photo couldn't be fetched/);

saved.length = 0;
const none = []; const s2 = await runRecheck(t, deps({ scan: async () => null, onNone: (p) => none.push(p.photo_id) }));
assert.deepEqual(none, ['pa', 'pe'], 'photos read with nothing found are reported (fetch failures are not)');
assert.equal(s2.found, 0); assert.equal(saved.length, 0, 'nothing found → nothing saved');
const s3 = await runRecheck(t, deps({ scan: async () => { throw new Error('bad image'); } }));
assert.equal(s3.failed, 2, 'a photo that cannot be read is counted, not fatal');
let calls = 0; const s4 = await runRecheck(t, deps({ stopped: () => calls++ >= 1 }));
assert.ok(s4.stopped && s4.checked === 1, 'Stop ends after the current car');
const prog = []; await runRecheck(t, deps({ onProgress: (x) => prog.push(x.i + '/' + x.n) }));
assert.deepEqual(prog, ['1/3', '2/3', '3/3']);
console.log('recheck: all checks passed');
