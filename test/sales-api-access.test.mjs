// Every /api/sales/* route, called as somebody who must be turned away — and the one
// route that returns a COST is checked by role: admin and the business-development rep
// get it, a plain sales associate, a customer and a visitor do not.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { __useTestDatabase } from '../lib/db.js';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth.js';

process.env.ADMIN_EMAILS = 'boss@example.test';
process.env.SALES_EMAILS = 'sam@example.test';
process.env.SALES_REP_EMAILS = 'john@example.test';
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'access-test-secret';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'app', 'api', 'sales');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const asToken = (email, id) => createSessionToken({ id, email, name: email, token_version: 0 });
const REFUSED = (s) => s === 401 || s === 403 || (s >= 300 && s < 400);

function routeFiles(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (n === 'route.js') out.push(p);
  }
  return out.sort();
}
async function call(handler, method) {
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (method !== 'GET') init.body = '{}';
  try { return { status: (await handler(new NextRequest('http://localhost/api/sales/x', init)))?.status ?? 0 }; }
  catch (e) { return { threw: String(e?.message || e).slice(0, 120) }; }
}

__useTestDatabase(null);
const mods = [];
for (const f of routeFiles(root)) mods.push({ f, m: await import(pathToFileURL(f).href) });

suite('/api/sales — every handler refuses those who may not use it');

for (const who of [['nobody', null], ['a customer', 'buyer@example.test'], ['a plain sales associate', 'sam@example.test']]) {
  test(`every handler refuses ${who[0]}`, async () => {
    __setTestCookies(who[1] ? { [SESSION_COOKIE]: await asToken(who[1], 7) } : {});
    const bad = [];
    for (const { f, m } of mods) for (const method of METHODS) {
      if (typeof m[method] !== 'function') continue;
      const r = await call(m[method], method);
      if (r.threw || !REFUSED(r.status)) bad.push(`${f.split('/api/')[1]} ${method} -> ${r.threw || r.status}`);
    }
    equal(bad, [], bad.join('\n'));
  });
}

test('the harness really authenticates (a rep is let in somewhere)', async () => {
  __setTestCookies({ [SESSION_COOKIE]: await asToken('john@example.test', 8) });
  let let_in = 0;
  for (const { m } of mods) for (const method of METHODS) {
    if (typeof m[method] !== 'function') continue;
    const r = await call(m[method], method);
    if (!r.threw && !REFUSED(r.status)) let_in++;
  }
  assert(let_in > 0);
});

suite('/api/sales/profit — the one route that returns a cost');

test('admin and the rep are answered; sales, customer and visitor are refused', async () => {
  const { GET } = await import(pathToFileURL(join(root, 'profit', 'route.js')).href);
  const status = async (email, id) => {
    __setTestCookies(email ? { [SESSION_COOKIE]: await asToken(email, id) } : {});
    return (await GET(new NextRequest('http://localhost/api/sales/profit'))).status;
  };
  equal(await status('boss@example.test', 1), 200);
  equal(await status('john@example.test', 2), 200);
  equal(await status('sam@example.test', 3), 403);
  equal(await status('buyer@example.test', 4), 403);
  equal(await status(null), 403);
});
