// The sales scorecard: who closed it, who sent it, and the quota against it.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { repScorecard } from '../lib/analytics.js';
import { setQuota, quotasFor, firstOfMonth } from '../lib/quotas.js';
import { setReps } from '../lib/reps.js';
import { isOwnLead, leadOwner, standing, repKey } from '../lib/rep-match.js';
import { torontoToday } from '../lib/constants.js';

// lib/settings and lib/reps provision their own tables lazily and remember that
// they did, per process — so a second database in the same run needs them made
// by hand or it never gets them.
async function fresh() {
  const db = await withTestDb();
  await db.client.query(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now())`);
  await db.client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text');
  await db.client.query('ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep text');
  return db;
}
let n = 0;
async function order(client, { rep, leadBy, total = 1130, hst = 130, status = 'confirmed' }) {
  n += 1;
  await client.query(
    `INSERT INTO orders (order_number, email, name, status, total, hst, subtotal, sales_rep, lead_by, created_at)
     VALUES ($1,'a@b.ca','A',$2,$3,$4,$5,$6,$7, now())`,
    [`BB-T${n}`, status, total, hst, total - hst, rep ?? null, leadBy ?? null]);
}

suite('own-lead matching');
test('exact name, any case or spacing', () => {
  assert(isOwnLead(repKey('Roushi'), repKey(' ROUSHI '), ['roushi']));
});
test('a first name matches a full-name rep when it is unambiguous', () => {
  assert(isOwnLead('roushi sharma', 'roushi', ['roushi sharma', 'bishaka rai']));
});
test('two reps sharing a first name: the first name credits NEITHER', () => {
  assert(!isOwnLead('sam a', 'sam', ['sam a', 'sam b']));
});
test('someone else’s lead is not the closer’s own', () => {
  assert(!isOwnLead('roushi', 'ravi', ['roushi', 'bishaka']));
  assert(!isOwnLead('roushi', '', ['roushi']));
});
test('standing: hit, on pace, close, behind, and no target', () => {
  equal(standing(100, 100, 0.5).status, 'hit');
  equal(standing(60, 100, 0.5).status, 'on_pace');
  equal(standing(40, 100, 0.5).status, 'close');
  equal(standing(10, 100, 0.5).status, 'behind');
  equal(standing(10, null, 0.5), null);
});

test('leadOwner names the rep a sent-by belongs to, or nobody', () => {
  equal(leadOwner('roushi', ['roushi sharaf', 'bishakha']), 'roushi sharaf');
  equal(leadOwner('sai', ['roushi sharaf', 'bishakha']), '');
  equal(leadOwner('', ['roushi']), '');
});

suite('rep scorecard');
test('LEAD REVENUE BELONGS TO THE SENDER, WHOEVER CLOSED IT', async () => {
  const { client, done } = await fresh();
  try {
    await setReps(['Roushi', 'Bishaka']);
    await order(client, { rep: 'Roushi', leadBy: 'roushi' });        // Roushi's lead, Roushi closed
    await order(client, { rep: 'Bishaka', leadBy: 'Roushi' });       // Roushi's lead, BISHAKA closed
    await order(client, { rep: 'Roushi', leadBy: 'Sai' });           // sent by Sai (not a rep)
    await order(client, { rep: 'Bishaka', leadBy: 'Ravi' });         // sent by Ravi
    await order(client, { rep: 'Bishaka' });                         // company lead
    await order(client, { leadBy: 'Bishaka' });                      // Bishaka's lead, no closer recorded
    await order(client, { rep: 'Roushi', status: 'cancelled' });     // not a sale
    const s = await repScorecard('month');
    const by = Object.fromEntries(s.reps.map((r) => [r.name, r]));
    // CLOSED: what each person closed
    equal(by.Roushi.sales, 2); equal(by.Bishaka.sales, 3);
    // LEAD: what each person's leads produced, closed by anyone
    equal(by.Roushi.ownSales, 2, 'both of Roushi\'s leads, including the one Bishaka closed');
    equal(Math.round(by.Roushi.ownRevenue), 2000);
    equal(by.Bishaka.ownSales, 1, 'only her own lead — she does NOT get Roushi\'s');
    equal(s.unassigned.sales, 1);
    equal(s.totals.sales, 6);
    equal(Math.round(by.Roushi.revenue), 2000, 'pre-tax, not the taxed total');
    equal(Math.round(by.Roushi.gross), 2260, 'with HST beside it');
    const gens = Object.fromEntries(s.leadGens.map((g) => [g.key, g]));
    equal(gens.roushi.sales, 2); equal(gens.sai.sales, 1); equal(gens.ravi.sales, 1);
    equal(Math.round(gens.roushi.gross), 2260);
    assert(gens.roushi.isRep && !gens.sai.isRep);
    equal(s.windows.reps.find((r) => r.name === 'Roushi').today.sales, 2);
  } finally { done(); }
});

suite('quotas');
test('a quota carries forward, and the month it was set in is history', async () => {
  const { done } = await fresh();
  try {
    const m = firstOfMonth(torontoToday());
    await setQuota({ rep: 'Roushi', revenue: 50000, sales: 20, ownRevenue: 15000, ownSales: 6, by: 'owner' });
    const q = (await quotasFor(m)).map.get('roushi');
    equal(q.revenue, 50000); equal(q.ownSales, 6);
    const later = (await quotasFor('2099-01-01')).map.get('roushi');
    equal(later.sales, 20, 'carries into later months');
    let refused = false;
    try { await setQuota({ rep: 'Roushi', month: '2020-01-01', revenue: 1 }); } catch { refused = true; }
    assert(refused, 'a past month is refused');
    let bad = false;
    try { await setQuota({ rep: 'Roushi', revenue: -5 }); } catch { bad = true; }
    assert(bad, 'negative target refused');
  } finally { done(); }
});
test('quota progress is measured against this month’s actuals', async () => {
  const { client, done } = await fresh();
  try {
    await setReps(['Roushi']);
    await setQuota({ rep: 'Roushi', revenue: 2000, sales: 4, ownRevenue: 1000, ownSales: 1 });
    await order(client, { rep: 'Roushi', leadBy: 'Roushi' });
    await order(client, { rep: 'Roushi', leadBy: 'Sai' });
    await order(client, { rep: 'Someone', leadBy: 'Roushi' });   // closed by another, still his lead
    const s = await repScorecard('today');
    const r = s.quota.rows.find((x) => x.name === 'Roushi');
    equal(r.actual.sales, 2); equal(r.actual.ownSales, 2, 'lead sales count a sale someone else closed');
    equal(r.standing.ownSales.status, 'hit');
    assert(r.standing.sales.pct === 50);
  } finally { done(); }
});
