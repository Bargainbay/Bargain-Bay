import { NextResponse } from 'next/server';
import { hasDb } from '../../../lib/db';
import { clientIp, userAgent, honeypotTripped, isDisposableEmail, isBlocked, ensureAbuseSchema } from '../../../lib/antifraud';
import { validateBooking, checkBookingRate, createBooking, BOOKING_KINDS, TIME_WINDOWS, ACCESS_OPTIONS } from '../../../lib/bookings';
import { sendEmail, esc } from '../../../lib/email';
import { dispatchDesk } from '../../../lib/constants';
import { brandFor } from '../../../lib/brands';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const row = (k, v) => (v ? `<tr><td style="padding:3px 12px 3px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>` : '');

// Public. Stores a request and tells the dispatch desk; it never creates a
// ticket or a job by itself — a person decides that (see lib/bookings.js).
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!hasDb()) return NextResponse.json({ error: 'Booking is briefly unavailable — please call or email us.' }, { status: 503 });

  const ip = clientIp(req);
  await ensureAbuseSchema().catch((e) => console.error('abuse schema', e.message));
  // A bot gets the answer a person would, and nothing is stored.
  if (honeypotTripped(body)) return NextResponse.json({ ok: true, ref: 'BK-0000' });

  const v = validateBooking(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const b = v.value;

  if (await isBlocked({ email: b.email, ip, phone: b.phone })) {
    return NextResponse.json({ error: 'We are unable to accept this request online. Please call us.' }, { status: 403 });
  }
  if (isDisposableEmail(b.email)) {
    return NextResponse.json({ error: 'Please use a permanent email address so we can reach you.' }, { status: 400 });
  }
  if (!(await checkBookingRate({ ip, email: b.email })).ok) {
    return NextResponse.json({ error: 'You have sent several requests already — we will be in touch shortly.' }, { status: 429 });
  }

  let r;
  try {
    r = await createBooking(b, { ip, userAgent: userAgent(req) });
  } catch (e) {
    console.error('booking failed', e?.message || e);
    return NextResponse.json({ error: 'Could not send your request — please try again or call us.' }, { status: 500 });
  }

  const brand = brandFor('rs_solutions');
  const d = b.details;
  const when = b.preferred_date ? `${b.preferred_date}, ${TIME_WINDOWS[b.preferred_window] || 'any time'}` : '';
  const detailRows = b.kind === 'service'
    ? row('Appliance', [d.appliance, d.brand, d.model].filter(Boolean).join(' · ')) + row('Problem', d.issue) +
      row('Urgent', d.urgent ? 'Yes' : '') + row('Address', [b.address, b.city, b.postal].filter(Boolean).join(', '))
    : row('Moving', d.size) + row('From', [b.address, b.city, b.postal].filter(Boolean).join(', ')) + row('From access', ACCESS_OPTIONS[d.fromAccess]) +
      row('To', [d.toAddress, d.toCity, d.toPostal].filter(Boolean).join(', ')) + row('To access', ACCESS_OPTIONS[d.toAccess]) +
      row('Bulky / special', d.bulky) + row('Packing help', d.packing ? 'Yes' : '') + row('Date flexible', d.flexibleDate ? 'Yes' : '');
  const wrap = (inner) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">${inner}</div>`;

  // Awaited: a serverless instance is frozen once the response goes out, so a
  // fire-and-forget send is a coin flip. A mail problem never fails the request.
  await sendEmail({
    to: dispatchDesk(), brand: 'rs_solutions',
    subject: `${r.kind === 'move' ? '🚚' : '🔧'} New ${BOOKING_KINDS[r.kind].toLowerCase()} request ${r.ref} — ${b.name}`,
    html: wrap(`<h2>${esc(BOOKING_KINDS[r.kind])} request ${esc(r.ref)}</h2>
      <table style="border-collapse:collapse">${row('Name', b.name)}${row('Phone', b.phone)}${row('Email', b.email)}${row('Preferred', when)}${detailRows}${row('Note', b.note)}</table>
      <p><a href="${brand.url()}/admin/bookings">Open booking requests →</a></p>`)
  }).catch((e) => console.error('booking desk email failed', e.message));

  await sendEmail({
    to: b.email, brand: 'rs_solutions',
    subject: `We got your ${BOOKING_KINDS[r.kind].toLowerCase()} request (${r.ref})`,
    html: wrap(`<p>Hi ${esc(b.name.split(' ')[0])},</p>
      <p>Thanks — we received your ${esc(BOOKING_KINDS[r.kind].toLowerCase())} request. This is a request, not a confirmed appointment: someone from our dispatch team will contact you ${r.kind === 'move' ? 'with your quote' : 'to confirm a time'}.</p>
      <table style="border-collapse:collapse">${row('Reference', r.ref)}${row('Preferred', when)}${detailRows}</table>
      <p>Questions? Reply to this email or write ${esc(brand.contactEmail)}.</p><p>${esc(brand.name)}</p>`)
  }).catch((e) => console.error('booking confirmation failed', e.message));

  return NextResponse.json({ ok: true, ref: r.ref });
}
