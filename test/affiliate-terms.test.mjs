// The affiliate agreement an applicant scrolls through and accepts.
import { createHash } from 'node:crypto';
import { suite, test, assert, equal } from './_harness.mjs';
import { AFFILIATE_TERMS, AFFILIATE_TERMS_VERSION, affiliateTermsText } from '../lib/affiliate-terms.js';
import { AFFILIATE_DEFAULT_PCT, AFFILIATE_HOLD_DAYS, AFFILIATE_MIN_PAYOUT } from '../lib/commission-rules.js';

// version -> sha256 of affiliateTermsText(). CHANGING THE WORDING MEANS A NEW VERSION (so everybody
// accepts the new text) AND A NEW LINE HERE. The old lines stay: they record what each version said.
const PINNED = {
  '2026-10-27': '1199130cac8f7f32c8fa24dcf4a6794b34534cafd8a7703ce72f5c3899ae572a'
};

suite('affiliate agreement');
test('THE WORDING CANNOT CHANGE WITHOUT THE VERSION CHANGING', () => {
  const hash = createHash('sha256').update(affiliateTermsText()).digest('hex');
  assert(PINNED[AFFILIATE_TERMS_VERSION], `version ${AFFILIATE_TERMS_VERSION} has no pinned hash: add it`);
  equal(hash, PINNED[AFFILIATE_TERMS_VERSION], 'the agreement text changed: bump AFFILIATE_TERMS_VERSION and pin the new hash');
});
test('every figure in the agreement is the one the system applies', () => {
  const t = affiliateTermsText();
  assert(t.includes(`${AFFILIATE_DEFAULT_PCT}% of the goods`), 'the commission rate');
  assert(t.includes(`${AFFILIATE_HOLD_DAYS} days have passed since delivery`), 'the return window');
  assert(t.includes(`reaches $${AFFILIATE_MIN_PAYOUT}`), 'the payout minimum');
  assert(t.includes('$500.00'), 'the $10,000 example pays $500');
});
test('it has no blanks to fill and no signature block: acceptance is the button', () => {
  const t = affiliateTermsText();
  assert(!/\[[A-Z][^\]]*\]/.test(t), 'a [Placeholder] left in the text');
  assert(!/signature/i.test(t));
  assert(AFFILIATE_TERMS.length >= 8);
});
