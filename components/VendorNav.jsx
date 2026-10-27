import NavSignOut from './NavSignOut';
import TwoStepPrompt from './TwoStepPrompt';
import { can } from '../lib/vendor-permissions';

// The vendor portal's nav. A vendor is on no staff list, so there is no link here to anything
// of ours — and no search box, which would reach customers and orders.
//
// `role` hides the tabs a role cannot use. That is a courtesy: every page and API route checks
// the same table (lib/vendor-permissions.js) on the server. `mfa` is the second-factor state
// from the gate, and drives the reminder banner.
const ITEMS = [
  { key: 'home', label: 'Home', href: '/vendor', action: 'portal.view' },
  { key: 'orders', label: 'Orders', href: '/vendor/orders', action: 'orders.view' },
  { key: 'messages', label: 'Messages', href: '/vendor/messages', action: 'messages.view' },
  { key: 'claims', label: 'Claims', href: '/vendor/claims', action: 'claims.view' },
  { key: 'listings', label: 'Listings', href: '/vendor/listings', action: 'listings.view' },
  { key: 'payouts', label: 'Payouts', href: '/vendor/payouts', action: 'money.view' },
  { key: 'performance', label: 'Performance', href: '/vendor/performance', action: 'performance.view' },
  { key: 'team', label: 'Team', href: '/vendor/team', action: 'team.view' },
  { key: 'guides', label: 'Guides', href: '/marketplace/guides', action: null },
  { key: 'policies', label: 'Policies', href: '/vendor/policies', action: 'policies.view' },
  { key: 'security', label: 'Security', href: '/vendor/security', action: null }
];

export default function VendorNav({ active, name, role, mfa, unread = 0 }) {
  const items = ITEMS.filter((i) => !role || !i.action || can(role, i.action)).map((i) => (i.key === 'messages' && unread ? { ...i, label: `Messages (${unread})` } : i));
  const nudge = mfa && mfa.required && !mfa.enrolled && mfa.available;
  const twoStep = mfa && mfa.twoStepPrompt;
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
      {twoStep && <TwoStepPrompt />}
      {nudge && (
        <div className="panel" style={{ flexBasis: '100%', margin: '8px 0 0', borderColor: 'var(--danger, #b00020)' }}>
          <strong>Set up two-factor sign-in.</strong>{' '}
          {mfa.daysLeft > 0
            ? <>Your account needs it within {mfa.daysLeft} day{mfa.daysLeft === 1 ? '' : 's'}; after that the portal stays closed until it is done. </>
            : <>It is required for your role. </>}
          <a href="/vendor/security">Set it up now →</a>
        </div>
      )}
    </div>
  );
}
