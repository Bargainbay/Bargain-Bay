// Sales Hub phase 2 — rep holds, the services catalog, and who may see a cost.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { holdForRep, releaseRepHold, listRepHolds, MAX_HOLD_HOURS } from '../lib/rep-holds.js';
import { unavailableSkus, expireReservations } from '../lib/reservations.js';
import { listServices, saveService, addStarterServices, costsForSkus, STARTER_SERVICES } from '../lib/sales-services.js';

const john = { email: 'john@rssolutions.ca', admin: false };
const sam = { email: 'sam@rssolutions.ca', admin: false };
const owner = { email: 'owner@rssolutions.ca', admin: true };
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };

async function seedUnit(sku, cost = 900) {
  await query(`INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ($1,'LG','LF25',$2,1200,$3,true)`, [sku, `Fridge ${sku}`, cost]);
}

suite('rep holds');

test('a hold takes the unit off sale, is capped at 48 hours, and carries who placed it', async () => {
  const { done } = await withTestDb();
  try {
    await seedUnit('U1');
    const r = await holdForRep('u1', { hours: 500, note: 'Pat is deciding' }, john);
    equal(r.hours, MAX_HOLD_HOURS); equal(r.sku, 'U1');
    assert((await unavailableSkus(['U1'])).has('U1'), 'the storefront now treats it as unavailable');
    const { rows } = await query(`SELECT held_by, order_id, expires_at > now() + interval '47 hours' AS long_enough, expires_at < now() + interval '49 hours' AS capped FROM reservations WHERE sku='U1'`);
    equal(rows[0].held_by, 'john@rssolutions.ca'); equal(rows[0].order_id, null);
    assert(rows[0].long_enough && rows[0].capped);
  } finally { await done(); }
});

test('a held, unknown or sold unit cannot be held again', async () => {
  const { done } = await withTestDb();
  try {
    await seedUnit('U1'); await seedUnit('U2');
    await holdForRep('U1', {}, john);
    assert(await rejects(() => holdForRep('U1', {}, sam), 'held'), 'a second rep is refused');
    assert(await rejects(() => holdForRep('NOPE', {}, john), 'unavailable'));
    await query(`UPDATE products SET sold_at = now() WHERE sku='U2'`);
    assert(await rejects(() => holdForRep('U2', {}, john), 'unavailable'));
  } finally { await done(); }
});

test('a rep releases only their own hold; an admin any; an order reservation is never touched', async () => {
  const { done } = await withTestDb();
  try {
    await seedUnit('U1'); await seedUnit('U2');
    await holdForRep('U1', {}, john);
    assert(await rejects(() => releaseRepHold('U1', sam), 'notfound'));
    equal((await listRepHolds(sam)).length, 0); equal((await listRepHolds(john)).length, 1); equal((await listRepHolds(owner)).length, 1);
    await query(`INSERT INTO reservations (sku, order_id, expires_at) VALUES ('U2', 42, now() + interval '1 day')`);
    assert(await rejects(() => releaseRepHold('U2', owner), 'notfound'), 'an order hold is not a rep hold');
    await releaseRepHold('U1', owner);
    assert(!(await unavailableSkus(['U1'])).has('U1'));
    assert((await unavailableSkus(['U2'])).has('U2'));
  } finally { await done(); }
});

test('an expired hold stops blocking and is swept; the unit can be held again', async () => {
  const { done } = await withTestDb();
  try {
    await seedUnit('U1');
    await holdForRep('U1', {}, john);
    await query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE sku='U1'`);
    assert(!(await unavailableSkus(['U1'])).has('U1'));
    await holdForRep('U1', {}, sam);  // steals only because it had expired
    equal((await listRepHolds(sam)).length, 1);
    await query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE sku='U1'`);
    await expireReservations();
    equal((await query(`SELECT count(*)::int AS n FROM reservations`)).rows[0].n, 0);
  } finally { await done(); }
});

suite('services catalog');

test('a service saves with its internal cost; a blank cost stays NULL (not zero)', async () => {
  const { done } = await withTestDb();
  try {
    await saveService({ name: 'Delivery – Zone A', defaultPrice: '95', internalCost: '75', costBasis: 'order', side: 'rs' });
    await saveService({ name: 'Installation', defaultPrice: '', internalCost: '', costBasis: 'appliance' });
    const list = await listServices();
    const del = list.find((s) => s.name.startsWith('Delivery'));
    equal(del.defaultPrice, 95); equal(del.internalCost, 75);
    equal(list.find((s) => s.name === 'Installation').internalCost, null);
    equal((await listServices({ withCost: false })).every((s) => s.internalCost === null), true, 'cost can be stripped');
    assert(await rejects(() => saveService({ name: 'Bad', internalCost: 'abc' })));
    assert(await rejects(() => saveService({ name: '' })));
  } finally { await done(); }
});

test('the starting list adds what is missing and never overwrites an edit', async () => {
  const { done } = await withTestDb();
  try {
    const first = await addStarterServices();
    equal(first.added, STARTER_SERVICES.length);
    const del = (await listServices()).find((s) => s.name === 'Delivery – Zone A');
    await saveService({ ...del, defaultPrice: '99' });
    equal((await addStarterServices()).added, 0);
    equal((await listServices()).find((s) => s.name === 'Delivery – Zone A').defaultPrice, 99);
    const haul = (await listServices()).find((s) => s.name === 'Haul-away');
    equal(haul.internalCost, 0); equal(haul.costBasis, 'unit');
  } finally { await done(); }
});

test('costs come back by SKU, case-insensitively; an unknown SKU is null', async () => {
  const { done } = await withTestDb();
  try {
    await seedUnit('AB-1', 1650);
    const c = await costsForSkus(['ab-1', 'zz-9']);
    equal(c['AB-1'], 1650); equal(c['ZZ-9'], null);
  } finally { await done(); }
});
