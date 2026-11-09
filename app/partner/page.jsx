import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { getPartner, partnerReport } from '../../lib/referral-partners';
import { money } from '../../lib/constants';
import CopyLink from '../../components/CopyLink';
import PartnerRequest from '../../components/PartnerRequest';
import PartnerSignOut from '../../components/PartnerSignOut';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My clients — Bargain Bay', robots: { index: false } };

const MEMBER = { approved: 'Member pricing approved', pending: 'Member application pending', none: 'No member application yet' };

// A referral partner's page: their clients, each client's orders and live status, and the commission owed.
// The partner is read from the SESSION; an admin may preview one with ?as=<email>. Nothing in the request
// can name whose clients to read for anyone else. Cost and profit are never returned.
export default async function PartnerPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/partner');
  const sp = (await searchParams) || {};
  const asked = typeof sp.as === 'string' ? sp.as : '';
  const preview = isAdmin(session) && asked;
  const email = preview ? asked : session.email;
  const partner = hasDb() ? await getPartner(email) : null;
  if (!partner) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not a referral partner</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) has not been set up as a referral partner. Contact Bargain Bay.</p>
    </div></div>);
  }
  const r = await partnerReport(partner.email);
  const t = r.totals;
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const stat = (label, value, hint) => (<div><div className="hint">{label}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>{hint && <div className="hint" style={{ fontSize: 11.5 }}>{hint}</div>}</div>);
  return (
    <div className="narrow" style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <h1 style={{ color: 'var(--charcoal)', margin: 0, flex: 1 }}>My clients{r.partner?.name ? ` — ${r.partner.name}` : ''}</h1>
        {!preview && <a href="/account/member" style={{ textDecoration: 'underline', fontSize: 14 }}>Member portal</a>}
        <a className="btn" href={`/partner/statement${preview ? `?as=${encodeURIComponent(asked)}` : ''}`}>Monthly statement</a>
        <PartnerSignOut />
      </div>

      {r.partner.link && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Your sign-up link</div>
          <p className="hint" style={{ marginTop: 0 }}>Send this to your clients. When they use it to create an account and apply for member pricing, they are added to your clients automatically. Member pricing is switched on once Bargain Bay approves them.</p>
          <CopyLink link={r.partner.link} />
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 12 }}>
            {stat('People who opened it', r.visits.total, `${r.visits.recent} in the last 30 days`)}
            {stat('Signed up', r.funnel.signedUp)}
            {stat('Applied for member pricing', r.funnel.applied)}
            {stat('Approved', r.funnel.approved)}
          </div>
        </div>
      )}

      <div className="panel" style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        {stat('Clients', r.clients.length)}
        {stat('Orders', t.orders)}
        {stat('Sales (before tax)', money(t.sales))}
        {stat('Commission earned', money(t.earned), 'delivered and paid')}
        {stat('Pending', money(t.pending), 'placed, not yet delivered and paid')}
        {stat('Paid to you', money(t.paid))}
        {stat('Balance owed to you', money(t.balance))}
      </div>
      <p className="hint" style={{ margin: '8px 2px 16px' }}>
        Commission is {r.partner.pct}% of the profit on each order your clients place. It becomes earned once the order is delivered and paid for.
        Cancelled and refunded orders drop off automatically.
        {t.missingCost > 0 ? ' Some units are still waiting for their cost to be entered, so those orders may show less commission until it is.' : ''}
      </p>

      {r.clients.length === 0 && <div className="panel">No clients are linked to you yet.</div>}
      {r.clients.map((c) => (
        <div className="panel" key={c.id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{c.name || c.email}</h2>
            <span className="hint">{c.orders.length} order{c.orders.length === 1 ? '' : 's'} · {money(c.sales)} · commission {money(c.commission)}</span>
          </div>
          <div className="hint" style={{ margin: '4px 0 8px' }}>
            {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details on file'} · {MEMBER[c.membership]}
          </div>
          {c.orders.length === 0 ? <p className="hint" style={{ marginBottom: 0 }}>No orders yet.</p> : (
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
              <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total (pre-tax)</th><th>Status</th><th>Commission</th></tr></thead>
              <tbody>{c.orders.map((o) => (
                <tr key={o.number}>
                  <td>{o.number}</td><td>{fmt(o.at)}</td><td>{o.items || '—'}</td>
                  <td>{money(o.subtotal)}</td><td>{o.statusLabel}</td><td>{money(o.commission)} <span className="hint">{o.earned ? 'earned' : 'pending'}</span></td>
                </tr>))}</tbody>
            </table></div>
          )}
          {!preview && <PartnerRequest customerId={c.id} clientName={c.name || c.email} />}
        </div>
      ))}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Payments to you</h2>
        {r.payments.length === 0 ? <p className="hint" style={{ marginBottom: 0 }}>No payments recorded yet.</p> : (
          <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
            <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
            <tbody>{r.payments.map((p) => (<tr key={p.id}><td>{p.paid_on}</td><td>{p.method || '—'}</td><td>{p.reference || '—'}</td><td>{money(p.amount)}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
