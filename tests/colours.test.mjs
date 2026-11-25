import { familyFrom, COLOUR_FAMILIES } from '../js/colours.js';
let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (a !== b) { f++; console.log('FAIL', m, '→', JSON.stringify(a), 'expected', JSON.stringify(b)); } };
// From B's real Gemini replies (24 Nov)
eq(familyFrom('Silver'), 'silver', 'Silver');
eq(familyFrom('Pink / Dark Blue (RE-Amemiya livery)'), 'pink', 'first colour named wins');
eq(familyFrom('British Racing Green (Aston Martin Aramco F1 Team)'), 'green', 'British Racing Green');
eq(familyFrom('Rosso Diablo'), 'red', 'Italian rosso');
eq(familyFrom('Red / Black'), 'red', 'Red / Black');
eq(familyFrom('Orange, Motul #2'), 'orange', 'orange');
eq(familyFrom('Red/Gold, #65'), 'red', 'red/gold');
// Others
eq(familyFrom('Gunmetal Grey'), 'grey', 'gunmetal');
eq(familyFrom('Pearl White'), 'white', 'pearl white');
eq(familyFrom('Gulf Blue / Orange'), 'blue', 'Gulf blue first');
eq(familyFrom('Champagne'), 'gold', 'champagne');
eq(familyFrom('-'), '', 'dash = none');
eq(familyFrom(''), '', 'empty = none');
eq(familyFrom('Kaido Star Racing V1'), '', 'a livery name without a colour = none');
eq(COLOUR_FAMILIES.length, 14, '14 families');
console.log(f ? `${f} of ${n} FAILED` : `All ${n} colour tests passed`); process.exit(f ? 1 : 0);
