import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { GIVEAWAY, giveawayOpen } from '../../../../lib/deals-config';
import { entryIdFromParam, entryStatus, setInstagram, registerVideo } from '../../../../lib/giveaway';
import { grantConsent } from '../../../../lib/consent';
import { clientIp } from '../../../../lib/antifraud';

export const dynamic = 'force-dynamic';

// Optional extra entries for somebody who already has one. The caller proves
// which entry is theirs with the signed "e" token from their link.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = entryIdFromParam(body.e);
  if (!id) return NextResponse.json({ error: 'That link is not valid. Use the link in your confirmation email.' }, { status: 400 });
  if (!giveawayOpen()) return NextResponse.json({ error: 'This giveaway is no longer taking entries.' }, { status: 400 });
  if (!hasDb()) return NextResponse.json({ error: 'Briefly unavailable. Please try again soon.' }, { status: 503 });

  try {
    const cur = await entryStatus(id);
    if (!cur) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });

    if (body.action === 'instagram') {
      await setInstagram(id, body.handle);
    } else if (body.action === 'newsletter') {
      // Express consent with the wording they were shown. Only on a real tick.
      if (body.optIn !== true) return NextResponse.json({ error: 'Tick the box to subscribe.' }, { status: 400 });
      await grantConsent({
        channel: 'email', email: cur.email, source: 'giveaway', ip: clientIp(req),
        evidence: String(body.optInText || '').slice(0, 500) || 'Ticked the newsletter box on the giveaway checklist'
      });
    } else if (body.action === 'video') {
      await registerVideo(GIVEAWAY.id, id, body.pathname, body.release === true);
    } else {
      return NextResponse.json({ error: 'Unknown step.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, status: await entryStatus(id) });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Something went wrong.' }, { status: 400 });
  }
}
