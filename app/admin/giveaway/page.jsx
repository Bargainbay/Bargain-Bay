import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { giveawayOverview } from '../../../lib/giveaway';
import { GIVEAWAY, GIVEAWAYS, dayLabel } from '../../../lib/deals-config';
import AdminNav from '../../../components/AdminNav';
import GiveawayAdmin from '../../../components/GiveawayAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Giveaway — Bargain Bay' };

export default async function GiveawayAdminPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const g = GIVEAWAYS[sp.g] || GIVEAWAY;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/giveaway');
  if (!isAdmin(session)) {
    return <div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1></div></div>;
  }
  if (!hasDb()) return <div><AdminNav active="giveaway" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  // The table comes from migration 0012; before it has run, show the empty state
  // rather than a 500.
  const initial = await giveawayOverview(g.id).catch(() => ({ total: 0, tickets: 0, optIns: 0, winner: null, history: [], videos: [], costumes: [], entries: [] }));
  return (
    <div>
      <AdminNav active="giveaway" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Giveaway</h1>
      <div className="btn-row" style={{ margin: '0 0 10px' }}>
        {Object.values(GIVEAWAYS).map((x) => (
          <a key={x.id} className={'btn' + (x.id === g.id ? ' primary' : '')} href={`/admin/giveaway?g=${x.id}`}>{x.title}</a>
        ))}
      </div>
      <GiveawayAdmin key={g.id} initial={JSON.parse(JSON.stringify(initial))} giveawayId={g.id} title={g.title} drawDate={dayLabel(g.drawDate)}
        costumeJudgeDate={g.costumeJudgeDate ? dayLabel(g.costumeJudgeDate) : ''} />
    </div>
  );
}
