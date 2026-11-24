// Crop / straighten (D14: manual corners + magnifier; D19: done later, never during quick capture).
// Pure maths, no libraries (₹0, no OpenCV): a projective transform (homography) maps the box's four corners,
// as B places them on the photo, to a straight rectangle. The original photo is never changed.

// Solve A·x = b (n×n) by Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('Corners are in a line; move them apart');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// Homography H (row-major 3×3, h33 = 1) with H·from[i] ≈ to[i] for four point pairs [x, y].
export function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}

export function apply(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

// Output size from the quad (corners in order: top-left, top-right, bottom-right, bottom-left), long side capped.
export function outputSize(q, maxSide = 1600) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = (d(q[0], q[1]) + d(q[3], q[2])) / 2, h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
  const s = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

// Corners must form a convex quad in clockwise order from top-left (otherwise the picture would fold).
export function validQuad(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return sign > 0; // clockwise in screen coordinates (y down)
}

// Inverse mapping with bilinear sampling. src: { width, height, data } (RGBA); returns a new RGBA buffer.
export function warp(src, quad, W, H) {
  const Hm = homography([[0, 0], [W, 0], [W, H], [0, H]], quad); // output pixel -> source point
  const out = new Uint8ClampedArray(W * H * 4), sw = src.width, sh = src.height, s = src.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let [u, v] = apply(Hm, x + 0.5, y + 0.5);
      u -= 0.5; v -= 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(u))), y0 = Math.max(0, Math.min(sh - 1, Math.floor(v)));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
      const o = (y * W + x) * 4;
      for (let k = 0; k < 4; k++) {
        const a = s[(y0 * sw + x0) * 4 + k], b = s[(y0 * sw + x1) * 4 + k], c = s[(y1 * sw + x0) * 4 + k], d = s[(y1 * sw + x1) * 4 + k];
        out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
    }
  }
  return out;
}

// Browser only: straighten a photo blob. quad is in the blob's pixel coordinates.
// Returns { cropped (≤1600 px JPEG, uploaded), cropthumb (≤400 px JPEG, phone only), width, height }.
export async function straighten(blob, quad) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); bmp.close?.();
  const src = cx.getImageData(0, 0, c.width, c.height);
  const [W, H] = outputSize(quad, 1600);
  const px = warp(src, quad, W, H);
  const o = document.createElement('canvas'); o.width = W; o.height = H;
  o.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
  const cropped = await new Promise(r => o.toBlob(r, 'image/jpeg', 0.85));
  const ts = Math.min(1, 400 / Math.max(W, H));
  const t = document.createElement('canvas'); t.width = Math.round(W * ts); t.height = Math.round(H * ts);
  t.getContext('2d').drawImage(o, 0, 0, t.width, t.height);
  const cropthumb = await new Promise(r => t.toBlob(r, 'image/jpeg', 0.75));
  return { cropped, cropthumb, width: W, height: H };
}
