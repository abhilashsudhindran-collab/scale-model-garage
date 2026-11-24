// Export helpers (js/export.js). Run: node tests/export.test.mjs
import { csvCell, toCsv, crc32, zip, collectionRows } from '../js/export.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL ' + m); } };

ok(csvCell('plain') === 'plain', 'plain cell unchanged');
ok(csvCell('a,b') === '"a,b"', 'comma quoted');
ok(csvCell('say "hi"') === '"say ""hi"""', 'quotes doubled');
ok(csvCell('two\nlines') === '"two\nlines"', 'newline quoted');
ok(csvCell('=HYPERLINK("x")') === `"'=HYPERLINK(""x"")"`, 'formula neutralised');
ok(csvCell('-5') === "'-5" && csvCell('+91') === "'+91" && csvCell('@x') === "'@x", 'leading - + @ neutralised');
ok(csvCell(null) === '' && csvCell(0) === '0', 'empty and zero');
ok(toCsv([['a', '₹1,750']]).startsWith('﻿a,"₹1,750"\r\n'), 'BOM + CRLF + quoting');
ok(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'crc32 check value');

// The zip opens with the system unzip and holds the right files
const dir = mkdtempSync(join(tmpdir(), 'smgzip-'));
const bytes = zip([{ name: 'MODELS.csv', text: toCsv([['model_id', 'display_name'], ['mdl_1', 'Skyline ₹']]) }, { name: 'INVENTORY.csv', text: 'x\r\n' }]);
writeFileSync(join(dir, 'a.zip'), bytes);
let listing = '';
try { listing = execFileSync('unzip', ['-l', join(dir, 'a.zip')]).toString(); execFileSync('unzip', ['-t', join(dir, 'a.zip')]); } catch (e) { listing = 'ERR ' + e.message; }
ok(listing.includes('MODELS.csv') && listing.includes('INVENTORY.csv'), `zip lists both files (${listing.split('\n').slice(3, 5).join(' | ')})`);
const inner = execFileSync('unzip', ['-p', join(dir, 'a.zip'), 'MODELS.csv']).toString();
ok(inner.includes('Skyline ₹'), 'zip content intact (UTF-8)');

// Collection rows: one per copy, names resolved, nothing dropped
const data = {
  brands: [{ brand_id: 'b1', name: 'Mini GT' }], scales: [{ scale_id: 's1', label: '1:64' }],
  models: [{ model_id: 'm1', brand_id: 'b1', scale_id: 's1', display_name: 'Skyline', product_code: 'MGT1', created_at: '2026-11-24T10:00:00Z' }, { model_id: 'm2', brand_id: 'b1', scale_id: 's1', display_name: 'NSX' }],
  inventory: [{ inventory_id: 'i1', model_id: 'm1', ownership_status: 'Owned', storage_location: 'Box 3', purchase_price: '1750' }, { inventory_id: 'i2', model_id: 'm1', ownership_status: 'Owned', storage_location: 'Box 4' }],
  photos: [{ model_id: 'm1' }, { model_id: 'm1' }], identifiers: [{ model_id: 'm1', identifier_type: 'barcode', value_raw: '4006381333931' }],
  boxes: [{ box_label: 'Box 3', box_name: 'JDM' }],
};
const rows = collectionRows(data);
ok(rows.length === 4, `header + 2 copies + 1 model without a copy (${rows.length})`);
const h = rows[0], r1 = rows.find(r => r[h.indexOf('Copy ID')] === 'i1');
ok(r1[h.indexOf('Brand')] === 'Mini GT' && r1[h.indexOf('Scale')] === '1:64' && r1[h.indexOf('Box name')] === 'JDM' && r1[h.indexOf('Photos')] === 2 && r1[h.indexOf('Barcode')] === '4006381333931', 'names, box name, photo count, barcode resolved');
ok(r1[h.indexOf('Currency')] === 'INR' && rows.find(r => r[h.indexOf('Copy ID')] === 'i2')[h.indexOf('Currency')] === '', 'currency only where a price exists');
ok(rows.some(r => r[h.indexOf('Status')] === '(no copy)'), 'a model without a copy is still listed');
console.log(fails ? `${fails} of ${n} export tests FAILED` : `All ${n} export tests passed`);
process.exit(fails ? 1 : 0);
