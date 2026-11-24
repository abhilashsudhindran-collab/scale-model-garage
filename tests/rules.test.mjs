// Unit tests for identity rules (run: node tests/rules.test.mjs). These test code logic only;
// they are NOT phone acceptance tests.
import { codeCmp, barcodeCmp, gtinCheckOk, assignNamespace, duplicateCheckStatus, checkDuplicate, searchMatch } from '../js/rules.js';
import { newId, isId, timePart, seedId } from '../js/ids.js';

let fails = 0, n = 0;
const eq = (a, b, msg) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fails++; console.log('FAIL', msg, 'got', a, 'want', b); } };

// codeCmp: trim + upper only
eq(codeCmp('  mgt01311-l '), 'MGT01311-L', 'codeCmp trims and uppercases');
eq(codeCmp('00567'), '00567', 'codeCmp keeps leading zeros');
eq(codeCmp('#18-38322'), '#18-38322', 'codeCmp keeps punctuation');
eq(codeCmp(null), '', 'codeCmp null');

// barcodeCmp (4b real values)
eq(barcodeCmp('027084120134'), '0027084120134', 'UPC-A to EAN-13');
eq(barcodeCmp('0027084120134'), '0027084120134', 'EAN-13 unchanged');
eq(barcodeCmp('8 40456393215'), '0840456393215', 'spaces ignored');
eq(barcodeCmp('4 893993 383221'), '4893993383221', 'EAN-13 with spaces');

// GTIN check digits (real barcodes from B's boxes, 4b)
for (const b of ['027084120134', '194735338269', '840456393215', '4893993383221', '9581677370722', '6973027529752', '194735367887', '194735359103', '194735359059'])
  eq(gtinCheckOk(b), true, `check digit ok ${b}`);
eq(gtinCheckOk('8140456393215'), false, 'typo from 4b box 6 is caught');
eq(gtinCheckOk('12345'), null, 'non-GTIN length');

// Namespace
const hw = { brand_id: 'brd_HW', record_status: 'confirmed', is_code_namespace: 'yes' };
const newBrand = { brand_id: 'brd_NEW', record_status: 'needs_review', is_code_namespace: 'yes' };
eq(assignNamespace(hw, null), { type: 'brand', id: 'brd_HW', status: 'confirmed' }, 'confirmed brand namespace');
eq(assignNamespace(newBrand, null).status, 'needs_review', 'new brand needs review');
eq(assignNamespace(null, null).status, 'none', 'no brand');
eq(assignNamespace(hw, { line_id: 'lin_KH', is_code_namespace: 'no', record_status: 'confirmed' }).id, 'brd_HW', 'line not a namespace → brand');

// Duplicate rules (brief §8)
const m1 = { model_id: 'mdl_1', brand_id: 'brd_HW', code_namespace_id: 'brd_HW', namespace_status: 'confirmed', product_code: 'HYW58', display_name: 'El Segundo Rallye' };
const m2 = { model_id: 'mdl_2', brand_id: 'brd_MG', code_namespace_id: 'brd_MG', namespace_status: 'confirmed', product_code: 'HYW58', display_name: 'Other' };
const models = [m1, m2];
const cand = (o) => ({ model_id: 'mdl_new', brand_id: 'brd_HW', code_namespace_id: 'brd_HW', namespace_status: 'confirmed', product_code: 'hyw58 ', display_name: '', ...o });
let r = checkDuplicate(cand({}), models);
eq(r.status, 'duplicate', 'same brand + same code (trim/case) = duplicate');
eq(r.exact.map(m => m.model_id), ['mdl_1'], 'exact is m1 only');
eq(r.possible.map(p => p.model.model_id), ['mdl_2'], 'different brand same code = possible only');
r = checkDuplicate(cand({ product_code: 'HYW59' }), models);
eq(r.status, 'no_match', 'same brand different code = not duplicate');
r = checkDuplicate(cand({ product_code: '' }), models);
eq(r.status, 'not_checkable', 'missing code = not checkable');
r = checkDuplicate(cand({ namespace_status: 'needs_review' }), models);
eq(r.status, 'needs_review', 'uncertain brand never a confirmed duplicate');
eq(r.exact.length, 0, 'no exact when needs review');
r = checkDuplicate(cand({ product_code: 'HYW58-N7C5' }), models);
eq(r.status, 'no_match', 'suffix differs = not duplicate');
eq(r.possible.some(p => p.reason.includes('similar code')), true, 'prefix gives possible match');
const ids = [{ identifier_type: 'barcode', model_id: 'mdl_2', value_cmp: '0027084120134' }];
r = checkDuplicate(cand({ product_code: '' }), models, ids, ['0027084120134']);
eq(r.possible.some(p => p.model.model_id === 'mdl_2' && p.reason.includes('barcode')), true, 'same barcode = possible match');
r = checkDuplicate(cand({ product_code: '', display_name: 'El Segundo Rallye' }), models);
eq(r.possible.some(p => p.model.model_id === 'mdl_1'), true, 'similar name = possible');
eq(checkDuplicate(cand({}), [{ ...m1, deleted_at: '2026-01-01' }]).status, 'no_match', 'archived ignored');
eq(duplicateCheckStatus({ product_code: 'X1', namespace_status: 'confirmed', code_namespace_id: 'b' }), 'checkable', 'checkable');

// IDs
const id = newId('models');
eq(isId(id), true, 'id format');
eq(id.startsWith('mdl_'), true, 'id prefix');
eq(timePart(0), '0000000000', 'time part zero');
eq(timePart(1000) < timePart(2000), true, 'time part sorts');
const many = new Set(Array.from({ length: 5000 }, () => newId('photos')));
eq(many.size, 5000, 'ids unique');

eq(seedId('brands','Mini GT'), seedId('brands','Mini GT'), 'seed id deterministic');
eq(isId(seedId('brands','Mini GT')), true, 'seed id valid format');
eq(seedId('brands','Mini GT') !== seedId('brands','Tarmac Works'), true, 'seed ids differ');
// searchMatch (audit G1): queries that returned 0 in the audit now match
const hay = 'Nissan Skyline GT-R R34 PR64-0161 Pop Race 1:64 0194735359103 194735359103';
for (const q of ['skyline', 'gt-r skyline', 'skyline gtr', 'pop race skyline', 'PR64-0161', 'pr64 0161', 'pr640161', '1:64', '1 94735 35910 3']) eq(searchMatch(q, hay), true, 'search finds: ' + q);
eq(searchMatch('ferrari', hay), false, 'search: unrelated word does not match');
eq(searchMatch('skyline ferrari', hay), false, 'search: every word must match');
eq(searchMatch('', hay), true, 'search: empty query matches all');

console.log(fails ? `${fails} of ${n} FAILED` : `All ${n} rule tests passed`);
process.exit(fails ? 1 : 0);
