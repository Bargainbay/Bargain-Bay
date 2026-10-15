import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { mapDeposit, rankCandidates, looksLikeEtransfer, recordDeposit, depositQueue, confirmDeposit, ignoreDeposit } from '../lib/deposit-match.js';

suite('incoming e-transfers (pure)');

test('only settled e-transfer credits are kept; Plaid reports money in as negative', () => {
  const t = { transaction_id: 'a1', amount: -1129, date: '2026-10-20', name: 'INTERAC E-TRANSFER FROM JANE SMITH', pending: false };
  const d = mapDeposit(t);
  equal(d.amountCents, 112900); equal(d.extId, 'plaid:a1'); assert(/JANE/.test(d.sender), 'sender');
  equal(mapDeposit({ ...t, amount: 1129 }), null);              // money out
  equal(mapDeposit({ ...t, pending: true }), null);
  equal(mapDeposit({ ...t, name: 'PAYROLL DEPOSIT ACME' }), null);
  assert(looksLikeEtransfer({ name: 'e-transfer received' }), 'spelling');
});

const dep = (o = {}) => ({ amountCents: 112900, sender: 'INTERAC E-TRANSFER FROM JANE SMITH', memo: '', receivedOn: '2026-10-20', ...o });
const cand = (o = {}) => ({ kind: 'order', id: 1, ref: 'BB-1042', name: 'Jane Smith', owingCents: 112900, createdAt: '2026-10-19T15:00:00Z', ...o });

test('exact amount plus the name is "sure"; the amount alone is not', () => {
  const r = rankCandidates(dep(), [cand()]);
  equal(r[0].confidence, 'sure');
  const lone = rankCandidates(dep({ sender: 'INTERAC E-TRANSFER FROM SOMEONE' }), [cand()]);
  assert(lone[0].confidence !== 'sure', 'a matching amount alone proves nothing');
});

test('two people who owe the same amount are never "sure" by amount; the order number in the memo settles it', () => {
  const two = rankCandidates(dep({ sender: 'E-TRANSFER FROM A PERSON' }), [cand({ id: 1 }), cand({ id: 2, ref: 'BB-1043', name: 'Bob Jones' })]);
  assert(two.every((c) => c.confidence !== 'sure'), 'ambiguous');
  const named = rankCandidates(dep({ sender: 'E-TRANSFER FROM A PERSON', memo: 'bb-1043 fridge' }), [cand({ id: 1 }), cand({ id: 2, ref: 'BB-1043', name: 'Bob Jones' })]);
  equal(named[0].id, 2); equal(named[0].confidence, 'sure');
});

test('a deposit before the order existed, or far off in amount, is not offered', () => {
  equal(rankCandidates(dep({ amountCents: 5000, sender: 'X E-TRANSFER' }), [cand()]).length, 0);
});

suite('incoming e-transfers — against a real database');

async function order(total, name = 'Jane Smith', status = 'pending_payment') {
  const { rows } = await query(
    `INSERT INTO orders (email, name, delivery_method, status, payment_method, subtotal, hst, total) VALUES ('j@example.com',$1,'delivery',$2,'etransfer',0,0,$3) RETURNING id`, [name, status, total]);
  await query(`UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1`, [rows[0].id]);
  return rows[0].id;
}

test('a deposit is recorded once, suggested against the right order, and confirming marks the order paid exactly once', async () => {
  const { done } = await withTestDb();
  try {
    const id = await order(1129);
    const d = mapDeposit({ transaction_id: 'z9', amount: -1129, date: '2026-10-20', name: 'INTERAC E-TRANSFER FROM JANE SMITH' });
    assert(await recordDeposit(d), 'first insert'); assert(!(await recordDeposit(d)), 're-reading the same line is free');
    const q = await depositQueue();
    equal(q.length, 1); equal(q[0].suggestions[0].id, id); equal(q[0].suggestions[0].confidence, 'sure');
    const wrong = await order(500, 'Other Person');
    let err; try { await confirmDeposit(q[0].id, { kind: 'order', id: wrong, by: 'staff' }); } catch (e) { err = e; }
    assert(err && /but this deposit/.test(err.message), 'amount must agree');
    equal((await depositQueue()).length, 1);                                   // a refused match hands the deposit back
    const r = await confirmDeposit(q[0].id, { kind: 'order', id, by: 'staff@x' });
    equal(r.ref, `BB-${1000 + id}`);
    equal((await query('SELECT status FROM orders WHERE id = $1', [id])).rows[0].status, 'confirmed');
    let again; try { await confirmDeposit(q[0].id, { kind: 'order', id, by: 'staff' }); } catch (e) { again = e; }
    assert(again && /already been dealt/.test(again.message), 'no second confirmation');
    equal((await depositQueue()).length, 0); equal((await depositQueue({ status: 'matched' })).length, 1);
  } finally { done(); }
});

test('a deposit that is not an order payment can be set aside, once', async () => {
  const { done } = await withTestDb();
  try {
    await recordDeposit(mapDeposit({ transaction_id: 'q1', amount: -42, date: '2026-10-20', name: 'E-TRANSFER FROM OWNER' }));
    const [d] = await depositQueue();
    await ignoreDeposit(d.id, { by: 'staff', note: 'owner transfer' });
    let e; try { await ignoreDeposit(d.id, { by: 'staff' }); } catch (x) { e = x; }
    assert(e, 'second time refused'); equal((await depositQueue({ status: 'ignored' }))[0].note, 'owner transfer');
  } finally { done(); }
});
