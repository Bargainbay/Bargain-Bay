// Where every dollar of a day's sales has to go. No imports: the page and the tests use the same arithmetic.
//
// A dollar the business takes in belongs to one of four piles, and the four add back to the sales exactly:
//   product   what the units sold cost us. It is NOT ours: it is the money that has to go back into stock,
//             or the shelves empty and the bankroll is just stock turned into cash and spent.
//   labour    that day's own wages: staff clocked in, driver pay, driver hours. Set aside for the day it was worked.
//   running   everything else it cost to run the day: rent and bills spread over the day, truck, fuel, other delivery costs.
//   profit    what is left. Negative means the day ate into the bankroll.
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const n = (v) => Number(v || 0);

// `d` is one row of dailyPnl().
export function splitDay(d) {
  const product = r2(n(d.productCost));
  const labour = r2(n(d.staffWages) + n(d.deliveryParts?.driverPay) + n(d.deliveryParts?.driverHours));
  // Taken from the delivery total rather than re-added from its parts, so rounding can never open a gap.
  const running = r2(n(d.overhead) + n(d.deliveryCost) - n(d.deliveryParts?.driverPay) - n(d.deliveryParts?.driverHours));
  const sales = r2(product + n(d.productProfit) + n(d.deliveryIncome) + n(d.marketplaceIncome));
  const profit = r2(sales - product - labour - running);
  return { day: d.day, sales, product, labour, running, profit, missingCost: n(d.missingCost) };
}

// Days in order, oldest first, plus what was actually spent on stock in the same period.
// `bought` is the stock bought in the period (supplier invoices, pre-tax); null when unknown.
export function rollUp(days, bought = null) {
  let c = { sales: 0, product: 0, labour: 0, running: 0, profit: 0 };
  const rows = days.map((d) => {
    const s = splitDay(d);
    c = { sales: r2(c.sales + s.sales), product: r2(c.product + s.product), labour: r2(c.labour + s.labour), running: r2(c.running + s.running), profit: r2(c.profit + s.profit) };
    return { ...s, run: { ...c } };
  });
  const total = rows.length ? rows[rows.length - 1].run : c;
  const pct = (v) => (total.sales > 0 ? Math.round((v / total.sales) * 1000) / 10 : null);
  return {
    rows, total,
    share: { product: pct(total.product), labour: pct(total.labour), running: pct(total.running), profit: pct(total.profit) },
    // Stock still to buy back: what sold, less what was bought. Negative = bought more than sold (stock is growing).
    restock: bought == null ? null : { sold: total.product, bought: r2(bought), toPutBack: r2(total.product - bought) },
    daysLost: rows.filter((x) => x.profit < 0).length
  };
}
