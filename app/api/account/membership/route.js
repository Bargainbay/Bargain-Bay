import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { requestMembership } from '../../../../lib/members';
import { notifyOwner, esc } from '../../../../lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Please log in first.' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const businessName = String(body.businessName || '').trim();
  if (!businessName) return NextResponse.json({ error: 'Business name is required.' }, { status: 400 });
  const note = String(body.note || '').trim();
  try {
    await requestMembership(session.userId, businessName, note);
    notifyOwner(
      `New member application: ${businessName}`,
      `<p>A business requested wholesale member access on Bargain Bay.</p>
       <ul><li><b>Business:</b> ${esc(businessName)}</li><li><b>Contact:</b> ${esc(session.email)}</li><li><b>Note:</b> ${esc(note) || '—'}</li></ul>
       <p>Review &amp; approve in <a href="https://bargainbay.ca/admin">the admin panel</a>.</p>`
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
