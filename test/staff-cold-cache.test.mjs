// A rep granted in the TABLE must be recognised on the FIRST request an instance serves.
// The role checks are synchronous and read a per-instance cache, which is empty on a cold instance, so the
// first request used to refuse the rep ("Not authorized" / 404 / 403) and the next one worked.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { getSession, createSessionToken, SESSION_COOKIE, isSalesRep, isSales, isStaff } from '../lib/auth.js';
import { grantRole, __resetStaffCache, hasGrantedRole } from '../lib/staff.js';

suite('staff grants — cold instance');

test('a table-granted rep is recognised on the first request after a cold start', async () => {
  const { done } = await withTestDb();
  try {
    const saved = { A: process.env.ADMIN_EMAILS, S: process.env.SALES_EMAILS, R: process.env.SALES_REP_EMAILS };
    delete process.env.ADMIN_EMAILS; delete process.env.SALES_EMAILS; delete process.env.SALES_REP_EMAILS;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'cold-cache-test';
    await grantRole({ email: 'john@x.ca', role: 'sales_rep', by: 'test' });
    __resetStaffCache();                                   // a new instance: nothing loaded yet
    assert(!hasGrantedRole('john@x.ca', 'sales_rep'), 'the bare cache is empty (that was the bug)');
    __resetStaffCache();
    __setTestCookies({ [SESSION_COOKIE]: await createSessionToken({ id: 7, email: 'john@x.ca', name: 'John', token_version: 0 }) });
    const session = await getSession();                    // what every page and route does first
    equal(session.email, 'john@x.ca');
    assert(isSalesRep(session) && isSales(session) && isStaff(session), 'recognised without any second request');
    for (const [k, v] of [['ADMIN_EMAILS', saved.A], ['SALES_EMAILS', saved.S], ['SALES_REP_EMAILS', saved.R]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  } finally { done(); }
});

test('a person with no grant is still refused', async () => {
  const { done } = await withTestDb();
  try {
    __resetStaffCache();
    __setTestCookies({ [SESSION_COOKIE]: await createSessionToken({ id: 8, email: 'nobody@x.ca', name: 'N', token_version: 0 }) });
    const session = await getSession();
    assert(!isSalesRep(session) && !isSales(session));
  } finally { done(); }
});
