// Collection insights (s1-0.41.0). Pure functions over B's own records: nothing is guessed or fetched.
// Each result says how many cars it is based on, so a half-filled field never looks complete.

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Cars added over time, from the time each car was first photographed (local time).
// Up to 31 days between the first and the last → one column per day (empty days included, so gaps show).
// Longer → one column per month, the last 12 months that have anything.
export function growthSeries(isoTimes) {
  const ds = isoTimes.map(t => new Date(t)).filter(d => !isNaN(d)).sort((a, b) => a - b);
  if (!ds.length) return { unit: 'day', points: [], total: 0 };
  const first = ds[0], last = ds[ds.length - 1];
  const spanDays = Math.round((new Date(dayKey(last)) - new Date(dayKey(first))) / 864e5);
  const count = new Map();
  if (spanDays <= 30) {
    for (const d of ds) count.set(dayKey(d), (count.get(dayKey(d)) || 0) + 1);
    const points = [];
    for (let d = new Date(first.getFullYear(), first.getMonth(), first.getDate()); d <= last; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d);
      points.push({ key: k, label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, n: count.get(k) || 0 });
    }
    return { unit: 'day', points, total: ds.length };
  }
  for (const d of ds) { const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; count.set(k, (count.get(k) || 0) + 1); }
  const points = [...count.keys()].sort().slice(-12).map(k => ({ key: k, label: `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`, n: count.get(k) }));
  return { unit: 'month', points, total: ds.length };
}

// "1995" → "1990s". Years outside 1880–2100 or not 4 digits are left out (counted as unknown).
export function decadeOf(year) {
  const m = String(year ?? '').match(/\b(18[89]\d|19\d\d|20\d\d|2100)\b/);
  return m ? `${Math.floor(Number(m[1]) / 10) * 10}s` : '';
}

// [[label, n], …] biggest first, ties by label.
export function tallyBy(items, keyOf) {
  const m = new Map();
  for (const it of items) { const k = keyOf(it); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

// Share as a whole percent, never 0% when there is at least one.
export const share = (n, of) => (!of ? 0 : Math.max(n ? 1 : 0, Math.round((100 * n) / of)));
