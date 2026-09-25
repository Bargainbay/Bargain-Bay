// Shared auth gate for the /api/cron/* endpoints. Vercel Cron automatically sends
// `Authorization: Bearer <CRON_SECRET>` once CRON_SECRET is set on the project, so
// a configured secret lets the scheduled jobs through while blocking the public.
//
// Fail CLOSED in production: if no secret is configured, refuse — never run a
// state-changing cron job for an unauthenticated caller in prod. Outside
// production the unset case is allowed so local/dev can exercise the endpoints.
//
// HEADER ONLY. This used to also accept `?key=<CRON_SECRET>` as a convenience
// for triggering a job by hand. A secret in a query string is a secret written
// into somewhere it cannot be taken back out of: Vercel's request logs, any
// proxy or CDN log in front of them, the browser history of whoever pasted it,
// and the Referer header of anything the response links to. A header appears in
// none of those. To run one by hand:
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//        https://bargainbay.ca/api/cron/sync-inventory
//
// Comparison is timing-safe. The window on a string compare is small and
// remote, but this is the only thing standing between the public and a job that
// writes to the tracker, so it costs nothing to close it properly.
import crypto from 'crypto';

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || !x.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch { return false; }
}

export function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return sameSecret(bearer, secret);
  }
  return process.env.NODE_ENV !== 'production';
}
