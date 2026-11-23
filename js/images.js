// Photo handling (D13.1, D19): keep the original exactly as captured; make a display copy
// (1600 px, JPEG 0.8) and a thumbnail (400 px, JPEG 0.7). Copies are re-drawn on a canvas,
// so they carry NO metadata (no GPS location). Measured on B's phone in Spike 7.
import { md5Blob } from './md5.js';

export function exifInfo(buf) {
  const v = new DataView(buf);
  const out = { hasExif: false, orientation: null, gpsTagCount: 0 };
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return out;
  let p = 2;
  try {
    while (p + 4 <= v.byteLength) {
      const marker = v.getUint16(p); const len = v.getUint16(p + 2);
      if (marker === 0xFFDA) break;
      if (marker === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) {
        out.hasExif = true;
        const t = p + 10; const le = v.getUint16(t) === 0x4949;
        const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
        const ifd0 = u32(4); const n = u16(ifd0);
        for (let i = 0; i < n; i++) {
          const e = ifd0 + 2 + i * 12; const tag = u16(e);
          if (tag === 0x0112) out.orientation = u16(e + 8);
          if (tag === 0x8825) { const g = u32(e + 8); try { out.gpsTagCount = u16(g); } catch { out.gpsTagCount = -1; } }
        }
        break;
      }
      p += 2 + len;
    }
  } catch { /* unreadable EXIF: treat as none */ }
  return out;
}

async function decode(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { return await createImageBitmap(blob); }
}

function toBlob(bitmap, maxSide, type, quality) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not make photo copy'))), type, quality));
}

// Returns everything needed for a PHOTOS row plus the three files.
export async function preparePhoto(file) {
  const bmp = await decode(file);
  const exif = exifInfo(await file.slice(0, 256 * 1024).arrayBuffer());
  const display = await toBlob(bmp, 1600, 'image/jpeg', 0.8);
  const thumb = await toBlob(bmp, 400, 'image/jpeg', 0.7);
  const info = { width: bmp.width, height: bmp.height };
  bmp.close?.();
  const md5 = await md5Blob(file);
  return {
    original: file, display, thumb, md5,
    width: info.width, height: info.height,
    exif_orientation: exif.orientation ?? '',
    original_has_location: exif.gpsTagCount > 0 ? 'yes' : 'no',
    original_bytes: file.size,
    original_filename: file.name || '',
  };
}

// Opens the phone's own camera app (D13: full quality) or the gallery.
export function pickPhoto({ camera = true, multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    if (multiple) input.multiple = true;
    input.addEventListener('change', () => resolve([...input.files]), { once: true });
    input.click();
  });
}
