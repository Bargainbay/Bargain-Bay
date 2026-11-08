// The Sales Hub's role: a business-development rep is NOT a plain sales associate.
//
// What must hold: a rep (and an admin) may be shown unit cost; a plain sales
// associate, a customer and a signed-out visitor may not. A rep is "sales" for the
// shared selling pages but never admin. These stay synchronous, like every check.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { isAdmin, isSales, isStaff, isSalesRep, canSeeCost } from '../lib/auth.js';
import { hubViewer } from '../lib/sales-access.js';
import { grantRole, revokeRole, hasGrantedRole, ROLES } from '../lib/staff.js';

const ENV = ['ADMIN_EMAILS', 'SALES_EMAILS', 'SALES_REP_EMAILS', 'POSTGRES_URL'];
function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV) delete process.env[k];
    Object.assign(process.env, vars);
    return fn();
  } finally {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const who = (email) => ({ email, userId: 1, name: 'X' });

suite('Sales Hub role — who is a rep, and who may see cost');

test('sales_rep is a known role', () => assert(ROLES.includes('sales_rep')));

test('a rep from SALES_REP_EMAILS: sales yes, admin no, cost yes', () => {
  withEnv({ ADMIN_EMAILS: 'owner@x.ca', SALES_REP_EMAILS: 'john@x.ca' }, () => {
    const s = who('john@x.ca');
    assert(isSalesRep(s)); assert(isSales(s)); assert(isStaff(s));
    assert(!isAdmin(s), 'a rep is never an admin');
    assert(canSeeCost(s));
  });
});

test('a plain sales associate stays cost-blind and has no Hub', () => {
  withEnv({ SALES_EMAILS: 'sam@x.ca' }, () => {
    const s = who('sam@x.ca');
    assert(isSales(s)); assert(!isSalesRep(s)); assert(!canSeeCost(s));
    equal(hubViewer(s), null);
  });
});

test('an admin sees cost and gets the Hub as admin', () => {
  withEnv({ ADMIN_EMAILS: 'owner@x.ca' }, () => {
    const v = hubViewer(who('owner@x.ca'));
    assert(v.admin); assert(v.canSeeCost);
  });
});

test('customers and signed-out visitors get nothing', () => {
  withEnv({ ADMIN_EMAILS: 'owner@x.ca', SALES_REP_EMAILS: 'john@x.ca' }, () => {
    assert(!canSeeCost(who('buyer@x.ca'))); equal(hubViewer(who('buyer@x.ca')), null);
    assert(!canSeeCost(null)); equal(hubViewer(null), null);
    assert(!isSalesRep({}));
  });
});

test('the checks stay synchronous (a Promise would be truthy)', () => {
  withEnv({}, () => { equal(isSalesRep(who('a@b.ca')), false); equal(canSeeCost(who('a@b.ca')), false); });
});

test('the database accepts a sales_rep grant (migration 0053) and revoking keeps the row', async () => {
  const { done } = await withTestDb();
  try {
    const g = await grantRole({ email: 'John@X.ca', role: 'sales_rep', by: 'owner@x.ca' });
    assert(g.created);
    assert(hasGrantedRole('john@x.ca', 'sales_rep'));
    withEnv({ POSTGRES_URL: 'x' }, () => assert(isSalesRep(who('john@x.ca')), 'a table grant makes a rep'));
    await revokeRole({ email: 'john@x.ca', role: 'sales_rep', by: 'owner@x.ca' });
    assert(!hasGrantedRole('john@x.ca', 'sales_rep'));
    // and the older roles still work after the constraint was rebuilt
    assert((await grantRole({ email: 'a@x.ca', role: 'admin', by: 'o' })).created);
    assert((await grantRole({ email: 'b@x.ca', role: 'sales', by: 'o' })).created);
  } finally { await done(); }
});
