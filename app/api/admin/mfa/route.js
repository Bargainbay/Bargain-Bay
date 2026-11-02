// An administrator's own second factor: status, set it up, confirm the first code, check a code at
// sign-in, replace recovery codes, and reset the OTHER administrator's. ADMIN only; acts on the
// SESSION's user (no user id in the request, except the email of the colleague being reset).
//
// Reuses lib/vendor-mfa.js (same authenticator table, lockout, recovery codes). The "verified
// browser" marker is its own cookie (bb_amfa) — see lib/admin-mfa-gate.js. The enforcement is in
// proxy.js; this route is one of the few that is reachable BEFORE the second factor is passed.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, isAdmin } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { audit } from '../../../../lib/audit';
import { mfaState, mfaAvailable, beginEnrolment, confirmEnrolment, verifyCode, regenerateRecoveryCodes, clearMfa } from '../../../../lib/vendor-mfa';
import { signAdminMarker, adminMarkerValid, adminMarkerCookieOptions, ADMIN_MARKER_COOKIE, adminMfaEnforced } from '../../../../lib/admin-mfa-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

async function liveTv(userId) {
  const { rows } = await query('SELECT token_version FROM users WHERE id = $1', [userId]);
  return rows.length ? Number(rows[0].token_version) || 0 : null;
}
async function verifiedHere(session) {
  const tv = await liveTv(session.userId);
  if (tv === null) return false;
  const jar = await cookies();
  return adminMarkerValid(jar.get(ADMIN_MARKER_COOKIE)?.value, session.userId, tv);
}
async function withMarker(session, body) {
  const res = NextResponse.json(body, { headers: noStore });
  res.cookies.set(ADMIN_MARKER_COOKIE, await signAdminMarker(session.userId, await liveTv(session.userId)), adminMarkerCookieOptions());
  return res;
}
const fail = (r) => NextResponse.json({ ok: false, error: r.error, retryAfterSec: r.retryAfterSec }, { status: r.locked ? 429 : 400, headers: noStore });

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session)) return denied();
  try {
    const st = await mfaState(session.userId);
    return NextResponse.json({
      enrolled: st.enrolled, recoveryLeft: st.recoveryLeft, available: mfaAvailable(),
      enforced: adminMfaEnforced(), verified: await verifiedHere(session)
    }, { headers: noStore });
  } catch { return NextResponse.json({ error: 'Could not read that.' }, { status: 503 }); }
}

export async function POST(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return denied();
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const userId = session.userId;
  try {
    switch (b?.action) {
      case 'begin': {
        const r = await beginEnrolment(userId, session.email);
        return NextResponse.json({ ok: true, secret: r.secret, display: r.display, otpauthUrl: r.otpauthUrl }, { headers: noStore });
      }
      case 'confirm': {
        const r = await confirmEnrolment(userId, b.code);
        if (!r.ok) return fail(r);
        await audit(session, { action: 'admin_mfa_enrolled', entity: 'user', entityId: String(userId), summary: `${session.email} turned on two-factor sign-in` });
        return withMarker(session, { ok: true, recoveryCodes: r.recoveryCodes });
      }
      case 'verify': {
        const r = await verifyCode(userId, b.code);
        if (!r.ok) return fail(r);
        return withMarker(session, { ok: true, via: r.via, recoveryLeft: r.recoveryLeft });
      }
      case 'recovery_codes': {
        if (!(await verifiedHere(session))) return denied();
        const r = await regenerateRecoveryCodes(userId, b.code);
        if (!r.ok) return fail(r);
        return withMarker(session, { ok: true, recoveryCodes: r.recoveryCodes });
      }
      case 'reset_other': {
        // The way back for a colleague who lost their phone AND their recovery codes. Needs YOUR
        // second factor to be proven in this browser, cannot target yourself, and is audited.
        if (!(await verifiedHere(session))) return denied();
        const email = String(b.email || '').trim().toLowerCase();
        const { rows } = await query('SELECT id, email FROM users WHERE lower(email) = $1', [email]);
        if (!rows.length || rows[0].id === userId) return NextResponse.json({ ok: false, error: 'Choose another administrator.' }, { status: 400 });
        await clearMfa(rows[0].id); // also signs them out everywhere
        await audit(session, { action: 'admin_mfa_reset', entity: 'user', entityId: String(rows[0].id), summary: `${session.email} reset two-factor sign-in for ${email}` });
        return NextResponse.json({ ok: true }, { headers: noStore });
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'That did not work.' }, { status: 400, headers: noStore });
  }
}
