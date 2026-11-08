import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { hasDb } from '../../../lib/db';
import { statementFor, listStatements, repPlan, addDays, weekStartOf } from '../../../lib/sales-commission';
import { torontoToday } from '../../../lib/constants';
import SalesNav from '../../../components/SalesNav';
import StatementView from '../../../components/StatementView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Performance — Sales Hub' };

// The rep's weekly commission statement, read-only. The rep is the SIGNED-IN person: a week can be
// chosen from the address bar, but never whose statement it is.
export default async function PerformancePage({ searchParams }) {
  const sp = await searchParams;
  const g = await hubPage('/sales/performance');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;

  const plan = await repPlan(viewer.email);
  const thisWeek = weekStartOf(torontoToday());
  const week = /^\d{4}-\d{2}-\d{2}$/.test(sp?.week || '') ? weekStartOf(sp.week) : thisWeek;
  const [statement, past] = plan ? await Promise.all([statementFor(viewer.email, week), listStatements(viewer.email)]) : [null, []];

  return (
    <div>
      <SalesNav side={side} name={viewer.name} />
      {!plan ? (
        <div className="panel">No commission plan has been set up for your account yet. Ask the owner.</div>
      ) : (
        <>
          <div className="panel">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <a className="btn" href={`/sales/performance?week=${addDays(week, -7)}`}>← Previous week</a>
              {week < thisWeek && <a className="btn" href={`/sales/performance?week=${addDays(week, 7)}`}>Next week →</a>}
              {week !== thisWeek && <a className="btn" href="/sales/performance">This week</a>}
            </div>
            <StatementView s={statement} />
            <p className="hint" style={{ marginBottom: 0 }}>
              Collected Sales are payments actually received, before HST, from accounts you brought in on any day, plus deals you personally
              closed on a day you were clocked in at the shop. A refund comes off as an adjustment in the week it happens. The owner approves
              each week after it ends.
            </p>
          </div>
          {past.length > 0 && (
            <div className="panel">
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Approved statements</h2>
              {past.map((p) => (
                <div key={p.week} style={{ padding: '5px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 14 }}>
                  <a href={`/sales/performance?week=${p.week}`}>Week of {p.week}</a> — ${Number(p.total).toFixed(2)} — {p.status}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
