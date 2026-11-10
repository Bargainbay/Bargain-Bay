// The rep's own agreements. Identity is the SESSION: nothing in the request says whose agreement this is.
// GET: the text to read and whether signing is open (an admin may look, but only a rep can sign).
// GET ?download=1: the signed copy as a standalone HTML file. POST: { action: 'sign' | 'email' }.
import { NextResponse } from 'next/server';
import { getSession, isSalesRep } from '../../../../lib/auth';
import { hubViewer } from '../../../../lib/sales-access';
import { clientIp, userAgent } from '../../../../lib/antifraud';
import { agreementState, signAgreement, copyFor, copyHtml, mailCopy, AgreementError } from '../../../../lib/rep-agreements';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => {
  if (e instanceof AgreementError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
  console.error('rep agreement failed', e?.message);
  return NextResponse.json({ error: 'That did not work. Try again, or tell the owner.' }, { status: 500 });
};

export async function GET(req) {
  const session = await getSession();
  const viewer = hubViewer(session);
  if (!viewer) return deny();
  try {
    if (new URL(req.url).searchParams.get('download') === '1') {
      const c = await copyFor(viewer.email);
      if (!c) return NextResponse.json({ error: 'Nothing signed yet.' }, { status: 404 });
      const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed copy: employment agreements</title></head><body>${copyHtml(c)}</body></html>`;
      return new NextResponse(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="employment-agreements-signed.html"' } });
    }
    const st = await agreementState(viewer.email);
    return NextResponse.json({ ...st, rep: isSalesRep(session) });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const session = await getSession();
  const viewer = hubViewer(session);
  if (!viewer) return deny();
  if (!isSalesRep(session)) return NextResponse.json({ error: 'Only the sales rep signs this agreement.' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'sign') {
      return NextResponse.json(await signAgreement(session, {
        typedName: b.typedName, address: b.address, agreed: b.agreed === true, hash: b.hash, ip: clientIp(req), userAgent: userAgent(req)
      }));
    }
    if (b.action === 'email') return NextResponse.json({ ok: true, ...(await mailCopy(viewer.email)) });
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return fail(e); }
}
