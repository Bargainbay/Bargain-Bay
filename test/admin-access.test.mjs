// Every /api/admin/* route, called as somebody who must be turned away.
//
// WHY THIS EXISTS. `isAdmin` has over a hundred call sites and the codebase is plain
// JavaScript: one route that forgets its check is an authorisation bypass that reads
// like working code, and nothing would say so. This calls every exported handler of
// every admin route as (1) nobody and (2) a signed-in customer who is on no staff
// list, and requires a refusal — 401, 403 or a redirect. A route that answers
// anything else, or throws before refusing, is reported by name.
//
// A third pass calls them as an admin and requires that NOT every route refuses:
// without it, a broken harness (a session that never authenticates) would make the
// whole suite pass for the wrong reason.
//
// No database is configured in tests, so a route that WAS unguarded would hit
// "no database" rather than anyone's data — but it is still a failure here.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { __useTestDatabase } from '../lib/db.js';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth.js';

process.env.ADMIN_EMAILS = 'boss@example.test';
process.env.SALES_EMAILS = 'rep@example.test';
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'access-test-secret';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'app', 'api', 'admin');
// The one deliberate exception. /api/admin/migrate lets the FIRST migration run
// unauthenticated on a database with no `users` table (nobody could be an admin yet),
// and answers 503 when there is no database at all, which is every test. It is admin
// only the moment `users` exists.
const OK_WITHOUT_REFUSAL = { 'admin/migrate/route.js': [503] };
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function routeFiles(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (n === 'route.js') out.push(p);
  }
  return out.sort();
}

const asToken = (email, id) => createSessionToken({ id, email, name: email, token_version: 0 });
const REFUSED = (s) => s === 401 || s === 403 || (s >= 300 && s < 400);

async function call(handler, method) {
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (method !== 'GET') init.body = '{}';
  const req = new NextRequest('http://localhost/api/admin/x?id=1', init);
  try {
    const res = await handler(req, { params: Promise.resolve({ id: '1', number: 'INV-1' }) });
    return { status: res?.status ?? 0 };
  } catch (e) {
    return { threw: String(e?.message || e).slice(0, 120) };
  }
}

// Whatever an earlier test file left installed, these run with NO database.
__useTestDatabase(null);
const files = routeFiles(root);
const mods = [];
for (const f of files) {
  try { mods.push({ f, m: await import(pathToFileURL(f).href) }); }
  catch (e) { mods.push({ f, error: String(e?.message || e).slice(0, 160) }); }
}

suite('admin routes — the right people only');

test('every admin route module loads under test', () => {
  const bad = mods.filter((x) => x.error);
  assert(!bad.length, `could not load: ${bad.map((b) => `${b.f.split('/app/api/')[1]} (${b.error})`).join('; ')}`);
});

for (const [who, email, id] of [['nobody', null, 0], ['a customer on no staff list', 'shopper@example.test', 7]]) {
  test(`${who} is refused by every handler of every admin route`, async () => {
    __useTestDatabase(null);
    __setTestCookies(email ? { [SESSION_COOKIE]: await asToken(email, id) } : {});
    const open = [];
    for (const x of mods.filter((m) => m.m)) {
      for (const method of METHODS) {
        if (typeof x.m[method] !== 'function') continue;
        const r = await call(x.m[method], method);
        if (r.threw || !(REFUSED(r.status) || (OK_WITHOUT_REFUSAL[x.f.split('/app/api/')[1]] || []).includes(r.status))) open.push(`${method} ${x.f.split('/app/api/')[1]} -> ${r.threw ? 'threw: ' + r.threw : r.status}`);
      }
    }
    __setTestCookies(null);
    assert(!open.length, `${open.length} handler(s) did not refuse:\n  ${open.join('\n  ')}`);
  });
}

test('the harness is real: an admin is NOT refused everywhere', async () => {
  __useTestDatabase(null);
  __setTestCookies({ [SESSION_COOKIE]: await asToken('boss@example.test', 1) });
  let through = 0, total = 0;
  for (const x of mods.filter((m) => m.m)) {
    for (const method of METHODS) {
      if (typeof x.m[method] !== 'function') continue;
      total++;
      const r = await call(x.m[method], method);
      if (!r.threw && !REFUSED(r.status)) through++;
    }
  }
  __setTestCookies(null);
  assert(through > total / 2, `only ${through} of ${total} handlers let an admin through: the test session is not authenticating`);
});
