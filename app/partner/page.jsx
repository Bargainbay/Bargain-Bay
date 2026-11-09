import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { getPartner, partnerReport } from '../../lib/referral-partners';
import { money } from '../../lib/constants';
import PartnerSignOut from '../../components/PartnerSignOut';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My clients — Bargain Bay', robots: { index: false } };

// A referral partner's page: their clients, each client's orders and live status, and the commission
// owed. A partner is read from the SESSION; an admin may preview one with ?as=<email>. Nothing in the
// request can name whose clients to read for anyone else. Cost and profit are never returned.
export default async function PartnerPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/partner');
  const sp = (await searchParams) || {};
  const asked = typeof sp.as === 'string' ? sp.as : '';
  const email = isAdmin(session) && asked ? asked : session.email;
  const partner = hasDb() ? await getPartner(email) : null;
  if (!partner) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not a referral partner</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) has not been set up as a referral partner. Contact Bargain Bay.</p>
    </div></div>);
  }
  const r = await partnerReport(partner.email);
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'short', day: 'numeric' }) : '');
  return (
    <div className="narrow" style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <h1 style={{ color: 'var(--charcoal)', margin: 0, flex: 1 }}>My clients{r.partner?.name ? ` — ${r.partner.name}` : ''}</h1>
        <PartnerSignOut />
      </div>
      <div className="panel" style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <div><div className="hint">Clients</div><div style={{ fontSize: 24, fontWeight: 700 }}>{r.clients.length}</div></div>
        <div><div className="hint">Orders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{r.totals.orders}</div></div>
        <div><div className="hint">Sales (before tax)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{money(r.totals.sales)}</div></div>
        <div><div className="hint">Commission owed ({r.partner.pct}% of profit)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{money(r.totals.commission)}</div></div>
      </div>
      <p className="hint" style={{ margin: '8px 2px 16px' }}>
        Commission is {r.partner.pct}% of the profit on each order your clients place. Cancelled and refunded orders drop off automatically.
        {r.totals.missingCost > 0 ? ' Some units are still waiting for their cost to be entered, so those orders may show less commission until it is.' : ''}
      </p>
      {r.clients.length === 0 && <div className="panel">No clients are linked to you yet.</div>}
      {r.clients.map((c) => (
        <div className="panel" key={c.id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{c.name || c.email}</h2>
            <span className="hint">{c.orders.length} order{c.orders.length === 1 ? '' : 's'} · {money(c.sales)} · commission {money(c.commission)}</span>
          </div>
          {c.orders.length === 0 ? <p className="hint" style={{ marginBottom: 0 }}>No orders yet.</p> : (
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
              <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total (pre-tax)</th><th>Status</th><th>Commission</th></tr></thead>
              <tbody>{c.orders.map((o) => (
                <tr key={o.number}>
                  <td>{o.number}</td><td>{fmt(o.at)}</td><td>{o.items || '—'}</td>
                  <td>{money(o.subtotal)}</td><td>{o.statusLabel}</td><td>{money(o.commission)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </div>
      ))}
    </div>
  );
}
