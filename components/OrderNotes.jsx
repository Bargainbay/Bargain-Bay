'use client';
import { useEffect, useState } from 'react';

// Internal notes on an order or a stop, and "extras" — things the crew did that
// were not on the job. Used on the dispatch card and the orders board (mode
// "staff") and on the driver's stop (mode "driver"). Never shown to customers.
//
// Pass jobId, orderId or both; a stop with an order behind it shares its notes
// with the order, so whoever picks the customer up next sees all of it.
const when = (iso) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function OrderNotes({ jobId, orderId, mode = 'staff', onChanged }) {
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState('');
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const driver = mode === 'driver';

  const listUrl = driver
    ? `/api/driver/jobs?notes=${jobId}`
    : `/api/admin/order-notes?${jobId ? `jobId=${jobId}` : `orderId=${orderId}`}`;

  async function load() {
    try {
      const d = await fetch(listUrl, { cache: 'no-store' }).then((r) => r.json());
      setNotes(Array.isArray(d.notes) ? d.notes : []);
    } catch { setNotes([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [jobId, orderId]);

  async function post(payload) {
    setBusy(true); setErr('');
    try {
      const res = await fetch(driver ? '/api/driver/jobs' : '/api/admin/order-notes', {
        method: driver ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(driver ? { action: 'note', jobId, ...payload } : { jobId, orderId, ...payload })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not save that.');
      await load();
      onChanged?.();
      return true;
    } catch (e) {
      setErr(e.message || (driver ? 'No signal? Try again when you have a bar.' : 'Could not save that.'));
      return false;
    } finally { setBusy(false); }
  }

  async function add(e) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await post({ kind: extra ? 'extra' : 'note', body: text })) { setText(''); setExtra(false); }
  }

  return (
    <div className="onotes">
      <div className="onotes-head">Internal notes <span>(the customer never sees these)</span></div>
      {notes === null && <p className="hint" style={{ margin: 0 }}>Loading…</p>}
      {notes && !notes.length && <p className="hint" style={{ margin: 0 }}>Nothing yet.</p>}
      {notes && notes.map((n) => (
        <div key={n.id} className={'onotes-item' + (n.kind === 'extra' ? ' is-extra' : '') + (n.billedAt ? ' is-billed' : '')}>
          {n.kind === 'extra' && <b className="onotes-tag">EXTRA{n.billedAt ? ' · billed' : ''}</b>} {n.body}
          <span className="onotes-meta">
            {n.author}{n.role === 'driver' ? ' (driver)' : ''} · {when(n.at)}
            {!driver && n.kind === 'extra' && (
              <> · <button type="button" className="onotes-link" disabled={busy}
                onClick={() => post({ action: 'billed', noteId: n.id, billed: !n.billedAt })}>
                {n.billedAt ? 'mark not billed' : 'mark billed'}
              </button></>
            )}
          </span>
        </div>
      ))}
      <form onSubmit={add} className="onotes-form">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000}
          placeholder={extra ? 'What extra did you do? e.g. carried up 3 flights, removed door, hauled old unit'
            : 'Add a note for whoever handles this customer next'} />
        <label className="onotes-check">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
          {' '}Extra service done that was not on the job (office will review billing)
        </label>
        <button type="submit" className={driver ? 'drv-btn small' : 'btn'} disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : extra ? 'Add extra' : 'Add note'}
        </button>
        {err && <div className="error-box" style={{ marginTop: 6 }}>{err}</div>}
      </form>
    </div>
  );
}
