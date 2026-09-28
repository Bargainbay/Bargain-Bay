'use client';
import { useState } from 'react';
import SupplierStock from './SupplierStock';
import SupplierSpend from './SupplierSpend';
import Suppliers from './Suppliers';

// One page for everything about who we buy from.
//
// It used to be two pages that did not know about each other: a **By vendor**
// tab on /admin/warehouse reading the tracker (whose stock is standing here),
// and a **Suppliers** section folded into /admin/operations reading the
// database (terms, contact, what we owe). Nothing linked them, neither said the
// other existed, and the split was an accident of WHERE THE DATA CAME FROM
// rather than of what anybody was trying to find out.
//
// The tabs are ordered by how often the question gets asked, not by how the
// data is stored: a vendor rings up about their stock far more often than
// anybody opens a payables report.
const TABS = [
  { key: 'stock', label: 'Their stock', admin: false,
    blurb: 'What each vendor has left with us — including the units that are not on the site yet.' },
  { key: 'file', label: 'On file', admin: false,
    blurb: 'Who to ring, their terms, and the names on our orders nobody has identified.' },
  { key: 'spend', label: 'What we spend', admin: true,
    blurb: 'What we have been charged by each supplier, month by month.' },
  { key: 'owed', label: 'What we owe', admin: true,
    blurb: 'Unpaid purchase invoices, aged against each supplier’s own terms.' }
];

export default function SupplierHub({ admin = false }) {
  const [tab, setTab] = useState('stock');
  // A rep gets the stock and the contact book; cost, spend and payables are the
  // owner's, and are stripped server-side as well — same gate rule as the
  // invoice form's cost box.
  const tabs = TABS.filter((t) => admin || !t.admin);
  const current = tabs.find((t) => t.key === tab) || tabs[0];

  return (
    <div>
      <div className="tab-row" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={current.key === t.key}
            className={'tab-btn' + (current.key === t.key ? ' is-on' : '')} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>{current.blurb}</p>

      {/* A SKU opens its warehouse page. Not a callback from the server
          component that renders this — a function cannot cross that boundary. */}
      {current.key === 'stock' && <SupplierStock admin={admin}
        onOpenUnit={(sku) => { window.location.href = `/w/u/${encodeURIComponent(sku)}`; }} />}
      {current.key === 'spend' && <SupplierSpend />}
      {/* One component behind both of these, showing the half each tab is for —
          so the aging and the contact book can never disagree about a supplier. */}
      {current.key === 'file' && <Suppliers show="file" />}
      {current.key === 'owed' && <Suppliers show="owed" />}
    </div>
  );
}
