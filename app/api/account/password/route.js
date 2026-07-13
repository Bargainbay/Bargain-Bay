// Customer self-service password change. Requires the current password, then
// bumps token_version (revoking every existing session — logout-everywhere)
// and re-issues a fresh session cookie for THIS browser so the user stays in.
import { NextResponse } from 'next/server';
import {
  getSession, verifyPassword, hashPassword, bumpTokenVersion,
  createSessionToken, sessionCookieOptions, SESSION_COOKIE
} from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Accounts are unavailable right now.' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (next.length < 8) return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });

  try {
    const { rows } = await query('SELECT id, email, name, password_hash FROM users WHERE id = $1', [session.userId]);
    if (!rows.length) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    const ok = await verifyPassword(current, rows[0].password_hash || '');
    if (!ok) return NextResponse.json({ error: 'Your current password is incorrect.' }, { status: 403 });

    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [session.userId, await hashPassword(next)]);
    await bumpTokenVersion(session.userId);
    // Fresh token embeds the bumped version, so this session survives while
    // every other device's cookie is now dead.
    const token = await createSessionToken({ id: rows[0].id, email: rows[0].email, name: rows[0].name });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    console.error('password change failed', e);
    return NextResponse.json({ error: 'Could not change your password. Please try again.' }, { status: 500 });
  }
}
