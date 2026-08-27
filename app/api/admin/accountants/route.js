// Granting and revoking accountant access. ADMIN ONLY — an accountant must not
// be able to add another accountant, or un-revoke themselves.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listAccountants, grantAccountant, revokeAccountant } from '../../../../lib/accountants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const session = await getSession();
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    // Stamped from the session, never the body — who let someone into the books
    // is the part of this record that matters.
    if (b.action === 'grant') {
      await grantAccountant({ email: b.email, name: b.name, note: b.note, by: session?.email });
    } else if (b.action === 'revoke') {
      await revokeAccountant(b.email, session?.email);
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, accountants: await listAccountants() });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 });
  }
}
