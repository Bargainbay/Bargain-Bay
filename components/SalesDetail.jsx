'use client';
// A day's sales, in full: who bought, who closed it and where the lead came from,
// what is still owed, and every line with its price, cost and profit. Admin only
// (it is built from costs); the server sends it to nobody else.
import { Fragment, useState } from 'react';

const $ = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD = { cash: 'cash', etransfer: 'e-transfer', card: 'card', cheque: 'cheque', credit: 'store credit', other: 'other' };
const right = { textAlign: 'right', whiteSpace: 'nowrap' };
const sub = { fontSize: 12, color: 'var(--muted)' };
const margin = (gp, revenue) => (revenue > 0 ? `${((gp / revenue) * 100).toFixed(0)}%` : '—');

function Payment({ o }) {
  const how = (o.methods || []).map((m) => METHOD[m] || m).join(', ');
  if (o.owing > 0) return <><span className="pill warn">Owes {$(o.owing)}</span>{how && <div style={sub}>part paid by {how}</div>}</>;
  if (o.invoiceStatus === 'paid' || (!o.invoice && o.status && o.status !== 'pending_payment')) return <><span className="pill ok">Paid</span>{how && <div style={sub}>{how}</div>}</>;
  return <span style={sub}>{(o.invoiceStatus || o.status || '—').replace(/_/g, ' ')}</span>;
}

export default function SalesDetail({ orders, title = 'Today’s sales' }) {
  const [items, setItems] = useState(true);
  const total = (f) => orders.reduce((a, o) => a + (Number(o[f]) || 0), 0);
  const cost = total('cost'), revenue = total('revenue'), gp = total('gp');
  const anyMissing = orders.some((o) => o.missing > 0);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--charcoal)' }}>{title}</h3>
        <button type="button" className="dash-filter" aria-pressed={items} onClick={() => setItems((v) => !v)}>{items ? 'Hide items' : 'Show items'}</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="admin" style={{ minWidth: 980 }}>
          <thead><tr>
            <th>Sale</th><th>Customer</th><th>Closed by</th><th>Payment</th>
            <th style={right}>Before tax</th><th style={right}>With tax</th><th style={right}>Cost</th><th style={right}>Gross profit</th><th style={right}>Margin</th>
          </tr></thead>
          <tbody>
            {orders.map((o) => (
              <Fragment key={o.number}>
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{o.number}</b>{o.units > 1 ? ` · ${o.units} units` : ''}
                    <div style={sub}>{o.at}{o.invoice && <> · <a href={`/admin/invoices/${o.invoice}/edit`} style={{ textDecoration: 'underline' }}>{o.invoice}</a></>}</div>
                  </td>
                  <td>{o.customer || '—'}<div style={sub}>{o.delivery === 'delivery' ? `Delivery${o.city ? ` · ${o.city}` : ''}` : o.delivery === 'pickup' ? 'Pickup' : ''}</div></td>
                  <td>
                    {o.rep || <span style={sub}>No rep recorded</span>}
                    {(o.leadSource || o.leadBy) && <div style={sub}>{[o.leadSource, o.leadBy && `sent by ${o.leadBy}`].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td><Payment o={o} /></td>
                  <td style={right}>{$(o.revenue)}</td>
                  <td style={right}>{$(o.revenueWithTax)}</td>
                  <td style={right}>{o.cost == null ? '—' : $(o.cost)}</td>
                  <td style={{ ...right, fontWeight: 700 }}>
                    {$(o.gp)}{o.missing > 0 && <div><span title="A unit on this sale has no cost on file, so its profit is counted as $0 until the cost is entered." className="pill warn">cost missing</span></div>}
                  </td>
                  <td style={right}>{o.missing > 0 ? '—' : margin(o.gp, o.revenue)}</td>
                </tr>
                {items && (o.lines || []).map((l, i) => (
                  <tr key={`${o.number}-${i}`} style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    <td colSpan={4} style={{ paddingLeft: 26 }}>{l.title}{l.sku && <span style={{ marginLeft: 8, opacity: 0.75 }}>{l.sku}</span>}</td>
                    <td style={right}>{$(l.price)}</td>
                    <td />
                    <td style={right}>{l.cost == null ? (l.kind === 'unit' ? 'no cost' : '') : $(l.cost)}</td>
                    <td style={right}>{l.profit == null ? (l.kind === 'unit' ? '—' : 'not counted') : $(l.profit)}</td>
                    <td style={right}>{l.profit != null && l.kind === 'unit' ? margin(l.profit, l.price) : ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={4}>Total · {orders.length} sale{orders.length === 1 ? '' : 's'}</td>
              <td style={right}>{$(revenue)}</td><td style={right}>{$(total('revenueWithTax'))}</td><td style={right}>{$(cost)}</td><td style={right}>{$(gp)}</td>
              <td style={right}>{anyMissing ? '—' : margin(gp, revenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>Gross profit is appliances less their cost, less discounts and trade-ins. Delivery and other services are in the sales figures but not in the profit.</p>
    </div>
  );
}
