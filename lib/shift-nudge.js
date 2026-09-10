// "Are you still working?" — the evening question that keeps the hours honest.
//
// A shift that nobody clocks off does not stop at the end of the day; it runs
// until the driver next remembers. This database holds a 191-hour shift, an
// 83-hour one and five over sixteen — none of them long days, all of them a
// missed tap. Those shifts are left OUT of the day's cost (see
// SHIFT_PRICEABLE), which is the honest treatment and also means every missed
// tap is a day the owner cannot cost.
//
// So the fix is upstream: ask, once, at the hour when a shift is either
// genuinely still running or was forgotten hours ago.
import { hasDb, query } from './db';
import { sendSms } from './sms';
import { driverSmsNumber } from './drivers';
import { ensureShiftSchema } from './shifts';

// The hour, in Toronto, when the question gets asked. Late enough that a real
// evening delivery is still a real evening delivery — the board routinely has
// stops running to 21:00 — and early enough that somebody who finished at five
// is still awake to answer.
export const NUDGE_HOUR = 21;

const torontoHour = () =>
  Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', hour: 'numeric', hour12: false
  }).format(new Date()));

export async function nudgeOpenShifts({ force = false, origin } = {}) {
  if (!hasDb()) return { skipped: 'no database' };
  await ensureShiftSchema();

  // Vercel's schedules are UTC and Toronto is not, so the job is scheduled
  // either side of the boundary and decides for itself which run is the real
  // one. Getting this wrong by an hour twice a year is worse than a spare
  // invocation that returns immediately.
  const hour = torontoHour();
  if (!force && hour !== NUDGE_HOUR) return { skipped: `not the hour (Toronto ${hour}:00)` };

  const { rows } = await query(
    `SELECT s.id, s.user_id, s.started_at, u.phone,
            COALESCE(u.name, u.email) AS name
       FROM driver_shifts s
       JOIN users u ON u.id = s.user_id
      WHERE s.ended_at IS NULL
        -- Asked once per shift. A driver working a genuine late job must not
        -- get the same question every hour until they answer it.
        AND s.nudged_at IS NULL
        -- And not the moment they clock on: somebody starting an evening run
        -- at 20:50 does not need asking whether they have finished.
        AND s.started_at < now() - interval '4 hours'`
  );

  const base = origin || 'https://dispatch.rssolutions.ca';
  const out = [];
  for (const r of rows) {
    // Stamped BEFORE the send. A Twilio failure that left the stamp unset would
    // put the driver back in the queue for the next run and, on a partial
    // outage, text them repeatedly.
    await query('UPDATE driver_shifts SET nudged_at = now() WHERE id = $1', [r.id]);
    if (!r.phone) { out.push({ shift: r.id, name: r.name, sent: false, why: 'no mobile on file' }); continue; }
    const res = await sendSms({
      to: driverSmsNumber(r.phone),
      body: `Hi ${String(r.name || '').split(' ')[0] || 'there'} — still working? `
          + `If you're done for the day, clock off here: ${base}/driver\n`
          + `If you're still out, ignore this.`
    });
    out.push({ shift: r.id, name: r.name, sent: !!res.ok, why: res.ok ? null : (res.reason || res.error) });
  }
  return { hour, open: rows.length, asked: out.filter((o) => o.sent).length, results: out };
}
