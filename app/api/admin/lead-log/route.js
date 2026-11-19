// The lead log's API. STAFF-level (sales, reps, admin): writing a lead down and saying what became of it is the customer's sale,
// not the business's books. The viewer comes from the session, never the body; reads and writes are scoped to the viewer inside
// lib/lead-log.js / lib/leads.js (a non-admin touches only leads they own).
import { NextResponse } from 'next/server';
import { getSession, isStaff, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { LeadError } from '../../../../lib/leads';
import { logLead, recentLog, leadFunnel, knownDetails, setLeadOutcome, addLeadNote, assignFromLog, assignableReps } from '../../../../lib/lead-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function viewerOf() {
  const s = await getSession();
  if (!s || !isStaff(s)) return null;
  return { email: s.email, name: s.name || '', admin: isAdmin(s) };
}
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => {
  if (e instanceof LeadError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'notfound' ? 404 : 400 });
  console.error('lead log api failed', e.message);
  return NextResponse.json({ error: 'That did not work.' }, { status: 500 });
};

export async function GET(req) {
  const v = await viewerOf();
  if (!v) return deny();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  const url = new URL(req.url);
  try {
    const days = url.searchParams.get('days');
    const [funnel, log, details, reps] = await Promise.all([
      leadFunnel(v, { days: days || 30 }),
      recentLog(v, { days: 14 }),
      knownDetails(v),
      assignableReps(v)
    ]);
    return NextResponse.json({ funnel, log, details, reps });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const v = await viewerOf();
  if (!v) return deny();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    switch (b.action) {
      case 'log': return NextResponse.json(await logLead(b.lead || {}, v));
      case 'outcome': return NextResponse.json(await setLeadOutcome(b.id, { outcome: b.outcome, lostReason: b.lostReason }, v));
      case 'note': return NextResponse.json(await addLeadNote(b.id, b.notes, v));
      case 'assign':
        if (!v.admin) return deny();
        return NextResponse.json(await assignFromLog(b.id, b.ownerEmail, v));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
