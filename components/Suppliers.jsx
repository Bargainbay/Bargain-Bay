'use client';
import { useEffect, useState } from 'react';

// Who we buy from.
//
// The order of this screen is the order of the questions: what do we OWE and
// when, then which names on our own orders nobody has identified, then the
// suppliers themselves. Aging leads because it is the only part with a date on
// it; the supplier list is a record.
const money = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '—');
const inp = { padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13.5 };

const post = async (body) => {
  const res = await fetch('/api/admin/suppliers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'That did not work.');
  return d;
};

function AgingBucket({ title, rows, total, tone, note }) {
  if (!rows?.length) return null;
  return (
    <>
      <h3 style={{ fontSize: 13.5, margin: '14px 0 4px', color: tone }}>
        {title} ({rows.length} · {money(total)})
      </h3>
      {note && <p className="hint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>{note}</p>}
      <div className="table-wrap"><table className="admin">
        <thead><tr>
          <th>Supplier</th><th>Invoice</th><th>Dated</th><th>Due</th>
          <th style={{ textAlign: 'right' }}>Amount</th><th>Who to ring</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.supplier_name || r.vendor || '—'}</td>
              <td>{r.invoice_number || <span className="hint">no number</span>}</td>
              <td>{fmt(r.invoice_date)}</td>
              <td>{r.due_on ? fmt(r.due_on) : <span className="hint">terms not set</span>}
                {r.days_over > 0 && <b style={{ color: '#b3261e', marginLeft: 6 }}>{r.days_over}d</b>}</td>
              <td style={{ textAlign: 'right' }}>{money(r.total)}</td>
              <td className="hint" style={{ fontSize: 12.5 }}>
                {[r.contact_name, r.email].filter(Boolean).join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

// What is owed and when. Everything here is an UNPAID purchase invoice —
// `purchase_invoices.paid_at IS NULL` — so marking one paid on the ledger takes
// it off this list with no second step.
function Aging() {
  const [a, setA] = useState(null);
  useEffect(() => { fetch('/api/admin/suppliers?view=aging').then((r) => r.json()).then(setA).catch(() => {}); }, []);
  if (!a || !a.total) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <div className="dash-kpis" style={{ marginBottom: 4 }}>
        <div className="kpi"><div className="kpi-label">Owed to suppliers</div>
          <div className="kpi-value">{money(a.total)}</div>
          <div className="kpi-sub">unpaid purchase invoices</div></div>
        <div className="kpi"><div className="kpi-label">Past due</div>
          <div className="kpi-value" style={{ color: a.totals.overdue + a.totals.over30 ? '#b3261e' : undefined }}>
            {money(a.totals.overdue + a.totals.over30)}
          </div>
          <div className="kpi-sub">{a.overdue.length + a.over30.length} invoice(s)</div></div>
        <div className="kpi"><div className="kpi-label">Due this week</div>
          <div className="kpi-value">{money(a.totals.week)}</div>
          <div className="kpi-sub">{a.week.length} invoice(s)</div></div>
      </div>

      <AgingBucket title="More than 30 days past due" rows={a.over30} total={a.totals.over30} tone="#b3261e" />
      <AgingBucket title="Past due" rows={a.overdue} total={a.totals.overdue} tone="#b3261e" />
      <AgingBucket title="Due within the week" rows={a.week} total={a.totals.week} />
      <AgingBucket title="Later" rows={a.later} total={a.totals.later} />
      <AgingBucket
        title="Terms unknown" rows={a.unknownTerms} total={a.totals.unknown}
        note={'These are NOT overdue — nobody has recorded terms for the supplier, so there is no due ' +
              'date to be past. Set the terms on the supplier below and they move into a real bucket.'} />
    </div>
  );
}

// Names typed onto our own orders and invoices that match no supplier. Each row
// is one of two answers: a new supplier, or another name for one we have.
function Unknown({ suppliers, onChange }) {
  const [names, setNames] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = () => fetch('/api/admin/suppliers?view=unknown').then((r) => r.json())
    .then((d) => setNames(d.names || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!names.length) return null;

  async function answer(vendor, fn) {
    setBusy(vendor); setErr('');
    try { await fn(); await load(); await onChange(); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 13.5, margin: '0 0 4px' }}>Names nobody has identified ({names.length})</h3>
      <p className="hint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        These were typed onto a purchase order or invoice and match no supplier on file, so they have
        no terms, no contact and no on-time record. Answering one also attaches everything already
        filed under that spelling.
      </p>
      {err && <div className="error-box">{err}</div>}
      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Name as typed</th><th style={{ textAlign: 'right' }}>Used</th><th>Last seen</th><th /></tr></thead>
        <tbody>
          {names.map((n) => (
            <tr key={n.vendor}>
              <td>{n.vendor}</td>
              <td style={{ textAlign: 'right' }}>{n.uses}</td>
              <td>{fmt(n.last_seen)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn" style={{ fontSize: 12 }} disabled={!!busy}
                        onClick={() => answer(n.vendor, () => post({ action: 'create', name: n.vendor }))}>
                  New supplier
                </button>
                <select className="btn" style={{ fontSize: 12, marginLeft: 6 }} value="" disabled={!!busy}
                        onChange={(e) => e.target.value &&
                          answer(n.vendor, () => post({ action: 'alias', id: Number(e.target.value), alias: n.vendor }))}>
                  <option value="">Another name for…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function AddSupplier({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', contactName: '', email: '', phone: '', termsDays: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return <button className="btn" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>+ Add a supplier</button>;

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      {err && <div className="error-box">{err}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input placeholder="Supplier name" value={f.name} style={{ ...inp, width: 190 }}
               onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input placeholder="Who to ring" value={f.contactName} style={{ ...inp, width: 150 }}
               onChange={(e) => setF({ ...f, contactName: e.target.value })} />
        <input placeholder="Email" value={f.email} style={{ ...inp, width: 200 }}
               onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input placeholder="Phone" value={f.phone} style={{ ...inp, width: 140 }}
               onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input type="number" min={0} placeholder="Terms (days)" value={f.termsDays} style={{ ...inp, width: 110 }}
               onChange={(e) => setF({ ...f, termsDays: e.target.value })} />
      </div>
      <p className="hint" style={{ fontSize: 12.5 }}>
        Leave terms blank if you do not know them. Blank means <b>unknown</b>, and their invoices say
        so — it is never read as due on receipt.
      </p>
      <button className="btn primary" disabled={busy || !f.name.trim()} onClick={async () => {
        setBusy(true); setErr('');
        try {
          const r = await post({ action: 'create', ...f });
          if (!r.created) setErr('Already on file under that name — nothing added.');
          else { setOpen(false); setF({ name: '', contactName: '', email: '', phone: '', termsDays: '' }); }
          await onAdded();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Add'}</button>
      <button className="btn" style={{ marginLeft: 6 }} onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
    </div>
  );
}

function TermsCell({ s, onSaved }) {
  const [v, setV] = useState(s.terms_days ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = String(v) !== String(s.terms_days ?? '');
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <input type="number" min={0} style={{ width: 62, textAlign: 'right' }} value={v}
             placeholder="—" onChange={(e) => setV(e.target.value)} />
      {dirty && (
        <button className="btn" style={{ fontSize: 11, marginLeft: 5 }} disabled={busy} onClick={async () => {
          setBusy(true);
          try { await post({ action: 'update', id: s.id, termsDays: v === '' ? null : v }); await onSaved(); }
          finally { setBusy(false); }
        }}>save</button>
      )}
    </span>
  );
}

// `show` picks which half of this panel renders, because the supplier page
// splits them across two tabs: 'owed' is the payables aging, 'file' is the
// contact book plus the names nobody has identified. Omitted renders both, which
// is how it is used anywhere it stands alone.
export default function Suppliers({ show = 'all' }) {
  const [list, setList] = useState(null);
  const [perf, setPerf] = useState([]);

  const load = async () => {
    const [a, b] = await Promise.all([
      fetch('/api/admin/suppliers').then((r) => r.json()).catch(() => ({})),
      fetch('/api/admin/suppliers?view=performance').then((r) => r.json()).catch(() => ({}))
    ]);
    setList(a.suppliers || []);
    setPerf(b.suppliers || []);
  };
  useEffect(() => { load(); }, []);
  if (!list) return null;

  const byId = Object.fromEntries(perf.map((p) => [p.id, p]));

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      {show === 'all' && <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Suppliers</h2>}

      {show !== 'file' && <Aging />}
      {show !== 'owed' && <Unknown suppliers={list} onChange={load} />}

      {show === 'owed' ? null : <>
      <h3 style={{ fontSize: 13.5, margin: '16px 0 4px' }}>On file ({list.length})</h3>
      {!list.length && (
        <p className="hint" style={{ margin: 0 }}>
          Nobody on file yet. Add the suppliers you buy from and their terms; the names already on
          your orders will attach themselves.
        </p>
      )}
      {list.length > 0 && (
        <div className="table-wrap"><table className="admin">
          <thead><tr>
            <th>Supplier</th><th>Who to ring</th><th>Terms</th>
            <th style={{ textAlign: 'right' }}>Ordered (12mo)</th>
            <th style={{ textAlign: 'right' }}>On time</th><th>Also known as</th>
          </tr></thead>
          <tbody>
            {list.map((s) => {
              const p = byId[s.id] || {};
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="hint" style={{ fontSize: 12.5 }}>
                    {[s.contact_name, s.email, s.phone].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td><TermsCell s={s} onSaved={load} /></td>
                  <td style={{ textAlign: 'right' }}>{money(p.orderedValue)}
                    <div className="hint" style={{ fontSize: 12 }}>{p.orders || 0} order(s)</div></td>
                  <td style={{ textAlign: 'right' }}>
                    {/* null is not zero. Nothing to measure says so. */}
                    {p.onTimePct === null || p.onTimePct === undefined
                      ? <span className="hint">no dated orders</span>
                      : <>{p.onTimePct}%<div className="hint" style={{ fontSize: 12 }}>of {p.dated}</div></>}
                  </td>
                  <td className="hint" style={{ fontSize: 12.5 }}>{(s.aliases || []).join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}

      <AddSupplier onAdded={load} />
      </>}
    </div>
  );
}
