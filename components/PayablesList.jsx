'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';

// Supplier invoices still owed. Marking one paid moves it out of payables and
// takes the cash out of the bank, dated to the day it was actually paid — which
// is routinely a different month from when the stock arrived, and the reason
// tracking this separately matters at all.
export default function PayablesList({ initial = [], canEdit = true }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [dates, setDates] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

  async function pay(r) {
    const paidAt = dates[r.id] || today;
    setBusy(String(r.id)); setErr('');
    try {
      const res = await fetch('/api/admin/ledger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay_purchase', id: r.id, paidAt })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That failed.');
      setRows(d.unpaid);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  if (!rows.length) {
    return <p className="hint" style={{ margin: 0 }}>Nothing outstanding — every supplier invoice on file is marked paid.</p>;
  }
  const total = rows.reduce((a, r) => a + r.total, 0);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>{money(total)}</b> owed across {rows.length} invoice{rows.length === 1 ? '' : 's'}, oldest first. This is
        the accounts-payable balance on the balance sheet.
      </p>
      {err && <div className="error-box">{err}</div>}
      <div className="table-wrap">
        <table className="admin">
          <thead><tr><th>Dated</th><th>Supplier</th><th>Invoice</th><th style={{ textAlign: 'right' }}>Owed</th>{canEdit && <th>Paid on</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.invoiceDate}</td>
                <td>{r.vendor || '—'}</td>
                <td>{r.invoiceNumber || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(r.total)}</td>
                {canEdit && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <input type="date" max={today} value={dates[r.id] || today}
                      onChange={(e) => setDates((d) => ({ ...d, [r.id]: e.target.value }))}
                      style={{ width: 'auto', fontSize: 12.5 }} />{' '}
                    <button className="dash-filter" disabled={!!busy} onClick={() => pay(r)}>
                      {busy === String(r.id) ? '…' : 'Mark paid'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
