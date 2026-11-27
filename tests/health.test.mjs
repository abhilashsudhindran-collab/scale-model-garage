// Unit tests for js/health.js (s1-0.43.0).
import { healthScore, healthWord } from '../js/health.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const checks = [['name', 'Name', c => !!c.name], ['code', 'Code', c => !!c.code], ['box', 'Box', c => !!c.box]];
let r = healthScore([{ name: 1, code: 1, box: 1 }, { name: 1 }, { name: 1, code: 1 }], checks);
eq(r.score, 66, '6 of 9 ticks → 66% (rounded down)');
eq(r.complete, 1, 'one car has everything');
eq(r.weakest.map(p => [p.key, p.miss]), [['box', 2], ['code', 1]], 'weakest first, only those with gaps');
r = healthScore([{ name: 1, code: 1, box: 1 }], checks);
eq([r.score, r.weakest.length], [100, 0], 'everything there → 100%, nothing weak');
r = healthScore(Array.from({ length: 299 }, () => ({ name: 1, code: 1, box: 1 })).concat([{ name: 1, code: 1 }]), checks);
eq(r.score, 99, 'one gap in 900 ticks is not shown as 100%');
eq(healthScore([], checks).score, 0, 'no cars → 0, not 100');
eq([healthWord(96), healthWord(85), healthWord(61), healthWord(10)], ['Excellent', 'Good', 'Getting there', 'Needs work'], 'words');
console.log(fails ? `${fails} of ${n} health tests FAILED` : `All ${n} health tests passed`);
process.exit(fails ? 1 : 0);
