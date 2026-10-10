// One person, one clock. And the evening question that keeps both honest.
//
// Two clocks exist -- the staff clock (/clock, and RS Ops) and the driver app's
// shift -- and a person who works the warehouse some days and drives others can
// be on either. Both feed the daily P&L, so being on both at once counts the
// same hours twice. The rule: you cannot start one while the other is open, and
// the refusal says which one to close.
//
// The two are linked by EMAIL, then by NAME. The driver account is often a
// synthetic address (driver-<digits>@drivers...), so email alone misses most of
// them; a name match is accepted only when it picks exactly ONE person, because
// wrongly blocking someone from clocking in is worse than not blocking.
import { query, hasDb } from './db';
import { torontoTime, phoneKey } from './constants';

const FOLD = (col) => `regexp_replace(lower(coalesce(${col}, '')), '[^a-z0-9]', '', 'g')`;
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const ASK_EVERY_MIN = 60;
export const ALERT_AFTER_MIN = 120;
export const EVENING_HOUR = 20;
export const MORNING_HOUR = 6;

// ── One clock at a time ─────────────────────────────────────────────────────

async function driverUserFor(emp) {
  const { rows } = await query(
    `SELECT id FROM users WHERE is_driver = true
        AND (lower(email) = lower($1) OR ($2 <> '' AND ${FOLD('name')} = $2))`,
    [emp.email || '', fold(emp.name)]);
  const ids = [...new Set(rows.map((r) => r.id))];
  return ids.length === 1 ? ids[0] : null;
}

/** Throws if this staff employee has a driver shift open. Fails OPEN on any read error. */
export async function assertNotOnDriverClock(emp) {
  if (!hasDb()) return;
  let open = null;
  try {
    const uid = await driverUserFor(emp);
    if (uid) {
      open = (await query('SELECT started_at FROM driver_shifts WHERE user_id = $1 AND ended_at IS NULL LIMIT 1', [uid])).rows[0];
    }
  } catch { return; }
  if (open) {
    throw new Error(`You're still clocked in on the driver app (since ${torontoTime(open.started_at)}). End your shift there first, then clock in here.`);
  }
}

/** Throws if the driver also has a staff shift open. Fails OPEN on any read error. */
export async function assertNotOnStaffClock(userId) {
  if (!hasDb()) return;
  let open = null;
  try {
    const u = (await query('SELECT email, name FROM users WHERE id = $1', [Number(userId)])).rows[0];
    if (!u) return;
    const { rows: emps } = await query(
      `SELECT id FROM employees WHERE active = true
          AND (lower(email) = lower($1) OR ($2 <> '' AND ${FOLD('name')} = $2))`,
      [u.email || '', fold(u.name)]);
    const ids = [...new Set(emps.map((r) => r.id))];
    if (ids.length === 1) {
      open = (await query('SELECT started_at FROM staff_shifts WHERE employee_id = $1 AND ended_at IS NULL LIMIT 1', [ids[0]])).rows[0];
    }
  } catch { return; }
  if (open) {
    throw new Error(`You're still clocked in on the staff clock (RS Ops or the clock page, since ${torontoTime(open.started_at)}). Clock out there first, then start your driver shift.`);
  }
}

// ── "Are you still working?" ────────────────────────────────────────────────

/**
 * Pure. What should happen for one open shift right now?
 *   pending        the unanswered question, { askedAt, alertedAt } (ms) or null
 *   lastAnsweredAt ms of their most recent answer, or null
 * Returns 'ask', 'alert' or null.
 */
export function decide({ now, startedAt, eveningStart, inWindow, pending, lastAnsweredAt }) {
  if (pending) {
    // The silence is the point. It is judged whether or not it is still night:
    // a question asked at 2am and not answered is still a person to ring at 4.
    return !pending.alertedAt && now - pending.askedAt >= ALERT_AFTER_MIN * 60000 ? 'alert' : null;
  }
  if (!inWindow) return null;
  // First question: 8pm, or an hour after clocking in if they started later --
  // nobody needs asking whether they are working the minute they arrive.
  const base = lastAnsweredAt
    ? lastAnsweredAt + ASK_EVERY_MIN * 60000
    : (startedAt < eveningStart ? eveningStart : startedAt + ASK_EVERY_MIN * 60000);
  return now >= base ? 'ask' : null;
}

export async function openQuestion(kind, shiftId) {
  if (!hasDb() || !shiftId) return null;
  try {
    const { rows } = await query(
      'SELECT id, asked_at FROM shift_checkins WHERE kind = $1 AND shift_id = $2 AND answered_at IS NULL', [kind, shiftId]);
    return rows[0] ? { id: rows[0].id, askedAt: rows[0].asked_at } : null;
  } catch { return null; }
}

/** Record yes/no. Returns false when there was nothing to answer. */
export async function answerQuestion(kind, shiftId, answer) {
  if (answer !== 'yes' && answer !== 'no') throw new Error('Answer yes or no.');
  const { rows } = await query(
    `UPDATE shift_checkins SET answered_at = now(), answer = $3
      WHERE kind = $1 AND shift_id = $2 AND answered_at IS NULL RETURNING id`, [kind, shiftId, answer]);
  return rows.length > 0;
}

// Tell the owner. RS Ops holds the WhatsApp sender, so it is asked to send --
// no Twilio secrets are copied into this app.
async function pingOwner(text) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return { ok: false, error: 'RSOPS_INTAKE_KEY not set' };
  const base = (process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/alert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rsops-key': key },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10000)
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok !== false, error: body.error };
  } catch (e) { return { ok: false, error: e?.message || 'unreachable' }; }
}

// WhatsApp to one person, through RS Ops (it holds the sender and the template).
async function whatsappTo(phone, text) {
  const to = phoneKey(phone);
  if (!to) return { ok: false, error: 'no number' };
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return { ok: false, error: 'RSOPS_INTAKE_KEY not set' };
  const base = (process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/alert`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-rsops-key': key },
      body: JSON.stringify({ text, to }), signal: AbortSignal.timeout(10000)
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok !== false, error: body.error };
  } catch (e) { return { ok: false, error: e?.message || 'unreachable' }; }
}

const askText = (s) => {
  const first = String(s.name || '').split(' ')[0] || 'there';
  const where = s.kind === 'driver' ? 'the driver app (dispatch.rssolutions.ca/driver)'
    : s.company === 'bargain_bay' ? 'bargainbay.ca/clock' : 'RS Ops';
  return `Hi ${first} — are you still working? Open ${where} and tap Yes or No.`;
};

const KIND_LABEL = { staff: 'the staff clock', driver: 'the driver app' };

async function openShifts() {
  const staff = await query(
    // The number: the one typed on the employee, else the one on their login,
    // else the one on a driver account with the same name (only if exactly one).
    `SELECT s.id, s.started_at, COALESCE(e.name, e.email) AS name, e.company,
            COALESCE(NULLIF(e.phone, ''),
              (SELECT u.phone FROM users u WHERE lower(u.email) = lower(e.email) AND COALESCE(u.phone, '') <> '' LIMIT 1),
              (SELECT MAX(u.phone) FROM users u WHERE u.is_driver AND COALESCE(u.phone, '') <> ''
                  AND ${FOLD('u.name')} = ${FOLD('e.name')} HAVING COUNT(*) = 1)) AS phone
       FROM staff_shifts s JOIN employees e ON e.id = s.employee_id WHERE s.ended_at IS NULL`);
  let driver = { rows: [] };
  try {
    driver = await query(
      `SELECT s.id, s.started_at, COALESCE(u.name, u.email) AS name, u.phone
         FROM driver_shifts s JOIN users u ON u.id = s.user_id WHERE s.ended_at IS NULL`);
  } catch { /* no driver_shifts table yet */ }
  return [...staff.rows.map((r) => ({ ...r, kind: 'staff' })), ...driver.rows.map((r) => ({ ...r, kind: 'driver' }))];
}

/** The scheduled pass. Safe to run as often as you like. */
export async function runPresenceCheck({ now = Date.now(), force = false } = {}) {
  if (!hasDb()) return { skipped: 'no database' };
  const t = (await query(
    `SELECT extract(hour from now() AT TIME ZONE 'America/Toronto')::int AS h,
            (date_trunc('day', now() AT TIME ZONE 'America/Toronto')
               + interval '${EVENING_HOUR} hours'
               - CASE WHEN extract(hour from now() AT TIME ZONE 'America/Toronto') < ${MORNING_HOUR}
                      THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'America/Toronto' AS evening`)).rows[0];
  const inWindow = force || t.h >= EVENING_HOUR || t.h < MORNING_HOUR;
  // `force` (testing, or a manual run) behaves as if 8pm has already passed.
  const eveningStart = force ? now - 1 : new Date(t.evening).getTime();

  const shifts = await openShifts();
  const out = { asked: [], alerted: [], failed: [], open: shifts.length };
  for (const s of shifts) {
    const { rows: cs } = await query(
      'SELECT * FROM shift_checkins WHERE kind = $1 AND shift_id = $2 ORDER BY asked_at DESC', [s.kind, s.id]);
    const open = cs.find((c) => !c.answered_at);
    const lastAns = cs.find((c) => c.answered_at);
    const action = decide({
      now, startedAt: force ? 0 : new Date(s.started_at).getTime(), eveningStart, inWindow,
      pending: open ? { askedAt: new Date(open.asked_at).getTime(), alertedAt: open.alerted_at } : null,
      lastAnsweredAt: lastAns ? new Date(lastAns.answered_at).getTime() : null
    });
    if (action === 'ask') {
      // Recorded BEFORE any text goes out: a send that fails must not put the
      // person back in the queue to be texted again ten minutes later.
      const ins = await query(
        `INSERT INTO shift_checkins (kind, shift_id) VALUES ($1, $2)
           ON CONFLICT (kind, shift_id) WHERE answered_at IS NULL DO NOTHING RETURNING id`, [s.kind, s.id]);
      if (!ins.rows.length) continue;
      out.asked.push(s.name);
      // WhatsApp first -- everyone has it. A driver whose WhatsApp fails still gets
      // the text. The in-app question is there either way; this only wakes them.
      if (s.phone) {
        const w = await whatsappTo(s.phone, askText(s));
        if (!w.ok) {
          out.failed.push({ name: s.name, error: `WhatsApp: ${w.error}` });
          if (s.kind === 'driver') {
            try {
              const { sendSms } = await import('./sms');
              const { driverSmsNumber } = await import('./drivers');
              await sendSms({ to: driverSmsNumber(s.phone), body: askText(s) });
            } catch { /* fall through */ }
          }
        }
      } else {
        out.failed.push({ name: s.name, error: 'no phone number to reach them on' });
      }
    } else if (action === 'alert') {
      const text = `⚠️ ${s.name} hasn't answered "still working?" on ${KIND_LABEL[s.kind]} since ${torontoTime(open.asked_at)} `
        + `(clocked in since ${torontoTime(s.started_at)}). Call them.`;
      const r = await pingOwner(text);
      if (r.ok) {
        await query('UPDATE shift_checkins SET alerted_at = now() WHERE id = $1', [open.id]);
        out.alerted.push(s.name);
      } else {
        // Left unstamped so the next run tries again -- the ping is the whole point.
        console.error('presence alert not delivered:', r.error);
        out.failed.push({ name: s.name, error: r.error });
      }
    }
  }
  return out;
}
