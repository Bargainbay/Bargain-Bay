import { hubPage, NotAuthorized } from '../../lib/sales-page';
import { hasDb } from '../../lib/db';
import { homeSummary, slaBreaches } from '../../lib/leads';
import { repScorecard } from '../../lib/analytics';
import SalesNav from '../../components/SalesNav';
import MyQuota from '../../components/MyQuota';
import MyDay from '../../components/MyDay';
import LeadAccept from '../../components/LeadAccept';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales Hub' };

function Counter({ label, have, target }) {
  const pct = target ? Math.min(100, Math.round((have / target) * 100)) : 0;
  return (
    <div style={{ flex: '1 1 130px', minWidth: 120 }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--charcoal)' }}>{have}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}> / {target}</span></div>
      <div style={{ height: 6, background: 'var(--panel-alt, #eee)', borderRadius: 4 }}>
        <div style={{ width: `${pct}%`, height: 6, background: pct >= 100 ? 'var(--ok, #2a8)' : 'var(--charcoal, #222)', borderRadius: 4 }} />
      </div>
    </div>
  );
}

export default async function SalesHome() {
  const g = await hubPage('/sales');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;

  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;

  const [home, team, sla] = await Promise.all([
    homeSummary(viewer),
    // The month's quota card (reuses the scorecard). Absent when the login does not
    // resolve to a rep on the team list — somebody else's quota is worse than none.
    repScorecard('month', { name: viewer.name, email: viewer.email }).catch(() => null),
    viewer.admin ? slaBreaches() : Promise.resolve([])
  ]);

  return (
    <div>
      <SalesNav side={side} name={viewer.name} />

      {viewer.admin && sla.length > 0 && (
        <div className="panel" style={{ borderLeft: '4px solid var(--red, #c33)' }}>
          <b>{sla.length} assigned lead{sla.length === 1 ? '' : 's'} with no first touch in 24 hours</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 14 }}>
            {sla.slice(0, 8).map((l) => <li key={l.id}>{l.company || l.contact_name} — {l.owner_email}</li>)}
          </ul>
        </div>
      )}

      {team?.me && <div className="panel"><MyQuota data={team} /></div>}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Today</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Counter label="Touches" have={home.counters.touches} target={home.targets.touches} />
          <Counter label="Conversations" have={home.counters.conversations} target={home.targets.conversations} />
          <Counter label="Meetings booked" have={home.counters.meetings} target={home.targets.meetings} />
          <Counter label="Proposals" have={home.counters.proposals} target={home.targets.proposals} />
        </div>
      </div>

      {home.newAssigned.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>New leads assigned to you</h2>
          <LeadAccept leads={home.newAssigned.map((l) => ({ id: l.id, company: l.company, contact_name: l.contact_name, phone: l.phone, email: l.email, assigned_at: l.assigned_at }))} />
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Follow-ups due</h2>
        {home.overdue.length + home.today.length === 0 && <p className="hint" style={{ margin: 0 }}>Nothing due. Add a next step to a lead and it will show here.</p>}
        {[...home.overdue.map((l) => ({ ...l, late: true })), ...home.today].map((l) => (
          <div key={l.id} style={{ padding: '7px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 14 }}>
            <a href={`/sales/leads?open=${l.id}`} style={{ fontWeight: 700, color: l.late ? 'var(--red, #c33)' : 'var(--charcoal)' }}>{l.company || l.contact_name}</a>
            {' — '}{l.next_step || 'follow up'} <span className="hint">({l.next_step_at}{l.late ? ', overdue' : ''})</span>
            {l.phone && <a href={`tel:${l.phone}`} style={{ marginLeft: 8, fontSize: 13 }}>{l.phone}</a>}
          </div>
        ))}
      </div>

      <div className="panel"><h2 style={{ marginTop: 0, fontSize: 16 }}>Customer follow-ups</h2><MyDay /></div>
    </div>
  );
}
