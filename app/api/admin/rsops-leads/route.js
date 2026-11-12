// Bring RS Ops' sales-CRM leads into the Sales Hub (lib/rsops-leads.js). ADMIN ONLY:
// it hands a whole book of leads to somebody, and locks RS Ops' lead screens at the end.
//
// GET                                         → preview (writes nothing)
// POST { action: 'commit', offset, ownerEmail, failedSoFar } → one batch; repeat until done
// GET ?view=pool                             → RS Ops leads waiting in the pool, by category
// POST { action: 'deal', ownerEmail, perSegment, max, includeRestoration } → give a rep a slice
// POST { action: 'reopen' }                   → unlock RS Ops' lead screens again
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { previewRsopsLeads, commitRsopsBatch, reopenRsopsLeads, rsopsPoolCounts, dealRsopsLeads, RsopsLeadError } from '../../../../lib/rsops-leads';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}

const fail = (e) => NextResponse.json(
  { error: e instanceof RsopsLeadError ? e.message : 'Something went wrong bringing the leads across.' },
  { status: e instanceof RsopsLeadError ? 400 : 500 }
);

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    if (new URL(req.url).searchParams.get('view') === 'pool') return NextResponse.json(await rsopsPoolCounts());
    return NextResponse.json(await previewRsopsLeads()); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const s = await admin();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body = {};
  try { body = await req.json(); } catch {}
  try {
    if (body.action === 'commit') {
      const r = await commitRsopsBatch({ offset: body.offset, ownerEmail: body.ownerEmail, by: s.email, failedSoFar: Number(body.failedSoFar) || 0 });
      await audit(s, {
        action: 'leads.rsops_import', entity: 'leads', summary: `RS Ops leads batch from ${Number(body.offset) || 0}: ${r.counts.imported} brought across to ${body.ownerEmail || 'the unassigned pool'}`,
        detail: { counts: r.counts, done: r.done, locked: Boolean(r.locked) }
      });
      return NextResponse.json(r);
    }
    if (body.action === 'deal') {
      const r = await dealRsopsLeads({ ownerEmail: body.ownerEmail, perSegment: body.perSegment, max: body.max, includeRestoration: Boolean(body.includeRestoration), by: s.email });
      await audit(s, { action: 'leads.rsops_deal', entity: 'leads', summary: `Gave ${r.assigned} RS Ops leads to ${body.ownerEmail}`, detail: r });
      return NextResponse.json(r);
    }
    if (body.action === 'reopen') {
      await audit(s, { action: 'leads.rsops_reopen', entity: 'leads', summary: 'Unlocked RS Ops lead screens' });
      return NextResponse.json(await reopenRsopsLeads());
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) { return fail(e); }
}
