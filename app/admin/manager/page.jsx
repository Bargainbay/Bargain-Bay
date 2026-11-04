import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import VoiceManager from '../../../components/VoiceManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Voice Manager — Bargain Bay' };

// The agent that rings the owner. ADMIN only: by voice it can change the
// catalogue and refresh stock, and the number it rings is the owner's.
export default async function ManagerPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/manager');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>The Voice Manager is for the owner. Your account ({session.email}) is not an admin.</p>
    </div></div>);
  }
  return (<div><AdminNav active="manager" /><VoiceManager /></div>);
}
