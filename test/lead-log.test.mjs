// lib/lead-log.js — the lead log and its funnel.
//
// The rules under test: a lead needs a source; what they wanted and which partner sent it are kept; "no stock" is its own
// lost reason; BOUGHT IS DERIVED from the orders (never typed), and a lead that was lost and later bought is bought; RS Solutions
// and imported leads stay out of the funnel; unrecorded sources are a row, not a gap; a rep sees only their own leads.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { logLead, setLeadOutcome, leadFunnel, recentLog, summarizeLeads, knownDetails } from '../lib/lead-log.js';

const sam = { email: 'sam@bargainbay.ca', name: 'Sam', admin: false };
const kim = { email: 'kim@bargainbay.ca', name: 'Kim', admin: false };
const owner = { email: 'owner@rssolutions.ca', name: 'Owner', admin: true };
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };

suite('lead log — writing a lead down');

test('a lead needs a source and a way to reach them; what they wanted and who sent it are kept', async () => {
  const { done } = await withTestDb();
  try {
    assert(await rejects(() => logLead({ contactName: 'Ana', phone: '416-555-0101' }, sam), 'source'), 'no source is refused');
    assert(await rejects(() => logLead({ contactName: 'Ana', source: 'phone' }, sam)), 'no phone or email is refused');
    const { id } = await logLead({
      contactName: 'Ana', phone: '416-555-0101', source: 'partner', sourceDetail: 'SecondShop',
      wantedCategory: 'refrigerator', wanted: 'LG 36in French door'
    }, sam);
    const [row] = (await recentLog(sam)).filter((r) => r.id === id);
    equal(row.source, 'partner'); equal(row.detail, 'SecondShop');
    equal(row.wanted_category, 'refrigerator'); equal(row.wanted, 'LG 36in French door');
    equal(row.status, 'open');
    assert((await knownDetails(sam)).includes('SecondShop'), 'the partner name is offered next time');
  } finally { await done(); }
});

test('the same phone number twice is blocked, not counted twice', async () => {
  const { done } = await withTestDb();
  try {
    await logLead({ contactName: 'Ana', phone: '416-555-0101', source: 'phone' }, sam);
    assert(await rejects(() => logLead({ contactName: 'Ana again', phone: '(416) 555 0101', source: 'social' }, kim), 'duplicate'));
  } finally { await done(); }
});

suite('lead log — what became of them');

test('lost needs a reason; "no stock" is accepted; reopen puts it back', async () => {
  const { done } = await withTestDb();
  try {
    const { id } = await logLead({ contactName: 'Bo', phone: '416-555-0102', source: 'phone', wantedCategory: 'range' }, sam);
    assert(await rejects(() => setLeadOutcome(id, { outcome: 'lost' }, sam), 'reason'), 'a lost lead must say why');
    assert(await rejects(() => setLeadOutcome(id, { outcome: 'lost', lostReason: 'made-up' }, sam), 'reason'));
    await setLeadOutcome(id, { outcome: 'lost', lostReason: 'no_stock' }, sam);
    equal((await recentLog(sam)).find((r) => r.id === id).status, 'lost');
    await setLeadOutcome(id, { outcome: 'open' }, sam);
    equal((await recentLog(sam)).find((r) => r.id === id).status, 'open');
    assert(await rejects(() => setLeadOutcome(id, { outcome: 'won' }), undefined), 'won is never set by hand');
  } finally { await done(); }
});

test('bought is worked out from the orders, and beats a lost mark', async () => {
  const { done } = await withTestDb();
  try {
    const a = await logLead({ contactName: 'Cy', email: 'cy@x.ca', source: 'website' }, sam);
    const b = await logLead({ contactName: 'Di', phone: '416-555-0103', source: 'phone' }, sam);
    await setLeadOutcome(b.id, { outcome: 'lost', lostReason: 'price' }, sam);
    await query(`INSERT INTO orders (email, phone, status) VALUES ('CY@x.ca', null, 'confirmed')`);
    await query(`INSERT INTO orders (email, phone, status) VALUES ('di@elsewhere.ca', '+1 (416) 555-0103', 'delivered')`);
    const log = await recentLog(sam);
    equal(log.find((r) => r.id === a.id).status, 'bought', 'matched on email, case-insensitive');
    equal(log.find((r) => r.id === b.id).status, 'bought', 'matched on phone; a lost lead that bought is bought');
    const f = await leadFunnel(sam);
    equal(f.bought, 2); equal(f.lost, 0); equal(f.conversionPct, 100);
  } finally { await done(); }
});

test('a cancelled order or one placed before the lead does not count as a sale', async () => {
  const { done } = await withTestDb();
  try {
    await query(`INSERT INTO orders (email, status, created_at) VALUES ('old@x.ca', 'confirmed', now() - interval '3 days')`);
    await query(`INSERT INTO orders (email, status) VALUES ('cx@x.ca', 'cancelled')`);
    const a = await logLead({ contactName: 'Old', email: 'old@x.ca', source: 'website' }, sam);
    const b = await logLead({ contactName: 'Cx', email: 'cx@x.ca', source: 'website' }, sam);
    await query(`INSERT INTO orders (email, status) VALUES ('cx@x.ca', 'cancelled')`);
    const log = await recentLog(sam);
    equal(log.find((r) => r.id === a.id).status, 'open');
    equal(log.find((r) => r.id === b.id).status, 'open');
  } finally { await done(); }
});

suite('lead log — the funnel');

test('summarizeLeads: unrecorded sources are a row, no stock is counted on its own, and what was missed is listed', () => {
  const rows = [
    { id: 1, source: 'partner', detail: 'SecondShop', stage: 'new', bought: true, day: '2026-11-10' },
    { id: 2, source: 'partner', detail: 'SecondShop', stage: 'lost', lost_reason: 'no_stock', wanted_category: 'refrigerator', wanted: 'LG 36in', bought: false, day: '2026-11-10' },
    { id: 3, source: 'partner', detail: 'Aljo', stage: 'lost', lost_reason: 'price', bought: false, day: '2026-11-11' },
    { id: 4, source: null, stage: 'new', bought: false, day: '2026-11-11' },
    { id: 5, source: 'phone', stage: 'lost', lost_reason: 'no_stock', bought: false, day: '2026-11-11' }
  ];
  const s = summarizeLeads(rows);
  equal(s.total, 5); equal(s.bought, 1); equal(s.lost, 3); equal(s.open, 1);
  equal(s.conversionPct, 20); equal(s.decidedPct, 25);
  equal(s.noStock, 2); equal(s.noStockPct, 40);
  equal(s.lostByReason.price, 1); equal(s.lostByReason.timing, 0, 'every reason is listed, even at zero');
  assert(s.bySource.some((b) => b.label === 'Not recorded' && b.leads === 1), 'a lead with no source is a row');
  const second = s.bySource.find((b) => b.detail === 'SecondShop');
  equal(second.leads, 2); equal(second.noStock, 1); equal(second.conversionPct, 50);
  assert(s.bySource.some((b) => b.detail === 'Aljo'), 'partners are separate rows');
  equal(s.missed[0].label, 'Refrigerator'); equal(s.missed[0].count, 1);
  assert(s.missed.some((m) => m.label === 'Not recorded'), 'a no-stock lead with no category is still counted');
  equal(s.missedItems[0].wanted, 'LG 36in');
  equal(s.byDay.map((d) => `${d.day}:${d.leads}`).join(), '2026-11-10:2,2026-11-11:3');
});

test('summarizeLeads on nothing is zeros and nulls, never a divide by zero', () => {
  const s = summarizeLeads([]);
  equal(s.total, 0); equal(s.conversionPct, null); equal(s.noStockPct, null); equal(s.bySource.length, 0);
});

test('RS Solutions and imported leads stay out; a rep sees only their own; an admin sees everyone', async () => {
  const { done } = await withTestDb();
  try {
    await logLead({ contactName: 'Mine', phone: '416-555-0111', source: 'phone' }, sam);
    await logLead({ contactName: 'Hers', phone: '416-555-0112', source: 'social' }, kim);
    await query(`INSERT INTO leads (side, company, phone, source) VALUES ('rs', 'RS Co', '4165550113', 'website')`);
    await query(`INSERT INTO leads (side, company, phone, source) VALUES ('bb', 'Imported Co', '4165550114', 'imported')`);
    equal((await leadFunnel(sam)).total, 1);
    equal((await leadFunnel(kim)).total, 1);
    equal((await leadFunnel(owner)).total, 2, 'admin sees both consumer leads and neither the RS lead nor the imported one');
  } finally { await done(); }
});
