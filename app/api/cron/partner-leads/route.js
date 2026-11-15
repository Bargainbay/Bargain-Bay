import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { remindUnclaimedLeads, notifyTeamOfNewLeads, notifyGeneratorsOfSales } from '../../../../lib/partner-leads';
import { reconcilePartnerLeads } from '../../../../lib/partner-attribution';
import { purgeOldScreenshots } from '../../../../lib/lead-screenshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Hourly: chase partner leads nobody has claimed in two hours, send any "new leads" email a failed send left behind, and link
// leads whose person has since bought (the rep who forgot to press Convert).
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const notified = await notifyTeamOfNewLeads();
    const reminded = await remindUnclaimedLeads();
    const reconciled = await reconcilePartnerLeads();
    const purged = await purgeOldScreenshots();
    const sold = await notifyGeneratorsOfSales();
    return NextResponse.json({ ok: true, notified, reminded, reconciled, purged, sold });
  } catch (e) {
    console.error('cron partner-leads failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('partner-leads', run);
export const GET = beat;
export const POST = beat;
