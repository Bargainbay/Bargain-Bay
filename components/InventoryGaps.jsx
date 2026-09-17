'use client';
import { useEffect, useState } from 'react';
import { money } from '../lib/constants';
import { splitAmount, quantityHint, singleUnitDescription } from '../lib/stock-match';

// The two ways stock stops adding up, each with the button that fixes it.
//
//   Waiting for a purchase invoice — RS Ops has the appliance, so the tracker has
//   it too, with no cost. The fix is uploading that lot's invoice on the Intake
//   tab: its lines fill these rows in.
//
//   Sold without a stock unit — an invoice line sold an appliance without saying
//   which one, so it still reads as in stock. The fix is picking the unit that
//   went out. The candidates are unsold units of the model the line names; which
//   of two identical fridges left is something only the floor knows, so nothing
//   here picks for you. A line that sold several ("2x …", "6 sets") takes several
//   units: it is split into one line per unit, the amount divided to the cent.

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
    const d = await post({ action: 'link', itemId: line.itemId, skus }, key);
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
            Waiting for a purchase invoice {data.waitingCount ? `(${data.waitingCount})` : ''}
          </h2>
          {data.waiting.length === 0 ? <p className="hint">Nothing — every unit on the tracker has its invoice.</p> : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                These are on the tracker with <b>no cost</b>. Upload each lot&apos;s purchase invoice (Operations → purchase invoice)
                — its matching lines come to an admin for approval here, instead of adding the appliances again.
              </p>
              <div className="table-wrap"><table className="admin">
                <thead><tr><th style={th}>Lot</th><th style={th}>Waiting since</th><th style={th}>Units</th></tr></thead>
                <tbody>
                  {data.waiting.map((l) => (
                    <tr key={l.lot}>
                      <td style={{ verticalAlign: 'top' }}><b>{l.lot}</b>{l.hint && <div className="hint" style={{ margin: 0 }}>lot name says {l.hint}</div>}</td>
                      <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{l.oldest || '—'}</td>
                      <td style={{ fontSize: 13 }}>
                        {l.units.map((u) => (
                          <div key={u.sku}><span style={{ fontFamily: 'monospace' }}>{u.sku}</span> · {[u.make, u.model].filter(Boolean).join(' ')} · <span style={{ color: u.sold ? 'var(--danger)' : 'var(--muted)' }}>{u.status || 'no status'}</span></div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}

          <h2 style={{ fontSize: 17, margin: '24px 0 4px' }}>
            Sold without a stock unit {data.unlinked.length ? `(${data.unlinked.length})` : ''}
          </h2>
          {data.unlinked.length === 0 ? <p className="hint">Nothing — every appliance sold in the last 120 days names its unit.</p> : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Each of these sold an appliance without saying which one. Tick the unit that actually went out — or every unit, when
                one line sold several — then <b>Link</b> (tap twice to confirm). Several units split the line into one line per unit,
                with the amount divided so the invoice total doesn&apos;t move. A paid invoice marks them sold on the tracker; an unpaid
                one holds them off the website.
              </p>
              <div className="table-wrap"><table className="admin">
                <thead><tr><th style={th}>Invoice</th><th style={th}>What was sold</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Which unit went out?</th></tr></thead>
                <tbody>
                  {data.unlinked.map((s) => (
                    <tr key={s.itemId}>
                      <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <a href={`/admin/invoices?q=${encodeURIComponent(s.number)}`}><b>{s.number}</b></a>
                        <div className="hint" style={{ margin: 0 }}>{s.date} · {s.status}</div>
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        {s.description}
                        {s.kind === 'service' && <div className="hint" style={{ margin: 0 }}>typed as a service</div>}
                        {s.offStockReason && <div className="hint" style={{ margin: 0 }}>marked not from our stock: {s.offStockReason}</div>}
                      </td>
                      <td style={{ verticalAlign: 'top', textAlign: 'right' }}>{money(s.amount)}</td>
                      <td style={{ fontSize: 13 }}>
                        {s.candidates.length === 0 && <span className="hint" style={{ margin: 0 }}>No unsold unit of this model on the tracker.</span>}
                        {s.candidates.length > 0 && quantityHint(s.description) && (
                          <div className="hint" style={{ margin: '0 0 4px' }}>The line says “{quantityHint(s.description)}” — tick every unit it sold.</div>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {s.candidates.map((c) => {
                            const on = (picked[s.itemId] || []).includes(c.sku);
                            return (
                              <button key={c.sku} className={'btn' + (on ? ' accent' : '')} style={{ fontSize: 12.5, textAlign: 'left' }}
                                disabled={!!busy} onClick={() => toggle(s, c.sku)} aria-pressed={on}
                                title={`${c.model}${c.serial ? ` · serial ${c.serial}` : ''} · ${c.status || 'no status'} · received ${c.dateReceived || '—'}`}>
                                <span style={{ fontFamily: 'monospace' }}>{on ? '☑' : '☐'} {c.sku}</span>
                                <span style={{ display: 'block', color: on ? 'inherit' : 'var(--muted)', fontSize: 11.5 }}>{c.model} · {c.status || 'no status'}{c.waitingForInvoice ? ' · no invoice yet' : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                        {(picked[s.itemId] || []).length > 0 && (() => {
                          const n = picked[s.itemId].length;
                          const key = `link:${s.itemId}`;
                          const renamed = n > 1 && singleUnitDescription(s.description) !== s.description;
                          return (
                            <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                              <button className={'btn' + (armed === key ? ' accent' : '')} disabled={!!busy} onClick={() => link(s)}>
                                {busy === key ? 'Linking…' : armed === key ? `Confirm: link ${n} unit${n === 1 ? '' : 's'}?` : `Link ${n} unit${n === 1 ? '' : 's'}`}
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
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
        </>
      )}
    </div>
  );
}
