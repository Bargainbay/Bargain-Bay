// lib/members.js listMembers — the reseller list carries what each member has bought.
import { suite, test, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { listMembers, requestMembership, setMembership } from '../lib/members.js';

suite('reseller list');

test('an application shows as pending, approval moves it, and orders are counted without cancelled ones', async () => {
  const { client: db, done } = await withTestDb();
  try {
    const u = await db.query(`INSERT INTO users (email, name, password_hash) VALUES ('a@shop.ca','Ana','x') RETURNING id`);
    const id = u.rows[0].id;
    await requestMembership(id, 'Ana Appliances', 'resell', {});
    let list = await listMembers();
    equal(list.length, 1);
    equal(list[0].member_status, 'pending');
    equal(list[0].orders, 0);

    await setMembership(id, 'approve');
    await db.query(`INSERT INTO orders (user_id, email, status, subtotal) VALUES ($1,'a@shop.ca','delivered',1000), ($1,'a@shop.ca','confirmed',500), ($1,'a@shop.ca','cancelled',9999)`, [id]);
    list = await listMembers();
    equal(list[0].member_status, 'approved');
    equal(list[0].orders, 2);
    equal(list[0].spent, 1500);
  } finally { done(); }
});

test('the nav badge count is only the applications still waiting', async () => {
  const { client: db, done } = await withTestDb();
  try {
    const { pendingMemberCount } = await import('../lib/members.js');
    equal(await pendingMemberCount(), 0);
    const a = (await db.query(`INSERT INTO users (email, name, password_hash) VALUES ('p1@x.ca','P1','x') RETURNING id`)).rows[0].id;
    const b = (await db.query(`INSERT INTO users (email, name, password_hash) VALUES ('p2@x.ca','P2','x') RETURNING id`)).rows[0].id;
    await requestMembership(a, 'One', '', {});
    await requestMembership(b, 'Two', '', {});
    equal(await pendingMemberCount(), 2);
    await setMembership(a, 'approve');
    equal(await pendingMemberCount(), 1);
  } finally { done(); }
});

test('an account that never applied can be listed and made a reseller by an admin, once', async () => {
  const { client: db, done } = await withTestDb();
  try {
    const { listUnappliedAccounts, addAsReseller } = await import('../lib/members.js');
    const a = (await db.query(`INSERT INTO users (email, name, password_hash) VALUES ('tonic@x.ca','Tonic','x') RETURNING id`)).rows[0].id;
    const d = (await db.query(`INSERT INTO users (email, name, password_hash, is_driver) VALUES ('driver-4165550000@drivers.bargainbay.ca','Dee','x', true) RETURNING id`)).rows[0].id;
    let list = await listUnappliedAccounts();
    equal(list.map((x) => x.email), ['tonic@x.ca'], 'drivers are not offered');
    equal((await listUnappliedAccounts({ q: 'TONIC' })).length, 1);
    equal((await listUnappliedAccounts({ q: 'nobody' })).length, 0);

    let threw = '';
    try { await addAsReseller(a, '  ', {}); } catch (e) { threw = e.message; }
    equal(threw, 'Business name is required.');
    equal(await addAsReseller(d, 'Driver Co', {}), null, 'a driver cannot be made a reseller');

    const u = await addAsReseller(a, 'Tonic Appliances', { by: 'boss@x.ca' });
    equal(u.business_name, 'Tonic Appliances');
    const row = (await db.query(`SELECT role, member_status, member_note FROM users WHERE id = $1`, [a])).rows[0];
    equal(row.role, 'member'); equal(row.member_status, 'approved');
    equal(row.member_note, 'Added by boss@x.ca (no application)');
    equal((await listUnappliedAccounts()).length, 0, 'no longer offered');
    equal(await addAsReseller(a, 'Again', {}), null, 'and not added twice');
  } finally { done(); }
});
