'use client';
import { useEffect, useState } from 'react';

// Carts left behind, for staff to phone. Read-only: nothing here sends anything
// to the shopper (CASL — a typed email at checkout is not marketing consent).
// A follow-up is also raised for each in My Day; this is the detail behind it.
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const STATE = { available: ['still for sale', 'var(--charcoal)'], sold: ['SOLD', '#b3261e'], held: ['held by someone', '#a15c00'], gone: ['no longer listed', '#b3261e'] };

export default function AbandonedCarts() {
  const [hours, setHours] = useState(4);
  const [d, setD] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/abandoned-carts?hours=${hours}`).then((r) => r.json()).then((j) => { if (live) setD(j); }).catch(() => { if (live) setD(null); });
    return () => { live = false; };
  }, [hours]);

  if (!d || !d.carts) return null;
  const carts = d.carts;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Abandoned carts{carts.length ? ` (${carts.length})` : ''}</h2>
        <label className="hint" style={{ margin: 0 }}>
          untouched for{' '}
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[1, 4, 12, 24, 72].map((h) => <option key={h} value={h}>{h < 24 ? `${h}h` : `${h / 24}d`}</option>)}
          </select>
        </label>
      </div>
      {!carts.length && <p className="hint" style={{ margin: 0 }}>No abandoned carts from people we can identify.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {carts.map((c) => (
          <li key={c.id} style={{ padding: '9px 0', borderTop: '1px solid var(--line, #eee)', opacity: c.availableCount ? 1 : 0.6 }}>
            <div style={{ fontSize: 14 }}>
              <strong>{c.name || c.email || c.phone}</strong>
              {c.email && c.name && <span className="hint" style={{ marginLeft: 8 }}>{c.email}</span>}
              {c.phone && <a href={`tel:${c.phone}`} style={{ marginLeft: 8, fontSize: 12.5 }}>{c.phone}</a>}
              <span className="hint" style={{ marginLeft: 8, fontSize: 12 }}>{new Date(c.updatedAt).toLocaleString('en-CA')}</span>
              {c.customerId && <a href={`/admin/customers/${c.customerId}`} style={{ marginLeft: 8, fontSize: 12.5 }}>customer</a>}
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {c.units.map((u) => {
                const [label, color] = STATE[u.state] || STATE.gone;
                return (
                  <li key={u.sku}>
                    {u.title} <span className="hint">({u.sku})</span>{u.price != null && <> — {money(u.price)}</>}
                    {' '}<span style={{ color, fontWeight: u.state === 'available' ? 400 : 700 }}>· {label}</span>
                  </li>
                );
              })}
            </ul>
            <div className="hint" style={{ fontSize: 12, marginTop: 2 }}>
              {c.availableCount ? `${money(c.availableTotal)} still for sale.` : 'Nothing left to sell.'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
