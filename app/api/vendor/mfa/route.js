// A vendor user's own second factor: status, set it up, confirm the first code, check a code at
// sign-in (also the "fresh code" step-up), and replace the recovery codes.
//
// This is the one place a vendor user is reachable BEFORE passing the second factor (they have
// to be able to type the code somewhere), so it uses requireVendorIdentity — signed in and
// acting for a vendor, nothing more — and every other vendor route does not. It only ever acts
// on the SESSION's own user; there is no user id in the request.
import { NextResponse } from 'next/server';
import { requireVendorIdentity, mfaContext, checkVendor } from '../../../../lib/vendor-session';
import { beginEnrolment, confirmEnrolment, verifyCode, regenerateRecoveryCodes } from '../../../../lib/vendor-mfa';
import { signMarker, markerCookieOptions, MARKER_COOKIE } from '../../../../lib/vendor-mfa-marker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const noStore = { 'Cache-Control': 'no-store' };

const publicState = (m) => ({
  enrolled: m.enrolled, pendingEnrolment: m.pendingEnrolment, recoveryLeft: m.recoveryLeft, required: m.required,
  available: m.available, verified: m.verified, mustEnrol: m.mustEnrol, graceUntil: m.graceUntil, daysLeft: m.daysLeft
});

export async function GET() {
  const id = await requireVendorIdentity();
  if (!id) return denied();
  try {
    return NextResponse.json(publicState(await mfaContext(id.session, id.vendor)), { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 503 });
  }
}

async function withMarker(body) {
  const res = NextResponse.json(body, { headers: noStore });
  return res;
}

export async function POST(req) {
  const id = await requireVendorIdentity();
  if (!id) return denied();
  const userId = id.session.userId;
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    switch (b?.action) {
      case 'begin': {
        const r = await beginEnrolment(userId, id.session.email);
        return NextResponse.json({ ok: true, secret: r.secret, display: r.display, otpauthUrl: r.otpauthUrl }, { headers: noStore });
      }
      case 'confirm': {
        const r = await confirmEnrolment(userId, b.code);
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error, retryAfterSec: r.retryAfterSec }, { status: r.locked ? 429 : 400, headers: noStore });
        // They just proved they hold the authenticator, so this browser is verified from now.
        const res = await withMarker({ ok: true, recoveryCodes: r.recoveryCodes });
        res.cookies.set(MARKER_COOKIE, await signMarker(userId), markerCookieOptions());
        return res;
      }
      case 'verify': {
        const r = await verifyCode(userId, b.code);
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error, retryAfterSec: r.retryAfterSec }, { status: r.locked ? 429 : 400, headers: noStore });
        const res = await withMarker({ ok: true, via: r.via, recoveryLeft: r.recoveryLeft });
        res.cookies.set(MARKER_COOKIE, await signMarker(userId), markerCookieOptions());
        return res;
      }
      case 'recovery_codes': {
        // Replacing the recovery codes needs a verified browser AND a current authenticator code.
        const gate = await checkVendor('portal.view');
        if (!gate.ok) return denied();
        const r = await regenerateRecoveryCodes(userId, b.code);
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error, retryAfterSec: r.retryAfterSec }, { status: r.locked ? 429 : 400, headers: noStore });
        const res = await withMarker({ ok: true, recoveryCodes: r.recoveryCodes });
        res.cookies.set(MARKER_COOKIE, await signMarker(userId), markerCookieOptions());
        return res;
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
