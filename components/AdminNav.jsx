import NavSignOut from './NavSignOut';

// Owner-portal top nav. `active` = 'dashboard' | 'operations' | …
// `salesOnly` renders the sales-associate nav: selling surfaces only.
// `dispatchOnly` renders the dispatch coordinator's nav: the board and nothing
// else. Every other tab would be a link to a page that refuses them, which reads
// as a broken app rather than as a boundary.
export default function AdminNav({ active, salesOnly = false, booksOnly = false, dispatchOnly = false }) {
  const all = [
    { key: 'dashboard', label: 'Dashboards', href: '/admin/dashboard', sales: true },
    { key: 'copilot', label: 'Sarah', href: '/admin/agent' },
    { key: 'quotes', label: 'Quotes', href: '/admin/quotes', sales: true },
    { key: 'invoices', label: 'Invoices', href: '/admin/invoices', sales: true },
    // The orders board used to be a fold on the admin-only Operations page, so
    // the people who take the orders couldn't mark one ready or put it on a
    // driver's day. It is its own tab now, for both roles.
    { key: 'orders', label: 'Orders', href: '/admin/orders', sales: true },
    // Intake was a fold on the admin-only Operations page, so a rep who took in
    // a vendor's drop-off could not book it in or put it on the site. On this
    // tab sales get the vendor drop-off form and the sync button; the
    // "tested working?" queue stays admin (see app/admin/intake/page.jsx).
    { key: 'intake', label: 'Intake', href: '/admin/intake', sales: true },
    { key: 'campaigns', label: 'Campaigns', href: '/admin/campaigns' },
    { key: 'coupons', label: 'Coupons', href: '/admin/coupons' },
    { key: 'payroll', label: 'Payroll', href: '/admin/payroll' },
    { key: 'dispatch', label: 'Dispatch', href: '/admin/dispatch', sales: true },
    { key: 'books', label: 'The books', href: '/admin/reports/books' },
    { key: 'operations', label: 'Operations', href: '/admin/operations' }
  ];
  // An accountant gets the books and nothing else — no operations, no dispatch,
  // no selling surfaces. Checked before salesOnly: the two are never both true,
  // but if they ever were, the narrower one should win.
  const items = dispatchOnly
    ? [{ key: 'dispatch', label: 'Dispatch', href: '/admin/dispatch' }]
    : booksOnly
    ? [{ key: 'books', label: 'The books', href: '/admin/reports/books' },
       { key: 'pnl', label: 'Profit & loss', href: '/admin/reports/pnl' },
       { key: 'ledger', label: 'Trial balance', href: '/admin/reports/ledger' },
       { key: 'financial', label: 'Expenses', href: '/admin/financial' }]
    : (salesOnly ? all.filter((i) => i.sales) : all);
  return (
    <nav className="admin-nav">
      <span className="admin-nav-title">{dispatchOnly ? 'Dispatch Portal' : booksOnly ? 'Books' : salesOnly ? 'Sales Portal' : 'Owner Portal'}</span>
      <div className="admin-nav-links">
        {items.map((i) => (
          <a key={i.key} href={i.href} className={'admin-nav-link' + (i.key === active ? ' active' : '')}>
            {i.label}
          </a>
        ))}
        {/* A coordinator has no storefront to view, and "View store" on an
            rssolutions.ca host is a link into the other company. */}
        {!dispatchOnly && <a href="/" className="admin-nav-link">View store →</a>}
        {dispatchOnly && <NavSignOut />}
        {/* One box over customers, orders, invoices, and quotes (GET → /admin/search).
            Not for an accountant, and not for a coordinator: it reaches surfaces
            their role doesn't cover. */}
        {!booksOnly && !dispatchOnly && <form action="/admin/search" style={{ marginLeft: 'auto' }}>
          <input name="q" placeholder="Search customer / BB- / INV- / Q-…" aria-label="Search everything"
            style={{ width: 220, padding: '5px 10px', fontSize: 13 }} />
        </form>}
      </div>
    </nav>
  );
}
