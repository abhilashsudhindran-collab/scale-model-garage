// Unit tests for js/lines.js (s1-0.47.0).
import { suggestLine, cleanLineName } from '../js/lines.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const tw = [{ line_id: 'h', name: 'Hobby64', code_prefix_hint: 'T64-' }, { line_id: 'g', name: 'Global64', code_prefix_hint: 'T64G-' }, { line_id: 's', name: 'Silver', code_prefix_hint: '' }];
eq(suggestLine('T64G-TL001-RE', tw)?.name, 'Global64', 'longer code start wins');
eq(suggestLine('t64-042-gr', tw)?.name, 'Hobby64', 'case ignored');
eq(suggestLine('MGT00988', tw), null, 'no match → no hint');
eq(suggestLine('', tw), null, 'no code → no hint');
eq(suggestLine('KHMG123', [{ name: 'Kaido House', code_prefix_hint: 'KHMG' }])?.name, 'Kaido House', 'Kaido House from KHMG');
eq(suggestLine('ABC1', [{ name: 'A', code_prefix_hint: 'AB' }, { name: 'B', code_prefix_hint: 'AB' }]), null, 'two lines with the same start → no guess');
eq(cleanLineName('  Silver   Series '), 'Silver Series', 'spaces tidied');
console.log(fails ? `${fails} of ${n} lines tests FAILED` : `All ${n} lines tests passed`);
process.exit(fails ? 1 : 0);
