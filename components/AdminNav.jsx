// Owner-portal top nav. `active` = 'dashboard' | 'operations'.
export default function AdminNav({ active }) {
  const items = [
    { key: 'dashboard', label: 'Dashboards', href: '/admin/dashboard' },
    { key: 'copilot', label: 'Sarah', href: '/admin/agent' },
    { key: 'quotes', label: 'Quotes', href: '/admin/quotes' },
    { key: 'invoices', label: 'Invoices', href: '/admin/invoices' },
    { key: 'campaigns', label: 'Campaigns', href: '/admin/campaigns' },
    { key: 'payroll', label: 'Payroll', href: '/admin/payroll' },
    { key: 'operations', label: 'Operations', href: '/admin/operations' }
  ];
  return (
    <nav className="admin-nav">
      <span className="admin-nav-title">Owner Portal</span>
      <div className="admin-nav-links">
        {items.map((i) => (
          <a key={i.key} href={i.href} className={'admin-nav-link' + (i.key === active ? ' active' : '')}>
            {i.label}
          </a>
        ))}
        <a href="/" className="admin-nav-link">View store →</a>
        {/* One box over customers, orders, invoices, and quotes (GET → /admin/search). */}
        <form action="/admin/search" style={{ marginLeft: 'auto' }}>
          <input name="q" placeholder="Search customer / BB- / INV- / Q-…" aria-label="Search everything"
            style={{ width: 220, padding: '5px 10px', fontSize: 13 }} />
        </form>
      </div>
    </nav>
  );
}
