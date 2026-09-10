'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';

// Vendors who left stock with us and are owed for the units that have SOLD.
//
// A supplier invoice is settled as a document; this is settled per UNIT, because
// that is how the arrangement works — the vendor is paid for the fridge that
// went out, not for the five still standing in the warehouse. Marking one paid
// clears the liability and takes the cash out of the bank on the day it actually
// moved, which is routinely a different month from the sale.
export default function ConsignmentOwed({ initial = [], canEdit = true }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [edit, setEdit] = useState({}); // sku -> { date, amount }
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

  async function pay(r) {
    const e = edit[r.sku] || {};
    setBusy(r.sku); setErr('');
    try {
      const res = await fetch('/api/admin/ledger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay_consignment', sku: r.sku, paidOn: e.date || today, amount: e.amount })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That failed.');
      setRows(d.owed);
      router.refresh();
    } catch (e2) { setErr(e2.message); } finally { setBusy(''); }
  }

  if (!rows.length) {
    return <p className="hint" style={{ margin: 0 }}>Nothing owed — every consigned unit that has sold is paid for.</p>;
  }
  const total = rows.reduce((a, r) => a + r.cost, 0);
  const vendors = new Set(rows.map((r) => r.vendor || '—')).size;

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>{money(total)}</b> owed across {rows.length} sold unit{rows.length === 1 ? '' : 's'} and {vendors} vendor
        {vendors === 1 ? '' : 's'}, oldest sale first. These appliances were never bought — they were left here and
        are paid for once they sell, so this is a liability the day the unit goes out and not before.
      </p>
      {err && <div className="error-box">{err}</div>}
      <div className="table-wrap">
        <table className="admin">
          <thead><tr>
            <th>Sold</th><th>Vendor</th><th>Unit</th><th>SKU</th>
            <th style={{ textAlign: 'right' }}>Owed</th>{canEdit && <th>Paid on</th>}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.soldOn || '—'}
                  {r.soldRef && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.soldRef}</div>}</td>
                <td>{r.vendor || '—'}</td>
                <td>{r.title || '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.sku}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(r.cost)}</td>
                {canEdit && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <input type="date" max={today} value={(edit[r.sku]?.date) || today}
                      onChange={(e) => setEdit((d) => ({ ...d, [r.sku]: { ...d[r.sku], date: e.target.value } }))}
                      style={{ width: 'auto', fontSize: 12.5 }} />{' '}
                    {/* Blank means "what was agreed". A vendor settled at a round
                        number is ordinary, and the figure that left the bank is
                        the one the ledger has to carry. */}
                    <input type="number" min="0" step="0.01" placeholder={String(r.cost)}
                      value={(edit[r.sku]?.amount) ?? ''}
                      onChange={(e) => setEdit((d) => ({ ...d, [r.sku]: { ...d[r.sku], amount: e.target.value } }))}
                      style={{ width: 88, fontSize: 12.5 }} title="Leave blank to pay the agreed cost." />{' '}
                    <button className="dash-filter" disabled={!!busy} onClick={() => pay(r)}>
                      {busy === r.sku ? '…' : 'Mark paid'}
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
