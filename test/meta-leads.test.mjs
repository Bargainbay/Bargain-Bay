// Meta lead forms -> boards (lib/meta-leads.js, lib/meta-leads-rules.js).
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { parsePages, leadFromMeta, destinationFor, reachable } from '../lib/meta-leads-rules.js';
import { runMetaLeadPull, staleMetaLeads } from '../lib/meta-leads.js';

suite('meta leads');

test('pages are parsed; junk is ignored; the RS page is the default', () => {
  equal(JSON.stringify(parsePages('')), JSON.stringify([{ id: '656416010891883', side: 'rs' }]));
  equal(parsePages('111111:bb, 222222:rs, x:bb, 333333:zz').length, 2);
});
test('a Graph lead becomes name, email, phone and an ISO time', () => {
  const l = leadFromMeta({ id: '9', created_time: '2026-11-19T06:24:00+0000', field_data: [
    { name: 'full_name', values: ['Mahmed Can'] }, { name: 'email', values: ['M@X.com'] }, { name: 'phone_number', values: ['+16477184086'] }] }, 'Workshop');
  equal(l.name, 'Mahmed Can'); equal(l.email, 'm@x.com'); equal(l.createdAt, '2026-11-19T06:24:00.000Z'); assert(reachable(l));
  assert(!reachable(leadFromMeta({ id: '1', created_time: '2026-11-19T06:24:00+0000', field_data: [{ name: 'full_name', values: ['No Contact'] }] })));
});
test('routing: RS workshop form -> Board; other RS form -> hub RS; BB page -> hub BB', () => {
  equal(destinationFor('rs', 'Workshop Nov 2026 - Reserve a seat'), 'workshop');
  equal(destinationFor('rs', 'AI receptionist'), 'hub-rs');
  equal(destinationFor('bb', 'Workshop copy'), 'hub-bb');
});

const lead = (id, name, email, phone, t = '2026-11-19T06:24:00+0000') => ({ id, created_time: t, campaign_name: 'Camp', field_data: [{ name: 'full_name', values: [name] }, { name: 'email', values: [email] }, { name: 'phone_number', values: [phone] }] });
function fakeMeta(leads, forms = [{ id: 'F1', name: 'Bargain Bay Clearance' }]) {
  return async (url) => {
    const u = String(url);
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (/leadgen_forms/.test(u)) return ok({ data: forms });
    if (/\/F1\/leads/.test(u)) return ok({ data: leads });
    return ok({});
  };
}

test('a Bargain Bay page lead lands on the hub board once; a second pass adds nothing; the same person is not added twice', async () => {
  const { done } = await withTestDb();
  process.env.META_LEADS_ACCESS_TOKEN = 't'; process.env.META_LEAD_PAGES = '111111:bb';
  try {
    const f = fakeMeta([lead('L1', 'Ann Lee', 'ann@x.com', '+14165550101'), lead('L2', 'Ann Again', 'ann@x.com', '+14165550199')]);
    const r1 = await runMetaLeadPull({ fetchImpl: f });
    equal(r1.added['hub-bb'], 1); equal(r1.already, 1);
    const row = (await query(`SELECT side, source, created_by, stage FROM leads`)).rows;
    equal(row.length, 1); equal(row[0].side, 'bb'); equal(row[0].source, 'social'); equal(row[0].created_by, 'meta-leads@system');
    const r2 = await runMetaLeadPull({ fetchImpl: f });
    equal(r2.added['hub-bb'], 0); equal((await query(`SELECT 1 FROM leads`)).rows.length, 1);
    equal((await query(`SELECT 1 FROM meta_leads_seen`)).rows.length, 2);
  } finally { delete process.env.META_LEADS_ACCESS_TOKEN; delete process.env.META_LEAD_PAGES; done(); }
});
test('no token: nothing is pulled and it says so; an unreachable lead is skipped, not retried', async () => {
  const { done } = await withTestDb();
  try {
    const r0 = await runMetaLeadPull({ fetchImpl: fakeMeta([]) });
    equal(r0.configured, false); assert(/No Meta token/.test(r0.error));
    process.env.META_LEADS_ACCESS_TOKEN = 't'; process.env.META_LEAD_PAGES = '111111:bb';
    const r = await runMetaLeadPull({ fetchImpl: fakeMeta([{ id: 'U1', created_time: '2026-11-19T06:24:00+0000', field_data: [{ name: 'full_name', values: ['Nobody'] }] }]) });
    equal(r.unreachable, 1); equal((await query(`SELECT 1 FROM leads`)).rows.length, 0);
  } finally { delete process.env.META_LEADS_ACCESS_TOKEN; delete process.env.META_LEAD_PAGES; done(); }
});
test('a Meta error is reported as a failed pass, and nothing is remembered', async () => {
  const { done } = await withTestDb();
  process.env.META_LEADS_ACCESS_TOKEN = 't'; process.env.META_LEAD_PAGES = '111111:bb';
  try {
    const r = await runMetaLeadPull({ fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Token expired' } }) }) });
    equal(r.ok, false); assert(/Token expired/.test(r.error)); equal((await query(`SELECT 1 FROM meta_leads_seen`)).rows.length, 0);
  } finally { delete process.env.META_LEADS_ACCESS_TOKEN; delete process.env.META_LEAD_PAGES; done(); }
});
test('the Manager sees leads nobody has touched after 4 hours', async () => {
  const { done } = await withTestDb();
  try {
    await query(`INSERT INTO leads (side, contact_name, email, source, created_by, created_at) VALUES ('bb','Old','o@x.com','social','meta-leads@system', now() - interval '30 hours'), ('bb','New','n@x.com','social','meta-leads@system', now())`);
    const s = await staleMetaLeads({ hours: 4 });
    equal(s.hubBb, 1); assert(s.oldestHours >= 29);
  } finally { done(); }
});
