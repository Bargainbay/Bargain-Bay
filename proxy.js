import { NextResponse } from 'next/server';

// dispatch.rssolutions.ca is the RS Solutions address. It points at this same
// app, so without this it would happily serve the Bargain Bay storefront on an
// RS Solutions hostname — which is exactly the confusion the separate domain
// exists to avoid. Here it does one job: dispatch.
//
// bargainbay.ca is untouched. Anything that isn't an RS host returns
// immediately, so this costs a header comparison on the storefront.
const RS_HOSTS = new Set(
  (process.env.DISPATCH_HOSTS || 'dispatch.rssolutions.ca')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
);

// What the RS host is allowed to serve. Everything else lands on the board.
//   /admin, /driver  — the people using it
//   /d/<token>       — the link texted to a driver to sign their phone in.
//                      It is sent on the RS host, so redirecting it here would
//                      bounce every driver to a board they can't see.
//   /api             — the board's own calls; blocking these breaks the page
//   /invoice         — where an RS client lands from their invoice email
//   /login, /logout  — you can't reach /admin without being able to sign in
const ALLOWED = [
  /^\/admin(\/|$)/,
  /^\/driver(\/|$)/,
  /^\/d\/[^/]+$/,
  /^\/api(\/|$)/,
  /^\/invoice(\/|$)/,
  /^\/login$/,
  /^\/logout$/
];

export function proxy(req) {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  if (!RS_HOSTS.has(host)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (ALLOWED.some((re) => re.test(pathname))) return NextResponse.next();

  // Redirect rather than rewrite, so the address bar tells the truth about
  // where you are — a driver who bookmarks it gets the real URL.
  const url = req.nextUrl.clone();
  url.pathname = '/admin/dispatch';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next's internals and anything with a file extension; those are assets
  // the page needs, and redirecting them would break the board's own styling.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)']
};
