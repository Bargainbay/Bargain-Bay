'use client';
import { useMemo, useState } from 'react';

// "All of these are Canadian Discount Appliances."
//
// Written after a client's whole spreadsheet landed on the board under the
// wrong company and the only way back was the edit form, one card at a time.
// The importer no longer lets that happen, but stops already on the board still
// have to be repairable — and opening thirty cards is not a repair.
//
// It lives in the board bar rather than on the cards, because selecting on
// cards would mean a checkbox on every stop for a job that gets done once a
// month. The rows the office actually wants are already a set: "the ones with
// no client", "everything on the day", and that's what this offers.
export default function BulkClient({ jobs = [], clients = [], busy, onApply, onClose }) {
  const [clientId, setClientId] = useState('');
  const [picked, setPicked] = useState(() => new Set(jobs.filter((j) => !j.clientName && !j.orderId).map((j) => j.id)));
  const [result, setResult] = useState(null);

  const rows = useMemo(
    () => jobs.slice().sort((a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''))),
    [jobs]
  );

  const toggle = (id) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const pickAll = () => setPicked(new Set(rows.map((j) => j.id)));
  const pickNone = () => setPicked(new Set());
  // The set that answers the actual complaint: an import that landed with the
  // client unset, or set to somebody else.
  const pickUnset = () => setPicked(new Set(rows.filter((j) => !j.clientName && !j.orderId).map((j) => j.id)));

  const target = clients.find((c) => String(c.id) === String(clientId));

  async function apply() {
    const out = await onApply([...picked], clientId ? Number(clientId) : null);
    if (out) setResult(out);
  }

  return (
    <div className="disp-bulk">
      <div className="disp-bulk-head">
        <h4 style={{ margin: 0 }}>Set the client on several stops</h4>
        <button type="button" className="disp-pull-x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="imp-row">
        <label>
          Set them all to
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— no client (our own job) —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={pickUnset}>Only the ones with none</button>
        <button type="button" className="btn" onClick={pickAll}>All {rows.length}</button>
        <button type="button" className="btn" onClick={pickNone}>None</button>
      </div>

      <div className="disp-bulk-list">
        {rows.map((j) => (
          <label key={j.id} className={'disp-bulk-row' + (picked.has(j.id) ? ' is-on' : '')}>
            <input type="checkbox" checked={picked.has(j.id)} onChange={() => toggle(j.id)} />
            <span className="disp-bulk-num">{j.jobNumber}</span>
            <span className="disp-bulk-who">{j.customerName || '(no name)'}</span>
            <span className="disp-bulk-addr">{[j.address, j.city].filter(Boolean).join(', ')}</span>
            <span className={'disp-bulk-client' + (j.clientName ? '' : ' is-none')}>
              {j.clientName || (j.orderId ? 'Bargain Bay' : 'none')}
            </span>
          </label>
        ))}
        {!rows.length && <p className="hint">Nothing on this day yet.</p>}
      </div>

      {result && (
        <div className="imp-done">
          {result.changed} stop{result.changed === 1 ? '' : 's'} moved to <b>{target?.name || 'no client'}</b>
          {result.jobNumbers?.length > 0 && <> — {result.jobNumbers.join(', ')}</>}
          {result.refused?.length > 0 && (
            <ul className="imp-problems">
              {result.refused.map((r) => <li key={r.jobNumber}>{r.jobNumber} — {r.reason}, so it was left alone.</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="imp-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn accent" disabled={busy || picked.size === 0} onClick={apply}>
          {busy ? 'Setting…' : `Set ${picked.size} stop${picked.size === 1 ? '' : 's'} to ${target?.name || 'no client'}`}
        </button>
      </div>
    </div>
  );
}
