import { NextResponse } from 'next/server';
import { normalizeEmail, validEmail } from '../../../lib/auth';
import { hasDb, query } from '../../../lib/db';
import { clientIp, honeypotTripped, isDisposableEmail } from '../../../lib/antifraud';
import { sendEmail, esc } from '../../../lib/email';
import { SERVICE_EMAIL, phoneKey } from '../../../lib/constants';
import { WORKSHOP, dayLabel } from '../../../lib/workshop';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const MAX_PER_IP_HOUR = 5;

// Public: someone applies for a seat. Saved first, then emailed to the office, so
// a failed send never loses the application.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }

  // A bot gets a cheerful "ok" and nothing is stored.
  if (honeypotTripped(body)) return NextResponse.json({ ok: true });

  const name = clip(body.name, 120);
  const email = normalizeEmail(body.email);
  const phone = clip(body.phone, 40);
  if (name.length < 2) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });
  if (!validEmail(email) || isDisposableEmail(email)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  if (!phoneKey(phone)) return NextResponse.json({ error: 'Please enter a phone number we can reach you on.' }, { status: 400 });
  if (!hasDb()) return NextResponse.json({ error: `Applications are temporarily unavailable. Please email ${SERVICE_EMAIL}.` }, { status: 503 });

  const row = {
    city: clip(body.city, 80),
    experience: WORKSHOP.experience.includes(body.experience) ? body.experience : null,
    apprenticeship: body.apprenticeship === true,
    about: clip(body.about, 1500),
    heard: WORKSHOP.heardFrom.includes(body.heardFrom) ? body.heardFrom : null
  };
  const ip = clientIp(req);

  try {
    if (ip !== 'unknown') {
      const r = await query(`SELECT count(*)::int AS n FROM workshop_applications WHERE ip = $1 AND created_at > now() - interval '1 hour'`, [ip]);
      if ((r.rows?.[0]?.n || 0) >= MAX_PER_IP_HOUR) {
        return NextResponse.json({ error: 'Too many applications from this connection. Please try again later or call us.' }, { status: 429 });
      }
    }
    const ins = await query(
      `INSERT INTO workshop_applications (cohort, name, email, phone, city, experience, apprenticeship, about, heard_from, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [WORKSHOP.cohort, name, email, phone, row.city || null, row.experience, row.apprenticeship, row.about || null, row.heard, ip === 'unknown' ? null : ip]
    );
    const id = ins.rows[0].id;

    // Best-effort: the row above is the record.
    await sendEmail({
      to: SERVICE_EMAIL,
      brand: 'rs_solutions',
      subject: `🛠️ Workshop application: ${name}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#2e2d2b">
        <h2>New workshop application #${id}</h2>
        <p style="color:#555">${esc(WORKSHOP.title)}, ${esc(dayLabel(WORKSHOP.start, false))} to ${esc(dayLabel(WORKSHOP.end, false))}</p>
        <table style="border-collapse:collapse;width:100%">
          ${[['Name', name], ['Email', email], ['Phone', phone], ['City', row.city], ['Experience', row.experience],
             ['Interested in apprenticeship', row.apprenticeship ? 'Yes' : 'No'], ['Heard about us', row.heard]]
            .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#777">${k}</td><td>${esc(v || '—')}</td></tr>`).join('')}
        </table>
        ${row.about ? `<p><b>About them:</b><br>${esc(row.about).replace(/\n/g, '<br>')}</p>` : ''}
        <p style="color:#777;font-size:13px">Reply to this applicant at ${esc(email)} or call ${esc(phone)}. Applications are stored in workshop_applications.</p>
      </div>`
    }).catch((e) => console.error('workshop notify failed', e.message));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('workshop apply failed', e?.message || e);
    return NextResponse.json({ error: 'Could not submit your application. Please try again.' }, { status: 500 });
  }
}
