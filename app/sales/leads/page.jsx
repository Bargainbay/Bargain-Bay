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
  const leads = await listLeads({ side, stage: sp?.stage, q: sp?.q }, viewer);
  return (
    <div>
      <SalesNav side={side} name={viewer.name} />
      <SalesLeads initial={leads} isAdmin={viewer.admin} openId={sp?.open ? Number(sp.open) : null} side={side} />
    </div>
  );
}
