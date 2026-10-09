// Staff side of listing review: the queue, one listing in full, and the decision.
// Staff, not admin — approving a vendor's listing is a thing a rep does with a vendor
// on the phone (the customer's sale, not the business's books).
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../../lib/auth';
import { reviewQueue, getListingForReview, reviewListing, checkInListing } from '../../../../../lib/marketplace-listings';
import { REJECT_REASONS } from '../../../../../lib/listing-rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function staff() { const s = await getSession(); return s && isStaff(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  if (!(await staff())) return denied();
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (id) {
    const l = await getListingForReview(id);
    return l ? NextResponse.json({ listing: l, rejectReasons: REJECT_REASONS }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ queue: await reviewQueue(), rejectReasons: REJECT_REASONS });
}

export async function POST(req) {
  const s = await staff();
  if (!s) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    if (b.action === 'checkin') return NextResponse.json(await checkInListing(id, { by: s.email, accepted: !!b.accepted, note: b.note }));
    return NextResponse.json(await reviewListing(id, { decision: b.decision, by: s.email, note: b.note, reason: b.reason, condition: b.condition }));
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not record that.' }, { status: 400 });
  }
}
