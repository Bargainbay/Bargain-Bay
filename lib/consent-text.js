// The marketing opt-in wording. Its own file because it is the EVIDENCE stored
// with a consent, and both the client checkbox and the server (OAuth callback)
// need it: a constant exported from a 'use client' component cannot be imported
// by server code.
export const CONSENT_TEXT =
  'Email me occasional deals and new arrivals from Bargain Bay. ' +
  'You can unsubscribe at any time using the link in any of those emails.';

// The TEXT-MESSAGE opt-in wording, stored as the evidence. CASL wants the request to say who is asking,
// how to reach them, and that the yes can be withdrawn. Change it only on purpose: it is what people agreed to.
export const SMS_CONSENT_TEXT =
  'Text me deals and new arrivals from Bargain Bay (RS Solutions, 1135 Squires Beach Rd, Pickering, ON; ' +
  'sales@bargainbay.ca). Message frequency varies; message and data rates may apply. Reply STOP to unsubscribe.';
