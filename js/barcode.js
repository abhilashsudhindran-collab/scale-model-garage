// Barcode scanning (R0 4b: Chrome built-in reader ~45 ms, ZXing fallback ~215 ms, 0 misreads in 30).
// Live scan waits ~5 s, then the app offers "Take photo instead" (Part E #20).

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
let detectorP = null;

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load barcode reader')); document.head.append(s); });
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      const use = FORMATS.filter(f => fmts.includes(f));
      if (use.length) return { engine: 'native', det: new window.BarcodeDetector({ formats: use }) };
    } catch { /* fall through to ZXing */ }
  }
  const base = new URL('../vendor/barcode/', import.meta.url);
  await loadScript(new URL('ponyfill.js', base).href);
  const wasmUrl = new URL('zxing_reader.wasm', base).href;
  window.BarcodeDetectionAPI.prepareZXingModule({ overrides: { locateFile: (p, prefix) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } });
  const Z = window.BarcodeDetectionAPI.BarcodeDetector;
  const zf = await Z.getSupportedFormats();
  return { engine: 'zxing', det: new Z({ formats: FORMATS.filter(f => zf.includes(f)) }) };
}

export const getDetector = () => (detectorP ||= makeDetector());

// Live scan into a <video>. Resolves { value, format, engine } or null (stopped / timed out).
export async function liveScan(video, { onTick, timeoutMs = 5000, signal } = {}) {
  const { det, engine } = await getDetector();
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
  await video.play();
  const t0 = performance.now();
  try {
    while (!signal?.aborted) {
      const elapsed = performance.now() - t0;
      onTick?.(elapsed);
      if (elapsed > timeoutMs) return null;
      try {
        const found = await det.detect(video);
        if (found.length) return { value: found[0].rawValue, format: found[0].format, engine, ms: Math.round(elapsed) };
      } catch { /* frame not ready */ }
      await new Promise(r => setTimeout(r, 120));
    }
    return null;
  } finally {
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
}

// Read a barcode from a photo (fallback). Resolves { value, format, engine } or null.
// A photo is read in one pass over the whole picture first. If that finds nothing, the reader retries on zoomed,
// overlapping sections (2×2, then 3×3; never shrunk, small ones enlarged): a slightly blurred barcode in a busy photo
// is often readable on its own section (s1-0.53.0, B 27 Nov: a Para64
// sticker barcode was in the photo but not read). Retries accept only formats with a check digit, so a section can't
// produce a false read; they stop at the first hit or after ~2.5 s. Glare that wipes out the bars can't be fixed here.
const CHECKED = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']);
const RETRY_MS = 2500; // a gallery import waits for each rear photo, so failures must stay cheap

export function sections(w, h) {
  const out = [];
  for (const n of [2, 3]) {
    const ov = 0.25; // sections overlap by a quarter so a barcode on a line between two is whole in one of them
    const sw = w / (n - (n - 1) * ov), sh = h / (n - (n - 1) * ov);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push({ n, x: Math.round(c * sw * (1 - ov)), y: Math.round(r * sh * (1 - ov)), w: Math.round(sw), h: Math.round(sh) });
  }
  return out;
}

function drawSection(bmp, s) {
  // Never shrink a section (that throws away the detail we're after); small sections are enlarged up to 2×.
  const k = Math.max(1, Math.min(2, 1600 / Math.max(s.w, s.h)));
  const cw = Math.max(1, Math.round(s.w * k)), ch = Math.max(1, Math.round(s.h * k));
  const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, s.x, s.y, s.w, s.h, 0, 0, cw, ch);
  return cv;
}

export async function scanPhoto(file, { retry = true } = {}) {
  const { det, engine } = await getDetector();
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(file); }
  try {
    const found = await det.detect(bmp);
    if (found.length) return { value: found[0].rawValue, format: found[0].format, engine };
    if (!retry) return null;
    const t0 = performance.now();
    const secs = sections(bmp.width, bmp.height);
    for (const s of secs) {
      if (performance.now() - t0 > RETRY_MS) return null;
      let hits = [];
      try { hits = await det.detect(drawSection(bmp, s)); } catch { /* section not readable */ }
      const ok = hits.find(x => CHECKED.has(x.format));
      if (ok) return { value: ok.rawValue, format: ok.format, engine, retried: `${s.n}x${s.n}` };
    }
    return null;
  } finally { bmp.close?.(); }
}
