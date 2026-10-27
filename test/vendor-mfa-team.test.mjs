// Vendor team roles and two-factor sign-in: the TOTP maths against the RFC vectors, the
// permission matrix (role x action, and a scan that EVERY vendor route and page names an action),
// enrolment / replay / window / lockout / recovery codes against a real Postgres, the
// "verified browser" marker, the single gate (including step-up), the team rules (last owner,
// revoke keeps the row, cross-vendor isolation) and the admin reset.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { query } from '../lib/db.js';
import { createSessionToken, SESSION_COOKIE, isStaff } from '../lib/auth.js';
import { createApplication, grantVendorUser, vendorAccess, revokeVendorUser, changeVendorUserRole } from '../lib/vendors.js';
import { decideApplication } from './approved-vendor.mjs';
import { hotp, totp, base32Encode, base32Decode, matchStep, STEP_SECONDS, stepAt } from '../lib/totp.js';
import {
  VENDOR_ROLES, ACTIONS, can, actionsFor, MFA_GRACE_DAYS, STEP_UP_MINUTES, MFA_MAX_FAILURES
} from '../lib/vendor-permissions.js';
import {
  beginEnrolment, confirmEnrolment, verifyCode, regenerateRecoveryCodes, lockStatus, mfaState, clearMfa
} from '../lib/vendor-mfa.js';
import { signMarker, readMarkerToken, MARKER_COOKIE } from '../lib/vendor-mfa-marker.js';
import { checkVendor, requireVendor } from '../lib/vendor-session.js';
import { listTeam, inviteTeamMember, resetMemberMfa } from '../lib/vendor-team.js';
import { safeNext } from '../lib/vendor-next.js';
import { encryptSecret } from '../lib/secret-box.js';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'mfa-test-secret';
process.env.BANK_ENCRYPTION_KEY = process.env.BANK_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
process.env.ADMIN_EMAILS = 'boss@example.test';
process.env.SALES_EMAILS = 'rep@example.test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
async function rejects(fn, re) {
  let err; try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw'); if (re) assert(re.test(err.message), `message was: ${err.message}`);
}

// ---------------------------------------------------------------------------------------------
suite('TOTP — RFC 6238 and RFC 4226 vectors');

const RFC_SECRET = Buffer.from('12345678901234567890');

test('RFC 4226 appendix D: the first ten HOTP values', () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  equal(want.map((_, i) => hotp(RFC_SECRET, i)), want);
});

test('RFC 6238 appendix B: SHA-1 vectors (8 digits)', () => {
  const vectors = { 59: '94287082', 1111111109: '07081804', 1111111111: '14050471', 1234567890: '89005924', 2000000000: '69279037', 20000000000: '65353130' };
  for (const [t, code] of Object.entries(vectors)) equal(hotp(RFC_SECRET, Math.floor(Number(t) / STEP_SECONDS), { digits: 8 }), code, `t=${t}`);
});

test('the 6-digit code is the last six of the 8-digit one, through the base32 secret', () => {
  const b32 = base32Encode(RFC_SECRET);
  equal(b32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  equal(base32Decode(b32).toString(), '12345678901234567890');
  equal(totp(b32, 59 * 1000), '287082');
  equal(totp(b32, 1111111109 * 1000), '081804');
});

test('matchStep accepts +-1 step and nothing wider, and only six digits', () => {
  const b32 = base32Encode(RFC_SECRET);
  const now = 1111111109 * 1000; const s = stepAt(now);
  equal(matchStep(b32, totp(b32, now), { nowMs: now }), s);
  equal(matchStep(b32, totp(b32, now - 30000), { nowMs: now }), s - 1);
  equal(matchStep(b32, totp(b32, now + 30000), { nowMs: now }), s + 1);
  equal(matchStep(b32, totp(b32, now - 60000), { nowMs: now }), null);
  equal(matchStep(b32, totp(b32, now + 60000), { nowMs: now }), null);
  equal(matchStep(b32, '12345', { nowMs: now }), null);
  equal(matchStep(b32, 'abcdef', { nowMs: now }), null);
  equal(matchStep(b32, ' 081 804 ', { nowMs: now }), s);       // spaces as typed from an app
});

// ---------------------------------------------------------------------------------------------
suite('vendor permissions — one table');

const EXPECTED = {
  owner: Object.keys(ACTIONS),
  manager: ['portal.view', 'performance.view', 'policies.view', 'listings.view', 'listings.edit', 'listings.bulk', 'orders.view', 'orders.fulfil', 'claims.view', 'claims.respond', 'messages.view', 'messages.send'],
  listings: ['portal.view', 'performance.view', 'policies.view', 'listings.view', 'listings.edit', 'listings.bulk'],
  fulfilment: ['portal.view', 'performance.view', 'policies.view', 'listings.view', 'orders.view', 'orders.fulfil', 'claims.view', 'claims.respond'],
  viewer: ['portal.view', 'performance.view', 'policies.view', 'listings.view', 'orders.view', 'claims.view', 'messages.view']
};

test('the permission matrix is exactly what the owner specified, for every role x every action', () => {
  equal(VENDOR_ROLES, ['owner', 'manager', 'listings', 'fulfilment', 'viewer']);
  for (const role of VENDOR_ROLES) {
    for (const action of Object.keys(ACTIONS)) {
      equal(can(role, action), EXPECTED[role].includes(action), `${role} / ${action}`);
    }
    equal([...actionsFor(role)].sort(), [...EXPECTED[role]].sort(), role);
  }
});

test('only the owner touches money, the bank, the team or the policies; nobody else gets in by accident', () => {
  for (const a of ['money.view', 'bank.view', 'bank.edit', 'team.view', 'team.manage', 'policies.accept']) {
    for (const r of VENDOR_ROLES) equal(can(r, a), r === 'owner', `${r}/${a}`);
  }
  assert(!can('owner', 'nonsense.action'), 'an unlisted action is allowed to nobody, owner included');
  assert(!can('superuser', 'portal.view'), 'an unknown role is allowed nothing');
  assert(!can(undefined, 'portal.view') && !can('owner', undefined));
  assert(!can('owner', 'toString') && !can('owner', '__proto__'), 'prototype keys are not actions');
});

test('safeNext only ever points inside the vendor portal', () => {
  equal(safeNext('/vendor/team'), '/vendor/team');
  equal(safeNext('/vendor/listings/12'), '/vendor/listings/12');
  for (const bad of ['//evil.example', 'https://evil.example', '/admin', '/vendor/../admin', 'javascript:alert(1)', null, undefined, '/vendorx']) equal(safeNext(bad), '/vendor', String(bad));
});

// ---------------------------------------------------------------------------------------------
suite('vendor routes and pages — every one names an action');

function walk(dir, name) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, name));
    else if (n === name) out.push(p);
  }
  return out.sort();
}
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IDENTITY_ONLY = ['app/api/vendor/mfa/route.js'];  // reachable BEFORE the second factor, by design

function handlers(src) {
  const out = [];
  const re = /export async function (GET|POST|PUT|PATCH|DELETE)\b/g;
  const marks = [];
  let m;
  while ((m = re.exec(src))) marks.push({ method: m[1], at: m.index });
  marks.forEach((x, i) => out.push({ method: x.method, body: src.slice(x.at, i + 1 < marks.length ? marks[i + 1].at : src.length) }));
  return out;
}
const actionOf = (body) => (body.match(/(?:requireVendor|checkVendor)\(\s*'([\w.]+)'/) || [])[1];

const routeFiles = walk(join(root, 'app', 'api', 'vendor'), 'route.js');
const rel = (f) => f.slice(root.length + 1);

test('every vendor API handler goes through requireVendor/checkVendor with a real action (or is the MFA route)', () => {
  assert(routeFiles.length >= 10, 'found the routes');
  const bad = [];
  for (const f of routeFiles) {
    const src = readFileSync(f, 'utf8');
    if (IDENTITY_ONLY.includes(rel(f))) { assert(/requireVendorIdentity\(/.test(src)); continue; }
    assert(!/requireVendorIdentity|vendorAccess\(/.test(src), `${rel(f)} must not bypass the gate`);
    for (const h of handlers(src)) {
      const a = actionOf(h.body);
      if (!a || !Object.prototype.hasOwnProperty.call(ACTIONS, a)) bad.push(`${h.method} ${rel(f)} -> ${a || 'no action'}`);
    }
  }
  assert(!bad.length, `handlers with no valid permission check:\n  ${bad.join('\n  ')}`);
});

test('a write handler never uses a view-only action', () => {
  const bad = [];
  for (const f of routeFiles) {
    if (IDENTITY_ONLY.includes(rel(f))) continue;
    for (const h of handlers(readFileSync(f, 'utf8'))) {
      const a = actionOf(h.body);
      if (h.method !== 'GET' && /\.view$/.test(a) && !/^(portal|performance|policies)\./.test(a)) bad.push(`${h.method} ${rel(f)} uses ${a}`);
    }
  }
  assert(!bad.length, bad.join('\n'));
});

test('every vendor page gates on an action (the MFA / security pages use the identity gate)', () => {
  const pages = walk(join(root, 'app', 'vendor'), 'page.jsx');
  assert(pages.length >= 10);
  const bad = [];
  for (const f of pages) {
    const src = readFileSync(f, 'utf8');
    const r = rel(f);
    if (r === 'app/vendor/mfa/page.jsx' || r === 'app/vendor/security/page.jsx') { if (!/vendorIdentityGate\(/.test(src)) bad.push(`${r}: no gate`); continue; }
    const m = src.match(/vendorGate\([^,()]*(?:`[^`]*`)?[^,()]*,\s*'([\w.]+)'\)/);
    if (!m || !Object.prototype.hasOwnProperty.call(ACTIONS, m[1])) bad.push(`${r}: vendorGate has no valid action`);
  }
  assert(!bad.length, bad.join('\n'));
});

test('the vendor portal is the ONLY place that asks who a vendor user is', () => {
  const allowed = new Set(['lib/vendors.js', 'lib/vendor-session.js', 'app/api/auth/me/route.js']);
  const hits = [];
  for (const dir of ['app', 'lib', 'components']) {
    const files = [...walk(join(root, dir), 'route.js'), ...walk(join(root, dir), 'page.jsx'),
      ...readdirSync(join(root, dir)).filter((n) => n.endsWith('.js') || n.endsWith('.jsx')).map((n) => join(root, dir, n))];
    for (const f of files) if (/vendorAccess\(/.test(readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')) && !allowed.has(rel(f))) hits.push(rel(f));
  }
  assert(!hits.length, `vendorAccess( used outside the gate: ${hits.join(', ')}`);
});

test('team code never touches the staff lists', () => {
  for (const f of ['lib/vendor-team.js', 'lib/vendors.js', 'lib/vendor-session.js', 'lib/vendor-mfa.js']) {
    const src = readFileSync(join(root, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert(!/staff_access|SALES_EMAILS|ADMIN_EMAILS|grantStaff/.test(src), `${f} reaches for a staff list`);
  }
});

// ---------------------------------------------------------------------------------------------
suite('vendor MFA, gate and team — against Postgres');

let T; // one migrated database shared by the tests below; released by the last one
let V1; let V2;
let seq = 0;
const nowMs = () => Date.now();

async function newUser(label) {
  seq += 1;
  const email = `${label}${seq}@vendor.test`;
  const { rows } = await query(`INSERT INTO users (email, name, password_hash) VALUES ($1,$2,'x') RETURNING id, token_version`, [email, label]);
  return { id: rows[0].id, email, tv: Number(rows[0].token_version) };
}
async function sessionJar(u, { marker } = {}) {
  const { rows } = await query('SELECT token_version FROM users WHERE id = $1', [u.id]);
  const token = await createSessionToken({ id: u.id, email: u.email, name: u.email, token_version: Number(rows[0].token_version) });
  __setTestCookies({ [SESSION_COOKIE]: token, ...(marker ? { [MARKER_COOKIE]: marker } : {}) });
}
async function member(vendor, role, label = role) {
  const u = await newUser(label);
  await grantVendorUser(vendor.id, { email: u.email, role, by: 'test' });
  return u;
}
async function vendorNamed(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  return v;
}
const wrongCode = (secret, at = nowMs()) => {
  const ok = new Set([-1, 0, 1].map((d) => totp(secret, at + d * 30000)));
  for (let i = 100000; ; i++) if (!ok.has(String(i))) return String(i);
};
// an enrolled user; returns the secret so the test can make codes
async function enrol(u, at = nowMs()) {
  const b = await beginEnrolment(u.id, u.email);
  const c = await confirmEnrolment(u.id, totp(b.secret, at), { nowMs: at });
  assert(c.ok, c.error);
  return { secret: b.secret, recoveryCodes: c.recoveryCodes };
}
const expireAttempts = (u, minutes) =>
  query(`UPDATE vendor_mfa_attempts SET at = at - make_interval(mins => $2) WHERE user_id = $1`, [u.id, minutes]);

test('set up the test database and two vendors', async () => {
  T = await withTestDb();
  V1 = await vendorNamed('Alpha'); V2 = await vendorNamed('Beta');
  // the migration's CHECK takes the five roles and refuses the old 'staff'
  await rejects(() => query(`INSERT INTO vendor_users (vendor_id, email, role) VALUES ($1,'x@y.test','staff')`, [V1.id]), /role_check|violates/i);
});

test('enrolment: shown once, off until the first code confirms it, secret encrypted at rest', async () => {
  const u = await newUser('enrol');
  const b = await beginEnrolment(u.id, u.email);
  assert(/^[A-Z2-7]{32}$/.test(b.secret), 'a 160-bit base32 secret');
  assert(b.otpauthUrl.startsWith('otpauth://totp/') && b.otpauthUrl.includes(`secret=${b.secret}`));
  equal((await mfaState(u.id)).enrolled, false, 'not on until confirmed');
  const { rows } = await query('SELECT secret_enc FROM vendor_mfa WHERE user_id = $1', [u.id]);
  assert(rows[0].secret_enc.startsWith('v1:') && !rows[0].secret_enc.includes(b.secret), 'ciphertext, not the secret');
  // a wrong first code does not turn it on
  assert(!(await confirmEnrolment(u.id, wrongCode(b.secret))).ok);
  equal((await mfaState(u.id)).enrolled, false);
  const c = await confirmEnrolment(u.id, totp(b.secret));
  assert(c.ok && c.recoveryCodes.length === 10 && new Set(c.recoveryCodes).size === 10);
  assert(c.recoveryCodes.every((x) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(x)));
  equal((await mfaState(u.id)).enrolled, true);
  // an enrolled user cannot swap the authenticator (a stolen session must not be able to)
  await rejects(() => beginEnrolment(u.id, u.email), /already set up/);
  // recovery codes are stored hashed
  const all = JSON.stringify((await query('SELECT code_hash FROM vendor_mfa_recovery WHERE user_id = $1', [u.id])).rows);
  assert(c.recoveryCodes.every((x) => !all.includes(x.replace('-', ''))), 'no plaintext recovery code in the table');
});

test('restarting enrolment before confirming replaces the pending secret; with no key nothing is enrolled', async () => {
  const u = await newUser('restart');
  const a = await beginEnrolment(u.id, u.email); const b = await beginEnrolment(u.id, u.email);
  assert(a.secret !== b.secret);
  assert(!(await confirmEnrolment(u.id, totp(a.secret))).ok, 'the abandoned secret no longer confirms');
  const nk = await newUser('nokey');
  const key = process.env.BANK_ENCRYPTION_KEY;
  delete process.env.BANK_ENCRYPTION_KEY;
  try { await rejects(() => beginEnrolment(nk.id, 'x@y.test'), /not available/); }
  finally { process.env.BANK_ENCRYPTION_KEY = key; }
});

test('a code cannot be used twice (replay), and an older step is refused once a newer one is used', async () => {
  const u = await newUser('replay'); const t0 = nowMs();
  const { secret } = await enrol(u, t0);
  // the confirming code (step s) is already spent: using it again at sign-in is a replay
  assert(!(await verifyCode(u.id, totp(secret, t0), { nowMs: t0 })).ok, 'the enrolment code cannot be replayed');
  const next = totp(secret, t0 + 30000);
  assert((await verifyCode(u.id, next, { nowMs: t0 + 30000 })).ok, 'the next step works');
  assert(!(await verifyCode(u.id, next, { nowMs: t0 + 30000 })).ok, 'the same code twice is refused');
  assert(!(await verifyCode(u.id, totp(secret, t0 + 30000), { nowMs: t0 + 31000 })).ok, 'still refused inside the window');
  // a code from BEFORE the last accepted step is also refused
  assert(!(await verifyCode(u.id, totp(secret, t0), { nowMs: t0 + 30000 })).ok, 'older than the last used step');
  assert((await verifyCode(u.id, totp(secret, t0 + 90000), { nowMs: t0 + 90000 })).ok, 'a later step works again');
});

test('simultaneous requests with one code: exactly one wins', async () => {
  const u = await newUser('race'); const t0 = nowMs();
  const { secret } = await enrol(u, t0);
  const code = totp(secret, t0 + 30000);
  const results = await Promise.all([1, 2, 3, 4].map(() => verifyCode(u.id, code, { nowMs: t0 + 30000 })));
  equal(results.filter((r) => r.ok).length, 1);
});

test('the +-1 step window: accepted at one step either side, refused at two', async () => {
  const u = await newUser('window'); const t0 = nowMs();
  const { secret } = await enrol(u, t0 - 600000);                       // enrolled ten minutes ago
  assert(!(await verifyCode(u.id, totp(secret, t0 - 60000), { nowMs: t0 })).ok, 'two steps old');
  assert(!(await verifyCode(u.id, totp(secret, t0 + 60000), { nowMs: t0 })).ok, 'two steps ahead');
  assert((await verifyCode(u.id, totp(secret, t0 - 30000), { nowMs: t0 })).ok, 'one step old');
  const u2 = await newUser('window2');
  const e2 = await enrol(u2, t0 - 600000);
  assert((await verifyCode(u2.id, totp(e2.secret, t0 + 30000), { nowMs: t0 })).ok, 'one step ahead (clock drift)');
});

test('lockout: five wrong codes lock even the right one; refused attempts are not counted; it doubles', async () => {
  const u = await newUser('lock'); const t0 = nowMs();
  const { secret } = await enrol(u, t0 - 600000);
  for (let i = 0; i < MFA_MAX_FAILURES; i++) assert(!(await verifyCode(u.id, wrongCode(secret))).ok);
  const s = await lockStatus(u.id);
  assert(s.locked && s.retryAfterSec > 0 && s.retryAfterSec <= 60, `locked for about a minute, got ${s.retryAfterSec}`);
  const before = (await query('SELECT count(*)::int AS n FROM vendor_mfa_attempts WHERE user_id = $1', [u.id])).rows[0].n;
  const right = await verifyCode(u.id, totp(secret, t0));
  assert(!right.ok && right.locked, 'the right code is refused while locked');
  assert(!(await verifyCode(u.id, wrongCode(secret))).ok);
  equal((await query('SELECT count(*)::int AS n FROM vendor_mfa_attempts WHERE user_id = $1', [u.id])).rows[0].n, before, 'hammering a lock does not extend it');
  // after the minute it opens; one more failure doubles the lock to two minutes
  await expireAttempts(u, 2);
  assert(!(await lockStatus(u.id)).locked);
  assert(!(await verifyCode(u.id, wrongCode(secret))).ok);
  const s2 = await lockStatus(u.id);
  assert(s2.locked && s2.retryAfterSec > 60 && s2.retryAfterSec <= 120, `doubled, got ${s2.retryAfterSec}`);
  await expireAttempts(u, 3);
  const ok = await verifyCode(u.id, totp(secret, t0 + 30000), { nowMs: t0 + 30000 });
  assert(ok.ok, 'opens, and a right code resets the count');
  equal((await lockStatus(u.id)).failures, 0);
});

test('recovery codes: single use, forgiving of case and dashes, replaced wholesale on regeneration', async () => {
  const u = await newUser('recov'); const t0 = nowMs();
  const { secret, recoveryCodes } = await enrol(u, t0 - 600000);
  const r1 = await verifyCode(u.id, recoveryCodes[0]);
  assert(r1.ok && r1.via === 'recovery' && r1.recoveryLeft === 9);
  assert(!(await verifyCode(u.id, recoveryCodes[0])).ok, 'a recovery code works once');
  assert((await verifyCode(u.id, recoveryCodes[1].toLowerCase().replace('-', ' '))).ok, 'case and separators do not matter');
  assert(!(await verifyCode(u.id, 'AAAAA-AAAAA')).ok);
  // regenerating needs a current authenticator code — not a recovery code
  assert(!(await regenerateRecoveryCodes(u.id, recoveryCodes[2])).ok);
  const fresh = await regenerateRecoveryCodes(u.id, totp(secret, t0), { nowMs: t0 });
  assert(fresh.ok && fresh.recoveryCodes.length === 10);
  assert(!(await verifyCode(u.id, recoveryCodes[3])).ok, 'old codes are dead');
  assert((await verifyCode(u.id, fresh.recoveryCodes[0])).ok);
  // another user's recovery code is no use to this one
  const other = await newUser('recov-other'); const oe = await enrol(other, t0 - 600000);
  assert(!(await verifyCode(u.id, oe.recoveryCodes[0])).ok, 'recovery codes are per user');
});

test('a secret copied onto another user does not decrypt (bound to the user id)', async () => {
  const a = await newUser('aadA'); const b = await newUser('aadB'); const t0 = nowMs();
  const ea = await enrol(a, t0 - 600000);
  const { rows } = await query('SELECT secret_enc FROM vendor_mfa WHERE user_id = $1', [a.id]);
  await query(`INSERT INTO vendor_mfa (user_id, secret_enc, confirmed_at) VALUES ($1,$2,now())`, [b.id, rows[0].secret_enc]);
  const r = await verifyCode(b.id, totp(ea.secret, t0), { nowMs: t0 });
  assert(!r.ok, 'a swapped ciphertext cannot be used');
  assert(!JSON.stringify(r).includes(ea.secret));
});

test('the verified-browser marker is bound to the user, expires, and dies with token_version', async () => {
  const a = await newUser('markA'); const b = await newUser('markB');
  const tok = await signMarker(a.id);
  assert((await readMarkerToken(tok, a.id)), 'valid for its own user');
  equal(await readMarkerToken(tok, b.id), null, 'not for anyone else');
  equal(await readMarkerToken(tok + 'x', a.id), null, 'tampered');
  equal(await readMarkerToken(await signMarker(a.id, { nowMs: nowMs() - 13 * 3600 * 1000 }), a.id), null, 'older than 12 hours');
  assert(await readMarkerToken(await signMarker(a.id, { nowMs: nowMs() - 11 * 3600 * 1000 }), a.id), '11 hours is fine');
  // a normal session token is not a marker, even though it names the same user
  const session = await createSessionToken({ id: a.id, email: a.email, name: 'a', token_version: 0 });
  equal(await readMarkerToken(session, a.id), null, 'a bb_session JWT is not a marker');
  await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [a.id]);
  equal(await readMarkerToken(tok, a.id), null, 'a password change / sign-out-everywhere kills it');
});

test('the gate: an ENROLLED user needs the marker, whatever their role', async () => {
  for (const role of ['owner', 'viewer']) {
    const u = await member(V1, role, `gate-${role}`); await enrol(u, nowMs() - 600000);
    await sessionJar(u);
    equal((await checkVendor('portal.view')).reason, 'mfa_verify', `${role} without a marker`);
    assert(!(await requireVendor('portal.view')));
    await sessionJar(u, { marker: await signMarker(u.id) });
    const r = await checkVendor('portal.view');
    assert(r.ok && r.ctx.mfa.verified && r.ctx.vendor.id === V1.id, `${role} with a marker`);
    // a marker minted for somebody else does not carry over
    const other = await newUser('other');
    await sessionJar(u, { marker: await signMarker(other.id) });
    equal((await checkVendor('portal.view')).reason, 'mfa_verify', 'someone else\'s marker');
    // the permission is still checked after the factor
    await sessionJar(u, { marker: await signMarker(u.id) });
    equal((await checkVendor('nonsense.action')).reason, 'forbidden');
  }
  __setTestCookies(null);
});

test('the gate: a marker from before a token_version bump is refused even with a fresh session', async () => {
  const u = await member(V1, 'manager', 'bump'); await enrol(u, nowMs() - 600000);
  const old = await signMarker(u.id);
  await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [u.id]);
  await sessionJar(u, { marker: old });      // a brand-new session, the old marker
  equal((await checkVendor('portal.view')).reason, 'mfa_verify');
  __setTestCookies(null);
});

test('the gate: an owner has a grace period, then must enrol; other roles never must', async () => {
  const owner = await member(V1, 'owner', 'grace-owner');
  const mgr = await member(V1, 'manager', 'grace-mgr');
  await sessionJar(owner);
  let r = await checkVendor('portal.view');
  assert(r.ok && r.ctx.mfa.mustEnrol === false && r.ctx.mfa.daysLeft >= MFA_GRACE_DAYS - 1, 'in grace the portal opens (with a banner)');
  const g = (await query('SELECT mfa_grace_until FROM vendor_users WHERE lower(email) = $1', [owner.email])).rows[0].mfa_grace_until;
  assert(new Date(g).getTime() > nowMs() + 13 * 86400000 && new Date(g).getTime() < nowMs() + 15 * 86400000, 'grace is 14 days from the grant');
  await query(`UPDATE vendor_users SET mfa_grace_until = now() - interval '1 day' WHERE lower(email) = $1`, [owner.email]);
  r = await checkVendor('portal.view');
  equal(r.reason, 'mfa_enrol', 'after the grace the owner is turned away to enrol');
  await query(`UPDATE vendor_users SET mfa_grace_until = NULL WHERE lower(email) = $1`, [owner.email]).catch(() => {});
  // a manager with an expired grace is not forced
  await query(`UPDATE vendor_users SET mfa_grace_until = now() - interval '1 day' WHERE lower(email) = $1`, [mgr.email]);
  await sessionJar(mgr);
  assert((await checkVendor('portal.view')).ok);
  // an unusable key cannot enforce what cannot be done
  await sessionJar(owner);
  const key = process.env.BANK_ENCRYPTION_KEY; delete process.env.BANK_ENCRYPTION_KEY;
  try { assert((await checkVendor('portal.view')).ok, 'no key: enrolment impossible, so not enforced'); }
  finally { process.env.BANK_ENCRYPTION_KEY = key; }
  // once enrolled and verified the owner is back in
  await enrol(owner, nowMs() - 600000);
  await sessionJar(owner, { marker: await signMarker(owner.id) });
  assert((await checkVendor('portal.view')).ok);
  __setTestCookies(null);
});

test('the gate: a missing action refuses everything; nobody and non-vendors are refused', async () => {
  const u = await member(V1, 'owner', 'noaction');
  await sessionJar(u);
  equal((await checkVendor()).reason, 'no_action');
  equal((await checkVendor('')).reason, 'no_action');
  assert(!(await requireVendor()), 'requireVendor() with no action is a refusal, not "any member"');
  __setTestCookies(null);
  equal((await checkVendor('portal.view')).reason, 'no_access', 'nobody');
  const stranger = await newUser('stranger'); await sessionJar(stranger);
  equal((await checkVendor('portal.view')).reason, 'no_access', 'a customer who is not on any vendor');
  __setTestCookies(null);
});

test('step-up: enrolment is required outright, and the last code must be under ten minutes old', async () => {
  const u = await member(V1, 'owner', 'stepup');
  await sessionJar(u);
  equal((await checkVendor('bank.edit', { stepUp: true })).reason, 'mfa_enrol', 'unenrolled owner in grace still cannot change the bank');
  await enrol(u, nowMs() - 600000);
  const at = (min) => signMarker(u.id, { nowMs: nowMs() - min * 60000 });
  await sessionJar(u, { marker: await at(STEP_UP_MINUTES + 1) });
  equal((await checkVendor('bank.edit', { stepUp: true })).reason, 'stepup', '11 minutes old');
  assert((await checkVendor('portal.view')).ok, 'a stale marker still opens ordinary pages');
  await sessionJar(u, { marker: await at(STEP_UP_MINUTES - 1) });
  assert((await checkVendor('bank.edit', { stepUp: true })).ok, '9 minutes old');
  // a manager can never reach the bank, however fresh the code
  const m = await member(V1, 'manager', 'stepup-mgr'); await enrol(m, nowMs() - 600000);
  await sessionJar(m, { marker: await signMarker(m.id) });
  equal((await checkVendor('bank.edit', { stepUp: true })).reason, 'forbidden');
  __setTestCookies(null);
});

// --- route-level --------------------------------------------------------------------------

const routeMods = {};
async function routeModule(f) { return (routeMods[f] ||= await import(pathToFileURL(f).href)); }
async function call(handler, method, url = 'http://localhost/api/vendor/x?id=1') {
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (method !== 'GET') init.body = '{}';
  try {
    const res = await handler(new NextRequest(url, init), { params: Promise.resolve({ id: '1' }) });
    let body = null; try { body = await res.clone().json(); } catch { /* not json */ }
    return { status: res.status, body };
  } catch (e) { return { threw: String(e?.message || e).slice(0, 100) }; }
}

test('permission matrix over the real routes: every role x every vendor handler is allowed iff can(role, action)', async () => {
  const users = {};
  for (const role of VENDOR_ROLES) users[role] = await member(V1, role, `matrix-${role}`);
  const failures = []; let allowedChecked = 0; let refusedChecked = 0;
  for (const f of routeFiles) {
    if (IDENTITY_ONLY.includes(rel(f))) continue;
    const src = readFileSync(f, 'utf8'); const mod = await routeModule(f);
    for (const h of handlers(src)) {
      const action = actionOf(h.body); const stepUp = /stepUp:\s*true/.test(h.body);
      for (const role of VENDOR_ROLES) {
        await sessionJar(users[role]);
        const r = await call(mod[h.method], h.method);
        const refused = r.status === 403;
        // a stepUp route is refused for an unenrolled owner too — that is the point
        const expectRefused = !can(role, action) || stepUp;
        if (expectRefused !== refused) failures.push(`${role} ${h.method} ${rel(f)} (${action}${stepUp ? ', stepUp' : ''}) -> ${r.threw || r.status}`);
        expectRefused ? refusedChecked++ : allowedChecked++;
        if (stepUp && can(role, action)) equal(r.body?.mfa, 'enrol', `${role} ${rel(f)} tells the page what to do`);
      }
    }
  }
  __setTestCookies(null);
  assert(!failures.length, `${failures.length} mismatch(es):\n  ${failures.join('\n  ')}`);
  assert(allowedChecked > 20 && refusedChecked > 20, `both sides exercised (${allowedChecked}/${refusedChecked})`);
});

test('nobody is refused by every vendor route as a 403 with no body leak', async () => {
  __setTestCookies({});
  for (const f of routeFiles) {
    const mod = await routeModule(f);
    for (const h of handlers(readFileSync(f, 'utf8'))) {
      const r = await call(mod[h.method], h.method);
      assert(r.status === 403, `${h.method} ${rel(f)} as nobody -> ${r.threw || r.status}`);
    }
  }
  __setTestCookies(null);
});

test('the bank route end to end: stale code -> step-up asked; fresh code -> reaches validation', async () => {
  const u = await member(V1, 'owner', 'bankroute'); await enrol(u, nowMs() - 600000);
  const mod = await routeModule(join(root, 'app/api/vendor/bank/route.js'));
  await sessionJar(u, { marker: await signMarker(u.id, { nowMs: nowMs() - 15 * 60000 }) });
  let r = await call(mod.POST, 'POST');
  equal([r.status, r.body.mfa], [403, 'stepup']);
  await sessionJar(u, { marker: await signMarker(u.id) });
  r = await call(mod.POST, 'POST');
  equal(r.status, 400, 'past the gate, then the form validation refuses an empty body');
  __setTestCookies(null);
});

test('the MFA route: confirm then verify set the marker cookie; wrong codes do not; it only acts on the session user', async () => {
  const u = await member(V1, 'manager', 'mfaroute');
  const mod = await routeModule(join(root, 'app/api/vendor/mfa/route.js'));
  const post = (body) => mod.POST(new NextRequest('http://localhost/api/vendor/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  await sessionJar(u);
  const begin = await (await post({ action: 'begin' })).json();
  assert(begin.secret && begin.otpauthUrl);
  let res = await post({ action: 'confirm', code: wrongCode(begin.secret) });
  equal(res.status, 400); assert(!res.headers.get('set-cookie'));
  res = await post({ action: 'confirm', code: totp(begin.secret) });
  const body = await res.json();
  assert(res.status === 200 && body.recoveryCodes.length === 10);
  const cookie = res.headers.get('set-cookie');
  assert(cookie && cookie.startsWith(`${MARKER_COOKIE}=`) && /httponly/i.test(cookie) && /samesite=lax/i.test(cookie), cookie);
  // sign in again with a recovery code
  res = await post({ action: 'verify', code: body.recoveryCodes[0] });
  assert(res.status === 200 && res.headers.get('set-cookie'));
  res = await post({ action: 'verify', code: body.recoveryCodes[0] });
  equal(res.status, 400);
  const state = await (await mod.GET()).json();
  assert(state.enrolled === true && !('secret' in state) && !('secret_enc' in state));
  __setTestCookies(null);
  equal((await post({ action: 'verify', code: '123456' })).status, 403, 'not signed in');
});

// --- team ---------------------------------------------------------------------------------

test('invite by email: every role works, the row exists, and the member can sign in as that role', async () => {
  const v = await vendorNamed('Gamma');
  const owner = await member(v, 'owner', 'gamma-owner');
  for (const role of VENDOR_ROLES) {
    const u = await newUser(`inv-${role}`);
    await inviteTeamMember(v.id, { email: u.email.toUpperCase(), name: role, role, by: owner.email });
    equal((await vendorAccess(u.email)).role, role);
  }
  const team = await listTeam(v.id);
  equal(team.length, 6);
  assert(team.every((t) => t.grantedBy), 'who let them in is recorded');
  await rejects(() => inviteTeamMember(v.id, { email: 'a@b.test', role: 'admin', by: 'o' }), /Role must be one of/);
  await rejects(() => inviteTeamMember(v.id, { email: 'not-an-email', role: 'viewer', by: 'o' }), /valid email/);
  await rejects(() => inviteTeamMember(v.id, { email: 'a@b.test', role: 'viewer' }), /Who is inviting/);
});

test('the old "staff" word still works and means manager', async () => {
  const v = await vendorNamed('Delta'); const u = await newUser('legacy');
  await grantVendorUser(v.id, { email: u.email, role: 'staff', by: 's' });
  equal((await vendorAccess(u.email)).role, 'manager');
});

test('the last owner can be neither removed nor demoted; a second owner unlocks both', async () => {
  const v = await vendorNamed('Epsilon');
  const o1 = await member(v, 'owner', 'eps-o1');
  await rejects(() => revokeVendorUser(v.id, o1.email, { by: 'x' }), /last owner/);
  await rejects(() => changeVendorUserRole(v.id, o1.email, 'manager', { by: 'x' }), /last owner/);
  const o2 = await member(v, 'owner', 'eps-o2');
  await changeVendorUserRole(v.id, o1.email, 'manager', { by: o2.email });
  equal((await vendorAccess(o1.email)).role, 'manager');
  await rejects(() => revokeVendorUser(v.id, o2.email, { by: 'x' }), /last owner/);
  await rejects(() => changeVendorUserRole(v.id, o2.email, 'viewer', { by: 'x' }), /last owner/);
  // (Two simultaneous removals are serialised by the row lock on the vendor; PGlite is one
  // connection, so that cannot be raced here.)
});

test('promoting someone to owner starts their MFA grace; unchanged roles are no-ops', async () => {
  const v = await vendorNamed('Zeta'); await member(v, 'owner', 'zeta-o');
  const m = await member(v, 'manager', 'zeta-m');
  await query(`UPDATE vendor_users SET mfa_grace_until = now() - interval '30 days' WHERE lower(email) = $1`, [m.email]);
  equal((await changeVendorUserRole(v.id, m.email, 'manager', { by: 'x' })).unchanged, true);
  await changeVendorUserRole(v.id, m.email, 'owner', { by: 'x' });
  const g = (await query('SELECT mfa_grace_until, role_changed_by FROM vendor_users WHERE lower(email) = $1', [m.email])).rows[0];
  assert(new Date(g.mfa_grace_until).getTime() > nowMs() + 13 * 86400000, 'a fresh 14 days');
  equal(g.role_changed_by, 'x');
});

test('revoking keeps the row, ends access at once, and the address can be invited again', async () => {
  const v = await vendorNamed('Eta'); await member(v, 'owner', 'eta-o');
  const m = await member(v, 'fulfilment', 'eta-m');
  assert(await vendorAccess(m.email));
  await revokeVendorUser(v.id, m.email, { by: 'owner@x' });
  equal(await vendorAccess(m.email), null);
  await sessionJar(m);
  equal((await checkVendor('portal.view')).reason, 'no_access', 'a revoked member is refused by the gate on the next request');
  __setTestCookies(null);
  const row = (await query('SELECT revoked_at, revoked_by FROM vendor_users WHERE lower(email) = $1', [m.email])).rows[0];
  assert(row.revoked_at && row.revoked_by === 'owner@x', 'the row is kept');
  await inviteTeamMember(v.id, { email: m.email, role: 'viewer', by: 'owner@x' });
  equal((await vendorAccess(m.email)).role, 'viewer');
  equal((await query('SELECT count(*)::int AS n FROM vendor_users WHERE lower(email) = $1', [m.email])).rows[0].n, 2, 'history and the new grant');
  equal((await query('SELECT count(*)::int AS n FROM vendor_events WHERE vendor_id = $1 AND event = $2', [v.id, 'user_revoked'])).rows[0].n, 1);
});

test('cross-vendor isolation: one address, one vendor; the team list and the MFA reset stay inside the vendor', async () => {
  const a = await vendorNamed('Theta'); const b = await vendorNamed('Iota');
  const ao = await member(a, 'owner', 'theta-o'); const bo = await member(b, 'owner', 'iota-o');
  await rejects(() => inviteTeamMember(a.id, { email: bo.email, role: 'viewer', by: ao.email }), /cannot be added to this team/);
  const msg = await inviteTeamMember(a.id, { email: bo.email, role: 'viewer', by: 'x' }).catch((e) => e.message);
  assert(!/Iota|vendor \d/i.test(msg), 'does not say who they belong to');
  assert((await listTeam(a.id)).every((t) => t.email !== bo.email), 'the other vendor\'s people are not on this list');
  await enrol(bo, nowMs() - 600000);
  const admin = { email: 'boss@example.test', name: 'Boss' };
  await rejects(() => resetMemberMfa(a.id, bo.email, { session: admin, reason: 'trying' }), /not on this vendor/);
  assert((await mfaState(bo.id)).enrolled, 'untouched');
  // the gate gives each user their own vendor
  await sessionJar(ao); equal((await checkVendor('portal.view')).ctx.vendor.id, a.id);
  await sessionJar(bo, { marker: await signMarker(bo.id) }); equal((await checkVendor('portal.view')).ctx.vendor.id, b.id);
  __setTestCookies(null);
});

test('team members are on no staff list', async () => {
  const v = await vendorNamed('Kappa'); const o = await member(v, 'owner', 'kappa-o');
  assert(!isStaff({ email: o.email }), 'an owner of a vendor is not staff');
});

// --- admin recovery -----------------------------------------------------------------------

test('admin reset: needs a reason, clears the factor and every session, is audited and logged', async () => {
  const v = await vendorNamed('Lambda'); await member(v, 'owner', 'lam-o');
  const m = await member(v, 'manager', 'lam-m'); const e = await enrol(m, nowMs() - 600000);
  await sessionJar(m, { marker: await signMarker(m.id) });
  assert((await checkVendor('portal.view')).ok);
  const admin = { email: 'boss@example.test', name: 'Boss' };
  await rejects(() => resetMemberMfa(v.id, m.email, { session: admin, reason: '  ' }), /needs a reason/);
  await rejects(() => resetMemberMfa(v.id, m.email, { session: { email: '' }, reason: 'x' }), /Who/);
  await resetMemberMfa(v.id, m.email, { session: admin, reason: 'Lost phone, verified by video call' });
  equal((await mfaState(m.id)).enrolled, false);
  equal((await query('SELECT count(*)::int AS n FROM vendor_mfa_recovery WHERE user_id = $1', [m.id])).rows[0].n, 0);
  assert(!(await verifyCode(m.id, e.recoveryCodes[0])).ok, 'old recovery codes are gone');
  // the old session and marker died with the token_version bump
  const stale = (await checkVendor('portal.view'));
  equal(stale.ok, false); // the old bb_session is no longer valid
  __setTestCookies(null);
  const ev = (await query(`SELECT actor, detail FROM vendor_events WHERE vendor_id = $1 AND event = 'mfa_reset'`, [v.id])).rows;
  equal(ev.length, 1); equal(ev[0].actor, 'boss@example.test');
  assert(JSON.stringify(ev[0].detail).includes('Lost phone'));
  const au = (await query(`SELECT actor, action, entity_id, summary FROM audit_log WHERE action = 'vendor.mfa_reset'`)).rows;
  assert(au.length === 1 && au[0].actor === 'boss@example.test' && /Lost phone/.test(au[0].summary), JSON.stringify(au));
  // they can enrol again from scratch
  const again = await beginEnrolment(m.id, m.email); assert(again.secret !== e.secret);
});

test('admin reset over HTTP: an admin may; staff and the vendor owner may not', async () => {
  const v = await vendorNamed('Mu'); const o = await member(v, 'owner', 'mu-o'); const m = await member(v, 'viewer', 'mu-m');
  await enrol(m, nowMs() - 600000);
  const mod = await routeModule(join(root, 'app/api/admin/marketplace/vendors/route.js'));
  const req = (body) => new NextRequest('http://localhost/api/admin/marketplace/vendors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { action: 'reset_mfa', vendorId: v.id, email: m.email, reason: 'phone stolen' };
  const as = async (email) => __setTestCookies({ [SESSION_COOKIE]: await createSessionToken({ id: 0, email, name: email, token_version: 0 }) });
  await as('rep@example.test');
  equal((await mod.POST(req(body))).status, 403, 'staff (sales) cannot');
  await sessionJar(o, { marker: await signMarker(o.id) });
  equal((await mod.POST(req(body))).status, 403, 'a vendor\'s own owner cannot');
  assert((await mfaState(m.id)).enrolled, 'still enrolled after the refusals');
  await as('boss@example.test');
  equal((await mod.POST(req(body))).status, 200, 'an admin can');
  equal((await mfaState(m.id)).enrolled, false);
  equal((await mod.POST(req({ ...body, reason: '' }))).status, 400, 'and must give a reason');
  __setTestCookies(null);
});

test('team API: the owner needs a fresh second factor to change anything; others cannot even list', async () => {
  const v = await vendorNamed('Nu'); const o = await member(v, 'owner', 'nu-o'); const m = await member(v, 'manager', 'nu-m');
  const mod = await routeModule(join(root, 'app/api/vendor/team/route.js'));
  const post = (body) => mod.POST(new NextRequest('http://localhost/api/vendor/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  await sessionJar(m);
  equal((await mod.GET()).status, 403, 'a manager cannot list the team');
  equal((await post({ action: 'invite', email: 'x@y.test', role: 'viewer' })).status, 403);
  await sessionJar(o);
  equal((await mod.GET()).status, 200, 'the owner (in grace) can look');
  let res = await post({ action: 'invite', email: 'new@y.test', role: 'viewer' });
  equal([res.status, (await res.json()).mfa], [403, 'enrol'], 'but changing it needs an enrolled authenticator');
  await enrol(o, nowMs() - 600000);
  await sessionJar(o, { marker: await signMarker(o.id) });
  res = await post({ action: 'invite', email: 'new@y.test', role: 'viewer' });
  equal(res.status, 200);
  equal((await vendorAccess('new@y.test')).role, 'viewer');
  res = await post({ action: 'role', email: o.email, role: 'viewer' });
  equal(res.status, 400, 'the last owner cannot demote themselves');
  __setTestCookies(null);
});

test('tear down the test database', () => {
  __setTestCookies(null);
  T.done();
});
