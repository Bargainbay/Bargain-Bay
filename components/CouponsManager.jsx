'use client';
import { useMemo, useState } from 'react';
import { money } from '../lib/constants';

// Coupon codes and the affiliates they belong to.
//
// The affiliate is a field ON the coupon rather than a separate roster: an
// affiliate who has no code has nothing to report on, and one who has three
// codes is still one line in the report. Typing a name that already exists picks
// them up (the datalist offers who we've used before), which keeps the report
// from splitting "Dave" and "dave " into two people.
const BLANK = {
  id: null, code: '', affiliate: '', commissionPct: '', kind: 'percent', value: '',
  minSubtotal: '', maxUses: '', perEmailLimit: '', startsAt: '', endsAt: '',
  excludeClearance: false, note: '', active: true
};

export default function CouponsManager({ initialCoupons = [], initialAffiliates = [] }) {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [affiliates, setAffiliates] = useState(initialAffiliates);
  const [form, setForm] = useState(BLANK);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  const names = useMemo(
    () => [...new Set(coupons.map((c) => c.affiliate).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [coupons]
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function refresh() {
    const res = await fetch('/api/admin/coupons');
    const d = await res.json();
    if (Array.isArray(d.coupons)) setCoupons(d.coupons);
    if (Array.isArray(d.affiliates)) setAffiliates(d.affiliates);
  }

  async function call(method, body, okMsg) {
    setBusy(true); setErr(''); setNotice('');
    try {
      const res = await fetch('/api/admin/coupons', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That didn’t work.'); return null; }
      await refresh();
      setNotice(typeof okMsg === 'function' ? okMsg(d) : okMsg);
      return d;
    } catch {
      setErr('Network error — please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    const d = await call('POST', form, (r) => `Saved ${r.coupon.code}.`);
    if (d) { setForm(BLANK); setOpen(false); }
  }

  function edit(c) {
    setForm({
      id: c.id, code: c.code, affiliate: c.affiliate, commissionPct: c.commissionPct || '',
      kind: c.kind, value: c.value, minSubtotal: c.minSubtotal || '',
      maxUses: c.maxUses ?? '', perEmailLimit: c.perEmailLimit ?? '',
      startsAt: c.startsAt || '', endsAt: c.endsAt || '',
      excludeClearance: c.excludeClearance, note: c.note, active: c.active
    });
    setOpen(true);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const discountLabel = (c) => (c.kind === 'percent' ? `${c.value}% off` : `${money(c.value)} off`);
  const limitLabel = (c) => {
    const bits = [];
    if (c.minSubtotal > 0) bits.push(`min ${money(c.minSubtotal)}`);
    if (c.maxUses != null) bits.push(`${c.usedCount}/${c.maxUses} used`);
    if (c.perEmailLimit != null) bits.push(`${c.perEmailLimit} per customer`);
    if (c.excludeClearance) bits.push('not on clearance');
    if (c.startsAt || c.endsAt) bits.push(`${c.startsAt || '…'} → ${c.endsAt || '…'}`);
    return bits.join(' · ') || '—';
  };

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {notice && <div className="notice-box">{notice}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <p className="hint" style={{ margin: 0 }}>
          Codes work at checkout on bargainbay.ca. The discount comes off the goods, never the delivery fee,
          and is recalculated on our side when the order is placed.
        </p>
        <button className="btn accent" type="button" onClick={() => { setOpen((v) => !v); setForm(BLANK); }}>
          {open ? 'Close' : '+ New coupon'}
        </button>
      </div>

      {open && (
        <form className="panel" onSubmit={save} style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{form.id ? `Edit ${form.code}` : 'New coupon'}</h3>
          <div className="form-2col">
            <div className="field">
              <label htmlFor="cp-code">Code</label>
              <input id="cp-code" required value={form.code} maxLength={24}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="DAVE10" style={{ textTransform: 'uppercase' }} />
              <div className="hint">What the customer types. Letters, digits and . _ -</div>
            </div>
            <div className="field">
              <label htmlFor="cp-aff">Affiliate</label>
              <input id="cp-aff" list="cp-affiliates" value={form.affiliate} onChange={set('affiliate')}
                placeholder="Who this code belongs to" maxLength={120} />
              <datalist id="cp-affiliates">
                {names.map((n) => <option key={n} value={n} />)}
              </datalist>
              <div className="hint">Leave blank for a general store-wide promo.</div>
            </div>
          </div>
          <div className="form-2col">
            <div className="field">
              <label htmlFor="cp-kind">Discount</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select id="cp-kind" value={form.kind} onChange={set('kind')} style={{ width: 'auto' }}>
                  <option value="percent">% off</option>
                  <option value="amount">$ off</option>
                </select>
                <input required type="number" min="0" step="0.01" value={form.value} onChange={set('value')}
                  aria-label="Discount value" placeholder={form.kind === 'percent' ? '10' : '50.00'} style={{ flex: 1, minWidth: 0 }} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="cp-comm">Affiliate commission %</label>
              <input id="cp-comm" type="number" min="0" max="100" step="0.5" value={form.commissionPct} onChange={set('commissionPct')} placeholder="0" />
              <div className="hint">Reporting only — nothing is paid out automatically.</div>
            </div>
          </div>
          <div className="form-2col">
            <div className="field">
              <label htmlFor="cp-min">Minimum order</label>
              <input id="cp-min" type="number" min="0" step="0.01" value={form.minSubtotal} onChange={set('minSubtotal')} placeholder="0.00" />
            </div>
            <div className="field">
              <label htmlFor="cp-max">Total uses</label>
              <input id="cp-max" type="number" min="1" step="1" value={form.maxUses} onChange={set('maxUses')} placeholder="Unlimited" />
            </div>
          </div>
          <div className="form-2col">
            <div className="field">
              <label htmlFor="cp-per">Uses per customer</label>
              <input id="cp-per" type="number" min="1" step="1" value={form.perEmailLimit} onChange={set('perEmailLimit')} placeholder="Unlimited" />
            </div>
            <div className="field">
              <label htmlFor="cp-from">Runs</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input id="cp-from" type="date" value={form.startsAt} onChange={set('startsAt')} aria-label="Start date" />
                <span style={{ color: 'var(--muted)' }}>→</span>
                <input type="date" value={form.endsAt} onChange={set('endsAt')} aria-label="End date" />
              </div>
              <div className="hint">Leave blank for no start / no end.</div>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, margin: '4px 0 10px' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.excludeClearance} onChange={set('excludeClearance')} />
            <span>Don’t apply to clearance units <span style={{ color: 'var(--muted)' }}>(they’re already marked down)</span></span>
          </label>
          <div className="field">
            <label htmlFor="cp-note">Note</label>
            <input id="cp-note" value={form.note} onChange={set('note')} maxLength={300} placeholder="Instagram collab, Sept 2026" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => { setOpen(false); setForm(BLANK); }}>Cancel</button>
            <button className="btn accent" disabled={busy}>{busy ? 'Saving…' : (form.id ? 'Save changes' : 'Create coupon')}</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th>Code</th><th>Affiliate</th><th>Discount</th><th>Limits</th>
              <th style={{ textAlign: 'right' }}>Used</th>
              <th style={{ textAlign: 'right' }}>Given away</th>
              <th style={{ textAlign: 'right' }}>Revenue</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--muted)' }}>No coupons yet — create one above.</td></tr>
            )}
            {coupons.map((c) => (
              <tr key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}>
                <td>
                  <b>{c.code}</b>
                  {!c.active && <span className="pill" style={{ fontSize: 11, marginLeft: 6 }}>Off</span>}
                  {c.note && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.note}</div>}
                </td>
                <td>{c.affiliate || <span style={{ color: 'var(--muted)' }}>—</span>}
                  {c.commissionPct > 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.commissionPct}% commission</div>}
                </td>
                <td>{discountLabel(c)}</td>
                <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{limitLabel(c)}</td>
                <td style={{ textAlign: 'right' }}>{c.redeemed ?? c.usedCount}</td>
                <td style={{ textAlign: 'right' }}>{money(c.discountGiven || 0)}</td>
                <td style={{ textAlign: 'right' }}>{money(c.revenue || 0)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn" type="button" disabled={busy} onClick={() => edit(c)}>Edit</button>{' '}
                  <button className="btn" type="button" disabled={busy}
                    onClick={() => call('PATCH', { id: c.id, active: !c.active }, `${c.code} turned ${c.active ? 'off' : 'on'}.`)}>
                    {c.active ? 'Turn off' : 'Turn on'}
                  </button>{' '}
                  <button className="btn" type="button" disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete ${c.code}? A code that has been used is turned off instead, so its history survives.`)) return;
                      call('DELETE', { id: c.id }, (r) => r.deleted ? `${c.code} deleted.` : `${c.code} has been used, so it was turned off instead of deleted.`);
                    }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 26 }}>By affiliate</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Every redemption, grouped by whoever the code belonged to at the time. Cancelled orders keep their
        redemption but contribute no revenue. Commission is what the rate on the code works out to — a figure to pay from, not a payment.
      </p>
      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th>Affiliate</th>
              <th style={{ textAlign: 'right' }}>Codes</th>
              <th style={{ textAlign: 'right' }}>Orders</th>
              <th style={{ textAlign: 'right' }}>Discount given</th>
              <th style={{ textAlign: 'right' }}>Revenue (ex-HST)</th>
              <th style={{ textAlign: 'right' }}>Commission</th>
            </tr>
          </thead>
          <tbody>
            {affiliates.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No codes have been redeemed yet.</td></tr>
            )}
            {affiliates.map((a) => (
              <tr key={a.affiliate}>
                <td><b>{a.affiliate}</b></td>
                <td style={{ textAlign: 'right' }}>{a.codes}</td>
                <td style={{ textAlign: 'right' }}>{a.uses}</td>
                <td style={{ textAlign: 'right' }}>{money(a.discount)}</td>
                <td style={{ textAlign: 'right' }}>{money(a.revenue)}</td>
                <td style={{ textAlign: 'right' }}>{a.commission > 0 ? money(a.commission) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
