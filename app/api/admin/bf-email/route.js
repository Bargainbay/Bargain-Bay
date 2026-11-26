// The daily Black Friday email: preview, send a test to one address, switch on or off. Admin only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, validEmail, normalizeEmail } from '../../../../lib/auth';
import { getBfDaily, saveBfDaily, previewBfEmail } from '../../../../lib/bf-daily';
import { sendEmailCampaign } from '../../../../lib/campaigns';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  if (!(await admin())) return deny();
  return NextResponse.json({ config: await getBfDaily(), preview: await previewBfEmail().catch(() => null) });
}

export async function POST(req) {
  const session = await admin();
  if (!session) return deny();
  const body = await req.json().catch(() => ({}));
  if (body.action === 'save') {
    const config = await saveBfDaily(body.config || {});
    await audit(session, { action: 'bf_daily.save', entity: 'setting', entityId: 'bf_daily', summary: `Daily Black Friday email ${config.enabled ? 'on' : 'off'} until ${config.until}` });
    return NextResponse.json({ config });
  }
  if (body.action === 'test') {
    if (!validEmail(body.to || '')) return NextResponse.json({ error: 'Enter a valid test email.' }, { status: 400 });
    const preview = await previewBfEmail();
    if (!preview) return NextResponse.json({ error: 'Nothing in stock to feature.' }, { status: 400 });
    const result = await sendEmailCampaign({ recipients: [{ name: '', email: normalizeEmail(body.to) }], subject: preview.subject, message: preview.message, test: true });
    return NextResponse.json({ result });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
