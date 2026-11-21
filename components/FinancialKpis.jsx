'use client';
// The Financial health cards, each one clickable to show what is inside it.
// All figures come from the server (financialDashboard) — nothing is recomputed
// here, so a breakdown can never disagree with the card it opens from.
import { useState } from 'react';
import { money } from '../lib/constants';

const num = (v) => Number(v || 0);

function Table({ cols, rows, empty = 'Nothing in this period.' }) {
  if (!rows.length) return <p className="hint" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
      <table className="admin">
        <thead><tr>{cols.map((c) => <th key={c.h} style={c.right ? { textAlign: 'right' } : null}>{c.h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>{cols.map((c) => <td key={c.h} style={c.right ? { textAlign: 'right', whiteSpace: 'nowrap' } : null}>{c.f(r)}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Line({ label, value, strong, note }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontWeight: strong ? 700 : 400 }}>
      <span>{label}{note ? <span className="hint" style={{ marginLeft: 8, margin: 0 }}>{note}</span> : null}</span>
      <span style={{ whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

export default function FinancialKpis({ d, periodLabel }) {
  const [open, setOpen] = useState(null);
  const k = d.kpis;
  const det = d.detail || {};
  const lines = det.lines || [];
  const missingCost = lines.filter((l) => l.cost == null && l.sku).length;
  const notCosts = d.notCosts || 0;
  const leftOut = d.leftOut || [];

  const cards = [
    { key: 'revenue', label: 'Revenue', value: money(k.revenue) },
    { key: 'gross', label: 'Gross profit', value: money(k.grossProfit), sub: `${k.marginPct.toFixed(1)}% margin · COGS ${money(k.cogs)}` },
    { key: 'labor', label: 'Labor', value: money(k.labor || 0), sub: 'crew pay this period (payroll)' },
    { key: 'opex', label: 'Operating costs', value: money(k.opex), sub: `${money(k.expenses)} ops + ${money(k.labor || 0)} labor + ${money(k.adSpend)} ads` },
    { key: 'net', label: 'Net profit', value: money(k.netProfit), sub: 'gross − labor − expenses − ads' },
    { key: 'inv', label: 'Inventory capital', value: money(k.inventoryCost), sub: 'COGS in stock' }
  ];

  let body = null;
  if (open === 'revenue') {
    body = (<>
      <p className="hint" style={{ marginTop: 0 }}>Sales in {periodLabel}, before HST, excluding sellers&apos; share. {det.orders.length} orders.</p>
      <Table rows={det.orders} cols={[
        { h: 'Order', f: (r) => r.ref }, { h: 'Date', f: (r) => r.day }, { h: 'Customer', f: (r) => r.who },
        { h: 'Status', f: (r) => r.status }, { h: 'Pre-tax', right: true, f: (r) => money(r.amount) }]} />
    </>);
  } else if (open === 'gross') {
    body = (<>
      <p className="hint" style={{ marginTop: 0 }}>Revenue {money(k.revenue)} − cost of goods {money(k.cogs)} = <strong>{money(k.grossProfit)}</strong>. Cost of goods is the unit cost of what sold, line by line.
        {missingCost > 0 ? <> <strong>{missingCost} line{missingCost === 1 ? '' : 's'} have no cost on record</strong> and count as pure profit.</> : null}</p>
      <Table rows={lines} cols={[
        { h: 'Order', f: (r) => r.ref }, { h: 'Unit', f: (r) => r.title || r.sku || '—' },
        { h: 'Price', right: true, f: (r) => money(r.price) },
        { h: 'Cost', right: true, f: (r) => (r.cost == null ? (r.sku ? 'missing' : '—') : money(r.cost)) },
        { h: 'Profit', right: true, f: (r) => money(r.price - num(r.cost)) }]} />
    </>);
  } else if (open === 'labor') {
    body = (<>
      <p className="hint" style={{ marginTop: 0 }}>Labor here is only what the old payroll log holds (tested / cleaned / repaired pieces, logged hours, per-order delivery pay). <strong>Clock-in hours (/clock and the driver app) and dispatch per-stop pay are not in this number</strong>, so $0 does not mean nobody was paid. The full picture is on <a href="/admin/hours" style={{ textDecoration: 'underline' }}>Hours</a> and <a href="/admin/payroll" style={{ textDecoration: 'underline' }}>Payroll</a>.</p>
      <Line label="Labor counted on this page" value={money(k.labor || 0)} strong />
    </>);
  } else if (open === 'opex') {
    body = (<>
      <Line label="Expenses ledger (bank feed, QuickBooks, manual)" value={money(k.expenses)} />
      <Line label="Ad spend" value={money(k.adSpend)} />
      <Line label="Labor" value={money(k.labor || 0)} />
      <Line label="Total operating costs" value={money(k.opex)} strong />
      {notCosts > 0 && (
        <p className="hint" style={{ margin: '12px 0' }}>
          <strong>{money(notCosts)} left out</strong> because it is not a running cost: stock purchases (already counted as cost of goods when the unit sells) and owner draws / loan repayments.
          {' '}{leftOut.map((e) => `${e.category} ${money(e.amount)}`).join(' · ')}
        </p>
      )}
      <h3 style={{ margin: '14px 0 6px' }}>By category</h3>
      <Table rows={d.expensesByCategory} cols={[{ h: 'Category', f: (r) => r.category }, { h: 'Amount', right: true, f: (r) => money(r.amount) }]} />
      <h3 style={{ margin: '14px 0 6px' }}>Every expense, biggest first (left-out rows marked)</h3>
      <Table rows={det.expenseRows} cols={[
        { h: 'Date', f: (r) => r.day }, { h: 'Category', f: (r) => r.category + (r.leftOut ? ' (left out)' : '') }, { h: 'Vendor', f: (r) => r.vendor },
        { h: 'Note', f: (r) => r.note }, { h: 'Source', f: (r) => r.source }, { h: 'Amount', right: true, f: (r) => money(r.amount) }]} />
      {det.adRows.length > 0 && (<>
        <h3 style={{ margin: '14px 0 6px' }}>Ad spend</h3>
        <Table rows={det.adRows} cols={[
          { h: 'Date', f: (r) => r.day }, { h: 'Channel', f: (r) => r.channel }, { h: 'Campaign', f: (r) => r.campaign },
          { h: 'Amount', right: true, f: (r) => money(r.amount) }]} />
      </>)}
    </>);
  } else if (open === 'net') {
    body = (<>
      <Line label="Revenue (pre-tax)" value={money(k.revenue)} />
      <Line label="− Cost of goods sold" value={money(k.cogs)} />
      <Line label="= Gross profit" value={money(k.grossProfit)} strong />
      <Line label="− Running expenses" value={money(k.expenses)} note={notCosts > 0 ? `excludes ${money(notCosts)} stock/draws` : ''} />
      <Line label="− Ad spend" value={money(k.adSpend)} />
      <Line label="− Labor" value={money(k.labor || 0)} />
      <Line label="= Net profit" value={money(k.netProfit)} strong />
      <p className="hint" style={{ marginTop: 10 }}>Open <em>Operating costs</em> to see each expense. This is a cash-style view: stock you bought but have not sold is not a cost here (it is in Inventory capital), but rows the bank feed filed under a stock or draw category are left out too.</p>
    </>);
  } else if (open === 'inv') {
    const inv = d.inventory || {};
    body = (<>
      <p className="hint" style={{ marginTop: 0 }}>What the unsold stock cost us: {inv.units} units, {inv.unitsWithCost} with a cost recorded. Priced to sell at {money(inv.suggestedValue || 0)}.</p>
      <Table rows={inv.byCategory || []} cols={[
        { h: 'Category', f: (r) => r.category }, { h: 'Units', right: true, f: (r) => r.units },
        { h: 'Cost', right: true, f: (r) => money(r.cost) }, { h: 'Listed at', right: true, f: (r) => money(r.suggested) },
        { h: 'Profit', right: true, f: (r) => money(r.profit) }]} />
    </>);
  }
  const current = cards.find((c) => c.key === open);

  return (
    <>
      <div className="dash-kpis">
        {cards.map((c) => (
          <button key={c.key} type="button" onClick={() => setOpen(open === c.key ? null : c.key)}
            className="kpi-card" aria-expanded={open === c.key}
            style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', outline: open === c.key ? '2px solid var(--accent, #3ddc97)' : 'none' }}>
            <div className="kpi-value">{c.value}</div>
            <div className="kpi-label">{c.label}</div>
            {c.sub ? <div className="kpi-sub">{c.sub}</div> : null}
            <div className="kpi-sub" style={{ opacity: .7 }}>{open === c.key ? 'Hide breakdown ▴' : 'See breakdown ▾'}</div>
          </button>
        ))}
      </div>
      {current && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>{current.label} · {periodLabel}</h2>
          {body}
        </div>
      )}
    </>
  );
}
