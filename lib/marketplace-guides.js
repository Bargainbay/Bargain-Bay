// Practical guides for sellers: how to get started, how to photograph a unit, how to pack and hand one over.
// See docs/marketplace/PLAN.md §12 and §14.
//
// These are HOW-TO documents, not rules. The rules are in lib/marketplace-policies.js and a guide never adds
// one: where a guide mentions a deadline, a limit, a fee or a count, it is imported from the code that
// enforces it — same discipline as the policies, and pinned by test/marketplace-guides.test.mjs.
//
// And the same caution about promises: a guide only describes what the system does today. (The tests grep for
// phrases that once promised something unbuilt.)
import {
  ACCEPT_HOURS, READY_HOURS, STRIKE_LIMIT, WARRANTY_MONTHS, MIN_PAYOUT_CENTS, BANK_COOLING_DAYS, HOLD_DAYS_BY_TIER,
  TIERS, CARRIERS, DEFAULT_COMMISSION_BPS
} from './marketplace-rules';
import { photoRequirements, TIER_LIMITS, LISTING_CONDITIONS, MAX_PUBLIC_PHOTOS } from './listing-rules';
import { PICKUP_ADDRESS, BUSINESS_HOURS, SALES_EMAIL } from './constants';

const pct = (bps) => `${(bps / 100).toString().replace(/\.0+$/, '')}%`;
const P = (...s) => s;

export const GUIDES = [
  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'getting-started', title: 'Getting Started as a Seller', icon: '1',
    summary: 'From approval to your first payout, in order, with what to do at each step.',
    sections: () => {
      const used = photoRequirements('Refurbished');
      return [
        { h: 'The whole journey', body: [{ steps: [
          'We approve your application and give your owner login access.',
          'Sign in, read and accept our policies.',
          'Add your banking details so we can pay you (we verify them first).',
          'Create your first listing: the unit, the price, honest notes and your photos.',
          'Submit it. We review it and tell you if anything needs changing.',
          'It goes on sale. (If you are sending the unit to our warehouse, we put it on sale once we have checked it in.)',
          `A customer buys. We confirm their payment and tell you — the clock starts: ${ACCEPT_HOURS} hours to accept, ${READY_HOURS} hours to have it ready.`,
          'We collect or deliver it (or you ship it). When it reaches the customer, the sale is booked to you.',
          'After the hold period, it is paid to your bank account.'] }] },
        { h: 'Step 1 — Sign in', body: [
          `Create an account at bargainbay.ca/signup using the email address we approved — it has to be that address. Then open your dashboard from the Vendor portal button at the top of any page.`,
          'The person we gave the owner login to is the only one who can accept policies and change banking details. They can ask us to add team members for everyday work.'] },
        { h: 'Step 2 — Accept the policies', body: P(
          'Under Policies you will find what we ask of every seller. Read the ones marked Required — they are short, in plain language, and every number in them is the number the system actually applies. Then accept. You cannot list new units until you have.') },
        { h: 'Step 3 — Add your banking details', body: [{ list: [
          'Under Payouts → Banking details, enter the account holder (it must match your business), institution (3 digits), transit (5 digits) and account number.',
          'We verify it with a void cheque or a bank letter. Until we have, we cannot pay you.',
          `Changing an account that is already in use? Payouts keep going to the old one for ${BANK_COOLING_DAYS} days after we verify the new one. That is deliberate.`,
          `Your first payout is checked by hand (a small test deposit or a call), so do not be surprised by it.`] }] },
        { h: 'Step 4 — Your first listing', body: [
          'Open Listings → New listing. Work through it top to bottom; the page tells you what is missing and nothing is sent until you press Submit.',
          { list: [
            'One physical unit is one listing. Three identical fridges are three listings.',
            `Choose the condition honestly — one of ${LISTING_CONDITIONS.join(', ')}. A unit that has been used is Refurbished, even if it looks new.`,
            'Type the model number exactly as it is on the rating plate. The serial number stays private.',
            'Weigh and measure it. Our crews are staffed against those numbers.',
            `Choose how it reaches the customer. New sellers start in Lane A (you bring it to our warehouse); Lane B (we collect it from you) and Lane C (you ship it) open at ${TIERS[1]} tier.`] },
          `Your first listings are limited (${TIER_LIMITS[0].maxUnits} at a time on ${TIERS[0]}); the limit rises as you build a clean record.`] },
        { h: 'Step 5 — Photograph it', body: P(
          `Photos are what make a customer trust a listing. A used unit needs at least ${used.minPublic}, plus a photo of the rating plate that customers never see. The Photo Shot Guide shows exactly what to take for each type of appliance.`) },
        { h: 'Step 6 — Submit, and what happens next', body: [{ list: [
          'We check every new seller\'s listings by hand. We aim to review within one business day.',
          'You will either see it go to the next step, or get a note saying exactly what to change. Fix it and submit again — that is normal.',
          'We may change the condition label if the photos and notes do not support it. We will tell you why.',
          'Once it is for sale you can lower the price any time. To change anything else, pause it and edit — it is then reviewed again.'] }] },
        { h: 'Step 7 — Your first order', body: [
          'You will get an email the moment a customer\'s payment is confirmed, and the order appears under Orders with two live countdowns.',
          { table: { head: ['Do this', 'Within'], rows: [
            ['Accept the order', `${ACCEPT_HOURS} hours`],
            ['Have it ready for collection (or tracking entered, if you ship it)', `${READY_HOURS} hours — counted from the same moment, so it includes the first ${ACCEPT_HOURS}`]] } },
          `If you cannot supply the unit, cancel straight away: the customer is refunded in full. It counts as a strike (${STRIKE_LIMIT} restricts your account), so keep stock accurate and pause anything you cannot fulfil — pausing is free.`,
          'When you accept an order we deliver, you will be asked to choose shipment insurance or decline it. Read the Fulfilment & Delivery Standards once so the choice is not new to you.'] },
        { h: 'Step 8 — Getting paid', body: [{ list: [
          `The commission is ${pct(DEFAULT_COMMISSION_BPS)} of the item price. Your Payouts page lists every entry — the sale, each deduction and the HST — so you can see exactly where the number came from.`,
          `A sale becomes payable after a hold that depends on your tier: ${Object.entries(HOLD_DAYS_BY_TIER).map(([t, d]) => `${TIERS[t]} ${d} days`).join(', ')} after delivery.`,
          `We pay once your available balance reaches $${MIN_PAYOUT_CENTS / 100}, by direct deposit or wire, after a person approves the run.`] }] },
        { h: 'Your first week: a checklist', body: [{ checklist: [
          'Policies accepted',
          'Banking details submitted',
          'First unit measured, weighed and photographed (including the rating plate)',
          'First listing submitted',
          'Read the Packing & Handover guide before the first order arrives',
          'Know who in your business will watch for order emails'] }] },
        { h: 'Stuck?', body: P(`Email ${SALES_EMAIL}. A question before you list costs nothing; a mistake after it can cost a strike.`) }
      ];
    }
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'photo-shot-guide', title: 'Photo Shot Guide', icon: '2',
    summary: 'Exactly which photos to take for each type of appliance.',
    sections: () => {
      const used = photoRequirements('Refurbished');
      const fresh = photoRequirements('New in Box');
      return [
        { h: 'Before you start', body: [
          `You need at least ${used.minPublic} photos of a used, open-box or refurbished unit (${fresh.minPublic} for new in box), plus a photo of the rating plate. Up to ${MAX_PUBLIC_PHOTOS} are allowed.`,
          { checklist: [
            'Wipe the unit down. Fingerprints and dust read as neglect.',
            'Plain wall or backdrop; clear the clutter, people, pets and house numbers out of the frame.',
            'Daylight or even overhead light. Turn the flash off — it makes stainless steel look scratched.',
            'Phone held level, landscape for most shots, about two metres back for the whole unit.',
            'Tap the screen to focus before every shot. Blurry photos are refused.'] },
          'Use the largest size your phone offers. Photos under 1000 px on the long edge are refused; 1600 px or more looks best.'] },
        { h: 'Shots every unit needs', body: [{ table: { head: ['Shot', 'How'], rows: [
          ['Front, whole unit', 'Doors closed, the entire appliance in frame, straight on.'],
          ['Back or side', 'Show the side panel and the back — customers want to see where it hides against a wall.'],
          ['Inside', 'Doors or lid open, shelves and drawers in place.'],
          ['Controls, powered on', 'The display lit, so it is clear it works.'],
          ['Every defect, close up', 'A coin or ruler next to it for scale. If in doubt, photograph it — hiding a mark is what causes returns.'],
          ['Accessories', 'Everything that comes with it, laid out together.'],
          ['Rating plate (private)', 'Model and serial number sharp enough to read. Only our reviewers ever see it.']] } }] },
        { h: 'By type of appliance', body: [{ table: { head: ['Appliance', 'Also photograph'], rows: [
          ['Refrigerator or freezer', 'Both doors open (fridge and freezer sections), the shelves and crisper drawers, the water and ice dispenser, the door seals, the control panel on.'],
          ['Range, cooktop or wall oven', 'The top with all burners (or the glass surface), the oven interior and racks, the control panel on, every knob in place, the anti-tip bracket if it has one.'],
          ['Dishwasher', 'The racks and spray arms, the tub, the door seal, the control panel.'],
          ['Washer or dryer', 'The drum, the door gasket, the detergent drawer or lint trap, the back (hoses, vent connection), the controls on.'],
          ['Microwave or range hood', 'The interior, the turntable and roller ring or the filters, the controls, the mounting bracket and hardware.']] } }] },
        { h: 'New in box', body: [{ list: [
          'The box, showing the label and an unbroken seal.',
          'The unit out of the box, front and back.',
          'The accessories and paperwork.',
          'The rating plate (private).'] }] },
        { h: 'What gets a photo refused', body: [{ list: [
          'Out of focus, too dark, or too small.',
          'Pictures from the manufacturer, a website or another seller instead of your unit.',
          'Watermarks, logos, phone numbers, web addresses, text laid over the picture, borders or collages.',
          'People, pets, house numbers or anything personal in frame.'] },
          'Every photo is re-saved by us, which removes its hidden information, including the location it was taken.'] },
        { h: 'Take the photos once', body: P(
          'Photograph the unit before you list it and keep the files. If we ask for a clearer picture of a mark, you will have it ready — and if there is ever a dispute about a unit\'s condition, your own dated photos help you as much as they help us.') }
      ];
    }
  },

  // ---------------------------------------------------------------------------------------------------
  {
    slug: 'packing-and-handover', title: 'Packing & Handover Checklist', icon: '3', printable: true,
    summary: 'How to prepare a unit for collection or delivery, by appliance type — printable for the loading bay.',
    sections: () => [
      { h: 'Why this matters', body: P(
        `A unit that arrives damaged is a refund, a strike and an unhappy customer — and a unit that was fine when it left but poorly prepared is yours, not the carrier's. Our driver checks the unit against the order and photographs it and its serial number at handover, so what they see is what the customer is owed. Have it ready within ${READY_HOURS} hours of the customer's payment being confirmed.`) },
      { h: 'Before anyone arrives', body: [{ checklist: [
        `The listing's SKU (for example MP-12-0001) written on a piece of tape on the side of the unit, so our dock can match it to the order`,
        'Unit clean, inside and out',
        'Everything that is listed with it is with it: shelves, racks, drawers, knobs, hoses, brackets, manuals',
        'Weight and dimensions on the listing within 5% of the truth',
        'Clear, level path from where it stands to the door; stairs or tight turns noted on the listing',
        'A person present at the agreed time'] }] },
      { h: 'Every appliance', body: [{ checklist: [
        'Power cord bundled and taped to the unit (not left to drag)',
        'Loose parts boxed or bagged and taped to the unit: racks, trays, grates, knobs, filters, hardware',
        'Doors and lids taped shut — painter\'s tape or stretch wrap, never packing tape straight onto a stainless or painted finish (it leaves residue)',
        'Glass and finished panels protected with cardboard or a blanket',
        'No water, ice, food or liquids left inside',
        'Anything over 150 lb: your people on hand to help our crew load it'] }] },
      { h: 'Refrigerators and freezers', body: [{ checklist: [
        'Emptied, defrosted and dry — water left inside leaks onto the truck and the unit',
        'Ice maker emptied and its water line drained',
        'Shelves, drawers and bins removed and boxed, or secured with stretch wrap',
        'Doors strapped or taped closed; handles protected',
        'Stays UPRIGHT. Lying a fridge down can send oil to the wrong place in the compressor — if it was ever laid down, tell us when you list it and let it stand upright for 24 hours before it is tested again'] }] },
      { h: 'Ranges, cooktops and wall ovens', body: [{ checklist: [
        'Oven racks removed and taped together, or boxed',
        'Cooktop grates, burner caps and knobs bagged and taped inside the oven or in a box',
        'Glass cooktop covered with a sheet of cardboard',
        'Oven door taped shut',
        'Anti-tip bracket and its screws included — it is a safety item',
        'Gas ranges: gas line capped by a qualified person; regulator and hose included; no propane or open line travelling with the unit'] }] },
      { h: 'Dishwashers', body: [{ checklist: [
        'Tub and hoses drained completely',
        'Racks pushed in and secured; spray arm fixed with tape',
        'Door taped shut',
        'Hoses and brackets bagged and taped to the unit',
        'Front panel protected'] }] },
      { h: 'Washers and dryers', body: [{ checklist: [
        'Washer drained: hoses emptied, detergent drawer empty',
        'Front-load washer: the transit bolts back in, if you still have them — if you do not, say so on the listing',
        'Door taped shut with the drum empty',
        'Dryer: lint trap and vent cleaned',
        'Hoses and vent kit bagged and taped to the unit',
        'Gas dryers: gas line capped by a qualified person'] }] },
      { h: 'Microwaves and range hoods', body: [{ checklist: [
        'Turntable and roller ring removed, wrapped and taped inside',
        'Door taped shut; glass protected',
        'Over-the-range microwave: mounting bracket, template and screws included',
        'Hood: filters removed and boxed, finish wrapped, hardware bagged and taped to the unit'] }] },
      { h: 'The handover', body: [
        { list: [
          `Lane A: bring the unit to our warehouse at ${PICKUP_ADDRESS} by appointment (${BUSINESS_HOURS}). We check it in against your listing — model, serial, condition and accessories — and put it on sale once it has passed.`,
          'Lane B: the moment you mark the order ready, we book our crew to collect it from your door or dock, and your order page shows when they have it. They check the model and serial against your listing, photograph the unit, and tell you about anything that does not match. A unit that does not match is not loaded; our management decides whether that is a strike and whether the customer is refunded.',
          `Lane C: you ship it yourself with one of ${CARRIERS.join(', ')}. Enter the carrier and tracking number in your portal within the ${READY_HOURS}-hour window, and keep your own photos of the packed unit — damage in a carrier's hands is yours.`] },
        'If something does not match — wrong model, missing part, worse condition than listed — the crew will tell you at the door and note it. It is far better for us to find that at your dock than for a customer to find it in their kitchen.'] },
      { h: 'Insurance, in one paragraph', body: P(
        'For units we collect or deliver you chose to insure the shipment or decline when you accepted the order. Either way the customer is made whole first. If damage appears in our transit and you insured, the insurance carries it; if you declined, it is charged to you — unless it comes from our own gross negligence. Damage that was visible at your dock, or caused by poor packing, is yours either way.') },
      { h: 'After the handover', body: [{ list: [
        'Your order moves to delivered once the customer has the unit, and the sale is booked to you.',
        'Keep your photos of the unit for at least the warranty period.',
        `The unit carries your ${WARRANTY_MONTHS}-month warranty from the day it is delivered.`] }] }
    ]
  }
];

export const GUIDE_BY_SLUG = Object.fromEntries(GUIDES.map((g) => [g.slug, g]));
