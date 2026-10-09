// Vendors' banking details — how we pay them. See docs/marketplace/PLAN.md §5.3, §13.4.
//
//   * The account number is encrypted (lib/secret-box.js); only the last four digits are
//     ever returned by anything a vendor can call.
//   * Only the vendor's OWNER can submit or change an account.
//   * A new account does nothing until an ADMIN verifies it, attesting the holder's name
//     matches the business. Replacing an account that is already being paid to adds a
//     cooling-off period during which the OLD account stays the payable one — the window
//     in which someone who took over a login would otherwise redirect the money.
//   * Every submission tells everyone who acts for the vendor, and revealing a full
//     number to build a payout file is logged.
import { query, withTransaction } from './db';
import { encryptSecret, decryptSecret } from './secret-box';
import { logVendorEvent } from './vendors';
import { BANK_COOLING_DAYS } from './marketplace-rules';
import { sendEmail, esc } from './email';

const clean = (s) => String(s ?? '').trim();
const digits = (s) => clean(s).replace(/[\s-]/g, '');
const fold = (s) => clean(s).toLowerCase().replace(/\b(inc|ltd|limited|corp|corporation|co|company|llc)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

/** A hint for the reviewer, never a decision: does the holder's name resemble the business? */
export function nameLooksRight(holder, ...businessNames) {
  const h = fold(holder);
  if (!h) return false;
  return businessNames.filter(Boolean).some((b) => { const f = fold(b); return f && (f === h || f.includes(h) || h.includes(f)); });
}

export function validateBank(i = {}) {
  const out = { holderName: clean(i.holderName), institution: digits(i.institution), transit: digits(i.transit), account: digits(i.account) };
  const method = i.method === 'wire' ? 'wire' : 'direct_deposit';
  if (out.holderName.length < 2) throw new Error('The account holder\'s name is required.');
  if (!/^\d{3}$/.test(out.institution)) throw new Error('The institution number is 3 digits.');
  if (!/^\d{5}$/.test(out.transit)) throw new Error('The transit (branch) number is 5 digits.');
  if (!/^\d{7,12}$/.test(out.account)) throw new Error('The account number is 7 to 12 digits.');
  return { ...out, method };
}

/**
 * The account we would pay to today: the newest VERIFIED account whose cooling-off is over.
 * A newer account still cooling is deliberately ignored — the old one keeps being paid.
 */
export async function payableAccount(vendorId, q = query, now = new Date()) {
  const { rows } = await q(
    `SELECT id, holder_name, institution, transit, account_last4, method, verified_at, cooling_until
       FROM vendor_bank_accounts
      WHERE vendor_id = $1 AND status = 'verified' AND cooling_until <= $2::timestamptz
      ORDER BY verified_at DESC, id DESC LIMIT 1`, [vendorId, now.toISOString()]);
  return rows[0] || null;
}

/** What a vendor (or staff) may see: no full number, ever. */
export async function bankSummary(vendorId, now = new Date()) {
  const payable = await payableAccount(vendorId, query, now);
  const { rows: pending } = await query(
    `SELECT id, holder_name, institution, transit, account_last4, status, cooling_until, submitted_at
       FROM vendor_bank_accounts
      WHERE vendor_id = $1 AND (status = 'pending' OR (status = 'verified' AND cooling_until > $2::timestamptz))
      ORDER BY submitted_at DESC`, [vendorId, now.toISOString()]);
  const mask = (r) => r && ({ id: r.id, holderName: r.holder_name, institution: r.institution, transit: r.transit,
    last4: r.account_last4, method: r.method, status: r.status, coolingUntil: r.cooling_until, submittedAt: r.submitted_at });
  return { payable: mask(payable), waiting: pending.map(mask) };
}

async function tellEveryone(vendorId, subject, body) {
  try {
    const { rows: v } = await query('SELECT contact_email, COALESCE(trade_name, legal_name) AS name FROM vendors WHERE id = $1', [vendorId]);
    const { rows: u } = await query('SELECT email FROM vendor_users WHERE vendor_id = $1 AND revoked_at IS NULL', [vendorId]);
    const to = [...new Set([v[0]?.contact_email, ...u.map((r) => r.email)].filter(Boolean).map((e) => e.toLowerCase()))];
    for (const addr of to) {
      await sendEmail({ to: addr, subject, html: `<p>${esc(body)}</p><p>If this wasn't you, reply to this email straight away.</p>` });
    }
  } catch (e) {
    // The change is recorded either way; a mail hiccup must not lose or block it.
    console.error('bank change notification failed', e?.message || e);
  }
}

/** Owner only. Replaces any account of theirs still waiting for review. */
export async function submitBankAccount({ vendorId, role, by }, input) {
  if (role !== 'owner') throw new Error('Only the account owner can change banking details.');
  const b = validateBank(input);
  const out = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    await q(`UPDATE vendor_bank_accounts SET status = 'rejected', reject_reason = 'Replaced by a newer submission'
              WHERE vendor_id = $1 AND status = 'pending'`, [vendorId]);
    const enc = encryptSecret(b.account, `bank:${vendorId}`);
    const { rows } = await q(
      `INSERT INTO vendor_bank_accounts (vendor_id, holder_name, institution, transit, account_enc, account_last4, method, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [vendorId, b.holderName, b.institution, b.transit, enc, b.account.slice(-4), b.method, by || null]);
    await logVendorEvent(q, vendorId, 'bank_submitted', by, { bankId: rows[0].id, last4: b.account.slice(-4) });
    return { id: rows[0].id, last4: b.account.slice(-4) };
  });
  await tellEveryone(vendorId, 'Banking details were submitted for your Bargain Bay marketplace account',
    `New banking details ending in ${out.last4} were submitted for your account by ${by || 'a user'}. They will not be used for payouts until we have verified them.`);
  return { ok: true, ...out };
}

/** Admin: the list of accounts waiting for a human, with the name-match hint. */
export async function pendingBankAccounts() {
  const { rows } = await query(
    `SELECT b.id, b.vendor_id, b.holder_name, b.institution, b.transit, b.account_last4, b.method, b.submitted_by, b.submitted_at,
            v.legal_name, v.trade_name,
            EXISTS (SELECT 1 FROM vendor_bank_accounts o WHERE o.vendor_id = b.vendor_id AND o.status = 'verified') AS replaces_existing
       FROM vendor_bank_accounts b JOIN vendors v ON v.id = b.vendor_id
      WHERE b.status = 'pending' ORDER BY b.submitted_at`);
  return rows.map((r) => ({
    id: r.id, vendorId: r.vendor_id, vendor: r.trade_name || r.legal_name, legalName: r.legal_name,
    holderName: r.holder_name, institution: r.institution, transit: r.transit, last4: r.account_last4,
    method: r.method, submittedBy: r.submitted_by, submittedAt: r.submitted_at,
    replacesExisting: r.replaces_existing, nameLooksRight: nameLooksRight(r.holder_name, r.legal_name, r.trade_name)
  }));
}

/**
 * Admin verifies an account. They must attest the name matches — a false attestation is a
 * named person's, which is the point. Replacing an account already in use starts the cooling-off.
 */
export async function verifyBankAccount(bankId, { by, how, nameMatched }) {
  if (!by) throw new Error('Who is verifying this?');
  if (!['void_cheque', 'bank_letter', 'test_deposit'].includes(how)) throw new Error('How was it verified? (void cheque, bank letter or test deposit)');
  if (nameMatched !== true) throw new Error('Confirm the account holder\'s name matches the business before verifying.');
  const out = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(`SELECT vendor_id, status, account_last4 FROM vendor_bank_accounts WHERE id = $1 FOR UPDATE`, [bankId]);
    if (!rows.length) throw new Error('No such account.');
    if (rows[0].status !== 'pending') throw new Error(`This account is already ${rows[0].status}.`);
    const vendorId = rows[0].vendor_id;
    const { rows: existing } = await q(`SELECT 1 FROM vendor_bank_accounts WHERE vendor_id = $1 AND status = 'verified' LIMIT 1`, [vendorId]);
    const cooling = existing.length ? `now() + make_interval(days => ${Number(BANK_COOLING_DAYS)})` : 'now()';
    const { rows: done } = await q(
      `UPDATE vendor_bank_accounts SET status='verified', verified_at=now(), verified_by=$2, verified_how=$3,
              name_matched=TRUE, cooling_until=${cooling} WHERE id=$1 RETURNING cooling_until`, [bankId, by, how]);
    await logVendorEvent(q, vendorId, 'bank_verified', by, { bankId, how, coolingUntil: done[0].cooling_until });
    return { vendorId, last4: rows[0].account_last4, coolingUntil: done[0].cooling_until, cooling: existing.length > 0 };
  });
  if (out.cooling) {
    await tellEveryone(out.vendorId, 'Your new banking details were verified',
      `The account ending in ${out.last4} was verified. As a safety measure it will not be used for payouts until ${new Date(out.coolingUntil).toISOString().slice(0, 10)}; until then payouts go to your previous account.`);
  }
  return { ok: true, coolingUntil: out.coolingUntil };
}

export async function rejectBankAccount(bankId, { by, reason }) {
  if (!by) throw new Error('Who is rejecting this?');
  if (!clean(reason)) throw new Error('Say why, so the vendor can fix it.');
  const { rows } = await query(
    `UPDATE vendor_bank_accounts SET status='rejected', reject_reason=$2 WHERE id=$1 AND status='pending' RETURNING vendor_id`, [bankId, clean(reason)]);
  if (!rows.length) throw new Error('That account is not waiting for review.');
  await logVendorEvent(query, rows[0].vendor_id, 'bank_rejected', by, { bankId, reason: clean(reason) });
  return { ok: true };
}

/**
 * Admin: the full account number, for building a payout file. Every reveal is logged with who
 * and why. Never exposed through a vendor-callable path.
 */
export async function revealAccount(bankId, { by, reason }) {
  if (!by) throw new Error('Who is asking?');
  if (!clean(reason)) throw new Error('Say why you need the full number.');
  const { rows } = await query(`SELECT vendor_id, account_enc, institution, transit, holder_name FROM vendor_bank_accounts WHERE id = $1`, [bankId]);
  if (!rows.length) throw new Error('No such account.');
  const account = decryptSecret(rows[0].account_enc, `bank:${rows[0].vendor_id}`);
  await logVendorEvent(query, rows[0].vendor_id, 'bank_revealed', by, { bankId, reason: clean(reason) });
  return { holderName: rows[0].holder_name, institution: rows[0].institution, transit: rows[0].transit, account };
}
