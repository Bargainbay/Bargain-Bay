import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NotAuthorized } from '../../../lib/sales-page';
import { getSession } from '../../../lib/auth';
import { leadViewer } from '../../../lib/sales-access';
import AdminNav from '../../../components/AdminNav';
import { hasDb } from '../../../lib/db';
import { listLeads } from '../../../lib/leads';
import SalesNav from '../../../components/SalesNav';
import SalesLeads from '../../../components/SalesLeads';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads — Sales Hub' };

export default async function LeadsPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/sales/leads');
  const viewer = await leadViewer(session);
  if (!viewer) return <NotAuthorized email={session.email} />;
  const s = (await cookies()).get('bb_hub_side')?.value;
  const side = !viewer.leadsOnly && (s === 'bb' || s === 'rs') ? s : 'all';
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;
  // The owner can look at one rep's leads (?owner=their email, or ?owner=pool): the Team page links here.
  const owner = viewer.admin && sp?.owner ? String(sp.owner) : undefined;
  const leads = await listLeads({ side, stage: sp?.stage, q: sp?.q, owner }, viewer);
  return (
    <div>
      {viewer.leadsOnly
        ? <><AdminNav active="my-leads" salesOnly /><h1 style={{ color: 'var(--charcoal)', margin: '4px 0 12px' }}>My leads</h1></>
        : <SalesNav side={side} name={viewer.name} admin={viewer.admin} />}
      {owner && <p className="hint" style={{ margin: '0 0 8px' }}>Showing {owner === 'pool' ? 'the unassigned pool' : owner}’s leads. <a href="/sales/leads">Show everyone</a> · <a href="/sales/team">Back to Team</a></p>}
      <SalesLeads initial={leads} isAdmin={viewer.admin} leadsOnly={!!viewer.leadsOnly} openId={sp?.open ? Number(sp.open) : null} side={side} owner={owner} />
    </div>
  );
}
