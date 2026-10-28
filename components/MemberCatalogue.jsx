'use client';
import { useMemo, useState } from 'react';
import { money } from '../lib/constants';

// Everything in stock with the member's price beside the public one. The prices arrive already
// resolved by the server for THIS member (lib/pricing decorate); nothing here computes a price.
const PAGE = 40;

export default function MemberCatalogue({ units }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cond, setCond] = useState('');
  const [sort, setSort] = useState('saving');
  const [shown, setShown] = useState(PAGE);

  const cats = useMemo(() => [...new Set(units.map((u) => u.category).filter(Boolean))].sort(), [units]);
  const conds = useMemo(() => [...new Set(units.map((u) => u.condition).filter(Boolean))].sort(), [units]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = units.filter((u) =>
      (!cat || u.category === cat) && (!cond || u.condition === cond) &&
      (!term || [u.id, u.make, u.model, u.title].join(' ').toLowerCase().includes(term)));
    const by = {
      saving: (a, b) => (b.publicPrice - b.price) - (a.publicPrice - a.price),
      low: (a, b) => a.price - b.price,
      high: (a, b) => b.price - a.price
    }[sort];
    return list.sort(by);
  }, [units, q, cat, cond, sort]);

  const field = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search brand, model or SKU" style={{ ...field, flex: '1 1 220px' }} />
        <select value={cat} onChange={(e) => { setCat(e.target.value); setShown(PAGE); }} style={field}>
          <option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={cond} onChange={(e) => { setCond(e.target.value); setShown(PAGE); }} style={field}>
          <option value="">Any condition</option>{conds.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={field}>
          <option value="saving">Biggest saving</option>
          <option value="low">Price: low to high</option>
          <option value="high">Price: high to low</option>
        </select>
      </div>
      <p className="hint" style={{ margin: '0 0 8px' }}>{rows.length} unit{rows.length === 1 ? '' : 's'} available</p>
      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Unit</th><th>Condition</th><th>Retail</th><th>Public price</th><th>Your price</th><th>You save</th></tr></thead>
        <tbody>
          {rows.slice(0, shown).map((u) => {
            const save = Math.max(0, u.publicPrice - u.price);
            return (
              <tr key={u.id}>
                <td style={{ fontSize: 13.5 }}>
                  <a href={`/product/${encodeURIComponent(u.id)}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>{u.title}</a>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{u.id}{u.onClearance ? ' · clearance' : ''}</div>
                </td>
                <td style={{ fontSize: 13 }}>{u.condition || '—'}</td>
                <td style={{ color: 'var(--muted)' }}>{u.retail ? money(u.retail) : '—'}</td>
                <td>{money(u.publicPrice)}</td>
                <td><b>{money(u.price)}</b></td>
                <td style={{ color: save ? '#0B6B3A' : 'var(--muted)' }}>{save ? `${money(save)} (${Math.round((save / u.publicPrice) * 100)}%)` : '—'}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Nothing matches. Try clearing a filter.</td></tr>}
        </tbody>
      </table></div>
      {rows.length > shown && (
        <p style={{ textAlign: 'center' }}><button className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more</button></p>
      )}
    </div>
  );
}
