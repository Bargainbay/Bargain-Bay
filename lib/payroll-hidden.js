// People left off the Payroll screens only. Their shifts, earned and paid records are untouched, so the books, the
// Hours report and the ledger still count them. Lower-case names. Ruban: settled in full, no longer working here (owner, 2026-11-20).
export const PAYROLL_HIDDEN = ['ruban'];
export const isPayrollHidden = (name) => PAYROLL_HIDDEN.includes(String(name || '').trim().toLowerCase().replace(/\s+/g, ' '));
