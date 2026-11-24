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
