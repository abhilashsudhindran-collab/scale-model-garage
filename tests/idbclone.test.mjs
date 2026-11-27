// s1-0.50.0: the read cache's copy must be a true deep copy (callers may change what they get).
import assert from 'node:assert/strict';
globalThis.indexedDB = globalThis.indexedDB || {}; // idb.js only touches indexedDB when a store is opened
const { _cloneForTest: clone } = await import('../js/idb.js');
const rec = { key: 'models:a', entity: 'models', id: 'a', dirty: 1, data: { name: 'x', n: 2, z: null, e: '' }, sync: { base: { name: 'y', arr: [1, { q: 1 }] } }, conflict: null };
const c = clone(rec);
assert.deepEqual(c, rec);
c.data.name = 'changed'; c.sync.base.arr[1].q = 9; c.sync.base.arr.push(3);
assert.equal(rec.data.name, 'x'); assert.equal(rec.sync.base.arr[1].q, 1); assert.equal(rec.sync.base.arr.length, 2);
const list = [rec, { ...rec, id: 'b' }]; const cl = clone(list);
assert.ok(Array.isArray(cl) && cl.length === 2 && cl[0] !== list[0] && cl[0].data !== list[0].data);
const d = new Date('2026-11-27T00:00:00Z'); const cd = clone({ when: d });
assert.ok(cd.when instanceof Date && cd.when !== d && cd.when.getTime() === d.getTime());
assert.equal(clone(5), 5); assert.equal(clone('s'), 's'); assert.equal(clone(null), null);
console.log('idbclone: all checks passed');
process.exit(0); // idb.js opens a BroadcastChannel, which would keep Node running
