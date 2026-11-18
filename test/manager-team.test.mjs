// The Manager team (2026-11-17): who may ring in, what each department may do, that
// anything to do with money waits for a yes on a LATER turn, that a refund / discount
// / void exists only on the owner's instruction, how an e-transfer is matched, and
// how the day is reported. lib/manager-policy.js is pure; the tool tests run the real
// lib/manager-call.js against a real Postgres (PGlite) with no phone involved.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import {
  callerFor, toolsFor, tierOf, isGated, isOwnerOnly, overApproval, OWNER_APPROVAL_OVER, TOOL_TIER, DEPTS,
  stalePricing, ageDays, matchPayment, sameName, dayReport, TRACKER_FREE_FIELDS
} from '../lib/manager-policy.js';
import { GM_ONLY } from '../lib/manager-policy.js';
import { TOOLS as MONEY_TOOLS, NEW_TOOL_NAMES } from '../lib/manager-tools.js';
import { runTool, startInboundCall, greeting } from '../lib/manager-call.js';
import { BUSINESS_CHECKS } from '../lib/manager-business.js';
import { reviewList } from '../lib/manager-payments.js';
import { EXPECTED } from '../lib/health.js';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

suite('manager team: who may ring in');
test('only the owner and Ravi are recognised, however the number is written', () => {
  equal(callerFor('+16476433035')?.name, 'Owner');
  equal(callerFor('(647) 643-3035')?.name, 'Owner');
  equal(callerFor('647-244-9765')?.name, 'Ravi');
  equal(callerFor('+1 647 244 9765')?.name, 'Ravi');
  equal(callerFor('+16475550123'), null);
  equal(callerFor(''), null); equal(callerFor(null), null); equal(callerFor('9765'), null);
});

suite('manager team: departments and tiers');
test('the General Manager has every tool; each department has a subset that includes end_call', () => {
  const all = [{ name: 'assign_stop' }, { name: 'set_list_price' }, { name: 'end_call' }];
  equal(toolsFor('gm', all).length, 3);
  equal(toolsFor('delivery', all).map((t) => t.name), ['assign_stop', 'end_call']);
  equal(toolsFor('sales', all).map((t) => t.name), ['set_list_price', 'end_call']);
  equal(toolsFor('nonsense', all).length, 3);   // an unknown department is the GM, never a silent blank
  for (const d of ['delivery', 'sales']) assert(DEPTS[d].tools.includes('end_call') && DEPTS[d].tools.includes('switch_department'));
});
test('refunds, discounts and voids are owner-only; prices, payments and tracker prices are gated; dispatch is free', () => {
  for (const n of ['refund_invoice', 'apply_discount', 'void_invoice']) { assert(isOwnerOnly(n) && isGated(n), n); }
  for (const n of ['set_list_price', 'set_reseller_price', 'back_to_tracker_price', 'set_stop_charge', 'set_stop_pay', 'mark_invoice_paid', 'record_payment', 'match_flagged_payment', 'edit_tracker_price_cell', 'set_tracker_status']) {
    assert(isGated(n) && !isOwnerOnly(n), n);
  }
  for (const n of ['assign_stop', 'set_stop_window', 'reorder_run', 'edit_tracker_cell', 'add_followup', 'find_invoice', 'stale_stock', 'scan_payments', 'plan_run', 'price_stop']) assert(!isGated(n), n);
  equal(tierOf('unheard_of'), 'act');
});
test('every tool the model is offered is listed in a department, and every tiered name is a real tool', () => {
  const names = new Set(MONEY_TOOLS.map((t) => t.name));
  const inSomeDept = new Set([...DEPTS.delivery.tools, ...DEPTS.sales.tools, ...GM_ONLY]);
  for (const n of names) assert(inSomeDept.has(n) || n === 'switch_department', `${n} is in no department, so only the GM could ever use it`);
  const legacy = ['set_photo_from_model', 'run_inventory_sync', 'close_stale_stops', 'run_backup_now', 'resolve_invoice'];
  for (const n of Object.keys(TOOL_TIER)) assert(names.has(n) || legacy.includes(n), `${n} has a tier but is not a tool`);
  equal(NEW_TOOL_NAMES.size, MONEY_TOOLS.length);
});
test('price cells are not editable through the free tracker tool', () => {
  for (const f of ['retail', 'condition', 'price', 'cost', 'partsCost', 'totalCost']) assert(!TRACKER_FREE_FIELDS.has(f), f);
});
test('over fifty dollars is over fifty, and fifty is not', () => {
  equal(OWNER_APPROVAL_OVER, 50); assert(!overApproval(50)); assert(overApproval(50.01)); assert(overApproval(-120)); assert(!overApproval(0));
});

suite('manager team: stock that is not moving');
test('a 95-day unit with a $450 margin at $800 gets a lower price suggested, never under cost + 10%', () => {
  const s = stalePricing({ price: 800, cost: 350, ageDays: 95 });
  assert(s && s.suggest < 800 && s.suggest >= 390, JSON.stringify(s));
  equal(s.margin, 450);
  equal(stalePricing({ price: 800, cost: 350, ageDays: 60 }), null);     // not old enough
  equal(stalePricing({ price: 300, cost: 250, ageDays: 120 }), null);    // thin margin: nowhere to go
  equal(stalePricing({ price: 800, cost: 0, ageDays: 120 }), null);      // no cost known: no suggestion
  const tight = stalePricing({ price: 600, cost: 400, ageDays: 100 });
  assert(!tight || tight.suggest >= 440, 'cost + 10% floor');
});
test('age is counted from the tracker date and is null when there is none', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  equal(ageDays('2026-08-13', now), 96); equal(ageDays('', now), null); equal(ageDays('nonsense', now), null);
});

suite('manager team: matching an e-transfer');
const inv = (number, cents, customer, createdAt = Date.parse('2026-11-10T15:00:00Z')) => ({ number, balanceCents: cents, customer, createdAt });
const pay = (cents, name, at = Date.parse('2026-11-12T15:00:00Z')) => ({ amountCents: cents, name, at });
test('exact amount + sane date + matching name is exact; the name tolerates order and case', () => {
  equal(matchPayment(pay(125000, 'SMITH JANE'), [inv('INV-1', 125000, 'Jane Smith')]).kind, 'exact');
  assert(sameName('JOAN GRANT', 'Joan  Grant-Lee')); assert(!sameName('ACME CORP', 'Jane Smith')); assert(!sameName('', 'x'));
});
test('a different name on a fitting amount is named, not accepted', () => {
  const m = matchPayment(pay(125000, 'Robert Brown'), [inv('INV-1', 125000, 'Jane Smith')]);
  equal(m.kind, 'name_mismatch'); equal(m.invoice.number, 'INV-1');
});
test('the same amount owed by two people is ambiguous unless the name picks one', () => {
  const pool = [inv('INV-1', 50000, 'Jane Smith'), inv('INV-2', 50000, 'Omar Khan')];
  equal(matchPayment(pay(50000, 'Somebody Else'), pool).kind, 'ambiguous');
  const m = matchPayment(pay(50000, 'Omar Khan'), pool);
  equal(m.kind, 'exact'); equal(m.invoice.number, 'INV-2');
});
test('money that arrived before the invoice existed is not matched, and a wrong amount matches nothing', () => {
  equal(matchPayment(pay(125000, 'Jane Smith', Date.parse('2026-11-01T15:00:00Z')), [inv('INV-1', 125000, 'Jane Smith')]).kind, 'date_mismatch');
  equal(matchPayment(pay(124999, 'Jane Smith'), [inv('INV-1', 125000, 'Jane Smith')]).kind, 'none');
  // an hour before the invoice is inside the grace (a customer pays while the invoice is being raised)
  equal(matchPayment(pay(125000, 'Jane Smith', Date.parse('2026-11-10T14:00:00Z')), [inv('INV-1', 125000, 'Jane Smith')]).kind, 'exact');
});

suite('manager team: the day report');
test('the report groups what was done by department and carries what needs the owner', () => {
  const r = dayReport({
    date: '2026-11-17', calls: 2, flagged: ['$300 e-transfer from X fits INV-9 but the name is different'],
    actions: [
      { summary: 'put Ravi on RS-1', detail: { dept: 'delivery' } },
      { summary: 'set the window on RS-2', detail: { dept: 'delivery' } },
      { summary: 'marked INV-3 paid', detail: { dept: 'sales' } },
      { summary: 'refreshed stock', detail: {} }
    ]
  });
  assert(/4 things done on 2026-11-17, 2 calls with you/.test(r.head), r.head);
  equal(r.sections.map((s) => s.dept), ['Delivery Manager', 'Sales Manager', 'General Manager']);
  equal(r.sections[0].items.length, 2); equal(r.needsYou.length, 1);
  assert(/Nothing was done/.test(dayReport({ date: 'today' }).head));
});
test('the new crons are expected by the health email, so a silent one is noticed', () => {
  assert(EXPECTED['manager-report'] > 0 && EXPECTED['manager-payments'] > 0);
});

async function withDb(fn) {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  try { await fn(client); } finally { __useTestDatabase(null); }
}
const call = (client, { caller = 'Owner', dept = 'gm', trigger = 'manual' } = {}) =>
  client.query(`INSERT INTO manager_calls (to_number, trigger, issues, caller, dept) VALUES ('+16476433035', $1, '{"list":[],"hidden":0}'::jsonb, $2, $3) RETURNING id`, [trigger, caller, dept]).then((r) => r.rows[0].id);

suite('manager team: money waits for a later yes');
test('a price change only PROPOSES on its first turn, and the model cannot confirm itself', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    const a = { sku: 'ZZ-1', price: 600 };
    const first = await runTool(id, 'set_list_price', a, { turn: 1 });
    assert(first.needs_confirmation && /600/.test(first.read_back) && /ZZ-1/.test(first.read_back), JSON.stringify(first));
    const again = await runTool(id, 'set_list_price', a, { turn: 1 });
    assert(again.needs_confirmation, 'same turn is still a proposal');
    const changed = await runTool(id, 'set_list_price', { ...a, price: 500 }, { turn: 2 });
    assert(changed.needs_confirmation, 'a different number is a new proposal, not a yes');
    // Identical, later turn: it runs — and here refuses honestly because the unit does not exist.
    const run = await runTool(id, 'set_list_price', { ...a, price: 500 }, { turn: 3 });
    assert(!run.needs_confirmation && /cannot find ZZ-1/.test(run.error), JSON.stringify(run));
  });
});
test('a refund over fifty dollars says so; one under does not; a stop charge is gated too', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    const big = await runTool(id, 'refund_invoice', { number: 'INV-1', amount: 60, reason: 'goodwill' }, { turn: 1 });
    assert(big.needs_confirmation && big.over_fifty === true && /fifty|50/.test(big.instruction), JSON.stringify(big));
    assert(/refund \$60 on INV-1/.test(big.read_back), big.read_back);
    const small = await runTool(id, 'apply_discount', { number: 'INV-1', amount: 20 }, { turn: 1 });
    assert(small.needs_confirmation && small.over_fifty === false);
    const charge = await runTool(id, 'set_stop_charge', { job_number: 'RS-1', amount: 140 }, { turn: 1 });
    assert(charge.needs_confirmation && /charge on RS-1 to \$140/.test(charge.read_back));
  });
});
test('a refund, discount or void is refused on a line with no recognised caller', async () => {
  await withDb(async (client) => {
    const id = await call(client, { caller: null });
    for (const [n, a] of [['void_invoice', { number: 'INV-1' }], ['refund_invoice', { number: 'INV-1', amount: 10 }], ['apply_discount', { number: 'INV-1', amount: 10 }]]) {
      const r = await runTool(id, n, a, { turn: 1 });
      assert(r.error && !r.needs_confirmation, `${n}: ${JSON.stringify(r)}`);
    }
  });
});
test('a tracker price cell goes through the free tool? No: it is refused there and gated on its own tool', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    const free = await runTool(id, 'edit_tracker_cell', { sku: 'A', field: 'retail', value: '900' }, { turn: 1 });
    assert(/price|cannot edit/.test(free.error || ''), JSON.stringify(free));
    const gated = await runTool(id, 'edit_tracker_price_cell', { sku: 'A', field: 'retail', value: '900' }, { turn: 1 });
    assert(gated.needs_confirmation);
  });
});
test('switching hats changes the call\'s department, and an unknown department is the GM', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    equal((await runTool(id, 'switch_department', { dept: 'delivery' }, { turn: 1 })).dept, 'delivery');
    equal((await client.query('SELECT dept FROM manager_calls WHERE id = $1', [id])).rows[0].dept, 'delivery');
    equal((await runTool(id, 'switch_department', { dept: 'bogus' }, { turn: 2 })).dept, 'gm');
  });
});
test('the window and charge tools validate before they touch a stop', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    assert(/cannot find a stop/.test((await runTool(id, 'set_stop_window', { job_number: 'RS-9999', start: '12:30', end: '16:30' }, { turn: 1 })).error));
    const board = await runTool(id, 'delivery_board', { date: '2026-11-17' }, { turn: 1 });
    equal(board.stops, []);
  });
});

suite('manager team: answering the phone');
test('an unknown number is refused with no row written; the owner is recognised and greeted by name and hat', async () => {
  await withDb(async (client) => {
    equal(await startInboundCall({ from: '+16475550123' }), null);
    equal((await client.query('SELECT count(*)::int AS n FROM manager_calls')).rows[0].n, 0);
    const c = await startInboundCall({ from: '(647) 244-9765', callSid: 'CA1', dept: 'delivery' });
    equal(c.caller, 'Ravi'); equal(c.dept, 'delivery');
    const g = await greeting(c.id);
    assert(/Hi Ravi/.test(g) && /Delivery Manager here/.test(g) && /What do you need\?/.test(g), g);
    equal((await startInboundCall({ from: '+16476433035', dept: 'bogus' })).dept, 'gm');
  });
});

suite('manager team: payments the Manager could not match');
test('a flagged e-transfer is listed for the owner and becomes an issue on the next call', async () => {
  await withDb(async (client) => {
    equal(await reviewList(), []);
    await client.query(
      `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status, invoice_number, note)
       VALUES ('m1','Robert Brown',125000,now(),'flag_name_mismatch','INV-1','$1,250 e-transfer from Robert Brown fits INV-1 exactly, but the name is different (customer: Jane Smith)')`);
    const list = await reviewList();
    equal(list.length, 1); equal(list[0].kind, 'name_mismatch'); equal(list[0].amount, 1250);
    const check = BUSINESS_CHECKS.find(([n]) => n === 'e-transfers to review');
    const issues = await check[1]();
    equal(issues.length, 1); assert(/could not match/.test(issues[0].title));
    await client.query(`UPDATE manager_payments SET resolved_at = now()`);
    equal((await check[1]()).length, 0);
  });
});

suite('manager team: it still cannot do the things it must never do');
test('no tool sends money out, changes access, deletes, or contacts a customer', () => {
  for (const t of MONEY_TOOLS) {
    assert(!/^(send_|email_customer|delete_|grant_|revoke_|transfer_|pay_out|payout)/.test(t.name), t.name);
  }
});

import { priceDelivery, zoneForKm, guessInstall } from '../lib/delivery-rates.js';
suite('manager team: the delivery rate sheet');
test('every delivery is white glove (the full zone rate) unless the stop says threshold', () => {
  equal(priceDelivery({ km: 20 }).total, 95);
  equal(priceDelivery({ km: 80 }).total, 140);
  equal(priceDelivery({ km: 120 }).total, 225);
  equal(priceDelivery({ km: 20, glove: 'threshold' }).total, 76);
  equal(zoneForKm(50.4).zone, 'A'); equal(zoneForKm(50.6).zone, 'B');
});
test('a CDA exchange is billed as two haul-aways, not 200%', () => {
  const p = priceDelivery({ km: 20, services: ['exchange'], exchangeBilling: 'haul_away' });
  equal(p.total, 135);
  equal(priceDelivery({ km: 80, services: ['exchange'], exchangeBilling: 'haul_away', haulAway: 2 }).total, 180);  // already counted: not charged twice
});
test('extras: pieces after two, door removals, haul-away; a stacking kit is not a piece', () => {
  equal(priceDelivery({ km: 80, pieces: 3, fridgeDoorRemoval: 1 }).total, 140 + 15 + 20);
  equal(priceDelivery({ km: 20, pieces: 2 }).total, 95);
});
test('an install that does not say what kind is not guessed: it is flagged to verify, then confirm', () => {
  const p = priceDelivery({ km: 80, services: ['install'] });
  equal(p.total, 140); assert(p.needsVerification && /VERIFY/.test(p.questions.join(' ')));
  equal(guessInstall('Fulgor Milano Washer'), null);
  equal(guessInstall('stacked washer and dryer'), 'stacked_laundry');
  equal(priceDelivery({ km: 80, services: ['install'], installs: [{ type: 'stacked_laundry' }] }).total, 215);
});

import { TOOLS_B, brief } from '../lib/manager-tools-b.js';
suite('manager team: batch two');
test('every batch-two tool is a real, described tool, and each sits in a department or is the General Manager\'s alone', () => {
  assert(TOOLS_B.length >= 40, `${TOOLS_B.length} tools`);
  const inDept = new Set([...DEPTS.delivery.tools, ...DEPTS.sales.tools, ...GM_ONLY]);
  for (const t of TOOLS_B) { assert(t.description && t.input_schema, t.name); assert(inDept.has(t.name), `${t.name} is in no department`); }
  equal(new Set(TOOLS_B.map((t) => t.name)).size, TOOLS_B.length);
});
test('reads are free; anything that reaches a customer, moves a sale or changes what the shop charges is gated; store credit is owner-only', () => {
  for (const n of ['find_customer', 'find_quote', 'sales_report', 'payables', 'late_stops', 'morning_brief', 'where_are_vans', 'add_customer_note', 'move_stop_day', 'post_team_message']) assert(!isGated(n), n);
  for (const n of ['resend_invoice', 'convert_quote', 'void_quote', 'set_coupon_active', 'decide_reseller', 'cancel_stop', 'confirm_door_money', 'reject_door_money', 'approve_fill_requests', 'mark_supplier_bill_paid', 'record_affiliate_payout']) assert(isGated(n) && !isOwnerOnly(n), n);
  for (const n of ['issue_store_credit', 'apply_store_credit']) assert(isOwnerOnly(n), n);
});
test('the General Manager alone holds the books and buying; the department managers do not', () => {
  for (const n of GM_ONLY) { assert(!DEPTS.delivery.tools.includes(n) && !DEPTS.sales.tools.includes(n), n); }
});
test('a phone answer is a few rows, not a table, and never carries a secret', () => {
  const out = brief({ rows: Array.from({ length: 30 }, (_, i) => ({ n: i })), password_hash: 'x', token: 'y', note: 'a'.repeat(400) });
  equal(out.rows.count, 30); equal(out.rows.first.length, 8);
  assert(!('password_hash' in out) && !('token' in out) && out.note.length < 170);
});
test('store credit and resending an invoice wait for a later yes, and store credit is refused on an unknown line', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    const sc = await runTool(id, 'issue_store_credit', { amount: 80, name: 'Pat' }, { turn: 1 });
    assert(sc.needs_confirmation && sc.over_fifty === true && /80/.test(sc.read_back), JSON.stringify(sc));
    const rs = await runTool(id, 'resend_invoice', { number: 'INV-9' }, { turn: 1 });
    assert(rs.needs_confirmation && /INV-9/.test(rs.read_back), JSON.stringify(rs));
    const stranger = await call(client, { caller: null });
    const r = await runTool(stranger, 'issue_store_credit', { amount: 10 }, { turn: 1 });
    assert(r.error && !r.needs_confirmation, JSON.stringify(r));
  });
});
test('the read tools run against a real database and say honestly when there is nothing', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    const late = await runTool(id, 'late_stops', {}, { turn: 1 });
    equal(late.count, 0);
    const brief1 = await runTool(id, 'morning_brief', {}, { turn: 1 });
    assert(brief1.date && 'stopsToday' in brief1, JSON.stringify(brief1));
    const h = await runTool(id, 'health_check', {}, { turn: 1 });
    assert('allClear' in h, JSON.stringify(h));
    const none = await runTool(id, 'store_credit_balance', { code: 'SC-NOPE-NOPE' }, { turn: 1 });
    assert(none.error, JSON.stringify(none));
    const noJob = await runTool(id, 'move_stop_day', { job_number: 'RS-9', date: '2026-12-01' }, { turn: 1 });
    assert(/cannot find/.test(noJob.error), JSON.stringify(noJob));
  });
});
test('a note on a customer and a Team board post are done at once and logged', async () => {
  await withDb(async (client) => {
    const id = await call(client);
    const { rows: [c] } = await client.query(`INSERT INTO customers (email, name) VALUES ('pat@example.com','Pat') RETURNING id`);
    const n = await runTool(id, 'add_customer_note', { customer_id: c.id, body: 'Wants the stove Thursday' }, { turn: 1 });
    assert(n.ok, JSON.stringify(n));
    const p = await runTool(id, 'post_team_message', { channel: 'general', body: 'Truck two is loaded.' }, { turn: 1 });
    assert(p.ok, JSON.stringify(p));
    const { rows } = await client.query(`SELECT body, author_name FROM team_messages`);
    equal(rows[0].author_name, 'Manager (AI)');
  });
});

suite('manager team: an e-transfer staff already entered is never entered twice');
test('INV-1410: $550, one $275 deposit entered by hand, a $275 e-transfer email -> flagged, not applied', () => {
  const at = Date.parse('2026-11-15T20:00:00Z');
  const inv = [{ number: 'INV-1410', customer: 'Joyce Zhu', balanceCents: 27500, createdAt: Date.parse('2026-11-15T19:25:00Z') }];
  const p = { amountCents: 27500, name: 'Joyce Zhu', at };
  equal(matchPayment(p, inv).kind, 'exact');   // with no record of the deposit it WOULD apply: this is the bug's shape
  const m = matchPayment(p, inv, { recorded: [{ number: 'INV-1410', amountCents: 27500, atMs: at }] });
  equal(m.kind, 'already_recorded');
});
test('a same-amount payment from months ago, or a different amount, does not block a genuine match', () => {
  const at = Date.parse('2026-11-15T20:00:00Z');
  const inv = [{ number: 'INV-9', customer: 'Pat Lee', balanceCents: 27500, createdAt: at - 3600_000 }];
  const p = { amountCents: 27500, name: 'Pat Lee', at };
  equal(matchPayment(p, inv, { recorded: [{ number: 'INV-1', amountCents: 27500, atMs: at - 40 * 86400_000 }] }).kind, 'exact');
  equal(matchPayment(p, inv, { recorded: [{ number: 'INV-1', amountCents: 10000, atMs: at }] }).kind, 'exact');
});

import { consumedByStaff } from '../lib/manager-payments.js';
import { voidInvoicePayment } from '../lib/invoices.js';
suite('manager team: a second payment needs a second e-transfer');
test('one bank email is used up by one hand-entered payment; a second identical email is a genuine second payment', () => {
  const t = Date.parse('2026-11-15T20:00:00Z');
  const em = (id, plus = 0) => ({ id, p: { amountCents: 27500, name: 'Joyce Zhu', at: new Date(t + plus).toISOString() } });
  const one = consumedByStaff([em('a')], new Set(), [{ number: 'INV-1410', amountCents: 27500, atMs: t }]);
  equal([...one], ['a']);                                  // INV-1410: one email, one entry -> nothing left to apply
  const two = consumedByStaff([em('a'), em('b', 3600_000)], new Set(), [{ number: 'INV-1410', amountCents: 27500, atMs: t }]);
  equal([...two], ['a']);                                  // two emails, one entry -> the second email is free to apply
  const none = consumedByStaff([em('a')], new Set(['a']), [{ number: 'INV-1410', amountCents: 27500, atMs: t }]);
  equal([...none], []);                                    // an email the Manager already applied is never also "staff's"
});
test('the Manager can undo ITS OWN payment on a paid invoice (back to part paid, order back to pending); staff money stays locked', async () => {
  await withDb(async (client) => {
    const { rows: [inv] } = await client.query(
      `INSERT INTO invoices (number, email, name, total, status, channel) VALUES ('INV-T1','j@example.com','Joyce Zhu',550,'paid','manual') RETURNING id`);
    const { rows: [o] } = await client.query(`INSERT INTO orders (order_number, status, total, email, name) VALUES ('BB-T1','confirmed',550,'j@example.com','Joyce Zhu') RETURNING id`).catch(() => ({ rows: [{}] }));
    if (o.id) await client.query('UPDATE invoices SET order_id = $2 WHERE id = $1', [inv.id, o.id]);
    const { rows: [staff] } = await client.query(`INSERT INTO invoice_payments (invoice_id, amount, method, note) VALUES ($1,275,'E-transfer','deposit') RETURNING id`, [inv.id]);
    const { rows: [mgr] } = await client.query(`INSERT INTO invoice_payments (invoice_id, amount, method, note) VALUES ($1,275,'E-transfer','e-Transfer from Joyce Zhu, verified by the Manager from the bank''s email') RETURNING id`, [inv.id]);
    let refused = '';
    try { await voidInvoicePayment(inv.id, staff.id); } catch (e) { refused = e.message; }
    assert(/locked/.test(refused), `a staff payment on a paid invoice stays locked: ${refused}`);
    const r = await voidInvoicePayment(inv.id, mgr.id);
    equal(r.status, 'partial'); equal(r.balance, 275); equal(r.amountPaid, 275);
    const { rows: [after] } = await client.query('SELECT status, paid_at FROM invoices WHERE id = $1', [inv.id]);
    equal(after.status, 'partial'); equal(after.paid_at, null);
    if (o.id) equal((await client.query('SELECT status FROM orders WHERE id = $1', [o.id])).rows[0].status, 'pending_payment');
  });
});

import { logAction } from '../lib/manager-actions.js';
test('INV-1410 as it really is: the closing payment has NO note, and is still recognised as the Manager\'s from its action log', async () => {
  await withDb(async (client) => {
    const { rows: [inv] } = await client.query(`INSERT INTO invoices (number, email, name, total, status, channel) VALUES ('INV-T2','j@example.com','Joyce Zhu',550,'paid','manual') RETURNING id`);
    const { rows: [staff] } = await client.query(`INSERT INTO invoice_payments (invoice_id, amount, method, note) VALUES ($1,275,'E-transfer','deposit') RETURNING id`, [inv.id]);
    const { rows: [closing] } = await client.query(`INSERT INTO invoice_payments (invoice_id, amount, method) VALUES ($1,275,'E-transfer') RETURNING id`, [inv.id]);
    let refused = '';
    try { await voidInvoicePayment(inv.id, closing.id); } catch (e) { refused = e.message; }
    assert(/locked/.test(refused), 'with no record of the Manager doing it, it is staff money and stays locked');
    await logAction({ kind: 'payment_marked', via: 'auto', summary: 'marked INV-T2 paid', detail: { number: 'INV-T2', amount: 275 } });
    let staffTry = '';
    try { await voidInvoicePayment(inv.id, staff.id); } catch (e) { staffTry = e.message; }
    assert(/locked/.test(staffTry), 'the staff deposit is never undone, even with the log entry');
    const r = await voidInvoicePayment(inv.id, closing.id);
    equal(r.status, 'partial'); equal(r.balance, 275);
  });
});
