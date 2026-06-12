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

  const list = useMemo(() => {
    let l = units.filter(collectionFilter(collection));
    if (cat) l = l.filter((u) => u.category === cat);
    if (cond) l = l.filter((u) => u.condition === cond);
    if (make) l = l.filter((u) => u.make === make);
    if (band) {
      const b = PRICE_BANDS.find((x) => x.id === band);
      if (b) l = l.filter((u) => u.price >= b.min && u.price < b.max);
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      l = l.filter((u) =>
        `${u.make} ${u.model} ${u.title} ${u.category} ${u.id}`.toLowerCase().includes(needle)
      );
    }
    if (sort === 'lo') l = [...l].sort((a, b) => a.price - b.price);
    else if (sort === 'hi') l = [...l].sort((a, b) => b.price - a.price);
    else l = [...l].reverse(); // newest = last added in catalog first
    return l;
  }, [units, q, collection, cat, cond, band, make, sort]);

  const colLabel = COLLECTIONS.find((c) => c.slug === collection)?.label;

  return (
    <div>
      <h1 style={{ color: 'var(--navy)' }}>{colLabel || 'Shop all inventory'}</h1>

      <div className="filters">
        <input
          type="search"
          placeholder="Search make, model, keyword…"
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

      <div className="result-count">{list.length} unit{list.length === 1 ? '' : 's'} available — each one-of-a-kind</div>

      {list.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
          No units match those filters. <button className="btn" style={{ marginLeft: 8 }} onClick={() => { setQ(''); setCollection(''); setCat(''); setCond(''); setBand(''); setMake(''); }}>Clear filters</button>
        </div>
      ) : (
        <div className="grid">
          {list.map((u) => <ProductCard key={u.id} unit={u} />)}
        </div>
      )}
    </div>
  );
}
