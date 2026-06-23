// Owner-portal top nav. `active` = 'dashboard' | 'operations'.
export default function AdminNav({ active }) {
  const items = [
    { key: 'dashboard', label: 'Dashboard', href: '/admin/dashboard' },
    { key: 'copilot', label: 'Copilot', href: '/admin/agent' },
    { key: 'reports', label: 'Reports', href: '/admin/reports' },
    { key: 'quotes', label: 'Quotes', href: '/admin/quotes' },
    { key: 'invoices', label: 'Invoices', href: '/admin/invoices' },
    { key: 'campaigns', label: 'Campaigns', href: '/admin/campaigns' },
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
      </div>
    </nav>
  );
}
