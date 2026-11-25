// Export (brief R6, Stage 7): B's data is never locked in. Two files, made on the phone (₹0, no libraries):
//  - collection CSV: one row per physical copy, friendly columns, opens in Excel / Google Sheets / Numbers;
//  - full ZIP: every tab as its own CSV, exactly the stored columns (the same data as the Google Sheet).
// CSVs start with a UTF-8 byte-order mark so Excel shows ₹ and accented names correctly.

const BOM = '﻿';
// Cells that start with = + - @ could run as formulas in a spreadsheet; prefix them with ' (OWASP CSV injection).
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows) => BOM + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// ---------- a minimal ZIP writer (stored, no compression; CSV text is small) ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// files: [{ name, text }] -> Uint8Array of a .zip
export function zip(files, date = new Date()) {
  const enc = new TextEncoder(), parts = [], central = [];
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((t, a) => t + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((t, a) => t + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ---------- the friendly collection list ----------
// data: { models, inventory, photos, identifiers, brands, scales, boxes } (plain row objects, removed rows excluded)
export function collectionRows(data) {
  const brand = Object.fromEntries(data.brands.map(b => [b.brand_id, b.name]));
  const scale = Object.fromEntries(data.scales.map(s => [s.scale_id, s.label]));
  const model = new Map(data.models.map(m => [m.model_id, m]));
  const barcodes = new Map(); for (const i of data.identifiers) if (i.identifier_type === 'barcode' && i.value_raw) (barcodes.get(i.model_id) || barcodes.set(i.model_id, []).get(i.model_id)).push(i.value_raw);
  const nPhotos = new Map(); for (const p of data.photos) nPhotos.set(p.model_id, (nPhotos.get(p.model_id) || 0) + 1);
  const boxName = new Map(data.boxes.map(b => [String(b.box_label).toLowerCase(), b.box_name || '']));
  const head = ['Name', 'Brand', 'Scale', 'Product code', 'Barcode', 'Variant / colour', 'Colour', 'Series', 'Storage box', 'Box name', 'Box state', 'Condition', 'Box condition', 'Status', 'Price paid', 'Currency', 'Date bought', 'Bought from', 'Photos', 'Entry', 'Notes', 'Model ID', 'Copy ID', 'Added'];
  const rows = [head];
  const copies = data.inventory.filter(i => model.has(i.model_id));
  copies.sort((a, b) => String(model.get(a.model_id).display_name || '~').localeCompare(String(model.get(b.model_id).display_name || '~')));
  for (const c of copies) {
    const m = model.get(c.model_id);
    rows.push([m.display_name, brand[m.brand_id] || m.printed_brand_text, scale[m.scale_id], m.product_code, (barcodes.get(m.model_id) || []).join(' '), m.variant, [m.colour_family ? m.colour_family[0].toUpperCase() + m.colour_family.slice(1) : '', m.colour_name && m.colour_name.toLowerCase() !== (m.colour_family || '') ? m.colour_name : ''].filter(Boolean).join(' · '), m.series,
      c.storage_location, boxName.get(String(c.storage_location || '').toLowerCase()) || '', c.packaging_state, c.condition, c.packaging_condition, c.ownership_status,
      c.purchase_price, c.purchase_price ? (c.currency || 'INR') : '', c.purchase_date, c.purchase_source, nPhotos.get(m.model_id) || 0,
      m.completeness_status === 'complete' ? 'complete' : 'quick', m.notes, m.model_id, c.inventory_id, String(m.created_at || '').slice(0, 10)]);
  }
  // Models with no copy row (shouldn't happen, but never drop data silently)
  const withCopy = new Set(copies.map(c => c.model_id));
  for (const m of data.models) if (!withCopy.has(m.model_id)) rows.push([m.display_name, brand[m.brand_id] || '', scale[m.scale_id] || '', m.product_code, (barcodes.get(m.model_id) || []).join(' '), m.variant, [m.colour_family ? m.colour_family[0].toUpperCase() + m.colour_family.slice(1) : '', m.colour_name && m.colour_name.toLowerCase() !== (m.colour_family || '') ? m.colour_name : ''].filter(Boolean).join(' · '), m.series, '', '', '', '', '', '(no copy)', '', '', '', '', nPhotos.get(m.model_id) || 0, m.completeness_status || 'quick', m.notes, m.model_id, '', String(m.created_at || '').slice(0, 10)]);
  return rows;
}
