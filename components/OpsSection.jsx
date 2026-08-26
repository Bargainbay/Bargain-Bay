'use client';
import { useEffect, useState } from 'react';

// One foldable section of the Operations page.
//
// That page is nine tools stacked end to end — orders, intake, reconciliation,
// salvage, drivers, members, clearance, reservations — and on most days you want
// exactly one of them. Scrolling past the other eight to reach it is the whole
// complaint.
//
// Each section remembers its own state per browser, so the shape somebody sets
// up on Monday is still there on Tuesday.
//
// EVERYTHING starts shut, Orders included. Leaving orders open sounded helpful
// and wasn't: 139 rows of table pushed the other nine bars so far down the page
// that the folds looked like they had never shipped. A page that opens as ten
// bars is the point.
const KEY = (id) => `ops-fold:${id}`;

export default function OpsSection({ id, title, count, children, defaultOpen = false }) {
  // Server and first client render must agree, so the stored preference is
  // applied after mount rather than read during render.
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY(id));
      if (saved === 'open' || saved === 'shut') setOpen(saved === 'open');
    } catch { /* private window — defaults are fine */ }
    // Open all / close all, broadcast from the bar at the top of the page.
    const all = (e) => setOpen(e.detail === 'open');
    window.addEventListener('ops-fold-all', all);
    return () => window.removeEventListener('ops-fold-all', all);
  }, [id]);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem(KEY(id), next ? 'open' : 'shut'); } catch { /* noop */ }
      return next;
    });
  }

  return (
    <section className={'ops-fold' + (open ? ' is-open' : '')}>
      <button type="button" className="ops-fold-head" onClick={toggle} aria-expanded={open}>
        <span className="ops-fold-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="ops-fold-title">{title}</span>
        {count != null && count !== '' && <span className="ops-fold-count">{count}</span>}
        <span className="ops-fold-hint">{open ? 'hide' : 'show'}</span>
      </button>
      {/* Unmounted, not hidden: a closed section shouldn't be running its own
          effects or holding a table of 200 orders in the DOM. */}
      {open && <div className="ops-fold-body">{children}</div>}
    </section>
  );
}
