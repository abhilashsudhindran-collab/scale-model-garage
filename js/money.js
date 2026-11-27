// Orders and money (s1-0.48.0), D12.1. Pure. Every figure is per physical copy and calculated, never stored.
// Unknown stays unknown: a missing price, or another currency with no rate, makes a figure "not computable" (null),
// never ₹0. Totals carry how many copies they cover.

export const EVENT_TYPES = [
  // [transaction_type, label, sets ownership_status to, what the amount means]
  ['SALE', 'Sold', 'Sold', 'Sale price (₹)'],
  ['TRADE_OUT', 'Traded away', 'Traded', 'Agreed value + cash received (₹)'],
  ['GIFT_OUT', 'Gave it away', 'Gifted', ''],
  ['LOSS', 'Lost / missing', 'Missing', 'Insurance or compensation received (₹, optional)'],
  ['REFUND', 'Refund received', '', 'Refund amount (₹)'],
  ['EXPENSE', 'Repair / extra cost', '', 'Cost (₹)'],
];
export const DISPOSALS = new Set(['SALE', 'TRADE_OUT', 'GIFT_OUT', 'LOSS']);
export const eventLabel = (t) => (EVENT_TYPES.find(e => e[0] === t) || [, t])[1];

export const num = (v) => { const s = String(v ?? '').replace(/[₹,\s]/g, ''); return s !== '' && !isNaN(Number(s)) ? Number(s) : null; };
const live = (txs) => txs.filter(t => !t.deleted_at);
// An amount in the copy's currency, or null if it can't be converted (other currency with no rate).
function inBase(t, base) {
  const a = num(t.amount); if (a == null) return null;
  if (!t.currency || !base || t.currency === base) return a;
  const r = num(t.fx_rate); return r ? a * r : null;
}

// Metrics for one copy. txs: transactions of this copy.
export function copyMoney(inv, txs = [], { includeExpenses = false } = {}) {
  const base = inv.currency || 'INR';
  const price = num(inv.purchase_price);
  const extra = num(inv.acquisition_costs) || 0;
  const t = live(txs);
  let refunds = 0, expenses = 0, refundOk = true, expenseOk = true;
  for (const x of t) {
    if (x.transaction_type === 'REFUND') { const a = inBase(x, base); if (a == null) refundOk = false; else refunds += a; }
    if (x.transaction_type === 'EXPENSE') { const a = inBase(x, base); if (a == null) expenseOk = false; else expenses += a; }
  }
  const tac = price == null || !refundOk ? null : price + extra - refunds;
  const disposal = t.filter(x => DISPOSALS.has(x.transaction_type)).sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)))[0] || null;
  let proceeds = null;
  if (disposal) {
    if (disposal.transaction_type === 'GIFT_OUT') proceeds = 0;
    else { const a = inBase(disposal, base); const f = num(disposal.fees) || 0; proceeds = a == null ? (disposal.transaction_type === 'LOSS' && num(disposal.amount) == null ? 0 : null) : a - f; }
  }
  const costBase = tac == null || (includeExpenses && !expenseOk) ? null : tac + (includeExpenses ? expenses : 0);
  const gain = disposal && disposal.transaction_type !== 'GIFT_OUT' && proceeds != null && costBase != null ? proceeds - costBase : null;
  return { price, extra, refunds, expenses: expenseOk ? expenses : null, tac, disposal, proceeds, gain, base: includeExpenses ? 'acquisition cost + repairs' : 'acquisition cost' };
}

// Split an order's shipping/fees over its copies by item price (equal split if any price is missing or zero).
// Shares are rounded to the paisa and always add up exactly to the total.
export function splitByPrice(total, prices) {
  const T = Math.round((num(total) || 0) * 100);
  const n = prices.length; if (!n) return [];
  const p = prices.map(num);
  const weights = p.every(x => x != null && x > 0) ? p : p.map(() => 1);
  const W = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map(w => (T * w) / W);
  const shares = raw.map(Math.floor);
  let left = T - shares.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { shares[i]++; left--; } });
  return shares.map(s => s / 100);
}

// Totals across copies, each with how many copies it covers.
export function totals(rows) { // rows: [{ inv, money }]
  const owned = rows.filter(r => r.inv.ownership_status === 'Owned');
  const withTac = owned.filter(r => r.money.tac != null);
  const sold = rows.filter(r => r.money.disposal && r.money.disposal.transaction_type !== 'GIFT_OUT');
  const soldGain = sold.filter(r => r.money.gain != null);
  return {
    cost: withTac.reduce((a, r) => a + r.money.tac, 0), costKnown: withTac.length, ownedN: owned.length,
    repairs: rows.reduce((a, r) => a + (r.money.expenses || 0), 0),
    proceeds: sold.filter(r => r.money.proceeds != null).reduce((a, r) => a + r.money.proceeds, 0), soldN: sold.length,
    gain: soldGain.reduce((a, r) => a + r.money.gain, 0), gainKnown: soldGain.length,
    gifted: rows.filter(r => r.money.disposal?.transaction_type === 'GIFT_OUT').length,
  };
}
