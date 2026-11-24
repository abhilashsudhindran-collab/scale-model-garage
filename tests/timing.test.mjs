// Unit tests for the capture timer (run: node tests/timing.test.mjs). Code logic only, NOT a phone test.
import { newTimer, touch, seconds, IDLE_CAP_MS } from '../js/timing.js';

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

console.log(fails ? `${fails} of ${n} timing tests FAILED` : `All ${n} timing tests passed`);
process.exit(fails ? 1 : 0);
