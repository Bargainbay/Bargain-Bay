import { money } from '../../../lib/constants';
import { LeadBoard } from '../../../components/PartnerLeadDesk';
import { WANTS, HOW_REACHED } from '../../../lib/partner-lead-rules';
import { DEMO_ORGS, DEMO_ALJO_LEADS, DEMO_GEN_LEADS, DEMO_UNITS } from '../../../lib/partner-demo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner dashboard preview — Bargain Bay', robots: { index: false } };

// A preview of what a partner sees, from INVENTED data, with no login and no database, like /client/demo.
// ?org=aljo | secondshop, and ?view=generator for a lead generator's smaller page. Nothing here is real.
const Tab = ({ href, on, children }) => <a className={`btn${on ? ' btn-primary' : ''}`} href={href}>{children}</a>;
const stat = (label, value, hint) => (<div><div className="hint">{label}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>{hint && <div className="hint" style={{ fontSize: 11.5 }}>{hint}</div>}</div>);


const Reference = () => (
  <div className="panel" style={{ marginBottom: 14 }}>
    <div style={{ fontWeight: 700, marginBottom: 8 }}>Learn and reference</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div style={{ flex: 1, minWidth: 160 }}><b style={{ fontSize: 14 }}>Training manual</b><div className="hint" style={{ fontSize: 12.5 }}>How to post, send leads and use your code. About 15 minutes.</div></div><span className="btn btn-primary">Open the manual</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div style={{ flex: 1, minWidth: 160 }}><b style={{ fontSize: 14 }}>Delivery and installation rate sheet</b><div className="hint" style={{ fontSize: 12.5 }}>What delivery, haul-away and installation cost, and what each includes.</div></div><span className="btn">Open the rates</span></div>
    </div>
  </div>
);
const MyCode = () => (
  <div className="panel" style={{ marginBottom: 14 }}>
    <h2 style={{ marginTop: 0, fontSize: 18 }}>Your code and link</h2>
    <p className="hint" style={{ marginTop: 0 }}>Your code is <b>ALJO-ANNA</b>. Shoppers who use it at bargainbay.ca get 5% off, and the sale is credited to you. Share your link or your code.</p>
    <code>https://bargainbay.ca/join/aljo/shop?ref=ALJO-ANNA</code>
    <p className="hint" style={{ marginBottom: 0 }}>Orders from your customers so far: <b>2</b> (1 delivered).</p>
  </div>
);
const SendLead = () => (
  <div className="panel" style={{ marginBottom: 14 }}>
    <h2 style={{ marginTop: 0, fontSize: 18 }}>Send a lead</h2>
    <p className="hint" style={{ marginTop: 0 }}>Only someone who contacted <b>you</b>. Double-check the phone number: it is the only way we can reach them.</p>
    <div style={{ marginBottom: 10 }}><span className="btn">Fill it in from a screenshot</span></div>
    <div style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
      <input placeholder="Their name" readOnly /><input placeholder="Phone (10 digits)" readOnly /><input placeholder="Email (if you have it)" readOnly />
      <select disabled><option>What do they want?</option>{WANTS.map(([k, l]) => <option key={k}>{l}</option>)}</select>
      <select disabled><option>How did they reach you?</option>{HOW_REACHED.map(([k, l]) => <option key={k}>{l}</option>)}</select>
      <textarea placeholder="Anything we should know (what they asked about, where they are, best time to call)" rows={3} readOnly />
      <span className="btn btn-primary" style={{ textAlign: 'center' }}>Send lead</span>
    </div>
  </div>
);
const Kit = () => (
  <div className="panel" style={{ marginBottom: 14 }}>
    <h2 style={{ marginTop: 0, fontSize: 18 }}>Post our stock on Facebook</h2>
    <ol className="hint" style={{ margin: '0 0 10px', paddingLeft: 18 }}><li>Tap Copy the words, then save the photos.</li><li>Post it on Facebook Marketplace.</li><li>Tick Posted. We email you each night what sold, so you can take it down.</li></ol>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}><span className="btn btn-primary">To post (2)</span><span className="btn">New since last night (1)</span><span className="btn">Posted (1)</span><span className="btn">All (3)</span></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
      {DEMO_UNITS.map((u) => (
        <div key={u.sku} style={{ border: '1px solid #e5e5e0', borderRadius: 8, padding: 10, background: '#fff' }}>
          <div style={{ aspectRatio: '4/3', background: '#eceae5', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#777', fontSize: 12 }}>photo</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>{u.title}</div>
          <div className="hint">{u.cond} · {money(u.price)}</div>
          {u.tag === 'SOLD' ? <div style={{ marginTop: 8, fontSize: 12.5, color: '#a4262c', fontWeight: 700 }}>Sold: take it down</div> : (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {u.tag === 'NEW' && <b style={{ fontSize: 12, color: '#1d4f91' }}>NEW</b>}<span className="btn btn-primary">Copy the words</span><span className="btn">Photos (6)</span><span className="btn">Mark as posted</span></div>)}
        </div>))}
    </div>
  </div>
);

const Team = () => (
  <div className="panel" style={{ marginBottom: 14 }}>
    <h2 style={{ marginTop: 0, fontSize: 18 }}>Your team</h2>
    <p className="hint" style={{ marginTop: 0 }}>Admins sign in with their own email and see the same clients, orders and commission. Lead generators see only the leads they send themselves, and never any money.</p>
    {[['Aljo Systems · info@aljosystems.com (main login)', ''], ['Anna Lopez · anna@example.com · lead generator · code ALJO-ANNA', 'Remove'], ['Ben Ray · ben@example.com · lead generator · code ALJO-BEN', 'Remove'], ['Carla Singh · carla@example.com · lead generator · code ALJO-CARLA', 'Remove']].map(([t, r]) => (
      <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid #eceae5' }}><span style={{ flex: 1 }}>{t}</span>{r && <span className="btn">{r}</span>}</div>))}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      <input placeholder="Name" readOnly /><input placeholder="Email" readOnly />
      <select disabled><option>Lead generator (sees only their own)</option></select>
      <span className="btn btn-primary">Add a lead generator</span>
    </div>
  </div>
);

export default async function PartnerDemo({ searchParams }) {
  const sp = (await searchParams) || {};
  const key = sp.org === 'secondshop' ? 'secondshop' : 'aljo';
  const gen = key === 'aljo' && sp.view === 'generator';
  const o = DEMO_ORGS[key];
  return (
    <div className="narrow" style={{ maxWidth: 980 }}>
      <div className="panel" style={{ marginBottom: 12, background: '#fff8e1' }}>
        <b>Preview with example data.</b> Every name, order and figure on this page is invented. Nothing here is real or connected to anyone's account.
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <Tab href="/partner/demo?org=aljo" on={key === 'aljo' && !gen}>Aljo: organisation</Tab>
          <Tab href="/partner/demo?org=aljo&view=generator" on={gen}>Aljo: a lead generator</Tab>
          <Tab href="/partner/demo?org=secondshop" on={key === 'secondshop'}>SecondShop</Tab>
          <Tab href="/partner/demo/admin" on={false}>Owner's admin pages</Tab>
        </div>
      </div>

      {gen ? (<>
        <div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Welcome, Anna</h1>
          <p style={{ fontSize: 14 }}>You are signed in with Aljo Systems. Send a lead and see what happened to each one you sent. Your code is <b>ALJO-ANNA</b>: customers get 5% off with it. You never see prices, profit or other generators.</p></div>
        <Reference /><MyCode /><SendLead />
        <div className="panel" style={{ marginBottom: 14 }}><h2 style={{ marginTop: 0, fontSize: 18 }}>What happened to your leads</h2><LeadBoard leads={DEMO_GEN_LEADS} admin={false} /></div>
        <Kit />
      </>) : (<>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 16px' }}>
          <h1 style={{ color: 'var(--charcoal)', margin: 0, flex: 1 }}>My clients — {o.name}</h1>
          <span className="btn">Monthly statement</span>
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Link for resellers</div>
          <code>https://bargainbay.ca/join/{o.code}</code>
          <div style={{ fontWeight: 700, margin: '14px 0 4px' }}>Link for end users</div>
          <p className="hint" style={{ marginTop: 0 }}>Opens the shop with the code <b>{o.customerCode}</b> ready to apply, for {o.customerPct}% off.</p>
          <code>https://bargainbay.ca/join/{o.code}/shop</code>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 12 }}>
            {stat('People who opened a link', o.visits.total, `${o.visits.recent} in the last 30 days`)}
            {stat('Signed up or ordered', o.visits.signedUp)}{stat('Applied as resellers', o.visits.applied)}{stat('Approved', o.visits.approved)}
          </div>
        </div>

        {key === 'aljo' && (<>
          <Team /><Reference /><SendLead />
          <div className="panel" style={{ marginBottom: 12 }}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>All your leads</h2>
            <LeadBoard leads={DEMO_ALJO_LEADS} admin />
          </div>
          <Kit />
        </>)}

        <div className="panel" style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {stat('Clients', o.stats.clients)}{stat('Orders', o.stats.orders)}{stat('Sales (before tax)', money(o.stats.sales))}
          {stat('Commission earned', money(o.stats.earned), 'delivered and paid')}{stat('Pending', money(o.stats.pending), 'placed, not yet delivered and paid')}
          {stat('Paid to you', money(o.stats.paid))}{stat('Balance owed to you', money(o.stats.earned - o.stats.paid))}
        </div>
        <p className="hint" style={{ margin: '8px 2px 16px' }}>
          {o.basis === 'spread' ? o.note : `Commission is ${o.pct}% of the profit on each order your resellers place, and ${o.retailPct}% on sales made with your end-user code (that sale carries the ${o.customerPct}% customer discount). `}
          It becomes earned once the order is delivered and paid for. Cancelled and refunded orders drop off automatically.
        </p>
        {o.clients.map((c) => (
          <div className="panel" key={c.name} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}><h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{c.name}</h2>
              <span className="hint">{c.orders.length} order{c.orders.length === 1 ? '' : 's'}</span></div>
            <div className="hint" style={{ margin: '4px 0 8px' }}>{c.contact}{c.via ? ` · ${c.via}` : ''}</div>
            {c.orders.length === 0 ? <p className="hint" style={{ marginBottom: 0 }}>No orders yet.</p> : (
              <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
                <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>How</th><th>Total (pre-tax)</th><th>Discount</th><th>Profit</th><th>Rate</th><th>Status</th><th>Commission</th></tr></thead>
                <tbody>{c.orders.map((x) => (<tr key={x.number}><td>{x.number}</td><td>{x.date}</td><td>{x.items}</td><td>{x.how}</td><td>{money(x.total)}</td><td>{x.discount > 0 ? money(x.discount) : '—'}</td><td>{money(x.profit)}</td><td>{x.rate}</td><td>{x.status}</td><td>{money(x.commission)} <span className="hint">{x.earned ? 'earned' : 'pending'}</span></td></tr>))}</tbody>
              </table></div>)}
          </div>))}
      </>)}
    </div>
  );
}
