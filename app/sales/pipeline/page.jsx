import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { hasDb } from '../../../lib/db';
import { listLeads } from '../../../lib/leads';
import SalesNav from '../../../components/SalesNav';
import PipelineBoard from '../../../components/PipelineBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pipeline — Sales Hub' };

export default async function PipelinePage() {
  const g = await hubPage('/sales/pipeline');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;
  const leads = await listLeads({ side, limit: 1000 }, viewer);
  return (
    <div>
      <SalesNav side={side} name={viewer.name} />
      <PipelineBoard initial={leads} />
    </div>
  );
}
