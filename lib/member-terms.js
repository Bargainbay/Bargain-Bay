// The Member Agreement: what a business accepts when it asks for member (wholesale) pricing. One text in code with a
// version, same as the affiliate agreement (lib/affiliate-terms.js), accepted by scrolling to the end and pressing Accept
// (components/AgreementScroll.jsx). Wording changes need a new version AND a new pinned hash in test/member-terms.test.mjs.
//
// It deliberately promises nothing the pricing code does not do: the price is whatever lib/pricing.js resolves, which is
// why it says "the price shown at checkout" and gives no discount percentage.
//
// No imports (it runs in the browser).

export const MEMBER_TERMS_VERSION = '2026-10-27';

export const MEMBER_TERMS = [
  {
    h: '1. This agreement',
    body: [
      { p: 'This agreement is between RS Solutions Inc., operating as Bargain Bay ("we", "us"), and the business named in your application ("you"). The person applying confirms they are allowed to agree to it for the business.' }
    ]
  },
  {
    h: '2. Who can be a member',
    body: [
      { p: 'Member pricing is for businesses that buy appliances for their own use or to resell: property managers, landlords, contractors, stores and resellers.' },
      { list: [
        'What you tell us about your business must be true, and you must keep it up to date.',
        'We may ask for proof of your business, such as a business number or HST number, and we approve every member by hand.',
        'We can say no, and we do not have to give a reason.'
      ] }
    ]
  },
  {
    h: '3. Member pricing',
    body: [
      { p: 'Once approved, you see member prices when you are signed in to your account. The price shown at checkout is the price you pay. Member prices are set by us and can change at any time, but never for an order you have already placed.' },
      { p: 'Member pricing belongs to your business account. Do not share your login, and do not use your account to buy for someone who is not part of your business and is not your customer.' }
    ]
  },
  {
    h: '4. Orders, payment and delivery',
    body: [
      { p: 'Every appliance we sell is one of a kind, so an order holds that exact unit. Member orders follow the same payment, delivery, pickup and HST rules as every other order on bargainbay.ca, unless we agree something different with you in writing.' }
    ]
  },
  {
    h: '5. Condition, warranty and returns',
    body: [
      { p: 'Units are sold as described on the listing, with the same one-year warranty and the same returns policy as every other customer. Members get no separate warranty or returns terms unless we agree them with you in writing.' },
      { p: 'If you resell what you buy, you are responsible to your own customers. Describe each unit\'s condition accurately, never as new if it is not, and do not offer our warranty as your own.' }
    ]
  },
  {
    h: '6. Your information',
    body: [
      { p: 'We use your business and contact details to run your account and fulfil your orders, and we handle them under our privacy policy. Tell us if your business details change.' }
    ]
  },
  {
    h: '7. Pausing and ending',
    body: [
      { list: [
        'You can stop being a member at any time by telling us.',
        'We can pause or end your member pricing at any time, for example for false information, sharing your login, or abusing returns.',
        'Orders already placed are honoured either way.'
      ] }
    ]
  },
  {
    h: '8. Changes and the rest',
    body: [
      { p: 'We may change these terms for the future with at least 30 days\' notice by email. A change does not affect orders already placed. If you do not agree, you may stop being a member.' },
      { p: 'This is the whole agreement about member pricing. Ontario law applies, and any dispute goes to the courts of Ontario. If part of it is unenforceable, the rest still applies.' },
      { p: 'By pressing Accept you confirm that you have read this agreement and agree to it on behalf of the business. We record the date and time you accepted and which version of the agreement it was.' }
    ]
  }
];

/** The whole agreement as plain text: what the test hashes. */
export function memberTermsText() {
  const out = [];
  for (const s of MEMBER_TERMS) {
    out.push(s.h);
    for (const b of s.body) {
      if (b.p) out.push(`${b.lead ? `${b.lead} ` : ''}${b.p}`.trim());
      if (b.list) for (const li of b.list) out.push(`- ${li}`);
    }
  }
  return out.join('\n');
}
