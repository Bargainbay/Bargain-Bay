'use client';
import { useState } from 'react';
import { LISTING_STATUSES } from '../lib/listing-rules';

const LABEL = {
  draft: 'Draft', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved',
  awaiting_checkin: 'Bring to our warehouse', live: 'For sale', paused: 'Paused', reserved: 'Reserved',
  sold: 'Sold', rejected: 'Rejected', withdrawn: 'Withdrawn'
};
const TONE = { live: 'ok', in_review: '', changes_requested: 'warn', rejected: 'warn', awaiting_checkin: 'warn', draft: '' };

export default function VendorListings({ initial = [], initialStatus = '', canList = true }) {
  const [rows, setRows] = useState(initial);
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function start() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/vendor/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not start a listing.'); return; }
      window.location.href = `/vendor/listings/${d.id}`;
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  const shown = status ? rows.filter((r) => r.status === status) : rows;
  const counts = Object.fromEntries(LISTING_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Your listings</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All ({rows.length})</option>
          {LISTING_STATUSES.filter((s) => counts[s]).map((s) => <option key={s} value={s}>{LABEL[s]} ({counts[s]})</option>)}
        </select>
        <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={busy || !canList} onClick={start}>+ New listing</button>
      </div>
      {!canList && <div className="error-box">Your account cannot list new units right now. See the Performance tab.</div>}
      {err && <div className="error-box">{err}</div>}
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
        One row is one physical unit. Selling three identical fridges means three listings.
      </p>
      <div className="table-wrap"><table className="admin"><thead><tr>
        <th>SKU</th><th>Unit</th><th>Condition</th><th>Price</th><th>Photos</th><th>Status</th><th />
      </tr></thead><tbody>
        {shown.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>Nothing here yet.</td></tr>}
        {shown.map((l) => (
          <tr key={l.id}>
            <td style={{ fontFamily: 'ui-monospace, monospace' }}>{l.sku}</td>
            <td>{l.title || [l.make, l.model].filter(Boolean).join(' ') || <em>Untitled</em>}</td>
            <td>{l.condition || '—'}</td>
            <td>{l.price != null ? `$${l.price.toLocaleString('en-CA')}` : '—'}</td>
            <td>{l.photoCount}</td>
            <td><span className={`pill ${TONE[l.status] || ''}`}>{LABEL[l.status] || l.status}</span>
              {l.status === 'changes_requested' && l.reviewNote ? <div style={{ fontSize: 12, marginTop: 4 }}>{l.reviewNote}</div> : null}
              {l.status === 'rejected' && l.reviewNote ? <div style={{ fontSize: 12, marginTop: 4 }}>{l.reviewNote}</div> : null}</td>
            <td><a href={`/vendor/listings/${l.id}`}>Open</a></td>
          </tr>
        ))}
      </tbody></table></div>
    </div>
  );
}
