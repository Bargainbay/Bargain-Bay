import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { payoutRun } from '../../../../lib/affiliates';
import { sendPayoutRunNotice } from '../../../../lib/affiliate-mail';

export const dynamic = 'force-dynamic';

// Weekly: who is owed affiliate commission, mailed to the office so the e-transfers get sent. It PROPOSES
// and records nothing - money is only booked as paid when a person says they sent it. Silent on a week
// with nothing owed (an email every Monday about $0 trains people to ignore it).
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const r = await payoutRun();
    if (r.rows.length) await sendPayoutRunNotice({ rows: r.rows, total: r.total });
    return NextResponse.json({ ok: true, due: r.rows.length, total: r.total });
  } catch (e) {
    console.error('affiliate-payouts failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

const beat = withHeartbeat('affiliate-payouts', run);
export const GET = beat;
export const POST = beat;
