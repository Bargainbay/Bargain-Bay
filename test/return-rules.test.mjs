// The returns rules (owner, 2026-11-27): more than 30% off retail is final sale, every refund keeps
// 20%, dead on arrival is 24 hours for an exchange. Sales made before the change keep their terms.
import { suite, test, assert, equal } from './_harness.mjs';
import { sharedCheckoutDb } from './shared-checkout-db.mjs';
import { query } from '../lib/db.js';
import {
  isFinalSale, discountFactor, stampFinalSale, refundPolicyProblem, returnRulesApply, RETURN_RULES_FROM
} from '../lib/return-rules.js';
import { returnTermsFor } from '../lib/constants.js';
import { createAndSendInvoice, getInvoiceByNumber, markInvoicePaid, updateInvoice } from '../lib/invoices.js';
import { refundGuard } from '../lib/refund-guard.js';

const AFTER = new Date(new Date(RETURN_RULES_FROM).getTime() + 3600_000).toISOString();
const BEFORE = new Date(new Date(RETURN_RULES_FROM).getTime() - 3600_000).toISOString();

suite('returns policy — the rules');

test('MORE than 30% off retail is final sale; exactly 30% is not', () => {
  assert(isFinalSale(1000, 2500), 'the $2,500 unit sold for $1,000');
  assert(isFinalSale(699.99, 1000), 'a cent past 30%');
  assert(!isFinalSale(700, 1000), 'exactly 30% off');
  assert(!isFinalSale(900, 1000), '10% off');
  assert(!isFinalSale(500, 0), 'no retail on record');
});

test('a discount counts towards the 30%; a trade-in and a delivery charge do not', () => {
  const lines = [{ kind: 'unit', sku: 'A', amount: 750 }, { kind: 'discount', amount: -75 }, { kind: 'service', amount: 79 }];
  equal(discountFactor(lines), 0.9);
  stampFinalSale(lines, new Map([['A', 1000]]));
  assert(lines[0].finalSale, '$750 less 10% is 32.5% off');
  assert(!lines[2].finalSale, 'a service is never final sale');
  const traded = [{ kind: 'unit', sku: 'A', amount: 750 }, { kind: 'trade_in', amount: -200 }];
  stampFinalSale(traded, new Map([['A', 1000]]));
  assert(!traded[0].finalSale, 'a trade-in is payment, not a discount');
});

test('a sale made before the change keeps its terms', () => {
  assert(!returnRulesApply(BEFORE));
  assert(returnRulesApply(AFTER));
  assert(/full refund — your choice/.test(returnTermsFor(BEFORE).summary.join(' ')), 'old invoice, old words');
  assert(/FINAL SALE/.test(returnTermsFor(AFTER).summary.join(' ')), 'new invoice, new words');
  equal(refundPolicyProblem({ sale: { createdAt: BEFORE }, targets: [{ finalSale: true }] }), null);
});

test('refunds: final sale refused, the fee required, money-only capped', () => {
  const sale = { createdAt: AFTER, refundTotal: 0 };
  assert(/final sale/i.test(refundPolicyProblem({ sale, targets: [{ finalSale: true }], restockingPct: 20 })));
  assert(/restocking fee/i.test(refundPolicyProblem({ sale, targets: [{ finalSale: false }], restockingPct: 0 })));
  equal(refundPolicyProblem({ sale, targets: [{ finalSale: false }], restockingPct: 20 }), null);
  equal(refundPolicyProblem({ sale, amount: 80, collected: 100 }), null);
  assert(refundPolicyProblem({ sale, amount: 80.01, collected: 100 }), 'over 80%');
  assert(refundPolicyProblem({ sale: { ...sale, refundTotal: 50 }, amount: 40, collected: 100 }), 'counts what already went back');
  const final = [{ finalSale: true }];
  assert(refundPolicyProblem({ sale, allLines: final, amount: 10, collected: 100 }), 'no cash back on a final sale');
  equal(refundPolicyProblem({ sale, allLines: final, amount: 80, collected: 100, asCredit: true, delivered: false }), null);
  assert(refundPolicyProblem({ sale, allLines: final, amount: 80, collected: 100, asCredit: true, delivered: true }), 'not once delivered');
});

suite('returns policy — on a real invoice');

test('THE SALE IS STAMPED ON THE INVOICE LINE, AND A REFUND OF IT IS REFUSED', async () => {
  await sharedCheckoutDb();
  await query(`INSERT INTO products (sku, make, model, price, compare_at, active) VALUES
    ('RR-DEEP','LG','X1',1000,2500,true), ('RR-LIGHT','LG','X2',2000,2500,true) ON CONFLICT (sku) DO NOTHING`);
  const made = await createAndSendInvoice({
    name: 'Fin Sale', email: 'final@example.com', addHst: true, sendEmail: false,
    // Dated by the clock only once the rules are live; before that a test run would see old terms.
    items: [{ description: 'Deep discount fridge', sku: 'RR-DEEP', amount: 1000 }, { description: 'Light discount range', sku: 'RR-LIGHT', amount: 2000 }]
  });
  await query('UPDATE invoices SET created_at = $2 WHERE id = $1', [made.id, AFTER]);
  // An edit judges it under the rules of the day it is dated to.
  await updateInvoice(made.id, {
    addHst: true, items: [{ description: 'Deep discount fridge', sku: 'RR-DEEP', amount: 1000 }, { description: 'Light discount range', sku: 'RR-LIGHT', amount: 2000 }]
  });
  const inv = await getInvoiceByNumber(made.number);
  const [deep, light] = inv.items;
  equal(deep.final_sale, true);
  equal(light.final_sale, false);
  equal(Number(deep.retail_price), 2500);
  await markInvoicePaid(made.id, 'cash', null, { silent: true });
  assert(/final sale/i.test(await refundGuard(made.id, { kind: 'items', itemIds: [deep.id], restockingPct: 20 })));
  assert(/final sale/i.test(await refundGuard(made.id, { kind: 'full', restockingPct: 20 })));
  equal(await refundGuard(made.id, { kind: 'items', itemIds: [light.id], restockingPct: 20 }), null);
  assert(await refundGuard(made.id, { kind: 'items', itemIds: [light.id], restockingPct: 0 }), 'fee required');
});
