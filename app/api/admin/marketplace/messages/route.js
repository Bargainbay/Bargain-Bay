// Seller conversations, from the staff side. STAFF-level: this is dealing with a seller, not the books.
// Staff see internal notes (which the seller's routes never select). A seller-visible message that looks like it
// carries a customer's email or phone is refused with 409 until the sender confirms.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../../lib/auth';
import {
  listStaffThreads, getStaffThread, startStaffThread, replyStaff, assignThread, closeThread, reopenThread, staffTieOptions, staffUnreadCount
} from '../../../../../lib/vendor-messages';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  const p = new URL(req.url).searchParams;
  if (p.get('id')) {
    const thread = await getStaffThread(p.get('id'));
    if (!thread) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    return NextResponse.json({ thread });
  }
  if (p.get('ties')) return NextResponse.json({ ties: await staffTieOptions(Number(p.get('ties'))) });
  const threads = await listStaffThreads({ filter: p.get('filter') || 'open', vendorId: p.get('vendorId') ? Number(p.get('vendorId')) : undefined });
  return NextResponse.json({ threads, unread: await staffUnreadCount() });
}

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const by = s.email;
  const byName = s.name || s.email;
  try {
    switch (b?.action) {
      case 'start': return NextResponse.json(await startStaffThread({
        vendorId: Number(b.vendorId), subject: b.subject, body: b.body, vendorOrderId: b.vendorOrderId, listingId: b.listingId, claimId: b.claimId,
        confirmContact: !!b.confirmContact, by, byName }));
      case 'reply': return NextResponse.json(await replyStaff(Number(b.id), { body: b.body, internal: !!b.internal, confirmContact: !!b.confirmContact, by, byName }));
      case 'assign': return NextResponse.json(await assignThread(Number(b.id), { to: b.to, by }));
      case 'close': return NextResponse.json(await closeThread(Number(b.id), { by }));
      case 'reopen': return NextResponse.json(await reopenThread(Number(b.id), { by }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    if (e?.needsConfirm) return NextResponse.json({ error: e.message, needsConfirm: true }, { status: 409 });
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
