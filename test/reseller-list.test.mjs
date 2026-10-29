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
