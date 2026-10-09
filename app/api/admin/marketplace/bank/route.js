// Admin review of vendors' bank accounts. ADMIN only: it decides where money is sent. The list
// carries masked numbers; the full number is only ever released through the payout file.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { pendingBankAccounts, verifyBankAccount, rejectBankAccount } from '../../../../../lib/vendor-bank';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return s && isAdmin(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  if (!(await admin())) return denied();
  return NextResponse.json({ pending: await pendingBankAccounts() });
}

export async function POST(req) {
  const s = await admin();
  if (!s) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    if (b.action === 'verify') return NextResponse.json(await verifyBankAccount(id, { by: s.email, how: b.how, nameMatched: b.nameMatched === true }));
    if (b.action === 'reject') return NextResponse.json(await rejectBankAccount(id, { by: s.email, reason: b.reason }));
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not record that.' }, { status: 400 });
  }
}
