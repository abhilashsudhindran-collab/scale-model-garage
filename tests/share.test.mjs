// Unit tests for js/share.js (s1-0.49.0).
import { extractCodes, imagesOnly } from '../js/share.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
eq(extractCodes('Mini GT McLaren F1 GTR MGT00988 ₹1,200 1:64').codes, ['MGT00988'], 'product code from a caption; scale and price ignored');
eq(extractCodes('HW Premium jky27 barcode 1 94735 35905 9').barcodes, ['194735359059'], 'spaced barcode joined');
eq(extractCodes('HW Premium jky27').codes, ['JKY27'], 'lower-case code found');
eq(extractCodes('Tarmac T64G-TL001-RE nice').codes, ['T64G-TL001-RE'], 'dashed code kept whole');
eq(extractCodes('just a nice car 2024').codes, [], 'plain words and years are not codes');
eq(imagesOnly([{ type: 'image/jpeg' }, { type: 'text/plain' }, { name: 'x.HEIC', type: '' }]).length, 2, 'only images kept');
console.log(fails ? `${fails} of ${n} share tests FAILED` : `All ${n} share tests passed`);
process.exit(fails ? 1 : 0);
