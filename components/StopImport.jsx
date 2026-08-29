'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IMPORT_FIELDS, parseTable, QUEBEC_DROP } from '../lib/stop-import';

// A client's spreadsheet, onto the board.
//
// Paste is still a first-class input, not an afterthought: what people actually
// do is select the rows in the Excel the client emailed and hit copy, and
// Excel's clipboard is a TAB-separated table — so one box covers the attachment
// AND the stops typed into an email body.
//
// What changed is where the sheet LIVES while it's being looked at. It used to
// sit in this component's state, which meant the review could only ever happen
// in this tab, by the person who uploaded it, before they navigated away — and
// meant the app learned nothing from an import it had already been walked
// through once. Now an upload STAGES a batch server-side (`lib/import-batches`)
// and this screen is one of two things that can review it; the other one rings
// the owner's phone. Nothing is on the board until the batch is approved.
export default function StopImport({ clients = [], date, onDone }) {
  const [text, setText] = useState('');
  const [batch, setBatch] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [detected, setDetected] = useState(null);
  const [sheetInfo, setSheetInfo] = useState(null);   // { name, sheet, sheets, file, read, sender, warning }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [fixing, setFixing] = useState(null);         // row index being corrected

  // Tomorrow, not today. A sheet arrives the day before the run — defaulting to
  // the board's current day put a whole client's next-day stops on the wrong
  // date every time the date column was missing.
  const tomorrow = useMemo(() => {
    const d = new Date(`${date || new Date().toISOString().slice(0, 10)}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [date]);

  const post = useCallback(async (body) => {
    const res = await fetch('/api/admin/dispatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'That did not work.');
    return d;
  }, []);

  const take = useCallback((d) => {
    if (d.batch) setBatch(d.batch);
    if (d.questions) setQuestions(d.questions);
    // Only a fresh stage carries a detection; a later patch must not wipe the
    // reason the client was chosen off the screen.
    if (d.batch?.detected) setDetected(d.batch.detected);
    return d;
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dispatch?view=imports');
      const d = await res.json();
      if (res.ok) setDrafts(d.batches || []);
    } catch { /* a missing draft list is not worth an error box */ }
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  async function openDraft(id) {
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await fetch(`/api/admin/dispatch?view=import&batchId=${id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      take(d); setSheetInfo(null); setDetected(null); setText('');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // ── Getting a sheet in ────────────────────────────────────────────────────
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setResult(null); setBatch(null); setText(''); setSheetInfo(null);
    setBusy(true);
    try {
      if (/\.(xlsx|pdf|png|jpe?g|heic)$/i.test(file.name)) {
        await loadSheet(file);
      } else if (/\.xls$/i.test(file.name)) {
        // The pre-2007 binary format is a different thing entirely.
        setErr('That is the old .xls format — open it and Save As .xlsx or .csv.');
      } else {
        setText(await file.text());
      }
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function loadSheet(file, sheetName) {
    const fd = new FormData();
    fd.append('file', file);
    if (sheetName) fd.append('sheet', sheetName);
    const res = await fetch('/api/admin/dispatch/sheet', { method: 'POST', body: fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not read that file.');
    setSheetInfo({ name: d.name, sheet: d.sheet, sheets: d.sheets || [], file, read: d.read, sender: d.sender, warning: d.warning });
    if (d.stageError) setErr(d.stageError);
    take(d);
    loadDrafts();
  }

  async function switchSheet(name) {
    if (!sheetInfo?.file) return;
    setBusy(true); setErr('');
    try { await loadSheet(sheetInfo.file, name); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // Pasted rows take the same road: parsed here only to split them into a grid,
  // then staged like everything else so there is one reviewable thing.
  async function stagePaste() {
    const table = parseTable(text);
    if (!table.rows.length) { setErr('There are no rows in that.'); return; }
    setBusy(true); setErr(''); setResult(null);
    try {
      take(await post({
        action: 'stage_import', headers: table.headers, rows: table.rows,
        sourceName: 'pasted rows', readAs: 'paste'
      }));
      setSheetInfo(null);
      loadDrafts();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // ── Changing a staged batch ───────────────────────────────────────────────
  const patch = async (body) => {
    setBusy(true); setErr('');
    try { take(await post({ batchId: batch.id, ...body })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const setClient = (clientId) => patch({ action: 'import_client', clientId: clientId || null });
  const setDay = (jobDate) => patch({ action: 'import_patch', patch: { jobDate: jobDate || null } });
  const setQuebec = (on) => patch({ action: 'import_patch', patch: { quebecRule: on } });
  const setField = (key, idx) =>
    patch({ action: 'import_patch', patch: { mapping: { ...batch.mapping, [key]: idx === '' ? null : Number(idx) } } });
  const fixRow = (index, fields) => patch({ action: 'import_patch', patch: { rowOverrides: { [index]: fields } } });

  async function approve() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const d = await post({ action: 'import_approve', batchId: batch.id });
      setResult(d);
      setBatch(null); setQuestions([]); setText(''); setSheetInfo(null);
      loadDrafts();
      onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function discard() {
    if (!window.confirm('Throw this import away? Nothing has been added to the board.')) return;
    setBusy(true); setErr('');
    try {
      await post({ action: 'import_cancel', batchId: batch.id });
      setBatch(null); setQuestions([]); setText(''); setSheetInfo(null);
      loadDrafts();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const clientOf = (id) => clients.find((c) => String(c.id) === String(id))?.name
    || batch?.clients?.find((c) => String(c.id) === String(id))?.name || null;

  const list = clients.length ? clients : (batch?.clients || []);
  const blockers = questions.filter((q) => q.blocking);

  return (
    <div className="panel imp">
      <h3 style={{ marginTop: 0 }}>Import stops from a sheet</h3>

      {!batch && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Choose the client&apos;s <b>.xlsx</b>, .pdf or .csv — or paste the rows straight out of Excel. Keep the
            heading row. The columns are matched for you, and a sheet we have seen before is recognised on sight.
          </p>
          <textarea className="imp-paste" rows={6} value={text}
            placeholder={'Customer\tAddress\tCity\tDate\tItems\nGARDERIE MAISON…\t1213 International Blvd\tBurlington\t2026-08-30\tMisc pallet'}
            onChange={(e) => setText(e.target.value)} />
          <div className="imp-row">
            <label className="btn">
              {busy ? 'Reading…' : 'Choose a file (.xlsx, .pdf or .csv)'}
              <input type="file" accept=".xlsx,.pdf,.csv,.tsv,.txt,image/*" onChange={onFile} style={{ display: 'none' }} />
            </label>
            {text.trim() && (
              <button type="button" className="btn accent" disabled={busy} onClick={stagePaste}>
                Read these rows
              </button>
            )}
          </div>

          {drafts.length > 0 && (
            <div className="imp-drafts">
              <h4 className="imp-h4">Waiting to be checked</h4>
              {drafts.map((d) => (
                <button type="button" key={d.id} className="imp-draft" onClick={() => openDraft(d.id)}>
                  <b>{d.batchNumber}</b> · {d.sourceName || 'pasted rows'} · {d.rowCount} row{d.rowCount === 1 ? '' : 's'}
                  {d.clientName ? ` · ${d.clientName}` : ' · no client yet'}
                  {d.createdBy ? ` · ${d.createdBy}` : ''}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {err && <div className="error-box">{err}</div>}
      {result && (
        <div className="imp-done">
          Added <b>{result.added}</b> stop{result.added === 1 ? '' : 's'} to the board from {result.batchNumber}.
          {result.failed?.length > 0 && (
            <ul className="imp-problems">
              {result.failed.map((f, i) => <li key={i}>Row {f.row} — {f.customerName || f.address || 'a row'} — {f.error}</li>)}
            </ul>
          )}
        </div>
      )}

      {batch && (
        <>
          {/* Who this sheet is for, at the top, in words — not a dropdown three
              rows down that quietly keeps whatever it was last set to. A day of
              stops filed under the wrong company is the failure this answers. */}
          <div className={'imp-forwhom' + (batch.clientId ? '' : ' is-unset')}>
            <div className="imp-forwhom-main">
              <span className="imp-forwhom-label">This sheet is for</span>
              <select value={batch.clientId || ''} disabled={busy}
                onChange={(e) => setClient(e.target.value)}>
                <option value="">— nobody yet, pick the client —</option>
                {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {detected?.why && <div className="imp-forwhom-why">{detected.why}</div>}
            {batch.summary.clientIds.length > 1 && (
              <div className="imp-forwhom-why">
                The sheet names {batch.summary.clientIds.length} different clients on its own rows — each stop keeps
                the one it names. Choosing above overrides all of them.
              </div>
            )}
          </div>

          <div className="imp-file">
            <b>{batch.batchNumber}</b> · {batch.sourceName || 'pasted rows'} · {batch.summary.rows} row
            {batch.summary.rows === 1 ? '' : 's'}
            {sheetInfo?.sheets?.length > 1 ? ` · sheet “${batch.sourceName && sheetInfo.sheet}” of ${sheetInfo.sheets.length}` : ''}
            {sheetInfo?.sender ? ` · from ${sheetInfo.sender}` : ''}
            {batch.readAs === 'ai' && (
              <div className="imp-ai-warn">
                A PDF has no columns, so this was read by AI. <b>Check every row before you add it</b> —
                especially addresses and postal codes.
              </div>
            )}
            {sheetInfo?.warning && <div className="imp-ai-warn">{sheetInfo.warning}</div>}
          </div>

          <div className="imp-row">
            {sheetInfo?.sheets?.length > 1 && (
              <label>
                Sheet
                <select value={sheetInfo.sheet} onChange={(e) => switchSheet(e.target.value)} disabled={busy}>
                  {sheetInfo.sheets.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <label>
              Day (for rows with no date)
              <input type="date" value={batch.jobDate || ''} disabled={busy}
                onChange={(e) => setDay(e.target.value)} />
            </label>
            {!batch.jobDate && (
              <button type="button" className="btn" disabled={busy} onClick={() => setDay(tomorrow)}>
                Tomorrow ({tomorrow})
              </button>
            )}
            <label className="imp-check" title={`Delivery becomes ${QUEBEC_DROP.address}, ${QUEBEC_DROP.city}; the shipper becomes the pickup.`}>
              <input type="checkbox" checked={batch.quebecRule} disabled={busy}
                onChange={(e) => setQuebec(e.target.checked)} />
              Quebec loads = pickup only, drop at {QUEBEC_DROP.city}
            </label>
            <button type="button" className="btn" onClick={() => setShowMap((v) => !v)}>
              {showMap ? 'Hide columns' : 'Columns'}
            </button>
          </div>

          {showMap && (
            <>
              <h4 className="imp-h4">Which column is which</h4>
              <div className="imp-map">
                {IMPORT_FIELDS.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    <select value={batch.mapping[f.key] ?? ''} disabled={busy}
                      onChange={(e) => setField(f.key, e.target.value)}>
                      <option value="">—</option>
                      {batch.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <p className="hint">
                Corrected here once, this sheet&apos;s layout is remembered — the next one from{' '}
                {clientOf(batch.clientId) || 'this client'} maps itself.
              </p>
            </>
          )}

          {questions.length > 0 && (
            <>
              <h4 className="imp-h4">
                {questions.length} thing{questions.length === 1 ? '' : 's'} to check
                {blockers.length > 0 && ` · ${blockers.length} would stop a row being added`}
              </h4>
              <ul className="imp-problems imp-questions">
                {questions.slice(0, 12).map((q, i) => (
                  <li key={i} className={q.blocking ? 'is-blocking' : ''}>
                    {q.text}
                    {q.suggest?.clientId && (
                      <button type="button" className="imp-inline-btn" disabled={busy}
                        onClick={() => fixRow(q.row, { clientId: q.suggest.clientId })}>
                        use {q.suggest.name}
                      </button>
                    )}
                  </li>
                ))}
                {questions.length > 12 && <li>…and {questions.length - 12} more, listed against their rows below.</li>}
              </ul>
            </>
          )}

          <h4 className="imp-h4">
            {batch.summary.ready} ready
            {batch.summary.blocked > 0 && ` · ${batch.summary.blocked} can’t be added`}
            {batch.summary.dropped > 0 && ` · ${batch.summary.dropped} dropped`}
          </h4>
          <div className="imp-preview">
            <table>
              <thead>
                <tr>
                  <th>Customer</th><th>Address</th><th>Client</th><th>Day</th>
                  <th>Window</th><th>What</th><th>Problems</th><th />
                </tr>
              </thead>
              <tbody>
                {batch.stops.slice(0, 80).map((s) => (
                  <tr key={s.index} className={s.dropped ? 'is-dropped' : (s.blocking ? 'is-bad' : '')}>
                    <td>{s.job.customerName || '—'}</td>
                    <td>{[s.job.address, s.job.city].filter(Boolean).join(', ') || '—'}</td>
                    <td>{clientOf(s.job.clientId) || <span className="imp-none">none</span>}</td>
                    <td>{s.job.jobDate || '—'}</td>
                    <td>{s.job.windowStart ? `${s.job.windowStart}–${s.job.windowEnd || '?'}` : 'Any time'}</td>
                    <td>{s.job.items.map((it) => it.description).join(', ') || '—'}</td>
                    <td className="imp-prob">
                      {s.problems.filter((p) => !p.info).map((p) => p.text).join(' · ')}
                      {s.corrected && <span className="imp-fixed"> corrected</span>}
                    </td>
                    <td>
                      <button type="button" className="imp-inline-btn" disabled={busy}
                        onClick={() => setFixing(fixing === s.index ? null : s.index)}>
                        {fixing === s.index ? 'close' : 'fix'}
                      </button>
                      <button type="button" className="imp-inline-btn" disabled={busy}
                        onClick={() => fixRow(s.index, { drop: !s.dropped })}>
                        {s.dropped ? 'keep' : 'drop'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {batch.stops.length > 80 && (
              <p className="hint">Showing the first 80 — all {batch.summary.ready} ready rows will be added.</p>
            )}
          </div>

          {fixing != null && batch.stops[fixing] && (
            <RowFix stop={batch.stops[fixing]} clients={list} busy={busy}
              onSave={(fields) => { fixRow(fixing, fields); setFixing(null); }}
              onCancel={() => setFixing(null)} />
          )}

          <div className="imp-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" disabled={busy} onClick={discard}>Throw away</button>
            <button type="button" className="btn accent" disabled={busy || batch.summary.ready === 0}
              onClick={approve}>
              {busy ? 'Adding…' : `Add ${batch.summary.ready} stop${batch.summary.ready === 1 ? '' : 's'} to the board`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// One row, corrected. Deliberately only the fields that BLOCK a row or get it
// filed wrong — the full job form is on the card once it's on the board, and
// duplicating it here would be a second form to keep in step with the first.
function RowFix({ stop, clients, busy, onSave, onCancel }) {
  const [address, setAddress] = useState(stop.job.address || '');
  const [city, setCity] = useState(stop.job.city || '');
  const [postal, setPostal] = useState(stop.job.postal || '');
  const [clientId, setClientId] = useState(stop.job.clientId ? String(stop.job.clientId) : '');
  const [jobDate, setJobDate] = useState(stop.job.jobDate || '');

  return (
    <div className="imp-fix">
      <h4 className="imp-h4" style={{ marginTop: 0 }}>
        Row {stop.index + 1}{stop.job.customerName ? ` — ${stop.job.customerName}` : ''}
        {stop.sheetClient ? <span className="hint"> · the sheet says “{stop.sheetClient}”</span> : null}
      </h4>
      <div className="imp-row">
        <label style={{ flex: '2 1 240px' }}>
          Address
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="18 Elm St" />
        </label>
        <label>City<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label>Postal<input value={postal} onChange={(e) => setPostal(e.target.value)} /></label>
        <label>
          Client
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— none —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Day<input type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} /></label>
      </div>
      <div className="imp-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn accent" disabled={busy}
          onClick={() => onSave({
            address: address.trim(), city: city.trim(), postal: postal.trim(),
            clientId: clientId ? Number(clientId) : null,
            jobDate: jobDate || null
          })}>
          Save this row
        </button>
      </div>
    </div>
  );
}
