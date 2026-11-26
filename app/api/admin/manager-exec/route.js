import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { latestReview, buildReview, getExecConfig, saveExecConfig, assignmentsOn, briefHtml } from '../../../../lib/exec';
import { torontoToday, SERVICE_EMAIL } from '../../../../lib/constants';
import { sendEmail } from '../../../../lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

// The General Manager's review. ADMIN only: it carries wages and profit.
async function gate() {
  const session = await getSession();
  return session && isAdmin(session) ? session : null;
}

export async function GET() {
  if (!(await gate())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const [review, config, targets] = await Promise.all([latestReview(), getExecConfig(), assignmentsOn(torontoToday()).catch(() => [])]);
    return NextResponse.json({ review, config, targets });
  } catch (e) {
    console.error('manager-exec read failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await gate();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'config') {
      const config = await saveExecConfig(body);
      await audit(session, { action: 'manager.settings', entity: 'settings', entityId: 'manager_exec', summary: `Manager settings: email brief ${config.emailBrief ? 'on' : 'off'}, text staff their targets ${config.textStaff ? 'on' : 'off'}`, detail: config });
      return NextResponse.json({ ok: true, config });
    }
    if (body.action === 'review') {
      const { snapshot } = await buildReview({ commit: true });
      return NextResponse.json({ ok: true, review: snapshot, targets: snapshot.targets });
    }
    if (body.action === 'email') {
      const review = await latestReview();
      if (!review) return NextResponse.json({ error: 'Run a review first.' }, { status: 400 });
      const r = await sendEmail({ to: SERVICE_EMAIL, subject: `Manager's brief: ${review.verdict}`.slice(0, 180), html: briefHtml(review) });
      return r && r.ok !== false ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'The email did not send.' }, { status: 502 });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    console.error('manager-exec action failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 500 });
  }
}
