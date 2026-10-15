// A seller's conversations with Bargain Bay. The vendor id comes from the session; another seller's thread id
// is exactly "Conversation not found" (a 404). Internal staff notes are excluded in SQL, so they cannot be in
// any payload from here. Text only: there are no attachments in this slice.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { listVendorThreads, getVendorThread, startVendorThread, replyVendor, vendorUnreadCount, vendorTieOptions, MAX_BODY, MAX_SUBJECT } from '../../../../lib/vendor-messages';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const ctx = await requireVendor('messages.view');
  if (!ctx) return denied();
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const thread = await getVendorThread(ctx.vendor.id, id);
    if (!thread) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    return NextResponse.json({ thread, unread: await vendorUnreadCount(ctx.vendor.id) });
  }
  const [threads, unread, ties] = await Promise.all([listVendorThreads(ctx.vendor.id), vendorUnreadCount(ctx.vendor.id), vendorTieOptions(ctx.vendor.id)]);
  return NextResponse.json({ threads, unread, ties, limits: { body: MAX_BODY, subject: MAX_SUBJECT } });
}

export async function POST(req) {
  const ctx = await requireVendor('messages.send');
  if (!ctx) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  // The author is the signed-in user. Nothing in the body can name one.
  const by = ctx.session.email;
  const byName = ctx.session.name || ctx.vendor.trade_name || ctx.vendor.legal_name;
  try {
    switch (b?.action) {
      case 'start': return NextResponse.json(await startVendorThread(ctx.vendor.id, {
        subject: b.subject, body: b.body, vendorOrderId: b.vendorOrderId, listingId: b.listingId, claimId: b.claimId, by, byName }));
      case 'reply': return NextResponse.json(await replyVendor(ctx.vendor.id, Number(b.id), { body: b.body, by, byName }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    const missing = /not found/i.test(e?.message || '');
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: missing ? 404 : 400 });
  }
}
