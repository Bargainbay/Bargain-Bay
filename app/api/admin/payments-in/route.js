// Incoming e-transfers from the bank feed, and the orders/invoices they probably pay.
// Staff: marking a customer's order paid is what the orders board already lets them do, and this is the
// same act with the bank line beside it. Cost and profit are nowhere near it.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { depositQueue, confirmDeposit, ignoreDeposit } from '../../../../lib/deposit-match';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  const status = new URL(req.url).searchParams.get('status') || 'new';
  if (!['new', 'matched', 'ignored'].includes(status)) return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
  return NextResponse.json({ deposits: await depositQueue({ status }) });
}

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    if (b?.action === 'confirm') {
      const r = await confirmDeposit(Number(b.depositId), { kind: b.kind, id: Number(b.id), by: s.email });
      await audit(s, { action: 'deposit_matched', entity: 'bank_deposit', entityId: b.depositId, summary: `Deposit matched to ${r.ref}`, detail: { kind: b.kind } });
      return NextResponse.json(r);
    }
    if (b?.action === 'ignore') {
      const r = await ignoreDeposit(Number(b.depositId), { by: s.email, note: b.note });
      await audit(s, { action: 'deposit_ignored', entity: 'bank_deposit', entityId: b.depositId, summary: 'Deposit set aside', detail: { note: b.note || null } });
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
