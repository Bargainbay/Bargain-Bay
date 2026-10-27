// Canadian business identifiers: the Business Number (BN) and the GST/HST account number built on it.
// NO IMPORTS — the application form uses this in the browser as well as the server.
//
// What this can and cannot prove. It proves a number is WELL-FORMED and that the two numbers an
// applicant typed belong to the same business (an HST account is the 9-digit BN + "RT" + 4 digits, so
// the first nine digits of one must equal the other). It cannot prove the business EXISTS or that the
// registration is active — only the CRA's own registry says that. That lookup is a person's job and
// is recorded (`recordIdentityCheck` in lib/vendors.js) before an application can be approved.

export const CRA_REGISTRY_URL = 'https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/business-registration-online.html';
export const CRA_GST_REGISTRY_SEARCH_URL = 'https://www.cra-arc.gc.ca/gsthstregistry/';

const clean = (s) => String(s ?? '').toUpperCase().replace(/[\s\-.]/g, '');

/** Luhn check, the same one a SIN uses; the 9-digit BN carries one as its last digit. */
export function luhnOk(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The 9-digit BN, from "123456789" or a full program account ("123456789RT0001"); null if malformed. */
export function normBn(s) {
  const c = clean(s);
  const m = /^(\d{9})(?:[A-Z]{2}\d{4})?$/.exec(c);
  return m && luhnOk(m[1]) ? m[1] : null;
}

/** "123456789RT0001", or null. */
export function normHst(s) {
  const c = clean(s);
  const m = /^(\d{9})RT(\d{4})$/.exec(c);
  return m && luhnOk(m[1]) ? `${m[1]}RT${m[2]}` : null;
}

export const prettyHst = (s) => { const h = normHst(s); return h ? `${h.slice(0, 9)} RT ${h.slice(11)}` : String(s ?? ''); };

/**
 * Both numbers are required, both must be well-formed, and the HST account must be the BN's own.
 * Returns { ok, problems: [string], bn, hst } where bn is the 9 digits and hst the normalised account.
 */
export function checkBusinessIds({ businessNo, hstNo } = {}) {
  const problems = [];
  const rawBn = String(businessNo ?? '').trim();
  const rawHst = String(hstNo ?? '').trim();
  const bn = rawBn ? normBn(rawBn) : null;
  const hst = rawHst ? normHst(rawHst) : null;
  if (!rawBn) problems.push('A Business Number is required (nine digits, from the CRA).');
  else if (!bn) problems.push('That Business Number is not valid. It is nine digits, for example 123456782 — check it against your CRA correspondence.');
  if (!rawHst) problems.push('An HST number is required (like 123456782 RT 0001). Only HST-registered businesses can sell here.');
  else if (!hst) problems.push('That HST number is not valid. It looks like 123456782 RT 0001: your nine-digit Business Number, then RT, then four digits.');
  if (bn && hst && hst.slice(0, 9) !== bn) problems.push('The HST number does not belong to that Business Number — the first nine digits of the HST account must be the Business Number.');
  return { ok: problems.length === 0, problems, bn, hst };
}

const SUFFIX = /\b(incorporated|incorporation|inc|corporation|corp|company|co|limited|ltd|llc|lp|ulc)\b/g;
/** A business name folded so "Alpha Appliances Ltd." and "ALPHA APPLIANCES LIMITED" compare equal. */
export function foldBusinessName(s) {
  return String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}

/** Does the name the CRA registry shows agree with the one the applicant gave (legal or trading)? */
export function namesAgree(registryName, ...ours) {
  const r = foldBusinessName(registryName);
  if (r.length < 3) return false;
  return ours.some((n) => { const o = foldBusinessName(n); return o.length >= 3 && (o === r || (Math.min(o.length, r.length) >= 6 && (o.includes(r) || r.includes(o)))); });
}
