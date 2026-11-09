// The Sales Hub's lead API. A rep or an admin; identity comes from the session,
// never the body, and every read and write is scoped to the viewer inside lib/leads.js.
import { NextResponse } from 'next/server';
import { requireHub } from '../../../../lib/sales-access';
import {
  listLeads, getLead, createLead, logLeadActivity, setLeadStage, assignLead, acceptLead,
  homeSummary, slaBreaches, importLeads, convertLead, LeadError
} from '../../../../lib/leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => {
  if (e instanceof LeadError) {
    return NextResponse.json({ error: e.message, code: e.code, existingId: e.existingId || null }, { status: e.code === 'notfound' ? 404 : 400 });
  }
  console.error('sales leads api failed', e.message);
  return NextResponse.json({ error: 'That did not work.' }, { status: 500 });
};

export async function GET(req) {
  const viewer = await requireHub();
  if (!viewer) return deny();
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('view') === 'home') return NextResponse.json(await homeSummary(viewer));
    if (url.searchParams.get('view') === 'sla') {
      if (!viewer.admin) return deny();
      return NextResponse.json({ breaches: await slaBreaches() });
    }
    const id = url.searchParams.get('id');
    if (id) {
      const lead = await getLead(id, viewer);
      return lead ? NextResponse.json({ lead }) : NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }
    const leads = await listLeads({
      side: url.searchParams.get('side') || undefined,
      stage: url.searchParams.get('stage') || undefined,
      q: url.searchParams.get('q') || undefined,
      owner: url.searchParams.get('owner') || undefined      // honoured for an admin only, inside listLeads
    }, viewer);
    return NextResponse.json({ leads });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const viewer = await requireHub();
  if (!viewer) return deny();
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'create':
        return NextResponse.json(await createLead(body.lead || {}, viewer));
      case 'log':
        return NextResponse.json(await logLeadActivity(body.id, body.activity || {}, viewer));
      case 'stage':
        return NextResponse.json(await setLeadStage(body.id, body.stage, { lostReason: body.lostReason }, viewer));
      case 'convert':
        return NextResponse.json(await convertLead(body.id, viewer));
      case 'accept':
        return NextResponse.json(await acceptLead(body.id, viewer));
      case 'assign':
        if (!viewer.admin) return deny();
        return NextResponse.json(await assignLead(body.id, body.ownerEmail, viewer.email));
      case 'import-preview':
        return NextResponse.json(await importLeads(body.text, viewer, { commit: false, defaultSide: body.side }));
      case 'import-commit':
        return NextResponse.json(await importLeads(body.text, viewer, { commit: true, defaultSide: body.side }));
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
