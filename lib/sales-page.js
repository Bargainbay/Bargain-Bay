// Shared gate for every /sales page: sign-in, then rep-or-admin, and the chosen side.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from './auth';
import { hubViewer } from './sales-access';

/** Returns { viewer, side } or a { denied: true } marker the page renders as "Not authorized". */
export async function hubPage(nextPath = '/sales') {
  const session = await getSession();
  if (!session) redirect(`/login?next=${nextPath}`);
  const viewer = hubViewer(session);
  if (!viewer) return { denied: true, email: session.email };
  const jar = await cookies();
  const s = jar.get('bb_hub_side')?.value;
  return { viewer, side: s === 'bb' || s === 'rs' ? s : 'all' };
}

export function NotAuthorized({ email }) {
  return (
    <div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({email}) doesn&apos;t have access to the Sales Hub.</p>
    </div></div>
  );
}

/** A rep's tracking code: their initials, e.g. John Tobias -> JT. */
export const repCode = (name, email) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const s = parts.length ? parts.map((p) => p[0]).join('') : String(email || '').split('@')[0].slice(0, 3);
  return s.toUpperCase().slice(0, 4);
};
