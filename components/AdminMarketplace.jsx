'use client';
import { useState } from 'react';
import { TIERS, DEDUCTION_REASONS, CLAIM_RESPOND_HOURS, CLAIM_RESOLVE_DAYS, CLAIM_RESOLUTIONS } from '../lib/marketplace-rules';
import MarketplaceClaims from './MarketplaceClaims';

const cents = (n) => `${n < 0 ? '−' : ''}$${(Math.abs(Number(n || 0)) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const STANDING = { good: 'ok', approved: 'ok', warning: 'warn', at_risk: 'warn', restricted: 'warn', suspended: 'warn', applied: '', rejected: '', terminated: 'warn' };

async function api(url, method, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'That did not work.');
  return d;
}

export default function AdminMarketplace({ isAdmin, vendors, queue, due, banks, payouts, orders = [], claims = [], rates = null, serverNow, rejectReasons, strikeReasons }) {
  const apps = vendors.filter((v) => v.status === 'applied');
  const tabs = [
    ['apps', `Applications${apps.length ? ` (${apps.length})` : ''}`],
    ['review', `Listings to review${queue.length ? ` (${queue.length})` : ''}`],
    ['orders', `Orders${orders.filter((o) => ['awaiting_accept', 'accepted'].includes(o.status)).length ? ` (${orders.filter((o) => ['awaiting_accept', 'accepted'].includes(o.status)).length} open)` : ''}`],
    ['claims', `Claims${claims.filter((c) => ['open', 'responded', 'awaiting_refund'].includes(c.status)).length ? ` (${claims.filter((c) => ['open', 'responded', 'awaiting_refund'].includes(c.status)).length} open)` : ''}`],
    ['vendors', 'Vendors'],
    ...(isAdmin ? [
      ['bank', `Bank accounts${banks.length ? ` (${banks.length})` : ''}`],
      ['payouts', 'Payouts'],
      ['strikes', `Strike review${due.length ? ` (${due.length})` : ''}`]
    ] : [])
  ];
  const [tab, setTab] = useState(apps.length ? 'apps' : queue.length ? 'review' : 'vendors');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(null);   // detail payload
  const [listingOpen, setListingOpen] = useState(null);

  async function act(fn, ok, { reload = true } = {}) {
    setBusy(true); setErr(''); setNote('');
    try { const r = await fn(); setNote(ok); if (reload) setTimeout(() => window.location.reload(), 600); return r; }
    catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }
  const post = (url, body) => api(url, 'POST', body);
  async function openVendor(id) {
    setErr('');
    try { setVendorOpen(await api(`/api/admin/marketplace/vendors?id=${id}`, 'GET')); } catch (e) { setErr(e.message); }
  }
  // Any vendor name on any tab is a button to that vendor's page — nobody should have to hunt for it.
  function goVendor(id) { setTab('vendors'); setListingOpen(null); openVendor(id); }
  async function openListing(id) {
    setErr('');
    try { setListingOpen(await api(`/api/admin/marketplace/listings?id=${id}`, 'GET')); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map(([k, label]) => <button key={k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => { setTab(k); setVendorOpen(null); setListingOpen(null); }}>{label}</button>)}
        <a href="/marketplace/sell" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 13 }}>Public application page ↗</a>
      </div>
      {err && <div className="error-box">{err}</div>}
      {note && <div className="panel" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>{note}</div>}

      {tab === 'apps' && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Applications</h2>
          {apps.length === 0 ? <p style={{ margin: 0 }}>No applications waiting.</p> : apps.map((a) => (
            <ApplicationRow key={a.id} a={a} busy={busy} isAdmin={isAdmin}
              onApprove={(hstStatus) => act(() => post('/api/admin/marketplace/vendors', { action: 'approve', vendorId: a.id, hstStatus }), `${a.name} approved.`)}
              onReject={(reason) => act(() => post('/api/admin/marketplace/vendors', { action: 'reject', vendorId: a.id, reason }), 'Rejected.')} />
          ))}
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>
            Before approving: verify the owner&rsquo;s ID, that the business exists and has a real address, and where the stock comes from.
            After approving, open the vendor and add their login (they sign up at /signup with that email).
          </p>
        </div>
      )}

      {tab === 'review' && !listingOpen && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Listings waiting for review</h2>
          <div className="table-wrap"><table className="admin"><thead><tr><th>Submitted</th><th>SKU</th><th>Unit</th><th>Vendor</th><th>Lane</th><th>Price</th><th /></tr></thead><tbody>
            {queue.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>Nothing to review.</td></tr>}
            {queue.map((q) => (
              <tr key={q.id}><td>{day(q.submitted_at)}</td><td style={{ fontFamily: 'ui-monospace, monospace' }}>{q.sku}</td>
                <td>{q.title || `${q.make} ${q.model}`}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{q.condition}</div></td>
                <td><VendorLink id={q.vendor_id} onOpen={goVendor}>{q.vendor}</VendorLink> <span className="pill">{TIERS[q.tier]}</span></td><td>{q.lane}</td><td>${Number(q.price).toLocaleString('en-CA')}</td>
                <td><button className="btn" onClick={() => openListing(q.id)}>Review</button></td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}
      {tab === 'review' && listingOpen && (
        <ListingReview data={listingOpen} busy={busy} rejectReasons={rejectReasons} onClose={() => setListingOpen(null)}
          onDecide={(body) => act(() => post('/api/admin/marketplace/listings', { id: listingOpen.listing.id, ...body }), 'Recorded.')} />
      )}

      {tab === 'vendors' && !vendorOpen && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Vendors</h2>
          <div className="table-wrap"><table className="admin"><thead><tr><th>Vendor</th><th>Standing</th><th>Tier</th><th>Strikes</th><th>For sale</th><th>In review</th><th /></tr></thead><tbody>
            {vendors.filter((v) => v.status !== 'applied').length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No vendors yet.</td></tr>}
            {vendors.filter((v) => v.status !== 'applied').map((v) => (
              <tr key={v.id}><td>{v.name}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{v.email}</div></td>
                <td><span className={`pill ${STANDING[v.standing] || ''}`}>{v.standing.replace('_', ' ')}</span></td>
                <td>{TIERS[v.tier]}</td><td>{v.strikes} / 3</td><td>{v.live}</td><td>{v.inReview}</td>
                <td><button className="btn" onClick={() => openVendor(v.id)}>Open</button></td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}
      {tab === 'vendors' && vendorOpen && (
        <VendorPanel d={vendorOpen} isAdmin={isAdmin} busy={busy} strikeReasons={strikeReasons} onClose={() => setVendorOpen(null)}
          run={(body, ok) => act(() => post('/api/admin/marketplace/vendors', { vendorId: vendorOpen.vendor.id, ...body }), ok, { reload: false }).then(() => openVendor(vendorOpen.vendor.id))} />
      )}

      {tab === 'orders' && (
        <OrdersTab orders={orders} rates={rates} isAdmin={isAdmin} busy={busy} now={new Date(serverNow || Date.now())}
          onVendor={goVendor}
          bookPickup={(id) => act(() => post('/api/admin/marketplace/orders', { action: 'book_pickup', id }), 'Collection booked on the dispatch board.')}
          resolveMismatch={(id, action, note) => act(() => post('/api/admin/marketplace/orders', { action: 'resolve_mismatch', id, resolution: action, note }), 'Decision recorded.')}
          deliver={(id) => act(() => post('/api/admin/marketplace/orders', { action: 'deliver', id }), 'Marked delivered — the sale is booked to the vendor.')}
          setRate={(sizeClass, dollars) => act(() => post('/api/admin/marketplace/orders', { action: 'set_rate', sizeClass, dollars }), 'Fee saved.')} />
      )}
      {tab === 'claims' && (
        <MarketplaceClaims claims={claims} orders={orders} isAdmin={isAdmin} busy={busy} now={new Date(serverNow || Date.now())}
          rules={{ respondHours: CLAIM_RESPOND_HOURS, resolveDays: CLAIM_RESOLVE_DAYS, resolutions: CLAIM_RESOLUTIONS }} post={post} act={act} />
      )}
      {tab === 'bank' && isAdmin && (
        <BankTab banks={banks} busy={busy} onVendor={goVendor}
          verify={(id, how) => act(() => post('/api/admin/marketplace/bank', { action: 'verify', id, how, nameMatched: true }), 'Verified.')}
          reject={(id, reason) => act(() => post('/api/admin/marketplace/bank', { action: 'reject', id, reason }), 'Rejected.')} />
      )}
      {tab === 'payouts' && isAdmin && (
        <PayoutsTab payouts={payouts} busy={busy} onVendor={goVendor}
          run={(body, ok) => act(() => post('/api/admin/marketplace/payouts', body), ok)}
          exportFile={async (ids) => {
            setBusy(true); setErr('');
            try {
              const res = await fetch('/api/admin/marketplace/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'file', ids }) });
              if (!res.ok) throw new Error((await res.json()).error || 'Could not build the file.');
              const blob = await res.blob();
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
              a.download = `vendor-payouts-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
            } catch (e) { setErr(e.message); } finally { setBusy(false); }
          }} />
      )}
      {tab === 'strikes' && isAdmin && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Strikes due for review</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Strikes never expire by themselves. Each one resurfaces here every 90 days until you keep or remove it. Removing needs a reason and stays on the record as revised.</p>
          {due.length === 0 ? <p style={{ margin: 0 }}>Nothing due.</p> : due.map((s) => <StrikeReviewRow key={s.id} s={s} strikeReasons={strikeReasons} busy={busy} onVendor={goVendor}
            keep={() => act(() => post('/api/admin/marketplace/vendors', { action: 'keep_strike', strikeId: s.id }), 'Kept — it will come back in 90 days.')}
            remove={(reason) => act(() => post('/api/admin/marketplace/vendors', { action: 'revise_strike', strikeId: s.id, reason }), 'Strike removed.')} />)}
        </div>
      )}
    </div>
  );
}

function ApplicationRow({ a, busy, isAdmin, onApprove, onReject }) {
  const [hst, setHst] = useState(a.hstStatus || '');
  const [reason, setReason] = useState('');
  return (
    <div style={{ borderTop: '1px solid var(--line-soft)', padding: '12px 0' }}>
      <strong>{a.name}</strong> <span style={{ fontSize: 13, color: 'var(--muted)' }}>({a.legalName}) · applied {day(a.createdAt)}</span>
      <div style={{ fontSize: 14 }}>{a.contact} · {a.email}{a.phone ? ` · ${a.phone}` : ''} · stock: {a.sourceOfGoods || '—'}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
        <select value={hst} onChange={(e) => setHst(e.target.value)} style={{ width: 'auto' }}>
          <option value="">HST position…</option><option value="registered">HST registered</option><option value="small_supplier">Small supplier (not registered)</option>
        </select>
        <button className="btn primary" disabled={busy || !hst} onClick={() => onApprove(hst)}>Approve (probation)</button>
        <input placeholder="Reason, if rejecting" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 230 }} />
        <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => onReject(reason)}>Reject</button>
      </div>
      {!isAdmin && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>An admin gives the vendor&rsquo;s owner login afterwards.</div>}
    </div>
  );
}

function ListingReview({ data, busy, rejectReasons, onClose, onDecide }) {
  const l = data.listing;
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [cond, setCond] = useState('');
  const row = (k, v) => <tr key={k}><td style={{ width: 180, color: 'var(--muted)' }}>{k}</td><td>{v ?? '—'}</td></tr>;
  return (
    <div className="panel">
      <button className="btn" onClick={onClose}>← Back to the queue</button>
      <h2 style={{ fontSize: 17 }}>{l.title || l.sku} <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{l.sku}</span></h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
        {l.photos.map((p) => (
          <figure key={p.id} style={{ margin: 0, fontSize: 12 }}>
            <a href={`/api/admin/marketplace/photo?id=${p.id}`} target="_blank" rel="noreferrer">
              <img src={`/api/admin/marketplace/photo?id=${p.id}`} alt={p.role} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'contain', background: 'var(--tint)', borderRadius: 6 }} /></a>
            <figcaption>{p.role}{p.kind === 'evidence' ? ' (private)' : ''}</figcaption>
          </figure>
        ))}
      </div>
      <table className="admin" style={{ minWidth: 0 }}><tbody>
        {row('Make / model', `${l.make} · ${l.model}`)}{row('Serial (private)', l.serial)}{row('Category', l.category)}
        {row('Condition', l.condition)}{row('Lane', l.lane)}{row('Price', l.price != null ? `$${l.price}` : null)}
        {row('Retail / source', l.compareAt ? `$${l.compareAt} — ${l.compareAtSource || 'NO SOURCE'}` : null)}
        {row('Size', `${l.widthIn} × ${l.depthIn} × ${l.heightIn} in, ${l.weightLb} lb`)}{row('Warranty', `${l.warrantyMonths} months`)}
        {row('Tested', `${l.testedWorking ? 'yes' : 'NO'} — ${l.testNotes || ''}`)}{row('Refurb notes', l.refurbNotes)}
        {row('Description', l.description)}{row('Delivery notes', l.deliveryNotes)}
        {l.lane === 'B' && row('Pickup', `${l.pickupAddress || ''} ${l.pickupCity || ''} ${l.pickupPostal || ''}`)}
      </tbody></table>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>Check: are the photos of one real unit, does the plate match the model, is the grade honest, is the retail price real.</p>
      <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
        <div><label style={{ fontSize: 13 }}>Re-grade condition on approval (optional)</label>
          <select value={cond} onChange={(e) => setCond(e.target.value)}><option value="">Keep “{l.condition}”</option>
            {['New in Box', 'New Open Box', 'New Scratch & Dent', 'Refurbished'].map((c) => <option key={c}>{c}</option>)}</select></div>
        <button className="btn primary" disabled={busy} onClick={() => onDecide({ decision: 'approve', condition: cond || undefined })}>
          Approve {l.lane === 'A' ? '(then waits for check-in at our warehouse)' : '(goes live)'}</button>
        <textarea rows={2} placeholder="What should the vendor change?" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" disabled={busy || !note.trim()} onClick={() => onDecide({ decision: 'changes', note })}>Send back for changes</button>
        <select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Reject because…</option>
          {Object.entries(rejectReasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn danger" disabled={busy || !reason || (reason === 'other' && !note.trim())} onClick={() => onDecide({ decision: 'reject', reason, note })}>Reject</button>
      </div>
    </div>
  );
}

// Money that comes off a seller after a sale. A fixed list of reasons (so they stay countable); an
// adjustment needs a written reason. The key is made once per form so a double click records it once.
function DeductionForm({ vendorId, refs }) {
  const [f, setF] = useState({ reason: '', dollars: '', orderRef: '', memo: '', direction: 'take', drawReserve: true, bookedElsewhere: false });
  const [key, setKey] = useState(() => Math.random().toString(36).slice(2) + Date.now().toString(36));
  const [state, setState] = useState({ busy: false, err: '', ok: '' });
  const r = DEDUCTION_REASONS[f.reason];
  async function go() {
    setState({ busy: true, err: '', ok: '' });
    try {
      const d = await api('/api/admin/marketplace/ledger', 'POST', { vendorId, key, ...f, dollars: Number(f.dollars) });
      setState({ busy: false, err: '', ok: d.duplicate ? 'Already recorded.' : `Recorded${d.drawnCents ? ` — $${(d.drawnCents / 100).toFixed(2)} came from the warranty reserve` : ''}.` });
      setKey(Math.random().toString(36).slice(2) + Date.now().toString(36));
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { setState({ busy: false, err: e.message, ok: '' }); }
  }
  return (
    <div style={{ border: '1px solid var(--border, #ddd)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, marginTop: 0 }}>Take money off this seller (or correct their balance)</h3>
      {state.err && <div className="error-box">{state.err}</div>}
      {state.ok && <div style={{ color: 'var(--ok)', fontSize: 14 }}>{state.ok}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} style={{ width: 'auto' }}>
          <option value="">Reason…</option>{Object.entries(DEDUCTION_REASONS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select>
        <input placeholder="$ amount" value={f.dollars} onChange={(e) => setF({ ...f, dollars: e.target.value })} style={{ width: 100 }} />
        {r?.kind === 'adjustment' && (
          <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} style={{ width: 'auto' }}>
            <option value="take">Comes OFF what we owe them</option><option value="add">ADDS to what we owe them</option></select>)}
        {r && r.kind !== 'adjustment' && (
          <>
            <input list={`refs${vendorId}`} placeholder="Order ref (for the reserve)" value={f.orderRef} onChange={(e) => setF({ ...f, orderRef: e.target.value })} style={{ width: 200 }} />
            <datalist id={`refs${vendorId}`}>{refs.map((x) => <option key={x} value={x} />)}</datalist>
          </>)}
        <input placeholder={r?.kind === 'adjustment' ? 'Written reason (required)' : 'Note'} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} style={{ width: 260 }} />
      </div>
      {r?.kind === 'guarantee_claim' && <label style={{ display: 'block', fontSize: 13, marginTop: 6 }}><input type="checkbox" checked={f.drawReserve} onChange={(e) => setF({ ...f, drawReserve: e.target.checked })} /> Take it from that order&rsquo;s warranty reserve first, then the balance</label>}
      {r?.kind === 'refund' && <label style={{ display: 'block', fontSize: 13, marginTop: 6 }}><input type="checkbox" checked={f.bookedElsewhere} onChange={(e) => setF({ ...f, bookedElsewhere: e.target.checked })} /> I already recorded this refund on the invoice (the bank side is booked) — only reduce the seller&rsquo;s ledger</label>}
      {r && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0' }}>{r.cash ? 'Use this when we have paid a customer from our bank on the seller\'s behalf: it is booked as money out of the bank and off what we owe them.' : 'Between us and the seller only — no cash moves; it changes what we owe them and our income.'}</p>}
      <button className="btn danger" disabled={state.busy || !f.reason || !(Number(f.dollars) > 0) || (r?.kind === 'adjustment' && !f.memo.trim())}
        onClick={() => confirm('Record this against the seller\'s ledger? Ledger entries cannot be edited; a mistake is corrected with another entry.') && go()}>Record</button>
    </div>
  );
}

function VendorPanel({ d, isAdmin, busy, strikeReasons, onClose, run }) {
  const v = d.vendor;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [strike, setStrike] = useState({ reason: '', orderRef: '', note: '' });
  const [reason, setReason] = useState('');
  const [rate, setRate] = useState('');
  const [rateFrom, setRateFrom] = useState('');
  const [tier, setTier] = useState(String(v.tier));
  return (
    <div className="panel">
      <button className="btn" onClick={onClose}>← Vendors</button>
      <h2 style={{ fontSize: 17 }}>{v.tradeName || v.legalName} <span className={`pill ${STANDING[v.status] || ''}`}>{v.status}</span> <span className="pill">{TIERS[v.tier]}</span></h2>
      <p style={{ fontSize: 14 }}>{v.legalName} · {v.contactName} · {v.contactEmail} · {v.contactPhone || 'no phone'}<br />
        HST: {v.hstStatus || 'not recorded'}{v.hstNo ? ` (${v.hstNo})` : ''} · {v.address || 'no address'} {v.city || ''} {v.postal || ''} · stock: {v.sourceOfGoods || '—'}<br />
        Listings: {Object.entries(d.listingCounts).map(([k, n]) => `${k.replace('_', ' ')} ${n}`).join(' · ') || 'none'}<br />
        Policies: {!d.policies ? 'unknown' : d.policies.pending.length ? <span className="pill warn">not accepted: {d.policies.pending.join(', ')}</span> : <span className="pill ok">accepted {d.policies.acceptedAt ? `${day(d.policies.acceptedAt)} by ${d.policies.acceptedBy}` : ''}</span>}</p>

      {isAdmin && d.balance && (
        <p style={{ fontSize: 14 }}>
          <strong>Money:</strong> available {cents(d.balance.availableCents)} · pending {cents(d.balance.pendingCents)} · reserve {cents(d.balance.reserveHeldCents)} · paid {cents(d.balance.paidOutCents)} · commission {(d.commissionBps / 100).toFixed(1)}%
          <br />Bank: {d.bank.payable ? `${d.bank.payable.holderName} ••••${d.bank.payable.last4}` : 'no verified account'}{d.bank.waiting.length ? ` · ${d.bank.waiting.length} waiting` : ''}
          · first payout {v.firstPayoutClearedAt ? 'cleared' : <ClearFirst vendorId={v.id} />}
        </p>
      )}

      {isAdmin && d.balance && <DeductionForm vendorId={v.id} refs={d.settledRefs || []} />}

      <h3 style={{ fontSize: 15 }}>People who can act for this vendor</h3>
      <table className="admin" style={{ minWidth: 0 }}><tbody>
        {d.users.map((u) => <tr key={u.email}><td>{u.email}</td><td>{u.role}</td><td>{u.revoked_at ? `revoked ${day(u.revoked_at)}` : 'active'}</td>
          <td>{!u.revoked_at && <button className="btn" disabled={busy} onClick={() => run({ action: 'revoke_user', email: u.email }, 'Access removed.')}>Remove</button>}</td></tr>)}
      </tbody></table>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px', flexWrap: 'wrap' }}>
        <input placeholder="Email (they sign up at /signup with it)" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: 280 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}><option value="staff">Staff</option>{isAdmin && <option value="owner">Owner (controls the bank account)</option>}</select>
        <button className="btn" disabled={busy || !email} onClick={() => run({ action: 'grant_user', email, role }, 'Access granted.')}>Give access</button>
      </div>

      <h3 style={{ fontSize: 15 }}>Strikes ({d.activeStrikes} active)</h3>
      <ul style={{ fontSize: 14, paddingLeft: 18 }}>{d.strikes.length === 0 ? <li>None.</li> : d.strikes.map((s) => (
        <li key={s.id}>{day(s.issued_at)} — {strikeReasons[s.reason_code]}{s.order_ref ? ` (${s.order_ref})` : ''}{s.note ? ` — ${s.note}` : ''}
          {s.revised_at ? <em> · revised by {s.revised_by}: {s.revised_reason}</em> : ' · active'}</li>))}</ul>

      {isAdmin && (
        <div style={{ display: 'grid', gap: 14, maxWidth: 560 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={strike.reason} onChange={(e) => setStrike({ ...strike, reason: e.target.value })} style={{ width: 'auto' }}>
              <option value="">Issue a strike for…</option>{Object.entries(strikeReasons).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            <input placeholder="Order ref" value={strike.orderRef} onChange={(e) => setStrike({ ...strike, orderRef: e.target.value })} style={{ width: 110 }} />
            <input placeholder="Note" value={strike.note} onChange={(e) => setStrike({ ...strike, note: e.target.value })} style={{ width: 180 }} />
            <button className="btn danger" disabled={busy || !strike.reason} onClick={() => confirm('Issue this strike? Three active strikes restrict the vendor.') && run({ action: 'strike', ...strike }, 'Strike issued.')}>Issue</button>
          </div>
          {v.status === 'restricted' && (
            <div style={{ display: 'flex', gap: 8 }}><input placeholder="Why reinstate (back to probation)?" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 320 }} />
              <button className="btn" disabled={busy || !reason.trim()} onClick={() => run({ action: 'reinstate', reason }, 'Reinstated on probation.')}>Reinstate</button></div>)}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: 'auto' }}>{[0, 1, 2].map((t) => <option key={t} value={t}>{TIERS[t]}</option>)}</select>
            <input placeholder="Reason for tier change" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 220 }} />
            <button className="btn" disabled={busy || !reason.trim() || Number(tier) === v.tier} onClick={() => run({ action: 'set_tier', tier: Number(tier), reason }, 'Tier changed.')}>Set tier</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Commission % (e.g. 12)" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 170 }} />
            <input type="date" value={rateFrom} onChange={(e) => setRateFrom(e.target.value)} style={{ width: 160 }} />
            <button className="btn" disabled={busy || !rate} onClick={() => run({ action: 'set_commission', rateBps: Math.round(Number(rate) * 100), effectiveFrom: rateFrom || undefined }, 'Commission scheduled.')}>Set from date</button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Applies to orders placed on/after the date; past sales keep their rate.</span>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 15 }}>History</h3>
      <ul style={{ fontSize: 13, paddingLeft: 18, maxHeight: 240, overflow: 'auto' }}>{d.events.map((e, i) => <li key={i}>{day(e.at)} — {e.event.replace(/_/g, ' ')}{e.actor ? ` (${e.actor})` : ''}</li>)}</ul>
    </div>
  );
}

function ClearFirst({ vendorId }) {
  const [done, setDone] = useState(false);
  return done ? <span> cleared</span> : (
    <button className="btn" style={{ marginLeft: 6 }} onClick={async () => {
      if (!confirm('Clear this vendor for their first payout? Do this after a test deposit or a call.')) return;
      try { await api('/api/admin/marketplace/payouts', 'POST', { action: 'clear_first', vendorId }); setDone(true); } catch (e) { alert(e.message); }
    }}>Clear first payout</button>
  );
}

function BankTab({ banks, busy, verify, reject, onVendor }) {
  const [how, setHow] = useState('void_cheque');
  const [reason, setReason] = useState({});
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 17 }}>Bank accounts waiting for verification</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Only verify after you have seen a void cheque or bank letter (or a test deposit landed), and the holder&rsquo;s name matches the business. Verifying attests that, under your name.</p>
      {banks.length === 0 ? <p style={{ margin: 0 }}>Nothing waiting.</p> : banks.map((b) => (
        <div key={b.id} style={{ borderTop: '1px solid var(--line-soft)', padding: '12px 0' }}>
          <strong><VendorLink id={b.vendorId} onOpen={onVendor}>{b.vendor}</VendorLink></strong> <span style={{ fontSize: 13, color: 'var(--muted)' }}>({b.legalName})</span>
          {b.replacesExisting && <span className="pill warn" style={{ marginLeft: 8 }}>Replaces an account in use — 5-day safety wait</span>}
          <div style={{ fontSize: 14 }}>Holder: <strong>{b.holderName}</strong> {b.nameLooksRight ? <span className="pill ok">looks like the business</span> : <span className="pill warn">does NOT look like the business</span>}
            <br />Institution {b.institution} · transit {b.transit} · account ••••{b.last4} · {b.method.replace('_', ' ')} · submitted {day(b.submittedAt)} by {b.submittedBy}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <select value={how} onChange={(e) => setHow(e.target.value)} style={{ width: 'auto' }}><option value="void_cheque">Void cheque</option><option value="bank_letter">Bank letter</option><option value="test_deposit">Test deposit</option></select>
            <button className="btn primary" disabled={busy} onClick={() => confirm(`I confirm the name on this account matches ${b.legalName}.`) && verify(b.id, how)}>Verify</button>
            <input placeholder="Reason, if rejecting" value={reason[b.id] || ''} onChange={(e) => setReason({ ...reason, [b.id]: e.target.value })} style={{ width: 220 }} />
            <button className="btn danger" disabled={busy || !(reason[b.id] || '').trim()} onClick={() => reject(b.id, reason[b.id])}>Reject</button>
          </div>
        </div>))}
    </div>
  );
}

function PayoutsTab({ payouts, busy, run, exportFile, onVendor }) {
  const [ref, setRef] = useState({});
  const approved = payouts.filter((p) => p.status === 'approved');
  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Payouts</h2>
        <button className="btn primary" disabled={busy} onClick={() => run({ action: 'propose_all' }, 'Proposals created — review them below.')}>Propose this week&rsquo;s payouts</button>
        <button className="btn" disabled={busy || !approved.length} onClick={() => exportFile(approved.map((p) => p.id))}>Download bank file ({approved.length} approved)</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Nothing is paid without a yes. Approving takes the money off the vendor&rsquo;s ledger; mark it paid once the transfer has gone, with the bank reference. At $2,000 or more a second person must approve a payout the first person proposed. The skipped list (and why) appears after proposing.</p>
      <div className="table-wrap"><table className="admin"><thead><tr><th>Proposed</th><th>Vendor</th><th>Amount</th><th>Status</th><th>By</th><th /></tr></thead><tbody>
        {payouts.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No payouts yet.</td></tr>}
        {payouts.map((p) => (
          <tr key={p.id}><td>{day(p.proposed_at)}</td><td><VendorLink id={p.vendor_id} onOpen={onVendor}>{p.vendor}</VendorLink></td><td>{cents(p.amount_cents)}</td><td>{p.status}{p.paid_ref ? ` · ${p.paid_ref}` : ''}{p.note ? ` — ${p.note}` : ''}</td><td>{p.proposed_by}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {p.status === 'proposed' && <><button className="btn primary" disabled={busy} onClick={() => run({ action: 'approve', id: p.id }, 'Approved.')}>Approve</button>{' '}
                <button className="btn" disabled={busy} onClick={() => run({ action: 'cancel', id: p.id, note: 'Cancelled by admin' }, 'Cancelled.')}>Cancel</button></>}
              {p.status === 'approved' && <><input placeholder="Bank reference" value={ref[p.id] || ''} onChange={(e) => setRef({ ...ref, [p.id]: e.target.value })} style={{ width: 130 }} />{' '}
                <button className="btn" disabled={busy || !(ref[p.id] || '').trim()} onClick={() => run({ action: 'paid', id: p.id, ref: ref[p.id] }, 'Marked paid.')}>Paid</button>{' '}
                <button className="btn danger" disabled={busy} onClick={() => { const n = prompt('What went wrong?'); if (n) run({ action: 'failed', id: p.id, note: n }, 'Marked failed; the money is back on the ledger.'); }}>Failed</button></>}
            </td></tr>))}
      </tbody></table></div>
    </div>
  );
}

function StrikeReviewRow({ s, strikeReasons, busy, keep, remove, onVendor }) {
  const [reason, setReason] = useState('');
  return (
    <div style={{ borderTop: '1px solid var(--line-soft)', padding: '10px 0', fontSize: 14 }}>
      <strong><VendorLink id={s.vendor_id} onOpen={onVendor}>{s.trade_name || s.legal_name}</VendorLink></strong> ({s.status}) — {strikeReasons[s.reason_code]}{s.order_ref ? ` · ${s.order_ref}` : ''}{s.note ? ` · ${s.note}` : ''}
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>Issued {day(s.issued_at)} · last looked at {day(s.last_review_at)}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <button className="btn" disabled={busy} onClick={keep}>Keep (review again in 90 days)</button>
        <input placeholder="Why remove it?" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 260 }} />
        <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => remove(reason)}>Remove strike</button>
      </div>
    </div>
  );
}

function VendorLink({ id, onOpen, children }) {
  return <a href="#" onClick={(e) => { e.preventDefault(); onOpen(id); }}>{children}</a>;
}

function OrdersTab({ orders, rates, isAdmin, busy, now, onVendor, deliver, setRate, bookPickup, resolveMismatch }) {
  const [dollars, setDollars] = useState({});
  const hrs = (d) => (new Date(d) - now) / 3600000;
  const clock = (o) => {
    if (o.status === 'awaiting_accept') { const h = hrs(o.acceptBy); return h < 0 ? 'ACCEPT OVERDUE' : `accept in ${h.toFixed(1)} h`; }
    if (o.status === 'accepted') { const h = hrs(o.readyBy); return h < 0 ? 'READY OVERDUE' : `ready in ${h.toFixed(1)} h`; }
    return '';
  };
  const SIZES = [['small', 'Small', '≤ 70 lb and ≤ 36 in'], ['standard', 'Standard', '≤ 200 lb and ≤ 72 in'], ['oversize', 'Oversize', 'heavier or taller']];
  return (
    <div>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Vendor orders</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Orders appear here once you have confirmed the customer&rsquo;s e-transfer — that is when the vendor&rsquo;s 24-hour and 72-hour clocks start. Overdue ones have already been struck. Lane A/B orders are booked to the vendor when you mark the customer&rsquo;s order Delivered; a seller who ships (Lane C) is booked here once the carrier confirms delivery.</p>
        <div className="table-wrap"><table className="admin"><thead><tr><th>Order</th><th>Vendor</th><th>Lane</th><th>Amount</th><th>Status</th><th>Clock</th><th>Detail</th><th>Collection</th><th /></tr></thead><tbody>
          {orders.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>No vendor orders yet.</td></tr>}
          {orders.map((o) => (
            <tr key={o.id}><td>{o.orderNumber}</td><td><VendorLink id={o.vendorId} onOpen={onVendor}>{o.vendor}</VendorLink></td><td>{o.lane}</td><td>{cents(o.itemCents)}</td>
              <td>{o.status.replace('_', ' ')}</td>
              <td style={{ color: clock(o).includes('OVERDUE') ? 'var(--danger)' : undefined }}>{clock(o)}</td>
              <td style={{ fontSize: 12 }}>{o.lane === 'C' && o.trackingNumber ? `${o.carrier} ${o.trackingNumber}` : o.insuranceChoice ? `insurance: ${o.insuranceChoice}` : ''}{o.status === 'cancelled' ? ` ${o.cancelCode}` : ''}</td>
              <td style={{ fontSize: 12 }}>{o.lane !== 'B' ? '' : o.collectedAt ? `collected ${new Date(o.collectedAt).toISOString().slice(0, 10)}`
                : o.pickupJob ? `${o.pickupJob.number} (${o.pickupJob.status.replace('_', ' ')})`
                : o.status === 'ready' ? <button className="btn" disabled={busy} onClick={() => bookPickup(o.id)}>Book collection</button> : 'booked when ready'}
                {o.mismatch && (
                  <div style={{ color: 'var(--danger)', marginTop: 4 }}>
                    <b>Crew: does not match the listing.</b> {o.mismatch.note}
                    {o.mismatch.resolvedAt ? <div>Decided: {String(o.mismatch.resolution).replace('_', ' ')}</div>
                      : isAdmin ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                          <button className="btn danger" disabled={busy} onClick={() => confirm('Strike the seller, cancel the order and refund the customer?') && resolveMismatch(o.id, 'strike_refund', '')}>Strike + refund</button>
                          <button className="btn" disabled={busy} onClick={() => confirm('Strike the seller only?') && resolveMismatch(o.id, 'strike', '')}>Strike only</button>
                          <button className="btn" disabled={busy} onClick={() => resolveMismatch(o.id, 'dismiss', '')}>Dismiss</button>
                        </div>) : <div>An admin decides (strike / refund).</div>}
                  </div>)}
              </td>
              <td>{o.lane === 'C' && ['accepted', 'ready'].includes(o.status) && <button className="btn" disabled={busy} onClick={() => confirm('Mark delivered? Only after the carrier has confirmed delivery.') && deliver(o.id)}>Mark delivered</button>}</td></tr>
          ))}
        </tbody></table></div>
      </div>
      {isAdmin && rates && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Delivery service fee (billed to the vendor)</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>What we charge a vendor to collect and deliver one unit, by size. It is copied onto each order when the vendor accepts it, so changing it never alters a past statement. Set these from what a pickup actually costs us (the dispatch Profit tab shows it). Lane C (the vendor ships) is not charged.</p>
          {rates.unset.length > 0 && <div className="error-box">Not set yet: {rates.unset.join(', ')}. Until set, vendors are charged $0 for those sizes.</div>}
          {SIZES.map(([k, label, hint]) => (
            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ width: 90 }}><b>{label}</b></span><span style={{ width: 160, fontSize: 12, color: 'var(--muted)' }}>{hint}</span>
              <span>$</span><input style={{ width: 100 }} inputMode="decimal" placeholder={rates.rates[k] != null ? (rates.rates[k] / 100).toFixed(2) : 'not set'}
                value={dollars[k] ?? ''} onChange={(e) => setDollars({ ...dollars, [k]: e.target.value })} />
              <button className="btn" disabled={busy || dollars[k] === undefined || dollars[k] === ''} onClick={() => setRate(k, dollars[k])}>Save</button>
              {rates.rates[k] != null && <span style={{ fontSize: 12 }}>currently ${(rates.rates[k] / 100).toFixed(2)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
