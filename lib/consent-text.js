// The marketing opt-in wording. Its own file because it is the EVIDENCE stored
// with a consent, and both the client checkbox and the server (OAuth callback)
// need it: a constant exported from a 'use client' component cannot be imported
// by server code.
export const CONSENT_TEXT =
  'Email me occasional deals and new arrivals from Bargain Bay. ' +
  'You can unsubscribe at any time using the link in any of those emails.';
