'use client';
import { useMemo, useState } from 'react';
import { IMPORT_FIELDS, parseTable, guessMapping, toJobs } from '../lib/stop-import';

// A client's spreadsheet, onto the board.
//
// Paste is the primary input, not upload: what people actually do is select the
// rows in the Excel the client emailed and hit copy. Excel puts TAB-separated
// text on the clipboard, which is a table — so paste covers the attachment AND
// the stops typed into an email body, with nothing to save first.
//
// Nothing is written until the whole thing has been looked at. Auto-detected
// columns, every row previewed, every problem named next to the row it's on.
export default function StopImport({ clients = [], date, onDone }) {
  const [text, setText] = useState('');
  // A workbook read by the server, held apart from the paste box: an xlsx has
  // sheets and the paste box has none, and mixing them would mean one of the two
  // silently winning.
  const [book, setBook] = useState(null);      // { name, sheet, sheets, headers, rows }
  const [mapping, setMapping] = useState(null);
  const [clientId, setClientId] = useState('');
  const [jobDate, setJobDate] = useState(date || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const pasted = useMemo(() => parseTable(text), [text]);
  const table = book ? { headers: book.headers, rows: book.rows } : pasted;
  const map = mapping || (table.headers.length ? guessMapping(table.headers) : {});
  const parsed = useMemo(
    () => (table.rows.length ? toJobs(table.rows, map, { clientId: clientId || null, jobDate: jobDate || null }) : []),
    [table, map, clientId, jobDate]
  );
  const good = parsed.filter((p) => !p.blocking);

  function setField(key, idx) {
    setMapping({ ...map, [key]: idx === '' ? null : Number(idx) });
  }

  async function loadSheet(file, sheetName) {
    const fd = new FormData();
    fd.append('file', file);
    if (sheetName) fd.append('sheet', sheetName);
    const res = await fetch('/api/admin/dispatch/sheet', { method: 'POST', body: fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not read that file.');
    // Row 1 is the heading row on every client sheet I've seen; if it isn't,
    // the mapping selects say "Column 3" and the dispatcher points them
    // themselves.
    const [head, ...rest] = d.rows;
    return { name: d.name, sheet: d.sheet, sheets: d.sheets, headers: head, rows: rest, file };
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setMapping(null); setResult(null); setBook(null); setText('');
    setBusy(true);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        setBook(await loadSheet(file));
      } else if (/\.xls$/i.test(file.name)) {
        // The pre-2007 binary format is a different thing entirely.
        setErr('That is the old .xls format — open it and Save As .xlsx or .csv.');
      } else {
        setText(await file.text());
      }
    } catch (e2) {
      setErr(e2.message);
    } finally { setBusy(false); }
  }

  // A workbook with more than one tab: read the one they name.
  async function switchSheet(name) {
    if (!book?.file) return;
    setBusy(true); setErr(''); setMapping(null);
    try { setBook(await loadSheet(book.file, name)); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_stops', stops: good.map((p) => p.job) })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add those.'); return; }
      setResult(d);
      if (d.added > 0) { setText(''); setBook(null); setMapping(null); onDone?.(); }
    } catch {
      setErr('Network error — nothing was added.');
    } finally { setBusy(false); }
  }

  return (
    <div className="panel imp">
      <h3 style={{ marginTop: 0 }}>Import stops from a sheet</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Choose the client&apos;s <b>.xlsx</b> or .csv below — or paste the rows straight out of Excel. Keep the
        heading row; the columns are matched for you.
      </p>
      {book && (
        <div className="imp-file">
          Reading <b>{book.name}</b>
          {book.sheets.length > 1 ? ` · sheet “${book.sheet}” of ${book.sheets.length}` : ''}
          {' · '}{book.rows.length} row{book.rows.length === 1 ? '' : 's'}
        </div>
      )}

      <textarea className="imp-paste" rows={6} value={text} placeholder={'Customer\tAddress\tCity\tDate\tItems\nGARDERIE MAISON…\t1213 International Blvd\tBurlington\t2026-08-27\tMisc pallet'}
        onChange={(e) => { setText(e.target.value); setBook(null); setMapping(null); setResult(null); }} />

      <div className="imp-row">
        <label className="btn">
          {busy && !book ? 'Reading…' : 'Choose a file (.xlsx or .csv)'}
          <input type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={onFile} style={{ display: 'none' }} />
        </label>
        {book && (
          <label>
            Sheet
            <select value={book.sheet} onChange={(e) => switchSheet(e.target.value)} disabled={busy}>
              {book.sheets.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <label>
          For which client
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Us / no client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Day (for rows with no date)
          <input type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} />
        </label>
      </div>

      {err && <div className="error-box">{err}</div>}
      {result && (
        <div className="imp-done">
          Added <b>{result.added}</b> stop{result.added === 1 ? '' : 's'} to the board.
          {result.failed?.length > 0 && (
            <ul className="imp-problems">
              {result.failed.map((f, i) => <li key={i}>{f.customerName || f.address || 'a row'} — {f.error}</li>)}
            </ul>
          )}
        </div>
      )}

      {table.rows.length > 0 && (
        <>
          <h4 className="imp-h4">Which column is which</h4>
          <div className="imp-map">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key}>
                {f.label}
                <select value={map[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)}>
                  <option value="">—</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>

          <h4 className="imp-h4">
            {parsed.length} row{parsed.length === 1 ? '' : 's'} · {good.length} ready
            {parsed.length - good.length > 0 && ` · ${parsed.length - good.length} can’t be added`}
          </h4>
          <div className="imp-preview">
            <table>
              <thead>
                <tr><th>Customer</th><th>Address</th><th>Day</th><th>Window</th><th>What</th><th>Problems</th></tr>
              </thead>
              <tbody>
                {parsed.slice(0, 60).map((p, i) => (
                  <tr key={i} className={p.blocking ? 'is-bad' : ''}>
                    <td>{p.job.customerName || '—'}</td>
                    <td>{[p.job.address, p.job.city].filter(Boolean).join(', ') || '—'}</td>
                    <td>{p.job.jobDate || '—'}</td>
                    <td>{p.job.windowStart ? `${p.job.windowStart}–${p.job.windowEnd || '?'}` : 'Any time'}</td>
                    <td>{p.job.items.map((it) => it.description).join(', ') || '—'}</td>
                    <td className="imp-prob">{p.problems.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 60 && <p className="hint">Showing the first 60 — all {parsed.length} will be added.</p>}
          </div>

          <div className="imp-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => { setText(''); setBook(null); setMapping(null); setResult(null); }}>
              Clear
            </button>
            <button type="button" className="btn accent" disabled={busy || good.length === 0} onClick={submit}>
              {busy ? 'Adding…' : `Add ${good.length} stop${good.length === 1 ? '' : 's'} to the board`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
