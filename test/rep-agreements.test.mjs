// The rep's employment + confidentiality agreements: built from the tiers in force, closed until the company
// has filled its blanks and opened signing, signed with the text the rep saw, kept as a copy.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { setSetting } from '../lib/settings.js';
import { DEFAULT_TIERS } from '../lib/commission-tiers.js';
import {
  employmentSections, confidentialitySections, sectionsText, unresolvedItems, tierLines, tierExample, FIELD_DEFS, EMPLOYMENT_TERMS_VERSION
} from '../lib/employment-terms.js';
import { agreementState, signAgreement, copyFor, countersign, signatureList, AgreementError } from '../lib/rep-agreements.js';

const FIELDS = { registeredAddress: '1135 Squires Beach Rd, Pickering, ON', hours: 'Monday to Friday, 9:00 a.m. to 5:00 p.m.', afterDays: '30', benefits: 'None.', mileage: '$0.70 per km' };
const john = { email: 'john@rssolutions.ca', name: 'John Tobias' };
const boss = { email: 'boss@example.test', name: 'Boss' };

suite('rep agreement — the commission section comes from the tiers');

test('the default tiers are written out exactly, and the example sits clear of every line', () => {
  equal(tierLines(DEFAULT_TIERS), [
    '$5,000 or less: no commission',
    "Over $5,000: 1% of the day's total", "Over $10,000: 1.5% of the day's total", "Over $20,000: 2% of the day's total", "Over $30,000: 3% of the day's total"
  ]);
  assert(tierExample(DEFAULT_TIERS).includes('$35,000') && tierExample(DEFAULT_TIERS).includes('$1,050'), tierExample(DEFAULT_TIERS));
});
test('an inclusive tier is written "or more"', () => {
  assert(tierLines([{ over: 5000, pct: 1, inclusive: true }])[1] === "$5,000 or more: 1% of the day's total");
});
test('the old tiers (2% over $30,000, 1% over $10,000) are nowhere in the signed text', () => {
  const t = sectionsText(employmentSections({ fields: FIELDS }));
  assert(!/Over \$10,000: 1%/.test(t) && !/Over \$30,000: 2%/.test(t) && !/earns \$600/.test(t));
  assert(/Over \$30,000: 3%/.test(t));
});

suite('rep agreement — blanks block signing');

test('every decision the owner has not made is a visible bracket', () => {
  const left = unresolvedItems(employmentSections({}), confidentialitySections({}));
  equal(left.length, FIELD_DEFS.length, left.join(' | '));
});
test('with every detail filled in there are no brackets left (and the lawyer note is not in the text)', () => {
  const t = sectionsText(employmentSections({ fields: FIELDS }));
  equal(unresolvedItems(employmentSections({ fields: FIELDS }), confidentialitySections({})), []);
  assert(!/lawyer to confirm/i.test(t));
});

suite('rep agreement — signing');

async function open() {
  await setSetting('rep_agreement_fields', FIELDS);
  await setSetting('rep_agreement_open', true);
}

test('signing is refused while closed, then works once opened, and stores the text that was signed', async () => {
  const { done } = await withTestDb();
  try {
    let st = await agreementState(john.email);
    equal(st.canSign, false);
    const attempt = () => signAgreement(john, { typedName: 'John Tobias', address: '12 Main St, Toronto', agreed: true, hash: st.hash });
    let err; try { await attempt(); } catch (e) { err = e; }
    assert(err instanceof AgreementError && err.code === 'closed', 'closed');
    await open();
    st = await agreementState(john.email);
    equal(st.canSign, true);
    const r = await signAgreement(john, { typedName: 'John Tobias', address: '12 Main St, Toronto', agreed: true, hash: st.hash, ip: '1.2.3.4' });
    equal(r.ok, true);
    const c = await copyFor(john.email);
    equal(c.signedName, 'John Tobias'); equal(c.docs.length, 2); equal(c.countersigned, null);
    assert(c.docs[0].text.includes('John Tobias, 12 Main St, Toronto') && c.docs[0].text.includes("Over $30,000: 3% of the day's total"));
    equal((await agreementState(john.email)).signed.name, 'John Tobias');
  } finally { done(); }
});

test('a name, an address and the tick are all required; a changed text (stale hash) is refused', async () => {
  const { done } = await withTestDb();
  try {
    await open();
    const st = await agreementState(john.email);
    const base = { typedName: 'John Tobias', address: '12 Main St, Toronto', agreed: true, hash: st.hash };
    for (const bad of [{ typedName: 'John' }, { address: '12' }, { agreed: false }, { hash: 'nope' }]) {
      let err; try { await signAgreement(john, { ...base, ...bad }); } catch (e) { err = e; }
      assert(err instanceof AgreementError, `refused ${JSON.stringify(bad)}`);
    }
    equal((await query('SELECT count(*)::int AS n FROM rep_agreements')).rows[0].n, 0, 'nothing written');
  } finally { done(); }
});

test('a changed commission tier changes the text, so the old page cannot sign it', async () => {
  const { done } = await withTestDb();
  try {
    await open();
    const st = await agreementState(john.email);
    await setSetting('rep_commission_tiers', [{ over: 4000, pct: 1 }]);
    let err; try { await signAgreement(john, { typedName: 'John Tobias', address: '12 Main St, Toronto', agreed: true, hash: st.hash }); } catch (e) { err = e; }
    assert(err && err.code === 'stale', 'stale');
  } finally { done(); }
});

test('one signature per version; the company countersigns later; the list shows both', async () => {
  const { done } = await withTestDb();
  try {
    await open();
    const st = await agreementState(john.email);
    const sign = () => signAgreement(john, { typedName: 'John Tobias', address: '12 Main St, Toronto', agreed: true, hash: st.hash });
    await sign();
    let err; try { await sign(); } catch (e) { err = e; }
    assert(err && err.code === 'already', 'second signature refused');
    equal((await signatureList())[0].countersigned, 0);
    await countersign(boss, john.email, 'Saieasan Satchithananthan');
    const c = await copyFor(john.email);
    equal(c.countersigned.name, 'Saieasan Satchithananthan');
    let again; try { await countersign(boss, john.email, 'Saieasan Satchithananthan'); } catch (e) { again = e; }
    assert(again instanceof AgreementError, 'cannot countersign twice');
    equal(c.version, EMPLOYMENT_TERMS_VERSION);
  } finally { done(); }
});
