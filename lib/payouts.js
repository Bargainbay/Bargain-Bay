// Paying vendors. See docs/marketplace/PLAN.md §8.2 and §13.4.
//
// PROPOSED by the system (or an admin), APPROVED by an admin — nothing is paid without a yes.
// The ledger debit is written at APPROVAL, inside the same transaction that re-checks the
// balance, so a refund that landed between proposal and approval cannot be paid out twice.
//
// FAILS CLOSED: if any eligibility lookup throws, nothing is proposed. The opposite choice
// (degrade open, as the storefront does) would mean paying out on a lookup that failed.
import { query, withTransaction } from './db';
import { MIN_PAYOUT_CENTS, FOUR_EYES_CENTS } from './marketplace-rules';
import { vendorBalance, appendEntry } from './vendor-ledger';
import { payableAccount, revealAccount } from './vendor-bank';
import { logVendorEvent } from './vendors';

const asInt = (v) => Number(v ?? 0);
const csvCell = (v) => {
  let s = String(v ?? '');
  // A cell that starts with = + - @ is a formula to a spreadsheet. Defuse it.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Why a vendor can't be paid right now, or null. Reads inside the caller's transaction. */
async function blocker(q, vendorId, { manual }) {
  const { rows: v } = await q('SELECT status, first_payout_cleared_at FROM vendors WHERE id = $1', [vendorId]);
  if (!v.length) return 'no such vendor';
  if (!manual && v[0].status !== 'approved') return `vendor is ${v[0].status} (an admin pays these by hand)`;
  const bank = await payableAccount(vendorId, q);
  if (!bank) return 'no verified bank account that is past its cooling-off';
  if (!v[0].first_payout_cleared_at) {
    const { rows: paid } = await q(`SELECT 1 FROM vendor_payouts WHERE vendor_id = $1 AND status = 'paid' LIMIT 1`, [vendorId]);
    if (!paid.length) return 'first payout has not been cleared by an admin';
  }
  return null;
}

/**
 * The weekly run. For every approved vendor with enough available money, a PROPOSED payout.
 * Returns what was skipped and why — a run that silently skips people is how a vendor goes
 * unpaid for a month.
 */
export async function proposePayouts({ by = 'system', now = new Date() } = {}) {
  const { rows: vendors } = await query(`SELECT id, status, COALESCE(trade_name, legal_name) AS name FROM vendors WHERE status IN ('approved','restricted','suspended','terminated') ORDER BY id`);
  const proposed = []; const skipped = [];
  for (const v of vendors) {
    const bal = await vendorBalance(v.id, now);                       // throws -> nothing proposed
    if (bal.availableCents <= 0) continue;
    if (v.status !== 'approved') { skipped.push({ vendorId: v.id, vendor: v.name, reason: `vendor is ${v.status} (an admin pays these by hand)`, availableCents: bal.availableCents }); continue; }
    if (bal.availableCents < MIN_PAYOUT_CENTS) { skipped.push({ vendorId: v.id, vendor: v.name, reason: 'below the minimum payout', availableCents: bal.availableCents }); continue; }
    const r = await proposeOne(v.id, bal.availableCents, { by, manual: false });
    if (r.ok) proposed.push({ vendorId: v.id, vendor: v.name, payoutId: r.id, amountCents: r.amountCents });
    else skipped.push({ vendorId: v.id, vendor: v.name, reason: r.reason, availableCents: bal.availableCents });
  }
  return { proposed, skipped };
}

/** An admin proposes for one vendor, any status (a restricted vendor is still owed for fulfilled orders). */
export async function proposeForVendor(vendorId, { by, amountCents, now = new Date() } = {}) {
  if (!by) throw new Error('Who is proposing this?');
  const bal = await vendorBalance(vendorId, now);
  const amount = amountCents ? Math.round(amountCents) : bal.availableCents;
  if (amount <= 0) throw new Error('Nothing is available to pay.');
  if (amount > bal.availableCents) throw new Error('That is more than is available.');
  const r = await proposeOne(vendorId, amount, { by, manual: true });
  if (!r.ok) throw new Error(`Cannot pay this vendor: ${r.reason}.`);
  return r;
}

async function proposeOne(vendorId, amountCents, { by, manual }) {
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    const why = await blocker(q, vendorId, { manual });
    if (why) return { ok: false, reason: why };
    const { rows: open } = await q(`SELECT 1 FROM vendor_payouts WHERE vendor_id = $1 AND status IN ('proposed','approved')`, [vendorId]);
    if (open.length) return { ok: false, reason: 'a payout is already open for this vendor' };
    const bank = await payableAccount(vendorId, q);
    const { rows } = await q(
      `INSERT INTO vendor_payouts (vendor_id, amount_cents, bank_account_id, method, proposed_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [vendorId, amountCents, bank.id, bank.method, by]);
    await logVendorEvent(q, vendorId, 'payout_proposed', by, { payoutId: rows[0].id, amountCents });
    return { ok: true, id: rows[0].id, amountCents };
  });
}

/**
 * Admin says yes. Re-checks the balance and the bank account under a lock, then debits the ledger.
 * Over $2,000 the approver must not be the person who proposed it (the system's own weekly
 * proposals are not a person, so a single owner can still approve them).
 */
export async function approvePayout(payoutId, { by, now = new Date() }) {
  if (!by) throw new Error('Who is approving this?');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT * FROM vendor_payouts WHERE id = $1 FOR UPDATE', [payoutId]);
    if (!rows.length) throw new Error('No such payout.');
    const p = rows[0];
    if (p.status !== 'proposed') throw new Error(`This payout is already ${p.status}.`);
    if (asInt(p.amount_cents) >= FOUR_EYES_CENTS && p.proposed_by !== 'system' && p.proposed_by === by) {
      throw new Error('A payout this size needs a second person to approve it.');
    }
    await q('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [p.vendor_id]);
    const bal = await vendorBalance(p.vendor_id, now);
    if (bal.availableCents < asInt(p.amount_cents)) {
      await q(`UPDATE vendor_payouts SET status='cancelled', note='Balance fell below the proposed amount before approval' WHERE id = $1`, [payoutId]);
      return { ok: false, cancelled: true, reason: 'The vendor\'s available balance dropped below this amount, so the proposal was cancelled. Propose again.' };
    }
    const bank = await payableAccount(p.vendor_id, q, now);
    if (!bank) throw new Error('This vendor has no payable bank account any more.');
    await appendEntry(q, { vendorId: p.vendor_id, kind: 'payout', amountCents: -asInt(p.amount_cents), ref: `payout:${payoutId}`, actor: by, idemKey: `payout:${payoutId}` });
    await q(`UPDATE vendor_payouts SET status='approved', approved_by=$2, approved_at=now(), bank_account_id=$3, method=$4 WHERE id=$1`,
      [payoutId, by, bank.id, bank.method]);
    await logVendorEvent(q, p.vendor_id, 'payout_approved', by, { payoutId, amountCents: asInt(p.amount_cents) });
    return { ok: true };
  });
}

export async function cancelPayout(payoutId, { by, note }) {
  const { rows } = await query(
    `UPDATE vendor_payouts SET status='cancelled', note=$2 WHERE id=$1 AND status='proposed' RETURNING vendor_id`, [payoutId, note || null]);
  if (!rows.length) throw new Error('Only a proposed payout can be cancelled (an approved one has to be marked failed).');
  await logVendorEvent(query, rows[0].vendor_id, 'payout_cancelled', by, { payoutId });
  return { ok: true };
}

export async function markPayoutPaid(payoutId, { by, ref }) {
  if (!String(ref || '').trim()) throw new Error('Enter the bank reference so it can be traced.');
  const { rows } = await query(
    `UPDATE vendor_payouts SET status='paid', paid_at=now(), paid_ref=$2 WHERE id=$1 AND status='approved' RETURNING vendor_id`, [payoutId, String(ref).trim()]);
  if (!rows.length) throw new Error('Only an approved payout can be marked paid.');
  await logVendorEvent(query, rows[0].vendor_id, 'payout_paid', by, { payoutId, ref });
  return { ok: true };
}

/** The bank bounced it. The money goes back on the ledger as a visible reversal, never as an edit. */
export async function markPayoutFailed(payoutId, { by, note }) {
  if (!String(note || '').trim()) throw new Error('Say what went wrong.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(`SELECT vendor_id, amount_cents, status FROM vendor_payouts WHERE id = $1 FOR UPDATE`, [payoutId]);
    if (!rows.length || rows[0].status !== 'approved') throw new Error('Only an approved payout can be marked failed.');
    await appendEntry(q, { vendorId: rows[0].vendor_id, kind: 'payout_reversal', amountCents: asInt(rows[0].amount_cents),
      ref: `payout:${payoutId}`, memo: note, actor: by, idemKey: `payout:${payoutId}:reversal` });
    await q(`UPDATE vendor_payouts SET status='failed', note=$2 WHERE id=$1`, [payoutId, note]);
    await logVendorEvent(q, rows[0].vendor_id, 'payout_failed', by, { payoutId, note });
    return { ok: true };
  });
}

/** Admin clears a vendor for their first payout (after a test deposit or a call). */
export async function clearFirstPayout(vendorId, { by }) {
  if (!by) throw new Error('Who is clearing this?');
  const { rowCount } = await query(
    `UPDATE vendors SET first_payout_cleared_at = now(), first_payout_cleared_by = $2 WHERE id = $1 AND first_payout_cleared_at IS NULL`, [vendorId, by]);
  if (rowCount) await logVendorEvent(query, vendorId, 'first_payout_cleared', by);
  return { ok: true };
}

/**
 * The bank file for approved payouts. This is the only place full account numbers leave the
 * database, so every row is a logged reveal.
 */
export async function payoutFile(payoutIds, { by }) {
  if (!by) throw new Error('Who is exporting this?');
  const { rows } = await query(
    `SELECT p.id, p.amount_cents, p.method, p.bank_account_id, COALESCE(v.trade_name, v.legal_name) AS vendor
       FROM vendor_payouts p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.id = ANY($1) AND p.status = 'approved' ORDER BY p.id`, [payoutIds]);
  if (!rows.length) throw new Error('None of those payouts are approved.');
  const lines = [['payout_id', 'vendor', 'method', 'holder', 'institution', 'transit', 'account', 'amount_cad', 'reference'].join(',')];
  for (const r of rows) {
    const a = await revealAccount(r.bank_account_id, { by, reason: `payout file for payout ${r.id}` });
    lines.push([r.id, r.vendor, r.method, a.holderName, a.institution, a.transit, a.account,
      (asInt(r.amount_cents) / 100).toFixed(2), `BB-MKT-${r.id}`].map(csvCell).join(','));
  }
  return { csv: lines.join('\n') + '\n', count: rows.length };
}

export async function listPayouts({ status } = {}) {
  const { rows } = await query(
    `SELECT p.id, p.vendor_id, COALESCE(v.trade_name, v.legal_name) AS vendor, p.amount_cents, p.status, p.method,
            p.proposed_by, p.proposed_at, p.approved_by, p.approved_at, p.paid_at, p.paid_ref, p.note
       FROM vendor_payouts p JOIN vendors v ON v.id = p.vendor_id
      WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.proposed_at DESC, p.id DESC LIMIT 300`, [status || null]);
  return rows.map((r) => ({ ...r, amount_cents: asInt(r.amount_cents) }));
}

/** A vendor's own payout history. Scoped by the id the caller got from their session. */
export async function vendorPayouts(vendorId) {
  const { rows } = await query(
    `SELECT id, amount_cents, status, method, proposed_at, approved_at, paid_at, paid_ref
       FROM vendor_payouts WHERE vendor_id = $1 ORDER BY proposed_at DESC, id DESC LIMIT 200`, [vendorId]);
  return rows.map((r) => ({ ...r, amount_cents: asInt(r.amount_cents) }));
}
