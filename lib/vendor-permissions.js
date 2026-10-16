// What each vendor team role may do — ONE table, ONE function. NO IMPORTS: the portal's
// pages and components read it in the browser too (to hide what a role cannot use), but
// hiding is a courtesy. The permission is `can()` called on the server by the single vendor
// gate (lib/vendor-session.js), which every vendor route and page goes through.
//
// Adding an action? Put it in ACTIONS with the roles that may do it, then name it in the
// route's `requireVendor('<action>')`. An action nobody lists is allowed to NOBODY.

export const VENDOR_ROLES = ['owner', 'manager', 'listings', 'fulfilment', 'viewer'];

export const VENDOR_ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  listings: 'Listings',
  fulfilment: 'Fulfilment',
  viewer: 'Viewer'
};

export const VENDOR_ROLE_BLURB = {
  owner: 'Everything, including the bank account, the team and accepting the policies.',
  manager: 'Listings, orders, claims and messages. No bank account, balance or team.',
  listings: 'Create, edit and bulk-upload listings. No orders and no money.',
  fulfilment: 'Accept orders, mark them ready, add tracking and answer warranty claims. No listing edits and no money.',
  viewer: 'Read-only: listings, orders, claims and messages. No money.'
};

const ALL = VENDOR_ROLES;
const OWNER = ['owner'];
const MANAGE = ['owner', 'manager'];

export const ACTIONS = {
  // the portal itself
  'portal.view': ALL,
  'performance.view': ALL,
  'policies.view': ALL,
  'policies.accept': OWNER,            // accepting binds the business
  // listings
  'listings.view': ALL,
  'listings.edit': ['owner', 'manager', 'listings'],   // create, edit, photos, submit, pause, withdraw
  'listings.bulk': ['owner', 'manager', 'listings'],   // bulk upload
  // orders and claims
  'orders.view': ['owner', 'manager', 'fulfilment', 'viewer'],
  'orders.fulfil': ['owner', 'manager', 'fulfilment'], // accept, ready, tracking, cancel
  'claims.view': ['owner', 'manager', 'fulfilment', 'viewer'],
  'claims.respond': ['owner', 'manager', 'fulfilment'],
  // messages (conversations with staff and buyers)
  'messages.view': ['owner', 'manager', 'viewer'],
  'messages.send': MANAGE,
  // money: balance, statement, payouts, the bank account. Owner only.
  'money.view': OWNER,
  'bank.view': OWNER,
  'bank.edit': OWNER,                  // also needs a fresh second factor (requireVendor { stepUp: true })
  // the team
  'team.view': OWNER,
  'team.manage': OWNER                 // invite, change a role, remove — also needs a fresh second factor
};

/** May this role do this action? Unknown role or unknown action: no. */
export function can(role, action) {
  const roles = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  return !!roles && roles.includes(role);
}

export const actionsFor = (role) => Object.keys(ACTIONS).filter((a) => can(role, a));

// --- two-factor policy --------------------------------------------------------------
// The authenticator app is OPTIONAL (owner decision, 2026-10-16): a vendor who signs in with Google or
// Microsoft, or whose account sends a phone text code, already has 2-step verification. What we ask of the
// roles that can see money is a dated declaration that they have it (lib/vendor-mfa.js attestTwoStep),
// prompted for in the portal, and that declaration is what allows a bank-account or team change. An owner
// who DOES enrol the authenticator is held to it (code at sign-in, fresh code for those changes).
export const MFA_REQUIRED_ROLES = [];
export const TWO_STEP_ROLES = ['owner'];
export const TWO_STEP_METHODS = { google: 'Google sign-in (2-step is on)', microsoft: 'Microsoft sign-in (2-step is on)', phone: 'Text-message codes to my phone', authenticator: 'An authenticator app', other: 'Another way' };
export const roleNeedsTwoStep = (role) => TWO_STEP_ROLES.includes(role);
export const MFA_GRACE_DAYS = 14;        // from the grant; the DB default in migration 0034 says the same
export const STEP_UP_MINUTES = 10;       // how fresh a check must be for a sensitive action
export const MFA_MARKER_HOURS = 12;      // how long a verified sign-in lasts
export const RECOVERY_CODE_COUNT = 10;
export const MFA_MAX_FAILURES = 5;       // consecutive wrong codes before a lockout starts
export const MFA_LOCK_MAX_MINUTES = 60;  // the lockout doubles from 1 minute up to this

export const roleNeedsMfa = (role) => MFA_REQUIRED_ROLES.includes(role);
