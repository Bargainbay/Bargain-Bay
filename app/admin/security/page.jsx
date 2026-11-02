import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb, query } from '../../../lib/db';
import { mfaState, mfaAvailable } from '../../../lib/vendor-mfa';
import { adminMarkerValid, ADMIN_MARKER_COOKIE, adminMfaEnforced } from '../../../lib/admin-mfa-gate';
import VendorSecurity from '../../../components/VendorSecurity';
import VendorMfaVerify from '../../../components/VendorMfaVerify';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Two-factor sign-in — Admin' };

// Where an administrator sets up the authenticator and types the code. Reachable BEFORE the
// second factor is passed (proxy.js exempts it) — that is its whole job — but only for admins.
export default async function AdminSecurityPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/security');
  if (!isAdmin(session) || !hasDb()) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1></div></div>);
  }
  const next = typeof sp?.next === 'string' ? sp.next : '/admin';
  const st = await mfaState(session.userId);
  const tv = (await query('SELECT token_version FROM users WHERE id = $1', [session.userId])).rows[0]?.token_version || 0;
  const jar = await cookies();
  const verified = await adminMarkerValid(jar.get(ADMIN_MARKER_COOKIE)?.value, session.userId, tv);

  if (st.enrolled && !verified) {
    return <div className="narrow"><VendorMfaVerify admin endpoint="/api/admin/mfa" next={next} /></div>;
  }
  return (
    <div className="narrow">
      <p className="hint" style={{ marginTop: 0 }}>
        {adminMfaEnforced()
          ? 'Two-factor sign-in is required for administrator accounts.'
          : 'Set this up now. It is not enforced until ADMIN_MFA=on is set in the hosting settings.'}
      </p>
      <VendorSecurity admin endpoint="/api/admin/mfa" next={next}
        initial={{ enrolled: st.enrolled, recoveryLeft: st.recoveryLeft, required: true, available: mfaAvailable(), mustEnrol: !st.enrolled && adminMfaEnforced(), daysLeft: 0, verified }} />
    </div>
  );
}
