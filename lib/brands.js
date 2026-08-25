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
  SALES_EMAIL, SERVICE_EMAIL, ETRANSFER_EMAIL
} from './constants';

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
    // Falls back to the single configured sender, which is the Bargain Bay one.
    from: () => process.env.RESEND_FROM || 'Bargain Bay <onboarding@resend.dev>'
  },
  rs_solutions: {
    key: 'rs_solutions',
    name: 'RS Solutions',
    legal: BUSINESS_LEGAL,
    address: BUSINESS_ADDRESS,
    hst: HST_NUMBER,
    contactEmail: SERVICE_EMAIL,
    // Same company, same account — the money still lands in one place.
    etransferEmail: ETRANSFER_EMAIL,
    site: 'rssolutions.ca',
    // rssolutions.ca already carries a Resend DKIM record, so this sends today.
    // RESEND_FROM_RS overrides if the verified sender is a different mailbox.
    from: () => process.env.RESEND_FROM_RS || `RS Solutions <${SERVICE_EMAIL.toLowerCase()}>`
  }
};

export const DEFAULT_BRAND = 'bargain_bay';

export function brandFor(key) {
  return BRANDS[key] || BRANDS[DEFAULT_BRAND];
}
