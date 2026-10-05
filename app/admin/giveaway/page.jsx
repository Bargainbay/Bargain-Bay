import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { giveawayOverview } from '../../../lib/giveaway';
import { GIVEAWAY, dayLabel } from '../../../lib/deals-config';
import AdminNav from '../../../components/AdminNav';
import GiveawayAdmin from '../../../components/GiveawayAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Giveaway — Bargain Bay' };

export default async function GiveawayAdminPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/giveaway');
  if (!isAdmin(session)) {
    return <div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1></div></div>;
  }
  if (!hasDb()) return <div><AdminNav active="giveaway" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  // The table comes from migration 0012; before it has run, show the empty state
  // rather than a 500.
  const initial = await giveawayOverview(GIVEAWAY.id).catch(() => ({ total: 0, tickets: 0, optIns: 0, winner: null, history: [], videos: [] }));
  return (
    <div>
      <AdminNav active="giveaway" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Giveaway</h1>
      <GiveawayAdmin initial={JSON.parse(JSON.stringify(initial))} title={GIVEAWAY.title} drawDate={dayLabel(GIVEAWAY.drawDate)} />
    </div>
  );
}
