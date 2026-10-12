// A rep asking an admin to approve a below-floor sale (lib/invoice-approvals.js).
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { recordConsignmentUnit } from '../lib/consignment.js';
import { requestApproval, listApprovals, approveRequest, rejectRequest, withdrawRequest, pendingApprovalCount } from '../lib/invoice-approvals.js';

const rep = { email: 'Rep@x.test', name: 'Roushi' };
const admin = { email: 'owner@x.test', name: 'Owner' };

// Abi's dishwasher: we owe $500, so the floor is $600 before tax.
const body = (amount = 486.73) => ({
  name: 'Ann', email: 'ann@x.test', addHst: true, taxInclusive: true, belowFloorOk: true,
  items: [{ description: 'LG dishwasher', sku: 'VD-1', amount, kind: 'unit' }], leadSource: 'repeat'
});

async function setup() {
  const t = await withTestDb();
  await recordConsignmentUnit({ sku: 'VD-1', vendor: 'Abi', cost: 500 });
  return t;
}

suite('invoice approval requests');

test('a below-floor sale files a request; belowFloorOk from the client is not kept', async () => {
  const { done } = await setup();
  try {
    const r = await requestApproval(rep, body());
    assert(r.id && !r.existing);
    const [row] = await listApprovals(admin, { admin: true });
    equal(row.status, 'pending'); equal(row.requestedBy, 'rep@x.test');
    assert(!('belowFloorOk' in row.payload), 'the approval IS the override');
    assert(/can.t go out under/.test(row.reason));
  } finally { done(); }
});

test('filing the same sale twice is one request', async () => {
  const { done } = await setup();
  try {
    const a = await requestApproval(rep, body());
    const b = await requestApproval(rep, body());
    equal(b.id, a.id); assert(b.existing);
    equal(await pendingApprovalCount(), 1);
  } finally { done(); }
});

test('a sale that is NOT under the floor needs no approval', async () => {
  const { done } = await setup();
  try {
    let err; try { await requestApproval(rep, body(900)); } catch (e) { err = e; }
    equal(err?.code, 'NOT_BELOW_FLOOR');
  } finally { done(); }
});

test('a rep sees only their own requests, and not the vendor cost', async () => {
  const { done } = await setup();
  try {
    await requestApproval(rep, body());
    const other = await listApprovals({ email: 'other@x.test' }, { admin: false });
    equal(other.length, 0);
    const mine = await listApprovals(rep, { admin: false });
    equal(mine.length, 1);
    assert(!/\$500/.test(mine[0].reason) && mine[0].payload === undefined, 'cost stays with the admin');
  } finally { done(); }
});

test('approving raises the invoice AS THE REP, once', async () => {
  const { done } = await setup();
  try {
    const { id } = await requestApproval(rep, body());
    let seen;
    const raise = async (args) => { seen = args; return { id: 7, number: 'INV-1007', total: 550 }; };
    const r = await approveRequest(id, admin, { raise });
    equal(r.invoice.number, 'INV-1007');
    equal(seen.createdBy.email, 'rep@x.test'); equal(seen.leadSource, 'repeat'); equal(seen.taxInclusive, true);
    let again; try { await approveRequest(id, admin, { raise }); } catch (e) { again = e; }
    assert(again, 'a second approval must not raise a second invoice');
    const [row] = await listApprovals(admin, { admin: true });
    equal(row.status, 'approved'); equal(row.invoiceNumber, 'INV-1007'); equal(row.decidedName, 'Owner');
  } finally { done(); }
});

test('an invoice that fails to raise puts the request back', async () => {
  const { done } = await setup();
  try {
    const { id } = await requestApproval(rep, body());
    let err; try { await approveRequest(id, admin, { raise: async () => { throw new Error('unit already sold'); } }); } catch (e) { err = e; }
    assert(/already sold/.test(err.message));
    equal(await pendingApprovalCount(), 1);
  } finally { done(); }
});

test('reject and withdraw close it; only the asker can withdraw', async () => {
  const { done } = await setup();
  try {
    const a = await requestApproval(rep, body());
    let err; try { await withdrawRequest(a.id, { email: 'other@x.test' }); } catch (e) { err = e; }
    assert(err);
    await rejectRequest(a.id, admin, { note: 'too thin' });
    equal(await pendingApprovalCount(), 0);
    const b = await requestApproval(rep, body(500));
    await withdrawRequest(b.id, rep);
    equal(await pendingApprovalCount(), 0);
  } finally { done(); }
});
