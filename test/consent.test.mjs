// lib/consent.js — who we may lawfully market to.
//
// The property that matters is that this gate FAILS CLOSED. Every other guard
// in this codebase degrades open, because losing a real sale is worse than
// admitting a junk one. This one is inverted on purpose: the cost of wrongly
// sending is a statutory penalty and a person who already asked us to stop, and
// the cost of wrongly not sending is one campaign that goes tomorrow instead.
import { suite, test, assert, equal } from './_harness.mjs';
import {
  normEmail, normPhone, identityFor, filterAudience, consentStatus,
  IMPLIED_PURCHASE_MONTHS, IMPLIED_INQUIRY_MONTHS, BASIS_LABEL
} from '../lib/consent.js';
import { unsubToken, verifyUnsubToken } from '../lib/links.js';

// No database: every lookup finds nothing. That is the failure mode under test.
delete process.env.POSTGRES_URL;
delete process.env.SENTRY_DSN;
process.env.AUTH_SECRET = 'test-secret-for-link-tokens';

suite('lib/consent — identity is one spelling per person');

test('email is trimmed and lowercased', () => {
  // A withdrawal recorded against "Bob@Example.COM " has to stop mail to
  // "bob@example.com", or the suppression list has holes in it.
  equal(normEmail('  Bob@Example.COM '), 'bob@example.com');
  equal(normEmail(''), null);
  equal(normEmail(null), null);
});

test('phone normalises to E.164, however it was typed', () => {
  const want = '+14374888549';
  equal(normPhone('4374888549'), want, 'ten digits');
  equal(normPhone('(437) 488-8549'), want, 'formatted');
  equal(normPhone('1-437-488-8549'), want, 'with country code');
  equal(normPhone('+1 437 488 8549'), want, 'already E.164');
  equal(normPhone(''), null);
});

test('identityFor picks the field the channel actually uses', () => {
  equal(identityFor('email', 'A@B.ca'), 'a@b.ca');
  equal(identityFor('sms', '(437) 488-8549'), '+14374888549');
});

suite('lib/consent — the gate fails closed');

test('with no consent record, nobody is allowed', async () => {
  const st = await consentStatus(['a@b.ca', 'c@d.ca'], 'email');
  equal(st.get('a@b.ca').allowed, false, 'no record is not consent');
  equal(st.get('a@b.ca').basis, 'none', 'and it says why');
});

test('filterAudience sends to nobody when nothing is on record', async () => {
  const gate = await filterAudience(
    [{ email: 'a@b.ca' }, { email: 'c@d.ca' }, { email: 'e@f.ca' }],
    'email'
  );
  equal(gate.allowed.length, 0, 'nothing sent');
  equal(gate.blocked.length, 3, 'all three held back');
  equal(gate.counts.noConsent, 3, 'counted as no-consent, not as withdrawn');
});

test('recipients with no address for the channel are counted separately', async () => {
  // "No phone number" and "asked us not to text them" are different facts and
  // the owner needs to see them apart — one is a data gap, one is a decision.
  const gate = await filterAudience(
    [{ email: 'a@b.ca', phone: null }, { email: 'c@d.ca', phone: '4374888549' }],
    'sms'
  );
  equal(gate.counts.noValue, 1, 'one had no phone number');
  equal(gate.counts.total, 2, 'total still counts everybody');
});

test('an empty recipient list is not an error', async () => {
  const gate = await filterAudience([], 'email');
  equal(gate.allowed, []);
  equal(gate.counts.total, 0);
});

test('every exclusion reason has a human label', () => {
  for (const basis of ['express', 'implied_purchase', 'implied_inquiry', 'withdrawn', 'none']) {
    assert(BASIS_LABEL[basis], `${basis} needs a label the composer can print`);
  }
});

test('the statutory windows are the statutory windows', () => {
  // These are CASL's numbers for an existing business relationship, not
  // preferences. A test so that "let's try 36 months" has to be a decision.
  equal(IMPLIED_PURCHASE_MONTHS, 24, 'purchase implies consent for 24 months');
  equal(IMPLIED_INQUIRY_MONTHS, 6, 'an inquiry implies consent for 6 months');
});

suite('lib/consent — the unsubscribe link');

test('a token round-trips for the address it was minted for', () => {
  const t = unsubToken('bob@example.com');
  assert(t && t.length >= 16, 'token is substantial');
  assert(verifyUnsubToken('bob@example.com', t), 'verifies');
});

test('the token is case- and whitespace-insensitive, like the identity', () => {
  // The link is built from one spelling and may come back in another — mail
  // clients rewrite URLs, and people forward things.
  assert(verifyUnsubToken('  BOB@Example.com ', unsubToken('bob@example.com')),
    'same person, different spelling, same token');
});

test('you cannot unsubscribe somebody else by editing the URL', () => {
  const mine = unsubToken('bob@example.com');
  assert(!verifyUnsubToken('alice@example.com', mine), 'another address is refused');
  assert(!verifyUnsubToken('bob@example.com', 'deadbeef'), 'a made-up token is refused');
  assert(!verifyUnsubToken('bob@example.com', ''), 'an empty token is refused');
  assert(!verifyUnsubToken('bob@example.com', mine.slice(0, -1)), 'a truncated token is refused');
});
