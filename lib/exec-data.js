// Gathers what the General Manager judges (lib/exec-rules.js): money by business
// line, people, the refurb floor, and cash that is stuck. READ-ONLY, every source.
//
// A source that cannot be read is NAMED in `blind`, never folded into a zero: a
// manager reporting "nobody made a call" because a query failed is worse than no
// manager. A figure from a blind source is null.
import { query, hasDb } from './db';
import { torontoToday } from './constants';
import { SALE, preTaxProfitByRep } from './exec-sql';
import { monthWindows, addDays, floorFlow, peopleReview, streamBoard } from './exec-rules';

const RSOPS_BASE = () => process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca';
const TZ = `AT TIME ZONE 'America/Toronto'`;
const DAY = (col) => `(${col} ${TZ})::date`;
const OUR_CLIENTS = `('bargain bay','rs solutions')`;
const n = (v) => Number(v) || 0;
const lower = (s) => String(s || '').trim().toLowerCase();
export const REVIEW_DAYS = 14;

const adminEmails = () => String(process.env.ADMIN_EMAILS || '').split(',').map(lower).filter(Boolean);
const isAgent = (email) => /^(manager|sarah|christina)@/.test(email);

async function appliedStreams(from, to) {
  const { rows } = await query(
    `WITH s AS (
       SELECT o.id,
              o.total - COALESCE(o.hst,0) - COALESCE(o.vendor_subtotal,0) AS rev,
              COALESCE((SELECT sum(oi.price) FROM order_items oi WHERE oi.order_id = o.id AND oi.kind = 'service' AND oi.price > 0), 0) AS svc,
              EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.channel = 'web') AS web,
              EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(o.email) AND u.role = 'member') AS member
         FROM orders o WHERE ${SALE('o')} AND ${DAY('o.created_at')} BETWEEN $1::date AND $2::date)
     SELECT CASE WHEN member THEN 'resellers' WHEN web THEN 'web' ELSE 'staff' END AS k,
            count(*)::int AS n, COALESCE(sum(rev - svc),0)::float AS goods, COALESCE(sum(svc),0)::float AS svc
       FROM s GROUP BY 1`, [from, to]);
  const by = Object.fromEntries(rows.map((r) => [r.k, r]));
  return {
    web: n(by.web?.goods), resellers: n(by.resellers?.goods), staff: n(by.staff?.goods),
    services: rows.reduce((a, r) => a + n(r.svc), 0),
    orders: rows.reduce((a, r) => a + r.n, 0)
  };
}

async function clientDelivery(from, to) {
  const { rows: [r] } = await query(
    `SELECT COALESCE(sum(j.charge_amount),0)::float AS total, count(*)::int AS stops
       FROM jobs j JOIN clients c ON c.id = j.client_id
      WHERE j.status IN ('done','failed') AND j.type <> 'return_to_base' AND lower(btrim(c.name)) NOT IN ${OUR_CLIENTS}
        AND j.job_date BETWEEN $1::date AND $2::date`, [from, to]);
  return r;
}

async function stuckMoney(today, billedThrough = '') {
  const [overdue, quotes, unbilled, unpriced, door, payables] = await Promise.all([
    query(
      `SELECT i.number, i.name, (i.total - COALESCE((SELECT sum(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id),0))::float AS balance,
              ($1::date - i.due_date)::int AS days_late
         FROM invoices i WHERE i.status IN ('open','partial') AND i.due_date IS NOT NULL AND i.due_date < $1::date
        ORDER BY 3 DESC LIMIT 500`, [today]),
    query(`SELECT count(*)::int AS n, COALESCE(sum(total),0)::float AS total FROM quotes WHERE status = 'open'`),
    query(
      `SELECT c.name AS client, count(*)::int AS n, COALESCE(sum(j.charge_amount),0)::float AS total
         FROM jobs j JOIN clients c ON c.id = j.client_id
        WHERE j.status = 'done' AND j.invoice_id IS NULL AND j.charge_amount > 0 AND lower(btrim(c.name)) NOT IN ${OUR_CLIENTS}
          AND j.job_date >= $1::date - 90 AND j.job_date > $2::date GROUP BY 1 ORDER BY 3 DESC`, [today, billedThrough || '2000-01-01']),
    query(
      `SELECT count(*)::int AS n FROM jobs j JOIN clients c ON c.id = j.client_id
        WHERE j.status = 'done' AND j.charge_amount IS NULL AND j.invoice_id IS NULL AND lower(btrim(c.name)) NOT IN ${OUR_CLIENTS}
          AND j.type NOT IN ('return_to_base','service_call','pickup') AND j.job_date >= $1::date - 30`, [today]),
    query(`SELECT count(*)::int AS n, COALESCE(sum(amount),0)::float AS total FROM job_collections WHERE status = 'pending'`),
    query(`SELECT count(*)::int AS n, COALESCE(sum(total),0)::float AS total FROM purchase_invoices WHERE paid_at IS NULL`)
  ]);
  const owed = overdue.rows.filter((r) => r.balance > 0.005);
  return {
    overdue: { count: owed.length, total: owed.reduce((a, r) => a + r.balance, 0), top: owed.slice(0, 5) },
    quotes: { count: quotes.rows[0].n, total: quotes.rows[0].total },
    // "No invoice IN THIS SYSTEM": RS client invoices are also raised from the owner's own sheets.
    unbilled: { count: unbilled.rows.reduce((a, r) => a + r.n, 0), total: unbilled.rows.reduce((a, r) => a + r.total, 0), clients: unbilled.rows.map((r) => r.client), billedThrough: billedThrough || null },
    unpriced: { count: unpriced.rows[0].n },
    doorMoney: { count: door.rows[0].n, total: door.rows[0].total },
    payables: { count: payables.rows[0].n, total: payables.rows[0].total }
  };
}

async function stopRows(from, to) {
  const { rows } = await query(
    `SELECT u.name, lower(u.email) AS email, j.job_date::text AS day,
            count(*) FILTER (WHERE j.status = 'done')::int AS done,
            count(*) FILTER (WHERE j.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE j.status = 'done' AND j.signature_path IS NULL
                              AND NOT EXISTS (SELECT 1 FROM job_photos p WHERE p.job_id = j.id))::int AS "noProof"
       FROM jobs j JOIN users u ON u.id IN (j.driver_id, j.driver2_id)
      WHERE j.job_date BETWEEN $1::date AND $2::date AND j.status IN ('done','failed') AND j.type <> 'return_to_base'
      GROUP BY 1, 2, 3`, [from, to]);
  return rows;
}

// Per person: what they closed, quoted, invoiced and called. The owner's own
// logins are left out of the people (reported as the owner's share instead).
async function salesRows(from, to, { rsDays, fetchImpl, blind }) {
  const people = new Map();
  const names = new Map();   // folded name -> email
  const key = (s) => lower(s).replace(/[^a-z0-9]/g, '');
  const get = (email, name) => {
    const e = lower(email) || names.get(key(name)) || '';
    const k = e || `name:${key(name)}`;
    let p = people.get(k);
    if (!p) { p = { name: name || e, email: e || null, calls: 0, reached: 0, quotes: 0, invoices: 0, revenue: 0, profit: 0, days: new Set(), callsByDay: {} }; people.set(k, p); }
    if (name && (!p.name || p.name === p.email)) p.name = name;
    if (name && e) names.set(key(name), e);
    return p;
  };
  const between = (col) => `${DAY(col)} BETWEEN $1::date AND $2::date`;

  const inv = await query(
    `SELECT lower(created_by) AS email, max(created_by_name) AS name, ${DAY('created_at')}::text AS day, count(*)::int AS n
       FROM invoices WHERE created_by IS NOT NULL AND status <> 'void' AND COALESCE(channel,'manual') <> 'web' AND ${between('created_at')} GROUP BY 1, 3`, [from, to]);
  for (const r of inv.rows) { const p = get(r.email, r.name); p.invoices += r.n; p.days.add(r.day); }

  const acts = await query(
    `SELECT lower(a.by_email) AS email, ${DAY('a.occurred_at')}::text AS day, count(*)::int AS n,
            count(*) FILTER (WHERE a.outcome IN ('conversation','meeting_booked','proposal_sent','not_interested'))::int AS reached
       FROM lead_activities a WHERE a.kind = 'call' AND a.by_email IS NOT NULL AND ${between('a.occurred_at')} GROUP BY 1, 2`, [from, to]);
  const calls = (p, day, k) => { p.calls += k; p.callsByDay[day] = (p.callsByDay[day] || 0) + k; };
  for (const r of acts.rows) { const p = get(r.email, null); calls(p, r.day, r.n); p.reached += r.reached; p.days.add(r.day); }

  const cust = await query(
    `SELECT lower(by_email) AS email, max(by_name) AS name, ${DAY('at')}::text AS day, count(*) FILTER (WHERE kind = 'call')::int AS n
       FROM customer_activity WHERE by_email IS NOT NULL AND kind <> 'system' AND ${between('at')} GROUP BY 1, 3`, [from, to]);
  for (const r of cust.rows) { const p = get(r.email, r.name); calls(p, r.day, r.n); p.days.add(r.day); }

  for (const r of await preTaxProfitByRep(from, to)) {
    if (!r.rep) continue;
    const p = get(null, r.rep);
    p.revenue += r.revenue; p.profit += r.profit; p.quotes += 0; p.days.add(r.day);
  }

  const quotes = await query(
    `SELECT sales_rep AS name, ${DAY('created_at')}::text AS day, count(*)::int AS n FROM quotes
      WHERE sales_rep IS NOT NULL AND ${between('created_at')} GROUP BY 1, 2`, [from, to]);
  for (const r of quotes.rows) { const p = get(null, r.name); p.quotes += r.n; p.days.add(r.day); }

  // The workshop Board's calls live in the rssolutions.ca admin. Without them the
  // rep who works that board reads as having done nothing.
  try {
    const { getChaser } = await import('./lead-chaser');
    const rep = (await getChaser()).rep;
    if (rep) {
      const { rsActivity, isRep, repNames } = await import('./rep-day');
      const who = get(rep, null);
      const mine = repNames(who.name, rep);
      const days = await Promise.all(rsDays.map(async (d) => ({ d, r: await rsActivity(d, fetchImpl) })));
      const failed = days.filter((x) => !x.r.ok);
      if (failed.length) blind.push(`the RS Solutions workshop Board for ${failed.length} of ${days.length} days (${failed[0].r.error})`);
      for (const { d, r } of days) {
        if (!r.ok) continue;
        const board = r.entries.filter((e) => (e.kind === 'spoke' || e.kind === 'tried') && isRep(e.by, mine));
        if (!board.length) continue;
        calls(who, d, board.length); who.reached += board.filter((e) => e.kind === 'spoke').length; who.days.add(d);
      }
    }
  } catch (e) { blind.push(`the RS Solutions workshop Board (${e?.message || 'failed'})`); }

  const owners = adminEmails();
  const ownerNames = new Set(['rssolutions', 'website']);
  const all = [...people.values()].map((p) => ({ ...p, days: [...p.days] }));
  const isOwner = (p) => (p.email && (owners.includes(p.email) || isAgent(p.email))) || ownerNames.has(key(p.name));
  return { staff: all.filter((p) => !isOwner(p)), house: all.filter(isOwner) };
}

export async function fetchFloor(fetchImpl = fetch, days = REVIEW_DAYS) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return { ok: false, error: 'RSOPS_INTAKE_KEY is not set' };
  try {
    const res = await fetchImpl(`${RSOPS_BASE()}/api/intake/floor?days=${days}`, {
      headers: { 'x-rsops-key': key }, cache: 'no-store', signal: AbortSignal.timeout(20000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(body.units)) return { ok: false, error: body.error || `RS Ops answered ${res.status}` };
    return { ok: true, workers: body.workers || [], units: body.units };
  } catch (e) { return { ok: false, error: e?.message || 'RS Ops unreachable' }; }
}

export async function gatherFacts({ now = new Date(), fetchImpl = fetch } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const today = torontoToday(now);
  const win = monthWindows(today);
  const from = addDays(today, -(REVIEW_DAYS - 1));
  const blind = [];
  const read = async (label, fn, fallback = null) => {
    try { return await fn(); }
    catch (e) { console.error(`exec read failed: ${label}`, e?.message || e); blind.push(`${label} (${String(e?.message || 'failed').slice(0, 120)})`); return fallback; }
  };

  const [pnl, prevPnl, nowStreams, prevStreams, nowClients, prevClients] = await Promise.all([
    read('this month\'s profit', async () => (await (await import('./daily-pnl')).dailyPnl({ from: win.from, to: win.to }))),
    read('last month\'s profit', async () => (await (await import('./daily-pnl')).dailyPnl({ from: win.prevFrom, to: win.prevTo }))),
    read('this month\'s sales', () => appliedStreams(win.from, win.to)),
    read('last month\'s sales', () => appliedStreams(win.prevFrom, win.prevTo)),
    read('client delivery revenue', () => clientDelivery(win.from, win.to)),
    read('last month\'s client delivery revenue', () => clientDelivery(win.prevFrom, win.prevTo))
  ]);

  const line = (label, k) => ({ key: k, label, now: nowStreams ? nowStreams[k] : null, before: prevStreams ? prevStreams[k] : null });
  const streams = streamBoard([
    line('Appliances sold by staff', 'staff'),
    line('Appliances sold on the website', 'web'),
    line('Reseller / member sales', 'resellers'),
    line('Delivery, install and haul-away on our sales', 'services'),
    { key: 'clients', label: 'Delivery and service for client companies', now: nowClients?.total ?? null, before: prevClients?.total ?? null },
    { key: 'marketplace', label: 'Marketplace commission and fees', now: pnl?.totals?.marketplaceIncome ?? null, before: prevPnl?.totals?.marketplaceIncome ?? null }
  ], win);

  const billedThrough = (await (await import('./settings')).getSetting('manager_exec', null))?.billedThrough || '';
  const money = await read('money that is owed or stuck', () => stuckMoney(today, billedThrough), {});
  const shifts = await read('the time clocks', async () => (await (await import('./hours')).hoursReport({ from, to: today })).shifts, []);
  const stops = await read('the dispatch board', () => stopRows(from, today), []);
  const rsDays = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const sales = await read('sales activity', () => salesRows(from, today, { rsDays, fetchImpl, blind }), { staff: [], house: [] });

  const floorRes = await fetchFloor(fetchImpl);
  if (!floorRes.ok) blind.push(`the refurb floor in RS Ops (${floorRes.error})`);
  const sets = await read('the website\'s stock', async () => {
    const { rows } = await query('SELECT upper(sku) AS sku, active, price::float AS price, cost::float AS cost FROM products');
    const sold = new Set((await query(
      `SELECT DISTINCT upper(oi.sku) AS sku FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.sku IS NOT NULL AND ${SALE('o')}`)).rows.map((r) => r.sku));
    const live = rows.filter((r) => r.active);
    return { onSite: new Set(live.map((r) => r.sku)), sold, live };
  });

  // The tracker knows what was sold on a typed line, and how long a unit has been here.
  const tracker = await read('the master tracker', async () => {
    const { sheetsConfigured, readTrackerRows } = await import('./sheets');
    if (!sheetsConfigured()) throw new Error('Google Sheets is not configured');
    return readTrackerRows();
  });
  let stale = null;
  if (tracker && sets) {
    for (const t of tracker) if (/sold|salvage/i.test(t.status)) sets.sold.add(String(t.sku).toUpperCase());
    const { ageDays } = await import('./manager-policy');
    const live = new Map(sets.live.map((r) => [r.sku, r]));
    const old = tracker.filter((t) => live.has(String(t.sku).toUpperCase()) && (ageDays(t.dateReceived, now.getTime()) || 0) >= 90);
    stale = { count: old.length, tied: old.reduce((a, t) => a + n(live.get(String(t.sku).toUpperCase()).cost), 0) };
  }
  const priced = (sets?.live || []).filter((r) => r.price > 0);
  const avgPrice = priced.length ? priced.reduce((a, r) => a + r.price, 0) / priced.length : 0;

  const flow = floorRes.ok ? floorFlow({
    units: floorRes.units, workers: floorRes.workers,
    // Without the tracker we cannot tell a sold unit from a hidden one, so no claim is made.
    onSite: tracker && sets ? sets.onSite : null, sold: tracker && sets ? sets.sold : null, now
  }) : null;

  const people = peopleReview({ shifts, floor: floorRes.ok ? floorRes.workers : [], stops, sales: sales.staff, today });
  // With the floor unread, a warehouse day would look blank for everybody: say nothing about it.
  if (!floorRes.ok) for (const p of people) p.flags = p.flags.filter((f) => f.key !== 'unrecorded');

  const todayStops = await read('today\'s run', async () => (await query(
    `SELECT u.name, lower(u.email) AS email, count(*)::int AS count FROM jobs j JOIN users u ON u.id IN (j.driver_id, j.driver2_id)
      WHERE j.job_date = $1::date AND j.status <> 'cancelled' AND j.type <> 'return_to_base' GROUP BY 1, 2`, [today])).rows, []);
  const stopDays = {};
  for (const s of stops) {
    const k = `${s.email}|${s.day}`;
    stopDays[k] = (stopDays[k] || 0) + Math.max(0, s.done - s.noProof);
  }

  const callList = await read('the daily call list', async () => (await import('./lead-daily')).getDailyConfig());

  const leads = await read('waiting leads', async () => (await (await import('./lead-chaser')).uncalledLeads()));
  const houseRevenue = sales.house.reduce((a, p) => a + p.revenue, 0);
  const staffRevenue = sales.staff.reduce((a, p) => a + p.revenue, 0);

  return {
    today, win, reviewFrom: from, blind, streams,
    sales: nowStreams ? nowStreams.web + nowStreams.resellers + nowStreams.staff + nowStreams.services : null,
    pnl: pnl ? {
      income: pnl.totals.income, cost: pnl.totals.cost, net: pnl.totals.net, productProfit: pnl.totals.productProfit,
      deliveryIncome: pnl.totals.deliveryIncome, deliveryCost: pnl.totals.deliveryCost, wages: pnl.totals.staffWages, overhead: pnl.totals.overhead,
      daysMade: pnl.totals.daysMade, daysLost: pnl.totals.daysLost, warnings: pnl.warnings,
      prevNet: prevPnl?.totals?.net ?? null
    } : null,
    money, people, flow, stale, leads, avgPrice, todayStops, stopDays, callList,
    salesShare: houseRevenue + staffRevenue > 0
      ? { housePct: Math.round((houseRevenue / (houseRevenue + staffRevenue)) * 100), house: houseRevenue, staff: staffRevenue, days: REVIEW_DAYS }
      : null
  };
}
