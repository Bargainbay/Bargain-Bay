import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { assignDailyLeads } from '../../../../lib/lead-daily';
import { sendEmail } from '../../../../lib/email';
import { SERVICE_EMAIL } from '../../../../lib/constants';
import { SITE_URL } from '../../../../lib/site';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every morning: top each rep on the list up with today's new leads, and tell the office when the pool is running out.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const result = await assignDailyLeads();
    if (result.ok && result.low) {
      await sendEmail({
        to: SERVICE_EMAIL,
        subject: `Lead list running out: ${result.pool} left to hand out`,
        html: `<p>Only <b>${result.pool}</b> uncalled leads are left in the pool, less than two days of call lists.</p><p><a href="${SITE_URL}/sales/leads">Import more leads</a></p>`
      }).catch(() => {});
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    console.error('cron daily-leads failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('daily-leads', run);
export const GET = beat;
export const POST = beat;
