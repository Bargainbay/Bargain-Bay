// Records a partner's sign-ins and tells the owner the FIRST time each partner login signs in (owner, 2026-11-14: "send me an email when
// Aljo has signed in"). Only a login that belongs to a partner organisation (its main login, an admin teammate or a lead generator) is
// recorded; every other customer sign-in costs one cheap lookup and writes nothing. Best-effort: a failure here must never block a sign-in.
import { query, hasDb } from './db';
import { sendEmail, esc } from './email';
import { SERVICE_EMAIL } from './constants';
import { SITE_URL } from './site';

let ensured = null;
function ensure() {
  if (!ensured) {
    ensured = query(`CREATE TABLE IF NOT EXISTS partner_signins (
      email text PRIMARY KEY, first_at timestamptz NOT NULL DEFAULT now(), last_at timestamptz NOT NULL DEFAULT now(), n integer NOT NULL DEFAULT 1)`)
      .catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

/** Who this login is for in the partner world, or null: { org, role, name }. */
async function partnerSeat(email) {
  const { rows } = await query(
    `SELECT p.name AS org, 'admin' AS role, p.name AS name FROM referral_partners p WHERE lower(p.email) = $1 AND p.revoked_at IS NULL
     UNION ALL
     SELECT o.name, m.role, m.name FROM partner_members m JOIN referral_partners o ON lower(o.email) = lower(m.partner_email)
      WHERE lower(m.member_email) = $1 AND m.removed_at IS NULL AND o.revoked_at IS NULL
     LIMIT 1`, [email]);
  return rows[0] || null;
}

export async function recordPartnerSignIn(emailRaw) {
  try {
    if (!hasDb()) return;
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!email) return;
    const seat = await partnerSeat(email);
    if (!seat) return;
    await ensure();
    const { rows } = await query(
      `INSERT INTO partner_signins (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET last_at = now(), n = partner_signins.n + 1
       RETURNING (xmax = 0) AS first`, [email]);
    if (!rows[0]?.first) return;
    const who = seat.role === 'affiliate' ? `${seat.name || email} (lead generator, ${seat.org || 'a partner'})` : `${seat.org || email}`;
    await sendEmail({
      to: SERVICE_EMAIL,
      subject: `${seat.org || 'A partner'} has signed in for the first time`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#2e2d2b"><p><b>${esc(who)}</b> just signed in to the partner portal for the first time (${esc(email)}).</p><p><a href="${SITE_URL}/admin/partner-portfolio">Open the partner portfolio</a></p></div>`
    });
  } catch (e) {
    console.error('partner sign-in note failed', e);
  }
}

/** First and last sign-in per login, for the portfolio. Empty if the table does not exist yet. */
export async function signInsFor(emails) {
  try {
    if (!hasDb() || !emails.length) return new Map();
    const { rows } = await query(`SELECT email, first_at, last_at, n FROM partner_signins WHERE email = ANY($1::text[])`, [emails.map((e) => String(e).toLowerCase())]);
    return new Map(rows.map((r) => [r.email, { first: r.first_at, last: r.last_at, n: r.n }]));
  } catch { return new Map(); }
}
