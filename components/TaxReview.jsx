'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';
import { splitGross } from '../lib/tax';

// The review queue: rows whose HST nobody has said anything about yet.
//
// This exists because a bank feed produces thousands of charges and the ledger
// treats an unanswered row as claiming nothing. Answering them one at a time is
// how they never get answered — so the whole point here is picking many at once.
// Filter to a vendor, tick the lot, say "13% was in these" or "no tax on these",
// and the year's credits move in one action.
//
// "13% HST included" SPLITS the row: a bank line is the gross charge, so the
// cost drops to the pre-tax figure and the difference becomes the credit.
export default function TaxReview({ initial = [] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => `${r.vendor || ''} ${r.category || ''} ${r.note || ''}`.toLowerCase().includes(t));
  }, [rows, q]);

  const toggle = (id) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allShown = shown.length > 0 && shown.every((r) => picked.has(r.id));
  const toggleAll = () => setPicked((s) => {
    const n = new Set(s);
    if (allShown) shown.forEach((r) => n.delete(r.id));
    else shown.forEach((r) => n.add(r.id));
    return n;
  });

  const chosen = rows.filter((r) => picked.has(r.id));
  const gross = Math.round(chosen.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100;
  // What ticking "13%" would actually claim — shown before it's clicked, because
  // this is the number that ends up on a return.
  const wouldClaim = Math.round(chosen.reduce((a, r) => a + splitGross(r.amount).tax, 0) * 100) / 100;

  async function apply(mode) {
    if (!picked.size) { setErr('Tick some rows first.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/expenses', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_tax', ids: [...picked], mode })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That failed.');
      setRows((r) => r.filter((x) => !picked.has(x.id)));
      setPicked(new Set());
      setMsg(mode === 'hst'
        ? `${d.updated} row(s) marked as HST-inclusive — ${money(d.credit)} claimed.`
        : `${d.updated} row(s) marked as carrying no recoverable tax.`);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!rows.length) {
    return <p className="hint" style={{ margin: 0 }}>Nothing waiting — every expense on file has had its HST answered.</p>;
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>{rows.length}</b> row{rows.length === 1 ? '' : 's'} with no HST recorded. Until they&apos;re answered they claim
        nothing, and the remittance figure reads as a ceiling. Filter to a vendor, tick the lot, answer once.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
        <input placeholder="Filter by vendor, category or note…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: '1 1 220px', minWidth: 0 }} />
        <button type="button" className="btn" onClick={toggleAll} disabled={!shown.length}>
          {allShown ? 'Clear' : `Select ${shown.length}`}
        </button>
      </div>

      {picked.size > 0 && (
        <div className="notice-box" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span><b>{picked.size}</b> picked · {money(gross)} charged</span>
          <button type="button" className="btn accent" disabled={busy} onClick={() => apply('hst')}>
            13% HST was included — claim {money(wouldClaim)}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => apply('none')}>
            No recoverable tax on these
          </button>
        </div>
      )}

      {err && <div className="error-box">{err}</div>}
      {msg && <div className="notice-box">{msg}</div>}

      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="admin">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Date</th><th>Vendor</th><th>Category</th>
              <th style={{ textAlign: 'right' }}>Charged</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((r) => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => toggle(r.id)}>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td>{r.incurredOn}</td>
                <td>
                  {r.vendor || '—'}
                  {r.source === 'plaid' && <span className="pill" style={{ fontSize: 10, marginLeft: 5 }} title="From the bank feed">bank</span>}
                  {r.source === 'qbo' && <span className="pill" style={{ fontSize: 10, marginLeft: 5 }}>QB</span>}
                  {r.note && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note}</div>}
                </td>
                <td>{r.category || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 300 && (
        <p className="hint" style={{ marginTop: 8 }}>
          Showing the first 300 of {shown.length}. Answer these and the next lot appears — or filter to one vendor
          and clear them in a batch.
        </p>
      )}
    </div>
  );
}
