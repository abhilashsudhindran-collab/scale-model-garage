// Share into the app (s1-0.49.0, D16). Pure helpers. Shared photos and text arrive through the Android share sheet
// (manifest share_target → service worker → #/share); nothing leaves the phone.

// Codes and barcodes inside shared text (a WhatsApp caption, a listing title). Hints for a search only.
export function extractCodes(text) {
  const t = String(text || '').toUpperCase();
  const barcodes = [...new Set((t.match(/\b\d[\d ]{6,16}\d\b/g) || []).map(s => s.replace(/\s+/g, '')).filter(s => s.length >= 8 && s.length <= 14))];
  const codes = [...new Set((t.match(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{3,15}\b/g) || [])
    .filter(c => !/^\d+$/.test(c) && !/^(1:\d+|\d+(MM|CM|PCS|RS|INR))$/.test(c)))];
  return { codes, barcodes };
}

// Keep only image files (the share sheet can also hand over other types).
export const imagesOnly = (files) => files.filter(f => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || ''));
