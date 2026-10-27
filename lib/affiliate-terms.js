// The affiliate agreement, as the applicant reads it on /affiliate before the Accept button works.
//
// ONE text, in code, with its version. The text an applicant accepted is therefore always recoverable:
// `affiliates.terms_version` says which version they accepted, and git says what that version said.
// test/affiliate-terms.test.mjs pins a hash of the text to the version, so the wording cannot change
// without the version changing (which makes everybody accept the new text) and the test being updated.
//
// Every figure comes from commission-rules, which is where the code that pays the commission reads
// it, so the agreement cannot promise a rate or a period the system does not apply.
//
// No imports except the rules (it runs in the browser).
import { AFFILIATE_DEFAULT_PCT, AFFILIATE_HOLD_DAYS, AFFILIATE_MIN_PAYOUT } from './commission-rules';

export const AFFILIATE_TERMS_VERSION = '2026-10-27';

const pct = AFFILIATE_DEFAULT_PCT;
const money0 = (n) => `$${n.toLocaleString('en-CA')}`;
const commissionOf = (n) => (n * pct) / 100;
const dollars = (n) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The policy format components/AgreementScroll renders: { h, body: [ { p, lead?, list? } | { list } | { table: { head, rows } } ] }.
export const AFFILIATE_TERMS = [
  {
    h: '1. This agreement',
    body: [
      { p: 'This agreement is between RS Solutions Inc., operating as Bargain Bay ("we", "us"), and you, the person applying. It sets out how you may promote Bargain Bay and how you earn commission when people buy through your code or link. You are identified by the account you are signed in with, and your commission is paid to the e-transfer address you give us.' }
    ]
  },
  {
    h: '2. You are independent',
    body: [
      { p: 'You are an independent affiliate, not our employee, agent, partner or franchisee. You choose when, where and how you promote, and we do not set your hours, targets or methods. You use your own phone, accounts and tools, and you are responsible for your own costs.' },
      { p: 'You are responsible for reporting your commission income and for any tax on it, including HST if you are required to register. We do not withhold tax and do not pay vacation pay, overtime, benefits or CPP/EI contributions on commission. Nothing here makes you eligible for them.' }
    ]
  },
  {
    h: '3. Your code and link',
    body: [
      { p: 'Once approved you get a personal code and a link in the form bargainbay.ca/?ref=YOURCODE. A customer who uses your code at checkout, or who opens your link and checks out within 30 days, is credited to you. Customers using your code get a discount, set when you are approved.' },
      { p: 'Tracking works in the customer\'s own browser, and the most recent affiliate link a customer opened is the one credited. We cannot credit a sale where the customer cleared their browser, used another device, or bought by phone, in person or by invoice without the code. We keep a count of visits through your link and show it with your sales in your dashboard. Our records of which sales used your code decide any question about credit.' }
    ]
  },
  {
    h: '4. Your commission',
    body: [
      { p: `You earn ${pct}% of the goods on every sale credited to you, or the rate shown in your approval. "Goods" means the price of the appliances before HST, after any discount the code gave, and not including delivery fees, haul-away or other service charges.` },
      {
        table: {
          head: ['Sale', 'Goods', 'Your commission'],
          rows: [
            ['A $10,000 range, no other discount', dollars(10000), dollars(commissionOf(10000))],
            ['A $1,000 fridge with a $30 code discount', dollars(970), dollars(commissionOf(970))],
            ['A $600 dishwasher', dollars(600), dollars(commissionOf(600))]
          ]
        }
      },
      { lead: 'When it becomes payable.', p: `Commission becomes payable when the customer has received the appliance and ${AFFILIATE_HOLD_DAYS} days have passed since delivery. That is the period in which a customer can return a unit for a change of mind. Until then it shows in your dashboard as pending.` },
      { lead: 'What earns nothing.', list: [
        'an order that is cancelled, refunded or voided;',
        'an order placed with your own email or payout address, or by a member of your household;',
        'an order we cannot credit to your code (see section 3);',
        'a sale of a seller\'s item on our marketplace, which is not our goods to commission.'
      ] },
      { p: 'We decide in good faith whether a sale qualifies, and you can see each sale and its status in your dashboard.' }
    ]
  },
  {
    h: '5. How you are paid',
    body: [
      { list: [
        'We pay by Interac e-transfer to the email address you give us. Keep it current: a payment sent to the address on file is paid.',
        `We review what is payable each week and pay when your payable balance reaches ${money0(AFFILIATE_MIN_PAYOUT)}. A smaller balance carries forward until it does.`,
        'Each payment is recorded in your dashboard with its date.',
        'If an order is refunded or cancelled after we have paid commission on it, we may take that amount off your next payment. We will not ask you to repay it in cash unless the order was one you were not entitled to be credited for, such as your own order.',
        'Commission is paid in Canadian dollars.'
      ] }
    ]
  },
  {
    h: '6. How you may promote us',
    body: [
      { lead: 'Say you earn a commission.', p: 'Whenever you post, share or advertise us, state clearly that you earn a commission, for example "#ad" or "I earn a commission on sales". Put it where people will see it, not buried in a long caption.' },
      { lead: 'Be honest.', p: 'Use the photos and descriptions we provide, and do not promise anything we have not. In particular:', list: [
        'every appliance is one of a kind and may sell before the customer reaches it;',
        'do not claim a price, a discount, a warranty, a delivery date or a condition that is not on our listing;',
        'do not claim earnings, or imply that anyone will earn a set amount;',
        'do not post reviews or testimonials you did not genuinely write or receive.'
      ] },
      { lead: 'No unsolicited messages.', p: 'Do not send texts, emails or direct messages about us to people who have not asked to hear from you. Canada\'s anti-spam law applies to you. Do not buy or scrape contact lists.' },
      { lead: 'Using our name.', p: 'You may use the name Bargain Bay and our listing images to promote sales through your link. Do not bid on "Bargain Bay" or our domain as a search-ad keyword, register look-alike domains or social accounts, or suggest you are us. Follow the rules of any platform you use.' },
      { p: 'If you break these rules we may pause or end your code, and we may decline commission on sales made through the breach.' }
    ]
  },
  {
    h: '7. Customers, your limits, and liability',
    body: [
      { lead: 'Customer information.', p: 'We do not give affiliates customer names, contact details or order contents. Your dashboard shows the date, the product, the goods amount and your commission, never who bought. If a customer gives you personal information, keep it private and use it only to help them buy from us.' },
      { lead: 'You cannot commit us.', p: 'You cannot take payment, set or change a price, promise a delivery date, or give a warranty or return promise on our behalf. Send the customer to our website, our phone line or our showroom for that.' },
      { lead: 'Liability.', p: 'We provide the program as is, and do not guarantee any level of sales or income. To the extent the law allows, our total liability to you under this agreement is limited to the commission payable to you at the time. You are responsible for what you say and post, and you will cover any loss we suffer because you broke section 6.' }
    ]
  },
  {
    h: '8. Starting, ending and changes',
    body: [
      { list: [
        'This agreement starts when we approve your application and continues until either of us ends it.',
        'You can stop at any time by telling us. We can pause or end your code at any time, and we will say why if we do so because of a breach.',
        'Ending does not cancel commission already earned on qualifying sales. Once the delivery and return period on those sales has passed, we pay it under section 5, even after you have stopped.',
        'We may change the rate or these terms for the future with at least 30 days\' notice by email. A change does not affect commission on sales already made. If you do not agree, you may stop.',
        'A sale made while your code was paused or ended earns nothing.'
      ] }
    ]
  },
  {
    h: '9. The rest',
    body: [
      { p: 'This is the whole agreement about the affiliate program and replaces anything said before. Ontario law applies, and any dispute goes to the courts of Ontario. If part of this agreement is unenforceable, the rest still applies. You may not transfer your rights under it.' },
      { p: 'By pressing Accept you confirm that you have read this agreement and agree to it. We record the date and time you accepted and which version of the agreement it was.' }
    ]
  }
];

/** The whole agreement as plain text: what the hash in the test is taken over, and what can be exported or printed. */
export function affiliateTermsText() {
  const out = [];
  for (const s of AFFILIATE_TERMS) {
    out.push(s.h);
    for (const b of s.body) {
      if (b.table) {
        out.push(b.table.head.join(' | '));
        for (const r of b.table.rows) out.push(r.join(' | '));
        continue;
      }
      if (b.lead || b.p) out.push(`${b.lead ? `${b.lead} ` : ''}${b.p || ''}`.trim());
      if (b.list) for (const li of b.list) out.push(`- ${li}`);
    }
  }
  return out.join('\n');
}
