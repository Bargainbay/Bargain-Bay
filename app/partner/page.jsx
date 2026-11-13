import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { getPartner, getPartnerSeat, partnerReport, rateText } from '../../lib/referral-partners';
import { money } from '../../lib/constants';
import CopyLink from '../../components/CopyLink';
import PartnerRequest from '../../components/PartnerRequest';
import PartnerSignOut from '../../components/PartnerSignOut';
import PartnerTeam from '../../components/PartnerTeam';
import PartnerLeadDesk from '../../components/PartnerLeadDesk';
import PartnerPostingKit from '../../components/PartnerPostingKit';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My clients — Bargain Bay', robots: { index: false } };

const MEMBER = { approved: 'Reseller pricing approved', pending: 'Reseller application pending', none: 'Retail customer' };

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
    // A lead generator is not a partner here (getPartner refuses them on purpose) and must never be shown the
    // organisation's money. They get their own, much smaller page; an admin previewing with ?as= never reaches it.
    const seat = !preview && hasDb() ? await getPartnerSeat(session.email) : null;
    if (seat?.role === 'affiliate') {
      return (<div className="narrow"><div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ marginTop: 0, color: 'var(--charcoal)', flex: 1 }}>Welcome{seat.name ? `, ${seat.name.split(' ')[0]}` : ''}</h1>
          <PartnerSignOut />
        </div>
        <p style={{ fontSize: 14 }}>You are signed in with {seat.orgName || 'your team'}. Send a lead below and see what happened to each one you sent. <a href="/account?stay=1" style={{ textDecoration: 'underline' }}>My orders and profile</a></p>
      </div>
      <PartnerLeadDesk role="affiliate" />
      <PartnerPostingKit /></div>);
    }
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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Link for resellers</div>
          <p className="hint" style={{ marginTop: 0 }}>For businesses that buy to resell. When they use it to create an account and apply as a reseller, they are added to your clients automatically. Reseller pricing is switched on once Bargain Bay approves them.</p>
          <CopyLink link={r.partner.link} />
          {r.partner.customerLink && (<>
            <div style={{ fontWeight: 700, margin: '16px 0 4px' }}>Link for end users</div>
            <p className="hint" style={{ marginTop: 0 }}>For shoppers buying for themselves. It opens the shop with the code <b>{r.partner.customerCode}</b> ready to apply, for {r.partner.customerPct}% off. Anyone who buys through it, or with the code, is added to your clients.</p>
            <CopyLink link={r.partner.customerLink} />
          </>)}
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 12 }}>
            {stat('People who opened a link', r.visits.total, `${r.visits.recent} in the last 30 days`)}
            {stat('Signed up or ordered', r.funnel.signedUp)}
            {stat('Applied as resellers', r.funnel.applied)}
            {stat('Approved', r.funnel.approved)}
          </div>
        </div>
      )}

      {!preview && <PartnerTeam team={r.team} me={session.email} generators={r.partner.generators} />}
      {!preview && r.partner.generators && <div style={{ marginBottom: 12 }}><PartnerLeadDesk role="admin" /></div>}
      {!preview && r.partner.generators && <PartnerPostingKit />}

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
        {r.partner.basis === 'price'
          ? <>Commission is {r.partner.pricePct}% of the sale price (after any discount, before tax) on each order your resellers place, and {r.partner.pricePctRetail}% on sales made with your end-user code, but never more than {r.partner.capPct}% of the profit on that order. </>
          : <>Commission is {r.partner.pct}% of the profit on each order your resellers place, and {r.partner.retailPct}% on sales made with your end-user code (that sale carries the {r.partner.customerPct}% customer discount). </>}
        It becomes earned once the order is delivered and paid for.
        Cancelled and refunded orders drop off automatically.
        <br /><b>How profit is worked out:</b> the order's sale price before tax, less any discount or promo code the customer used, less what the units cost Bargain Bay (what we paid, plus any parts and labour on that unit). Delivery fees and HST are not included. An order that lost money earns $0. Commission is the rate on that line applied to the profit (or to the sale price, where your deal is a share of price, up to the profit cap). Ask us and we will walk you through any order.
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
            {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details on file'} · {MEMBER[c.membership]}{c.generator ? ` · via ${c.generator}` : ''}
          </div>
          {c.orders.length === 0 ? <p className="hint" style={{ marginBottom: 0 }}>No orders yet.</p> : (
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
              <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>How</th><th>Total (pre-tax)</th><th>Discount</th><th>Profit</th><th>Rate</th><th>Status</th><th>Commission</th></tr></thead>
              <tbody>{c.orders.map((o) => (
                <tr key={o.number}>
                  <td>{o.number}</td><td>{fmt(o.at)}</td><td>{o.items || '—'}</td><td>{o.own ? 'your own team (no commission)' : o.source === 'lead' ? 'from a lead' : o.source === 'code' ? 'with a code' : 'reseller'}</td>
                  <td>{money(o.subtotal)}</td><td>{o.discount > 0 ? money(o.discount) : '—'}</td><td>{money(o.profit)}</td><td>{rateText(o)}</td><td>{o.statusLabel}</td><td>{money(o.commission)} <span className="hint">{o.earned ? 'earned' : 'pending'}</span></td>
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
