// A partner login's sign-ins are recorded (and the first one emails the owner); an ordinary customer is never recorded.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { savePartner, addTeamMember } from '../lib/referral-partners.js';
import { recordPartnerSignIn, signInsFor } from '../lib/partner-signin.js';
import { partnerPortfolio } from '../lib/partner-portfolio.js';

suite('partner sign-ins');

test('first and later sign-ins are counted for a partner and a generator, never for a customer; the portfolio shows who has not signed in', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: 'aljo@aljo.ca', name: 'Aljo', pct: 15 }, 'owner@x.ca');
    await addTeamMember('aljo@aljo.ca', { email: 'anna@aljo.ca', name: 'Anna', role: 'affiliate' }, 'owner@x.ca');
    let pf = await partnerPortfolio();
    assert(pf.orgs[0].flags.some((f) => /not signed in/.test(f.text)), 'flagged as not signed in yet');
    equal(pf.orgs[0].signedIn, null);
    await recordPartnerSignIn('Aljo@aljo.ca');
    await recordPartnerSignIn('aljo@aljo.ca');
    await recordPartnerSignIn('anna@aljo.ca');
    await recordPartnerSignIn('shopper@x.ca');
    const m = await signInsFor(['aljo@aljo.ca', 'anna@aljo.ca', 'shopper@x.ca']);
    equal(m.get('aljo@aljo.ca').n, 2);
    equal(m.get('anna@aljo.ca').n, 1);
    equal(m.has('shopper@x.ca'), false);
    pf = await partnerPortfolio();
    assert(!pf.orgs[0].flags.some((f) => /not signed in/.test(f.text)), 'flag gone after sign-in');
    equal(pf.orgs[0].signedIn.n, 2);
    equal(pf.orgs[0].generatorRows.find((g) => g.email === 'anna@aljo.ca').signedIn.n, 1);
  } finally { done(); }
});
