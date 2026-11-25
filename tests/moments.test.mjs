// Unit tests for js/moments.js pure parts (s1-0.35.0).
import { nextMilestoneHit, lightsHtml, MILESTONES } from '../js/moments.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
eq(nextMilestoneHit(24, 25), 25, '24 → 25 hits 25');
eq(nextMilestoneHit(25, 30), 0, 'no milestone between 25 and 30');
eq(nextMilestoneHit(20, 120), 100, 'a big import celebrates only the highest milestone crossed (100)');
eq(nextMilestoneHit(100, 100), 0, 'same count: nothing');
eq(MILESTONES[0], 25, 'first milestone is 25');
eq((lightsHtml(0.5).match(/sl r/g) || []).length, 3, 'half way: 3 red lights');
eq((lightsHtml(0).match(/sl r/g) || []).length, 1, 'start: 1 red light');
eq((lightsHtml(1, 'done').match(/sl g/g) || []).length, 5, 'done: 5 green lights');
console.log(fails ? `${fails} of ${n} moments tests FAILED` : `All ${n} moments tests passed`);
process.exit(fails ? 1 : 0);
