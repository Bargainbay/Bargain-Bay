import { NextResponse } from 'next/server';
import { listRecent, readEmail } from '../../../../lib/gmail';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One-off helper: read the Gmail forwarding-verification email in accounting@ and
// return its confirmation code + link. Tightly scoped to Google's forwarding
// sender only (can't be used to read arbitrary mail). Secret-gated.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const inbox = process.env.INTAKE_INBOX || 'accounting@bargainbay.ca';
  try {
    const { emails } = await listRecent(inbox, { query: 'from:forwarding-noreply@google.com newer_than:3d', max: 5 });
    if (!emails.length) return NextResponse.json({ ok: true, found: false, inbox });
    const full = await readEmail(inbox, emails[0].id);
    const body = full.body || '';
    const code = (body.match(/\b\d{6,9}\b/) || [])[0] || (full.subject.match(/#?(\d{6,9})/) || [])[1] || null;
    const link = (body.match(/https?:\/\/mail\.google\.com\/mail\/\S+/) || [])[0] || null;
    return NextResponse.json({ ok: true, found: true, inbox, subject: full.subject, code, link, body: body.slice(0, 1500) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
