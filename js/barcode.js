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
export async function scanPhoto(file) {
  const { det, engine } = await getDetector();
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(file); }
  try {
    const found = await det.detect(bmp);
    return found.length ? { value: found[0].rawValue, format: found[0].format, engine } : null;
  } finally { bmp.close?.(); }
}
