import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { sendDailyBfEmail } from '../../../../lib/bf-daily';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // a few hundred emails, paced under Resend's rate limit

// 10am Toronto: today's Black Friday email, only while it is switched on and inside its dates.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const result = await sendDailyBfEmail();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    console.error('cron bf-email failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('bf-email', run);
export const GET = beat;
export const POST = beat;
