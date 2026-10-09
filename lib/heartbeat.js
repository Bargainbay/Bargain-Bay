// A scheduled route's pulse. Vercel will tell you a cron is REGISTERED but not
// whether it ran or what it answered, which is how the CDA watcher read nothing
// for months with nobody knowing. Each cron route wraps its handler in
// `withHeartbeat`, and the daily health email (lib/health.js) reads the result.
//
// Never throws and never delays a response by more than one small write: the job
// itself is what matters, and a failed heartbeat must not fail it.
import { query, hasDb } from './db';

export async function recordHeartbeat(name, status, error = null) {
  if (!hasDb()) return;
  const ok = status > 0 && status < 400;
  try {
    await query(
      `INSERT INTO cron_heartbeats (name, last_run_at, last_ok_at, last_status, last_error, runs)
            VALUES ($1, now(), CASE WHEN $2 THEN now() END, $3, $4, 1)
       ON CONFLICT (name) DO UPDATE SET
            last_run_at = now(),
            last_ok_at  = CASE WHEN $2 THEN now() ELSE cron_heartbeats.last_ok_at END,
            last_status = $3,
            last_error  = $4,
            runs        = cron_heartbeats.runs + 1`,
      [name, ok, status, ok ? null : String(error || '').slice(0, 300) || null]
    );
  } catch { /* table not migrated yet, or a blip: the job still ran */ }
}

// A 401 is somebody poking the endpoint without the secret, not a run.
export function withHeartbeat(name, handler) {
  return async (req) => {
    let res;
    try {
      res = await handler(req);
    } catch (e) {
      await recordHeartbeat(name, 500, e?.message || e);
      throw e;
    }
    const status = res?.status || 200;
    if (status !== 401) {
      let err = null;
      if (status >= 400) { try { err = (await res.clone().json())?.error; } catch { /* not json */ } }
      await recordHeartbeat(name, status, err);
    }
    return res;
  };
}
