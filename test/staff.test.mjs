// lib/staff.js + lib/auth.js — who can reach the back office.
//
// THE PROPERTY THAT MATTERS MOST: the environment lists still work, on their
// own, synchronously, with no database at all. They are what guarantees the
// owner can get in when something has gone wrong with the grants table —
// including to fix the grants table. Everything here is ADDITIVE.
//
// The second property: these checks stayed SYNCHRONOUS. `isAdmin` has 101 call
// sites and an unawaited async version would return a Promise, which is truthy,
// so one missed `await` anywhere would be a silent authorisation bypass.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { isAdmin, isSales, isStaff } from '../lib/auth.js';
import { grantedRoles, hasGrantedRole, refreshStaff, ROLES, STAFF_TTL_MS } from '../lib/staff.js';

const ENV = ['ADMIN_EMAILS', 'SALES_EMAILS', 'POSTGRES_URL'];
function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    return fn();
  } finally {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const who = (email) => ({ email, userId: 1 });

suite('staff roles — the environment lists still stand alone');

test('ADMIN_EMAILS works with no database whatsoever', () => {
  // The floor. If this ever needs Postgres, the owner can be locked out of the
  // screen they would use to fix Postgres.
  withEnv({ ADMIN_EMAILS: 'owner@rssolutions.ca' }, () => {
    assert(isAdmin(who('owner@rssolutions.ca')));
    assert(isSales(who('owner@rssolutions.ca')), 'an admin is implicitly sales');
    assert(isStaff(who('owner@rssolutions.ca')));
    assert(!isAdmin(who('nobody@example.com')));
  });
});

test('it is case-insensitive and ignores spacing, as it always was', () => {
  withEnv({ ADMIN_EMAILS: ' Owner@RSSolutions.ca , other@x.ca ' }, () => {
    assert(isAdmin(who('owner@rssolutions.ca')));
    assert(isAdmin(who('OTHER@X.CA')));
  });
});

test('SALES_EMAILS grants sales and NOT admin', () => {
  withEnv({ ADMIN_EMAILS: 'owner@x.ca', SALES_EMAILS: 'rep@x.ca' }, () => {
    assert(isSales(who('rep@x.ca')));
    assert(isStaff(who('rep@x.ca')));
    assert(!isAdmin(who('rep@x.ca')), 'a rep must never be admin by accident');
  });
});

test('no session, no access', () => {
  withEnv({ ADMIN_EMAILS: 'owner@x.ca' }, () => {
    for (const s of [null, undefined, {}, { email: '' }, { email: null }]) {
      assert(!isAdmin(s) && !isSales(s) && !isStaff(s), `granted access to ${JSON.stringify(s)}`);
    }
  });
});

test('the checks are SYNCHRONOUS — they return a boolean, never a Promise', () => {
  // The whole reason lib/staff carries a cache. A Promise is truthy, so an
  // async isAdmin with one missed `await` grants everybody admin, silently.
  withEnv({ ADMIN_EMAILS: 'owner@x.ca' }, () => {
    for (const fn of [isAdmin, isSales, isStaff]) {
      const r = fn(who('owner@x.ca'));
      equal(typeof r, 'boolean', `${fn.name} must return a boolean`);
      assert(!(r instanceof Promise), `${fn.name} must not be a Promise`);
    }
  });
});

suite('staff roles — grants from the table');

// PGlite through the same adapter the other DB tests use.
function adapt(db) {
  return {
    query: async (sql, params) => {
      if (params && params.length) return db.query(sql, params);
      const res = await db.exec(sql);
      return Array.isArray(res) ? (res[res.length - 1] || { rows: [] }) : res;
    }
  };
}

test('the migration creates the table with the rules it needs', async () => {
  const { migrate } = await import('../lib/migrate.js');
  const client = adapt(new PGlite());
  const res = await migrate({ client });
  assert(res.ok, `migrations failed: ${res.error}`);
  assert(res.applied.some((a) => a.id === '0002_staff_access'), 'the staff migration ran');

  // One LIVE grant per person per role, but history is kept — so the
  // uniqueness has to be partial or re-granting somebody would collide.
  await client.query(`INSERT INTO staff_access (email, role) VALUES ('a@b.ca','sales')`, []);
  await client.query(`UPDATE staff_access SET revoked_at = now() WHERE email = 'a@b.ca'`, []);
  await client.query(`INSERT INTO staff_access (email, role) VALUES ('a@b.ca','sales')`, []);
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM staff_access WHERE email='a@b.ca'`, []);
  equal(rows[0].n, 2, 'the revoked row is kept alongside the new grant');

  let dup = null;
  try { await client.query(`INSERT INTO staff_access (email, role) VALUES ('a@b.ca','sales')`, []); }
  catch (e) { dup = e; }
  assert(dup, 'a second LIVE grant for the same person and role must be refused');

  let badRole = null;
  try { await client.query(`INSERT INTO staff_access (email, role) VALUES ('c@d.ca','owner')`, []); }
  catch (e) { badRole = e; }
  assert(badRole, 'an unknown role must be refused by the CHECK constraint');
});

test('only the two roles exist', () => {
  equal(ROLES, ['admin', 'sales'], 'adding a role is a decision, not a diff');
});

suite('staff roles — the cache');

test('with no database the cache is empty and nothing is granted', async () => {
  await withEnv({}, async () => {
    await refreshStaff({ force: true });
    equal([...grantedRoles('anyone@x.ca')], [], 'no database means no table grants');
    assert(!hasGrantedRole('anyone@x.ca', 'admin'));
    // And the environment list still answers, which is the point.
    assert(!isAdmin(who('anyone@x.ca')));
  });
});

test('an unknown email has no roles, and a blank one does not throw', () => {
  equal([...grantedRoles('')], []);
  equal([...grantedRoles(null)], []);
  equal([...grantedRoles(undefined)], []);
  equal([...grantedRoles('  ')], []);
});

test('the staleness window is short enough that a revocation lands quickly', () => {
  // The documented cost of keeping these checks synchronous: a revoked grant
  // survives on OTHER instances for up to this long. Thirty seconds is not the
  // threat this feature addresses — the threat is somebody who left in March
  // still having admin in June because nobody wanted to redeploy.
  assert(STAFF_TTL_MS <= 60_000, `TTL is ${STAFF_TTL_MS}ms — too long for an access control`);
  assert(STAFF_TTL_MS >= 5_000, `TTL is ${STAFF_TTL_MS}ms — that would hammer the database`);
});

test('grantedRoles never throws, whatever the cache is', () => {
  // It is called from inside isAdmin, on every request. It is not allowed to be
  // the thing that takes the admin pages down.
  for (const v of ['a@b.ca', 'A@B.CA', '  spaced@x.ca  ', 123, {}, []]) {
    let threw = null;
    try { grantedRoles(v); } catch (e) { threw = e; }
    assert(!threw, `threw on ${JSON.stringify(v)}: ${threw && threw.message}`);
  }
});
