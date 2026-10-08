// How a bill becomes a number for ONE day. No imports: the cost editor in the
// browser previews the same figure the server will use.
//
// A bill is spread over the period it COVERS, so that a month's days add back to
// exactly the month's bill -- a flat "annual / 365" would make every February
// look cheaper and every 31-day month dearer than the invoice said.
//   monthly   amount / days in that calendar month
//   quarterly amount / days in that calendar quarter
//   annual    amount / days in that calendar year
//   weekly    amount / 7
//   daily     amount
//   once      the whole amount, on its start date only
export const COST_FREQUENCIES = [
  { key: 'daily', label: 'Every day' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'annual', label: 'Yearly' },
  { key: 'once', label: 'One time' }
];

export const COST_CATEGORIES = [
  'Rent', 'Utilities', 'Insurance', 'Software', 'Truck (lease, plates, upkeep)',
  'Advertising', 'Card & bank fees', 'Loan & interest', 'Other'
];

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const parts = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return { y, m, d }; };

/** What one bill costs on the day `iso` (YYYY-MM-DD). 0 outside its dates. */
export function dailyShare(cost, iso) {
  const amount = Number(cost.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const day = String(iso).slice(0, 10);
  const start = String(cost.starts_on || cost.startsOn || '').slice(0, 10);
  const end = String(cost.ends_on || cost.endsOn || '').slice(0, 10);
  if (start && day < start) return 0;
  if (end && day > end) return 0;
  const { y, m } = parts(day);
  switch (cost.frequency) {
    case 'once': return day === start ? amount : 0;
    case 'daily': return amount;
    case 'weekly': return amount / 7;
    case 'monthly': return amount / daysIn(y, m);
    case 'quarterly': {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return amount / (daysIn(y, q0) + daysIn(y, q0 + 1) + daysIn(y, q0 + 2));
    }
    case 'annual': return amount / (daysIn(y, 2) === 29 ? 366 : 365);
    default: return 0;
  }
}

/** Every day from..to inclusive, as ISO strings. */
export function daysBetween(from, to) {
  const out = [];
  const t = new Date(`${from}T12:00:00Z`);
  const stop = new Date(`${to}T12:00:00Z`);
  while (t <= stop && out.length < 400) { out.push(t.toISOString().slice(0, 10)); t.setUTCDate(t.getUTCDate() + 1); }
  return out;
}
