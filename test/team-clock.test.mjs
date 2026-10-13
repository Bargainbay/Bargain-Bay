import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { dailyShare, daysBetween } from '../lib/daily-cost-math.js';

suite('daily cost math');

test('a month of daily shares adds back to the bill', () => {
  const c = { amount: 3100, frequency: 'monthly', starts_on: '2026-01-01' };
  const oct = daysBetween('2026-10-01', '2026-10-31').reduce((a, d) => a + dailyShare(c, d), 0);
  assert(Math.abs(oct - 3100) < 0.001, `October summed to ${oct}`);
  const feb = daysBetween('2026-02-01', '2026-02-28').reduce((a, d) => a + dailyShare(c, d), 0);
  assert(Math.abs(feb - 3100) < 0.001, `February summed to ${feb}`);
});
test('a year of annual shares adds back (leap year too)', () => {
  const c = { amount: 1200, frequency: 'annual', starts_on: '2024-01-01' };
  const y = daysBetween('2024-01-01', '2024-12-31').reduce((a, d) => a + dailyShare(c, d), 0);
  assert(Math.abs(y - 1200) < 0.001, `2024 summed to ${y}`);
});
test('nothing before it starts or after it ends; once is a single day', () => {
  const c = { amount: 100, frequency: 'daily', starts_on: '2026-10-05', ends_on: '2026-10-07' };
  equal(dailyShare(c, '2026-10-04'), 0);
  equal(dailyShare(c, '2026-10-06'), 100);
  equal(dailyShare(c, '2026-10-08'), 0);
  const o = { amount: 500, frequency: 'once', starts_on: '2026-10-05' };
  equal(dailyShare(o, '2026-10-05'), 500);
  equal(dailyShare(o, '2026-10-06'), 0);
});

suite('team clock (real SQL)');

test('clock in, double tap, clock out, snapshot rate, daily wages', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const emp = await tc.saveEmployee({ email: 'Sam@Example.com', name: 'Sam', hourlyRate: '20' }, 'owner');
    assert((await tc.employeeByEmail('sam@example.com')).id === emp.id, 'lookup is case-insensitive');
    const a = await tc.clockIn(emp);
    const b = await tc.clockIn(emp);
    assert(!a.already && b.already && a.shift.id === b.shift.id, 'second tap must not open a second shift');
    // Back-date and close: 2 hours at the snapshotted rate.
    await db.client.query("UPDATE staff_shifts SET started_at = now() - interval '2 hours' WHERE id = $1", [a.shift.id]);
    await tc.saveEmployee({ email: 'sam@example.com', hourlyRate: '30' }, 'owner'); // a raise
    await tc.clockOut(emp);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const labour = await tc.staffLabourByDay(today, today);
    const d = [...labour.days.values()][0];
    assert(d && Math.abs(d.cost - 40) < 0.5, `expected ~$40 at the old rate, got ${d && d.cost}`);
    equal(labour.open, 0);
    const out2 = await tc.clockOut(emp);
    assert(out2.already, 'clocking out twice is a no-op');
  } finally { db.done(); }
});

test('cannot remove someone who is clocked in', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const emp = await tc.saveEmployee({ email: 'lee@example.com', hourlyRate: 18 });
    await tc.clockIn(emp);
    let msg = '';
    try { await tc.endEmployee(emp.id); } catch (e) { msg = e.message; }
    assert(/clocked in/.test(msg), 'should refuse');
  } finally { db.done(); }
});

test('daily P&L: overhead and wages reduce net; empty day is overhead only', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const { dailyPnl } = await import('../lib/daily-pnl.js');
    // order_items.cost and the dispatch tables are added by runtime ensure*() in production, not by a migration.
    await db.client.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(12,2)');
    const { ensureJobSchema } = await import('../lib/jobs.js');
    await ensureJobSchema();
    const { ensureShiftSchema } = await import('../lib/shifts.js');
    await ensureShiftSchema();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    await db.client.query("INSERT INTO recurring_costs (name, category, amount, frequency, starts_on) VALUES ('Daily thing','Other',100,'daily',$1)", [today]);
    const emp = await tc.saveEmployee({ email: 'pat@example.com', hourlyRate: 25 });
    const s = await tc.clockIn(emp);
    await db.client.query("UPDATE staff_shifts SET started_at = now() - interval '4 hours' WHERE id = $1", [s.shift.id]);
    await tc.clockOut(emp);
    const r = await dailyPnl({ from: today, to: today });
    const row = r.rows[0];
    equal(row.overhead, 100);
    assert(Math.abs(row.staffWages - 100) < 0.5, `wages ${row.staffWages}`);
    assert(Math.abs(row.net + 200) < 0.5, `net ${row.net}`);
  } finally { db.done(); }
});

suite('team clock: RS Ops name match');

test('an RS Ops name matches one active RS Solutions employee, never two or the wrong company', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const a = await tc.saveEmployee({ email: 'dinesh@x.ca', name: 'Dinesh', company: 'rs_solutions' }, 'o');
    await tc.saveEmployee({ email: 'bish@x.ca', name: 'Bishakha', company: 'bargain_bay' }, 'o');
    equal((await tc.employeeByRsOpsName(' dinesh ')).id, a.id);
    equal(await tc.employeeByRsOpsName('Bishakha'), null);
    await tc.saveEmployee({ email: 'dinesh2@x.ca', name: 'Dinesh', company: 'rs_solutions' }, 'o');
    equal(await tc.employeeByRsOpsName('Dinesh'), null);
  } finally { db.done(); }
});

suite('end-of-day sales (real SQL)');

test('created vs paid, pre-tax sales, unit cost only, missing cost reported', async () => {
  const db = await withTestDb();
  try {
    const q = (s, p) => db.client.query(s, p);
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text');
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS channel text');
    await q("INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ('A1','LG','M1','Fridge',1000,600,true)");
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const mk = async (num, status, sub, paidToday) => (await q(
      `INSERT INTO invoices (number, email, name, status, subtotal, hst, total, created_at, paid_at)
       VALUES ($1,'a@b.ca','Cust',$2,$3,$4,$5, now(), $6) RETURNING id`,
      [num, status, sub, round(sub * 0.13), round(sub * 1.13), paidToday ? new Date().toISOString() : null])).rows[0].id;
    const round = (v) => Math.round(v * 100) / 100;
    // INV-1: $1000 unit (cost 600 from products) + $100 delivery, paid today
    const a = await mk('INV-1', 'paid', 1100, true);
    await q("INSERT INTO invoice_items (invoice_id, description, sku, amount, kind) VALUES ($1,'Fridge','A1',1000,'unit'),($1,'Delivery',NULL,100,'service')", [a]);
    // INV-2: $500 typed unit with line cost 300, still open
    const b = await mk('INV-2', 'open', 500, false);
    await q("INSERT INTO invoice_items (invoice_id, description, amount, kind, cost) VALUES ($1,'Stove',500,'unit',300)", [b]);
    // INV-3: void, must not count anywhere
    const c = await mk('INV-3', 'void', 999, false);
    await q("INSERT INTO invoice_items (invoice_id, description, amount, kind, cost) VALUES ($1,'x',999,'unit',1)", [c]);
    // INV-4: unit with no cost anywhere
    const d = await mk('INV-4', 'open', 200, false);
    await q("INSERT INTO invoice_items (invoice_id, description, amount, kind) VALUES ($1,'Mystery',200,'unit')", [d]);
    await q("INSERT INTO invoice_payments (invoice_id, amount, method) VALUES ($1,1243,'cash'),($2,100,'etransfer')", [a, b]);

    const { daySales } = await import('../lib/day-sales.js');
    const r = await daySales(today);
    equal(r.created.count, 3);                    // void excluded
    equal(r.created.sales, 1800);                 // 1100 + 500 + 200, pre-tax
    equal(r.created.cost, 900);                   // 600 + 300 + 0 (no cost on file)
    equal(r.created.net, 900);
    equal(r.created.missingCost, 1);
    equal(r.paid.count, 1);
    equal(r.paid.sales, 1100);
    equal(r.paid.cost, 600);                      // the delivery line has no cost of goods
    equal(r.paid.net, 500);
    equal(r.cashReceived, 1343);                  // deposits count as cash, separately
  } finally { db.done(); }
});
suite('one clock at a time + the evening question');

test('cannot start a staff shift while a driver shift is open, nor the reverse', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const sh = await import('../lib/shifts.js');
    await sh.ensureShiftSchema();
    const u = (await db.client.query(`INSERT INTO users (email, name, password_hash, is_driver) VALUES ('driver-4165550100@drivers.bargainbay.ca','Nick Junior','x',true) RETURNING id`)).rows[0];
    const emp = await tc.saveEmployee({ email: 'nick@x.ca', name: 'Nick Junior', company: 'rs_solutions' }, 'o');
    // on the driver app first
    await sh.startShift(u.id, { driving: false });
    let msg = '';
    try { await tc.clockIn(emp); } catch (e) { msg = e.message; }
    assert(/driver app/i.test(msg), `clock-in should be refused, got: ${msg}`);
    await sh.endShift(u.id, {});
    await tc.clockIn(emp);                       // fine once the other is closed
    msg = '';
    try { await sh.startShift(u.id, { driving: false }); } catch (e) { msg = e.message; }
    assert(/staff clock/i.test(msg), `driver start should be refused, got: ${msg}`);
  } finally { db.done(); }
});

test('decide(): first question at 8pm, hourly after a yes, owner ping after 2h of silence, once', async () => {
  const { decide } = await import('../lib/work-presence.js');
  const H = 3600000, eve = Date.parse('2026-10-09T20:00:00-04:00');
  const base = { eveningStart: eve, inWindow: true, pending: null, lastAnsweredAt: null };
  equal(decide({ ...base, now: eve - 1, startedAt: eve - 5 * H }), null);
  equal(decide({ ...base, now: eve, startedAt: eve - 5 * H }), 'ask');
  equal(decide({ ...base, now: eve + 10 * 60000, startedAt: eve + 5 * 60000 }), null);          // just clocked in
  equal(decide({ ...base, now: eve + H + 5 * 60000, startedAt: eve + 5 * 60000 }), 'ask');       // an hour after
  equal(decide({ ...base, now: eve + 30 * 60000, startedAt: eve - 5 * H, lastAnsweredAt: eve }), null);
  equal(decide({ ...base, now: eve + H, startedAt: eve - 5 * H, lastAnsweredAt: eve }), 'ask');
  const asked = eve;
  equal(decide({ ...base, now: asked + 119 * 60000, startedAt: eve - 5 * H, pending: { askedAt: asked } }), null);
  equal(decide({ ...base, now: asked + 120 * 60000, startedAt: eve - 5 * H, pending: { askedAt: asked } }), 'alert');
  equal(decide({ ...base, now: asked + 300 * 60000, startedAt: eve - 5 * H, pending: { askedAt: asked, alertedAt: new Date() } }), null);
  equal(decide({ ...base, inWindow: false, now: eve + 9 * H, startedAt: eve - 5 * H }), null);   // daytime: no new question
  equal(decide({ ...base, inWindow: false, now: asked + 3 * H, startedAt: eve - 5 * H, pending: { askedAt: asked } }), 'alert'); // but silence is still judged
});

test('runPresenceCheck: asks once, answer yes defers an hour, silence alerts the owner once it can be delivered', async () => {
  const db = await withTestDb();
  const realFetch = globalThis.fetch;
  try {
    const tc = await import('../lib/team-clock.js');
    const wp = await import('../lib/work-presence.js');
    const emp = await tc.saveEmployee({ email: 'dinesh@x.ca', name: 'Dinesh', company: 'rs_solutions' }, 'o');
    const { shift } = await tc.clockIn(emp);
    let r = await wp.runPresenceCheck({ force: true });
    equal(r.asked.length, 1);
    r = await wp.runPresenceCheck({ force: true });
    equal(r.asked.length, 0);                                    // still pending: not asked twice
    assert(await wp.openQuestion('staff', shift.id), 'question is open');
    await wp.answerQuestion('staff', shift.id, 'yes');
    r = await wp.runPresenceCheck({ force: true });
    equal(r.asked.length, 0);                                    // an hour has not passed
    await db.client.query(`UPDATE shift_checkins SET answered_at = now() - interval '61 minutes'`);
    r = await wp.runPresenceCheck({ force: true });
    equal(r.asked.length, 1);                                    // hourly after a yes
    await db.client.query(`UPDATE shift_checkins SET asked_at = now() - interval '130 minutes' WHERE answered_at IS NULL`);
    delete process.env.RSOPS_INTAKE_KEY;
    r = await wp.runPresenceCheck({ force: true });
    equal(r.failed.length, 1);                                   // cannot deliver: not marked done, will retry
    process.env.RSOPS_INTAKE_KEY = 'k';
    let sent = null;
    globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body).text; return { ok: true, json: async () => ({ ok: true }) }; };
    r = await wp.runPresenceCheck({ force: true });
    equal(r.alerted.length, 1);
    assert(/Dinesh/.test(sent) && /Call them/.test(sent), `alert text: ${sent}`);
    r = await wp.runPresenceCheck({ force: true });
    equal(r.alerted.length, 0);                                  // once
  } finally { globalThis.fetch = realFetch; db.done(); }
});

test('a question reaches the person on WhatsApp via RS Ops, using the number on their account when none is typed', async () => {
  const db = await withTestDb();
  const realFetch = globalThis.fetch;
  try {
    const tc = await import('../lib/team-clock.js');
    const wp = await import('../lib/work-presence.js');
    await db.client.query(`INSERT INTO users (email, name, phone, password_hash) VALUES ('bish@x.ca','Bishakha','(647) 555-0188','x')`);
    const emp = await tc.saveEmployee({ email: 'bish@x.ca', name: 'Bishakha', company: 'bargain_bay' }, 'o');
    await tc.clockIn(emp);
    process.env.RSOPS_INTAKE_KEY = 'k';
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true }) }; };
    const r = await wp.runPresenceCheck({ force: true });
    equal(r.asked.length, 1);
    equal(calls.length, 1);
    equal(calls[0].body.to, '+16475550188');
    assert(/bargainbay\.ca\/clock/.test(calls[0].body.text), calls[0].body.text);
  } finally { globalThis.fetch = realFetch; db.done(); }
});

suite('empty cost box is blank, not zero');

test('costOrNull: empty and missing are NULL, a typed zero stays zero', async () => {
  const { costOrNull } = await import('../lib/constants.js');
  equal(costOrNull(''), null); equal(costOrNull(null), null); equal(costOrNull(undefined), null);
  equal(costOrNull('abc'), null); equal(costOrNull(-5), null);
  equal(costOrNull(0), 0); equal(costOrNull('0'), 0); equal(costOrNull('131.255'), 131.26);
});

test('an invoice unit line with an empty cost saves NULL, so the tracker cost applies', async () => {
  const { normalizeLines } = await import('../lib/invoices.js');
  const lines = normalizeLines([
    { description: 'Microwave', sku: 'A1', amount: 281.41, kind: 'unit', cost: '' },
    { description: 'Typed', amount: 100, kind: 'unit', cost: '50' },
    { description: 'Haul-away unit', amount: 100, kind: 'unit', cost: 0 },
    { description: 'Delivery', amount: 50, kind: 'service', cost: '' }
  ]);
  equal(lines.map((l) => l.cost), [null, 50, 0, null]);
});

test('audit lists only $0-cost lines whose product has a real cost; ignores void and true zeros', async () => {
  const db = await withTestDb();
  try {
    const q = (s, p) => db.client.query(s, p);
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text');
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q("INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ('A1','LG','M','Fridge',1000,600,true),('H1','LG','M','Hauled',100,0,true)");
    const inv = async (num, status) => (await q("INSERT INTO invoices (number, email, status, subtotal, total) VALUES ($1,'a@b.ca',$2,100,113) RETURNING id", [num, status])).rows[0].id;
    const a = await inv('INV-1', 'paid'), b = await inv('INV-2', 'void'), c = await inv('INV-3', 'paid');
    await q("INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, cost) VALUES ($1,'Fridge','A1',1000,'unit',0),($2,'Fridge','A1',1000,'unit',0),($3,'Hauled','H1',100,'unit',0)", [a, b, c]);
    const { zeroCostLines } = await import('../lib/cost-audit.js');
    const r = await zeroCostLines();
    equal(r.summary.lines, 1); equal(r.invoiceLines[0].invoice, 'INV-1'); equal(r.summary.costLeftOut, 600);
  } finally { db.done(); }
});

suite('team clock: adding a missed shift');

test('add a shift by hand: rate snapshotted, overnight rolls to next day, overlaps / long / future refused', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const emp = await tc.saveEmployee({ email: 'a@x.ca', name: 'Alvin', hourlyRate: '20', company: 'rs_solutions' }, 'o');
    const s1 = await tc.addStaffShift(emp.id, { date: '2026-10-01', start: '11:00', end: '19:00' }, 'owner@x.ca');
    equal(Number(s1.rate), 20);
    equal(Math.round((new Date(s1.ended_at) - new Date(s1.started_at)) / 60000), 480);
    equal(s1.edited_by, 'owner@x.ca');
    const night = await tc.addStaffShift(emp.id, { date: '2026-10-02', start: '22:00', end: '02:00' }, 'o');
    equal(Math.round((new Date(night.ended_at) - new Date(night.started_at)) / 60000), 240);   // past midnight
    const fails = async (args, re) => { let m = ''; try { await tc.addStaffShift(emp.id, args, 'o'); } catch (e) { m = e.message; } assert(re.test(m), `expected ${re}, got "${m}"`); };
    await fails({ date: '2026-10-01', start: '15:00', end: '17:00' }, /overlaps/i);
    await fails({ date: '2026-10-03', start: '01:00', end: '23:00' }, /longer than/i);
    await fails({ date: '2999-01-01', start: '09:00', end: '10:00' }, /future/i);
    await fails({ date: '2026-10-04', start: '', end: '10:00' }, /both/i);
    // and it shows up in the report that totals the hours
    const rep = await tc.staffShiftReport('2026-10-01', '2026-10-02');
    equal(rep.length, 2);
  } finally { db.done(); }
});

suite('$0-cost correction');

test('apply resets only previewed, still-matching lines to NULL; true zeros and void untouched; idempotent', async () => {
  const db = await withTestDb();
  try {
    const q = (s, p) => db.client.query(s, p);
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text');
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q("INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ('A1','LG','M','Fridge',1000,600,true),('H1','LG','M','Hauled',100,0,true)");
    const inv = async (num, status) => (await q("INSERT INTO invoices (number, email, status, subtotal, total) VALUES ($1,'a@b.ca',$2,100,113) RETURNING id", [num, status])).rows[0].id;
    const a = await inv('INV-1', 'paid'), v = await inv('INV-2', 'void'), h = await inv('INV-3', 'paid'), t = await inv('INV-4', 'paid');
    const il = async (id, sku, cost) => (await q("INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, cost) VALUES ($1,'x',$2,100,'unit',$3) RETURNING id", [id, sku, cost])).rows[0].id;
    const fix = await il(a, 'A1', 0), voided = await il(v, 'A1', 0), haul = await il(h, 'H1', 0), typed = await il(t, 'A1', 550);
    const o1 = (await q("INSERT INTO orders (order_number, email, status, total) VALUES ('BB-1','a@b.ca','confirmed',113) RETURNING id")).rows[0].id;
    const oi = (await q("INSERT INTO order_items (order_id, sku, title, price, cost, kind) VALUES ($1,'A1','x',100,0,'unit') RETURNING id", [o1])).rows[0].id;

    const { zeroCostLines, applyZeroCostFix } = await import('../lib/cost-audit.js');
    const pre = await zeroCostLines();
    equal(pre.invoiceLines.map((l) => l.id), [fix]);
    equal(pre.orderLines.ids, [oi]);

    // Even if handed ids it should not touch, apply only changes what matches the rule.
    const r = await applyZeroCostFix({ invoiceLineIds: [fix, voided, haul, typed], orderLineIds: [oi] });
    equal(r.invoiceLines, 1); equal(r.orderLines, 1); equal(r.skipped, 3);
    const cost = async (id) => (await q('SELECT cost FROM invoice_items WHERE id = $1', [id])).rows[0].cost;
    equal(await cost(fix), null);
    equal(Number(await cost(voided)), 0);      // void: untouched
    equal(Number(await cost(haul)), 0);        // product cost 0: a real zero, untouched
    equal(Number(await cost(typed)), 550);     // a real typed cost: untouched
    equal((await q('SELECT cost FROM order_items WHERE id = $1', [oi])).rows[0].cost, null);

    // Second run finds nothing and says so.
    const again = await zeroCostLines();
    equal(again.summary.lines, 0);
    let msg = ''; try { await applyZeroCostFix({ invoiceLineIds: [], orderLineIds: [] }); } catch (e) { msg = e.message; }
    assert(/Nothing to correct/.test(msg));
  } finally { db.done(); }
});

suite('tracker cost on invoices');

test('fillCostsFromTracker: fills blanks the site cannot cost; typed and site-known costs win; empty cell fills nothing', async () => {
  const { fillCostsFromTracker, parseCostCell } = await import('../lib/tracker-cost.js');
  equal(parseCostCell('$273.75'), 273.75); equal(parseCostCell('0'), 0); equal(parseCostCell(''), null); equal(parseCostCell('n/a'), null);
  const tracker = new Map([['A1', 273.75], ['B1', 100], ['C1', 0]]);
  const lines = [
    { sku: 'A1', cost: null, kind: 'unit' },            // site has no cost -> filled
    { sku: 'B1', cost: null, kind: 'unit' },            // site knows 500 -> left NULL (fallback works)
    { sku: 'A1', cost: 40, kind: 'unit' },              // typed -> never overwritten
    { sku: 'D1', cost: null, kind: 'unit' },            // not on the tracker -> blank
    { sku: 'C1', cost: null, kind: 'unit' },            // tracker says a real 0 -> 0
    { sku: null, cost: null, kind: 'service' }
  ];
  const n = await fillCostsFromTracker(lines, { read: async () => tracker, siteCosts: new Map([['B1', 500]]) });
  equal(lines.map((l) => l.cost), [273.75, null, 40, null, 0, null]); equal(n, 2);
});

test('fillCostsFromTracker degrades open: a failing tracker read leaves the line blank, never throws', async () => {
  const { fillCostsFromTracker } = await import('../lib/tracker-cost.js');
  const lines = [{ sku: 'A1', cost: null, kind: 'unit' }];
  const n = await fillCostsFromTracker(lines, { read: async () => { throw new Error('google down'); }, siteCosts: new Map() });
  equal(n, 0); equal(lines[0].cost, null);
});

test('backfill: copies the tracker cost onto blank lines (and their order line); never a typed, void, or tracker-empty line', async () => {
  const db = await withTestDb();
  try {
    const q = (s, p) => db.client.query(s, p);
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text');
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q("INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ('KNOWN','LG','M','Fridge',1000,600,true)");
    const o = (await q("INSERT INTO orders (order_number, email, status, total) VALUES ('BB-1','a@b.ca','confirmed',113) RETURNING id")).rows[0].id;
    const inv = async (num, status, orderId) => (await q("INSERT INTO invoices (number, email, status, subtotal, total, order_id) VALUES ($1,'a@b.ca',$2,100,113,$3) RETURNING id", [num, status, orderId || null])).rows[0].id;
    const a = await inv('INV-1', 'paid', o), v = await inv('INV-2', 'void'), t = await inv('INV-3', 'paid');
    const il = async (id, sku, cost) => (await q("INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, cost) VALUES ($1,'x',$2,100,'unit',$3) RETURNING id", [id, sku, cost])).rows[0].id;
    const fill = await il(a, 'UNTESTED1', null), voided = await il(v, 'UNTESTED1', null), typed = await il(t, 'UNTESTED1', 55),
      empty = await il(t, 'NOCOST', null), known = await il(t, 'KNOWN', null);
    await q("INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,'UNTESTED1','x',100,'unit')", [o]);
    const tracker = new Map([['UNTESTED1', 273.75], ['KNOWN', 600]]);
    const { missingCostLines, applyMissingCostFill } = await import('../lib/cost-audit.js');
    const pre = await missingCostLines({ read: async () => tracker });
    equal(pre.lines.map((l) => l.id), [fill]);                 // void, typed, site-known excluded
    equal(pre.summary.noTrackerCost, 1);                       // NOCOST: blank both places, needs a person
    const r = await applyMissingCostFill({ lineIds: [fill, voided, typed, empty, known], read: async () => tracker });
    equal(r.invoiceLines, 1); equal(r.orderLines, 1);
    const c = async (id) => (await q('SELECT cost FROM invoice_items WHERE id = $1', [id])).rows[0].cost;
    equal(Number(await c(fill)), 273.75); equal(await c(voided), null); equal(Number(await c(typed)), 55);
    equal(await c(empty), null); equal(await c(known), null);
    equal(Number((await q("SELECT cost FROM order_items WHERE order_id = $1", [o])).rows[0].cost), 273.75);
    equal((await missingCostLines({ read: async () => tracker })).summary.lines, 0);   // idempotent
  } finally { db.done(); }
});

test('setShiftTimes: an explicit end date puts the end on a later day, and may restore a long recorded shift', async () => {
  const db = await withTestDb();
  try {
    const sh = await import('../lib/shifts.js');
    await sh.ensureShiftSchema();
    const u = (await db.client.query(`INSERT INTO users (email, name, password_hash, is_driver) VALUES ('d@x.ca','Kowsi','x',true) RETURNING id`)).rows[0];
    await db.client.query(`INSERT INTO driver_shifts (user_id, driving, started_at, ended_at) VALUES ($1,false,'2026-09-18 05:29-04','2026-09-18 20:00-04')`, [u.id]);
    const id = (await db.client.query('SELECT id FROM driver_shifts')).rows[0].id;
    const without = await sh.setShiftTimes(id, { endTime: '12:03' }, 'o');            // old behaviour: same day
    equal(new Date(without.endedAt).toISOString().slice(0, 10), '2026-09-18');
    const restored = await sh.setShiftTimes(id, { endTime: '12:03', endDate: '2026-09-19' }, 'o');
    equal(Math.round((new Date(restored.endedAt) - new Date(restored.startedAt)) / 3600000), 31);   // 30.6h, not refused
  } finally { db.done(); }
});

test('costFromRow: Total Cost (product + parts + labour) wins; falls back to Cost of Product when the formula is empty', async () => {
  const { costFromRow } = await import('../lib/tracker-cost.js');
  equal(costFromRow({ cost: '$139.50', partsCost: '$80', totalCost: '$344.50' }), 344.5);
  equal(costFromRow({ cost: '$139.50', totalCost: '' }), 139.5);       // API-appended row, formula not filled yet
  equal(costFromRow({ cost: '', totalCost: '' }), null);               // nothing stated: unknown, not zero
  equal(costFromRow({ cost: '$50', totalCost: '0' }), 0);              // a stated zero is a real zero
});

suite('daily P&L: one rule for profit, and typing in a missing cost');

test('day sales: unknown-cost units and service lines are shown apart, profit matches the daily P&L rule', async () => {
  const db = await withTestDb();
  try {
    const q = (s, p) => db.client.query(s, p);
    const today = (await q(`SELECT (now() AT TIME ZONE 'America/Toronto')::date::text AS d`)).rows[0].d;
    const inv = async (num, sub) => (await q(`INSERT INTO invoices (number,email,status,subtotal,total) VALUES ($1,'a@b.ca','paid',$2,$2) RETURNING id`, [num, sub])).rows[0].id;
    const add = (id, d, sku, amt, kind, cost) => q(`INSERT INTO invoice_items (invoice_id,description,sku,amount,kind,cost) VALUES ($1,$2,$3,$4,$5,$6)`, [id, d, sku, amt, kind, cost]);
    const a = await inv('INV-A', 1769.91);                          // two costed units + a delivery line, like INV-1304
    await add(a, 'Washer', 'S1', 900, 'unit', 600); await add(a, 'Dryer', 'S2', 840, 'unit', 850); await add(a, 'Delivery', null, 29.91, 'service', null);
    const b = await inv('INV-B', 575.22);                           // a unit nobody has a cost for
    await add(b, 'Fridge', 'S3', 575.22, 'unit', null);
    const { daySales } = await import('../lib/day-sales.js');
    const r = await daySales(today);
    equal(r.created.sales, 2345.13);
    equal(r.created.cost, 1450);
    equal(r.created.unknownSales, 575.22);
    equal(r.created.serviceSales, 29.91);
    equal(r.created.profit, 290);                                    // (900+840) - 1450; NOT counting the service or the unknown unit
  } finally { db.done(); }
});

test('typing a missing cost fills a blank line and its order line once, never overwrites, refuses nonsense', async () => {
  const db = await withTestDb();
  try {
    const q = (s, p) => db.client.query(s, p);
    const ca = await import('../lib/cost-audit.js');
    const o = (await q(`INSERT INTO orders (order_number,email,status,subtotal,total) VALUES ('BB-9','a@b.ca','confirmed',500,500) RETURNING id`)).rows[0].id;
    await q(`INSERT INTO order_items (order_id,sku,title,price,kind) VALUES ($1,'S9','Fridge',500,'unit')`, [o]);
    const i = (await q(`INSERT INTO invoices (number,email,status,subtotal,total,order_id) VALUES ('INV-9','a@b.ca','paid',500,500,$1) RETURNING id`, [o])).rows[0].id;
    const line = (await q(`INSERT INTO invoice_items (invoice_id,description,sku,amount,kind) VALUES ($1,'Fridge','S9',500,'unit') RETURNING id`, [i])).rows[0].id;
    const listed = await ca.needsPersonLines({ read: async () => new Map() });
    equal(listed.lines.length, 1);
    const withTracker = await ca.needsPersonLines({ read: async () => new Map([['S9', 200]]) });
    equal(withTracker.lines.length, 0);                              // the tracker can fill it: not offered here
    let m = ''; try { await ca.setLineCostByHand({ lineId: line, cost: '' }); } catch (e) { m = e.message; }
    assert(/number/i.test(m), m);
    const r = await ca.setLineCostByHand({ lineId: line, cost: '248.75' });
    equal(r.cost, 248.75); equal(r.orderLines, 1);
    equal(Number((await q('SELECT cost FROM invoice_items WHERE id=$1', [line])).rows[0].cost), 248.75);
    equal(Number((await q('SELECT cost FROM order_items WHERE order_id=$1', [o])).rows[0].cost), 248.75);
    m = ''; try { await ca.setLineCostByHand({ lineId: line, cost: '1' }); } catch (e) { m = e.message; }
    assert(/already has a cost/i.test(m), m);                        // never overwrites
  } finally { db.done(); }
});

suite('a unit is sold from the first payment');

async function partPaidSetup(db) {
  const q = (s, p) => db.client.query(s, p);
  const inv = await import('../lib/invoices.js');
  await inv.ensureInvoiceSchema?.();
  await q(`INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ('U1','LG','M1','Fridge',600,300,true)`);
  const o = (await q(`INSERT INTO orders (order_number,email,status,subtotal,total) VALUES ('BB-77','a@b.ca','pending_payment',600,600) RETURNING id`)).rows[0].id;
  const i = (await q(`INSERT INTO invoices (number,email,status,subtotal,total,order_id) VALUES ('INV-77','a@b.ca','open',600,600,$1) RETURNING id`, [o])).rows[0].id;
  await q(`INSERT INTO invoice_items (invoice_id,description,sku,amount,kind) VALUES ($1,'Fridge','U1',600,'unit')`, [i]);
  return { q, inv, o, i };
}
const prod = async (q) => (await q(`SELECT active, sold_at, sold_price FROM products WHERE sku='U1'`)).rows[0];

test('a deposit sells the unit and takes it off the website; the balance does not undo or re-date that', async () => {
  const db = await withTestDb();
  try {
    const { q, inv, i } = await partPaidSetup(db);
    assert((await prod(q)).active === true, 'starts on the website');
    await inv.recordInvoicePayment(i, { amount: 200, method: 'cash' });
    let p = await prod(q);
    assert(p.active === false && p.sold_at, `deposit should mark it sold: ${JSON.stringify(p)}`);
    const firstSoldAt = new Date(p.sold_at).getTime();
    await inv.recordInvoicePayment(i, { amount: 400, method: 'cash' });          // the balance
    p = await prod(q);
    assert(p.active === false, 'still sold after the final payment');
    equal(new Date(p.sold_at).getTime(), firstSoldAt);                            // first sale date stays
  } finally { db.done(); }
});

test('removing the only deposit puts the unit back on HOLD, not back on sale', async () => {
  const db = await withTestDb();
  try {
    const { q, inv, i, o } = await partPaidSetup(db);
    await inv.recordInvoicePayment(i, { amount: 200, method: 'cash' });
    const pay = (await q('SELECT id FROM invoice_payments WHERE invoice_id=$1', [i])).rows[0].id;
    await inv.voidInvoicePayment(i, pay);
    const p = await prod(q);
    assert(p.active === true && !p.sold_at, `unsold again: ${JSON.stringify(p)}`);
    const held = await q(`SELECT 1 FROM reservations WHERE order_id=$1 AND sku='U1'`, [o]);
    assert(held.rows.length === 1, 'and held for the customer who is still buying');
  } finally { db.done(); }
});

test('removing ONE of two deposits leaves it sold; the nightly pass sells units on older deposits', async () => {
  const db = await withTestDb();
  try {
    const { q, inv, i } = await partPaidSetup(db);
    await inv.recordInvoicePayment(i, { amount: 100, method: 'cash' });
    await inv.recordInvoicePayment(i, { amount: 100, method: 'cash' });
    const first = (await q('SELECT id FROM invoice_payments WHERE invoice_id=$1 ORDER BY id', [i])).rows[0].id;
    await inv.voidInvoicePayment(i, first);
    assert((await prod(q)).active === false, 'still money in: still sold');
    // an invoice that took its deposit BEFORE this rule: the unit is still active
    await q(`UPDATE products SET active=true, sold_at=null WHERE sku='U1'`);
    const r = await inv.sellPartlyPaidUnits();
    equal(r.invoices, 1);
    assert((await prod(q)).active === false, 'the sweep sold it');
  } finally { db.done(); }
});
