import { NextResponse } from 'next/server';
import { normalizeEmail, validEmail } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { createQuoteRequest } from '../../../lib/quotes';
import { notifyOwner, esc } from '../../../lib/email';
import { money } from '../../../lib/constants';
import { SITE_URL } from '../../../lib/site';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Public: a customer assembled a bundle on /bundle and wants a package quote.
// We create an unpriced quote request (prices looked up server-side) that lands
// in /admin/quotes for the owner to price and send. No customer email yet.
export async function POST(req) {
  if (!hasDb()) return NextResponse.json({ error: 'Quotes are temporarily unavailable — please email us.' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid email so we can send your quote.' }, { status: 400 });
  const skus = Array.isArray(body.skus) ? body.skus : [];
  if (!skus.length) return NextResponse.json({ error: 'Add at least one appliance to your bundle.' }, { status: 400 });

  try {
    const r = await createQuoteRequest({ name: body.name, email, phone: body.phone, skus, note: body.note });
    const rows = r.items
      .map((it) => `<tr><td style="padding:4px 0;border-bottom:1px solid #eee">${esc(it.description)}</td><td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right">${money(it.amount)}</td></tr>`)
      .join('');
    notifyOwner(
      `📝 New quote request ${r.number} — ${r.name || email}`,
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
        <h2 style="text-transform:uppercase;letter-spacing:.05em">New quote request ${esc(r.number)}</h2>
        <p><b>${esc(r.name || '(no name)')}</b> (${esc(email)}${body.phone ? ', ' + esc(String(body.phone).slice(0, 40)) : ''}) assembled a bundle on the site.</p>
        ${body.note ? `<p style="color:#555">"${esc(String(body.note).slice(0, 500))}"</p>` : ''}
        <table style="width:100%;border-collapse:collapse;margin:12px 0">${rows}
          <tr><td style="padding:6px 0;text-align:right;font-weight:bold">List subtotal</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(r.total)}</td></tr>
        </table>
        <p><a href="${SITE_URL}/admin/quotes?from=${r.id}" style="background:#3A3937;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Price &amp; send this quote →</a></p>
      </div>`
    ).catch((e) => console.error('owner quote-request notify failed', e.message));
    return NextResponse.json({ ok: true, number: r.number });
  } catch (e) {
    console.error('quote request failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not submit your request — please try again.' }, { status: 500 });
  }
}
