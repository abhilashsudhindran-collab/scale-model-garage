// Data health (s1-0.43.0): one number for how complete the catalogue is. Pure; the app passes in the checks.
// Each check is [key, label, passes(car)]; the score is the share of all (car × check) ticks that pass,
// so a car missing one thing of nine counts 8/9, not zero.
export function healthScore(cars, checks) {
  const parts = checks.map(([key, label]) => ({ key, label, ok: 0, miss: 0 }));
  let complete = 0;
  for (const c of cars) {
    let all = true;
    checks.forEach(([, , pass], i) => { if (pass(c)) parts[i].ok++; else { parts[i].miss++; all = false; } });
    if (all) complete++;
  }
  const ticks = cars.length * checks.length;
  const ok = parts.reduce((a, p) => a + p.ok, 0);
  const score = ticks ? Math.floor((100 * ok) / ticks) : 0; // floor: 100% only when truly everything is there
  const weakest = parts.filter(p => p.miss).sort((a, b) => b.miss - a.miss || a.label.localeCompare(b.label));
  return { score, complete, total: cars.length, parts, weakest };
}

export const healthWord = (s) => (s >= 95 ? 'Excellent' : s >= 80 ? 'Good' : s >= 60 ? 'Getting there' : 'Needs work');
