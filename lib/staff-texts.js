// Texting staff on the owner's behalf. The Manager team, the Tech Manager and the RS
// Manager assistant all send through here, so there is ONE gate and ONE log.
//
// WHO CAN BE TEXTED: an active employee (employees.phone) or a driver (users.phone),
// looked up by name / email / number from those two tables and nowhere else. The number
// is NEVER taken from a request, a model or a customer record: a text tool that can be
// pointed at any number is a robocaller with our name on it. A customer cannot be
// resolved, so cannot be texted from here.
//
// FROM THE OPERATIONS NUMBER (TWILIO_FROM, via lib/sms.js — its default), never the
// marketing one: lib/sms.js explains why (STOP blocks a number pair). Staff already
// receive their sign-in codes and shift reminders from this number.
//
// NEVER FROM NON-PRODUCTION. lib/sms.js would redirect a staging send to STAGING_SMS_TO;
// this refuses outright, because a staff text about a real person's real clock-out must
// not be faked on a preview. Every attempt is logged in `staff_texts` (including the
// refused and failed ones) and in `audit_log`.
import { query, hasDb } from './db';
import { sendSms } from './sms';
import { isProduction } from './environment';
import { phoneKey } from './constants';
import { audit } from './audit';

const clean = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Find the staff member a name / email / number points at.
 * Returns { matches: [{ name, email, phone, phoneKey, source }] } — the caller decides what
 * to do with zero or several. Never guesses between two people.
 */
export async function findStaff(q) {
  const term = clean(q, 80);
  if (!hasDb() || term.length < 2) return { matches: [] };
  const like = `%${term.toLowerCase()}%`;
  const digits = term.replace(/\D/g, '');
  const out = new Map();
  const add = (r, source) => {
    const email = String(r.email || '').toLowerCase();
    const k = email || fold(r.name);
    const prev = out.get(k);
    const phone = r.phone || prev?.phone || null;
    out.set(k, {
      name: r.name || prev?.name || email, email, phone, phoneKey: phoneKey(phone),
      source: prev ? `${prev.source}+${source}` : source
    });
  };
  try {
    const { rows } = await query(
      `SELECT name, email, phone FROM employees
        WHERE active = true AND (lower(coalesce(name,'')) LIKE $1 OR lower(email) LIKE $1
              OR ($2 <> '' AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
        ORDER BY name LIMIT 8`, [like, digits.length >= 4 ? digits : '']);
    rows.forEach((r) => add(r, 'employee'));
  } catch { /* an unreadable table is "nobody found", never a text to the wrong person */ }
  try {
    const { rows } = await query(
      `SELECT name, email, phone FROM users
        WHERE is_driver = true AND (lower(coalesce(name,'')) LIKE $1 OR lower(email) LIKE $1
              OR ($2 <> '' AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
        ORDER BY name LIMIT 8`, [like, digits.length >= 4 ? digits : '']);
    rows.forEach((r) => add(r, 'driver'));
  } catch { /* same */ }
  return { matches: [...out.values()] };
}

/** One person by exact email: the phone from whichever record has one. */
export async function staffByEmail(email) {
  const e = clean(email, 120).toLowerCase();
  if (!e) return null;
  const { matches } = await findStaff(e);
  return matches.find((m) => m.email === e) || null;
}

async function logText(row) {
  if (!hasDb()) return null;
  try {
    const { rows } = await query(
      `INSERT INTO staff_texts (kind, nudge, subject, sent_by, to_name, to_email, to_phone, body, status, reason, sid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [row.kind, row.nudge || null, row.subject ? clean(row.subject, 120) : null, clean(row.sentBy, 120),
       row.to?.name || null, row.to?.email || null, row.to?.phoneKey || null,
       clean(row.body, 1500), row.status, row.reason ? clean(row.reason, 300) : null, row.sid || null]);
    return rows[0]?.id || null;
  } catch (e) {
    console.error('staff_texts write failed', e?.message || e);
    return null;
  }
}

/**
 * Send one text to one staff member. `to` must be an object from findStaff/staffByEmail.
 * Never throws. Returns { ok, status, reason?, id? }.
 */
export async function sendStaffText({ to, body, kind = 'manual', nudge = null, subject = null, sentBy = 'Manager (AI)', session = null } = {}) {
  const text = clean(body, 1500);
  const record = async (status, reason, sid) => {
    const id = await logText({ kind, nudge, subject, sentBy, to, body: text, status, reason, sid });
    await audit(session || { email: 'manager@bargainbay.ca', name: sentBy }, {
      action: 'staff.text', entity: 'staff_text', entityId: id,
      summary: `${status === 'sent' ? 'Texted' : `Did not text (${reason || status})`} ${to?.name || to?.email || 'staff'}: ${text.slice(0, 120)}`,
      detail: { kind, nudge, subject, status }
    });
    return { ok: status === 'sent', status, reason: reason || undefined, id };
  };
  if (!text) return { ok: false, status: 'skipped', reason: 'empty message' };
  if (!to?.phoneKey) return record('skipped', 'no phone number on file');
  if (!isProduction()) return record('skipped', 'not production');
  const r = await sendSms({ to: to.phoneKey, body: text });   // operations number: sendSms's default
  if (r.ok) return record('sent', null, r.sid);
  if (r.skipped) return record('skipped', r.reason || 'sms not configured');
  return record('failed', r.optedOut ? 'recipient texted STOP to this number' : (r.error || 'send failed'));
}

/** What went out recently, newest first. */
export async function recentTexts({ limit = 50, email = null } = {}) {
  if (!hasDb()) return [];
  try {
    const { rows } = await query(
      `SELECT id, at, kind, nudge, subject, sent_by, to_name, to_email, body, status, reason
         FROM staff_texts WHERE ($2::text IS NULL OR lower(to_email) = $2)
        ORDER BY at DESC, id DESC LIMIT $1`, [Math.min(200, Math.max(1, Number(limit) || 50)), email ? String(email).toLowerCase() : null]);
    return rows;
  } catch { return []; }
}

/** A person's nudges in the last 24h, for the cooldown rules. */
export async function nudgeHistory(email) {
  if (!hasDb() || !email) return [];
  try {
    const { rows } = await query(
      `SELECT at, nudge, subject FROM staff_texts
        WHERE lower(to_email) = $1 AND kind = 'nudge' AND status IN ('sent','failed') AND at > now() - interval '24 hours'
        ORDER BY at DESC`, [String(email).toLowerCase()]);
    return rows.map((r) => ({ at: new Date(r.at).getTime(), nudge: r.nudge, subject: r.subject }));
  } catch { return []; }
}
