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

console.log(fails ? `${fails} of ${n} AI parser tests FAILED` : `All ${n} AI parser tests passed`);
process.exit(fails ? 1 : 0);
