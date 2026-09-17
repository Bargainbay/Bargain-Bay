'use client';
import { useState } from 'react';
import { HST_RATE, money } from '../lib/constants';

// Upload a supplier purchase invoice (PDF/image) → AI extracts the units + costs
// AND the invoice's own tax → review/edit → the units go to the master tracker as
// "Untested", and the tax is recorded as an input tax credit.
//
// The tax figure is read by a model off a scan, so it is shown for CONFIRMATION
// and never filed on trust: it is the one number here that ends up on a
// government return.
const CATEGORIES = ['Refrigerator', 'Freezer', 'Washer', 'Dryer', 'Laundry Center', 'Dishwasher', 'Range', 'Wall Oven', 'Microwave', 'Range Hood', 'Cooktop', 'TV', 'Vacuum', 'Small Appliance', 'Other'];

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

// Cheap arithmetic checks on what the model read. They don't block the commit —
// a supplier's invoice can legitimately be odd — but a figure that doesn't add
// up is exactly the one that shouldn't be claimed without a second look.
function taxNote(head) {
  if (head.tax === '' || head.tax == null) return 'Enter the tax from the invoice, or 0 if it charged none.';
  const sub = Number(head.subtotal), tax = Number(head.tax), tot = Number(head.total);
  if (!Number.isFinite(tax) || tax < 0) return 'Enter the tax from the invoice, or 0 if it charged none.';
  if (tax === 0) return 'No tax claimed on this invoice.';
  const okSub = Number.isFinite(sub) && sub > 0 && head.subtotal !== '';
  const okTot = Number.isFinite(tot) && tot > 0 && head.total !== '';
  if (okSub && okTot && Math.abs(sub + tax - tot) > 0.02) {
    return `\u26a0 ${money(sub)} + ${money(tax)} doesn't come to ${money(tot)} — check the invoice.`;
  }
  if (okSub) {
    const pct = (tax / sub) * 100;
    if (Math.abs(pct - HST_RATE * 100) > 1.5) return `\u26a0 that's ${pct.toFixed(1)}% of the subtotal, not 13% — check it's right.`;
  }
  return `Claiming ${money(tax)} as an input tax credit.`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function PurchaseIntake() {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');
  const [head, setHead] = useState({ vendor: '', invoice: '', date: '', subtotal: '', tax: '', total: '' });
  const [items, setItems] = useState(null);
  const [done, setDone] = useState(null);
  // Units RS Ops booked in before this invoice arrived, per line: { [line]: units[] }.
  // Ticked lines FILL those tracker rows instead of adding the appliances again.
  const [matches, setMatches] = useState({});
  const [useMatch, setUseMatch] = useState({});
  const [matchNote, setMatchNote] = useState('');

  async function findMatches(list, invoice) {
    setMatchNote('');
    try {
      const res = await fetch('/api/admin/purchase-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'match', items: list, invoice })
      });
      const d = await res.json();
      const byLine = {};
      for (const m of d.matches || []) byLine[m.line] = m.units;
      setMatches(byLine);
      setUseMatch(Object.fromEntries(Object.keys(byLine).map((k) => [k, true])));
      if (d.error) setMatchNote(`Couldn't check for units already booked in (${d.error}) — committing will add every line as new.`);
    } catch {
      setMatches({}); setUseMatch({});
      setMatchNote("Couldn't check for units already booked in — committing will add every line as new.");
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('reading'); setErr(''); setWarn(''); setDone(null); setItems(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch('/api/admin/purchase-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract', fileBase64, mediaType: file.type || 'application/pdf' })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not read that file.'); return; }
      setHead({
        vendor: d.vendor || '', invoice: d.invoiceNumber || '', date: d.date || today(),
        subtotal: d.subtotal ?? '', tax: d.tax ?? '', total: d.total ?? ''
      });
      const read = (d.items || []).map((it) => ({ ...it, retail: it.retail ?? '', cost: it.cost ?? '' }));
      setItems(read);
      if (read.length) findMatches(read, d.invoiceNumber || '');
      if (d.truncated) setWarn(`That invoice was too long to read in one pass — only the first ${d.items?.length || 0} items were read. Check the list against the invoice and upload the remaining pages separately.`);
      if (!d.items?.length) setErr('No product line items found — try a clearer scan.');
    } catch {
      setErr('Upload failed — try again.');
    } finally {
      setBusy(''); e.target.value = '';
    }
  }

  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  // Removing a line renumbers everything after it, so the matches are asked again
  // rather than left pointing at the wrong rows.
  const removeItem = (i) => {
    const next = items.filter((_, j) => j !== i);
    setItems(next);
    findMatches(next, head.invoice);
  };
  const matchedCount = Object.entries(matches).reduce((a, [k, u]) => a + (useMatch[k] ? u.length : 0), 0);
  const unitCount = (items || []).reduce((a, it) => a + Math.max(1, Math.round(Number(it.qty) || 1)), 0);

  async function commit() {
    setBusy('commit'); setErr('');
    try {
      const res = await fetch('/api/admin/purchase-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'commit', vendor: head.vendor, invoice: head.invoice, items,
          matches: Object.entries(matches).filter(([k]) => useMatch[k]).map(([k, u]) => ({ line: Number(k), skus: u.map((x) => x.sku) })),
          date: head.date, subtotal: head.subtotal, tax: head.tax, total: head.total
        })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add to tracker.'); return; }
      setDone(d); setItems(null); setMatches({}); setUseMatch({});
    } catch {
      setErr('Network error.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Upload a supplier purchase invoice (PDF or photo). I&apos;ll read the units and costs, you review them, then I add
        them to the master tracker as <b>Untested</b> — no spreadsheet typing.
      </p>

      <label className="btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
        {busy === 'reading' ? 'Reading…' : '📄 Upload purchase invoice'}
        <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={onFile} disabled={!!busy} />
      </label>

      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {warn && <div className="notice-box" style={{ marginTop: 10 }}>⚠ {warn}</div>}
      {done && (
        <div className="notice-box" style={{ marginTop: 10 }}>
          ✓ <b>{done.count}</b> unit{done.count === 1 ? '' : 's'} on the tracker from this invoice
          {done.addedSkus?.length ? <> — {done.addedSkus.length} added ({done.addedSkus.join(', ')})</> : ''}
          {done.pendingSkus?.length ? <> — {done.pendingSkus.length} already booked in at RS Ops ({done.pendingSkus.join(', ')}), <b>waiting for admin approval</b> on <a href="/admin/inventory-gaps">Stock gaps</a> before their cost goes on the tracker</> : ''}.
          {done.pendingError && (
            <div style={{ color: 'var(--danger)', marginTop: 6 }}>
              Couldn&apos;t send the matches for approval ({done.pendingError}) — every line was added as new instead. Check Stock gaps for doubles.
            </div>
          )}
          They&apos;re held off the storefront until confirmed tested-working.
          {done.addedSkus?.length > 0 && (
            <> <a target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}
              href={`/admin/warehouse/labels?${new URLSearchParams({ type: 'units', skus: done.addedSkus.join(',') })}`}>
              Print their SKU stickers
            </a></>
          )}
          {done.tax > 0 && (
            <div style={{ marginTop: 6 }}>
              {money(done.tax)} recorded as an input tax credit{done.taxUpdated ? ' (this invoice was already on file — its figures were corrected)' : ''}.
            </div>
          )}
          {done.taxError && <div style={{ color: 'var(--danger)', marginTop: 6 }}>The units were added, but the tax wasn&apos;t recorded: {done.taxError}</div>}
          {done.failed?.length ? <div style={{ color: 'var(--danger)', marginTop: 6 }}>{done.failed.length} couldn&apos;t be added.</div> : null}
        </div>
      )}

      {items && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>Vendor <input value={head.vendor} onChange={(e) => setHead({ ...head, vendor: e.target.value })} placeholder="e.g. SecondShop" /></label>
            <label style={{ fontSize: 13 }}>Invoice # <input value={head.invoice} onChange={(e) => setHead({ ...head, invoice: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}>Invoice date <input type="date" max={today()} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} /></label>
          </div>

          <div className="panel" style={{ margin: '0 0 12px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14, color: 'var(--charcoal)' }}>Tax you paid on this invoice</b>
              <span className="hint" style={{ margin: 0 }}>Recoverable — it comes off what you remit</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              <label style={{ fontSize: 13 }}>Subtotal <input style={{ width: 110, textAlign: 'right' }} type="number" step="0.01" min="0" value={head.subtotal} onChange={(e) => setHead({ ...head, subtotal: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}>HST / tax <input style={{ width: 110, textAlign: 'right' }} type="number" step="0.01" min="0" value={head.tax} onChange={(e) => setHead({ ...head, tax: e.target.value })} placeholder="0.00" /></label>
              <label style={{ fontSize: 13 }}>Invoice total <input style={{ width: 110, textAlign: 'right' }} type="number" step="0.01" min="0" value={head.total} onChange={(e) => setHead({ ...head, total: e.target.value })} /></label>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', alignSelf: 'center' }}>{taxNote(head)}</div>
            </div>
          </div>
          {matchNote && <div className="notice-box" style={{ marginBottom: 10 }}>⚠ {matchNote}</div>}
          {matchedCount > 0 && (
            <div className="notice-box" style={{ marginBottom: 10 }}>
              {matchedCount} unit{matchedCount === 1 ? ' on this invoice is' : 's on this invoice are'} already on the tracker —
              RS Ops booked {matchedCount === 1 ? 'it' : 'them'} in before the invoice was uploaded. Committing sends each match to
              an <b>admin for approval</b> on Stock gaps; its cost, retail and this invoice number go on the tracker only once approved,
              and a rejected match is added as a new unit instead. Untick a line if the match is plainly wrong.
            </div>
          )}
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Description</th><th>Make</th><th>Model</th><th>Serial</th><th>Category</th><th style={{ textAlign: 'right' }}>Retail</th><th style={{ textAlign: 'right' }}>Cost</th><th>Qty</th><th>Already at RS Ops</th><th></th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td><input style={{ width: 240 }} value={it.description || ''} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="e.g. Blomberg 24in Washer/Dryer Combo, White" title="Searchable product title — include the appliance type" /></td>
                  <td><input style={{ width: 90 }} value={it.make} onChange={(e) => setItem(i, 'make', e.target.value)} /></td>
                  <td><input style={{ width: 130 }} value={it.model} onChange={(e) => setItem(i, 'model', e.target.value)} /></td>
                  <td><input style={{ width: 100 }} value={it.serial || ''} onChange={(e) => setItem(i, 'serial', e.target.value)} /></td>
                  <td>
                    <select value={it.category} onChange={(e) => setItem(i, 'category', e.target.value)} style={{ fontSize: 12.5 }}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td><input style={{ width: 80, textAlign: 'right' }} type="number" step="0.01" value={it.retail} onChange={(e) => setItem(i, 'retail', e.target.value)} /></td>
                  <td><input style={{ width: 80, textAlign: 'right' }} type="number" step="0.01" value={it.cost} onChange={(e) => setItem(i, 'cost', e.target.value)} placeholder="cost" /></td>
                  <td><input style={{ width: 48 }} type="number" min="1" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} /></td>
                  <td style={{ fontSize: 12, minWidth: 170 }}>
                    {matches[i]?.length ? (
                      <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontWeight: 400 }}>
                        <input type="checkbox" style={{ width: 'auto', marginTop: 2 }} checked={!!useMatch[i]}
                          onChange={(e) => setUseMatch((m) => ({ ...m, [i]: e.target.checked }))} />
                        <span>
                          {useMatch[i] ? 'Send for approval:' : 'Ignore'} {matches[i].map((u) => u.sku).join(', ')}
                          <span style={{ display: 'block', color: 'var(--muted)' }}>
                            booked in {matches[i][0].dateReceived || '—'}, no invoice yet
                          </span>
                        </span>
                      </label>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td><button type="button" className="btn" style={{ padding: '0 10px' }} onClick={() => removeItem(i)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn accent" disabled={busy === 'commit' || !items.length} onClick={commit}>
              {busy === 'commit' ? 'Adding…'
                : matchedCount
                  ? `Send ${matchedCount} match${matchedCount === 1 ? '' : 'es'} for approval${unitCount - matchedCount > 0 ? `, add ${unitCount - matchedCount} new` : ''}`
                  : `Add ${unitCount} unit${unitCount === 1 ? '' : 's'} to tracker`}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => findMatches(items, head.invoice)}
              title="Ask again after changing a model number">Re-check RS Ops units</button>
            <button className="btn" disabled={!!busy} onClick={() => { setItems(null); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
