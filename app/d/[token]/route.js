import { NextResponse } from 'next/server';
import {
  createSessionToken, sessionCookieOptions, SESSION_COOKIE, DRIVER_SESSION_DAYS
} from '../../../lib/auth';
import { peekDriverSignInLink, redeemDriverSignInLink, touchDriverSeen } from '../../../lib/drivers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// A driver's whole sign-in: they tap the link in the text and land on their
// stops, signed in on that phone. No password, no signup form, no app store.
//
// It takes TWO steps, and that is the entire point. The link is single-use, and
// a GET used to spend it — so the preview card iMessage/WhatsApp builds by
// fetching the URL was redeeming the token before the driver's thumb ever got
// there. The session went to a preview crawler and the driver got "that link has
// already been used". Crawlers do not POST. So GET only ASKS, and the button
// posts.
const page = (body) => new NextResponse(
  `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>RS Solutions — driver sign-in</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center;
         background:#F5F1EC; color:#231F1C; font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  .card { width:min(420px,92vw); background:#fff; border:1px solid #DDD3C9; border-radius:14px; padding:26px 22px; text-align:center; }
  h1 { font-size:21px; margin:0 0 6px; }
  p { margin:0 0 18px; color:#6B625B; font-size:15px; }
  button { width:100%; min-height:58px; font-size:18px; font-weight:700; color:#fff; background:#231F1C;
           border:none; border-radius:12px; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  button:active { transform:scale(.99); }
  .hint { margin:16px 0 0; font-size:13px; color:#8A817A; }
</style></head><body><div class="card">${body}</div></body></html>`,
  { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } }
);

const expired = () => page(
  `<h1>That link has expired</h1>
   <p>Links last 14 days and can only be used once. Ask the office to text you a new one.</p>`
);

export async function GET(req, { params }) {
  const { token } = await params;
  const driver = await peekDriverSignInLink(token).catch(() => null);
  if (!driver) return expired();
  const name = String(driver.name || 'driver').replace(/[<>&]/g, '');
  return page(
    `<h1>Hi ${name}</h1>
     <p>Tap below to sign this phone in. You will stay signed in — no password, ever.</p>
     <form method="POST"><button type="submit">Sign in on this phone</button></form>
     <p class="hint">It will show you how to keep it on your home screen.</p>`
  );
}

export async function POST(req, { params }) {
  const { token } = await params;
  const user = await redeemDriverSignInLink(token).catch(() => null);
  if (!user) return expired();
  const jwt = await createSessionToken(user, { days: DRIVER_SESSION_DAYS });
  // 303, not the default 307: a 307 replays the POST at /driver and the driver
  // gets a 405 instead of their stops.
  const res = NextResponse.redirect(new URL('/driver?welcome=1', req.url), 303);
  res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions({ days: DRIVER_SESSION_DAYS }));
  touchDriverSeen(user.id).catch(() => {});
  return res;
}
