import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { hasDb } from '../../../lib/db';
import { listLeads } from '../../../lib/leads';
import SalesNav from '../../../components/SalesNav';
import PipelineBoard from '../../../components/PipelineBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pipeline — Sales Hub' };

export default async function PipelinePage({ searchParams }) {
  const sp = await searchParams;
  const g = await hubPage('/sales/pipeline');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;
  const owner = viewer.admin && sp?.owner ? String(sp.owner) : undefined;
  const leads = await listLeads({ side, owner, limit: 1000 }, viewer);
  return (
    <div>
      <SalesNav side={side} name={viewer.name} admin={viewer.admin} />
      {owner && <p className="hint" style={{ margin: '0 0 8px' }}>Showing {owner === 'pool' ? 'the unassigned pool' : owner}’s pipeline. <a href="/sales/pipeline">Show everyone</a> · <a href="/sales/team">Back to Team</a></p>}
      <PipelineBoard initial={leads} showOwner={viewer.admin && !owner} />
    </div>
  );
}
