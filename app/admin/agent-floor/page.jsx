import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { loadAgentFloor } from '../../../lib/agent-floor';
import AdminNav from '../../../components/AdminNav';
import AgentFloor from '../../../components/AgentFloor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agent village — Bargain Bay' };

export default async function AgentFloorPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/agent-floor');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="village" /><div className="panel">Database not configured.</div></div>);

  const initial = await loadAgentFloor();
  return (
    <div>
      <AdminNav active="village" />
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Agent village</h1>
        <p className="hint">
          Every scheduled job and assistant, as a minion in the building it works for. Awake and carrying things
          means it ran in the last few minutes. Asleep means it ran on schedule and is resting. A red flag means it
          is late or failing. A grey question mark means nothing here can see it. Same data as the daily health email.
        </p>
        <AgentFloor initial={initial} />
      </div>
    </div>
  );
}
