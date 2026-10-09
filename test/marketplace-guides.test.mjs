// The seller guides: practical, accurate to what is built, and the onboarding checklist is worked out from
// what is really on record.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { GUIDES, GUIDE_BY_SLUG } from '../lib/marketplace-guides.js';
import { POLICIES } from '../lib/marketplace-policies.js';
import { onboardingSteps, onboardingState, onboardingProgress } from '../lib/onboarding.js';
import { createApplication, decideApplication } from '../lib/vendors.js';
import { acceptPolicies } from '../lib/policy-acceptance.js';
import { requiredPolicies } from '../lib/marketplace-policies.js';
import { submitBankAccount, verifyBankAccount } from '../lib/vendor-bank.js';
import {
  ACCEPT_HOURS, READY_HOURS, STRIKE_LIMIT, WARRANTY_MONTHS, MIN_PAYOUT_CENTS, BANK_COOLING_DAYS, HOLD_DAYS_BY_TIER, CARRIERS
} from '../lib/marketplace-rules.js';
import { photoRequirements } from '../lib/listing-rules.js';

process.env.BANK_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
const flat = (g) => g.sections().flatMap((s) => [s.h, ...s.body.flatMap((b) => {
  if (typeof b === 'string') return [b];
  if (b.list) return b.list; if (b.steps) return b.steps; if (b.checklist) return b.checklist;
  if (b.table) return [...b.table.head, ...b.table.rows.flat()];
  return [];
})]).join('\n');
const text = (slug) => flat(GUIDE_BY_SLUG[slug]);

suite('seller guides — accurate, and tied to the real rules');

test('three guides, each complete and renderable', () => {
  equal(GUIDES.map((g) => g.slug).join(), 'getting-started,photo-shot-guide,packing-and-handover');
  for (const g of GUIDES) {
    assert(g.title && g.summary, `${g.slug} has a title and summary`);
    assert(g.sections().length >= 4, `${g.slug} has real content`);
    assert(!/undefined|NaN|\[object/.test(flat(g)), `${g.slug} has no broken interpolation`);
  }
  assert(GUIDE_BY_SLUG['packing-and-handover'].printable, 'the packing checklist prints');
});

test('the numbers in the guides are the enforced numbers', () => {
  const gs = text('getting-started');
  assert(gs.includes(`${ACCEPT_HOURS} hours`) && gs.includes(`${READY_HOURS} hours`), 'the two clocks');
  assert(gs.includes(`${STRIKE_LIMIT} restricts`), 'the strike limit');
  assert(gs.includes(`$${MIN_PAYOUT_CENTS / 100}`) && gs.includes(`${BANK_COOLING_DAYS} days`), 'minimum payout and bank wait');
  for (const d of Object.values(HOLD_DAYS_BY_TIER)) assert(gs.includes(`${d} days`), `hold of ${d} days`);
  const used = photoRequirements('Refurbished');
  assert(gs.includes(`at least ${used.minPublic}`) && text('photo-shot-guide').includes(`at least ${used.minPublic} photos`), 'photo count');
  const pk = text('packing-and-handover');
  assert(pk.includes(`${READY_HOURS} hours`) && pk.includes(`${WARRANTY_MONTHS}-month`), 'ready clock and warranty');
  for (const c of CARRIERS) assert(pk.includes(c), `carrier ${c}`);
});

test('a guide describes only what the system does today', () => {
  const everything = GUIDES.map(flat).join('\n') + '\n' + POLICIES.map((p) => p.sections().map((s) => [s.h, ...s.body.map((b) => (typeof b === 'string' ? b : JSON.stringify(b)))].join(' ')).join(' ')).join('\n');
  for (const phrase of [
    "sign on the driver", "signed on the driver", 'Ask Bargain Bay to ship', 'live chat', 'instant payout', 'sponsored',
    'automatic pickup', 'barcode scanner'
  ]) assert(!everything.includes(phrase), `must not promise "${phrase}"`);
});

test('the practical advice is there: upright fridges, no tape on finishes, anti-tip brackets, drained lines', () => {
  const pk = text('packing-and-handover');
  assert(/UPRIGHT/.test(pk), 'fridges stay upright');
  assert(/never packing tape straight onto a stainless/.test(pk), 'no packing tape on stainless');
  assert(/anti-tip bracket/i.test(pk), 'anti-tip bracket');
  assert(/drained/i.test(pk), 'water drained');
  assert(/gas line capped by a qualified person/.test(pk), 'gas capped by a qualified person');
  assert(/SKU/.test(pk), 'SKU on the unit');
  assert(/rating plate/i.test(text('photo-shot-guide')), 'the rating-plate shot');
});

// ---------------------------------------------------------------------------------------------------
suite('onboarding — progress is computed from what is on record');

const base = { policiesPending: 8, bank: 'none', listings: 0, submitted: 0, onSale: 0, awaitingCheckin: 0, inReview: 0, delivered: 0, openOrders: 0, paid: 0 };

test('a brand-new seller is at step 1 of 7', () => {
  const o = onboardingSteps(base);
  equal(o.total, 7); equal(o.done, 0); equal(o.complete, false);
  equal(o.next.key, 'policies');
  assert(/8 still to accept/.test(o.steps[0].note), 'says how many');
});

test('steps complete in order and `next` moves with them', () => {
  let o = onboardingSteps({ ...base, policiesPending: 0 });
  equal(o.done, 1); equal(o.next.key, 'bank');
  o = onboardingSteps({ ...base, policiesPending: 0, bank: 'pending' });
  equal(o.done, 1); assert(/we are verifying/.test(o.steps[1].note), 'a pending bank account is not done');
  o = onboardingSteps({ ...base, policiesPending: 0, bank: 'verified', listings: 2 });
  equal(o.done, 3); equal(o.next.key, 'submitted'); assert(/draft is waiting/.test(o.steps[3].note), 'draft nudge');
  o = onboardingSteps({ ...base, policiesPending: 0, bank: 'verified', listings: 1, submitted: 1, awaitingCheckin: 1 });
  equal(o.next.key, 'live'); assert(/bring it to our warehouse/.test(o.steps[4].note), 'Lane A nudge');
  o = onboardingSteps({ ...base, policiesPending: 0, bank: 'verified', listings: 1, submitted: 1, onSale: 1, delivered: 1, paid: 1 });
  equal(o.complete, true); equal(o.next, null);
});

test('against a real database: it follows policies, banking, listings, orders and payouts', async () => {
  const { done } = await withTestDb();
  try {
    const v = await createApplication({ legalName: 'Alpha', contactEmail: 'a@example.com' });
    await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
    let p = await onboardingProgress(v.id);
    equal(p.done, 0); equal(p.next.key, 'policies');

    await acceptPolicies(v.id, { role: 'owner', by: 'o@example.com', accepting: requiredPolicies().map((x) => ({ policy: x.slug, version: x.version })) });
    p = await onboardingProgress(v.id); equal(p.done, 1); equal(p.next.key, 'bank');

    const b = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o@example.com' }, { holderName: 'Alpha', institution: '004', transit: '12345', account: '1234567' });
    equal((await onboardingState(v.id)).bank, 'pending');
    equal((await onboardingProgress(v.id)).done, 1);                              // submitted is not verified
    await verifyBankAccount(b.id, { by: 'admin', how: 'void_cheque', nameMatched: true });
    equal((await onboardingState(v.id)).bank, 'verified');

    await query(`INSERT INTO marketplace_listings (sku, vendor_id, lane, status) VALUES ('MP-1-0001',$1,'A','draft')`, [v.id]);
    p = await onboardingProgress(v.id); equal(p.done, 3); equal(p.next.key, 'submitted');
    await query(`UPDATE marketplace_listings SET status = 'awaiting_checkin' WHERE vendor_id = $1`, [v.id]);
    p = await onboardingProgress(v.id); equal(p.next.key, 'live');
    await query(`UPDATE marketplace_listings SET status = 'live' WHERE vendor_id = $1`, [v.id]);
    p = await onboardingProgress(v.id); equal(p.done, 5); equal(p.next.key, 'order');
    // another seller's progress never leaks into this one
    const other = await createApplication({ legalName: 'Bravo', contactEmail: 'b@example.com' });
    await decideApplication(other.id, { approve: true, by: 's', hstStatus: 'registered' });
    equal((await onboardingProgress(other.id)).done, 0);
  } finally { done(); }
});
