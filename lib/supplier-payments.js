// A bank line filed as "Supplier Payment ..." pays for STOCK, and the books must never count it twice.
//
//   not a cost   the appliance is already a cost when it sells (cost of goods sold)
//   not booked   the money is recorded ONCE, when the e-transfer is connected to what we owe: "Mark paid" on the
//                supplier invoice or the consigned unit. The filed bank line is only a label until then.
//   no HST       the tax on stock is claimed from the supplier invoice, never from the payment of it
//
// Nothing here guesses which payment belongs to which invoice. No imports: reports and tests share this rule.
export const isSupplierPayment = (category) => /^\s*supplier payment/i.test(String(category || ''));

// The same rule inside SQL, for an expenses row.
export const notSupplierPaymentSql = (t) => `COALESCE(${t}.category,'') !~* '^\\s*supplier payment'`;
