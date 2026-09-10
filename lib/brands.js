// Two businesses share this codebase, and a client must never be able to tell.
//
// Bargain Bay is the consumer storefront. RS Solutions is the delivery and
// service company whose clients are other businesses — Transource and the rest.
// A Transource invoice arriving from "Bargain Bay" is wrong in a way a customer
// notices immediately, so every outbound document carries a BRAND that decides
// the sender, the letterhead and the contact details.
//
// This is identity only. It deliberately does not fork any logic: an invoice is
// an invoice, and both brands go through exactly the same code.
import {
  BUSINESS_NAME, BUSINESS_LEGAL, BUSINESS_ADDRESS, HST_NUMBER,
  SALES_EMAIL, ETRANSFER_EMAIL, dispatchDesk
} from './constants';
import { SITE_URL } from './site';

export const BRANDS = {
  bargain_bay: {
    key: 'bargain_bay',
    name: BUSINESS_NAME,
    legal: BUSINESS_LEGAL,
    address: BUSINESS_ADDRESS,
    hst: HST_NUMBER,
    contactEmail: SALES_EMAIL,
    etransferEmail: ETRANSFER_EMAIL,
    site: 'bargainbay.ca',
    // Where links in this brand's emails point.
    url: () => SITE_URL,
    // Falls back to the single configured sender, which is the Bargain Bay one.
    from: () => process.env.RESEND_FROM || 'Bargain Bay <onboarding@resend.dev>'
  },
  rs_solutions: {
    key: 'rs_solutions',
    name: 'RS Solutions',
    legal: BUSINESS_LEGAL,
    address: BUSINESS_ADDRESS,
    hst: HST_NUMBER,
    // RS Solutions' clients are delivery clients, and every reply they send —
    // "can you move Thursday", "your invoice is short a stop" — is dispatch work.
    // So the contact on an RS letterhead, on the hosted invoice page and in the
    // reply-to of anything we send them is the DISPATCH DESK, not the owner's
    // Service@ inbox. This is the half of "delivery mail goes to dispatch@" that
    // no mail rule can do for us: a rule redirects what arrives, this decides
    // where the client presses Reply.
    contactEmail: dispatchDesk(),
    // Same company, same account — the money still lands in one place.
    etransferEmail: ETRANSFER_EMAIL,
    site: 'rssolutions.ca',
    // An RS Solutions client must never be sent to a bargainbay.ca link — it
    // undoes the whole point of the separate identity.
    url: () => (process.env.RS_SITE_URL || 'https://dispatch.rssolutions.ca').replace(/\/$/, ''),
    // rssolutions.ca already carries a Resend DKIM record, so this sends today —
    // Resend verifies a DOMAIN, not a mailbox, so the dispatch desk sends without
    // any new setup. RESEND_FROM_RS overrides; it is currently set in Production
    // to the Service@ address, so changing this default alone does NOT move the
    // From line — update the env var and redeploy too.
    from: () => process.env.RESEND_FROM_RS || `RS Solutions <${dispatchDesk().toLowerCase()}>`
  }
};

export const DEFAULT_BRAND = 'bargain_bay';

export function brandFor(key) {
  return BRANDS[key] || BRANDS[DEFAULT_BRAND];
}
