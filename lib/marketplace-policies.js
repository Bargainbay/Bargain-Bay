// The marketplace's rules, written down. See docs/marketplace/PLAN.md §14.
//
// EVERY NUMBER IN THESE DOCUMENTS COMES FROM THE CODE THAT ENFORCES IT. The 24 and 72 hours, the three
// strikes, the 10% commission, the hold days, the photo counts — each is imported from the module that
// actually applies it and interpolated into the text, so a policy page can never say one thing while the
// system does another. (test/marketplace-policies.test.mjs pins this.) If the owner changes a rule, change
// it where it is enforced and every page that mentions it follows.
//
// STATUS. A document is either `published` (in force; vendors must accept it) or `draft` (written, but it
// needs a lawyer or the owner before it binds anyone). Drafts are shown with a banner, are not indexed, and
// are NOT part of what a vendor is asked to accept. Flipping a draft to `published` and bumping its `version`
// is what asks every vendor to accept it again.
//
// NOT LEGAL ADVICE. The vendor agreement, the customer-facing terms and the takedown policy are drafts for a
// lawyer to review. Everything here is a plain-language statement of how the system works.
import {
  ACCEPT_HOURS, READY_HOURS, CLAIM_RESPOND_HOURS, CLAIM_RESOLVE_DAYS, STRIKE_LIMIT, STRIKE_REVIEW_DAYS, DEFAULT_COMMISSION_BPS, WARRANTY_MONTHS,
  WARRANTY_RESERVE_BPS, WARRANTY_RESERVE_MONTHS, LANE_C_VENDOR_SHARE_BPS, HOLD_DAYS_BY_TIER, MIN_PAYOUT_CENTS,
  BANK_COOLING_DAYS, INSURANCE_BPS, STRIKE_REASONS, VENDOR_CANCEL_REASONS, CARRIERS, TIERS, VENDOR_REFUND_REASON
} from './marketplace-rules';
import {
  MARKET_CATEGORIES, LISTING_CONDITIONS, REJECT_REASONS, TIER_LIMITS, LANES, photoRequirements, MAX_PUBLIC_PHOTOS
} from './listing-rules';
import { DELIVERY_FEE, RESTOCKING_FEE_PCT, PICKUP_ADDRESS, SALES_EMAIL, BUSINESS_HOURS, CONDITIONS } from './constants';

const pct = (bps) => `${(bps / 100).toString().replace(/\.0+$/, '')}%`;
const CONTACT = SALES_EMAIL;
const HOUR_WORD = (h) => `${h} hours`;

// A section body is an array of: a string (paragraph), { list: [...] } or { table: { head, rows } }.
const P = (...s) => s;

export const POLICIES = [
  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'seller-code-of-conduct', title: 'Seller Code of Conduct', audience: 'vendors',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'How we expect sellers to behave: honest listings, no side deals, fair dealing with customers and with us.',
    sections: () => [
      { h: 'The short version', body: P(
        'Bargain Bay has built its name on one-of-a-kind appliances that are exactly what we say they are. Selling here means borrowing that name, and the rules below exist to protect it — for the customer who trusts it, for us, and for every other seller.') },
      { h: 'Be honest about what you are selling', body: [{ list: [
        'List the actual unit. Photograph it, describe every defect, and type the model number exactly as it appears on the rating plate.',
        `A pre-owned unit is listed as Refurbished — never as new, open-box or "like new". Describing a used unit as new ends your account immediately.`,
        'Say how it was tested and by whom. Do not claim a test that was not done.',
        'A retail ("compare at") price must be a real price you can point to. If you cannot, leave it blank.',
        'Do not use another seller\'s photos, a manufacturer\'s photos as if they were of your unit, or photos from anywhere you do not have the right to use.'] }] },
      { h: 'Keep dealing on the platform', body: [{ list: [
        'No phone numbers, emails, websites, or messaging-app handles in titles, descriptions, notes or photos.',
        'Do not ask or encourage a customer to pay, arrange delivery or leave a review outside Bargain Bay.',
        'Do not contact a customer yourself. We handle delivery arrangements, customer service and refunds. Customers\' details are given to you only as far as needed to fulfil an order, and may not be used for anything else — including marketing.'] }] },
      { h: 'Treat customers and our team fairly', body: [{ list: [
        'Meet your deadlines. A customer paid us for something; we are relying on you to have it ready.',
        'Respond to warranty claims promptly and in good faith.',
        'No fake reviews, no reviews from you, your staff or your relatives, and no offering anything in exchange for a review.',
        'Be straight with our team. If something has gone wrong — a unit damaged, a mistake in a listing, stock sold elsewhere — tell us early. Telling us early is always better than us finding out.'] }] },
      { h: 'Do not undermine the platform', body: [{ list: [
        'One physical unit, one listing. Do not list the same unit twice. If a unit sells somewhere else, take it down here at once.',
        'Keep your stock accurate. Pause a listing the moment you cannot supply it — pausing is free; cancelling a paid order is a strike.',
        'Do not try to manipulate rankings, prices, reviews or the review process.',
        'Do not use the platform for anything other than selling the appliances you have been approved to sell.'] }] },
      { h: 'What happens if the rules are broken', body: P(
        'Missed deadlines and similar mistakes are handled by the strike system described in the Enforcement & Appeals policy. Dishonesty — passing a used unit off as new, falsified documents, stolen or counterfeit goods, hiding a safety defect, fraud involving payouts — is not a strike: it ends your account straight away and we may report it.') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'prohibited-items', title: 'Prohibited & Restricted Items', audience: 'vendors',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'What can never be listed, and what needs extra proof first.',
    sections: () => [
      { h: 'What we sell', body: P(
        `At launch the marketplace is for major household appliances only: ${MARKET_CATEGORIES.join(', ')}. Parts, accessories and other products may follow; until they do, they cannot be listed.`) },
      { h: 'Never allowed', body: [
        'These cannot be listed under any circumstances. Where one is found, the listing is removed and — depending on what it was — the account may be ended.',
        { list: [
          'Stolen goods, and anything with a removed, altered or unreadable serial number or rating plate.',
          'Counterfeit or unauthorised goods, including re-badged or tampered units.',
          'Anything subject to a safety recall that has not been remedied, and anything you cannot show to be safe to sell.',
          'Electrical appliances without a certification mark accepted in Ontario (for example CSA or cUL).',
          'Units with fire, flood, biohazard or pest damage, or with missing safety components (door switches, anti-tip brackets, gas shut-offs).',
          'Gas appliances that have not been leak-tested and documented, and any unit shipped with an open or uncapped gas line.',
          'Refrigeration units that have lost their refrigerant or had the compressor removed.',
          'Anything that is not one of the categories above — services, digital goods, regulated or dangerous goods.',
          'Listings that move the customer off the platform (see the Seller Code of Conduct).'] }] },
      { h: 'Allowed only with extra proof', body: [{ table: { head: ['If you are listing…', 'We also need…'], rows: [
        ['A new, in-box unit', 'An invoice from an authorised distributor, and photos of the box and its seals intact.'],
        ['A gas range or dryer', 'A leak-test record, the regulator or hose included, and the installer-required notice.'],
        ['A built-in or commercial unit', 'Cut-out dimensions, and the voltage and phase.'],
        ['A refurbished unit', 'What was done to it: cleaned, repaired, parts replaced — and the test result and date.'],
        ['An open-box unit', 'Why it is open-box, and a list of what accessories are present.'],
        ['Anything over $2,500', 'Review by our team regardless of your tier.']] } }] },
      { h: 'If you are not sure', body: P(
        `Ask before you list: ${CONTACT}. A question costs nothing; a prohibited listing can cost an account.`) },
      { h: 'Notes', body: P(
        'This list is a plain-language statement of our rules, not a legal checklist. Product-safety, electrical, gas and refrigerant rules change; you remain responsible for knowing the rules that apply to what you sell, and we may update this list at any time (see Enforcement & Appeals for how changes are notified).') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'listing-photo-standards', title: 'Listing & Photo Standards', audience: 'vendors',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'What every listing must contain, and exactly what photos we need.',
    sections: () => {
      const used = photoRequirements('Refurbished');
      const fresh = photoRequirements('New in Box');
      return [
        { h: 'What a listing must have', body: [{ table: { head: ['Field', 'Rule'], rows: [
          ['Category', 'Chosen from the list. One physical unit is one listing.'],
          ['Make and model', 'The model number exactly as on the rating plate.'],
          ['Serial number', 'Required. It is private — customers never see it — and is checked against every other listing to stop duplicates and stolen goods.'],
          ['Condition', `One of: ${LISTING_CONDITIONS.join(', ')}.`],
          ['Title', 'Make, model, type, size, colour. No capitals, emoji, promotional words, prices or contact details.'],
          ['Description', 'What it is and every defect, in plain sentences. No contact details or links.'],
          ['Price', 'Canadian dollars, before tax.'],
          ['Retail price', 'Optional. If given, it must be higher than your price and you must say where it comes from.'],
          ['Size and weight', 'Width, depth, height and weight. Our crews are staffed against them.'],
          ['Test', 'That it was tested and works, and how it was tested.'],
          ['Warranty', `At least ${WARRANTY_MONTHS} months, from you.`],
          ['Fulfilment', 'Which way the unit will reach the customer (see Fulfilment & Delivery Standards).']] } }] },
        { h: 'Photos', body: [
          'Photos of the actual unit are the single biggest reason a customer trusts a listing. They are checked by software and by a person.',
          { table: { head: ['', 'Used, open-box or refurbished', 'New in box'], rows: [
            ['Minimum photos', String(used.minPublic), String(fresh.minPublic)],
            ['Required shots', 'Front (the whole unit), back or side, inside with doors open, controls powered on; a close-up of every defect on a scratch-and-dent unit.', 'Front of the unit.'],
            ['Always required', 'A clear photo of the rating plate showing model and serial (private evidence — never shown to customers).', 'The same.'],
            ['Size', 'At least 1600 px on the long edge is best; 1000 px is the minimum. Up to 15 MB each.', 'The same.'],
            ['Format', 'JPG, PNG, WebP or HEIC.', 'The same.']] } }] },
        { h: 'Photo rules', body: [{ list: [
          `Real photos of this unit — not the manufacturer's pictures, not another seller's. Up to ${MAX_PUBLIC_PHOTOS} per unit.`,
          'In focus, level and evenly lit, with the whole unit in frame against a plain, uncluttered background.',
          'No watermarks, logos, phone numbers, web addresses, text overlays, borders or collages. No people, pets, house numbers or personal information.',
          'Every photo is re-saved by us, which removes its hidden data (including location). The original file is never kept.',
          'Upload files only. We do not accept links to photos hosted elsewhere.'] }] },
        { h: 'How review works', body: [
          `Every listing from a new seller is reviewed by a person before it goes live. Reviewers may re-grade the condition you chose, ask for changes, or reject the listing for a stated reason. The reasons we use are:`,
          { list: Object.values(REJECT_REASONS) },
          'A listing that is for sale can only have its price lowered. To change anything else, pause it; it will be reviewed again.'] },
        { h: 'Limits by tier', body: [{ table: { head: ['Tier', 'Fulfilment lanes', 'Listings at once'], rows:
          Object.entries(TIER_LIMITS).map(([t, l]) => [TIERS[t], l.lanes.join(', '), String(l.maxUnits)]) } }] }
      ];
    }
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'condition-grading', title: 'Condition Grading Guide', audience: 'both',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'The four condition labels, what each one promises, and what is never allowed.',
    sections: () => [
      { h: 'Four labels, no more', body: P(
        'Every unit is listed under exactly one of these. Sellers cannot invent others, and the older labels "Used", "Tested & Working" and plain "Scratch & Dent" are not used. Our reviewers may re-grade a listing if the photos and notes do not support the label chosen.') },
      { h: 'The labels', body: [{ table: { head: ['Label', 'What it means', 'What the listing must show'], rows: [
        ['New in Box', CONDITIONS['New in Box'], 'The sealed box and the unit. An invoice from an authorised distributor is required.'],
        ['New Open Box', CONDITIONS['New Open Box'], 'Why the box was opened and what accessories are present.'],
        ['New Scratch & Dent', CONDITIONS['New Scratch & Dent'], 'A close-up of every blemish.'],
        ['Refurbished', 'Previously owned, then cleaned, repaired where needed and tested by the seller. Sold as Refurbished — never as new.', 'What was done to it, the test result and date, and any cosmetic wear.']] } }] },
      { h: 'A pre-owned unit is always Refurbished', body: P(
        'If a unit has been used — installed, lived with, or returned after use — it is Refurbished, whatever its condition. It may look perfect; it is still not new. Selling a used unit as new is the one thing that ends a seller\'s account at once.') },
      { h: 'Describing wear honestly', body: [{ list: [
        'Say where a mark is and how large it is ("1 cm scratch on the left side panel, hidden against a wall").',
        'Photograph it close up, with something for scale.',
        'If you are unsure whether something counts as a defect, list it.'] }] },
      { h: 'When the grade is wrong', body: P(
        'A unit that arrives in worse condition than its label is "not as described". The customer is made whole first; the seller then bears the cost and receives a strike (see the Returns, Warranty & Guarantee policy).') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'fulfilment-delivery', title: 'Fulfilment & Delivery Standards', audience: 'vendors',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'The 24-hour and 72-hour clocks, the three ways a unit reaches the customer, packing, insurance and damage.',
    sections: () => [
      { h: 'The two clocks', body: [
        `When a customer pays, we confirm their e-transfer. That moment starts two clocks, and you are told only then — an unpaid order can never be accepted, missed or struck.`,
        { table: { head: ['Deadline', 'What you must do'], rows: [
          [`${HOUR_WORD(ACCEPT_HOURS)} to accept`, 'Accept the order in your portal. If you do not, the order is cancelled, the customer is refunded and you receive a strike.'],
          [`${HOUR_WORD(READY_HOURS)} to be ready`, `Counted from the same moment — so it includes the ${ACCEPT_HOURS} hours. Have the unit packed and ready for collection (or, if you ship it yourself, enter the carrier and tracking number). Miss it and you receive a strike and the customer may cancel for a full refund.`]] } },
        'Clocks run in calendar hours, weekends included, and are judged by our server\'s clock — never by your browser. You will be reminded before each deadline.',
        'If you cannot supply a unit, cancel the order straight away and the customer is refunded in full. That is a strike, every time — so keep your stock accurate and pause listings you cannot fulfil (pausing is free).'] },
      { h: 'The three ways a unit reaches the customer', body: [{ table: { head: ['Lane', 'How it works'], rows: [
        ['A — ' + LANES.A, `You bring the unit to our warehouse (${PICKUP_ADDRESS}) by appointment. We check it in against your listing, store it and deliver it. A customer can collect it from our warehouse.`],
        ['B — ' + LANES.B, 'The unit stays with you. When you mark a sold unit ready, we book our crew to collect it, inspect it at your dock, and deliver it. Available from Standard tier.'],
        ['C — ' + LANES.C, `You deliver it yourself with a carrier you choose from our list (${CARRIERS.join(', ')}). You must enter the carrier and tracking number within the ${READY_HOURS}-hour window. Available from Standard tier.`]] } }] },
      { h: 'Delivery fees', body: [{ list: [
        `The customer pays us a delivery fee (currently ${`$${DELIVERY_FEE}`} for local delivery) for each shipment: everything we move for an order is one delivery, and each seller who ships their own unit is a separate one.`,
        `Lanes A and B: we also charge you a delivery service fee for collecting and delivering, set by the size of the unit and shown on your Orders page. It is deducted from your payout.`,
        `Lane C: you keep ${pct(LANE_C_VENDOR_SHARE_BPS)} of the delivery fee the customer paid, and we keep the rest. You may not charge the customer anything extra. If shipping costs you more than that, tell us before your ${READY_HOURS}-hour deadline and we will arrange collection and delivery instead (the delivery service fee then applies).`,
        'Haul-away and installation are services we offer customers ourselves, on units we deliver. You do not provide or charge for them.'] }] },
      { h: 'Packing and handover', body: [{ list: [
        'Refrigerators and freezers upright, doors taped or strapped.',
        'Cords and hoses bundled and taped to the unit. Water lines drained. Dryer vents clean.',
        'Gas lines capped by a qualified person; propane removed.',
        'Loose racks, drawers and glass secured or boxed. The exterior cleaned.',
        'Weight and dimensions on the listing within 5% of the truth.',
        'Ground-level access or a loading dock. Help our crew load anything over 150 lb.',
        'Be present at the agreed time. The driver checks the unit against the order and photographs it and its serial number.'] }] },
      { h: 'Insurance on units we deliver', body: [
        `For every order we collect or deliver (Lanes A and B), you must choose when you accept it: insure the shipment, or decline insurance. There is no default.`,
        { list: [
          `Insured: the premium (currently ${pct(INSURANCE_BPS)} of the unit's price) is taken from your payout, and damage in our transit is covered.`,
          'Declined: you carry the risk of damage in our transit. The customer is always made whole first; the cost is then charged to you.',
          'Either way, damage that was visible when we collected the unit, or that comes from how it was packed, is yours.'] },
        'Declining insurance does not cover our own gross negligence or wilful misconduct. Lane C shipments are not insured by us; the carrier and you carry that risk.'] },
      { h: 'Damage and claims', body: [{ table: { head: ['Where the damage first appears', 'Who bears it'], rows: [
        ['At your handover (our photos show it)', 'You.'],
        ['In our transit, and you chose insurance', 'The insurance. The customer is made whole first.'],
        ['In our transit, and you declined insurance', 'You, after the customer is made whole.'],
        ['In a carrier\'s hands (Lane C)', 'You.'],
        ['Because the customer mishandled it', 'The customer.']] } }] },
      { h: 'Returns', body: P(
        'A returned unit comes back to our warehouse, not to you. We inspect it and then credit, relist it with your agreement, or send it back at your cost.') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'returns-warranty', title: 'Returns, Warranty & Guarantee', audience: 'vendors',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'The one-year warranty every unit carries, how claims work, and who pays when a unit is not as described.',
    sections: () => [
      { h: 'Every unit carries a warranty from you', body: P(
        `Every unit you list carries at least ${WARRANTY_MONTHS} months of warranty from you, covering functional failure under normal household use — not cosmetic wear, customer damage or incorrect installation. The listing cannot be submitted with less. For a new unit, the manufacturer's warranty is honoured and you back it for at least the same ${WARRANTY_MONTHS} months.`) },
      { h: 'Warranty reserve', body: P(
        `A one-year promise is only worth something if the seller is still around in month eleven. So ${pct(WARRANTY_RESERVE_BPS)} of the net of each sale is held back for ${WARRANTY_RESERVE_MONTHS} months. It is released automatically when the period ends, provided no warranty claim on that order is open. A paid warranty claim is taken from the reserve first, then from your balance.`) },
      { h: 'How a warranty claim works', body: [{ list: [
        'The customer contacts us. We check the claim, open it on your Claims page, attach any photos the customer sent, and tell you. You can add photos of the repair. You see the unit and what is wrong, never the customer\'s contact details.',
        `You must respond within ${CLAIM_RESPOND_HOURS} hours and resolve it within ${CLAIM_RESOLVE_DAYS} days — repair, replace, or agree that we refund the customer.`,
        'If you do not, we do it ourselves and charge you, and a missed claim deadline is a strike (one strike per claim, however many deadlines are missed).',
        'The cost of a claim we pay is recorded against you on your Payouts page, with its reason.'] }] },
      { h: 'When the customer gets something wrong or broken', body: [
        `Our customer return policy applies to marketplace units too. In short: a unit that does not work on arrival (reported within 48 hours) or is materially different from its listing (reported within 7 days) is made right at no cost to the customer — an exchange, repair or full refund. For a change of mind, a ${RESTOCKING_FEE_PCT}% restocking fee applies.`,
        'We deal with the customer first so they are never left waiting on a dispute between us. We then recover the cost from you:',
        { list: [
          `A unit that is not as described, or arrives dead: full refund to the customer; you bear the cost and receive a strike.`,
          `A seller-side cancellation: the customer is refunded in full and you receive a strike (the books record this as "${VENDOR_REFUND_REASON}").`,
          'A change-of-mind return is the customer\'s choice, not your fault, and is not a strike. The unit comes back to our warehouse and we agree with you whether it is relisted or sent back to you at your cost.'] }] },
      { h: 'The Bargain Bay guarantee', body: P(
        'In addition to your warranty, we stand behind marketplace purchases: if a unit is not as described, or does not work when it arrives, the customer can rely on us to put it right and we will sort it out with you afterwards. That guarantee costs you nothing as long as your listings are accurate; it costs you the refund and a strike when they are not.') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'fees-payouts', title: 'Fees & Payouts', audience: 'vendors',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'What we charge, what you keep, when and how you are paid, and the safety checks on your bank details.',
    sections: () => [
      { h: 'What we charge', body: [{ table: { head: ['Fee', 'Amount'], rows: [
        ['Listing', 'Free. You pay when you sell.'],
        ['Commission', `${pct(DEFAULT_COMMISSION_BPS)} of the item price, before tax. Not charged on delivery or HST.`],
        ['Delivery service (units we collect or deliver)', 'A fee by unit size, shown on your Orders page and copied onto each order when you accept it. Not charged in Lane C.'],
        ['Insurance (optional)', `${pct(INSURANCE_BPS)} of the unit's price, only if you choose cover.`],
        ['HST on our fees', 'Our commission and delivery service are taxable, so HST is added to them. Insurance is treated as exempt.']] } },
        `The commission rate may be raised over time. A new rate applies only to orders placed on or after its start date, and you are given advance notice. Sales already made keep the rate they were made at.`] },
      { h: 'Tax on your sales', body: P(
        'You are the seller of record. The HST a customer pays on your item is yours to account for: we pass it to you with the sale, and you remit it. For that reason only HST-registered sellers can be ordered from at launch; we record your HST position when you are approved. Speak to your own accountant about your obligations.') },
      { h: 'When a sale becomes payable', body: [
        `A sale is booked when the customer receives the unit. It becomes available to be paid after a hold that depends on your tier:`,
        { table: { head: ['Tier', 'Held for'], rows: Object.entries(HOLD_DAYS_BY_TIER).map(([t, d]) => [TIERS[t], `${d} days after delivery`]) } },
        `In Lane C the hold starts when the carrier or customer confirms delivery, not when you ship.`] },
      { h: 'What comes off', body: [{ list: [
        'Commission, delivery service fee and insurance (if chosen), and the HST on the fees.',
        `The warranty reserve (${pct(WARRANTY_RESERVE_BPS)}, held ${WARRANTY_RESERVE_MONTHS} months).`,
        'Refunds, charge-backs and warranty costs that are yours under these policies. Each is a separate line with a stated reason, and a paid warranty claim is taken from the reserve held for that order first, then from your balance. A correction in either direction is also a separate line with a written reason.'] },
        'Your Payouts page shows every entry with its date and the date it becomes payable. Nothing is hidden in a lump.'] },
      { h: 'How you are paid', body: [{ list: [
        `Payouts are made by direct deposit or wire to the bank account you gave us — never to any other.`,
        `We pay once your available balance is at least $${MIN_PAYOUT_CENTS / 100}. Smaller balances wait for the next run.`,
        'Every payout is approved by a person before it is sent. Your first payout is checked by hand (a small test deposit or a call).',
        'If your balance is negative — for example a refund after a payout — it is carried forward and netted off future sales.'] }] },
      { h: 'Your bank details', body: [{ list: [
        'Only the account owner can add or change them. The account holder\'s name must match your business.',
        'We verify every account (a void cheque or bank letter) before we use it.',
        `If you replace an account that is already in use, payouts keep going to the old one for ${BANK_COOLING_DAYS} days after we verify the new one. This protects you if someone ever takes over a login.`,
        'Everyone on your account is emailed whenever banking details are submitted or verified. If that was not you, tell us immediately.',
        'Account numbers are stored encrypted; we show only the last four digits.'] }] }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'enforcement-appeals', title: 'Enforcement & Appeals', audience: 'vendors',
    status: 'published', version: 1, acceptRequired: true,
    summary: 'Strikes, restriction, immediate removal, tiers, and how to appeal.',
    sections: () => [
      { h: 'Strikes', body: [
        `A strike is recorded for each of these:`,
        { list: Object.values(STRIKE_REASONS) },
        `You can see your strikes, their reasons and the orders they relate to on your dashboard at all times.`] },
      { h: `${STRIKE_LIMIT} strikes and your account is restricted`, body: [
        `When you reach ${STRIKE_LIMIT} active strikes your account is restricted automatically: your listings come down, you cannot list or sell new units, and nothing new can be ordered from you. Orders already paid must still be fulfilled, and you continue to be paid for them.`,
        `Strikes do not expire on a timer. Every ${STRIKE_REVIEW_DAYS} days each one is put in front of our management to be kept or removed, and a strike can be removed only with a written reason that stays on the record. A restricted account is reinstated only by a deliberate decision, and returns to probation.`] },
      { h: 'Immediate removal', body: P(
        'These skip the strikes entirely: selling stolen or counterfeit goods; passing a used unit off as new; falsifying a document; hiding a safety defect; fraud involving payouts or bank details. Your account is ended, funds may be held while we investigate, and we may report it to the authorities.') },
      { h: 'Tiers', body: [
        'New sellers start on Probation. Tier is earned from a clean record, reviewed by us, and can be reduced.',
        { table: { head: ['Tier', 'What it allows', 'Payout held'], rows: Object.entries(TIER_LIMITS).map(([t, l]) => [
          TIERS[t], `Lanes ${l.lanes.join(', ')}; up to ${l.maxUnits} listings at once`, `${HOLD_DAYS_BY_TIER[t]} days after delivery`]) } }] },
      { h: 'If you think we got it wrong', body: [
        'Write to us at ' + CONTACT + ' with the strike or decision and your reasons. We acknowledge within 2 business days and decide within 5. A strike caused by our own delay — for example a payment confirmation we recorded late — is withdrawn.',
        'A decision on an appeal is made by someone who was not involved in the original decision where we can.'] },
      { h: 'Changes to these policies', body: P(
        'We may change these policies. We give you at least 14 days\' notice of a change that affects you, and you are asked to accept the new version in your dashboard. If you do not accept it you cannot list new units; orders already paid must still be fulfilled.') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'vendor-agreement', title: 'Vendor Agreement', audience: 'vendors',
    status: 'draft', version: 1, acceptRequired: true,
    summary: 'The contract between a seller and Bargain Bay.',
    sections: () => [
      { h: 'DRAFT', body: P(
        'This is a plain-language DRAFT prepared for a lawyer to review and finalise. It is not in force and no seller is asked to accept it until it is published. Where it says "must", the matching operational rule is already enforced by the system; the legal wording around it is what needs review.') },
      { h: '1. Parties and role', body: P(
        'This agreement is between the business that applied to sell (the "Seller") and Bargain Bay ("we"). The Seller is an independent business and the seller of record for every unit it lists. We provide the marketplace, collect payment from customers on the Seller\'s behalf, arrange delivery for units in Lanes A and B, and pay the Seller as set out in Fees & Payouts. Nothing makes the Seller our employee, partner or agent.') },
      { h: '2. Authority to sell', body: P(
        'The Seller promises that it owns each unit it lists (or has authority to sell it), that the unit is not stolen, counterfeit or subject to an unremedied recall, that the listing is accurate, and that it holds a valid HST registration (or has told us if it does not).') },
      { h: '3. Policies', body: P(
        'The Seller agrees to follow the Seller Code of Conduct, Prohibited & Restricted Items, Listing & Photo Standards, Condition Grading Guide, Fulfilment & Delivery Standards, Returns, Warranty & Guarantee, Fees & Payouts, and Enforcement & Appeals (the "Policies"), as updated from time to time on notice. The Policies form part of this agreement.') },
      { h: '4. Warranty', body: P(
        `The Seller gives each customer at least ${WARRANTY_MONTHS} months of warranty on every unit and honours claims as set out in the Policies. We may resolve a claim and recover our cost from the Seller, including from the warranty reserve.`) },
      { h: '5. Money', body: P(
        `We charge the commission and fees in the Policies and may deduct them, any refunds, charge-backs and warranty costs that are the Seller's, and the warranty reserve from amounts owed to the Seller. We may withhold amounts owed while we investigate suspected fraud or a breach, and may set off amounts the Seller owes us. The Seller is responsible for its own taxes. [Lawyer: set-off, holdback and suspected-fraud language.]`) },
      { h: '6. Licence to use photos and listings', body: P(
        'The Seller keeps ownership of its photos and text and gives us a licence to display, copy, resize and re-encode them on the marketplace and in our advertising of marketplace units, for as long as the unit is listed and a reasonable time after. The Seller promises it has the right to give this licence.') },
      { h: '7. Customer information', body: P(
        'The Seller receives only the customer details needed to fulfil an order, uses them only for that, keeps them secure, deletes them when no longer needed, does not market to customers, and tells us at once of any breach. [Lawyer: PIPEDA wording.]') },
      { h: '8. Insurance and risk', body: P(
        'Risk in a unit passes as set out in the Fulfilment & Delivery Standards. If the Seller declines insurance on a unit we deliver, it bears damage in our transit, other than damage caused by our gross negligence or wilful misconduct. [Lawyer: limitation of liability.]') },
      { h: '9. Suspension and termination', body: P(
        'We may restrict, suspend or end the Seller\'s account as set out in Enforcement & Appeals. The Seller may stop selling at any time after fulfilling paid orders. On ending, orders already paid are completed, and amounts owed either way are settled, with the warranty reserve released at the end of its period unless a claim is open.') },
      { h: '10. Liability', body: P('[Lawyer: limitation and exclusion of liability, indemnity by the Seller for claims arising from its units and listings, and our indemnity, if any.]') },
      { h: '11. General', body: P(
        'This agreement is governed by the laws of Ontario and the federal laws of Canada that apply there. Changes need 14 days\' notice. Notices go to the email addresses on the Seller\'s account. [Lawyer: assignment, entire agreement, dispute resolution, survival.]') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'ip-takedown', title: 'Intellectual Property & Takedown', audience: 'both',
    status: 'draft', version: 1, acceptRequired: false,
    summary: 'How to report a counterfeit, a stolen photo, or a listing that infringes your rights.',
    sections: () => [
      { h: 'DRAFT', body: P('A plain-language draft for a lawyer to review before it is published.') },
      { h: 'Reporting a problem', body: [
        `If you believe a marketplace listing is counterfeit, uses your photographs or text without permission, or otherwise infringes your rights, email ${CONTACT} with:`,
        { list: ['The listing (its SKU or a link).', 'What you own, and how you can show it.', 'Why the listing infringes it.', 'Your name and contact details.'] },
        'We act promptly: a listing under a credible complaint may be paused while we look into it.'] },
      { h: 'Stolen goods', body: P(
        'If you believe a unit listed here was stolen, tell us at once, with a police report number if you have one. We will freeze the listing and the seller\'s account, preserve all records, and cooperate with the police.') },
      { h: 'What we do', body: [{ list: [
        'Ask the seller to respond.',
        'Remove a listing that infringes.',
        'End the account of a seller who infringes or lists counterfeit or stolen goods.'] }] },
      { h: 'Counter-notice', body: P('A seller who thinks a listing was removed in error can appeal under Enforcement & Appeals.') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'buyer-protection', title: 'Buying from Marketplace Sellers', audience: 'customers',
    status: 'draft', version: 1, acceptRequired: false,
    summary: 'What it means when a unit is "Sold by" someone else, and how you are protected.',
    sections: () => [
      { h: 'DRAFT', body: P('A plain-language draft for the owner and a lawyer to approve before it is shown to customers.') },
      { h: 'What "Sold by" means', body: P(
        'Some units on Bargain Bay are sold by approved marketplace sellers rather than from our own stock. Each one is labelled "Sold by" with the seller\'s name. We check every seller before they can list, review their listings, take your payment, and arrange the delivery (apart from sellers who ship their own unit, which the listing says).') },
      { h: 'The seller backs it', body: P(
        `Every marketplace unit carries a warranty of at least ${WARRANTY_MONTHS} months from the seller. A used unit is always sold as Refurbished, never as new, and the seller states what was done to it and how it was tested.`) },
      { h: 'If something is wrong', body: P(
        `Our Returns & Refund Policy applies to marketplace purchases. If a unit does not work when it arrives (tell us within 48 hours) or is not as described (within 7 days), we put it right with a repair, exchange or full refund — and then sort it out with the seller. You do not have to chase the seller. Contact us at Service@rssolutions.ca with your order number and photos.`) },
      { h: 'Differences you should know about', body: [{ list: [
        'Units sold by marketplace sellers are not eligible for our promo codes, automatic discounts or member pricing.',
        `Some units are collected from the seller by our crew or shipped by the seller themselves, so they cannot be picked up from our warehouse. Checkout tells you.`,
        'Delivery is charged per shipment: a unit shipped separately by its seller has its own delivery fee.'] }] },
      { h: 'Your payment', body: P(
        'You pay Bargain Bay by e-transfer, as for every order. We hold your payment and pay the seller after delivery; the seller never receives your payment details.') }
    ]
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'marketplace-terms', title: 'Marketplace Terms & Privacy Notice', audience: 'both',
    status: 'draft', version: 1, acceptRequired: false,
    summary: 'How the marketplace fits into our terms of service and privacy policy.',
    sections: () => [
      { h: 'DRAFT', body: P('A plain-language draft for a lawyer to review. It is meant to sit beside our site Terms of Service and Privacy Policy, not replace them.') },
      { h: 'Roles', body: P(
        'On the marketplace, the seller named on a listing is the seller of that unit. Bargain Bay operates the marketplace, takes payment, arranges delivery for most units, and handles customer service. A purchase of a marketplace unit is a purchase from that seller.') },
      { h: 'Personal information', body: [
        'We collect and use your information to take and deliver your order, as set out in our Privacy Policy. For a marketplace unit we share with the seller only what they need to fulfil it: for a unit they ship themselves, the delivery address and your name for the shipping label; otherwise, your first name and general area. We never give a seller your email address or phone number.',
        'Sellers may use that information only to fulfil the order. They may not contact you, market to you or keep it longer than needed. Marketing from us follows your consent choices (see the Privacy Policy), and buying from a seller does not give that seller your consent to market to you.'] },
      { h: 'Reviews', body: P('Reviews can be left only by customers who received the unit. We may remove reviews that are fake, abusive or identify individuals.') },
      { h: 'Questions', body: P(`Contact ${CONTACT}. ${BUSINESS_HOURS}.`) }
    ]
  }
];

export const POLICY_BY_SLUG = Object.fromEntries(POLICIES.map((p) => [p.slug, p]));
export const isPublished = (p) => p.status === 'published';
export const publishedPolicies = () => POLICIES.filter(isPublished);
/** What a vendor must accept before listing: every PUBLISHED document marked acceptRequired. */
export const requiredPolicies = () => POLICIES.filter((p) => isPublished(p) && p.acceptRequired);
export const AUDIENCE = { vendors: 'For sellers', customers: 'For customers', both: 'Everyone' };
