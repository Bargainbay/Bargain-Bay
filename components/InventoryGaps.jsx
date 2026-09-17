'use client';
import { useEffect, useState } from 'react';
import { money } from '../lib/constants';

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
//   here picks for you.
export default function InventoryGaps() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [armed, setArmed] = useState('');

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

  async function link(line, sku) {
    const key = `${line.itemId}:${sku}`;
    if (armed !== key) { setArmed(key); return; }
    const d = await post({ action: 'link', itemId: line.itemId, sku }, key);
    if (!d) return;
    setMsg(`${d.number}: “${line.description}” is now ${d.sku} — ${d.stock === 'sold' ? 'marked sold' : d.stock === 'held' ? 'held off the website until it’s paid' : 'linked, but another order is holding it — check'}.`);
    load();
  }

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
          <h2 style={{ fontSize: 17, margin: '20px 0 4px' }}>
            Waiting for a purchase invoice {data.waitingCount ? `(${data.waitingCount})` : ''}
          </h2>
          {data.waiting.length === 0 ? <p className="hint">Nothing — every unit on the tracker has its invoice.</p> : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                These are on the tracker with <b>no cost</b>. Upload each lot&apos;s purchase invoice on the{' '}
                <a href="/admin/intake">Intake</a> tab — its lines fill these rows in instead of adding the appliances again.
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
                Each of these sold an appliance without saying which one. Tap the unit that actually went out (tap twice to confirm).
                A paid invoice marks it sold on the tracker; an unpaid one holds it off the website.
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {s.candidates.map((c) => {
                            const key = `${s.itemId}:${c.sku}`;
                            return (
                              <button key={c.sku} className={'btn' + (armed === key ? ' accent' : '')} style={{ fontSize: 12.5, textAlign: 'left' }}
                                disabled={!!busy} onClick={() => link(s, c.sku)}
                                title={`${c.model}${c.serial ? ` · serial ${c.serial}` : ''} · ${c.status || 'no status'} · received ${c.dateReceived || '—'}`}>
                                {busy === key ? 'Linking…' : armed === key ? `Link ${c.sku}?` : <>
                                  <span style={{ fontFamily: 'monospace' }}>{c.sku}</span>
                                  <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11.5 }}>{c.status || 'no status'}{c.waitingForInvoice ? ' · no invoice yet' : ''}</span>
                                </>}
                              </button>
                            );
                          })}
                        </div>
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
