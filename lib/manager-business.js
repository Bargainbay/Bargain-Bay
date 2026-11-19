// The BUSINESS half of the manager's view: sales, deliveries, receivables,
// follow-ups, suppliers. lib/manager-issues.js had only the technical half (is
// the site up, are photos missing, did the backup run) — which is why the call
// sounded like a reminder bot: it could say the website was fine and had no idea
// a $4,000 invoice was three weeks late or tomorrow's deliveries had no driver.
//
// Same contract as manager-issues: every check is READ-ONLY, independent, and
// returns issues { key, area, severity, title, speak, detail, count, link }.
// A check that throws is turned into an issue by the scanner, never into silence.
//
// `fix` names the autonomous action (lib/manager-actions.js) that clears an issue,
// so the scan, the unattended pass and the phone all point at the same remedy.
import { query, hasDb } from './db';
import { getSetting } from './settings';
import { STATUS_KEY, token as metaToken, staleMetaLeads, workshopWaiting } from './meta-leads';

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
const money0 = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-CA')}`;

// Toronto calendar days, computed in SQL-safe ISO form.
function torontoDay(offset = 0, now = new Date()) {
  const d = new Date(now.getTime() + offset * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(d);
}
export { torontoDay };

// Money owed to us and not arriving. The single biggest thing a manager would
// chase: receivables past their due date, oldest and largest first.
async function checkReceivables() {
  if (!hasDb()) return [];
  const today = torontoDay();
  const { rows } = await query(
    `SELECT number, name, total::float AS total, due_date, ($1::date - due_date)::int AS days_late
       FROM invoices
      WHERE status IN ('open','partial') AND due_date IS NOT NULL AND due_date < $1::date
      ORDER BY total DESC LIMIT 200`, [today]);
  if (!rows.length) return [];
  const sum = rows.reduce((n, r) => n + r.total, 0);
  const worst = rows[0];
  const old = rows.filter((r) => r.days_late >= 30);
  return [{
    key: 'biz-receivables', area: 'money',
    severity: old.length || sum >= 5000 ? 'high' : 'medium',
    title: `${plural(rows.length, 'invoice')} past due, ${money0(sum)} owed`,
    speak: `${plural(rows.length, 'invoice')} ${rows.length === 1 ? 'is' : 'are'} past due, ${money0(sum)} in all. The biggest is ${worst.name || worst.number}, ${money0(worst.total)}, ${worst.days_late} days late`,
    detail: rows.slice(0, 25).map((r) => `${r.number} ${r.name || ''} ${money0(r.total)} — ${r.days_late} days past due`).join('\n'),
    count: rows.length, link: '/admin/invoices', fix: 'chase_receivables',
    data: { total: sum, invoices: rows.slice(0, 25) }
  }];
}

// Quotes are sales that have not happened yet. One expiring in two days is the
// cheapest sale there is to save.
async function checkQuotes() {
  if (!hasDb()) return [];
  const today = torontoDay();
  const soon = torontoDay(2);
  const { rows } = await query(
    `SELECT number, name, total::float AS total, expires_at
       FROM quotes
      WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at >= $1::date AND expires_at <= $2::date
      ORDER BY total DESC LIMIT 100`, [today, soon]);
  if (!rows.length) return [];
  const sum = rows.reduce((n, r) => n + r.total, 0);
  return [{
    key: 'biz-quotes-expiring', area: 'sales', severity: sum >= 3000 ? 'high' : 'medium',
    title: `${plural(rows.length, 'quote')} worth ${money0(sum)} expiring within two days`,
    speak: `${plural(rows.length, 'quote')} worth ${money0(sum)} ${rows.length === 1 ? 'expires' : 'expire'} in the next two days`,
    detail: rows.map((r) => `${r.number} ${r.name || ''} ${money0(r.total)} — expires ${String(r.expires_at).slice(0, 10)}`).join('\n'),
    count: rows.length, link: '/admin/quotes', fix: 'chase_quotes',
    data: { quotes: rows }
  }];
}

// Deliveries: a stop with a day and no driver is a promise to a customer that
// nobody owns.
async function checkDeliveries() {
  if (!hasDb()) return [];
  const out = [];
  const today = torontoDay();
  const tomorrow = torontoDay(1);
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT id, job_number, customer_name, job_date::text AS day
         FROM jobs
        WHERE driver_id IS NULL AND status NOT IN ('done','failed','cancelled')
          AND job_date IN ($1::date, $2::date)
        ORDER BY job_date, id LIMIT 100`, [today, tomorrow]));
  } catch { return []; }
  const todays = rows.filter((r) => r.day === today);
  const tomorrows = rows.filter((r) => r.day === tomorrow);
  if (todays.length) out.push({
    key: 'biz-stops-today-unassigned', area: 'dispatch', severity: 'high',
    title: `${plural(todays.length, 'stop')} today with no driver`,
    speak: `${plural(todays.length, 'delivery stop')} today ${todays.length === 1 ? 'has' : 'have'} no driver assigned`,
    detail: todays.map((r) => `${r.job_number} ${r.customer_name || ''}`).join('\n'),
    count: todays.length, link: '/admin/dispatch', data: { jobs: todays }
  });
  if (tomorrows.length) out.push({
    key: 'biz-stops-tomorrow-unassigned', area: 'dispatch', severity: 'medium',
    title: `${plural(tomorrows.length, 'stop')} tomorrow with no driver yet`,
    speak: `${plural(tomorrows.length, 'delivery stop')} tomorrow ${tomorrows.length === 1 ? 'has' : 'have'} no driver yet`,
    detail: tomorrows.map((r) => `${r.job_number} ${r.customer_name || ''}`).join('\n'),
    count: tomorrows.length, link: '/admin/dispatch', fix: 'nudge_dispatch', data: { jobs: tomorrows }
  });
  return out;
}

// Sold, paid for, and not on the board: the order is a promise with no stop.
async function checkOrdersNotOnBoard() {
  if (!hasDb()) return [];
  let n = 0;
  try {
    const { rows: [r] } = await query(
      `SELECT count(*)::int AS n FROM orders o
        WHERE o.delivery_method = 'delivery' AND o.status IN ('confirmed','ready')
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.order_id = o.id)`);
    n = r?.n || 0;
  } catch { return []; }
  if (!n) return [];
  return [{
    key: 'biz-orders-not-on-board', area: 'dispatch', severity: 'medium',
    title: `${plural(n, 'delivery order')} confirmed with no stop on the dispatch board`,
    speak: `${plural(n, 'confirmed delivery order')} ${n === 1 ? 'is' : 'are'} not on the dispatch board yet`,
    detail: 'Confirmed or ready delivery orders with no job. The manager pulls them onto the board.',
    count: n, link: '/admin/dispatch', fix: 'pull_orders'
  }];
}

// Web orders where nobody has paid or confirmed: the unit is held, the customer
// may have walked away.
async function checkUnpaidOrders() {
  if (!hasDb()) return [];
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT o.order_number, o.total::float AS total, o.created_at
         FROM orders o
        WHERE o.status = 'pending_payment'
          AND o.created_at < now() - interval '2 days'
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND COALESCE(i.channel,'manual') <> 'web')
        ORDER BY o.total DESC LIMIT 100`));
  } catch { return []; }
  if (!rows.length) return [];
  const sum = rows.reduce((n, r) => n + r.total, 0);
  return [{
    key: 'biz-orders-unpaid', area: 'sales', severity: sum >= 3000 ? 'medium' : 'low',
    title: `${plural(rows.length, 'web order')} unpaid for over two days, ${money0(sum)} held`,
    speak: `${plural(rows.length, 'web order')} ${rows.length === 1 ? 'has' : 'have'} sat unpaid for over two days, holding ${money0(sum)} of stock`,
    detail: rows.map((r) => `${r.order_number} ${money0(r.total)}`).join('\n'),
    count: rows.length, link: '/admin/orders'
  }];
}

// Follow-ups somebody promised and nobody did.
async function checkFollowUps() {
  if (!hasDb()) return [];
  let r;
  try {
    ({ rows: [r] } = await query(
      `SELECT count(*) FILTER (WHERE due_on < $1::date)::int AS overdue,
              count(*) FILTER (WHERE owner_email IS NULL)::int AS unowned
         FROM customer_tasks WHERE done_at IS NULL`, [torontoDay()]));
  } catch { return []; }
  const out = [];
  if (r.overdue) out.push({
    key: 'biz-followups-overdue', area: 'sales', severity: r.overdue >= 10 ? 'high' : 'medium',
    title: `${plural(r.overdue, 'customer follow-up')} overdue`,
    speak: `${plural(r.overdue, 'customer follow-up')} ${r.overdue === 1 ? 'is' : 'are'} overdue`,
    detail: 'Open customer tasks past their due date. See My Day on the sales dashboard.',
    count: r.overdue, link: '/admin/dashboard'
  });
  return out;
}

// Facebook / Instagram lead forms. A lead who asked about something is warmest in the first hours, and
// the failure that matters is silence: a missing token or a broken pull looks exactly like a quiet week.
// So "not being pulled in" and "pulled in but nobody has called" are both issues, not log lines.
async function checkMetaLeads() {
  if (!hasDb()) return [];
  const out = [];
  if (!metaToken()) {
    out.push({
      key: 'biz-meta-leads-config', area: 'sales', severity: 'high',
      title: 'Meta leads are not being pulled in (no Meta token set)',
      speak: 'Facebook and Instagram leads are not coming onto the boards, because the Meta token has not been set up',
      detail: 'Set META_LEADS_ACCESS_TOKEN (a Meta system-user token with leads_retrieval and both Pages assigned) and META_LEADS_KEY in Vercel. Until then leads sit in Meta Leads Center and nobody is called.',
      count: 1, link: '/admin/manager'
    });
  } else {
    const st = await getSetting(STATUS_KEY, null);
    if (st && st.ok === false && st.error) out.push({
      key: 'biz-meta-leads-pull', area: 'sales', severity: 'high',
      title: 'Pulling Meta leads is failing',
      speak: 'Pulling Facebook leads onto the boards is failing, so new leads may be waiting in Meta',
      detail: String(st.error).slice(0, 500), count: 1, link: '/admin/manager'
    });
  }
  const hub = await staleMetaLeads({ hours: 4 });
  const bb = hub.hubBb, rs = hub.hubRs;
  let ws = { waiting: 0, oldestHours: 0 };
  try { ws = (await workshopWaiting()) || ws; } catch (e) {
    out.push({ key: 'biz-meta-leads-workshop-read', area: 'sales', severity: 'medium', title: 'Could not read the workshop Board',
      speak: 'I could not check the workshop Board for uncalled Facebook leads', detail: String(e.message || e), count: 1, link: '/admin/manager' });
  }
  const total = bb + rs + (ws.waiting || 0);
  if (total) {
    const parts = [];
    if (ws.waiting) parts.push(`${plural(ws.waiting, 'workshop lead')} on the RS Solutions Board`);
    if (rs) parts.push(`${plural(rs, 'RS Solutions lead')} on the lead board`);
    if (bb) parts.push(`${plural(bb, 'Bargain Bay lead')} on the lead board`);
    const oldest = Math.max(hub.oldestHours, ws.oldestHours || 0);
    out.push({
      key: 'biz-meta-leads-uncalled', area: 'sales', severity: total >= 10 || oldest >= 24 ? 'high' : 'medium',
      title: `${plural(total, 'Facebook lead')} nobody has called (oldest ${oldest}h)`,
      speak: `${plural(total, 'Facebook lead')} ${total === 1 ? 'has' : 'have'} not been called, the oldest for ${oldest} hours`,
      detail: `${parts.join('; ')}. Leads over 4 hours old with no call logged.`,
      count: total, link: '/sales/leads'
    });
  }
  return out;
}

// What we owe suppliers and have not paid.
async function checkPayables() {
  if (!hasDb()) return [];
  let r;
  try {
    ({ rows: [r] } = await query(
      `SELECT count(*)::int AS n, COALESCE(sum(total),0)::float AS total
         FROM purchase_invoices WHERE paid_at IS NULL AND invoice_date < (now() - interval '30 days')::date`));
  } catch { return []; }
  if (!r?.n) return [];
  return [{
    key: 'biz-payables-old', area: 'money', severity: r.total >= 10000 ? 'medium' : 'low',
    title: `${plural(r.n, 'supplier invoice')} unpaid after 30 days, ${money0(r.total)}`,
    speak: `${plural(r.n, 'supplier invoice')} ${r.n === 1 ? 'has' : 'have'} been unpaid for over thirty days, ${money0(r.total)} in all`,
    detail: 'Purchase invoices with no paid date, dated over 30 days ago. Mark paid on /admin/reports/ledger.',
    count: r.n, link: '/admin/reports/ledger'
  }];
}

// E-transfers the Manager read but could not match cleanly — it says so on the next
// call rather than leaving them in a table (lib/manager-payments.js).
async function checkPaymentsToReview() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT count(*)::int AS n, COALESCE(sum(amount_cents),0)::int AS cents FROM manager_payments
      WHERE resolved_at IS NULL AND status LIKE 'flag%'`);
  if (!rows[0]?.n) return [];
  return [{
    key: 'biz-payments-review', area: 'money', severity: 'high',
    title: `${plural(rows[0].n, 'e-transfer')} (${money0(rows[0].cents / 100)}) arrived that I could not match cleanly`,
    speak: `${plural(rows[0].n, 'e-transfer')} worth ${money0(rows[0].cents / 100)} arrived that I could not match to an invoice on amount, date and name`,
    detail: 'Use payments_to_review to hear each one; match_flagged_payment applies one to an invoice once he says which.',
    count: rows[0].n, link: '/admin/manager'
  }];
}

// Units that have sat 90+ days with a healthy margin: raise a price cut with him.
async function checkStaleStock() {
  if (!hasDb()) return [];
  const { sheetsConfigured, readTrackerRows } = await import('./sheets');
  if (!sheetsConfigured()) return [];
  const { stalePricing, ageDays } = await import('./manager-policy');
  const tracker = await readTrackerRows();
  const { rows: prods } = await query('SELECT sku, price::float AS price, cost::float AS cost FROM products WHERE active = true');
  const by = Object.fromEntries(prods.map((p) => [p.sku, p]));
  const hits = [];
  for (const t of tracker) {
    const p = by[t.sku]; if (!p) continue;
    const s = stalePricing({ price: p.price, cost: p.cost, ageDays: ageDays(t.dateReceived) });
    if (s) hits.push({ sku: t.sku, ...s });
  }
  if (!hits.length) return [];
  hits.sort((a, b) => b.margin - a.margin);
  const top = hits[0];
  return [{
    key: 'biz-stale-stock', area: 'money', severity: 'medium',
    title: `${plural(hits.length, 'unit')} sitting 90+ days with a healthy margin`,
    speak: `${plural(hits.length, 'unit')} ${hits.length === 1 ? 'has' : 'have'} sat ninety days or more with a good margin. The biggest, ${top.sku}, has sat ${top.age} days at ${money0(top.price)} with ${money0(top.margin)} margin, and I would try ${money0(top.suggest)}`,
    detail: hits.slice(0, 8).map((h) => `${h.sku}: ${h.age} days, ${money0(h.price)}, margin ${money0(h.margin)}, suggest ${money0(h.suggest)}`).join('\n'),
    count: hits.length, link: '/admin/clearance'
  }];
}

export const BUSINESS_CHECKS = [
  ['receivables', checkReceivables], ['quotes', checkQuotes], ['deliveries', checkDeliveries],
  ['orders on the board', checkOrdersNotOnBoard], ['unpaid orders', checkUnpaidOrders],
  ['follow-ups', checkFollowUps], ['supplier bills', checkPayables],
  ['e-transfers to review', checkPaymentsToReview], ['stale stock', checkStaleStock],
  ['Meta leads', checkMetaLeads]
];
