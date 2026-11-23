import { md5Bytes } from '../js/md5.js';
import { createHash, randomBytes } from 'node:crypto';
let fails = 0;
const sizes = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 65536, 3_000_001];
for (const n of sizes) {
  const b = randomBytes(n);
  const a = md5Bytes(new Uint8Array(b)), e = createHash('md5').update(b).digest('hex');
  if (a !== e) { fails++; console.log('FAIL', n, a, e); }
}
for (const s of ['', 'abc', 'The quick brown fox jumps over the lazy dog']) {
  const a = md5Bytes(new TextEncoder().encode(s)), e = createHash('md5').update(s).digest('hex');
  if (a !== e) { fails++; console.log('FAIL', JSON.stringify(s)); }
}
console.log(fails ? `${fails} failures` : `md5: all ${sizes.length + 3} cases match node:crypto`);
process.exit(fails ? 1 : 0);
