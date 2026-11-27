// s1-0.53.0: photo barcode retry sections must cover the whole photo, overlap, and stay inside it.
import assert from 'node:assert/strict';
const { sections } = await import('../js/barcode.js');
for (const [w, h] of [[4000, 3000], [3000, 4000], [1200, 1600], [37, 11]]) {
  const s = sections(w, h);
  assert.equal(s.length, 4 + 9, 'a 2×2 and a 3×3 grid');
  for (const r of s) { assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0); assert.ok(r.x + r.w <= w + 1 && r.y + r.h <= h + 1, `inside ${w}x${h}: ${JSON.stringify(r)}`); }
  for (const n of [2, 3]) {
    const g = s.filter(r => r.n === n);
    // every sample point is inside at least one section of this grid
    for (let fx = 0; fx <= 1; fx += 0.05) for (let fy = 0; fy <= 1; fy += 0.05) {
      const x = Math.min(w - 1, fx * w), y = Math.min(h - 1, fy * h);
      assert.ok(g.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h), `${n}x${n} covers (${x},${y}) of ${w}x${h}`);
    }
    // neighbours overlap (a barcode on a seam is whole in one section)
    const a = g[0], b = g[1]; assert.ok(b.x < a.x + a.w, `${n}x${n} sections overlap`);
  }
}
console.log('barcodesections: all checks passed');
