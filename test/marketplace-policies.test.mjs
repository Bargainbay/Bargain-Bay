// The marketplace's written rules: every number in them is the number the code enforces, drafts are not
// presented as in force, and a seller cannot list until the owner has accepted the current version.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { createApplication, decideApplication } from '../lib/vendors.js';
import { createDraft } from '../lib/marketplace-listings.js';
import { POLICIES, POLICY_BY_SLUG, requiredPolicies, publishedPolicies, isPublished } from '../lib/marketplace-policies.js';
import { pendingPolicies, acceptPolicies, acceptanceStatus, mustAccept } from '../lib/policy-acceptance.js';
import {
  ACCEPT_HOURS, READY_HOURS, STRIKE_LIMIT, STRIKE_REVIEW_DAYS, DEFAULT_COMMISSION_BPS, WARRANTY_MONTHS,
  WARRANTY_RESERVE_BPS, WARRANTY_RESERVE_MONTHS, LANE_C_VENDOR_SHARE_BPS, HOLD_DAYS_BY_TIER, MIN_PAYOUT_CENTS,
  BANK_COOLING_DAYS, STRIKE_REASONS
} from '../lib/marketplace-rules.js';
import { REJECT_REASONS, LISTING_CONDITIONS } from '../lib/listing-rules.js';

const flat = (p) => p.sections().flatMap((s) => [s.h, ...s.body.flatMap((b) => {
  if (typeof b === 'string') return [b];
  if (b.list) return b.list;
  if (b.table) return [...b.table.head, ...b.table.rows.flat()];
  return [];
})]).join('\n');
const all = (slug) => flat(POLICY_BY_SLUG[slug]);
const accepting = () => requiredPolicies().map((p) => ({ policy: p.slug, version: p.version }));

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}

suite('marketplace policies — the written rules match the enforced ones');

test('every document is complete, uniquely named and renderable', () => {
  const slugs = new Set();
  for (const p of POLICIES) {
    assert(!slugs.has(p.slug), `duplicate slug ${p.slug}`); slugs.add(p.slug);
    assert(p.title && p.summary && p.version > 0, `${p.slug} has a title, summary and version`);
    assert(['vendors', 'customers', 'both'].includes(p.audience), `${p.slug} audience`);
    assert(['published', 'draft'].includes(p.status), `${p.slug} status`);
    const secs = p.sections();
    assert(secs.length >= 3, `${p.slug} has real content`);
    for (const s of secs) assert(s.h && s.body.length, `${p.slug}/${s.h} has a heading and a body`);
    assert(!/undefined|NaN|\[object/.test(flat(p)), `${p.slug} has no broken interpolation`);
  }
});

test('the legal and customer-facing documents are DRAFTS and nobody is asked to accept a draft', () => {
  for (const slug of ['vendor-agreement', 'ip-takedown', 'buyer-protection', 'marketplace-terms']) {
    assert(!isPublished(POLICY_BY_SLUG[slug]), `${slug} is a draft until reviewed`);
  }
  assert(requiredPolicies().every(isPublished), 'only published documents are required');
  assert(requiredPolicies().length >= 7 && !requiredPolicies().some((p) => p.slug === 'vendor-agreement'), 'the operational rules are required, the draft agreement is not yet');
  assert(publishedPolicies().length + 4 === POLICIES.length, 'exactly the four drafts');
});

test('THE NUMBERS ARE THE ENFORCED NUMBERS', () => {
  const fd = all('fulfilment-delivery');
  assert(fd.includes(`${ACCEPT_HOURS} hours to accept`) && fd.includes(`${READY_HOURS} hours to be ready`), 'the two clocks');
  assert(fd.includes(`${LANE_C_VENDOR_SHARE_BPS / 100}%`), 'the Lane C share');
  const en = all('enforcement-appeals');
  assert(en.includes(`${STRIKE_LIMIT} strikes`) && en.includes(`${STRIKE_REVIEW_DAYS} days`), 'strike limit and review period');
  for (const r of Object.values(STRIKE_REASONS)) assert(en.includes(r), `strike reason "${r}" is listed`);
  for (const [t, d] of Object.entries(HOLD_DAYS_BY_TIER)) assert(en.includes(`${d} days after delivery`) && all('fees-payouts').includes(`${d} days after delivery`), `tier ${t} hold`);
  const fp = all('fees-payouts');
  assert(fp.includes(`${DEFAULT_COMMISSION_BPS / 100}%`), 'commission');
  assert(fp.includes(`${WARRANTY_RESERVE_BPS / 100}%`) && fp.includes(`${WARRANTY_RESERVE_MONTHS} months`), 'warranty reserve');
  assert(fp.includes(`$${MIN_PAYOUT_CENTS / 100}`), 'minimum payout');
  assert(fp.includes(`${BANK_COOLING_DAYS} days`), 'bank cooling-off');
  assert(all('returns-warranty').includes(`${WARRANTY_MONTHS} months`), 'warranty months');
  assert(all('listing-photo-standards').includes(String(6)), 'six photos for a used unit');
  for (const r of Object.values(REJECT_REASONS)) assert(all('listing-photo-standards').includes(r), `reject reason "${r}"`);
  for (const c of LISTING_CONDITIONS) assert(all('condition-grading').includes(c), `condition ${c}`);
});

test('nothing promises a feature that is not built', () => {
  const text = POLICIES.map(flat).join('\n');
  for (const phrase of ['Ask Bargain Bay to ship this', 'live chat', 'instant payout', 'same-day payout', 'sponsored']) {
    assert(!text.includes(phrase), `must not mention "${phrase}"`);
  }
});

test('the rules that matter most are said in so many words', () => {
  assert(/never as new/i.test(all('condition-grading')) || /not as new/i.test(all('condition-grading')), 'a used unit is never new');
  assert(/ends your account/i.test(all('seller-code-of-conduct')), 'passing a used unit off as new ends the account');
  assert(/no default/i.test(all('fulfilment-delivery')), 'insurance has no default');
  assert(/strike, every time/i.test(all('fulfilment-delivery')), 'cancelling is a strike every time');
  assert(/never kept|re-saved/i.test(all('listing-photo-standards')), 'photos are re-encoded');
});

// ---------------------------------------------------------------------------------------------------
suite('policy acceptance — the owner accepts, the current version, before anything new is listed');

async function vendor(name = 'Alpha') {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  return v;
}

test('a new seller has everything to accept and cannot list until they do', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor();
    equal((await pendingPolicies(v.id)).length, requiredPolicies().length);
    await rejects(() => createDraft(v.id, {}), /accept our marketplace policies/);
    await rejects(() => mustAccept(v.id), /Seller Code of Conduct/);
    await acceptPolicies(v.id, { role: 'owner', by: 'owner@example.com', ip: '1.2.3.4', accepting: accepting() });
    equal((await pendingPolicies(v.id)).length, 0);
    assert((await createDraft(v.id, {})).sku, 'now they can start a listing');
  } finally { done(); }
});

test('only the OWNER can accept for the business', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor();
    await rejects(() => acceptPolicies(v.id, { role: 'staff', by: 'staff@example.com', accepting: accepting() }), /owner/);
    equal((await pendingPolicies(v.id)).length, requiredPolicies().length);
  } finally { done(); }
});

test('they must accept what they were shown: a stale version, an unknown policy or a partial set is refused', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor();
    const stale = accepting(); stale[0] = { ...stale[0], version: stale[0].version + 1 };
    await rejects(() => acceptPolicies(v.id, { role: 'owner', by: 'o@example.com', accepting: stale }), /changed since you opened/);
    await rejects(() => acceptPolicies(v.id, { role: 'owner', by: 'o@example.com', accepting: [{ policy: 'made-up', version: 1 }] }), /not one you need/);
    await rejects(() => acceptPolicies(v.id, { role: 'owner', by: 'o@example.com', accepting: accepting().slice(1) }), /also need to accept/);
    await rejects(() => acceptPolicies(v.id, { role: 'owner', accepting: accepting() }), /Who/);
    equal((await pendingPolicies(v.id)).length, requiredPolicies().length);      // none of that recorded anything
  } finally { done(); }
});

test('accepting is recorded with who, when and from where, and accepting twice changes nothing', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor();
    await acceptPolicies(v.id, { role: 'owner', by: 'owner@example.com', ip: '9.9.9.9', accepting: accepting() });
    const again = await acceptPolicies(v.id, { role: 'owner', by: 'owner@example.com', accepting: [] });
    equal(again.accepted, 0);
    const s = await acceptanceStatus(v.id);
    equal(s.accepted.length, requiredPolicies().length); equal(s.pending.length, 0);
    const { rows } = await client.query('SELECT ip, accepted_by FROM policy_acceptances WHERE vendor_id = $1 LIMIT 1', [v.id]);
    equal(rows[0].ip, '9.9.9.9'); equal(rows[0].accepted_by, 'owner@example.com');
    const ev = await client.query(`SELECT 1 FROM vendor_events WHERE vendor_id = $1 AND event = 'policies_accepted'`, [v.id]);
    equal(ev.rows.length, 1);
  } finally { done(); }
});

test('a NEW VERSION asks again: acceptance of an older version does not count', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor();
    await acceptPolicies(v.id, { role: 'owner', by: 'o@example.com', accepting: accepting() });
    const p = requiredPolicies()[0];
    // Pretend the document moved on: what they accepted is now a different version from the current one.
    await client.query('UPDATE policy_acceptances SET version = version + 100 WHERE vendor_id = $1 AND policy = $2', [v.id, p.slug]);
    const pending = await pendingPolicies(v.id);
    equal(pending.length, 1); equal(pending[0].slug, p.slug);
    await rejects(() => createDraft(v.id, {}), new RegExp(p.title));
  } finally { done(); }
});

test('not accepting never blocks an order that is already paid for — only new listings', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor();
    const src = (await import('node:fs')).readFileSync(new URL('../lib/vendor-orders.js', import.meta.url), 'utf8');
    assert(!/mustAccept/.test(src), 'vendor-orders does not gate on acceptance');
    void v;
  } finally { done(); }
});
