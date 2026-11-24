// Unit tests for the AI copy-paste parser (run: node tests/ai.test.mjs). Code logic only, NOT a phone test.
import { buildPrompt, parseAnswer, validCode, brandNote } from '../js/ai.js';

let fails = 0, n = 0;
const eq = (a, b, msg) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fails++; console.log('FAIL', msg, '\n got ', JSON.stringify(a), '\n want', JSON.stringify(b)); } };

const p = buildPrompt([{ brand: 'Mini GT', scale: '1:64' }, { brand: 'Pop Race' }]);
eq(p.includes('Box 2: photo 3 = box front, photo 4 = box back'), true, 'prompt numbers the photos per box');
eq(p.includes('| Box | Car name | Year | Product code | Brand | Colour |'), true, 'prompt asks for a table with known headings');

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

// B's phone, 24 Nov 22:19: Gemini put the brand first, the car name in the code slot, the livery as brand
{
  const B = ['Hot Wheels', 'Mini GT', 'Tarmac Works', 'Pop Race', 'Bburago', 'Kaido House', 'Inno64', 'Majorette'];
  let x = parseAnswer('Box 1 | Kaido House × Mini GT | Nissan Skyline GT-R | Kaido Star Racing V1', 5, B).items[0];
  eq(x.name, 'Nissan Skyline GT-R Kaido Star Racing V1', 'brand in the name slot: car name + livery become the name');
  eq(x.brand, 'Kaido House × Mini GT', 'brand in the name slot: recognised as the brand');
  eq(x.code, '', 'no code given: none invented');
  x = parseAnswer('Box 1 | Kaido House × Mini GT | Nissan Skyline GT-R [R34] Kaido Star Racing V1 | KHMG197', 5, B).items[0];
  eq(x.code, 'KHMG197', 'code found in the last slot');
  eq(x.name, 'Nissan Skyline GT-R [R34] Kaido Star Racing V1', 'name found in the middle slot');
  x = parseAnswer('Box 1 | Mini GT | MGT00123-L | Toyota Supra (A80) 1997', 5, B).items[0];
  eq([x.name, x.code, x.brand].join(' / '), 'Toyota Supra (A80) 1997 / MGT00123-L / Mini GT', 'brand first, name last: sorted');
  x = parseAnswer('Box 1 | Hot Wheels | - | -', 5, B).items[0];
  eq(x.name, '', 'only a brand: no name');
  eq(x.notes.some(n => n.includes('no car name')), true, 'only a brand: noted for the user');
  x = parseAnswer('Box 1 | Toyota GR010 Hybrid 2024 (#7) | 18-38322 | Bburago', 5, B).items[0];
  eq([x.name, x.code, x.brand].join(' / '), 'Toyota GR010 Hybrid 2024 (#7) / 18-38322 / Bburago', 'correct order left as it is');
}

// B's phone, 24 Nov 22:26: same pattern, brand with extras + a long car name in the code slot + event as brand
{
  const B = ['Hot Wheels', 'Mini GT', 'Tarmac Works', 'Pop Race', 'Bburago', 'Kaido House', 'Inno64'];
  const x = parseAnswer('Box 1 | Mini GT (TSM Model) | Chevrolet Corvette Z06 GT3.R #4 | 2025 IMSA Daytona 24 Hrs — Corvette Racing by Pratt Miller Motorsports', 5, B).items[0];
  eq(x.brand, 'Mini GT (TSM Model)', 'brand with "(TSM Model)" recognised as the brand');
  eq(x.code, '', 'a car name is never taken as a code');
  eq(x.name.startsWith('Chevrolet Corvette Z06 GT3.R #4'), true, 'car name starts with the car');
  eq(x.name.includes('Daytona'), true, 'event/livery kept in the name');
  const y = parseAnswer('Box 1 | Mini GT | Chevrolet Corvette Z06 GT3.R #4 | MGT00999-L', 5, B).items[0];
  eq([y.name, y.code].join(' / '), 'Chevrolet Corvette Z06 GT3.R #4 / MGT00999-L', 'brand | car | code order sorted');
}

// B's phone, 24 Nov 22:38: "1995 Presentation" was taken as the code; the real code + barcode went into the name
{
  const B = ['Hot Wheels', 'Mini GT', 'Tarmac Works', 'Pop Race', 'Bburago', 'Kaido House', 'Inno64'];
  const x = parseAnswer('Box 3 | Mini GT (TSM Model) | McLaren F1 GTR | 1995 Presentation | MGT00988 840456393666', 5, B).items[0];
  eq(x.code, 'MGT00988', 'real code chosen, barcode digits dropped');
  eq(x.name, 'McLaren F1 GTR 1995 Presentation', 'year + word stays in the name');
  eq(x.brand, 'Mini GT (TSM Model)', 'brand recognised');
  const y = parseAnswer('Box 1 | Mini GT | McLaren F1 GTR 1995 Presentation | MGT00988 | Mini GT', 5, B).items[0];
  eq([y.name, y.code].join(' / '), 'McLaren F1 GTR 1995 Presentation / MGT00988', 'five parts with brand twice');
  const z = parseAnswer('Box 1 | McLaren F1 GTR 1995 Presentation | MGT00988 | Mini GT', 5, B).items[0];
  eq([z.name, z.code, z.brand].join(' / '), 'McLaren F1 GTR 1995 Presentation / MGT00988 / Mini GT', 'requested order still works');
}

// B's phone, 24 Nov 22:41: barcode digits ended up at the end of the name
{
  const B = ['Hot Wheels', 'Mini GT', 'Bburago', 'Kaido House'];
  for (const line of ['Box 4 | Mini GT (TSM Model) | Toyota Supra VeilSide Combat V-II Red | MGT00999 | 840456311691',
                      'Box 4 | Toyota Supra VeilSide Combat V-II Red 840456311691 | MGT00999 | Mini GT',
                      'Box 4 | Toyota Supra VeilSide Combat V-II Red | MGT00999 840456311691 | Mini GT',
                      'Box 4 | Toyota Supra VeilSide Combat V-II Red (840456311691) | MGT00999 | Mini GT']) {
    const x = parseAnswer(line, 5, B).items[0];
    eq([x.name, x.code].join(' / '), 'Toyota Supra VeilSide Combat V-II Red / MGT00999', 'no barcode in name or code: ' + line.slice(8, 60));
  }
  eq(parseAnswer('Box 1 | Ferrari 499P 2023 #51 | - | Bburago', 5, B).items[0].name, 'Ferrari 499P 2023 #51', 'years and race numbers kept');
}

// B's REAL Gemini reply (24 Nov 22:47): a table with its own headings, extra columns and notes below
{
  const r = parseAnswer(`| Box | Brand | Scale | Car Name | Year | Product Code | Color / Livery | Barcode / UPC |
|---|---|---|---|---|---|---|---|
| Box 1 | MINI GT (TSM Model) | 1:64 | Aston Martin DB10 (007 Spectre) | — | MGT00733 (or similar 007 release; sticker obscured) | Silver | 8 10152 14254 7 (partially blurred) |
| Box 2 | Pop Race | 1:64 | Mazda RX-7 RE-Amemiya | — | PR64-240 | Pink / Dark Blue (RE-Amemiya livery) | PR640240 (internal SKU) |
| Box 3 | Pop Race | 1:64 | Aston Martin Aramco AMR23 | 2023 (AMR23) | PR64-198 | British Racing Green (Aston Martin Aramco F1 Team) | 8 972027 000042 (partially blurred) |
| Box 4 | PARA64 | 1:64 | Cizeta-Moroder V16T (Lights down, LHD) | 1991 | PA-55483 | Rosso Diablo | 0 092999 554839 |
| Box 5 | PARA64 | 1:64 | De Tomaso Pantera (Lights down, LHD) | 1972 | PA-55644 | Red / Black | 0 092999 556446 |
Additional Packaging Notes
 * Box 1: Includes India import sticker (MRP: ₹1999.00, imported April 2026) and official Aston Martin hologram seal (0024727488).
 * Box 4: Marked 2022 Release 3 on the bottom edge; includes India import sticker (MRP: ₹1499.00, imported July 2023).
 * Box 5: Marked 2024 Release 2 on the bottom edge.
`, 5, ['Mini GT', 'Pop Race', 'Para64']);
  eq(r.items.map(i => [i.n, i.name, i.code, i.brand]), [
    [1, 'Aston Martin DB10 (007 Spectre)', '', 'MINI GT (TSM Model)'],
    [2, 'Mazda RX-7 RE-Amemiya', 'PR64-240', 'Pop Race'],
    [3, 'Aston Martin Aramco AMR23 2023', 'PR64-198', 'Pop Race'],
    [4, 'Cizeta-Moroder V16T (Lights down, LHD) 1991', 'PA-55483', 'PARA64'],
    [5, 'De Tomaso Pantera (Lights down, LHD) 1972', 'PA-55644', 'PARA64']], 'real Gemini table: every column read by its heading');
  eq(r.items[0].notes.some(n => n.includes("wasn't sure of the code")), true, 'unsure code ("or similar; sticker obscured") becomes a note, not a code');
  eq(r.items.every(i => !/\d{6,}/.test(i.name)), true, 'no barcode digits in any name');
  eq(r.items[3].colour, 'Rosso Diablo', 'colour column kept for later');
}

console.log(fails ? `${fails} of ${n} AI parser tests FAILED` : `All ${n} AI parser tests passed`);
process.exit(fails ? 1 : 0);
