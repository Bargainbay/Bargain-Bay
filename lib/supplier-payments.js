// A bank line filed as "Supplier Payment ..." pays for STOCK, and the books must never count it twice.
//
//   not a cost   the appliance is already a cost when it sells (cost of goods sold)
//   not booked   the money is recorded ONCE, when the e-transfer is connected to what we owe: "Mark paid" on the
//                supplier invoice or the consigned unit. The filed bank line is only a label until then.
//   no HST       the tax on stock is claimed from the supplier invoice, never from the payment of it
//
// Nothing here guesses which payment belongs to which invoice. No imports: reports and tests share this rule.
export const isSupplierPayment = (category) => /^\s*supplier payment/i.test(String(category || ''));

// Three more kinds of bank line are money moving, not money spent, and are treated the same way (owner, 2026-11-26):
export const NOT_COST_CATEGORIES = [
  'Refund (already off sales)',   // the refund was entered on the invoice, which already took it off sales
  'Receipt payback',              // paying somebody back for a receipt that is already recorded as the cost
  'Passed on (not ours)'          // money handed to us to send to someone else
];
const NOT_COSTS = NOT_COST_CATEGORIES.map((c) => c.toLowerCase());
export const isMoneyOnly = (category) =>
  isSupplierPayment(category) || NOT_COSTS.includes(String(category || '').trim().toLowerCase());

// The same rule inside SQL, for an expenses row.
export const notMoneyOnlySql = (t) =>
  `(COALESCE(${t}.category,'') !~* '^\\s*supplier payment' AND lower(btrim(COALESCE(${t}.category,''))) NOT IN (${NOT_COSTS.map((c) => `'${c}'`).join(',')}))`;
