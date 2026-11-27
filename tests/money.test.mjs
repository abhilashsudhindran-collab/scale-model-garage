// Unit tests for js/money.js (s1-0.48.0), D12.1.
import { copyMoney, splitByPrice, totals, num } from '../js/money.js';
let n = 0, fails = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const inv = { purchase_price: '1000', acquisition_costs: '150', currency: 'INR', ownership_status: 'Owned' };
let m = copyMoney(inv);
eq([m.tac, m.disposal, m.gain], [1150, null, null], 'acquisition cost = price + shipping; nothing sold');
m = copyMoney(inv, [{ transaction_type: 'REFUND', amount: '200' }, { transaction_type: 'EXPENSE', amount: '300' }]);
eq([m.tac, m.expenses], [950, 300], 'refund lowers acquisition cost; repairs shown apart and never change it');
m = copyMoney({ ...inv, ownership_status: 'Sold' }, [{ transaction_type: 'SALE', amount: '2000', fees: '100', transaction_date: '2026-11-20' }, { transaction_type: 'EXPENSE', amount: '300' }]);
eq([m.proceeds, m.gain, m.base], [1900, 750, 'acquisition cost'], 'net proceeds − acquisition cost (repairs left out by default)');
eq(copyMoney({ ...inv }, [{ transaction_type: 'SALE', amount: '2000', fees: '100' }, { transaction_type: 'EXPENSE', amount: '300' }], { includeExpenses: true }).gain, 450, 'with the setting on, repairs join the cost base');
m = copyMoney({ purchase_price: '', currency: 'INR' }, [{ transaction_type: 'SALE', amount: '500' }]);
eq([m.tac, m.proceeds, m.gain], [null, 500, null], 'unknown price → cost and gain not computable, never ₹0');
m = copyMoney(inv, [{ transaction_type: 'SALE', amount: '50', currency: 'USD' }]);
eq([m.proceeds, m.gain], [null, null], 'another currency with no rate → not computable');
eq(copyMoney(inv, [{ transaction_type: 'SALE', amount: '50', currency: 'USD', fx_rate: '84' }]).proceeds, 4200, 'with a rate it converts');
m = copyMoney(inv, [{ transaction_type: 'GIFT_OUT' }]);
eq([m.proceeds, m.gain], [0, null], 'gift: no proceeds, not shown as a loss');
eq(copyMoney(inv, [{ transaction_type: 'SALE', amount: '2000', deleted_at: 'x' }]).disposal, null, 'undone events are ignored');
eq(splitByPrice(300, [1000, 500, 1500]), [100, 50, 150], 'shipping split by price');
eq(splitByPrice(100, [1000, '', 500]), [33.34, 33.33, 33.33], 'a missing price → equal split, adds up exactly');
eq(splitByPrice(10, [1, 1, 1]).reduce((a, b) => a + b, 0), 10, 'shares always add up to the total');
eq(num('₹1,250'), 1250, 'rupee text');
const t = totals([
  { inv: { ownership_status: 'Owned' }, money: { tac: 1150, expenses: 0 } },
  { inv: { ownership_status: 'Owned' }, money: { tac: null, expenses: 0 } },
  { inv: { ownership_status: 'Sold' }, money: { tac: 900, expenses: 100, disposal: { transaction_type: 'SALE' }, proceeds: 1900, gain: 1000 } },
]);
eq([t.cost, t.costKnown, t.ownedN, t.repairs, t.proceeds, t.soldN, t.gain, t.gainKnown], [1150, 1, 2, 100, 1900, 1, 1000, 1], 'totals with coverage');
console.log(fails ? `${fails} of ${n} money tests FAILED` : `All ${n} money tests passed`);
process.exit(fails ? 1 : 0);
