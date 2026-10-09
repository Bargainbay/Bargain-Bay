import NavSignOut from './NavSignOut';

// The vendor portal's nav. A vendor is on no staff list, so there is no link here to anything
// of ours — and no search box, which would reach customers and orders.
export default function VendorNav({ active, name }) {
  const items = [
    { key: 'home', label: 'Home', href: '/vendor' },
    { key: 'orders', label: 'Orders', href: '/vendor/orders' },
    { key: 'listings', label: 'Listings', href: '/vendor/listings' },
    { key: 'payouts', label: 'Payouts', href: '/vendor/payouts' },
    { key: 'performance', label: 'Performance', href: '/vendor/performance' },
    { key: 'policies', label: 'Policies', href: '/vendor/policies' }
  ];
  return (
    <div className="admin-nav">
      <span className="admin-nav-title">{name ? `${name} — ` : ''}Marketplace</span>
      <div className="admin-nav-links">
        {items.map((i) => (
          <a key={i.key} href={i.href} className={`admin-nav-link${active === i.key ? ' active' : ''}`}>{i.label}</a>
        ))}
        <a href="/shop" className="admin-nav-link">View store →</a>
        <NavSignOut />
      </div>
    </div>
  );
}
