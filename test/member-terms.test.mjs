// The Member Agreement a business accepts when it asks for member pricing.
import { createHash } from 'node:crypto';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { MEMBER_TERMS, MEMBER_TERMS_VERSION, memberTermsText } from '../lib/member-terms.js';
import { requestMembership, getMembership } from '../lib/members.js';

// version -> sha256 of memberTermsText(). CHANGING THE WORDING MEANS A NEW VERSION AND A NEW LINE HERE.
const PINNED = { '2026-10-27': '1db4ec3a9336098e60d090d52b1fd0bfe16cfdee7b584eea2b720cc8e8287b1a' };

suite('member agreement');
test('THE WORDING CANNOT CHANGE WITHOUT THE VERSION CHANGING', () => {
  const hash = createHash('sha256').update(memberTermsText()).digest('hex');
  assert(PINNED[MEMBER_TERMS_VERSION], `version ${MEMBER_TERMS_VERSION} has no pinned hash: add it`);
  equal(hash, PINNED[MEMBER_TERMS_VERSION], 'the agreement text changed: bump MEMBER_TERMS_VERSION and pin the new hash');
});
test('it promises no discount figure and leaves no blanks or signature block', () => {
  const t = memberTermsText();
  assert(!/\d+\s?%/.test(t), 'a percentage in the member agreement would be a promise the pricing code does not make');
  assert(!/\[[A-Z][^\]]*\]/.test(t) && !/signature/i.test(t));
  assert(MEMBER_TERMS.length >= 8);
});
test('asking for member access records the version and time accepted', async () => {
  const { done } = await withTestDb();
  try {
    const { rows } = await query(`INSERT INTO users (email, name, password_hash) VALUES ('biz@x.ca','Biz','x') RETURNING id`);
    await requestMembership(rows[0].id, 'Acme Property Mgmt', 'about 10 a month', { termsVersion: MEMBER_TERMS_VERSION });
    const m = await getMembership(rows[0].id);
    equal(m.member_status, 'pending');
    const r = (await query('SELECT member_terms_version, member_terms_accepted_at FROM users WHERE id = $1', [rows[0].id])).rows[0];
    equal(r.member_terms_version, MEMBER_TERMS_VERSION);
    assert(r.member_terms_accepted_at, 'time recorded');
  } finally { done(); }
});
