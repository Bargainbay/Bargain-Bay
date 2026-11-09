import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { hasDb, query } from '../../../lib/db';
import { teamOverview } from '../../../lib/leads';
import { repToday, getPlans, openShift } from '../../../lib/sales-commission';
import SalesNav from '../../../components/SalesNav';
import TeamBoard from '../../../components/TeamBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team — Sales Hub' };

// The OWNER's view of each rep: where their leads are in the process, what they did today, how they stand against
// their quota, and the leads that need a hand. Admin only — a rep never sees another rep's leads, and this page
// carries every rep's. Reading it changes nothing; acting on a lead happens on the Leads page.
export default async function TeamPage() {
  const g = await hubPage('/sales/team');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer } = g;
  if (!viewer.admin) return <NotAuthorized email={viewer.email} />;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;

  const [overview, plans] = await Promise.all([teamOverview(), getPlans()]);
  // Anyone on the commission plan is a rep even before their first lead.
  const known = new Set(overview.reps.map((r) => r.owner));
  for (const email of Object.keys(plans)) if (!known.has(email)) {
    overview.reps.push({ owner: email, stages: {}, openLeads: 0, openValue: 0, today: { touches: 0, conversations: 0, meetings: 0, proposals: 0 }, allTime: { touches: 0, conversations: 0, meetings: 0, proposals: 0 }, lastActivityAt: null, needsHelp: [] });
  }
  const names = new Map();
  const { rows: users } = await query(`SELECT lower(email) AS e, name FROM users WHERE lower(email) = ANY($1)`, [overview.reps.map((r) => r.owner)]).catch(() => ({ rows: [] }));
  for (const u of users) names.set(u.e, u.name);

  const reps = await Promise.all(overview.reps.map(async (r) => ({
    ...r,
    name: plans[r.owner]?.name || names.get(r.owner) || r.owner.split('@')[0],
    onPlan: !!plans[r.owner],
    // the collected-sales tracker and the shop clock exist only for a rep on the commission plan
    tracker: plans[r.owner] ? await repToday(r.owner).catch(() => null) : null,
    atShopSince: plans[r.owner] ? (await openShift(r.owner).catch(() => null))?.started_at || null : null
  })));

  return (
    <div>
      {/* The Team page covers both businesses, so it ignores the Bargain Bay | RS Solutions toggle and shows All. */}
      <SalesNav side="all" name={viewer.name} admin />
      <TeamBoard reps={reps} pool={overview.pool} recent={overview.recent} />
    </div>
  );
}
