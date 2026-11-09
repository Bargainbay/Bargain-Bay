import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { hasDb } from '../../../lib/db';
import { listLeads } from '../../../lib/leads';
import SalesNav from '../../../components/SalesNav';
import SalesLeads from '../../../components/SalesLeads';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads — Sales Hub' };

export default async function LeadsPage({ searchParams }) {
  const sp = await searchParams;
  const g = await hubPage('/sales/leads');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;
  // The owner can look at one rep's leads (?owner=their email, or ?owner=pool): the Team page links here.
  const owner = viewer.admin && sp?.owner ? String(sp.owner) : undefined;
  const leads = await listLeads({ side, stage: sp?.stage, q: sp?.q, owner }, viewer);
  return (
    <div>
      <SalesNav side={side} name={viewer.name} admin={viewer.admin} />
      {owner && <p className="hint" style={{ margin: '0 0 8px' }}>Showing {owner === 'pool' ? 'the unassigned pool' : owner}’s leads. <a href="/sales/leads">Show everyone</a> · <a href="/sales/team">Back to Team</a></p>}
      <SalesLeads initial={leads} isAdmin={viewer.admin} openId={sp?.open ? Number(sp.open) : null} side={side} owner={owner} />
    </div>
  );
}
