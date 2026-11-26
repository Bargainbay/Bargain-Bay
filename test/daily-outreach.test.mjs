// The daily call list and the daily Black Friday email.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { createLead, listLeads } from '../lib/leads.js';
import { assignDailyLeads, saveDailyConfig, poolSize } from '../lib/lead-daily.js';
import { composeBfEmail, sendDailyBfEmail } from '../lib/bf-daily.js';

const owner = { email: 'owner@example.ca', name: 'Owner', admin: true };
const reps = ['one@example.ca', 'two@example.ca'];
const seed = async (n, extra = {}) => {
  for (let i = 0; i < n; i++) await createLead({ company: `Co ${extra.tag || ''}${i}`, phone: `416555${String((extra.base || 0) + i).padStart(4, '0')}`, segment: extra.segment || 'retailer', nextStep: extra.nextStep }, owner);
};

suite('daily call list');

test('does nothing until switched on', async () => {
  const { done } = await withTestDb();
  try {
    await seed(3);
    const r = await assignDailyLeads();
    equal(r.skipped, 'switched off'); equal(await poolSize(), 3);
  } finally { await done(); }
});

test('hands each rep their number once a day, best first, dealt in turn', async () => {
  const { done } = await withTestDb();
  try {
    await seed(4);
    await seed(4, { tag: 'pm', base: 100, segment: 'property_management', nextStep: 'Pickering. Cold list' });
    await saveDailyConfig({ enabled: true, perRep: 3, reps });
    const first = await assignDailyLeads();
    equal(first.assigned, { 'one@example.ca': 3, 'two@example.ca': 3 });
    equal(first.pool, 2); assert(first.low, 'a short pool is reported');
    const mine = await listLeads({}, { email: reps[0], admin: false });
    equal(mine.length, 3);
    equal(mine.filter((l) => l.segment === 'property_management').length, 2, 'property managers go first, shared');
    assert(mine.every((l) => l.next_step_at), 'due today');
    const again = await assignDailyLeads();
    equal(again.assigned, { 'one@example.ca': 0, 'two@example.ca': 0 });
  } finally { await done(); }
});

test('a partner lead, a lead with no phone and an owned lead are left alone', async () => {
  const { done } = await withTestDb();
  try {
    await seed(3);
    await query(`UPDATE leads SET partner_email = 'p@example.ca' WHERE company = 'Co 0'`);
    await query(`UPDATE leads SET phone = NULL, email = 'a@b.ca' WHERE company = 'Co 1'`);
    await query(`UPDATE leads SET owner_email = 'someone@example.ca' WHERE company = 'Co 2'`);
    await saveDailyConfig({ enabled: true, perRep: 5, reps });
    const r = await assignDailyLeads();
    equal(r.assigned, { 'one@example.ca': 0, 'two@example.ca': 0 });
  } finally { await done(); }
});

suite('daily Black Friday email');

const unit = (i, extra = {}) => ({ id: `U${i}`, make: 'LG', model: `M${i}`, category: ['Range', 'Refrigerator', 'Washer', 'Dryer', 'Dishwasher'][i % 5], price: 500 + i, compareAt: 1500, image: 'https://x/y.jpg', condition: 'New Open Box', clearanceNote: 'Black Friday', ...extra });

test('lists real units at their price, plain text, one link, and changes day to day', () => {
  const units = Array.from({ length: 12 }, (_, i) => unit(i));
  const a = composeBfEmail(units, '2026-11-26');
  const b = composeBfEmail(units, '2026-11-27');
  equal(a.count, 5);
  equal((a.message.match(/https?:\/\//g) || []).length, 1);
  assert(!/<[a-z]/i.test(a.message), 'no markup');
  assert(a.message !== b.message && a.subject !== b.subject);
  assert(composeBfEmail([], '2026-11-26') === null, 'nothing in stock, nothing to send');
  assert(composeBfEmail([unit(1, { condition: 'Refurbished' })], '2026-11-26') === null, 'refurbished is not in the sale');
});

test('sends nothing while switched off', async () => {
  const { done } = await withTestDb();
  try { equal((await sendDailyBfEmail({ today: '2026-11-27' })).skipped, 'switched off'); } finally { await done(); }
});
