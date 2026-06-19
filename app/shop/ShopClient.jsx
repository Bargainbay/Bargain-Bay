'use client';
import { useMemo, useState } from 'react';
import ProductCard from '../../components/ProductCard';
import { COLLECTIONS, collectionFilter } from '../../lib/constants';

const PRICE_BANDS = [
  { id: '', label: 'Any price' },
  { id: '0-500', label: 'Under $500', min: 0, max: 500 },
  { id: '500-1000', label: '$500 – $1,000', min: 500, max: 1000 },
  { id: '1000-2000', label: '$1,000 – $2,000', min: 1000, max: 2000 },
  { id: '2000+', label: '$2,000+', min: 2000, max: Infinity }
];

const normalizeSearch = (s) =>
  s.toLowerCase().replace(/["\u201d\u2033]/g, ' inch ').replace(/\b(inches|inch|in)\b/g, ' inch ').replace(/\s+/g, ' ').trim();

const CONDITION_OPTIONS = [
  'New in Box', 'New Open Box', 'Scratch & Dent', 'Refurbished', 'Used', 'Tested & Working'
];

export default function ShopClient({ units, cats, makes, initialCollection, initialQuery }) {
  const [q, setQ] = useState(initialQuery || '');
  const [collection, setCollection] = useState(initialCollection || '');
  const [cat, setCat] = useState('');
  const [cond, setCond] = useState('');
  const [band, setBand] = useState('');
  const [make, setMake] = useState('');
  const [sort, setSort] = useState('newest');

  // Filter individual units, then collapse identical make+model into one card
  // (SecondShop-style). Each group keeps its cheapest unit as the representative;
  // a group of one renders exactly like a plain unit. Filters apply per-unit
  // before grouping, so a condition/price filter can shrink or split a model.
  const groups = useMemo(() => {
    let l = units.filter(collectionFilter(collection));
    if (cat) l = l.filter((u) => u.category === cat);
    if (cond) l = l.filter((u) => u.condition === cond);
    if (make) l = l.filter((u) => u.make === make);
    if (band) {
      const b = PRICE_BANDS.find((x) => x.id === band);
      if (b) l = l.filter((u) => u.price >= b.min && u.price < b.max);
    }
    if (q.trim()) {
      const tokens = normalizeSearch(q).split(' ').filter(Boolean);
      l = l.filter((u) => {
        const hay = u.kw || '';
        return tokens.every((t) => hay.includes(t));
      });
    }
    // Group by make+model in filtered (catalog) order.
    const map = new Map();
    for (const u of l) {
      const key = `${u.make}|${u.model}`.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(u);
    }
    let g = [...map.values()].map((arr) => {
      const sorted = [...arr].sort((a, b) => a.price - b.price);
      return { rep: sorted[0], count: sorted.length, minPrice: sorted[0].price, maxPrice: sorted[sorted.length - 1].price };
    });
    if (sort === 'lo') g.sort((a, b) => a.minPrice - b.minPrice);
    else if (sort === 'hi') g.sort((a, b) => b.maxPrice - a.maxPrice);
    else g.reverse(); // newest = most recently added models first
    return g;
  }, [units, q, collection, cat, cond, band, make, sort]);

  const totalUnits = groups.reduce((n, g) => n + g.count, 0);

  const colLabel = COLLECTIONS.find((c) => c.slug === collection)?.label;

  return (
    <div>
      <h1>{colLabel || 'Shop all inventory'}</h1>

      <div className="filters">
        <input
          type="search"
          placeholder="Search make, model, size, feature…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search inventory"
        />
        <select value={collection} onChange={(e) => { setCollection(e.target.value); setCat(''); }} aria-label="Collection">
          <option value="">All collections</option>
          {COLLECTIONS.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={cond} onChange={(e) => setCond(e.target.value)} aria-label="Condition">
          <option value="">Any condition</option>
          {CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={band} onChange={(e) => setBand(e.target.value)} aria-label="Price">
          {PRICE_BANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <select value={make} onChange={(e) => setMake(e.target.value)} aria-label="Brand">
          <option value="">All brands</option>
          {makes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="newest">Sort: newest</option>
          <option value="lo">Price: low to high</option>
          <option value="hi">Price: high to low</option>
        </select>
      </div>

      <div className="result-count">
        {totalUnits} unit{totalUnits === 1 ? '' : 's'} available — each one-of-a-kind
        {groups.length !== totalUnits && ` · ${groups.length} model${groups.length === 1 ? '' : 's'}`}
      </div>

      {groups.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
          No units match those filters. <button className="btn" style={{ marginLeft: 8 }} onClick={() => { setQ(''); setCollection(''); setCat(''); setCond(''); setBand(''); setMake(''); }}>Clear filters</button>
        </div>
      ) : (
        <div className="grid">
          {groups.map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}
        </div>
      )}
    </div>
  );
}
