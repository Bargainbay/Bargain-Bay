// Customer self-service profile edit (name + phone). Email is the account
// identity and stays put; password changes have their own endpoint.
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { upsertCustomer } from '../../../../lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Accounts are unavailable right now.' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const name = String(body.name || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });

  try {
    await query('UPDATE users SET name = $2, phone = $3 WHERE id = $1', [session.userId, name, phone || null]);
    upsertCustomer({ email: session.email, name, phone, userId: session.userId }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('profile update failed', e);
    return NextResponse.json({ error: 'Could not save your profile. Please try again.' }, { status: 500 });
  }
}
