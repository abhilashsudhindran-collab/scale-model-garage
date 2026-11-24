// Unit tests for the AI copy-paste parser (run: node tests/ai.test.mjs). Code logic only, NOT a phone test.
import { buildPrompt, parseAnswer, validCode, brandNote } from '../js/ai.js';

let fails = 0, n = 0;
const eq = (a, b, msg) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fails++; console.log('FAIL', msg, '\n got ', JSON.stringify(a), '\n want', JSON.stringify(b)); } };

const p = buildPrompt([{ brand: 'Mini GT', scale: '1:64' }, { brand: 'Pop Race' }]);
eq(p.includes('Box 2: photo 3 = box front, photo 4 = box back'), true, 'prompt numbers the photos per box');
eq(p.includes('Box 1 | car name'), true, 'prompt shows the reply format');

// The format we ask for
let r = parseAnswer('Box 1 | Nissan Skyline GT-R R34 | MGT00341-L | Mini GT\nBox 2 | Toyota AE86 | PR64-0161 | POP RACE', 2);
eq(r.items.map(i => [i.n, i.name, i.code, i.brand]), [[1, 'Nissan Skyline GT-R R34', 'MGT00341-L', 'Mini GT'], [2, 'Toyota AE86', 'PR64-0161', 'POP RACE']], 'standard lines');

// Chatty answer, markdown table, bold, dashes for unreadable, extra lines ignored
r = parseAnswer(`Sure! Here you go:
| Box | Name | Code | Brand |
|---|---|---|---|
| 1 | **Porsche 911 GT3 RS** | - | Tarmac Works |
| 2 | Honda NSX-R | T64G-TL017-SL | Tarmac |
Hope this helps.`, 2);
eq(r.items.map(i => [i.n, i.name, i.code]), [[1, 'Porsche 911 GT3 RS', ''], [2, 'Honda NSX-R', 'T64G-TL017-SL']], 'markdown table, bold and "-"');
eq(r.ignored >= 3, true, 'non-answer lines ignored');

// Number glued to the name, unreadable markers
r = parseAnswer('1. Range Rover 1981 Camel Trophy | n/a | unknown', 1);
eq([r.items[0].name, r.items[0].code, r.items[0].brand], ['Range Rover 1981 Camel Trophy', '', ''], '"1." prefix and n/a/unknown → empty');

// Safety: out-of-range numbers, junk codes, control characters, huge text
r = parseAnswer('Box 7 | Ghost | X1 | Y\nBox 1 | Car\u0007 name | =HYPERLINK("http://x") | Brand', 2);
eq(r.items.length, 1, 'box numbers beyond the batch ignored');
eq(r.items[0].name, 'Car name', 'control characters removed');
eq(r.items[0].code, '', 'formula-like code rejected');
eq(r.items[0].notes.length, 1, 'rejected code noted');
r = parseAnswer('Box 1 | ' + 'A'.repeat(500) + ' | HYW58 | Hot Wheels', 1);
eq(r.items[0].name.length, 120, 'name capped at 120 characters');
eq(parseAnswer('Box 1 | A | B | C\nBox 1 | D | E | F', 1).items[0].name, 'A', 'first answer per box wins');

eq(validCode('#18-38322'), true, 'Bburago code valid');
eq(validCode('MGT01311-L'), true, 'Mini GT code valid');
eq(validCode('<script>'), false, 'markup is not a code');
eq(brandNote('MINI GT', 'Mini GT'), '', 'same brand, different case: no note');
eq(brandNote('Kaido House', 'Mini GT').startsWith('AI read the brand'), true, 'different brand: note only');

// B's real Gemini reply (24 Nov, Toyota GR010): a labelled list, not the requested lines.
const gem = `* Car Name: Toyota GR010 Hybrid (Car #7, Toyota Gazoo Racing)
* Car Year: 2024
* Brand: Bburago (Race series)
* Scale: 1:43
* Product / Item Code: 18-38322
* Manufacture Date: 04/2026
* MRP: ₹ 1,750.00
* Importer: Creative Education (Bangalore)`;
r = parseAnswer(gem, 1);
eq(r.items.length, 1, 'Gemini labelled list: one box found');
eq(r.items[0].name, 'Toyota GR010 Hybrid 2024 (Car #7, Toyota Gazoo Racing)', 'Gemini list: name with year');
eq(r.items[0].code, '18-38322', 'Gemini list: product code');
eq(r.items[0].brand, 'Bburago (Race series)', 'Gemini list: brand (importer ignored)');
eq(brandNote(r.items[0].brand, 'Bburago'), '', 'Gemini list: same brand, no note');
const gemTags = `○ Car Name: Toyota GR010 Hybrid (Car #7, Toyota Gazoo Racing) box1-front.jpg
○ Brand: Bburago (Race series) box1-front.jpg +1
○ Product / Item Code: 18-38322 box1-back.jpg`;
r = parseAnswer(gemTags, 1);
eq(r.items[0].code, '18-38322', 'photo-name tags removed from values');
eq(r.items[0].brand, 'Bburago (Race series)', 'tag "+1" removed');
// Several boxes, labelled, with headings or only photo tags
r = parseAnswer(`**Box 1**\n- Car Name: Nissan Skyline\n- Product Code: MGT00341-L\n\n**Box 2:**\n- Model: Supra A80\n- Item No: KHMG001`, 2);
eq(r.items.map(i => i.code).join(','), 'MGT00341-L,KHMG001', 'labelled list with Box headings');
r = parseAnswer(`Car Name: Civic box2-front.jpg\nCode: 64-123 box2-back.jpg`, 3);
eq(r.items[0].n, 2, 'photo tag assigns the box when there are no headings');
eq(parseAnswer('Car Name: Civic', 3).items.length, 0, 'several boxes and no box marker: not guessed');
eq(parseAnswer('Box 1 | Supra | 64-1 | Mini GT\nCar Name: Other', 1).items[0].name, 'Supra', 'requested lines win over a labelled list');

console.log(fails ? `${fails} of ${n} AI parser tests FAILED` : `All ${n} AI parser tests passed`);
process.exit(fails ? 1 : 0);
