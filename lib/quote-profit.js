// Live profit on a quote. PURE — no imports — because the quote builder runs it on
// every keystroke in the browser and the tests run it in Node.
//
//   Profit = (price of everything charged, before HST)
//          − (cost of every unit sold)
//          − (internal cost of every service included, charged OR free)
//
// A service is added one of two ways (owner, Addendum 1):
//   · CHARGED  — its price is a line the customer pays: adds to revenue AND its
//                internal cost comes off.
//   · INCLUDED — shows as "included, $0": only its internal cost comes off.
//
// A cost nobody has entered is NULL, not zero. It is counted as zero for the sum
// (a missing cost cannot be invented) but REPORTED in `missing`, so a profit built on
// a hole reads as a hole instead of as good news.

export const LOW_PROFIT_DEFAULT = 100;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** How many times a service's internal cost applies. */
export function costUnits(service, { units = 1 } = {}) {
  const q = Math.max(0, num(service.qty ?? 1));
  switch (service.costBasis) {
    case 'unit': return q * Math.max(1, units);   // per appliance carried
    case 'hour': return q;                          // qty = hours
    case 'appliance': return q;                     // priced per appliance type: qty = appliances
    case 'order': default: return q > 0 ? 1 : 0;    // once per order, however many
  }
}

/**
 * @param {object} q
 * @param {Array<{amount:number, cost:number|null, isUnit?:boolean}>} q.lines  priced lines BEFORE any bundle discount
 * @param {Array<{mode:'charged'|'included', price?:number, internalCost:number|null, costBasis?:string, qty?:number}>} q.services
 * @param {number} [q.bundlePct]   bundle discount % applied to the lines
 * @param {number|null} [q.cashTotal] an all-in cash figure; when set it IS the revenue (after removing HST)
 * @param {boolean} [q.addHst]
 * @param {number} [q.threshold]   the "low profit" yellow line
 */
export function quoteProfit({ lines = [], services = [], bundlePct = 0, cashTotal = null, addHst = true, hstRate = 0.13, threshold = LOW_PROFIT_DEFAULT } = {}) {
  const pct = Math.min(Math.max(num(bundlePct), 0), 90);
  const unitLines = lines.filter((l) => l.isUnit !== false);
  const unitCount = unitLines.length || 1;

  const linesPrice = lines.reduce((a, l) => a + num(l.amount), 0);
  const chargedPrice = services
    .filter((s) => s.mode === 'charged')
    .reduce((a, s) => a + num(s.price) * Math.max(0, num(s.qty ?? 1)), 0);

  // Revenue, before HST. A cash deal is quoted all-in, so the tax comes back out.
  let revenue;
  if (cashTotal != null && num(cashTotal) > 0) {
    revenue = addHst ? num(cashTotal) / (1 + hstRate) : num(cashTotal);
  } else {
    revenue = linesPrice * (1 - pct / 100) + chargedPrice;
  }

  const unitCost = unitLines.reduce((a, l) => a + (l.cost == null ? 0 : num(l.cost)), 0);
  const unitMissing = unitLines.filter((l) => l.cost == null && num(l.amount) > 0).length;

  const serviceRows = services.map((s) => {
    const n = costUnits(s, { units: unitCount });
    const cost = s.internalCost == null ? 0 : num(s.internalCost) * n;
    return { ...s, cost: r2(cost), costMissing: s.internalCost == null };
  });
  const serviceCost = serviceRows.reduce((a, s) => a + s.cost, 0);

  const profit = r2(revenue - unitCost - serviceCost);
  const level = profit < 0 ? 'loss' : profit < num(threshold) ? 'low' : 'ok';
  return {
    revenue: r2(revenue), unitCost: r2(unitCost), serviceCost: r2(serviceCost), profit, level,
    marginPct: revenue > 0 ? r2((profit / revenue) * 100) : null,
    missing: { units: unitMissing, services: serviceRows.filter((s) => s.costMissing).length },
    serviceRows
  };
}

export const profitLabel = (p) =>
  p.level === 'loss' ? `Loss: $${Math.abs(p.profit).toFixed(2)}` : p.level === 'low' ? `Low profit: $${p.profit.toFixed(2)}` : `Profit: $${p.profit.toFixed(2)}`;
