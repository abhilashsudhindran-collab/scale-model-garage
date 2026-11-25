// Unit tests for the capture timer (run: node tests/timing.test.mjs). Code logic only, NOT a phone test.
import { newTimer, touch, seconds, IDLE_CAP_MS, paceFromTimes } from '../js/timing.js';

let fails = 0, n = 0;
const eq = (a, b, msg) => { n++; if (a !== b) { fails++; console.log('FAIL', msg, 'got', a, 'want', b); } };

// Time before the first interaction never counts (C4: timer used to start at the previous save).
let t = newTimer();
touch(t, 1_000_000);
eq(seconds(t), 0, 'first touch starts the clock at 0');

// Normal box: interactions over 40 s.
touch(t, 1_010_000); touch(t, 1_025_000); touch(t, 1_040_000);
eq(seconds(t), 40, 'continuous work is counted in full');

// A long pause (e.g. 20 min at the shelf) counts as 5 min at most.
t = newTimer();
touch(t, 0); touch(t, 20 * 60 * 1000); touch(t, 20 * 60 * 1000 + 30_000);
eq(t.activeMs, IDLE_CAP_MS + 30_000, 'a gap is capped at 5 minutes');

// A clock that goes backwards never subtracts time.
t = newTimer();
touch(t, 50_000); touch(t, 40_000);
eq(t.activeMs, 0, 'negative gap ignored');

{ // pace from photo times
  const base = Date.parse('2026-11-28T10:00:00Z');
  const s = (k) => base + k * 1000;
  let p = paceFromTimes([s(0), s(40), s(80), s(140)].map(x => new Date(x).toISOString()));
  eq(JSON.stringify([p.medianSec, p.measured, p.sessions.length, p.sessions[0].boxes]), JSON.stringify([40, 3, 1, 4]), 'one session: 4 boxes, gaps 40/40/60 → median 40 s');
  p = paceFromTimes([s(0), s(30), s(3600), s(3650), s(3700), s(3760)]);
  eq(JSON.stringify([p.sessions.length, p.sessions[1].medianSec, p.medianSec]), JSON.stringify([2, 50, 50]), 'a 1-hour pause starts a new session; gaps 30,50,50,60 → median 50');
  p = paceFromTimes([s(0)]);
  eq(JSON.stringify([p.medianSec, p.measured]), JSON.stringify([null, 0]), 'one box: nothing to measure');
  p = paceFromTimes(['nonsense', s(10), s(0)]);
  eq(p.medianSec, 10, 'bad times ignored, order fixed');
}

console.log(fails ? `${fails} of ${n} timing tests FAILED` : `All ${n} timing tests passed`);
process.exit(fails ? 1 : 0);
