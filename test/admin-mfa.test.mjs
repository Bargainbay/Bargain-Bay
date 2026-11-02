// Administrator two-factor sign-in: which requests the proxy stops, and that a marker cannot be
// forged, borrowed from another user, or outlive the session it was made for.
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';

// Test files share one process and each sets AUTH_SECRET at import, so the last one loaded wins.
// This file therefore sets its environment when a test RUNS (on()) and puts the old one back (off()).
const ENV = {
  AUTH_SECRET: 'admin-mfa-test-secret',
  BANK_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  ADMIN_EMAILS: 'boss@example.test,ravi@example.test'
};
const saved = {};
const set = () => { for (const k of Object.keys(ENV)) { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = ENV[k]; } };
const restore = () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; delete saved[k]; } };
set();

const { needsAdminMfa, signAdminMarker, adminMarkerValid, isProtectedPath } = await import('../lib/admin-mfa-gate.js');
const { proxy } = await import('../proxy.js');
restore();

const session = (email, sub = '1', tv = 0) =>
  new SignJWT({ email, name: '', tv }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(ENV.AUTH_SECRET));
const on = () => { set(); process.env.ADMIN_MFA = 'on'; };
const off = () => { delete process.env.ADMIN_MFA; restore(); };

suite('admin two-factor gate');
{
  test('which paths are protected', () => {
    for (const p of ['/admin', '/admin/financial', '/api/admin/plaid', '/api/plaid/link']) assert(isProtectedPath(p), p);
    for (const p of ['/admin/security', '/api/admin/mfa', '/api/plaid/webhook', '/shop', '/api/checkout', '/driver']) assert(!isProtectedPath(p), p);
  });

  test('OFF unless ADMIN_MFA=on: nothing is stopped', async () => {
    off();
    equal(await needsAdminMfa({ pathname: '/admin/financial', sessionToken: await session('boss@example.test') }), false);
  });

  test('ON: an admin with no marker is stopped; with a valid one is not', async () => {
    on();
    const s = await session('boss@example.test', '7', 3);
    equal(await needsAdminMfa({ pathname: '/admin/financial', sessionToken: s }), true);
    const m = await signAdminMarker(7, 3);
    equal(await needsAdminMfa({ pathname: '/admin/financial', sessionToken: s, markerToken: m }), false);
    off();
  });

  test('a marker is bound to the user and to the session generation', async () => {
    on();
    const m = await signAdminMarker(7, 3);
    equal(await adminMarkerValid(m, 7, 3), true);
    equal(await adminMarkerValid(m, 8, 3), false, 'another user');
    equal(await adminMarkerValid(m, 7, 4), false, 'after logout / password change bumps token_version');
    equal(await adminMarkerValid(m, 7, 3, { nowMs: Date.now() + 13 * 3600 * 1000 }), false, 'expired');
    equal(await adminMarkerValid('garbage', 7, 3), false);
    // a session token (same secret, no purpose) is not a marker
    equal(await adminMarkerValid(await session('boss@example.test', '7', 3), 7, 3), false);
    off();
  });

  test('the second factor itself and non-admins are not stopped', async () => {
    on();
    equal(await needsAdminMfa({ pathname: '/admin/security', sessionToken: await session('boss@example.test') }), false);
    equal(await needsAdminMfa({ pathname: '/api/admin/mfa', sessionToken: await session('boss@example.test') }), false);
    equal(await needsAdminMfa({ pathname: '/admin/financial', sessionToken: await session('someone@example.test') }), false, 'the route refuses non-admins itself');
    equal(await needsAdminMfa({ pathname: '/admin/financial', sessionToken: undefined }), false, 'signed out: the page redirects to login');
    equal(await needsAdminMfa({ pathname: '/admin/financial', sessionToken: 'not-a-token' }), false);
    off();
  });

  test('the proxy redirects pages and refuses APIs', async () => {
    on();
    const s = await session('ravi@example.test', '9', 0);
    const page = await proxy(new NextRequest('https://bargainbay.ca/admin/financial?x=1', { headers: { cookie: `bb_session=${s}` } }));
    equal(page.status, 307);
    assert(page.headers.get('location').includes('/admin/security?next='), page.headers.get('location'));
    const api = await proxy(new NextRequest('https://bargainbay.ca/api/admin/plaid', { headers: { cookie: `bb_session=${s}` } }));
    equal(api.status, 403);
    const m = await signAdminMarker(9, 0);
    const ok = await proxy(new NextRequest('https://bargainbay.ca/admin/financial', { headers: { cookie: `bb_session=${s}; bb_amfa=${m}` } }));
    equal(ok.status, 200);
    off();
  });
}
