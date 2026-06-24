import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import OpsCopilot from '../../../components/OpsCopilot';
import PlaybookEditor from '../../../components/PlaybookEditor';
import AgentRoster from '../../../components/AgentRoster';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sarah — Bargain Bay' };

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
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 6px' }}>Sarah &amp; the team</h1>
      <p className="hint" style={{ marginTop: 0, maxWidth: 720 }}>
        Sarah is your chief of staff — she answers you and hands work to a team of specialists (Sales, Customer Service,
        Delivery, Technical, Accounting, Marketing, HR). Chat with any of them below, train each one in its playbook
        section, and dial up its autonomy as you trust it. They handle <b>invoicing</b> and <b>inventory</b> today, advise
        across everything, and learn every decision you confirm — more actions are wired in over time.
      </p>

      {!ready && (
        <div className="error-box" style={{ marginBottom: 14 }}>
          The team needs <code>ANTHROPIC_API_KEY</code> set in the environment before it can chat.
        </div>
      )}

      <div className="panel">
        <OpsCopilot />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Your AI team &amp; autonomy</h2>
        <AgentRoster />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Train the team — playbooks</h2>
        <PlaybookEditor />
      </div>
    </div>
  );
}
