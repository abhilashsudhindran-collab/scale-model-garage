// Capture timer (audit finding C4): measures the time spent on ONE box, from its first interaction
// to Save, instead of from the previous save. Gaps between interactions are capped, so a pause at
// the shelf (or leaving the app open) doesn't inflate the figure. Pure functions, unit-tested.

export const IDLE_CAP_MS = 5 * 60 * 1000; // a gap longer than this counts as 5 minutes at most

export const newTimer = () => ({ activeMs: 0, lastTouch: null });

// Record an interaction at `now`. Returns the same timer object.
export function touch(t, now = Date.now(), cap = IDLE_CAP_MS) {
  if (t.lastTouch != null) t.activeMs += Math.min(Math.max(0, now - t.lastTouch), cap);
  t.lastTouch = now;
  return t;
}

export const seconds = (t) => Math.round(t.activeMs / 1000);

// Shooting pace from photo times (Stage 1 check 5, 25 Nov): one time per box (its front photo), in order.
// A gap longer than `breakMs` starts a new session (a pause, another day). Per box = the gap to the next box
// in the same session. Covers Photo run and photos taken with the camera app and imported later.
export const SESSION_BREAK_MS = 10 * 60 * 1000;
const med = (xs) => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };
export function paceFromTimes(times, breakMs = SESSION_BREAK_MS) {
  const t = times.map(x => (typeof x === 'number' ? x : Date.parse(x))).filter(Number.isFinite).sort((a, b) => a - b);
  const sessions = []; let cur = null;
  for (const x of t) {
    if (!cur || x - cur.last > breakMs) { cur = { start: x, last: x, boxes: 1, gaps: [] }; sessions.push(cur); }
    else { cur.gaps.push(Math.round((x - cur.last) / 1000)); cur.last = x; cur.boxes++; }
  }
  const all = sessions.flatMap(s => s.gaps);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null);
  return { medianSec: med(all), avgSec: avg(all), measured: all.length,
    sessions: sessions.filter(s => s.gaps.length).map(s => ({ start: new Date(s.start).toISOString(), boxes: s.boxes, medianSec: med(s.gaps), avgSec: avg(s.gaps), minutes: Math.round((s.last - s.start) / 60000) })) };
}
