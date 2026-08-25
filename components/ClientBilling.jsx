'use client';
import { useEffect, useState } from 'react';

// What each client owes for work we've finished but not yet billed — and the one
// button that turns a week of it into an invoice. Charges are set here rather
// than at close-out because the price is usually agreed with the client, not
// decided by the crew in the driveway.
const money = (n) => '$' + (Number(n) || 0).toFixed(2);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

function shift(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}
// Mon–Sun, matching the payroll week.
function weekStart(iso) { return shift(iso, (new Date(`${iso}T12:00:00`).getDay() + 6) % 7 * -1); }

export default function ClientBilling({ canBill }) {
  const t = today();
  const [from, setFrom] = useState(weekStart(t));
  const [to, setTo] = useState(t);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [addHst, setAddHst] = useState(true);
  const [draft, setDraft] = useState({});   // jobId -> charge being typed

  async function load(f = from, tt = to) {
    setLoading(true); setErr('');
    try {
      const d = await fetch(`/api/admin/dispatch?view=billing&from=${f}&to=${tt}`).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setData(d); setDraft({});
    } catch { setErr('Network error — could not load the billing.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function saveCharge(jobId) {
    const amount = draft[jobId];
    if (amount === undefined) return;
    setBusy(`c${jobId}`); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'charge', jobId, amount: amount === '' ? null : Number(amount) })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save that charge.'); return; }
      await load();
    } catch { setErr('Network error — the charge was not saved.'); }
    finally { setBusy(''); }
  }

  async function invoice(c) {
    if (!window.confirm(
      `Invoice ${c.clientName} for ${c.jobs - c.unpriced} job(s), ${money(c.charged)}${addHst ? ' plus HST' : ''}?`
    )) return;
    setBusy(`i${c.clientId}`); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invoice_client', clientId: c.clientId, from: data.from, to: data.to, addHst })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not raise the invoice.'); return; }
      setOk(`${d.invoiceNumber} raised for ${d.client} — ${d.jobs} job(s), ${money(d.total)}. It's in Invoices, not sent yet.`);
      await load();
    } catch { setErr('Network error — no invoice was raised.'); }
    finally { setBusy(''); }
  }

  return (
    <div>
      <div className="inv-search" style={{ marginBottom: 12 }}>
        <button type="button" className="svc-chip" onClick={() => { const f = weekStart(t); setFrom(f); setTo(t); load(f, t); }}>This week</button>
        <button type="button" className="svc-chip" onClick={() => { const f = shift(weekStart(t), -7); const e = shift(weekStart(t), -1); setFrom(f); setTo(e); load(f, e); }}>Last week</button>
        <button type="button" className="svc-chip" onClick={() => { const f = `${t.slice(0, 7)}-01`; setFrom(f); setTo(t); load(f, t); }}>This month</button>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} />
        <button type="button" className="btn accent" onClick={() => load()}>Show</button>
      </div>

      {err && <div className="error-box">{err}</div>}
      {ok && <div className="notice-box">{ok}</div>}

      {loading && <div className="panel">Loading…</div>}

      {!loading && data && data.clients.length === 0 && (
        <div className="panel" style={{ color: 'var(--muted)' }}>
          Nothing to bill between {data.from} and {data.to}. Only <b>finished</b> jobs that belong to a
          client show up here — jobs for us, and anything still on the board, don&apos;t.
        </div>
      )}

      {!loading && data && data.clients.map((c) => (
        <div className="panel" key={c.clientId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{c.clientName}</h3>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>
              {c.jobs} job{c.jobs === 1 ? '' : 's'} ·
              <b style={{ color: 'var(--charcoal)' }}> {money(c.charged)}</b>
              {c.cost > 0 && <> · costs {money(c.cost)} · margin <b>{money(c.margin)}</b></>}
            </div>
          </div>

          {c.unpriced > 0 && (
            <div className="notice-box">
              {c.unpriced} of these has no charge yet — put a price on {c.unpriced === 1 ? 'it' : 'them'} below
              or {c.unpriced === 1 ? 'it' : 'they'} won&apos;t go on the invoice.
            </div>
          )}

          <div className="table-wrap"><table className="admin">
            <thead>
              <tr><th>Job</th><th>Date</th><th>Where</th><th style={{ textAlign: 'right' }}>Charge</th></tr>
            </thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>
                    {l.jobNumber}
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{l.customerName || l.type}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.date}</td>
                  <td style={{ fontSize: 13 }}>
                    {l.from ? <>{l.from} <b>→</b> {l.to}</> : (l.to || '—')}
                    {l.chargeNote && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.chargeNote}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {canBill ? (
                      <span style={{ display: 'inline-flex', gap: 5 }}>
                        <input type="number" min="0" step="0.01" inputMode="decimal" style={{ width: 92 }}
                          aria-label={`Charge for ${l.jobNumber}`}
                          value={draft[l.id] ?? (l.charge ?? '')}
                          onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveCharge(l.id); }} />
                        <button type="button" className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                          disabled={busy === `c${l.id}` || draft[l.id] === undefined}
                          onClick={() => saveCharge(l.id)}>Save</button>
                      </span>
                    ) : (l.charge == null ? '—' : money(l.charge))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>

          {canBill && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={addHst} onChange={(e) => setAddHst(e.target.checked)} />
                Add 13% HST
              </label>
              <span className="hint" style={{ margin: 0 }}>
                {c.contactEmail || <b style={{ color: 'var(--danger)' }}>No contact email — add one first</b>}
              </span>
              <button type="button" className="btn accent" disabled={busy === `i${c.clientId}` || !c.contactEmail || c.charged <= 0}
                onClick={() => invoice(c)}>
                {busy === `i${c.clientId}` ? 'Raising…' : `Invoice ${money(c.charged)}`}
              </button>
            </div>
          )}
        </div>
      ))}

      {!loading && data && data.clients.length > 0 && (
        <p className="hint">
          Raising the invoice marks these jobs billed so they can never appear on a second one. It lands in
          <b> Invoices</b> unsent, so you can look it over and send it from there.
        </p>
      )}
    </div>
  );
}
