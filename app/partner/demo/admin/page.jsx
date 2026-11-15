import { money } from '../../../../lib/constants';
import { DEMO_ADMIN as D } from '../../../../lib/partner-demo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin preview — Bargain Bay', robots: { index: false } };

// The owner's three partner admin pages, from INVENTED data, no login, no database. Nothing here is real and no button works.
const Tab = ({ href, on, children }) => <a className={`btn${on ? ' btn-primary' : ''}`} href={href}>{children}</a>;
const Kpi = ({ l, v }) => (<div><div className="hint">{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>);

export default async function AdminDemo({ searchParams }) {
  const sp = (await searchParams) || {};
  const tab = ['portfolio', 'leads'].includes(sp.tab) ? sp.tab : 'partners';
  return (
    <div className="narrow" style={{ maxWidth: 1000 }}>
      <div className="panel" style={{ marginBottom: 12, background: '#fff8e1' }}>
        <b>Admin preview with example data.</b> Everything here is invented and the buttons do nothing. These are the owner's pages: partners, the portfolio, and the lead queue our reps work.
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <Tab href="/partner/demo/admin?tab=partners" on={tab === 'partners'}>Referral partners</Tab>
          <Tab href="/partner/demo/admin?tab=portfolio" on={tab === 'portfolio'}>Partner portfolio</Tab>
          <Tab href="/partner/demo/admin?tab=leads" on={tab === 'leads'}>Partner leads</Tab>
          <Tab href="/partner/demo" on={false}>Partner dashboards</Tab>
        </div>
      </div>

      {tab === 'partners' && (<>
        <p className="hint" style={{ margin: '0 0 4px' }}>/admin/referral-partners · admin only</p>
        <h1 style={{ color: 'var(--charcoal)', marginTop: 0 }}>Referral partners</h1>
        <div className="panel" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Add or change a partner</h2>
          <p className="hint" style={{ margin: 0 }}>Email, name, end-user % off, how they are paid (on profit, on sale price, or the spread over member price), % of profit at member price, lead generators on or off. Adding one creates their login and emails a 7-day set-password link.</p>
        </div>
        {D.partners.map((p) => (
          <div className="panel" key={p.email} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong style={{ flex: 1, minWidth: 0 }}>{p.name} <span className="hint">{p.email} · paid {p.pay} · link code {p.code} · end-user code {p.customerCode} · {p.clients} clients</span></strong>
              <span style={{ color: '#15803d', fontWeight: 700 }}>{p.status}</span>
            </div>
            {p.sales != null && <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 8 }}><Kpi l="Sales" v={money(p.sales)} /><Kpi l="Earned" v={money(p.earned)} /><Kpi l="Paid" v={money(p.paid)} /><Kpi l="Balance owed" v={money(p.earned - p.paid)} /></div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}><span className="btn">Send sign-in email</span><span className="btn">Change link code</span><span className="btn">Record a payment</span><span className="btn">Team</span><span className="btn" style={{ color: '#a4262c' }}>Revoke</span></div>
          </div>))}
        <p className="hint">Revoking a partner switches off every code it and its generators hold and frees the link code for reuse. Past leads and credit stay on record.</p>
      </>)}

      {tab === 'portfolio' && (<>
        <p className="hint" style={{ margin: '0 0 4px' }}>/admin/partner-portfolio · admin only</p>
        <h1 style={{ color: 'var(--charcoal)', marginTop: 0 }}>Partner portfolio</h1>
        <div className="panel" style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 12 }}>
          <Kpi l="Organisations" v={D.portfolioTotals.orgs} /><Kpi l="Generators" v={D.portfolioTotals.generators} /><Kpi l="Leads sent" v={D.portfolioTotals.leads} /><Kpi l="Sold" v={D.portfolioTotals.sold} /><Kpi l="Sales" v={money(D.portfolioTotals.sales)} /><Kpi l="Commission earned" v={money(D.portfolioTotals.earned)} />
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Aljo Systems: generators</h2>
          <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
            <thead><tr><th>Generator</th><th>Code</th><th>Sent</th><th>With team</th><th>Called</th><th>Sold</th><th>Duplicates refused</th><th>Posting</th><th>Last lead</th></tr></thead>
            <tbody>{D.generators.map((g) => (<tr key={g.code}><td>{g.name}</td><td>{g.code}</td><td>{g.sent}</td><td>{g.team}</td><td>{g.called}</td><td>{g.sold}</td><td>{g.dups}</td><td>{g.posting}</td><td>{g.last}</td></tr>))}</tbody>
          </table></div>
        </div>
        <div className="panel"><h2 style={{ marginTop: 0, fontSize: 17 }}>Change log</h2>
          {D.changes.map((c, i) => (<div key={i} className="hint">{c[0]} · {c[1]} · {c[2]}</div>))}</div>
      </>)}

      {tab === 'leads' && (<>
        <p className="hint" style={{ margin: '0 0 4px' }}>/admin/partner-leads · sales reps and admin</p>
        <h1 style={{ color: 'var(--charcoal)', marginTop: 0 }}>Partner leads</h1>
        <p className="hint" style={{ marginTop: 0 }}>Warm leads from lead generators. Nobody owns them until a rep presses Claim. Alerts email the sales list when one arrives, and again if it waits over two hours.</p>
        <div className="panel" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Waiting to be claimed ({D.queue.length})</h2>
          <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
            <thead><tr><th>Customer</th><th>Wants</th><th>How reached</th><th>Sent by</th><th>Waiting</th><th></th></tr></thead>
            <tbody>{D.queue.map((q) => (<tr key={q.name}><td><b>{q.name}</b><div className="hint">{q.contact}</div></td><td>{q.wants}</td><td>{q.how}</td><td>{q.sender}</td><td style={{ color: q.late ? '#a4262c' : undefined, fontWeight: q.late ? 700 : undefined }}>{q.waiting}</td><td><span className="btn btn-primary">Claim</span></td></tr>))}</tbody>
          </table></div>
        </div>
        <p className="hint">If two generators send the same phone or email, the first one in time wins. The second is refused and told it was already entered (never by whom), and the attempt is logged with a timestamp.</p>
      </>)}
    </div>
  );
}
