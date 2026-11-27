// A day's money, from sales down to net profit, and what has to go back into
// stock. No imports beyond other pure files: the dashboard runs this too.
//
// Built on one row of dailyPnl() and split with the same arithmetic as the
// "Where the money goes" page, so the three can never disagree:
//   net = gross profit + delivery & services done - wages - truck & fuel - bills
// Beside that "proposed" figure (our own numbers: clock-ins, truck, cost list) is
// the ACTUAL one: the same gross profit and deliveries, less what was really paid
// that day (bank, cash, own pocket). `spend` is null where the bank is not on
// record, and then actual is unknown, never zero.
// `restock` is the cash that has to go back into product: what the units sold
// cost, plus the tax inside a consigned (vendor drop-off) unit's cost, which
// profit leaves out but the vendor is still paid.
import { splitDay } from './cash-split-math.js';

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const n = (v) => Number(v || 0);

export const MONEY_KEYS = ['sales', 'revenue', 'revenueWithTax', 'restock', 'vendorTax', 'grossProfit', 'deliveryIn', 'wages', 'truck', 'bills', 'net', 'fuel', 'missingCost', 'spent', 'actualNet', 'unsorted'];
// Unknown on any day makes the total unknown too.
const MAY_BE_UNKNOWN = new Set(['spent', 'actualNet', 'unsorted']);

export function moneyDay(d, sold = {}, spend = null) {
  const s = splitDay(d);
  const bills = r2(n(d.overhead));
  const deliveryIn = r2(n(d.deliveryIncome) + n(d.marketplaceIncome));
  const grossProfit = r2(n(d.productProfit));
  return {
    spent: spend ? r2(n(spend.spent)) : null,
    actualNet: spend ? r2(grossProfit + deliveryIn - n(spend.spent)) : null,
    unsorted: spend ? r2(n(spend.unsorted)) : null,
    day: d.day,
    sales: n(sold.sales), revenue: r2(n(sold.revenue)), revenueWithTax: r2(n(sold.revenueWithTax)),
    restock: r2(n(d.productCost) + n(d.vendorTax)), vendorTax: r2(n(d.vendorTax)),
    grossProfit,
    deliveryIn,
    wages: s.labour, truck: r2(s.running - bills), bills,
    net: s.profit,
    fuel: r2(n(d.deliveryParts?.fuel)), missingCost: n(d.missingCost)
  };
}

export function addUp(rows) {
  return Object.fromEntries(MONEY_KEYS.map((k) => [k,
    MAY_BE_UNKNOWN.has(k) && rows.some((r) => r[k] == null) ? null : r2(rows.reduce((a, r) => a + n(r[k]), 0))]));
}
