import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from '../../../../../../lib/auth';
import { isProvider, fetchIdentity, resolveOAuthUser, safeNext, STATE_COOKIE } from '../../../../../../lib/oauth';
import { clientIp } from '../../../../../../lib/antifraud';
import { notifyOwner, esc } from '../../../../../../lib/email';

export const dynamic = 'force-dynamic';

// Step 2: the provider sends the person back with ?code and ?state.
export async function GET(req, { params }) {
  const { provider } = await params;
  const sp = new URL(req.url).searchParams;
  const fail = (msg) => {
    const res = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  if (!isProvider(provider)) return fail('That sign-in method is not available.');
  if (sp.get('error')) return fail('Sign-in was cancelled.');

  let saved = {};
  try { saved = JSON.parse(req.cookies.get(STATE_COOKIE)?.value || '{}'); } catch { /* fall through */ }
  const code = sp.get('code');
  if (!code || !saved.state || saved.state !== sp.get('state')) return fail('Sign-in expired. Please try again.');

  try {
    const id = await fetchIdentity(provider, code);
    const r = await resolveOAuthUser({ provider, ...id, ip: clientIp(req) });
    if (!r.ok) return fail(r.error);

    if (r.created) {
      notifyOwner(
        `New account: ${r.user.name} (${r.user.email})`,
        `<p>A new customer account was created with ${esc(provider)} sign-in.</p><ul><li><b>Name:</b> ${esc(r.user.name)}</li><li><b>Email:</b> ${esc(r.user.email)}</li></ul>`
      ).catch(() => {});
    }
    const token = await createSessionToken(r.user);
    const res = NextResponse.redirect(new URL(safeNext(saved.next), req.url));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (e) {
    console.error('oauth callback failed', provider, e.message);
    return fail(e.message || 'Sign-in failed. Please try again.');
  }
}
