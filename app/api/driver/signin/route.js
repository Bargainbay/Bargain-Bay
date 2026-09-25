import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { startDriverCode, verifyDriverCode, touchDriverSeen, driverSmsNumber } from '../../../../lib/drivers';
import { sendSms } from '../../../../lib/sms';
import { captureMessage } from '../../../../lib/observe';
import { notifyOwner, esc } from '../../../../lib/email';
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
      // The native app has no cookie jar we can rely on, so it asks for the
      // token itself and sends it back as `Authorization: Bearer`. Same signed
      // token, same expiry, same token_version revocation — signing out on the
      // web still signs the app out. Only ever returned when the caller asks
      // (`client: 'app'`), so the browser flow is byte-identical to before.
      const res = NextResponse.json(
        body.client === 'app'
          ? { ok: true, token: jwt, name: user.name || null, days: DRIVER_SESSION_DAYS }
          : { ok: true }
      );
      res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions({ days: DRIVER_SESSION_DAYS }));
      touchDriverSeen(user.id).catch(() => {});
      return res;
    }

    const r = await startDriverCode(phone);
    if (r.sent) {
      const to = driverSmsNumber(r.driver.phone || phone);
      const sms = await sendSms({
        to,
        body: `${r.code} is your RS Solutions sign-in code. It lasts ${r.minutes} minutes.`
      }).catch(() => null);

      // A DRIVER WHO CANNOT RECEIVE A CODE IS LOCKED OUT AND DOES NOT KNOW WHY.
      // Twilio blocks a number pair at carrier level once somebody texts STOP to
      // it — historically possible here because marketing and operations shared
      // one number — and from the app's side the send simply fails. The driver
      // sees "we've texted you a code", nothing arrives, and the first anyone
      // hears is a driver at a van at 7am. The reply to them is deliberately
      // unchanged (it must not reveal whether a number is one of ours), so the
      // office is told instead.
      if (sms && sms.optedOut) {
        await captureMessage('Driver sign-in code blocked — recipient has opted out of this Twilio number', {
          tags: { where: 'driver-signin' },
          extra: { to, driverId: r.driver.id || null },
          fingerprint: `driver-signin-optout:${to}`
        }).catch(() => {});
        notifyOwner(
          'A driver cannot receive their sign-in code',
          `<p>Twilio refused the sign-in code for <b>${esc(to)}</b> because that number has
             texted STOP to it at some point (error 21610).</p>
           <p><b>That driver is locked out of the app</b> and has no way to tell why — their
             screen says the code was sent.</p>
           <p>Fix: Twilio Console &rarr; Messaging &rarr; Opt-out management, remove that number
             from the opt-out list for the operations number. Then ask them to try again.</p>`
        ).catch(() => {});
      }
    }
    // Always the same answer — see above.
    return NextResponse.json({ ok: true, sent: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not do that.' }, { status: 400 });
  }
}
