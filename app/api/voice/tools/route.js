// Webhook the phone sales agent ("Bay on the phone") calls mid-conversation.
// One POST endpoint, an `action` per tool, so the voice platform only needs a
// single URL. Auth: shared secret in x-voice-secret (VOICE_AGENT_SECRET).
//
// Live transfer policy lives here, not in the prompt, so the agent can never
// promise a human outside staffed hours: TRANSFER_HOURS (10:00–20:00 Toronto,
// 7 days) gates `request_human`.
import { NextResponse } from 'next/server';
import { getAvailable } from '../../../../lib/inventory';
import { decorate } from '../../../../lib/pricing';
import { availableSlots } from '../../../../lib/pickup';
import { upsertCustomer } from '../../../../lib/customers';
import { createQuoteRequest } from '../../../../lib/quotes';
import { notifyOwner } from '../../../../lib/email';
import { PICKUP_ADDRESS, BUSINESS_HOURS, SALES_EMAIL, DELIVERY_FEE, money } from '../../../../lib/constants';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OPEN_MIN = 10 * 60;   // 10:00
const CLOSE_MIN = 20 * 60;  // 20:00 — staffed 7 days

function torontoNowMinutes() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return g('hour') * 60 + g('minute');
}

export function isStaffedNow() {
  const m = torontoNowMinutes();
  return m >= OPEN_MIN && m < CLOSE_MIN;
}

function authorized(req) {
  const secret = process.env.VOICE_AGENT_SECRET;
  if (!secret) return true; // unset = open (dev); set it in production
  return req.headers.get('x-voice-secret') === secret;
}

// Compact, speech-friendly unit line — no HTML, no SKU soup.
function speakUnit(u) {
  const bits = [u.make, u.model, u.category].filter(Boolean).join(' ');
  const cond = u.condition ? `, ${u.condition}` : '';
  return `${bits}${cond} — ${money(u.clientPrice ?? u.price)}${u.compareAt ? ` (retail ${money(u.compareAt)})` : ''}. Reference ${u.id}.`;
}

export async function POST(req) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action || '').trim();

  try {
    switch (action) {
      // ---- what's in stock -------------------------------------------------
      case 'search_inventory': {
        const q = String(body.query || '').toLowerCase().trim();
        const category = String(body.category || '').toLowerCase().trim();
        const maxPrice = Number(body.max_price) || 0;
        let units = await decorate(await getAvailable(), null);
        if (category) units = units.filter((u) => String(u.category || '').toLowerCase().includes(category));
        if (q) {
          const words = q.split(/\s+/).filter(Boolean);
          units = units.filter((u) => {
            const hay = `${u.make} ${u.model} ${u.title} ${u.category}`.toLowerCase();
            return words.every((w) => hay.includes(w));
          });
        }
        if (maxPrice) units = units.filter((u) => Number(u.clientPrice ?? u.price) <= maxPrice);
        const top = units.sort((a, b) => (a.clientPrice ?? a.price) - (b.clientPrice ?? b.price)).slice(0, 5);
        return NextResponse.json({
          count: units.length,
          showing: top.length,
          units: top.map(speakUnit),
          note: units.length > top.length ? `${units.length - top.length} more available — narrow by budget, size or brand.` : ''
        });
      }

      // ---- is this specific one still here? --------------------------------
      case 'check_unit': {
        const sku = String(body.sku || '').trim().toUpperCase();
        const units = await decorate(await getAvailable(), null);
        const hit = units.find((u) => String(u.id).toUpperCase() === sku);
        return NextResponse.json(hit
          ? { available: true, detail: speakUnit(hit) }
          : { available: false, detail: 'That one is no longer available — every unit is one of a kind.' });
      }

      // ---- store facts ------------------------------------------------------
      case 'store_info': {
        return NextResponse.json({
          address: PICKUP_ADDRESS,
          hours: BUSINESS_HOURS,
          pickup: 'Free pickup at the Pickering warehouse, by appointment.',
          delivery: `Flat ${money(DELIVERY_FEE)} local delivery; freight quoted farther out.`,
          warranty: 'Every unit is tested, working, and carries a one-year warranty.',
          email: SALES_EMAIL,
          staffed_now: isStaffedNow()
        });
      }

      // ---- next pickup windows ---------------------------------------------
      case 'pickup_slots': {
        if (!hasDb()) return NextResponse.json({ slots: [], note: 'Scheduling is offline — take the caller\'s details instead.' });
        const slots = await availableSlots();
        return NextResponse.json({
          slots: slots.slice(0, 6).map((s) => s.label || s),
          note: 'Offer one of these; the customer confirms by email after the order.'
        });
      }

      // ---- capture the lead (this is the point of the call) -----------------
      case 'capture_lead': {
        const name = String(body.name || '').trim();
        const phone = String(body.phone || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const interest = String(body.interest || '').trim();
        const skus = Array.isArray(body.skus) ? body.skus : [];
        if (!name || (!phone && !email)) {
          return NextResponse.json({ ok: false, need: 'A name plus a phone number or email.' }, { status: 200 });
        }
        let saved = false;
        if (hasDb()) {
          try {
            await upsertCustomer({ email: email || null, name, phone: phone || null });
            if (email) await createQuoteRequest({ name, email, phone, skus, note: `Phone lead: ${interest}` });
            saved = true;
          } catch (e) { console.error('voice lead save failed', e.message); }
        }
        // Always tell the owner, even if the DB write hiccups.
        notifyOwner(
          `📞 Phone lead — ${name}`,
          `<p><b>${name}</b><br/>${phone || '(no phone)'} · ${email || '(no email)'}</p>
           <p><b>Wants:</b> ${interest || '(not stated)'}</p>
           ${skus.length ? `<p><b>Units:</b> ${skus.join(', ')}</p>` : ''}
           <p style="color:#666">Captured by the phone agent.</p>`
        ).catch((e) => console.error('lead notify failed', e.message));
        return NextResponse.json({ ok: true, saved, confirm: `Got it, ${name.split(' ')[0]} — someone will follow up shortly.` });
      }

      // ---- caller wants a person -------------------------------------------
      case 'request_human': {
        const staffed = isStaffedNow();
        return NextResponse.json({
          transfer: staffed,
          hours: BUSINESS_HOURS,
          say: staffed
            ? 'Connecting you now — one moment.'
            : `Our team is available ${BUSINESS_HOURS}, seven days. I can take your name and number and have someone call you back first thing.`
        });
      }

      // ---- after-hours / unresolved message --------------------------------
      case 'take_message': {
        const name = String(body.name || '').trim() || 'Caller';
        const phone = String(body.phone || '').trim();
        const message = String(body.message || '').trim();
        notifyOwner(
          `📞 Phone message — ${name}${phone ? ` (${phone})` : ''}`,
          `<p><b>${name}</b> ${phone ? `· ${phone}` : ''}</p><p>${message || '(no message)'}</p>
           <p style="color:#666">Left with the phone agent${isStaffedNow() ? '' : ' after hours'}.</p>`
        ).catch((e) => console.error('message notify failed', e.message));
        return NextResponse.json({ ok: true, confirm: 'I\'ve passed that along — we\'ll be in touch.' });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    console.error('voice tool failed', action, e.message);
    // Never hand the agent a stack trace — give it something safe to say.
    return NextResponse.json({ error: 'tool_failed', say: 'I had trouble looking that up — let me take your details and have someone follow up.' }, { status: 200 });
  }
}

// Health check / quick manual probe.
export async function GET() {
  return NextResponse.json({ ok: true, staffed_now: isStaffedNow(), hours: BUSINESS_HOURS, address: PICKUP_ADDRESS });
}
