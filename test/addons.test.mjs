// Installation and haul-away as add-ons to an online order (lib/addons.js), the owner's
// price overrides, and the real /api/checkout route end to end.
//
// What must hold: prices are the rate sheet; an add-on is only offered on a delivery order, on
// our own units, on the kind of appliance it is defined for; the SERVER prices it (a tampered
// price or an add-on that does not belong is dropped, never charged); add-ons carry HST, ride
// inside the order subtotal (so the inferred delivery fee stays $79), and reach dispatch as
// service lines that say "install" / "haul-away".
import { suite, test, assert, equal } from './_harness.mjs';
import { sharedCheckoutDb } from './shared-checkout-db.mjs';
import { query } from '../lib/db.js';
import { ADDONS, addonsFor, priceAddons, addonPrice, starterRowsFromAddons } from '../lib/addons.js';
import { loadAddonOverrides } from '../lib/addon-prices.js';
import { saveService, addStarterServices, listServices } from '../lib/sales-services.js';
import { isHaulAwayLine, isInstallLine } from '../lib/constants.js';
import { POST } from '../app/api/checkout/route.js';

const unit = (id, category, extra = {}) => ({ id, category, make: 'LG', model: 'X1', title: `${category} ${id}`, ...extra });
const fridge = unit('F1', 'Refrigerator');
const dw = unit('D1', 'Dishwasher');
const washer = unit('W1', 'Washer');
const range = unit('R1', 'Range');

suite('add-ons — the rate sheet, and who is offered what');

test('prices are the Delivery Rate Sheet 2026', () => {
  const p = Object.fromEntries(ADDONS.map((a) => [a.key, a.price]));
  equal(p, { haul_away: 20, laundry_install: 40, laundry_stack: 75, dishwasher_install: 120, wall_oven_install: 175,
    fridge_waterline_existing: 25, fridge_waterline_new: 150, gas_install: 250, otr_install: 125 });
});

test('every add-on is read by dispatch as an install or a haul-away', () => {
  for (const a of ADDONS) {
    const text = `${a.name} — x (SKU)`;
    assert(a.key === 'haul_away' ? isHaulAwayLine('service', text) : isInstallLine('service', text), a.key);
  }
});

test('offered by kind of appliance, and only on a delivery order', () => {
  const keys = (u, m = 'delivery') => addonsFor(u, { deliveryMethod: m }).map((a) => a.key).sort().join();
  equal(keys(dw), 'dishwasher_install,haul_away');
  equal(keys(fridge), 'fridge_waterline_existing,fridge_waterline_new,haul_away');
  equal(keys(washer), 'haul_away,laundry_install,laundry_stack');
  equal(keys(range), 'gas_install,haul_away');
  equal(keys(unit('T1', 'Television')), '', 'a TV is offered nothing');
  equal(keys(dw, 'pickup'), '', 'nothing on a pickup order');
});

test('a seller’s unit and a Vesta unit are never offered an install or a haul-away', () => {
  equal(addonsFor(unit('MP-1-0001', 'Dishwasher', { marketplace: true })).length, 0);
  equal(addonsFor(unit('VS-123', 'Dishwasher')).length, 0);
});

suite('add-ons — priced from scratch');

test('a valid selection is priced; wrong kind, unknown, duplicate and not-in-cart are dropped', () => {
  const r = priceAddons([
    { sku: 'D1', key: 'dishwasher_install' }, { sku: 'D1', key: 'haul_away' },
    { sku: 'F1', key: 'dishwasher_install' },      // not a fridge add-on
    { sku: 'D1', key: 'dishwasher_install' },      // duplicate
    { sku: 'D1', key: 'free_everything' },         // unknown
    { sku: 'GHOST', key: 'haul_away' }             // not in the cart
  ], [fridge, dw]);
  equal(r.total, 140); equal(r.lines.length, 2); equal(r.dropped.length, 4);
  assert(r.lines.every((l) => l.kind === 'service'));
});

test('two alternatives from one group are refused: waterline existing OR new, plain laundry OR stacking', () => {
  const a = priceAddons([{ sku: 'F1', key: 'fridge_waterline_existing' }, { sku: 'F1', key: 'fridge_waterline_new' }], [fridge]);
  equal(a.lines.length, 1); equal(a.total, 25);
  const b = priceAddons({ W1: ['laundry_install', 'laundry_stack'] }, [washer]);
  equal(b.lines.length, 1);
});

test('the owner can change a price or switch one off in the catalog; a missing row keeps the sheet price', () => {
  const hv = ADDONS.find((a) => a.key === 'haul_away');
  equal(addonPrice(hv, {}), 20);
  equal(addonPrice(hv, { 'Haul-away': { price: 35, active: true } }), 35);
  equal(addonPrice(hv, { 'Haul-away': { price: null, active: true } }), 20, 'a blank catalog price falls back to the sheet');
  equal(addonPrice(hv, { 'Haul-away': { price: 35, active: false } }), null);
  equal(addonsFor(dw, { priceOverrides: { 'Haul-away': { active: false } } }).map((a) => a.key).join(), 'dishwasher_install');
});

suite('add-ons — the catalog');

test('the starting list carries the rate sheet and a second press adds nothing and overwrites nothing', async () => {
  await sharedCheckoutDb();
  await query('DELETE FROM services');
  const first = await addStarterServices();
  assert(first.added >= ADDONS.length + 3);
  const list = await listServices();
  const get = (n) => list.find((s) => s.name === n);
  equal(get('Delivery – Zone B').defaultPrice, 140);
  equal(get('Haul-away').defaultPrice, 20); equal(get('Haul-away').internalCost, 20);
  equal(get('Dishwasher installation (basic, uninstall + install)').defaultPrice, 120);
  equal(get('Dishwasher installation (basic, uninstall + install)').internalCost, null, 'no invented cost');
  await saveService({ ...get('Haul-away'), defaultPrice: '25' });
  equal((await addStarterServices()).added, 0);
  equal((await listServices()).find((s) => s.name === 'Haul-away').defaultPrice, 25);
  equal(starterRowsFromAddons().length, ADDONS.length);
});

test('an earlier starting list is tidied: a blank price is filled, the two retired names are switched off', async () => {
  await sharedCheckoutDb();
  await query('DELETE FROM services');
  await saveService({ name: 'Haul-away', defaultPrice: '', internalCost: '20', costBasis: 'unit' });
  await saveService({ name: 'Installation – standard', defaultPrice: '', costBasis: 'appliance' });
  await addStarterServices();
  const list = await listServices({ includeInactive: true });
  equal(list.find((s) => s.name === 'Haul-away').defaultPrice, 20);
  equal(list.find((s) => s.name === 'Installation – standard').active, false);
});

suite('add-ons — the real /api/checkout');

let n = 0;
const call = (body) => POST(new Request('http://localhost/api/checkout', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.0.${++n}` },
  body: JSON.stringify({ email: `addon${n}@gmail.com`, name: 'Buyer', phone: `41677${String(70000 + n)}`, paymentMethod: 'etransfer',
    address: '1 Main St', city: 'Pickering', postal: 'L1V 1A1', ...body })
}));
async function seedUnits(tag) {
  const dwSku = `ADW-${tag}`; const frSku = `AFR-${tag}`;
  await query(`INSERT INTO products (sku, make, model, category, title, condition, price, cost, active) VALUES ($1,'Bosch','SHE','Dishwasher','Bosch dishwasher','Refurbished',500,250,true)`, [dwSku]);
  await query(`INSERT INTO products (sku, make, model, category, title, condition, price, cost, active) VALUES ($1,'LG','LRMV','Refrigerator','LG fridge','Refurbished',800,400,true)`, [frSku]);
  return { dwSku, frSku };
}
const order = async (num) => (await query('SELECT * FROM orders WHERE order_number = $1', [num])).rows[0];

test('delivery order: add-ons are service lines inside the subtotal, HST applies, the delivery fee stays $79, the invoice matches', async () => {
  await sharedCheckoutDb(); await query('DELETE FROM services');
  const { dwSku, frSku } = await seedUnits('A');
  const res = await call({ skus: [dwSku, frSku], deliveryMethod: 'delivery', addons: [
    { sku: dwSku, key: 'dishwasher_install' }, { sku: dwSku, key: 'haul_away' }, { sku: frSku, key: 'fridge_waterline_new' }] });
  equal(res.status, 200);
  const o = await order((await res.json()).orderNumber);
  // goods 1300 + add-ons (120 + 20 + 150) = 1590; delivery 79; HST on 1669
  equal(Number(o.subtotal), 1590);
  const fee = Number(o.total) - Number(o.subtotal) - Number(o.hst);
  equal(Math.round(fee * 100), 7900, 'delivery fee, as every reader infers it, is untouched');
  equal(Number(o.hst), Math.round(1669 * 0.13 * 100) / 100);
  const lines = (await query(`SELECT sku, title, price, kind FROM order_items WHERE order_id = $1 ORDER BY id`, [o.id])).rows;
  equal(lines.filter((l) => l.kind === 'service').length, 3);
  assert(lines.filter((l) => l.kind === 'service').every((l) => l.sku === null));
  assert(lines.some((l) => isHaulAwayLine(l.kind, l.title)) && lines.some((l) => isInstallLine(l.kind, l.title)));
  const inv = (await query(`SELECT total FROM invoices WHERE order_id = $1`, [o.id])).rows;
  equal(inv.length, 1); equal(Number(inv[0].total), Number(o.total));
});

test('a pickup order is never charged an add-on, whatever the browser sent', async () => {
  await sharedCheckoutDb();
  const { dwSku } = await seedUnits('B');
  const res = await call({ skus: [dwSku], deliveryMethod: 'pickup', addons: [{ sku: dwSku, key: 'dishwasher_install', price: 0 }] });
  equal(res.status, 200);
  const o = await order((await res.json()).orderNumber);
  equal(Number(o.subtotal), 500);
  equal((await query(`SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND kind = 'service'`, [o.id])).rows[0].n, 0);
});

test('a bad add-on is dropped, the sale still goes through, and a catalog price change is honoured', async () => {
  await sharedCheckoutDb(); await query('DELETE FROM services');
  const { dwSku } = await seedUnits('C');
  await saveService({ name: 'Haul-away', defaultPrice: '35', costBasis: 'unit' });
  equal((await loadAddonOverrides())['Haul-away'].price, 35);
  const res = await call({ skus: [dwSku], deliveryMethod: 'delivery', addons: [
    { sku: dwSku, key: 'otr_install' }, { sku: dwSku, key: 'haul_away' }, { sku: 'NOPE', key: 'haul_away' }] });
  equal(res.status, 200);
  const o = await order((await res.json()).orderNumber);
  equal(Number(o.subtotal), 535, 'only the haul-away, at the owner’s $35');
  // and switched off, it is not offered or charged
  await query(`UPDATE services SET active = false WHERE name = 'Haul-away'`);
  const res2 = await call({ skus: [(await seedUnits('D')).dwSku], deliveryMethod: 'delivery', addons: [{ sku: 'ADW-D', key: 'haul_away' }] });
  equal(Number((await order((await res2.json()).orderNumber)).subtotal), 500);
});
