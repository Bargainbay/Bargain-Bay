import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { startDriverCode, verifyDriverCode, touchDriverSeen, driverSmsNumber } from '../../../../lib/drivers';
import { sendSms } from '../../../../lib/sms';
import {
  createSessionToken, sessionCookieOptions, SESSION_COOKIE, DRIVER_SESSION_DAYS
} from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// A driver signing themselves in: their own mobile, then the six digits we text
// back. This is the everyday door. The texted LINK is for day one — it is one
// message that can be lost, deleted, or tapped on the wrong phone, and a driver
// standing at a van cannot wait for the office to send another.
//
// Both steps answer the same way whether or not the number belongs to a driver.
// A form that says "no such driver" is a form that tells anyone who drives here.
export async function POST(req) {
  if (!hasDb()) return NextResponse.json({ error: 'Not available right now.' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const phone = String(body.phone || '');

  try {
    if (body.step === 'verify') {
      const user = await verifyDriverCode(phone, body.code);
      if (!user) {
        return NextResponse.json({ error: 'That code is wrong or has expired. Send a new one.' }, { status: 400 });
      }
      const jwt = await createSessionToken(user, { days: DRIVER_SESSION_DAYS });
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions({ days: DRIVER_SESSION_DAYS }));
      touchDriverSeen(user.id).catch(() => {});
      return res;
    }

    const r = await startDriverCode(phone);
    if (r.sent) {
      await sendSms({
        to: driverSmsNumber(r.driver.phone || phone),
        body: `${r.code} is your RS Solutions sign-in code. It lasts ${r.minutes} minutes.`
      }).catch(() => {});
    }
    // Always the same answer — see above.
    return NextResponse.json({ ok: true, sent: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not do that.' }, { status: 400 });
  }
}
