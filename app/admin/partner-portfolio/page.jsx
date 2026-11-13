import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { partnerPortfolio } from '../../../lib/partner-portfolio';
import { money } from '../../../lib/constants';
import AdminNav from '../../../components/AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner portfolio — Bargain Bay' };

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const FLAG = { money: '#b45309', warn: '#b91c1c', info: '#555' };

export default async function PartnerPortfolioPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/partner-portfolio');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1><p style={{ fontSize: 14 }}>The partner portfolio is for the owner only.</p></div></div>);
  }
  const { orgs, totals, changes } = await partnerPortfolio();
  const stat = (label, value, hint) => (<div><div className="hint">{label}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>{hint && <div className="hint" style={{ fontSize: 11.5 }}>{hint}</div>}</div>);
  return (
    <div>
      <AdminNav active="partners" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <h1 style={{ color: 'var(--charcoal)', margin: 0, flex: 1 }}>Partner portfolio</h1>
        <a className="btn" href="/admin/referral-partners">Add or edit a partner</a>
        <a className="btn" href="/admin/partner-leads">Partner leads queue</a>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Every partner organisation in one place: what they have brought us, what we owe them, their lead generators and anything that needs a look. Partners are added at “Add or edit a partner”; they add their own lead generators.</p>

      {totals && (
        <div className="panel" style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
          {stat('Partners', totals.orgs)}{stat('Lead generators', totals.generators)}{stat('Leads sent', totals.leads, `${totals.leadsSold} sold`)}
          {stat('Orders', totals.orders)}{stat('Sales (pre-tax)', money(totals.sales))}
          {stat('Commission earned', money(totals.earned), 'delivered and paid')}{stat('Pending', money(totals.pending))}{stat('Paid out', money(totals.paid))}{stat('We owe', money(totals.balance))}
        </div>
      )}

      {orgs.length === 0 && <div className="panel">No partner organisations yet. Add one at “Add or edit a partner”.</div>}
      {orgs.map((o) => (
        <div className="panel" key={o.email} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0, fontSize: 19, flex: 1 }}>{o.name} <span className="hint" style={{ fontSize: 12 }}>{o.email} · since {fmt(o.since)}</span></h2>
            <span className="hint">{o.pct}% of profit · leads we close {o.leadPct}% · customer code {o.customerPct}% off{o.generatorsOn ? '' : ' · generators switched OFF'}</span>
          </div>
          {o.flags.length > 0 && (
            <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
              {o.flags.map((f, i) => (<li key={i} style={{ color: FLAG[f.level], fontSize: 14 }}>{f.text}</li>))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '10px 0' }}>
            {stat('Lead generators', o.generators, `${o.admins} admin login${o.admins === 1 ? '' : 's'}`)}
            {stat('Leads sent', o.leads.sent, `last ${fmt(o.lastLead)}`)}
            {stat('Reached / sold', `${o.leads.called} / ${o.leads.sold}`, `${o.leads.completed} completed`)}
            {stat('Refused as duplicates', o.leads.dups)}
            {stat('Clients', o.clients, `${o.visits} link visitors`)}
            {stat('Orders', o.orders, money(o.sales))}
            {stat('Earned', money(o.earned), `${money(o.pending)} pending`)}
            {stat('Paid / owed', `${money(o.paid)} / ${money(o.balance)}`)}
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Lead generators ({o.generatorRows.length})</summary>
            {o.generatorRows.length === 0 ? <p className="hint">None yet.</p> : (
              <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
                <thead><tr><th>Name</th><th>Sent</th><th>With us</th><th>Reached</th><th>Sold</th><th>Completed</th><th>Unreachable</th><th>Junk</th><th>Duplicates</th><th>Last sent</th></tr></thead>
                <tbody>{o.generatorRows.map((g) => (
                  <tr key={g.email}><td>{g.name}<div className="hint" style={{ fontSize: 11.5 }}>{g.email}</div></td><td>{g.sent}</td><td>{g.withTeam}</td><td>{g.called}</td><td>{g.sold}</td><td>{g.completed}</td><td>{g.unreachable}</td><td>{g.notCounted}</td><td>{g.dups}</td><td>{fmt(g.last)}</td></tr>))}</tbody>
              </table></div>
            )}
          </details>
          {o.duplicates.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Recent duplicates ({o.duplicates.length})</summary>
              <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
                <thead><tr><th>When</th><th>Person</th><th>Sent by</th><th>Against</th></tr></thead>
                <tbody>{o.duplicates.map((d, i) => (<tr key={i}><td>{fmt(d.when)}</td><td>{d.name}</td><td>{d.sender}</td><td>{d.againstOwn ? 'their own earlier lead' : d.firstSentBy ? `first sent by ${d.firstSentBy}` : d.kind}</td></tr>))}</tbody>
              </table></div>
            </details>
          )}
        </div>
      ))}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Recent changes</h2>
        {changes.length === 0 ? <p className="hint" style={{ marginBottom: 0 }}>Nothing recorded yet.</p> : (
          <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
            <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
            <tbody>{changes.map((c, i) => (<tr key={i}><td>{fmt(c.at)}</td><td>{c.actor}</td><td>{c.summary || c.action}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
