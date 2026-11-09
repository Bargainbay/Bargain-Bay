'use client';
import { usePathname, useRouter } from 'next/navigation';

// The Sales Hub's frame: the Bargain Bay | RS Solutions | All toggle and the tabs.
//
// The side is a per-person preference kept in a cookie, so the server pages can
// filter before they render (no flash of the wrong side). It is a FILTER, not a
// permission — a rep's leads are scoped by who they are in lib/leads.js, never by
// which side is selected.
export const SIDE_COOKIE = 'bb_hub_side';

const TABS = [
  ['/sales', 'Home'],
  ['/sales/leads', 'Leads'],
  ['/sales/pipeline', 'Pipeline'],
  ['/sales/catalog', 'Catalog'],
  ['/admin/quotes', 'Quotes'],
  ['/sales/performance', 'Performance'],
  ['/sales/resources', 'Resources']
];
const SIDES = [['all', 'All'], ['bb', 'Bargain Bay'], ['rs', 'RS Solutions']];
// The chosen side tints the toggle, the active tab and a bar across the top, so it is always
// obvious which business a list is showing. All keeps the house charcoal.
const ACCENT = { all: 'var(--charcoal, #222)', bb: '#b4452c', rs: '#1f5a8a' };
const SHOWING = {
  bb: 'Showing Bargain Bay: its leads, its appliances and its add-on services. Counters and commission always cover everything.',
  rs: 'Showing RS Solutions: its leads and its service price list. Counters and commission always cover everything.'
};

export default function SalesNav({ side = 'all', name = '' }) {
  const path = usePathname();
  const router = useRouter();
  const accent = ACCENT[side] || ACCENT.all;
  const pick = (s) => {
    document.cookie = `${SIDE_COOKIE}=${s}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  };
  return (
    <div style={{ marginBottom: 14, borderTop: `4px solid ${accent}`, paddingTop: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--charcoal)' }}>Sales Hub{name ? <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--muted)' }}> · {name}</span> : null}</h1>
        <div role="group" aria-label="Business" style={{ display: 'inline-flex', border: '1px solid var(--line, #ddd)', borderRadius: 10, overflow: 'hidden' }}>
          {SIDES.map(([k, label]) => (
            <button key={k} type="button" onClick={() => pick(k)} aria-pressed={side === k}
              style={{ padding: '9px 14px', fontSize: 14, fontWeight: 700, border: 0, cursor: 'pointer',
                background: side === k ? accent : 'transparent', color: side === k ? '#fff' : 'var(--charcoal, #222)' }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }} aria-label="Sales Hub">
        {TABS.map(([href, label]) => {
          const on = href === '/sales' ? path === '/sales' : path.startsWith(href);
          return (
            <a key={href} href={href} aria-current={on ? 'page' : undefined}
              style={{ padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none',
                background: on ? accent : 'var(--panel-alt, #f3f3f3)', color: on ? '#fff' : 'var(--charcoal, #222)' }}>
              {label}
            </a>
          );
        })}
      </nav>
      {SHOWING[side] && <p className="hint" style={{ margin: '8px 0 0', fontSize: 12.5 }}>{SHOWING[side]}</p>}
    </div>
  );
}
