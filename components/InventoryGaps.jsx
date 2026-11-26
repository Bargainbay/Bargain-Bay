'use client';
import { useEffect, useState } from 'react';
import { money } from '../lib/constants';
import { splitAmount, quantityHint, singleUnitDescription, modelTokens } from '../lib/stock-match';

// The two ways stock stops adding up, each with the button that fixes it.
//
//   Units with no cost — RS Ops has the appliance, so the tracker has it too, but
//   no purchase invoice has priced it. An admin types the cost here, or the lot's
//   invoice is uploaded on the Intake tab and its lines fill these rows in.
//
//   Sold without a stock unit — an invoice line sold an appliance without saying
//   which one, so it still reads as in stock. The fix is picking the unit that
//   went out. The candidates are unsold units of the model the line names; which
//   of two identical fridges left is something only the floor knows, so nothing
//   here picks for you. A line that sold several ("2x …", "6 sets") takes several
//   units: it is split into one line per unit, the amount divided to the cent.

//   Express (admin) — the appliance was never entered into stock at all: type what
//   it cost, before HST, and Save adds the unit and links the line in one step.

// "2x …", "x2", "qty 2" prefill the unit count; "6 sets" does not (a set is two
// appliances more often than one), so it stays 1 and the hint is shown.
function leadingCount(description) {
  const h = quantityHint(description);
  return /set|unit|pcs|piece|pair/i.test(h) ? 1 : Number(h.match(/\d+/)?.[0]) || 1;
}

// "$929.20 each", or "$33.33, $33.33 and $33.34" when the last carries a cent.
function splitText(amounts = []) {
  if (amounts.length <= 1) return money(amounts[0] || 0);
  if (amounts.every((a) => a === amounts[0])) return `${money(amounts[0])} each`;
  return `${amounts.slice(0, -1).map(money).join(', ')} and ${money(amounts[amounts.length - 1])}`;
}

export default function InventoryGaps() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [armed, setArmed] = useState('');
  // itemId → the SKUs ticked for that line, in the order they were ticked.
  const [picked, setPicked] = useState({});
  // sku → the cost typed in its box and not yet saved.
  const [costs, setCosts] = useState({});
  // itemId → what was typed in the express boxes: { cost, units, model }.
  const [express, setExpress] = useState({});
  // itemIds the server refused because we hold that model: the next Save adds anyway.
  const [anyway, setAnyway] = useState({});

  async function load() {
    setErr('');
    try {
      const res = await fetch('/api/admin/inventory-gaps', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load.');
      setData(d);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function post(body, key) {
    setBusy(key); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/inventory-gaps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That did not work.');
      return d;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(''); setArmed(''); }
  }

  function toggle(line, sku) {
    setArmed('');
    setPicked((p) => {
      const cur = p[line.itemId] || [];
      const next = cur.includes(sku) ? cur.filter((x) => x !== sku) : [...cur, sku];
      return { ...p, [line.itemId]: next };
    });
  }

  async function link(line) {
    const skus = picked[line.itemId] || [];
    if (!skus.length) return;
    const key = `link:${line.itemId}`;
    if (armed !== key) { setArmed(key); return; }
    const d = await post({ action: 'link', itemId: line.itemId, skus, alreadyLinked: line.linkedSku || null }, key);
    if (!d) return;
    const list = (d.skus || [d.sku]).join(', ');
    const what = d.stock === 'sold' ? 'marked sold'
      : d.stock === 'held' ? 'held off the website until it’s paid'
      : `linked, but another order is holding ${d.contested?.length ? d.contested.join(', ') : 'one'} — check`;
    setMsg(`${d.number}: “${line.description}” is now ${list}`
      + (d.skus?.length > 1 ? `, one line each at ${splitText(d.amounts)}` : '')
      + ` — ${what}.`
      + (d.orderLineFound === false ? ' The order behind it had no matching line, so only the invoice was split — check the order.' : ''));
    setPicked((p) => ({ ...p, [line.itemId]: [] }));
    load();
  }

  async function decide(action, ids, label) {
    const key = `${action}:${ids.join(',')}`;
    if (armed !== key) { setArmed(key); return; }
    const d = await post({ action, ids }, key);
    if (!d) return;
    if (action === 'approve_fills') {
      setMsg(`${label}: ${d.approved.length} approved — cost and invoice are on the tracker.`
        + (d.refused.length ? ` Not filled: ${d.refused.map((r) => `${r.sku} (${r.reason})`).join('; ')}.` : ''));
    } else {
      setMsg(`${label}: ${d.rejected.length} rejected — the booked-in unit is left waiting for its own invoice`
        + (d.added?.length ? `, and the invoice line was added as ${d.added.join(', ')}.` : '.')
        + (d.addErrors?.length ? ` Couldn't add the line: ${d.addErrors.join('; ')}.` : ''));
    }
    load();
  }

  const typed = (skus) => skus.filter((sku) => String(costs[sku] ?? '').trim() !== '');

  async function saveCosts(skus) {
    const list = typed(skus).map((sku) => ({ sku, cost: costs[sku] }));
    if (!list.length || busy) return;
    const d = await post({ action: 'set_costs', costs: list }, 'costs');
    if (!d) return;
    const lines = d.invoiceLines + d.orderLines;
    setMsg([
      d.saved.length && `Saved ${d.saved.length} cost${d.saved.length === 1 ? '' : 's'} to the tracker and the system${lines ? `, including ${d.invoiceLines} invoice line${d.invoiceLines === 1 ? '' : 's'} and ${d.orderLines} order line${d.orderLines === 1 ? '' : 's'}` : ''}.`,
      d.kept?.length && `Left alone, because a different cost is typed on the sale: ${d.kept.map((k) => `${k.invoice} (${k.sku}, ${money(k.cost)})`).join('; ')}.`,
      d.refused?.length && `Not saved: ${d.refused.map((r) => `${r.sku} (${r.reason})`).join('; ')}.`
    ].filter(Boolean).join(' '));
    const done = new Set(d.saved.map((u) => u.sku));
    await load();
    setCosts((c) => Object.fromEntries(Object.entries(c).filter(([sku]) => !done.has(sku))));
  }

  const boxes = (s) => ({
    cost: express[s.itemId]?.cost ?? (s.cost > 0 ? String(s.cost) : ''),
    units: express[s.itemId]?.units ?? String(leadingCount(s.description)),
    model: express[s.itemId]?.model ?? (modelTokens(s.description)[0] || '')
  });
  const setBox = (id, field, value) => {
    setExpress((x) => ({ ...x, [id]: { ...x[id], [field]: value } }));
    setAnyway((a) => ({ ...a, [id]: false }));
  };
  // Only lines somebody TYPED a cost on are saved by "Save all" — a figure that
  // was already on the line is shown, never sent on its own.
  const typedExpress = (lines) => lines.filter((s) => String(express[s.itemId]?.cost ?? '').trim() !== '');

  async function addSold(lines) {
    if (!lines.length || busy) return;
    const entries = lines.map((s) => ({ itemId: s.itemId, ...boxes(s), confirmNew: !!anyway[s.itemId] }));
    const d = await post({ action: 'add_sold', entries }, 'express');
    if (!d) return;
    const lost = d.saved.filter((x) => x.orderLineFound === false).map((x) => x.number);
    setMsg([
      d.saved.length && `Added and costed: ${d.saved.map((x) => `${x.number} (${x.skus.join(', ')}, ${money(x.cost)})`).join('; ')}.`,
      lost.length && `The order behind ${lost.join(', ')} had no matching line, so profit reports won't see that cost — check the order.`,
      d.refused.length && `Not saved: ${d.refused.map((r) => `${r.number || r.itemId}: ${r.reason}`).join('; ')}.`
    ].filter(Boolean).join(' '));
    setAnyway(Object.fromEntries(d.refused.filter((r) => r.duplicate).map((r) => [r.itemId, true])));
    const done = new Set(d.saved.map((x) => String(x.itemId)));
    await load();
    setExpress((x) => Object.fromEntries(Object.entries(x).filter(([id]) => !done.has(id))));
  }

  const expressCell = (s) => {
    const b = boxes(s);
    const n = Math.max(1, Math.floor(Number(b.units) || 1));
    const cost = Number(String(b.cost).replace(/[$,\s]/g, ''));
    const onKey = (e) => { if (e.key === 'Enter') addSold([s]); };
    const box = { padding: '4px 6px' };
    return (
      <td style={{ verticalAlign: 'top', fontSize: 13, minWidth: 250 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--muted)' }}>$</span>
          <input type="text" inputMode="decimal" placeholder="cost" aria-label={`Cost before HST for ${s.number}: ${s.description}`}
            value={b.cost} disabled={busy === 'express'} onChange={(e) => setBox(s.itemId, 'cost', e.target.value)} onKeyDown={onKey}
            style={{ ...box, width: 90, textAlign: 'right' }} />
          <button className={'btn' + (anyway[s.itemId] ? ' accent' : '')} style={{ fontSize: 12.5 }} disabled={!!busy || !String(b.cost).trim()}
            onClick={() => addSold([s])}>{anyway[s.itemId] ? 'Add anyway' : 'Save'}</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <input type="text" placeholder="model (optional)" aria-label={`Model for ${s.number}`} value={b.model} disabled={busy === 'express'}
            onChange={(e) => setBox(s.itemId, 'model', e.target.value)} onKeyDown={onKey} style={{ ...box, width: 140 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>units
            <input type="number" min="1" max="40" value={b.units} disabled={busy === 'express'}
              onChange={(e) => setBox(s.itemId, 'units', e.target.value)} onKeyDown={onKey} style={{ ...box, width: 54 }} />
          </label>
        </div>
        {cost > 0 && (
          <div className="hint" style={{ margin: '3px 0 0', color: cost > s.amount ? 'var(--danger)' : undefined }}>
            {n > 1 && <>{splitText(splitAmount(cost, n))} · </>}
            {cost > s.amount ? `costs ${money(cost - s.amount)} more than it sold for` : `profit ${money(s.amount - cost)}`}
          </div>
        )}
      </td>
    );
  };

  // Requests grouped by the invoice they came from — an admin reads one delivery at a time.
  const fillGroups = (() => {
    const m = new Map();
    for (const r of data?.fillRequests || []) {
      const k = `${r.invoice || '(no invoice number)'} · ${r.vendor || 'no vendor'}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()];
  })();

  async function checkRsOps() {
    const d = await post({ action: 'check_rsops' }, 'rsops');
    if (!d) return;
    setMsg(d.errors?.length
      ? `RS Ops check had problems: ${d.errors.join('; ')}`
      : `Checked ${d.pulled} RS Ops unit${d.pulled === 1 ? '' : 's'}: ${d.added} added to the tracker, ${d.rekeyed} matched to rows the invoice had already put there.`);
    load();
  }

  const th = { textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap' };
  const waitingUnits = (data?.waiting || []).flatMap((l) => l.units);
  const toSave = typed(waitingUnits.map((u) => u.sku));
  const unlinked = (data?.unlinked || []).filter((l) => !l.linkedSku);
  const underLinked = (data?.unlinked || []).filter((l) => l.linkedSku);

  // One sale line and its unit picker — the same row for a line with no unit and
  // for a line linked to one unit that sold more.
  const saleRow = (s, withExpress = false) => (
    <tr key={s.itemId}>
      <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <a href={`/admin/invoices?q=${encodeURIComponent(s.number)}`}><b>{s.number}</b></a>
        <div className="hint" style={{ margin: 0 }}>{s.date} · {s.status}</div>
      </td>
      <td style={{ verticalAlign: 'top' }}>
        {s.description}
        {s.linkedSku && <div className="hint" style={{ margin: 0 }}>linked to <span style={{ fontFamily: 'monospace' }}>{s.linkedSku}</span> only</div>}
        {s.kind === 'service' && <div className="hint" style={{ margin: 0 }}>typed as a service</div>}
        {s.offStockReason && <div className="hint" style={{ margin: 0 }}>marked not from our stock: {s.offStockReason}</div>}
      </td>
      <td style={{ verticalAlign: 'top', textAlign: 'right' }}>{money(s.amount)}</td>
      <td style={{ fontSize: 13 }}>
        {s.candidates.length === 0 && <span className="hint" style={{ margin: 0 }}>{s.models?.length ? 'No unsold unit of this model on the tracker.' : 'No model number on the line, and nothing on the tracker matches its brand and type.'}</span>}
        {s.loose && (
          <div className="hint" style={{ margin: '0 0 4px', color: 'var(--warn-ink, #8a5300)' }}>
            The line names no model, so these are units of the same brand, type and size — not a match. Check the serial on the customer&apos;s paperwork or delivery photos before linking.
          </div>
        )}
        {s.candidates.length > 0 && quantityHint(s.description) && (
          <div className="hint" style={{ margin: '0 0 4px' }}>The line says “{quantityHint(s.description)}” — tick every {s.linkedSku ? 'other ' : ''}unit it sold.</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {s.linkedSku && (
            <span className="btn accent" style={{ fontSize: 12.5, textAlign: 'left', opacity: 0.75, cursor: 'default' }} title="Already on this line — it stays">
              <span style={{ fontFamily: 'monospace' }}>☑ {s.linkedSku}</span>
              <span style={{ display: 'block', fontSize: 11.5 }}>already on the line</span>
            </span>
          )}
          {s.candidates.map((c) => {
            const on = (picked[s.itemId] || []).includes(c.sku);
            return (
              <button key={c.sku} className={'btn' + (on ? ' accent' : '')} style={{ fontSize: 12.5, textAlign: 'left' }}
                disabled={!!busy} onClick={() => toggle(s, c.sku)} aria-pressed={on}
                title={`${c.model}${c.serial ? ` · serial ${c.serial}` : ''} · ${c.status || 'no status'} · received ${c.dateReceived || '—'}`}>
                <span style={{ fontFamily: 'monospace' }}>{on ? '☑' : '☐'} {c.sku}</span>
                <span style={{ display: 'block', color: on ? 'inherit' : 'var(--muted)', fontSize: 11.5 }}>{c.model} · {c.status || 'no status'}{c.waitingForInvoice ? ' · no invoice yet' : ''}</span>
                {s.loose && c.description && <span style={{ display: 'block', color: on ? 'inherit' : 'var(--muted)', fontSize: 11.5, maxWidth: 260 }}>{c.description}</span>}
              </button>
            );
          })}
        </div>
        {(picked[s.itemId] || []).length > 0 && (() => {
          const adding = picked[s.itemId].length;
          const n = adding + (s.linkedSku ? 1 : 0);
          const key = `link:${s.itemId}`;
          const renamed = n > 1 && singleUnitDescription(s.description) !== s.description;
          return (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <button className={'btn' + (armed === key ? ' accent' : '')} disabled={!!busy} onClick={() => link(s)}>
                {busy === key ? 'Linking…' : s.linkedSku
                  ? (armed === key ? `Confirm: add ${adding} unit${adding === 1 ? '' : 's'}?` : `Add ${adding} unit${adding === 1 ? '' : 's'}`)
                  : (armed === key ? `Confirm: link ${n} unit${n === 1 ? '' : 's'}?` : `Link ${n} unit${n === 1 ? '' : 's'}`)}
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {n === 1
                  ? <>the line stays {money(s.amount)}</>
                  : <>splits into {n} lines at {splitText(splitAmount(s.amount, n))} — still {money(s.amount)} together{renamed ? <>, each reading “{singleUnitDescription(s.description)}”</> : null}</>}
              </span>
            </div>
          );
        })()}
      </td>
      {withExpress && expressCell(s)}
    </tr>
  );

  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, color: 'var(--charcoal)' }}>Stock gaps</h1>
        <button className="btn" disabled={!!busy} onClick={checkRsOps}>
          {busy === 'rsops' ? 'Checking RS Ops…' : 'Check RS Ops now'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Runs every morning on its own and emails a summary when something is here. The button runs the RS Ops check straight away.
      </p>
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="notice-box">{msg}</div>}
      {!data && !err && <p className="hint">Loading…</p>}

      {data && (
        <>
          {data.canApprove && (
            <>
              <h2 style={{ fontSize: 17, margin: '20px 0 4px' }}>
                Waiting for your approval {data.fillRequests?.length ? `(${data.fillRequests.length})` : ''}
              </h2>
              {!data.fillRequests?.length ? <p className="hint">Nothing to approve.</p> : (
                <>
                  <p className="hint" style={{ marginTop: 0 }}>
                    A purchase invoice was uploaded for units RS Ops had already booked in. Approving puts the invoice&apos;s
                    cost, retail and number on that unit. <b>Reject</b> if it isn&apos;t the same appliance — the unit keeps waiting
                    for its own invoice, and the invoice line is added as a new unit. Tap twice to confirm.
                  </p>
                  {fillGroups.map(([label, reqs]) => (
                    <div key={label} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <b>{label}</b>
                        <span style={{ display: 'flex', gap: 6 }}>
                          {reqs.length > 1 && (
                            <button className={'btn' + (armed === `approve_fills:${reqs.map((r) => r.id).join(',')}` ? ' accent' : '')} disabled={!!busy}
                              onClick={() => decide('approve_fills', reqs.map((r) => r.id), label)}>
                              {armed === `approve_fills:${reqs.map((r) => r.id).join(',')}` ? `Approve all ${reqs.length}?` : `Approve all ${reqs.length}`}
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="hint" style={{ margin: '2px 0 8px' }}>
                        sent by {reqs[0].requestedBy || 'unknown'} · {new Date(reqs[0].requestedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                      <div className="table-wrap"><table className="admin">
                        <thead><tr><th style={th}>Booked-in unit</th><th style={th}>Invoice line</th><th style={{ ...th, textAlign: 'right' }}>Cost</th><th style={{ ...th, textAlign: 'right' }}>Retail</th><th style={th}></th></tr></thead>
                        <tbody>
                          {reqs.map((r) => {
                            const ak = `approve_fills:${r.id}`, rk = `reject_fills:${r.id}`;
                            return (
                              <tr key={r.id}>
                                <td><span style={{ fontFamily: 'monospace' }}>{r.sku}</span></td>
                                <td>{[r.line.make, r.line.model].filter(Boolean).join(' ')}{r.line.description ? <div className="hint" style={{ margin: 0 }}>{r.line.description}</div> : null}</td>
                                <td style={{ textAlign: 'right' }}>{r.line.cost !== '' && r.line.cost != null ? money(Number(r.line.cost)) : '—'}</td>
                                <td style={{ textAlign: 'right' }}>{r.line.retail !== '' && r.line.retail != null ? money(Number(r.line.retail)) : '—'}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  <button className={'btn' + (armed === ak ? ' accent' : '')} disabled={!!busy} style={{ fontSize: 12.5 }}
                                    onClick={() => decide('approve_fills', [r.id], r.sku)}>{armed === ak ? 'Approve?' : 'Approve'}</button>{' '}
                                  <button className={'btn' + (armed === rk ? ' accent' : '')} disabled={!!busy} style={{ fontSize: 12.5 }}
                                    onClick={() => decide('reject_fills', [r.id], r.sku)}>{armed === rk ? 'Reject?' : 'Reject'}</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table></div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          <h2 style={{ fontSize: 17, margin: '20px 0 4px' }}>
            Units with no cost {data.waitingCount ? `(${data.waitingCount})` : ''}
          </h2>
          {data.waiting.length === 0 ? <p className="hint">Nothing — every unit on the tracker has a cost.</p> : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                {data.canApprove && <>Type what each unit cost, <b>before HST</b>, and save: it goes to the tracker, the reports
                  and any sale of that unit, and the unit leaves this list. </>}
                You can instead upload the lot&apos;s purchase invoice (Operations → purchase invoice) — its matching lines come to
                an admin for approval here, instead of adding the appliances again.
              </p>
              {data.canApprove && (
                <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card, #fff)', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button className={'btn' + (toSave.length ? ' accent' : '')} disabled={!!busy || !toSave.length} onClick={() => saveCosts(toSave)}>
                    {busy === 'costs' ? 'Saving…' : `Save ${toSave.length || ''} cost${toSave.length === 1 ? '' : 's'}`}
                  </button>
                  {/* Repeated here: the page's own messages are far above a long list. */}
                  {err && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
                  {msg && <span role="status" style={{ fontSize: 13 }}>{msg}</span>}
                </div>
              )}
              <div className="table-wrap"><table className="admin">
                <thead><tr><th style={th}>Lot</th><th style={th}>Waiting since</th><th style={th}>Units</th></tr></thead>
                <tbody>
                  {data.waiting.map((l) => (
                    <tr key={l.lot}>
                      <td style={{ verticalAlign: 'top' }}><b>{l.lot}</b>{l.hint && <div className="hint" style={{ margin: 0 }}>lot name says {l.hint}</div>}</td>
                      <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{l.oldest || '—'}</td>
                      <td style={{ fontSize: 13 }}>
                        {l.units.map((u) => (
                          <div key={u.sku} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: data.canApprove ? '3px 0' : 0 }}>
                            <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontFamily: 'monospace' }}>{u.sku}</span> · {[u.make, u.model].filter(Boolean).join(' ')} · <span style={{ color: u.sold ? 'var(--danger)' : 'var(--muted)' }}>{u.status || 'no status'}</span></span>
                            {data.canApprove && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                                <span style={{ color: 'var(--muted)' }}>$</span>
                                <input type="text" inputMode="decimal" aria-label={`Cost before HST for ${u.sku}`} placeholder="cost"
                                  value={costs[u.sku] ?? ''} disabled={busy === 'costs'}
                                  onChange={(e) => { const v = e.target.value; setCosts((c) => ({ ...c, [u.sku]: v })); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') saveCosts([u.sku]); }}
                                  style={{ width: 90, textAlign: 'right', padding: '4px 6px' }} />
                                <button className="btn" style={{ fontSize: 12.5, width: 64, visibility: typed([u.sku]).length ? 'visible' : 'hidden' }}
                                  disabled={!!busy} onClick={() => saveCosts([u.sku])}>Save</button>
                              </span>
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}

          <h2 style={{ fontSize: 17, margin: '24px 0 4px' }}>
            Sold without a stock unit {unlinked.length ? `(${unlinked.length})` : ''}
          </h2>
          {unlinked.length === 0 ? <p className="hint">Nothing — every appliance sold in the last 120 days names its unit.</p> : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Each of these sold an appliance without saying which one. Tick the unit that actually went out — or every unit, when
                one line sold several — then <b>Link</b> (tap twice to confirm). Several units split the line into one line per unit,
                with the amount divided so the invoice total doesn&apos;t move. A paid invoice marks them sold on the tracker; an unpaid
                one holds them off the website.
              </p>
              {data.canApprove && (
                <>
                  <p className="hint" style={{ marginTop: 0 }}>
                    <b>Never entered into stock?</b> Type what the whole line cost, <b>before HST</b>, and press Enter: the unit is added to
                    the tracker, linked to the sale and costed. Don&apos;t use it for a vendor drop-off we still owe for — book that in from
                    the invoice.
                  </p>
                  <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card, #fff)', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button className={'btn' + (typedExpress(unlinked).length ? ' accent' : '')} disabled={!!busy || !typedExpress(unlinked).length}
                      onClick={() => addSold(typedExpress(unlinked))}>
                      {busy === 'express' ? 'Saving…' : `Save all ${typedExpress(unlinked).length || ''}`}
                    </button>
                    {/* Repeated here: the page's own messages are far above a long list. */}
                    {err && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
                    {msg && <span role="status" style={{ fontSize: 13 }}>{msg}</span>}
                  </div>
                </>
              )}
              <div className="table-wrap"><table className="admin">
                <thead><tr><th style={th}>Invoice</th><th style={th}>What was sold</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Which unit went out?</th>{data.canApprove && <th style={th}>Never in stock? Cost before HST</th>}</tr></thead>
                <tbody>{unlinked.map((s) => saleRow(s, data.canApprove))}</tbody>
              </table></div>
            </>
          )}

          {underLinked.length > 0 && (
            <>
              <h2 style={{ fontSize: 17, margin: '24px 0 4px' }}>
                Linked to one unit, but the line sold more ({underLinked.length})
              </h2>
              <p className="hint" style={{ marginTop: 0 }}>
                These lines say they sold several (&ldquo;2x&rdquo;, &ldquo;6 sets&rdquo;) but were linked to one unit before a line could be
                split. Tick the others that went out, then <b>Add</b> (tap twice to confirm). The unit already on the line stays on it, and
                the amount is divided across all of them — the invoice total doesn&apos;t move. If the line really did sell just one, leave it.
              </p>
              <div className="table-wrap"><table className="admin">
                <thead><tr><th style={th}>Invoice</th><th style={th}>What was sold</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Which other units went out?</th></tr></thead>
                <tbody>{underLinked.map((s) => saleRow(s))}</tbody>
              </table></div>
            </>
          )}
        </>
      )}
    </div>
  );
}
