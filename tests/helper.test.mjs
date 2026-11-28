// Unit tests for js/helper.js (Helper mode, D32): lookup file contents, per-box inbox, import plan.
import { buildLookup, boxRecords, helperBoxes, planImport, applyPlan, unzip, fileText, isOwn, cleanInboxRecord } from '../js/helper.js';
import { isId } from '../js/ids.js';
import { zip } from '../js/export.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const ok = (c, msg) => eq(!!c, true, msg);

// ---- ZIP round trip with text and binary
const bin = new Uint8Array([0, 255, 1, 2, 3, 128]);
const files = unzip(zip([{ name: 'manifest.json', text: '{"a":"ポルシェ"}' }, { name: 'photos/x.jpg', bytes: bin }]));
eq(files.map(f => f.name), ['manifest.json', 'photos/x.jpg'], 'unzip lists both files');
eq(JSON.parse(fileText(files, 'manifest.json')).a, 'ポルシェ', 'text survives (non-English)');
eq([...files[1].bytes], [...bin], 'binary photo bytes survive');
let threw = false; try { unzip(new Uint8Array([1, 2, 3])); } catch { threw = true; }
ok(threw, 'a non-ZIP file is refused');

// ---- lookup: no money, no archived rows, one photo per car
const brands = [{ brand_id: 'brd_A', name: 'Mini GT', record_status: 'confirmed', is_code_namespace: 'yes' }, { brand_id: 'brd_B', name: 'Hot Wheels', record_status: 'confirmed', is_code_namespace: 'yes' }];
const models = [
  { model_id: 'mdl_1', brand_id: 'brd_A', product_code: 'MGT00988', product_code_cmp: 'MGT00988', code_namespace_id: 'brd_A', namespace_status: 'confirmed', display_name: 'McLaren F1 GTR', primary_photo_id: 'pho_1f', car_note: 'Won Le Mans', notes: 'private note' },
  { model_id: 'mdl_2', brand_id: 'brd_B', product_code: 'JKY27', code_namespace_id: 'brd_B', namespace_status: 'confirmed', display_name: 'Honda N600' },
  { model_id: 'mdl_3', brand_id: 'brd_B', display_name: 'archived one', deleted_at: '2026-11-01' },
];
const inventory = [
  { inventory_id: 'inv_1', model_id: 'mdl_1', ownership_status: 'Owned', storage_location: 'Box 1', purchase_price: '1200', purchase_source: 'WhatsApp group', notes: 'gift from x' },
  { inventory_id: 'inv_2', model_id: 'mdl_2', ownership_status: 'Owned', storage_location: 'Box 2', purchase_price: '299' },
  { inventory_id: 'inv_s', model_id: 'mdl_2', ownership_status: 'Sold', storage_location: '' },
];
const photos = [{ photo_id: 'pho_1f', model_id: 'mdl_1', shot_role: 'box_front', original_file_id: 'drive1', original_has_location: 'yes' }, { photo_id: 'pho_1r', model_id: 'mdl_1', shot_role: 'box_rear' }, { photo_id: 'pho_2f', model_id: 'mdl_2', shot_role: 'box_front' }];
const L = buildLookup({ brands, models, inventory, photos, product_identifiers: [{ identifier_id: 'pid_1', model_id: 'mdl_2', identifier_type: 'barcode', value_raw: '194735359059', value_cmp: '0194735359059' }],
  storage_boxes: [{ storage_box_id: 'sbx_1', box_label: '1', box_name: 'Mini GT', notes: 'top shelf at home' }], orders: [{ order_id: 'ord_1' }], transactions: [{ transaction_id: 'trx_1', amount: '500' }], aliases: [], scales: [], categories: [], product_lines: [] });
const txt = JSON.stringify(L.tables);
ok(!/1200|299|WhatsApp group|gift from x|purchase_price|purchase_source/.test(txt), 'no prices, sellers or copy notes in the lookup file');
ok(!/Won Le Mans|private note|top shelf/.test(txt), 'no car notes, model notes or box notes');
ok(!('orders' in L.tables) && !('transactions' in L.tables), 'no orders or money events');
eq(L.tables.models.map(m => m.model_id), ['mdl_1', 'mdl_2'], 'archived cars left out');
eq(L.tables.inventory.map(i => i.inventory_id), ['inv_1', 'inv_2'], 'only owned copies (sold one left out)');
eq(L.photoIds, ['pho_1f', 'pho_2f'], 'one box-front photo per car');
ok(!/drive1|original_has_location/.test(JSON.stringify(L.tables.photos)), 'photo rows carry no Drive IDs or location flags');

// ---- helper phone: own rows per box
const rec = (entity, data, extra = {}) => ({ entity, id: data[{ models: 'model_id', inventory: 'inventory_id', photos: 'photo_id', product_identifiers: 'identifier_id', brands: 'brand_id', storage_boxes: 'storage_box_id', product_lines: 'line_id' }[entity]], data: { updated_at: 't1', ...data }, dirty: 1, ...extra });
const H = [
  ...L.tables.models.map(m => rec('models', m, { dirty: 0, lookup: true })),
  ...L.tables.inventory.map(m => rec('inventory', m, { dirty: 0, lookup: true })),
  rec('brands', { brand_id: 'brd_SEED1', name: 'Tomica' }, { seed: true }),
  rec('brands', { brand_id: 'brd_H1', name: 'Para64' }),
  rec('brands', { brand_id: 'brd_H2', name: 'mini-gt' }),
  rec('models', { model_id: 'mdl_h1', brand_id: 'brd_H1', display_name: 'Ford Bronco', product_code: 'PA-65370' }),
  rec('inventory', { inventory_id: 'inv_h1', model_id: 'mdl_h1', storage_location: 'Box 3', ownership_status: 'Owned' }),
  rec('photos', { photo_id: 'pho_h1f', model_id: 'mdl_h1', shot_role: 'box_front', inventory_id: '' }),
  rec('photos', { photo_id: 'pho_h1r', model_id: 'mdl_h1', shot_role: 'box_rear', inventory_id: '' }),
  rec('product_identifiers', { identifier_id: 'pid_h1', model_id: 'mdl_h1', identifier_type: 'barcode', value_cmp: '0092999556446' }),
  rec('models', { model_id: 'mdl_h2', brand_id: 'brd_H2', display_name: 'McLaren F1 GTR', product_code: 'mgt00988' }),
  rec('inventory', { inventory_id: 'inv_h2', model_id: 'mdl_h2', storage_location: 'Box 3', ownership_status: 'Owned' }),
  rec('inventory', { inventory_id: 'inv_h3', model_id: 'mdl_2', storage_location: 'Box 3', ownership_status: 'Owned' }), // ＋1 of B's Honda
  rec('photos', { photo_id: 'pho_h3f', model_id: 'mdl_2', inventory_id: 'inv_h3', shot_role: 'box_front' }),
  rec('models', { model_id: 'mdl_h9', brand_id: 'brd_A', display_name: 'Elsewhere' }),
  rec('inventory', { inventory_id: 'inv_h9', model_id: 'mdl_h9', storage_location: 'Box 4', ownership_status: 'Owned' }),
  rec('storage_boxes', { storage_box_id: 'sbx_h4', box_label: '4' }),
];
ok(!isOwn(H[0]) && !isOwn(H.find(r => r.seed)) && isOwn(H.find(r => r.id === 'mdl_h1')), 'own = changed here, not from the lookup or starter lists');
const boxes = helperBoxes(H);
eq(boxes.map(b => [b.label, b.cars, b.copies, b.photos]), [['Box 3', 2, 3, 3], ['Box 4', 1, 1, 0]], 'boxes to send: Box 3 (2 new cars + a copy of B\'s car), Box 4');
const b3 = boxRecords(H, 'Box 3');
const ents = b3.records.map(r => `${r.entity}:${r.data[Object.keys(r.data).find(k => k.endsWith('_id'))]}`);
ok(ents.includes('brands:brd_H1') && ents.includes('brands:brd_H2') && !ents.some(e => e.includes('SEED')), 'new brands the cars use are sent; starter brands are not');
ok(!ents.includes('models:mdl_2') && b3.records.some(r => r.data.inventory_id === 'inv_h3'), 'B\'s own car is not sent back, only the new copy');
ok(!ents.includes('models:mdl_h9'), 'cars in another box are not included');
eq(b3.photoIds.sort(), ['pho_h1f', 'pho_h1r', 'pho_h3f'], 'the box\'s photos go with it');
ok(boxRecords(H, 'Box 4').records.some(r => r.entity === 'storage_boxes'), 'a box the helper made is sent with its cars');
const sig1 = b3.signature;
H.find(r => r.id === 'mdl_h1').data.updated_at = 't2';
ok(boxRecords(H, 'Box 3').signature !== sig1, 'editing a car after sending changes the box signature (shows "changed since sent")');

// ---- B imports Box 3
const pkg = { manifest: { kind: 'smg-helper-inbox' }, records: boxRecords(H, 'Box 3').records };
const live = { models, inventory, brands, product_identifiers: [{ identifier_id: 'pid_1', model_id: 'mdl_2', identifier_type: 'barcode', value_cmp: '0194735359059' }], product_lines: [], storage_boxes: [{ box_label: '1' }, { box_label: '2' }], aliases: [], photos };
const plan = planImport(pkg, live);
const row = (pred) => plan.rows.find(pred);
eq(plan.brands.map(b => b.use || (b.create ? 'new' : '')), ['new', 'Mini GT'], 'Para64 is a new brand; "mini-gt" is B\'s Mini GT');
const mc = row(r => r.model?.model_id === 'mdl_h2');
eq([mc.status, mc.choice, mc.target, mc.model.brand_id], ['duplicate', 'copy', 'mdl_1', 'brd_A'], 'same code + same brand as B\'s McLaren → offered as a copy (B decides)');
const br = row(r => r.model?.model_id === 'mdl_h1');
eq([br.status, br.choice], ['new', 'new'], 'Bronco is new');
eq(plan.brands.find(b => b.create).data.record_status, 'needs_review', 'a brand from a helper waits for B\'s check');
const cp = row(r => r.kind === 'copy');
eq([cp.status, cp.target], ['copy', 'mdl_2'], 'the ＋1 on B\'s Honda imports as a copy');
const ap = applyPlan(plan);
eq([ap.cars, ap.copies], [1, 3], 'imports 1 new car, 3 copies (Bronco, McLaren copy, Honda copy)');
const mcInv = ap.records.find(r => r.entity === 'inventory' && r.data.inventory_id === 'inv_h2');
eq(mcInv.data.model_id, 'mdl_1', 'McLaren copy is attached to B\'s McLaren');
ok(!ap.records.some(r => r.entity === 'models' && r.data.model_id === 'mdl_h2'), 'no second McLaren record');
ok(ap.records.filter(r => r.entity === 'photos' && r.data.model_id === 'mdl_1').every(r => r.data.is_primary === 'no'), 'copy photos never replace the car\'s main photo');
ok(ap.records.some(r => r.entity === 'brands' && r.data.name === 'Para64') && !ap.records.some(r => r.entity === 'brands' && r.data.name === 'mini-gt'), 'only the truly new brand is added');
// skip everything → nothing stored
const plan2 = planImport(pkg, live); plan2.rows.forEach(r => { r.choice = 'skip'; });
eq(applyPlan(plan2).records.length, 0, 'skipping every car stores nothing (not even the new brand)');
// importing again after it went in → "already"
const live2 = { ...live, models: [...models, br.model], inventory: [...inventory, ...ap.records.filter(r => r.entity === 'inventory').map(r => r.data)] };
const plan3 = planImport(pkg, live2);
ok(plan3.rows.every(r => r.status === 'already' && r.choice === 'skip'), 'the same file imported twice adds nothing');

// ---- a box file can't overwrite B's rows or add unknown fields
const cols = (e) => ({ photos: ['photo_id', 'model_id', 'original_file_id', 'shot_role', 'created_at', 'updated_at', 'version', 'deleted_at'], models: ['model_id', 'display_name', 'deleted_at'], orders: ['order_id'] })[e] || ['x'];
const pid = 'pho_01JH7Q3K8M4X2B9ZQW5RT6YV0N';
const c1 = cleanInboxRecord({ entity: 'photos', data: { photo_id: pid, original_file_id: 'someone-elses-file', evil: '1', shot_role: { a: 1 } } }, cols, isId);
eq([c1.data.original_file_id, 'evil' in c1.data, c1.data.shot_role], ['', false, ''], 'Drive IDs cleared, unknown fields dropped, objects emptied');
eq(cleanInboxRecord({ entity: 'orders', data: { order_id: 'ord_01JH7Q3K8M4X2B9ZQW5RT6YV0N' } }, cols, isId), null, 'orders/money rows are never accepted from a box file');
eq(cleanInboxRecord({ entity: 'models', data: { model_id: 'not-an-id' } }, cols, isId), null, 'a malformed ID is refused');
eq(cleanInboxRecord({ entity: 'models', data: { model_id: 'mdl_01JH7Q3K8M4X2B9ZQW5RT6YV0N', deleted_at: 'x' } }, cols, isId).data.deleted_at, '', 'an imported car is never archived on arrival');
const clash = planImport({ records: [{ entity: 'models', data: { model_id: 'mdl_new', brand_id: 'brd_A', display_name: 'Clash test' } }, { entity: 'inventory', data: { inventory_id: 'inv_1', model_id: 'mdl_new' } }, { entity: 'inventory', data: { inventory_id: 'inv_ok', model_id: 'mdl_new' } }] }, live);
const cr = applyPlan(clash).records.filter(r => r.entity === 'inventory').map(r => r.data.inventory_id);
eq(cr, ['inv_ok'], 'a copy row with the ID of one of B\'s copies is dropped, never written over');

console.log(fails ? `${fails} of ${n} FAILED` : `All ${n} helper tests passed`);
process.exit(fails ? 1 : 0);
