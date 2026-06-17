import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { emailConfigured } from '../../../lib/email';
import { smsConfigured } from '../../../lib/sms';
import AdminNav from '../../../components/AdminNav';
import CampaignComposer from '../../../components/CampaignComposer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaigns — Bargain Bay' };

export default async function CampaignsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/campaigns');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p>
    </div></div>);
  }

  return (
    <div>
      <AdminNav active="campaigns" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Campaigns</h1>
      <div className="panel">
        <p className="hint" style={{ marginTop: 0 }}>
          Send an email or text blast to a customer segment. Always send yourself a <b>test</b> first.
        </p>
        <CampaignComposer emailConfigured={emailConfigured()} smsConfigured={smsConfigured()} />
      </div>
    </div>
  );
}
