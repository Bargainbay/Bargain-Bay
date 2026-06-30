// Shared auth gate for the /api/cron/* endpoints. Vercel Cron automatically sends
// `Authorization: Bearer <CRON_SECRET>` once CRON_SECRET is set on the project, so
// a configured secret lets the scheduled jobs through while blocking the public.
//
// Fail CLOSED in production: if no secret is configured, refuse — never run a
// state-changing cron job for an unauthenticated caller in prod. Outside
// production the unset case is allowed so local/dev can exercise the endpoints.
export function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    const key = new URL(req.url).searchParams.get('key') || '';
    return auth === `Bearer ${secret}` || key === secret;
  }
  return process.env.NODE_ENV !== 'production';
}
