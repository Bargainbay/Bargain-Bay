// The business-development rep's Employment Agreement and Confidentiality & Non-Solicitation Agreement,
// as text in code: what the rep reads and signs in the Sales Hub (/sales/agreement), what is stored as the
// signed copy, and what is emailed to them.
//
// SOURCE: "RS Solutions – Employment Agreement – John Tobias (DRAFT v2)" and the Confidentiality &
// Non-Solicitation Agreement, both in the Drive Agreements folder (2026-11-08). Section 4.2 is rewritten for the
// owner's tiers of 2026-11-10 and is BUILT FROM THE TIERS IN FORCE (lib/commission-tiers.js), never typed, so
// the agreement a rep signs can never promise a rate the system does not pay. The same rule as the marketplace
// policies: every number comes from the code that enforces it.
//
// Both documents are marked as drafts for an Ontario employment lawyer in their own Drive files. Anything the
// owner has not yet decided is left as a visible [bracket] and BLOCKS SIGNING (`unresolvedItems`); the owner
// fills them on /admin/sales-commission (settings key `rep_agreement_fields`) and opens signing there.
//
// No imports except the pure tier maths (it runs in the browser: the page shows the text and a signed copy is
// printed from it). The wording is a legal text: changing it means a new EMPLOYMENT_TERMS_VERSION, and the text
// actually signed is stored with its hash, so what was agreed can always be reproduced.
import { tieredCommission, normalizeTiers, DEFAULT_TIERS } from './commission-tiers.js';

export const EMPLOYMENT_TERMS_VERSION = '2026-11-10';

export const COMPANY_NAME = '1000732031 Ontario Inc.';
export const COMPANY_TRADE = 'RS Solutions and Bargain Bay';
export const COMPANY_SIGNATORY = 'Saieasan Satchithananthan, Director of Operations';

/** The things only the owner can decide. Blank = still a [bracket] in the text, and signing stays closed. */
export const FIELD_DEFS = [
  { key: 'registeredAddress', label: 'Company registered address', placeholder: '[registered address]' },
  { key: 'hours', label: 'Normal hours (e.g. Monday to Friday, 9:00 a.m. to 5:00 p.m.)', placeholder: '[Monday to Friday, 9:00 a.m. to 5:00 p.m.]' },
  { key: 'afterDays', label: 'Days after employment ends that commission is still paid (e.g. 30)', placeholder: '[30]' },
  { key: 'benefits', label: 'Benefits (write "None." if there are none)', placeholder: '[Benefits, if any.]' },
  { key: 'mileage', label: 'Mileage reimbursement for Mobile Day travel (e.g. $0.70 per km)', placeholder: '[mileage at $___ per km for Mobile Day travel]' }
];

const money = (n) => `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const pctText = (p) => `${Number(p)}%`;

/** The rate lines of 4.2, from the tiers in force. */
export function tierLines(tiers = DEFAULT_TIERS) {
  const list = normalizeTiers(tiers);
  const first = list[0];
  const out = [first.inclusive ? `Under ${money(first.over)}: no commission` : `${money(first.over)} or less: no commission`];
  for (const t of list) out.push(`${t.inclusive ? `${money(t.over)} or more` : `Over ${money(t.over)}`}: ${pctText(t.pct)} of the day's total`);
  return out;
}

/** A worked example that sits clear of every line, so it cannot be read two ways. */
export function tierExample(tiers = DEFAULT_TIERS, daily = 200) {
  const list = normalizeTiers(tiers);
  const day = list[list.length - 1].over + 5000;
  const { commission } = tieredCommission(day, list);
  return `Example: a day with ${money(day)} in Eligible Collected Sales earns ${money(commission)} in commission plus the ${money(daily)} daily base.`;
}

const val = (fields, def) => {
  const v = String(fields?.[def.key] ?? '').trim();
  return v || def.placeholder;
};

/**
 * The Employment Agreement as sections ({ h, body: [...] }, the policy format AgreementScroll renders).
 * `tiers` are the commission tiers in force; `fields` the owner's decisions; `employee` { name, address }.
 */
export function employmentSections({ tiers = DEFAULT_TIERS, fields = {}, employee = {}, startDateText = 'Monday, November 9, 2026', quota = 150000 } = {}) {
  const F = Object.fromEntries(FIELD_DEFS.map((d) => [d.key, val(fields, d)]));
  const name = employee.name || 'the Employee';
  const address = employee.address || '(home address, entered when signing)';
  return [
    { h: 'Offer of Employment and Employment Agreement', group: true, body: [
      { p: `Employer: ${COMPANY_NAME}, an Ontario corporation operating as ${COMPANY_TRADE}, ${F.registeredAddress} ("the Company").` },
      { p: `Employee: ${name}, ${address} ("the Employee").` },
      { p: 'Date: the date of signing, recorded with the signature.' }
    ] },
    { h: '1. Position and Start Date', body: [
      { p: `The Company offers the Employee full-time employment as Business Development Manager, starting ${startDateText}. The Employee reports to ${COMPANY_SIGNATORY}.` }
    ] },
    { h: '2. Duties', body: [
      { p: 'The Employee will generate new business for all Company services by networking with, prospecting and onboarding property management companies, real estate firms, retailers, contractors and other B2B clients, including promoting and selling:' },
      { list: [
        'Appliance sales, repair, maintenance and installation',
        'Delivery, moving and logistics services',
        'AI integration and automation services',
        'Liquidation services for retailers, who list inventory on the Company\'s website',
        'Reseller accounts for buyers purchasing through the Company\'s website',
        'The Company\'s affiliate and referral programs'
      ] },
      { p: 'The Employee will record all leads, activities, quotes and sales in the Company\'s sales dashboard and perform other reasonable related duties as assigned.' }
    ] },
    { h: '3. Work Arrangement and Hours', body: [
      { p: `The role is approximately 75% mobile (field and remote outreach) and 25% in-house at the Company's shop. Normal hours are ${F.hours}, or as reasonably scheduled, in compliance with the Ontario Employment Standards Act, 2000 ("ESA").` },
      { p: 'On days worked at the shop, the Employee must clock in and out using the Company\'s dashboard. A day with a shop clock-in is an In-house Day. Every other working day is a Mobile Day.' }
    ] },
    { h: '4. Compensation', body: [
      { lead: '4.1 Base salary.', p: '$1,000.00 per week (equivalent to $200.00 per working day on a five-day week), paid weekly, less required deductions.' },
      { lead: '4.2 Daily commission.', p: 'In addition to base salary, the Employee earns commission on Eligible Collected Sales received on each working day, at the following rate applied to that day\'s total:', list: tierLines(tiers) },
      { p: tierExample(tiers) },
      { lead: '4.3 Collected Sales', p: 'means payment actually received by the Company, excluding HST and other sales taxes, and less any refunds or chargebacks. Commission is calculated on the full invoice amount; the cost of parts, materials or third-party services is not deducted. Commission is credited on the day payment is received.' },
      { lead: '4.4 Eligible Collected Sales.', p: 'Collected Sales are eligible for commission when:', steps: [
        'Accounts the Employee brings in: payment comes from a new client account the Employee sourced and brought to the Company (an "Employee Account"). This applies on any working day.',
        'In-house Days: on an In-house Day, payment comes from a deal the Employee personally closed that day, regardless of who generated the lead.',
        'Repeat orders: all future paid orders from an Employee Account remain eligible with no time limit, for as long as the Employee is employed (subject to section 4.8).'
      ] },
      { p: 'Sales to existing Company customers that are not Employee Accounts are not eligible, except under (b). The Company\'s sales dashboard records account ownership, closes and shop clock-ins, and is the basis for calculating commission. The Employee may raise any disagreement with the Director of Operations within 14 days of receiving a commission statement.' },
      { lead: '4.5 Liquidation partner sales.', p: 'For sales of a liquidation partner\'s products through the Company\'s website, Collected Sales means only the Company\'s share of the sale (currently 10% of the sale price, excluding HST), not the full sale price.' },
      { lead: '4.6 Payment.', p: 'Commission is paid on the regular weekly paycheque for the pay period in which it is earned, less required deductions. The Employee will receive a weekly commission statement.' },
      { lead: '4.7 Adjustments.', p: 'If a payment that earned commission is later refunded or reversed, the Company may deduct that commission from future commission, only as permitted by the ESA and with the Employee\'s written authorization, which the Employee gives by signing this agreement.' },
      { lead: '4.8 After employment ends.', p: `Commission is payable on payments received within ${F.afterDays} days after the employment end date for sales the Employee closed before that date. No commission is earned on payments received after that.` }
    ] },
    { h: '5. Pricing Authority', body: [
      { p: 'The Employee may set prices and discounts using their judgment, based on the cost and profit information in the Company\'s sales dashboard, and will consult the Director of Operations when unsure. Cost and pricing information is Confidential Information under the Confidentiality and Non-Solicitation Agreement.' }
    ] },
    { h: '6. Sales Quota and Probation', body: [
      { p: `The Employee's sales quota is ${money(quota)} in Eligible Collected Sales within the first 30 days of employment. The first three months are a probationary period. The Company will formally review performance against the quota at day 30. If the quota is not met, the Company may end employment during the probationary period. During the first three months of employment, no notice or pay in lieu of notice is required under the ESA.` }
    ] },
    { h: '7. Vacation and Public Holidays', body: [
      { p: 'The Employee is entitled to at least the ESA minimum: two weeks of vacation per year (three weeks after five years) and vacation pay of 4% (6% after five years) of wages, including commission, plus public holidays and public holiday pay under the ESA.' }
    ] },
    { h: '8. Benefits and Expenses', body: [
      { p: `${F.benefits} The Company will reimburse reasonable pre-approved business expenses, including ${F.mileage}, with receipts.` }
    ] },
    { h: '9. Termination', body: [
      { lead: 'After probation, without cause:', p: 'the Company will provide only the notice (or pay in lieu), severance pay if applicable, and continued benefits required by the ESA, plus all earned wages, commission and vacation pay. This is in full satisfaction of all entitlements.' },
      { lead: 'For cause:', p: 'the Company may end employment without notice or pay in lieu only for wilful misconduct, disobedience or wilful neglect of duty that is not trivial and has not been condoned, as defined in the ESA, and will otherwise provide all ESA minimums.' },
      { lead: 'Resignation:', p: 'the Employee will give two weeks\' written notice.' },
      { p: 'If any part of this agreement provides less than the ESA minimum, the ESA minimum applies instead.' }
    ] },
    { h: '10. Confidentiality', body: [
      { p: 'The Employee must sign and comply with the Company\'s Confidentiality and Non-Solicitation Agreement, which forms part of this agreement.' }
    ] },
    { h: '11. Company Property', body: [
      { p: 'All client lists, leads, accounts, dashboard data, devices and materials belong to the Company and must be returned when employment ends.' }
    ] },
    { h: '12. General', body: [
      { p: 'This agreement is governed by the laws of Ontario. The Employee confirms they have had the opportunity to get independent legal advice before signing.' }
    ] }
  ];
}

/** The Confidentiality and Non-Solicitation Agreement (it forms part of the Employment Agreement, section 10). */
export function confidentialitySections({ employee = {}, effective = 'November 9, 2026' } = {}) {
  const name = employee.name || 'the Employee';
  return [
    { h: 'Confidentiality and Non-Solicitation Agreement', group: true, body: [
      { p: `Between ${COMPANY_NAME}, an Ontario corporation operating as ${COMPANY_TRADE} ("the Company"), and ${name} ("the Employee"), effective ${effective}.` }
    ] },
    { h: '1. Confidential Information', body: [
      { p: '"Confidential Information" means non-public information about the Company, including client, reseller, affiliate and supplier lists and contacts; pricing, margins, dealer and wholesale pricing; inventory and sourcing information; sales data, leads and pipelines; marketing plans; AI systems, software, automations and methods; financial information; and employee information.' },
      { p: 'It does not include information that is or becomes public through no fault of the Employee, or that the Employee lawfully knew before employment.' }
    ] },
    { h: '2. Obligations', body: [
      { p: 'During and after employment, the Employee will not use or disclose Confidential Information except to perform their job for the Company, or where required by law (with prompt notice to the Company where legally allowed).' }
    ] },
    { h: '3. Return of Property', body: [
      { p: 'When employment ends, or on request, the Employee will return or permanently delete all Company materials, files, devices and account access, and confirm this in writing.' }
    ] },
    { h: '4. Non-Solicitation of Clients', body: [
      { p: 'For 12 months after employment ends, the Employee will not, directly or indirectly, solicit any client, reseller, affiliate or supplier that the Employee dealt with or learned about through the Company in the last 12 months of employment, for the purpose of offering competing products or services.' }
    ] },
    { h: '5. Non-Solicitation of Employees', body: [
      { p: 'For 12 months after employment ends, the Employee will not solicit or encourage any Company employee or contractor to leave the Company.' }
    ] },
    { h: '6. Work Product', body: [
      { p: 'All leads, client relationships, materials and work created in the course of employment belong to the Company.' }
    ] },
    { h: '7. No Non-Compete', body: [
      { p: 'Nothing in this agreement restricts the Employee from working for another business after employment ends, consistent with Ontario\'s Employment Standards Act, 2000.' }
    ] },
    { h: '8. Remedies', body: [
      { p: 'The Employee agrees that a breach may cause the Company irreparable harm, and the Company may seek an injunction in addition to any other remedy.' }
    ] },
    { h: '9. General', body: [
      { p: 'Governed by the laws of Ontario. If any term is unenforceable, the rest remains in effect. The obligations in sections 2 to 6 survive the end of employment.' }
    ] }
  ];
}

/** Sections as plain text: what is hashed, stored as the signed copy and emailed. */
export function sectionsText(sections) {
  const out = [];
  for (const s of sections) {
    out.push(s.h);
    for (const b of s.body || []) {
      if (typeof b === 'string') { out.push(b); continue; }
      const head = [b.lead, b.p].filter(Boolean).join(' ');
      if (head) out.push(head);
      (b.list || []).forEach((x) => out.push(`  - ${x}`));
      (b.steps || []).forEach((x, i) => out.push(`  ${String.fromCharCode(97 + i)}) ${x}`));
    }
    out.push('');
  }
  return out.join('\n').trim();
}

/** Every [bracket] still in the text: decisions the owner has not made yet. Signing stays closed while any remain. */
export function unresolvedItems(...sectionLists) {
  const found = new Set();
  for (const text of sectionLists.map(sectionsText)) for (const m of text.match(/\[[^\]]+\]/g) || []) found.add(m);
  return [...found];
}
