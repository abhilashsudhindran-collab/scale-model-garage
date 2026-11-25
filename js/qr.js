// QR code for a storage box label (s1-0.33.0). Uses the vendored MIT library qrcode-generator 2.0.4
// (vendor/qrcode, approved by B 25 Nov). Returns an <svg> string drawn from the module grid: crisp in print,
// no canvas, no network.
import qrcode from '../vendor/qrcode/qrcode.mjs';

export function qrMatrix(text, level = 'M') {
  const q = qrcode(0, level); q.addData(String(text)); q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

export function qrSvg(text, { margin = 2, label = 'QR code' } = {}) {
  const m = qrMatrix(text); const n = m.length; const size = n + margin * 2;
  let d = '';
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + margin} ${r + margin}h1v1h-1z`; }));
  const esc = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
