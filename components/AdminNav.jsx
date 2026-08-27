// Owner-portal top nav. `active` = 'dashboard' | 'operations' | …
// `salesOnly` renders the sales-associate nav: selling surfaces only.
export default function AdminNav({ active, salesOnly = false, booksOnly = false }) {
  const all = [
    { key: 'dashboard', label: 'Dashboards', href: '/admin/dashboard', sales: true },
    { key: 'copilot', label: 'Sarah', href: '/admin/agent' },
    { key: 'quotes', label: 'Quotes', href: '/admin/quotes', sales: true },
    { key: 'invoices', label: 'Invoices', href: '/admin/invoices', sales: true },
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
  const items = booksOnly
    ? [{ key: 'books', label: 'The books', href: '/admin/reports/books' },
       { key: 'pnl', label: 'Profit & loss', href: '/admin/reports/pnl' },
       { key: 'ledger', label: 'Trial balance', href: '/admin/reports/ledger' },
       { key: 'financial', label: 'Expenses', href: '/admin/financial' }]
    : (salesOnly ? all.filter((i) => i.sales) : all);
  return (
    <nav className="admin-nav">
      <span className="admin-nav-title">{booksOnly ? 'Books' : salesOnly ? 'Sales Portal' : 'Owner Portal'}</span>
      <div className="admin-nav-links">
        {items.map((i) => (
          <a key={i.key} href={i.href} className={'admin-nav-link' + (i.key === active ? ' active' : '')}>
            {i.label}
          </a>
        ))}
        <a href="/" className="admin-nav-link">View store →</a>
        {/* One box over customers, orders, invoices, and quotes (GET → /admin/search).
            Not for an accountant: it reaches surfaces their role doesn't cover. */}
        {!booksOnly && <form action="/admin/search" style={{ marginLeft: 'auto' }}>
          <input name="q" placeholder="Search customer / BB- / INV- / Q-…" aria-label="Search everything"
            style={{ width: 220, padding: '5px 10px', fontSize: 13 }} />
        </form>}
      </div>
    </nav>
  );
}
