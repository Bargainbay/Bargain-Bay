// Referral partners — ADMIN ONLY. Granting one, setting the percentage and putting a customer account
// under one all change who is paid commission.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listPartners, savePartner, invitePartner, revokePartner, recordPayment, voidPayment, listPayments, setClientPartner, searchCustomers, addTeamMember, removeTeamMember, setPartnerCode, listTeam, partnerReport, PartnerError } from '../../../../lib/referral-partners';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const admin = async () => { const s = await getSession(); return s && isAdmin(s) ? s : null; };
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => NextResponse.json({ error: e.message }, { status: e instanceof PartnerError ? 400 : 500 });

export async function GET(req) {
  if (!(await admin())) return deny();
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('find') != null) return NextResponse.json({ customers: await searchCustomers(url.searchParams.get('find')) });
    const partners = await listPartners();
    // What each active partner is owed right now, so the owner sees it without opening anyone's page.
    for (const p of partners) {
      if (p.revoked_at) continue;
      const r = await partnerReport(p.email);
      p.totals = r.totals; p.payments = await listPayments(p.email);
      p.team = r.team; p.code = r.partner?.code || null; p.customerCode = r.partner?.customerCode || null; p.link = r.partner?.link; p.customerLink = r.partner?.customerLink || null;
    }
    return NextResponse.json({ partners });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const s = await admin();
  if (!s) return deny();
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    switch (b.action) {
      case 'save': return NextResponse.json(await savePartner({ email: b.email, name: b.name, pct: b.pct, customerPct: b.customerPct, basis: b.basis, pricePct: b.pricePct, pricePctRetail: b.pricePctRetail, capPct: b.capPct }, s.email));
      case 'set_code': return NextResponse.json(await setPartnerCode(b.email, b.code, s.email));
      case 'team_add': return NextResponse.json(await addTeamMember(b.partnerEmail, { email: b.email, name: b.name }, s.email));
      case 'team_remove': return NextResponse.json(await removeTeamMember(b.partnerEmail, b.email, s.email));
      case 'invite': return NextResponse.json({ ok: true, ...(await invitePartner(b.email, s.email)) });
      case 'pay': return NextResponse.json(await recordPayment(b, s.email));
      case 'void_payment': return NextResponse.json(await voidPayment(b.id, s.email));
      case 'revoke': return NextResponse.json(await revokePartner(b.email, s.email));
      case 'assign': return NextResponse.json(await setClientPartner(b.customerId, b.partner, b.reason, s.email));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
