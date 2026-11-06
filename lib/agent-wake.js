// Wake a minion: run the scheduled job it stands for, once, right now.
//
// It calls the job's OWN route handler with the cron secret, so a wake is exactly a
// scheduled run: same code, same heartbeat written, same logs. Nothing here is a second
// implementation of any job. Which jobs may be woken is decided in lib/agent-floor.js
// (WAKEABLE); the loaders below must stay in step with that set.
const LOADERS = {
  freightcom: () => import('../app/api/cron/freightcom/route'),
  cda: () => import('../app/api/cron/cda/route'),
  tracker: () => import('../app/api/cron/tracker/route'),
  'sync-inventory': () => import('../app/api/cron/sync-inventory/route'),
  'expire-reservations': () => import('../app/api/cron/expire-reservations/route'),
  'sale-integrity': () => import('../app/api/cron/sale-integrity/route'),
  vesta: () => import('../app/api/cron/vesta/route'),
  'backup-offsite': () => import('../app/api/cron/backup-offsite/route'),
  'sync-ads': () => import('../app/api/cron/sync-ads/route')
};

export const wakeIds = () => Object.keys(LOADERS);

export async function wakeAgent(id, origin) {
  const load = LOADERS[id];
  if (!load) return { ok: false, status: 400, error: 'That one cannot be woken from here.' };
  const mod = await load();
  const req = new Request(`${origin}/api/cron/${id}`, { method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` } });
  const res = await mod.GET(req);
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  if (res.status === 401) return { ok: false, status: 401, error: 'The cron secret is not set, so the job refused to run.' };
  return { ok: res.status < 400 && body?.ok !== false, status: res.status, error: res.status >= 400 || body?.ok === false ? String(body?.error || `HTTP ${res.status}`).slice(0, 300) : null };
}
