// Unit tests for js/wishlist.js (s1-0.42.0).
import { ownedMatches, nameWords, safeUrl, priceNum, priorityRank } from '../js/wishlist.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const cars = [
  { model_id: 'm1', brand_id: 'mgt', product_code: 'MGT00988', display_name: 'McLaren F1 GTR 1995 Presentation' },
  { model_id: 'm2', brand_id: 'hw', product_code: 'JKY27', display_name: 'Honda N600 Custom' },
  { model_id: 'm3', brand_id: 'mgt', product_code: '', display_name: 'Nissan Skyline GT-R R34 V-Spec' },
];
eq(ownedMatches({ product_code: ' mgt00988 ', brand_id: 'mgt' }, cars).map(x => [x.model.model_id, x.reason]), [['m1', 'code']], 'same code, same brand (case and spaces ignored)');
eq(ownedMatches({ product_code: 'MGT00988', brand_id: 'hw' }, cars).length, 0, 'same code but another brand is not a match');
eq(ownedMatches({ product_code: 'JKY27' }, cars).map(x => x.model.model_id), ['m2'], 'no brand on the wish: code alone');
eq(ownedMatches({ object_name: 'Skyline R34' }, cars).map(x => [x.model.model_id, x.reason]), [['m3', 'name']], 'name words all present → hint');
eq(ownedMatches({ object_name: 'Skyline' }, cars).length, 0, 'one word is too little to say');
eq(ownedMatches({ object_name: 'Skyline R33' }, cars).length, 0, 'a different word → no match');
eq(nameWords('The Ford GT, 1:64 edition'), ['ford', 'gt', '1', '64'], 'filler words dropped, the rest kept');
eq(safeUrl('www.example.com/item?id=4'), 'https://www.example.com/item?id=4', 'bare address gets https');
eq(safeUrl('javascript:alert(1)'), '', 'javascript: links refused');
eq(safeUrl('data:text/html,hi'), '', 'data: links refused');
eq(safeUrl('not a link'), '', 'text that is not a link refused');
eq(priceNum('₹1,250'), 1250, 'rupee price with comma');
eq(priceNum('abc'), null, 'words are not a price');
eq(priceNum(''), null, 'empty is no price, not ₹0');
eq(priceNum('-5'), null, 'negative refused');
eq([priorityRank('high'), priorityRank('low'), priorityRank(undefined)], [0, 2, 3], 'priority order');
console.log(fails ? `${fails} of ${n} wishlist tests FAILED` : `All ${n} wishlist tests passed`);
process.exit(fails ? 1 : 0);
