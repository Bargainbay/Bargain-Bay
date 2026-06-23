import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import OpsCopilot from '../../../components/OpsCopilot';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Copilot — Bargain Bay' };

export default async function AgentPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/agent');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p>
    </div></div>);
  }

  const ready = !!process.env.ANTHROPIC_API_KEY;

  return (
    <div>
      <AdminNav active="copilot" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 6px' }}>Operations Copilot</h1>
      <p className="hint" style={{ marginTop: 0, maxWidth: 680 }}>
        Your AI assistant for the daily grind. Right now it handles <b>invoicing</b> and <b>inventory</b> — create &amp; send
        invoices, mark them paid, search stock, reprice or relist units, and sync from the tracker. More (deliveries, run
        sheets, daily brief) is on the way.
      </p>

      {!ready && (
        <div className="error-box" style={{ marginBottom: 14 }}>
          The copilot needs <code>ANTHROPIC_API_KEY</code> set in the environment before it can chat.
        </div>
      )}

      <div className="panel">
        <OpsCopilot />
      </div>
    </div>
  );
}
