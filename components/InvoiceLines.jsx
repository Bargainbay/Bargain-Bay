'use client';
import { useState } from 'react';
import { isCreditLine, isUnitLine, INTAKE_CATEGORIES } from '../lib/constants';
import { searchStockUnits, OFF_STOCK_REASONS, OFF_STOCK_OTHER } from '../lib/stock-match';
import { blankItem, serviceItem, creditItem, subtotalOf, goodsOf, toPayload, fromInvoice, stockLineProblem } from '../lib/invoice-lines';

// The line-item editor shared by the invoice FORM (new) and the invoice EDITOR
// (existing). It was copy-pasted between the two, which is how they drifted —
// and four kinds of line is more than a duplicated block can carry. The sign
// convention it relies on lives in lib/invoice-lines.js.
const TAG = { service: 'Service', discount: '− Discount', trade_in: '− Trade-in' };
const PLACEHOLDER = {
  unit: 'e.g. Whirlpool WRS321SDHZ refrigerator',
  service: 'Service description',
  discount: 'What the discount is for',
  trade_in: 'Their old unit — make, model, condition'
};

// The one stock search (lib/stock-match.js): stove finds ranges, "24\"" is a
// size, "washer dryer set" finds both halves, and a word nothing in stock has is
// set aside and SAID, not allowed to empty the list.
function searchStock(stock, q, exclude) {
  return searchStockUnits(stock, q, { exclude, limit: 8 });
}
export default function InvoiceLines({ items, setItems, showCost = false, services = [], stock = [] }) {
  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const patchItem = (i, patch) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  // A unit already on another line can't be picked twice.
  const onLines = new Set(items.map((it) => it.sku).filter(Boolean));
  const pick = (i, u) => patchItem(i, {
    sku: u.id, description: u.description, q: '', offStock: false, offStockReason: null,
    // Keep a price the rep already typed; otherwise take the list price when there is one.
    amount: String(items[i]?.amount || '') || (u.price > 0 ? String(u.price) : '')
  });
  const addRow = () => setItems((xs) => [...xs, blankItem()]);
  const removeRow = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs));

  // Reuse the first empty row rather than always appending — the form starts
  // with one, and every quick-add would otherwise leave a blank above it.
  const push = (li) => setItems((xs) => {
    const empty = xs.findIndex((it) => !it.description && !it.amount);
    return empty >= 0 ? xs.map((it, j) => (j === empty ? li : it)) : [...xs, li];
  });

  const goods = goodsOf(items);
  // A percentage is snapshotted to dollars the moment it's added: an invoice
  // line is a figure, and re-deriving it later would silently move a total
  // somebody has already quoted out loud.
  const addPercent = (pct) => push(creditItem('discount', `Discount (${pct}%)`,
    goods > 0 ? (Math.round(goods * pct) / 100).toFixed(2) : ''));

  const hasTradeIn = items.some((it) => it.kind === 'trade_in');

  return (
    <>
      <label style={{ fontSize: 13, fontWeight: 500, display: 'block', margin: '4px 0 6px' }}>Line items</label>
      {items.map((it, i) => (
        <div key={i} style={{ marginBottom: 2 }}>
        <div className="inv-line">
          {isUnitLine(it.kind) && !it.sku && !it.legacy && !it.offStock ? (
            // An appliance is PICKED, never typed: the line gets its SKU from here, which
            // is what lets the sale mark the unit sold. See lib/stock-reconcile.js.
            <input className="inv-desc" value={it.q || ''}
              onChange={(e) => setItem(i, 'q', e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              placeholder="Find the appliance in stock — model, brand, SKU or serial…" />
          ) : (
            <input className="inv-desc" value={it.description}
              onChange={(e) => setItem(i, 'description', e.target.value)}
              autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false}
              placeholder={PLACEHOLDER[it.kind] || PLACEHOLDER.unit} />
          )}
          {isUnitLine(it.kind) ? (
            <select className="inv-warr" value={it.warrantyMonths == null ? '' : it.warrantyMonths}
              onChange={(e) => setItem(i, 'warrantyMonths', e.target.value === '' ? null : Number(e.target.value))}
              title="Warranty term shown on the invoice">
              <option value={24}>2-yr warranty</option>
              <option value={12}>1-yr warranty</option>
              <option value={6}>6-mo warranty</option>
              <option value={3}>3-mo warranty</option>
              <option value="">No warranty</option>
            </select>
          ) : (
            <span className={'pill inv-tag' + (isCreditLine(it.kind) ? ' is-credit' : '')}>{TAG[it.kind]}</span>
          )}
          {isUnitLine(it.kind) && !it.sku && showCost && (
            <input className="inv-cost" type="number" inputMode="decimal" min="0" step="0.01"
              value={it.cost ?? ''} onChange={(e) => setItem(i, 'cost', e.target.value)}
              placeholder="cost" title="Your cost for this unit (for margin) — fill in for a unit that isn't in inventory" />
          )}
          <input className="inv-amt" type="number" inputMode="decimal" min="0" step="0.01"
            value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)}
            placeholder={isCreditLine(it.kind) ? 'amount off' : 'price'}
            aria-label={isCreditLine(it.kind) ? 'Amount to take off' : 'Price'} />
          <button type="button" className="btn inv-del" onClick={() => removeRow(i)} aria-label="Remove line">×</button>
        </div>

        {isUnitLine(it.kind) && it.sku && (
          <div className="hint" style={{ margin: '-4px 0 8px' }}>
            From stock: <b style={{ fontFamily: 'monospace' }}>{it.sku}</b>
            {!it.id && <> · <button type="button" className="linkish" style={{ background: 'none', border: 0, padding: 0, color: 'var(--link, #0a58ca)', cursor: 'pointer', fontSize: 'inherit' }}
              onClick={() => patchItem(i, { sku: null, description: '', q: '' })}>pick a different unit</button></>}
          </div>
        )}
        {isUnitLine(it.kind) && it.legacy && (
          <div className="hint" style={{ margin: '-4px 0 8px' }}>
            Typed before appliances were picked from stock — tie it to its unit on <a href="/admin/inventory-gaps">Stock gaps</a>.
          </div>
        )}
        {isUnitLine(it.kind) && !it.sku && !it.legacy && !it.offStock && (
          <div style={{ margin: '-4px 0 8px' }}>
            {(() => { const r = searchStock(stock, it.q, onLines); return r.ignored.length > 0 && r.units.length > 0 && (
              <div className="hint" style={{ margin: '4px 0' }}>Nothing in stock says “{r.ignored.join('”, “')}” — showing matches for the rest. Check the model and serial before picking.</div>
            ); })()}
            {searchStock(stock, it.q, onLines).units.map((u) => (
              <button type="button" key={u.id} onClick={() => pick(i, u)}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '7px 10px', background: 'var(--card, #fff)', border: '1px solid var(--line)', borderTop: 0, cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
                <span>{u.description}<span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{u.status}</span></span>
                <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontWeight: 600 }}>{u.price > 0 ? `$${u.price.toFixed(2)}` : 'no list price'}</span>
              </button>
            ))}
            {String(it.q || '').trim().length >= 2 && !searchStock(stock, it.q, onLines).units.length && (
              <div className="hint" style={{ margin: '4px 0' }}>Nothing in stock matches “{it.q}”. Try the brand and type (“LG stove”), the model or serial off the sticker, or the SKU.</div>
            )}
            {it.bookIn ? (
              <BookIn line={it} onCancel={() => patchItem(i, { bookIn: false })}
                onPicked={(u) => pick(i, u)} />
            ) : (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                <button type="button" style={linkBtn}
                  onClick={() => patchItem(i, { bookIn: true })}>
                  Not on the tracker? Book it in
                </button>
                <button type="button" style={linkBtn}
                  onClick={() => patchItem(i, { offStock: true, description: it.q || '', q: '', offStockReason: '' })}>
                  Not from our stock?
                </button>
              </div>
            )}
          </div>
        )}
        {isUnitLine(it.kind) && !it.sku && !it.legacy && it.offStock && (
          <OffStockReason line={it}
            onChange={(v) => setItem(i, 'offStockReason', v)}
            onBack={() => patchItem(i, { offStock: false, offStockReason: null, q: it.description, description: '' })} />
        )}
        </div>
      ))}

      {hasTradeIn && (
        <div className="hint" style={{ margin: '2px 0 8px' }}>
          The delivery team is told to bring the trade-in unit back to the warehouse — it shows on the
          dispatch board, the run sheet and the driver&apos;s stop, and the driver has to confirm it&apos;s on the van.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" className="btn" onClick={addRow}>+ Add line</button>
        {services.length > 0 && <span className="hint" style={{ margin: '0 0 0 4px' }}>Add a service:</span>}
        {services.map((sv) => (
          <button key={sv} type="button" className="btn" style={{ fontSize: 12.5 }}
            onClick={() => push(serviceItem(sv))}>+ {sv}</button>
        ))}
        <span className="hint" style={{ margin: '0 0 0 4px' }}>Take money off:</span>
        <button type="button" className="btn" style={{ fontSize: 12.5 }}
          onClick={() => push(creditItem('discount', 'Discount'))}>+ Discount</button>
        {[5, 10, 15].map((pct) => (
          <button key={pct} type="button" className="btn" style={{ fontSize: 12.5 }}
            title={goods > 0 ? `${pct}% of $${goods.toFixed(2)}` : 'Add the items first'}
            onClick={() => addPercent(pct)}>{pct}%</button>
        ))}
        <button type="button" className="btn" style={{ fontSize: 12.5 }}
          title="We're taking their old appliance in part-exchange — the delivery team is told to collect it"
          onClick={() => push(creditItem('trade_in', ''))}>+ Trade-in</button>
      </div>
    </>
  );
}

const linkBtn = { background: 'none', border: 0, padding: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline' };

// Why this appliance isn't one of ours. A fixed list, because the free-text box
// this replaced collected "Already delivered" — and a unit that has gone out is
// exactly the one that must be picked, since picking it is what marks it sold.
// A reason saved before the list existed is shown as it was and left alone.
function OffStockReason({ line, onChange, onBack }) {
  const reason = line.offStockReason || '';
  const isOther = reason.startsWith(OFF_STOCK_OTHER.trim());
  const legacy = reason && reason === line.savedReason && !OFF_STOCK_REASONS.includes(reason) && !isOther;
  const choice = legacy ? '__saved' : isOther ? '__other' : reason;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '-4px 0 8px' }}>
      <select style={{ flex: '1 1 260px' }} value={choice}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__other') onChange(OFF_STOCK_OTHER);
          else if (v === '__saved') onChange(line.savedReason);
          else onChange(v);
        }}>
        <option value="">— why isn&apos;t this from our stock? —</option>
        {OFF_STOCK_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        <option value="__other">Something else (explain)</option>
        {legacy && <option value="__saved">Saved earlier: {line.savedReason}</option>}
      </select>
      {isOther && (
        <input style={{ flex: '1 1 260px' }} value={reason.slice(OFF_STOCK_OTHER.trim().length).trimStart()}
          onChange={(e) => onChange(OFF_STOCK_OTHER + e.target.value)}
          placeholder="What is it, and where did it come from?" />
      )}
      <button type="button" className="btn" style={{ fontSize: 12.5 }} onClick={onBack}>Pick from stock instead</button>
      <span className="hint" style={{ margin: 0, flexBasis: '100%' }}>
        Only for an appliance that was never ours. Already delivered or picked up? It&apos;s still in stock — pick it; that&apos;s what marks it sold.
        Lines marked here are listed on Stock gaps every day.
      </span>
    </div>
  );
}

// "It isn't on the tracker." Guarded server-side (bookInForInvoice): refused if
// the tracker or RS Ops already holds that model or serial, and those units come
// back here to pick instead. Model and serial are required because they are the
// two things that tell us whether we already have it.
function BookIn({ line, onCancel, onPicked }) {
  const [f, setF] = useState({ make: '', model: '', category: 'Refrigerator', serial: '', description: '', source: 'consignment', vendor: '', cost: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [found, setFound] = useState(null); // { sameSerial, sameModel, rsops }
  const [vendors, setVendors] = useState([]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Vendor names already on the tracker — picking one keeps a vendor from
  // becoming three spellings of itself.
  useEffect(() => {
    let live = true;
    fetch('/api/admin/invoices/book-in')
      .then((r) => r.json())
      .then((d) => { if (live) setVendors(d.vendors || []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function send(extra = {}) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/invoices/book-in', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, ...extra })
      });
      const d = await res.json().catch(() => ({}));
      if (d.duplicate) { setFound(d); setErr(d.error); return; }
      if (!res.ok || !d.ok) { setErr(d.error || 'Could not book it in.'); return; }
      // The appliance is on the tracker either way; a failed consignment record
      // is the BOOKS not knowing we owe for it, and only a person can fix that.
      if (d.booked === false) window.alert('Booked in — but the consignment record failed, so the books don\u2019t know we owe this vendor. Tell the owner.');
      onPicked({ id: d.sku, description: d.description, price: 0 });
    } catch { setErr('Could not reach the server.'); }
    finally { setBusy(false); }
  }
  const pickHeld = (u) => onPicked({ id: u.sku, description: `${[u.make, u.model].filter(Boolean).join(' ') || u.description} (${u.sku})`, price: 0 });
  const row = { display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', padding: '7px 10px', background: 'var(--card, #fff)', border: '1px solid var(--line)', borderTop: 0, cursor: 'pointer', fontSize: 13 };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 6, background: 'var(--bg-soft, #fafafa)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Book in an appliance that isn&apos;t on the tracker</div>
      <div className="hint" style={{ margin: '0 0 8px' }}>
        Read the model and serial off the sticker. We check both against the tracker and RS Ops first — if we already have it, you&apos;ll be shown it to pick instead.
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8, fontSize: 13.5 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="radio" name={`src-${line.q || 'x'}`} checked={f.source === 'consignment'}
            onChange={() => setF((x) => ({ ...x, source: 'consignment' }))} />
          A vendor dropped it off
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="radio" name={`src-${line.q || 'x'}`} checked={f.source === 'invoice'}
            onChange={() => setF((x) => ({ ...x, source: 'invoice' }))} />
          It came on a purchase invoice
        </label>
      </div>
      {f.source === 'consignment' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <input style={{ flex: '1 1 160px' }} list="bookin-vendors" value={f.vendor} onChange={set('vendor')}
            placeholder="Which vendor dropped it off?" />
          <datalist id="bookin-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
          <input style={{ flex: '0 1 140px' }} type="number" min="0" step="0.01" value={f.cost} onChange={set('cost')}
            placeholder="Agreed cost (optional)" title="What we pay the vendor when it sells" />
          <span className="hint" style={{ margin: 0, flexBasis: '100%' }}>
            Booked as stock we hold but don&apos;t own — the vendor is owed the day it sells.
          </span>
        </div>
      ) : (
        <div className="hint" style={{ margin: '0 0 8px' }}>
          Check with the warehouse first — most &ldquo;missing&rdquo; units are on the floor waiting to be booked in.
          It goes on the tracker with no cost and stays on Stock gaps until the purchase invoice is uploaded.
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input style={{ flex: '1 1 110px' }} value={f.make} onChange={set('make')} placeholder="Make" />
        <input style={{ flex: '1 1 140px' }} value={f.model} onChange={set('model')} placeholder="Model #" autoCapitalize="characters" spellCheck={false} />
        <input style={{ flex: '1 1 160px' }} value={f.serial} onChange={set('serial')} placeholder="Serial #" autoCapitalize="characters" spellCheck={false} />
        <select style={{ flex: '1 1 130px' }} value={f.category} onChange={set('category')}>
          {INTAKE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input style={{ flex: '2 1 240px' }} value={f.description} onChange={set('description')} placeholder={'Description (optional) e.g. LG 30" electric range'} />
      </div>
      {err && <div className="error-box" style={{ margin: '8px 0 0' }}>{err}</div>}
      {found && (
        <div style={{ marginTop: 6 }}>
          {[...found.sameSerial, ...found.sameModel].filter((u, k, a) => a.findIndex((x) => x.sku === u.sku) === k).map((u) => (
            <button type="button" key={u.sku} style={row} disabled={u.onInvoice || /^sold$/i.test(u.status)}
              onClick={() => pickHeld(u)}>
              <span><b style={{ fontFamily: 'monospace' }}>{u.sku}</b> · {[u.make, u.model].filter(Boolean).join(' ')}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
                  {u.status}{u.serial ? ` · serial ${u.serial}` : ''}{u.lot ? ` · lot ${u.lot}` : ''}
                </span></span>
              <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                {u.onInvoice ? 'on another invoice' : /^sold$/i.test(u.status) ? 'already sold' : 'pick this one'}
              </span>
            </button>
          ))}
          {found.rsops.map((u) => (
            <button type="button" key={u.sku} style={row} onClick={() => send({ rsopsSku: u.sku })} disabled={busy}>
              <span><b style={{ fontFamily: 'monospace' }}>{u.sku}</b> · {[u.make, u.model].filter(Boolean).join(' ')}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>At RS Ops, not on the tracker yet{u.serial ? ` · serial ${u.serial}` : ''}</span></span>
              <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>bring it over &amp; pick</span>
            </button>
          ))}
          <div className="hint" style={{ margin: '6px 0 0' }}>Match the serial on the sticker to one of these. If one of them is on another invoice, that sale needs looking at — ask the office.</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => send()}>{busy ? 'Checking…' : 'Check & book in'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export { blankItem, serviceItem, creditItem, subtotalOf, goodsOf, toPayload, fromInvoice, stockLineProblem };
