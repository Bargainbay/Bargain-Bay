// A day's money, from sales down to net profit, and what has to go back into
// stock. No imports beyond other pure files: the dashboard runs this too.
//
// Built on one row of dailyPnl() and split with the same arithmetic as the
// "Where the money goes" page, so the three can never disagree:
//   net = gross profit + delivery & services done - wages - truck & fuel - bills
// `restock` is the cash that has to go back into product: what the units sold
// cost, plus the tax inside a consigned (vendor drop-off) unit's cost, which
// profit leaves out but the vendor is still paid.
import { splitDay } from './cash-split-math.js';

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const n = (v) => Number(v || 0);

export const MONEY_KEYS = ['sales', 'revenue', 'revenueWithTax', 'restock', 'vendorTax', 'grossProfit', 'deliveryIn', 'wages', 'truck', 'bills', 'net', 'fuel', 'missingCost'];

export function moneyDay(d, sold = {}) {
  const s = splitDay(d);
  const bills = r2(n(d.overhead));
  return {
    day: d.day,
    sales: n(sold.sales), revenue: r2(n(sold.revenue)), revenueWithTax: r2(n(sold.revenueWithTax)),
    restock: r2(n(d.productCost) + n(d.vendorTax)), vendorTax: r2(n(d.vendorTax)),
    grossProfit: r2(n(d.productProfit)),
    deliveryIn: r2(n(d.deliveryIncome) + n(d.marketplaceIncome)),
    wages: s.labour, truck: r2(s.running - bills), bills,
    net: s.profit,
    fuel: r2(n(d.deliveryParts?.fuel)), missingCost: n(d.missingCost)
  };
}

export function addUp(rows) {
  return Object.fromEntries(MONEY_KEYS.map((k) => [k, r2(rows.reduce((a, r) => a + n(r[k]), 0))]));
}
