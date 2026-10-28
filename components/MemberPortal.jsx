'use client';
import { useEffect, useMemo, useState } from 'react';
import { money, round2, HST_RATE } from '../lib/constants';
import { groupByModel } from '../lib/group-units';
import { addToCart, removeFromCart, getCart, onCartChange } from '../lib/cart';
import { addToCart as addToCartPixel } from '../lib/fpixel';
import AddToCartButton from './AddToCartButton';

// The approved member's catalogue. Every price arrives already resolved for THIS member by the
// server (lib/pricing decorate); nothing here computes one. Identical models are one row with a
// stepper — each + adds one specific unit, cheapest first, because every unit is one of a kind and
// the cart is a set of SKUs. The order tray below reads the same cart the rest of the site uses.
const PAGE = 30;
const hay = (u) => [u.make, u.model, u.category, u.title].join(' ').toLowerCase();

export default function MemberPortal({ units, newSkus = [], firstVisit = false, initialWatch = [], stats }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [sort, setSort] = useState('saving');
  const [shown, setShown] = useState(PAGE);
  const [watch, setWatch] = useState(initialWatch);
  const [term, setTerm] = useState('');
  const [watchErr, setWatchErr] = useState('');
  const [cart, setCart] = useState([]);
  const [trayOpen, setTrayOpen] = useState(false);

  useEffect(() => { setCart(getCart()); return onCartChange(setCart); }, []);

  const isNew = useMemo(() => new Set(newSkus), [newSkus]);
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const inCart = useMemo(() => new Set(cart), [cart]);
  const watched = (u) => watch.some((t) => hay(u).includes(t));

  const cats = useMemo(() => {
    const n = new Map();
    for (const u of units) if (u.category) n.set(u.category, (n.get(u.category) || 0) + 1);
    return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [units]);
  const suggestions = useMemo(() => [...new Set(units.flatMap((u) => [u.make, u.category]).filter(Boolean))].sort(), [units]);

  const newCount = units.filter((u) => isNew.has(u.id)).length;
  const watchCount = units.filter(watched).length;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = units.filter((u) =>
      (!cat || u.category === cat) && (!onlyNew || isNew.has(u.id)) && (!onlyWatch || watched(u)) &&
      (!needle || (hay(u) + ' ' + u.id.toLowerCase()).includes(needle)));
    const g = groupByModel(list);
    const save = (x) => Math.max(...x.units.map((u) => u.publicPrice - u.price));
    const fresh = (x) => (x.units.some((u) => isNew.has(u.id)) ? 1 : 0);
    const by = {
      saving: (a, b) => save(b) - save(a),
      newest: (a, b) => fresh(b) - fresh(a) || save(b) - save(a),
      low: (a, b) => a.minPrice - b.minPrice,
      high: (a, b) => b.minPrice - a.minPrice
    }[sort];
    return g.sort(by);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, q, cat, onlyNew, onlyWatch, sort, isNew, watch]);

  const reset = (fn) => (v) => { fn(v); setShown(PAGE); };

  function add(u) { addToCart(u.id); addToCartPixel({ id: u.id, name: u.title, value: u.price }); }

  async function saveWatch(next) {
    const before = watch;
    setWatch(next); setWatchErr('');
    try {
      const r = await fetch('/api/account/member-prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watch: next }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setWatch(d.watch);
    } catch (e) { setWatch(before); setWatchErr(e.message || 'Could not save your watchlist.'); }
  }
  function addTerm(e) {
    e.preventDefault();
    const t = term.trim().toLowerCase();
    if (!t) return;
    if (!watch.includes(t)) saveWatch([...watch, t]);
    setTerm('');
  }

  const items = cart.map((id) => byId.get(id)).filter(Boolean);
  const sub = round2(items.reduce((s, u) => s + u.price, 0));
  const hst = round2(sub * HST_RATE);
  const saved = round2(items.reduce((s, u) => s + Math.max(0, u.publicPrice - u.price), 0));

  return (
    <div>
      <div className="mp-tiles">
        <div className="mp-tile"><b>{units.length}</b><span>units in stock</span></div>
        <div className="mp-tile"><b>{firstVisit ? '—' : newCount}</b><span>{firstVisit ? 'new arrivals show from your next visit' : 'new since your last visit'}</span></div>
        <div className="mp-tile"><b>{watch.length ? watchCount : '—'}</b><span>{watch.length ? 'match your watchlist' : 'add brands to your watchlist'}</span></div>
        <div className="mp-tile"><b>{stats.orders}</b><span>orders · {money(stats.spent)}</span></div>
        <div className="mp-tile"><b style={stats.owing ? { color: 'var(--warn)' } : undefined}>{stats.owing}</b><span>open invoice{stats.owing === 1 ? '' : 's'}</span></div>
      </div>

      <details className="mp-watch">
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--charcoal)' }}>
          Watchlist{watch.length ? ` (${watch.length})` : ''} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13 }}>· brands, models or categories you buy</span>
        </summary>
        <form onSubmit={addTerm}>
          <input list="mp-suggest" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Add a brand, model or category, e.g. LG, ranges" maxLength={40} />
          <datalist id="mp-suggest">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          <button className="btn">Add</button>
        </form>
        {watchErr && <div className="error-box">{watchErr}</div>}
        <div className="mp-chips" style={{ margin: 0 }}>
          {watch.map((t) => (
            <button key={t} className="mp-chip" aria-label={`Stop watching ${t}`} onClick={() => saveWatch(watch.filter((x) => x !== t))}>{t} ×</button>
          ))}
          {watch.length === 0 && <span className="hint">Nothing yet. Matching units get a flag in the list and show under Watchlist.</span>}
        </div>
      </details>

      <div className="mp-bar">
        <input type="search" className="mp-search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search brand, model or SKU" aria-label="Search" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="saving">Biggest saving</option>
          <option value="newest">New first</option>
          <option value="low">Price: low to high</option>
          <option value="high">Price: high to low</option>
        </select>
      </div>
      <div className="mp-chips">
        <button className="mp-chip" aria-pressed={!cat && !onlyNew && !onlyWatch} onClick={() => { setCat(''); setOnlyNew(false); setOnlyWatch(false); setShown(PAGE); }}>All</button>
        <button className="mp-chip" aria-pressed={onlyNew} onClick={() => { setOnlyNew((v) => !v); setShown(PAGE); }}>New ({firstVisit ? 0 : newCount})</button>
        <button className="mp-chip" aria-pressed={onlyWatch} onClick={() => { setOnlyWatch((v) => !v); setShown(PAGE); }}>Watchlist ({watch.length ? watchCount : 0})</button>
        {cats.map(([c, n]) => (
          <button key={c} className="mp-chip" aria-pressed={cat === c} onClick={() => { setCat(cat === c ? '' : c); setShown(PAGE); }}>{c} ({n})</button>
        ))}
      </div>

      <p className="hint" style={{ margin: '0 0 8px' }}>{groups.length} model{groups.length === 1 ? '' : 's'}, {groups.reduce((s, g) => s + g.count, 0)} unit{groups.reduce((s, g) => s + g.count, 0) === 1 ? '' : 's'}</p>

      {groups.slice(0, shown).map((g) => {
        const inGroup = g.units.filter((u) => inCart.has(u.id));
        const k = inGroup.length;
        const nextUnit = g.units.find((u) => !inCart.has(u.id));
        const rep = g.rep;
        const save = Math.max(0, rep.publicPrice - rep.price);
        const conds = [...new Set(g.units.map((u) => u.condition).filter(Boolean))];
        const newN = g.units.filter((u) => isNew.has(u.id)).length;
        const mixed = g.maxPrice > g.minPrice;
        return (
          <div className="mp-row" key={rep.id} data-in={k ? 1 : 0}>
            <a className="mp-img" href={`/product/${encodeURIComponent(rep.id)}`}>{rep.image && <img src={rep.image} alt="" loading="lazy" />}</a>
            <div style={{ minWidth: 0 }}>
              <a className="mp-title" href={`/product/${encodeURIComponent(rep.id)}`}>{rep.title}</a>
              <div className="mp-meta">{[rep.make, rep.model].filter(Boolean).join(' · ')} · {conds.length > 1 ? 'Mixed conditions' : conds[0] || '—'}</div>
              <div className="mp-pills">
                {save > 0 && <span className="mp-pill save">Save {money(save)} ({Math.round((save / rep.publicPrice) * 100)}%)</span>}
                {newN > 0 && <span className="mp-pill new">{newN > 1 ? `${newN} new` : 'New'}</span>}
                {watched(rep) && <span className="mp-pill watch">Watchlist</span>}
                {g.units.some((u) => u.onClearance) && <span className="mp-pill">Clearance</span>}
                <span className="mp-pill">{g.count} available</span>
              </div>
            </div>
            <div className="mp-buy">
              <div>
                {rep.publicPrice > g.minPrice && <div className="mp-was">{money(rep.publicPrice)}</div>}
                <div className="mp-price">{mixed && <small>from </small>}{money(g.minPrice)}</div>
              </div>
              <div>
                <div className="mp-step">
                  <button aria-label={`Remove one ${rep.title}`} disabled={!k} onClick={() => removeFromCart(inGroup[inGroup.length - 1].id)}>−</button>
                  <span aria-live="polite">{k}</span>
                  <button aria-label={`Add one ${rep.title}`} disabled={!nextUnit} onClick={() => add(nextUnit)}>+</button>
                </div>
                {g.count > 1 && k < g.count && (
                  <div><button className="mp-link" onClick={() => g.units.filter((u) => !inCart.has(u.id)).forEach(add)}>Add all {g.count}</button></div>
                )}
              </div>
            </div>
            {g.count > 1 && (
              <details className="mp-units">
                <summary>See each unit{mixed ? ` (${money(g.minPrice)} to ${money(g.maxPrice)})` : ''}</summary>
                {g.units.map((u) => (
                  <div className="mp-unit" key={u.id}>
                    <span><a href={`/product/${encodeURIComponent(u.id)}`} style={{ textDecoration: 'underline' }}>{u.id}</a> · {u.condition || '—'}{isNew.has(u.id) ? ' · new' : ''}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b>{money(u.price)}</b><AddToCartButton sku={u.id} small price={u.price} name={u.title} /></span>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
      {groups.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          Nothing matches. Clear a filter{watch.length === 0 ? ', or add a brand to your watchlist so we flag it when it arrives' : ''}.
        </div>
      )}
      {groups.length > shown && <p style={{ textAlign: 'center' }}><button className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more</button></p>}

      {items.length > 0 && (
        <div className="mp-tray" role="region" aria-label="Your order">
          <div className="mp-tray-main">
            <div>
              <div style={{ fontWeight: 700, color: 'var(--charcoal)' }}>{items.length} unit{items.length === 1 ? '' : 's'} · {money(round2(sub + hst))} with HST</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {money(sub)} + {money(hst)} HST{saved > 0 ? <> · you save <b style={{ color: 'var(--ok)' }}>{money(saved)}</b></> : null} · pickup is free, delivery fee at checkout
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setTrayOpen((v) => !v)} aria-expanded={trayOpen}>{trayOpen ? 'Hide units' : 'Review units'}</button>
              <a className="btn primary" href="/checkout">Checkout</a>
            </div>
          </div>
          {trayOpen && (
            <div className="mp-tray-items">
              {items.map((u) => (
                <div className="mp-unit" key={u.id}>
                  <span>{u.title} <span style={{ color: 'var(--muted)' }}>({u.id})</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b>{money(u.price)}</b><button className="mp-link" onClick={() => removeFromCart(u.id)}>Remove</button></span>
                </div>
              ))}
              <p className="hint" style={{ margin: '8px 0 0' }}>Each unit is one of a kind and is held for you when you check out. Buying a lot? <a href="/bundle" style={{ textDecoration: 'underline' }}>Ask for a quote</a>.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
