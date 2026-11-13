// Our team's side of partner leads: the unclaimed queue, claiming one, and working it. STAFF-level (sales, reps, admin): this is
// the customer's sale, not the business's books. Logging, staging and converting reuse the Sales Hub's own functions, which only
// let a non-admin touch a lead they OWN, so claiming first is what makes a lead workable.
import { NextResponse } from 'next/server';
import { getSession, isStaff, isAdmin } from '../../../../lib/auth';
import { partnerLeadQueue, claimLead } from '../../../../lib/partner-leads';
import { getLead, logLeadActivity, setLeadStage, convertLead, LeadError } from '../../../../lib/leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function viewerOf() {
  const s = await getSession();
  if (!s || !isStaff(s)) return null;
  return { email: s.email, name: s.name, admin: isAdmin(s) };
}
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => NextResponse.json({ error: e.message, code: e.code }, { status: e instanceof LeadError ? (e.code === 'taken' ? 409 : 400) : 500 });

export async function GET(req) {
  const v = await viewerOf();
  if (!v) return deny();
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (id) {
      const lead = await getLead(id, v);
      return lead ? NextResponse.json({ lead }) : NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }
    return NextResponse.json(await partnerLeadQueue(v));
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const v = await viewerOf();
  if (!v) return deny();
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    switch (b.action) {
      case 'claim': return NextResponse.json(await claimLead(b.id, v));
      case 'activity': return NextResponse.json(await logLeadActivity(b.id, b, v));
      case 'stage': return NextResponse.json(await setLeadStage(b.id, b.stage, { lostReason: b.lostReason }, v));
      case 'junk': return NextResponse.json(await setLeadStage(b.id, 'lost', { lostReason: 'junk' }, v));
      case 'convert': return NextResponse.json(await convertLead(b.id, v));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
