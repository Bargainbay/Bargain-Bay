'use client';
import { useState } from 'react';

// Upload or paste -> preview every row -> confirm -> report. Nothing is written until Confirm,
// and Confirm sends the text back to be read and checked again by the server.
export default function VendorBulkUpload({ max = 100, help = {}, canList = true }) {
  const [text, setText] = useState('');
  const [pv, setPv] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function preview(body, headers) {
    setBusy(true); setErr(''); setPv(null); setRes(null);
    try {
      const r = await fetch('/api/vendor/listings/bulk/preview', { method: 'POST', headers, body });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not read that.'); return; }
      setPv(d); if (d.text != null) setText(d.text);
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }
  const fromFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    preview(fd, {}); e.target.value = '';
  };
  const fromPaste = () => preview(JSON.stringify({ text }), { 'Content-Type': 'application/json' });

  async function confirm() {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/vendor/listings/bulk/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, token: pv.token })
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not import.'); return; }
      setRes(d); setPv(null);
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Bulk upload</h2>
        <a href="/vendor/listings" style={{ marginLeft: 'auto', fontSize: 14 }}>Back to listings</a>
      </div>
      {!canList && <div className="error-box">Your account cannot list new units right now.</div>}
      {err && <div className="error-box">{err}</div>}

      {!res && (
        <>
          <p style={{ fontSize: 14, marginTop: 0 }}>
            Fill in one row per physical unit (up to {max} per upload), then upload the file or paste the rows from Excel.
            We show you every row and every problem first; nothing is created until you confirm. Confirming creates
            <strong> drafts</strong> only: you then add photos to each one and submit it, exactly as for a single listing.
          </p>
          <p style={{ fontSize: 14 }}>
            <a className="btn" href="/api/vendor/listings/bulk/template">Download the CSV template</a>{' '}
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>It has every column and one example row. Delete the example.</span>
          </p>
          <details style={{ fontSize: 13, marginBottom: 12 }}>
            <summary>What goes in the columns</summary>
            <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
              {Object.entries(help).map(([k, v]) => <li key={k}><code>{k}</code>: {v}</li>)}
              <li>Photos cannot go in a spreadsheet. Add them to each draft afterwards.</li>
            </ul>
          </details>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 14 }}>Upload a CSV or Excel (.xlsx) file<br />
              <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={fromFile} disabled={busy || !canList} />
            </label>
            <label style={{ fontSize: 14 }}>…or paste rows copied from Excel (include the heading row)
              <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
            </label>
            <div><button className="btn primary" disabled={busy || !canList || !text.trim()} onClick={fromPaste}>{busy ? 'Checking…' : 'Preview'}</button></div>
          </div>
        </>
      )}

      {pv && !pv.ok && (
        <div className="error-box" style={{ marginTop: 12 }}>
          <strong>This file cannot be read yet.</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{pv.fileProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}

      {pv && pv.ok && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 14 }}>
            <strong>{pv.counts.ready}</strong> of {pv.counts.rows} rows are ready to import
            {pv.counts.blocked ? <>; <strong>{pv.counts.blocked}</strong> have problems and will be skipped. Fix them in your file and upload again, or fix them on the draft afterwards.</> : '.'}
          </p>
          {pv.ignored?.length > 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Columns we did not recognise and ignored: {pv.ignored.join(', ')}.</p>}
          <div className="table-wrap"><table className="admin"><thead><tr>
            <th>Row</th><th>Unit</th><th>Condition</th><th>Price</th><th>Lane</th><th>Result</th>
          </tr></thead><tbody>
            {pv.rows.map((r) => (
              <tr key={r.row}>
                <td>{r.row}</td>
                <td>{[r.values.make, r.values.model].filter(Boolean).join(' ') || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.values.title}</div></td>
                <td>{r.values.condition || '—'}</td>
                <td>{r.values.price != null ? `$${Number(r.values.price).toLocaleString('en-CA')}` : '—'}</td>
                <td>{r.values.lane || '—'}</td>
                <td>
                  {r.ok ? <span className="pill ok">Ready</span> : (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>{r.problems.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
                  )}
                  {r.warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>{w.text}</div>)}
                </td>
              </tr>
            ))}
          </tbody></table></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy || pv.counts.ready === 0} onClick={confirm}>
              {busy ? 'Creating…' : `Create ${pv.counts.ready} draft${pv.counts.ready === 1 ? '' : 's'}`}
            </button>
            <button className="btn" disabled={busy} onClick={() => setPv(null)}>Cancel</button>
          </div>
        </div>
      )}

      {res && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 15 }}>
            <strong>{res.created.length}</strong> draft{res.created.length === 1 ? '' : 's'} created
            {res.already.length ? `, ${res.already.length} were already created by an earlier confirm` : ''}
            {res.failed.length ? `, ${res.failed.length} not imported` : ''}.
          </p>
          <p style={{ fontSize: 14 }}>Next: open each draft and add its photos (including the rating plate), then submit it for review. A draft with no photos cannot be submitted.</p>
          {res.failed.length > 0 && (
            <div className="error-box"><strong>Not imported</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {res.failed.map((f) => <li key={f.row}>Row {f.row}: {f.problems.map((p) => p.text).join(' ')}</li>)}
              </ul>
            </div>
          )}
          <div className="table-wrap"><table className="admin"><thead><tr><th>Row</th><th>SKU</th><th /></tr></thead><tbody>
            {[...res.created, ...res.already].sort((a, b) => a.row - b.row).map((c) => (
              <tr key={c.id}><td>{c.row}</td><td style={{ fontFamily: 'ui-monospace, monospace' }}>{c.sku}</td><td><a href={`/vendor/listings/${c.id}`}>Add photos</a></td></tr>
            ))}
          </tbody></table></div>
          <p><a className="btn" href="/vendor/listings">Go to your listings</a></p>
        </div>
      )}
    </div>
  );
}
