// Set monthly sales quotas. ADMIN only: a quota is what the business expects of
// a person, which sits with pay and performance rather than with the selling
// itself. Reps can SEE their progress on the sales dashboard; they cannot move
// the goalposts.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { setQuota } from '../../../../lib/quotas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const list = Array.isArray(body.quotas) ? body.quotas : [];
  if (!list.length) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  try {
    // Validated one at a time but written in order; a bad figure on the third
    // rep stops there and says which, rather than half-saving silently.
    for (const q of list) {
      try {
        await setQuota({ ...q, by: s.email });
      } catch (e) {
        return NextResponse.json({ error: `${q.rep || 'Rep'}: ${e.message}` }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
  }
}
