// Crop / straighten maths (js/crop.js). Run: node tests/crop.test.mjs
import { homography, apply, outputSize, validQuad, warp } from '../js/crop.js';
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL ' + m); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// A homography maps its four corner pairs exactly
const from = [[0, 0], [100, 0], [100, 50], [0, 50]], to = [[12, 7], [130, 20], [118, 95], [5, 80]];
const H = homography(from, to);
for (let i = 0; i < 4; i++) { const [u, v] = apply(H, ...from[i]); ok(near(u, to[i][0], 1e-6) && near(v, to[i][1], 1e-6), `corner ${i} maps exactly`); }
// Identity and a plain scale
const I = homography(from, from); ok(near(apply(I, 37, 21)[0], 37) && near(apply(I, 37, 21)[1], 21), 'identity keeps points');
const S = homography(from, from.map(([x, y]) => [2 * x + 3, 2 * y + 5])); ok(near(apply(S, 10, 10)[0], 23) && near(apply(S, 10, 10)[1], 25), 'scale + shift exact inside');
// Straight lines stay straight (midpoint of an edge lands on the mapped edge)
const [mx, my] = apply(H, 50, 0), t = (mx - 12) / (130 - 12); ok(near(my, 7 + t * 13, 1e-6), 'edges stay straight');
// Corners in a line are refused
let threw = false; try { homography(from, [[0, 0], [1, 1], [2, 2], [3, 3]]); } catch { threw = true; } ok(threw, 'collinear corners refused');
// Output size: average edge lengths, long side capped
ok(JSON.stringify(outputSize([[0, 0], [300, 0], [300, 200], [0, 200]])) === '[300,200]', 'output size from edges');
ok(Math.max(...outputSize([[0, 0], [4000, 0], [4000, 3000], [0, 3000]], 1600)) === 1600, 'long side capped at 1600');
// Quad must be convex, clockwise from top-left
ok(validQuad([[0, 0], [10, 0], [10, 10], [0, 10]]), 'clockwise square valid');
ok(!validQuad([[0, 0], [0, 10], [10, 10], [10, 0]]), 'anticlockwise refused');
ok(!validQuad([[0, 0], [10, 10], [10, 0], [0, 10]]), 'crossed (bow-tie) refused');
ok(!validQuad([[0, 0], [10, 0], [2, 2], [0, 10]]), 'dented (not convex) refused');
// Warp: a tilted red square on white comes out as a straight, fully red rectangle
const W = 60, Hh = 60, data = new Uint8ClampedArray(W * Hh * 4).fill(255);
const quad = [[15, 10], [48, 16], [44, 50], [10, 44]];
const Hq = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad), inv = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const [u, v] = apply(inv, x + 0.5, y + 0.5); if (u > 0 && u < 1 && v > 0 && v < 1) { const o = (y * W + x) * 4; data[o + 1] = 0; data[o + 2] = 0; } }
const out = warp({ width: W, height: Hh, data }, quad, 30, 30);
let red = 0; for (let y = 3; y < 27; y++) for (let x = 3; x < 27; x++) { const o = (y * 30 + x) * 4; if (out[o] > 200 && out[o + 1] < 60 && out[o + 2] < 60) red++; }
ok(red === 24 * 24, `warped interior is the straightened square (${red}/576 red)`);
void Hq;
console.log(fails ? `${fails} of ${n} crop tests FAILED` : `All ${n} crop tests passed`);
process.exit(fails ? 1 : 0);
