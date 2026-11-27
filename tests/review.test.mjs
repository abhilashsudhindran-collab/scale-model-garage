// Unit tests for js/review.js (s1-0.46.0).
import { buildReview, shapeOf } from '../js/review.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const brands = [{ brand_id: 'mgt', name: 'Mini GT', record_status: 'confirmed' }, { brand_id: 'mgt2', name: 'Minigt', record_status: 'needs_review' }, { brand_id: 'hw', name: 'Hot Wheels', record_status: 'confirmed' }];
const models = [
  { model_id: 'a', brand_id: 'mgt', product_code: 'MGT00988', display_name: 'McLaren' },
  { model_id: 'b', brand_id: 'mgt', product_code: 'MGT00999', display_name: 'Supra' },
  { model_id: 'c', brand_id: 'mgt', product_code: 'MGT01000', display_name: 'R34' },
  { model_id: 'd', brand_id: 'mgt', product_code: 'KHMG123', display_name: 'Kaido' },
  { model_id: 'e', brand_id: 'mgt2', product_code: '', display_name: 'Odd one' },
  { model_id: 'f', brand_id: 'hw', product_code: 'JKY27', display_name: 'Honda' },
  { model_id: 'g', brand_id: 'hw', product_code: 'jky27', display_name: 'Honda again' },
];
const ids = [{ identifier_type: 'barcode', model_id: 'a', value_cmp: '111' }, { identifier_type: 'barcode', model_id: 'b', value_cmp: '111' }];
const sugg = { e: { notes: ["AI wasn't sure of the code (it said: \"MGT00733 or similar\"). Read it from the box."] } };
const r = buildReview({ models, brands, ids, sugg });
const kinds = r.map(i => i.kind);
eq(kinds, ['brand', 'dupe', 'dupe', 'alike', 'unsure', 'shape'], 'all five kinds, in priority order');
eq(r.find(i => i.kind === 'brand').title, 'Brand not checked: Minigt', 'unchecked brand in use');
eq(r.find(i => i.kind === 'alike').title, 'Same brand? Mini GT / Minigt', 'look-alike brands');
eq(r.find(i => i.kind === 'shape').model_id, 'd', 'KHMG123 is unusual next to three MGT codes');
eq(r.filter(i => i.kind === 'dupe').map(i => i.model_ids.join('+')).sort(), ['a+b', 'f+g'], 'same barcode, and same brand+code (case ignored)');
const dismissedShape = r.find(i => i.kind === 'shape').key;
eq(buildReview({ models, brands, ids, sugg, dismissed: { [dismissedShape]: 1 } }).some(i => i.kind === 'shape'), false, '"Not a problem" hides it');
const changed = models.map(m => (m.model_id === 'd' ? { ...m, product_code: 'KHMG124' } : m));
eq(buildReview({ models: changed, brands, ids, sugg, dismissed: { [dismissedShape]: 1 } }).some(i => i.kind === 'shape'), true, 'a different code brings it back');
eq(buildReview({ models: models.map(m => (m.model_id === 'e' ? { ...m, product_code: 'MGT00733' } : m)), brands, ids, sugg }).some(i => i.kind === 'unsure'), false, 'once a code is typed, the unsure item goes');
eq(buildReview({ models: models.slice(0, 2), brands, ids: [], sugg: {} }).length, 0, 'two codes is too few to judge a pattern; nothing to review');
eq(shapeOf('MGT 00988'), 'AAA99999', 'shape ignores spaces');
console.log(fails ? `${fails} of ${n} review tests FAILED` : `All ${n} review tests passed`);
process.exit(fails ? 1 : 0);
