// Forgot password — emails a 1-hour single-use reset link. Always answers the
// same way whether or not the email has an account (no enumeration), and a
// small in-memory cooldown keeps it from being used as a mail cannon (real
// rate limiting is the pending Upstash batch).
import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../../lib/db';
import { normalizeEmail, validEmail, createPasswordResetToken } from '../../../../lib/auth';
import { sendPasswordResetEmail } from '../../../../lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOLDOWN_MS = 10 * 60 * 1000;
const recent = new Map(); // email -> last send ts (per warm instance)

function siteUrl() {
  return (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const email = normalizeEmail(body.email);
  const done = NextResponse.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
  if (!validEmail(email) || !hasDb()) return done;

  const last = recent.get(email) || 0;
  if (Date.now() - last < COOLDOWN_MS) return done;
  if (recent.size > 5000) recent.clear();
  recent.set(email, Date.now());

  try {
    const { rows } = await query('SELECT id, email, name FROM users WHERE lower(email) = $1 LIMIT 1', [email]);
    if (rows.length) {
      const token = await createPasswordResetToken(rows[0].id);
      await sendPasswordResetEmail({
        to: rows[0].email,
        name: rows[0].name,
        url: `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`
      });
    }
  } catch (e) {
    console.error('forgot-password failed', e.message); // still answer ok — no oracle
  }
  return done;
}
