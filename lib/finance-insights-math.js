// The arithmetic behind the owner's view on the Financial dashboard. No imports: the forecast is re-run in the
// browser as the owner changes an assumption, and the tests use the same functions.
//
// One rule throughout: a figure that cannot be worked out is NULL, never zero. "We do not know" and "nothing"
// are different answers, and a dashboard that shows the second for the first is believed.
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const utc = (iso) => Date.parse(`${iso}T12:00:00Z`);
export const addDays = (iso, days) => new Date(utc(iso) + days * 86400000).toISOString().slice(0, 10);
export const daysFrom = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

// A date as the tracker or the database writes it, or null. Only unambiguous spellings are read.
export function isoDay(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const iso = m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
  if (iso) return Number.isNaN(utc(iso)) ? null : iso;
  if (!/[a-z]/i.test(s) || !/\d{4}/.test(s)) return null;
  const t = Date.parse(`${s} 12:00:00 UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

// ---- 13-week cash forecast -------------------------------------------------
// Week 1 starts tomorrow: the starting figure is the money on hand today.
export function cashForecast({ today, start, weeks = 13, weeklyIn = 0, weeklyWages = 0, weeklyRunning = 0,
  weeklyDraws = 0, weeklyStock = 0, weeklyPaydown = 0, owedOld = 0, dated = [] }) {
  let cash = r2(n(start)), owed = Math.max(0, r2(n(owedOld)));
  const rows = [];
  for (let i = 0; i < weeks; i++) {
    const from = addDays(today, i * 7 + 1), to = addDays(today, i * 7 + 7);
    const due = dated.filter((d) => d.date >= from && d.date <= to);
    const oneOff = r2(due.reduce((a, d) => a + n(d.amount), 0));
    const paydown = r2(Math.min(Math.max(0, n(weeklyPaydown)), owed));
    owed = r2(owed - paydown);
    const out = r2(n(weeklyWages) + n(weeklyRunning) + n(weeklyDraws) + n(weeklyStock) + paydown + oneOff);
    const opening = cash;
    cash = r2(opening + n(weeklyIn) - out);
    rows.push({ week: i + 1, from, to, opening, in: r2(n(weeklyIn)), out, oneOff, paydown, labels: due.map((d) => d.label), closing: cash });
  }
  const lowest = rows.reduce((a, r) => (a == null || r.closing < a.closing ? r : a), null);
  return { rows, end: cash, lowest, firstShort: rows.find((r) => r.closing < 0) || null };
}

// HST for a calendar quarter is due at the end of the month after it ends.
export function hstDueDate(year, quarter) {
  const month = quarter * 3 + 1;                 // 4, 7, 10, 13
  const y = month > 12 ? year + 1 : year, m = month > 12 ? month - 12 : month;
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
}
export const quarterBounds = (year, quarter) => ({
  from: new Date(Date.UTC(year, (quarter - 1) * 3, 1, 12)).toISOString().slice(0, 10),
  to: new Date(Date.UTC(year, quarter * 3, 0, 12)).toISOString().slice(0, 10)
});
// What the quarter will owe if the rest of it runs at the pace so far.
export function projectQuarterNet({ netToDate, today, year, quarter }) {
  const { from, to } = quarterBounds(year, quarter);
  const elapsed = Math.max(1, daysFrom(from, today) + 1), all = daysFrom(from, to) + 1;
  return r2(Math.max(0, n(netToDate)) * Math.max(1, all / elapsed));
}

// ---- net worth -------------------------------------------------------------
export function netWorth({ assets = [], liabilities = [] }) {
  const sum = (list) => r2(list.reduce((a, x) => a + n(x.value), 0));
  const a = sum(assets), l = sum(liabilities);
  return { assets, liabilities, totalAssets: a, totalLiabilities: l, net: r2(a - l), complete: [...assets, ...liabilities].every((x) => x.value != null) };
}

// ---- monthly trend ---------------------------------------------------------
export function monthTrend(months) {
  return months.map((m, i) => {
    const gross = r2(n(m.revenue) - n(m.cogs));
    const net = r2(gross - n(m.wages) - n(m.costs) - n(m.ads));
    const prev = i > 0 ? n(months[i - 1].revenue) : 0;
    return { ...m, gross, net, margin: n(m.revenue) > 0 ? r2((gross / m.revenue) * 100) : null,
      change: prev > 0 ? r2(((n(m.revenue) - prev) / prev) * 100) : null };
  });
}

// ---- targets ---------------------------------------------------------------
export function projection({ actual, target, day, daysInMonth }) {
  const projected = r2((n(actual) / Math.max(1, day)) * daysInMonth);
  const t = n(target) > 0 ? r2(target) : null;
  const left = Math.max(0, daysInMonth - day);
  return {
    actual: r2(n(actual)), target: t, projected,
    pct: t ? r2((n(actual) / t) * 100) : null,
    gap: t ? r2(projected - t) : null,
    perDayNeeded: t ? r2(Math.max(0, t - n(actual)) / Math.max(1, left)) : null,
    daysLeft: left
  };
}

// ---- break-even and runway -------------------------------------------------
export function breakEven({ costs, days, sales, margin, cash }) {
  const costPerDay = days > 0 ? r2(n(costs) / days) : null;
  const salesPerDay = days > 0 ? r2(n(sales) / days) : null;
  const need = costPerDay != null && margin > 0 ? r2(costPerDay / margin) : null;
  return {
    costPerDay, salesPerDay, margin: margin > 0 ? r2(margin * 100) : null, breakEvenPerDay: need,
    cushion: need > 0 && salesPerDay != null ? r2(((salesPerDay - need) / need) * 100) : null,
    runwayDays: costPerDay > 0 && cash != null ? Math.max(0, Math.floor(n(cash) / costPerDay)) : null
  };
}

// ---- stock -----------------------------------------------------------------
export const AGE_BUCKETS = [
  { key: 'a30', label: '0 to 30 days', max: 30 }, { key: 'a60', label: '31 to 60 days', max: 60 },
  { key: 'a90', label: '61 to 90 days', max: 90 }, { key: 'old', label: 'Over 90 days', max: Infinity },
  { key: 'unknown', label: 'No arrival date', max: null }
];
export function ageStock(units, today) {
  const rows = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, units: 0, cost: 0, noCost: 0 }));
  for (const u of units) {
    const age = u.received ? Math.max(0, daysFrom(u.received, today)) : null;
    const key = age == null ? 'unknown' : AGE_BUCKETS.find((b) => b.max != null && age <= b.max).key;
    const row = rows.find((x) => x.key === key);
    row.units += 1; row.cost = r2(row.cost + n(u.cost)); if (u.cost == null) row.noCost += 1;
  }
  return rows;
}

// What each group of purchases (a lot, a supplier, a brand, a category) has given back.
// Profit counts only sold units where BOTH the cost and the sale price are known.
export function groupReturns(units, keyOf) {
  const by = new Map();
  for (const u of units) {
    const name = String(keyOf(u) || '').trim() || 'Not recorded';
    const k = name.toLowerCase().replace(/\s+/g, ' ');
    const g = by.get(k) || { name, units: 0, sold: 0, spent: 0, stockCost: 0, revenue: 0, soldCost: 0, priced: 0, days: 0, dated: 0, noCost: 0 };
    g.units += 1;
    if (u.cost == null) g.noCost += 1;
    g.spent = r2(g.spent + n(u.cost));
    if (u.sold) {
      g.sold += 1;
      if (u.cost != null && u.soldPrice > 0) { g.priced += 1; g.revenue = r2(g.revenue + u.soldPrice); g.soldCost = r2(g.soldCost + u.cost); }
      if (u.received && u.soldOn && u.soldOn >= u.received) { g.days += daysFrom(u.received, u.soldOn); g.dated += 1; }
    } else g.stockCost = r2(g.stockCost + n(u.cost));
    by.set(k, g);
  }
  return [...by.values()].map((g) => {
    const profit = g.priced ? r2(g.revenue - g.soldCost) : null;
    return { ...g, profit,
      returnPct: g.soldCost > 0 ? r2((profit / g.soldCost) * 100) : null,
      sellThrough: g.units ? r2((g.sold / g.units) * 100) : null,
      avgDays: g.dated ? Math.round(g.days / g.dated) : null };
  }).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
}

// ---- cash cycle ------------------------------------------------------------
export function cashCycle({ stockCost, cogs, sales, receivables, payables, purchases, days }) {
  const per = (v) => (days > 0 ? n(v) / days : 0);
  const d = (balance, flow) => (balance != null && per(flow) > 0 ? Math.round(n(balance) / per(flow)) : null);
  const stockDays = d(stockCost, cogs), collectDays = d(receivables, sales), payDays = d(payables, purchases);
  return {
    stockDays, collectDays, payDays,
    turns: stockDays > 0 ? r2(365 / stockDays) : null,
    beforeCredit: stockDays != null && collectDays != null ? stockDays + collectDays : null,
    cycle: stockDays != null && collectDays != null && payDays != null ? stockDays + collectDays - payDays : null
  };
}

// ---- advertising -----------------------------------------------------------
export const AD_PLATFORMS = [
  { key: 'meta', label: 'Facebook / Instagram', sources: ['facebook', 'marketplace'], match: /facebook|facebk|instagram|\bmeta\b/i },
  { key: 'google', label: 'Google', sources: ['google'], match: /google/i },
  { key: 'kijiji', label: 'Kijiji', sources: ['kijiji'], match: /kijiji/i },
  { key: 'other', label: 'Other / not named', sources: [], match: null }
];
export const platformOf = (text) => (AD_PLATFORMS.find((p) => p.match && p.match.test(String(text || ''))) || AD_PLATFORMS[AD_PLATFORMS.length - 1]).key;

// `bank` and `typed` are [{ platform, amount }]: what the bank feed shows and what was typed on Marketing.
// The same ad bill can be in both, so each platform takes the LARGER of the two rather than their sum.
// `sales` is [{ source, sales, revenue, profit }] by where the customer said they came from.
export function adReturn({ bank = [], typed = [], sales = [] }) {
  const total = (list, k) => r2(list.filter((x) => x.platform === k).reduce((a, x) => a + n(x.amount), 0));
  const rows = AD_PLATFORMS.map((p) => {
    const spend = Math.max(total(bank, p.key), total(typed, p.key));
    const mine = sales.filter((s) => p.sources.includes(s.source));
    const count = mine.reduce((a, s) => a + n(s.sales), 0);
    const revenue = r2(mine.reduce((a, s) => a + n(s.revenue), 0)), profit = r2(mine.reduce((a, s) => a + n(s.profit), 0));
    return { key: p.key, label: p.label, spend, sales: count, revenue, profit,
      costPerSale: spend > 0 && count > 0 ? r2(spend / count) : null,
      profitPerDollar: spend > 0 && p.sources.length ? r2(profit / spend) : null };
  });
  const paid = new Set(AD_PLATFORMS.flatMap((p) => p.sources));
  return { rows, other: sales.filter((s) => !paid.has(s.source)).sort((a, b) => n(b.profit) - n(a.profit)),
    spend: r2(rows.reduce((a, x) => a + x.spend, 0)) };
}
