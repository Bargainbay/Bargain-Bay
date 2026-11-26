// Payments the Manager finds in the service mailbox, and what it does with them.
//
// The bank's own "Interac e-Transfer: You've received $X from NAME and it has been
// deposited" email is the evidence (lib/interac-names.js already reads the same
// mailbox for the books). The owner's rule (2026-11-17): MARK IT PAID BY ITSELF when
// it can verify it — the amount equals exactly what one invoice still owes, the money
// did not arrive before the invoice existed, and the sender's name agrees with the
// customer's. Anything less is kept, listed and MENTIONED, never guessed:
//   · the name is different  -> flagged "name_mismatch" (mention it, ask)
//   · several invoices fit   -> flagged "ambiguous"
//   · it predates the invoice -> flagged "date_mismatch"
//   · nothing owes that amount -> flagged "unmatched"
//
// One row per Gmail message (`msg_id` unique), so a payment is applied ONCE however
// many times the scan runs. A flagged one is re-checked on later scans (the invoice
// may have been raised since) but is only ever announced once.
import { query, hasDb } from './db';
import { logAction } from './manager-actions';
import { SERVICE_EMAIL } from './constants';
import { gmailConfigured, listSubjects } from './gmail';
import { parseInteracReceived } from './interac-names';
import { matchPayment, moneyWords, sameName } from './manager-policy';
import { torontoDay } from './manager-business';
import { notifyDone } from './manager-report';

const INBOX = () => process.env.INTERAC_INBOX || SERVICE_EMAIL;
const SCAN_QUERY = 'from:payments.interac.ca subject:"you\'ve received" subject:"deposited" newer_than:14d';
const round2 = (n) => Math.round(n * 100) / 100;

export function ensurePaymentSchema() {
  if (!hasDb()) return Promise.resolve();
  return query(`
    CREATE TABLE IF NOT EXISTS manager_payments (
      id serial PRIMARY KEY,
      msg_id text NOT NULL UNIQUE,
      sender text, amount_cents int NOT NULL, received_at timestamptz,
      status text NOT NULL, invoice_number text, note text,
      created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS idx_manager_payments_open ON manager_payments(status) WHERE resolved_at IS NULL;
  `);
}

async function openInvoices() {
  const { rows } = await query(
    `SELECT i.id, i.number, i.name AS customer, i.channel, i.order_id, i.status, i.total::float AS total, i.created_at,
            COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)::float AS paid
       FROM invoices i WHERE i.status IN ('open','partial')`);
  return rows.map((r) => ({
    ...r, balance: round2(r.total - r.paid), balanceCents: Math.round(round2(r.total - r.paid) * 100),
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null
  }));
}

// Payments a PERSON has recorded on the ledger lately, so an e-transfer staff already
// entered is never entered a second time. The Manager's own entries are left out: those
// are tracked per bank email in manager_payments.
async function recentHumanPayments() {
  const { rows } = await query(
    `SELECT p.id, p.amount::float AS amount, p.paid_at, i.number FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.paid_at > now() - interval '45 days' AND COALESCE(p.note,'') NOT ILIKE '%by the Manager%'
        AND p.id NOT IN (SELECT substring(note from '^payment:([0-9]+)$')::int FROM manager_payments WHERE note ~ '^payment:[0-9]+$')`);
  const list = rows.map((r) => ({ id: r.id, number: r.number, amountCents: Math.round(r.amount * 100), atMs: r.paid_at ? new Date(r.paid_at).getTime() : null }));
  // Claims written before an email recorded WHICH payment it was paired with (note 'Already entered by hand'):
  // take one matching entry off for each, or that entry would pair with a second, genuine email next time.
  const { rows: legacy } = await query(`SELECT amount_cents, received_at FROM manager_payments WHERE status = 'matched_by_staff' AND note = 'Already entered by hand'`);
  for (const l of legacy) {
    const at = l.received_at ? new Date(l.received_at).getTime() : null;
    const k = list.map((r, idx) => ({ r, idx })).filter(({ r }) => r.amountCents === l.amount_cents && (at == null || r.atMs == null || Math.abs(r.atMs - at) <= 3 * 86400_000))
      .sort((a, b) => Math.abs((a.r.atMs ?? 0) - (at ?? 0)) - Math.abs((b.r.atMs ?? 0) - (at ?? 0)))[0];
    if (k) list.splice(k.idx, 1);
  }
  return list;
}

// THE RULE (owner, 2026-11-17): a second payment needs a second e-transfer. Every e-transfer
// email can pay for ONE ledger entry, ever. An entry a person made by hand USES UP the bank
// email it corresponds to (same amount, within 3 days), so the same email can never be applied
// again on top of it; and an e-transfer entry the Manager makes itself is always backed by
// an email that nothing else has used.
const WINDOW_MS = 3 * 86400_000;
// Test seam only (like __useTestDatabase): never called in production, not reachable from a route.
let testMail = null;
export function __useTestBankEmails(list) { testMail = list; }
const mailReady = () => !!testMail || gmailConfigured();
async function parsedEmails() {
  if (testMail) return testMail;
  const mail = await listSubjects(INBOX(), { query: SCAN_QUERY, max: 100 });
  const out = [];
  for (const e of mail.emails || []) { const p = parseInteracReceived(e); if (p) out.push({ id: e.id, p }); }
  return out;
}
async function claimedIds() {
  // A staff entry that was later removed (voided) gives its bank email back.
  const { rows } = await query(
    `SELECT msg_id FROM manager_payments WHERE status IN ('paid','paid_by_owner','applying')
        OR (status = 'matched_by_staff' AND (note !~ '^payment:[0-9]+$' OR note = 'payment:0' OR substring(note from '^payment:([0-9]+)$')::int IN (SELECT id FROM invoice_payments)))`);
  return new Set(rows.map((r) => r.msg_id));
}
// email id -> the ledger entry it was paired with
export function pairStaffEntries(parsed, claimed, recorded) {
  const pairs = new Map();
  const byTime = [...recorded].sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  for (const r of byTime) {
    const hit = parsed
      .filter((x) => !claimed.has(x.id) && !pairs.has(x.id) && x.p.amountCents === r.amountCents && (r.atMs == null || !x.p.at || Math.abs(new Date(x.p.at).getTime() - r.atMs) <= WINDOW_MS))
      .sort((a, b) => new Date(a.p.at || 0) - new Date(b.p.at || 0))[0];
    if (hit) pairs.set(hit.id, r);
  }
  return pairs;
}
export function consumedByStaff(parsed, claimed, recorded) { return new Set(pairStaffEntries(parsed, claimed, recorded).keys()); }
// Is there an e-transfer email for this amount that no payment has used yet?
export async function etransferBacking(amount) {
  if (!hasDb()) return { ok: false, reason: 'No database.' };
  if (!mailReady()) return { ok: false, reason: 'the service mailbox is not connected, so I cannot check for the bank email' };
  await ensurePaymentSchema();
  let parsed; try { parsed = await parsedEmails(); } catch (e) { return { ok: false, reason: `I could not read the mailbox: ${e?.message || e}` }; }
  const cents = Math.round(Number(amount) * 100);
  const claimed = await claimedIds();
  const used = consumedByStaff(parsed, claimed, await recentHumanPayments());
  const free = parsed.filter((x) => x.p.amountCents === cents && !claimed.has(x.id) && !used.has(x.id));
  return free.length ? { ok: true, msgId: free[0].id, p: free[0].p, from: free[0].p.name } : { ok: false, reason: `I cannot find an e-transfer email for ${moneyWords(cents / 100)} that has not already been used on a payment` };
}
export async function claimBacking(msgId, p, number) {
  await query(
    `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status, invoice_number, resolved_at) VALUES ($1,$2,$3,$4,'paid_by_owner',$5,now())
     ON CONFLICT (msg_id) DO UPDATE SET status = 'paid_by_owner', invoice_number = $5, resolved_at = now()`,
    [msgId, p.name, p.amountCents, p.at ? new Date(p.at).toISOString() : null, number]);
}

// ── The check on a payment a PERSON enters ─────────────────────────────────
// The same rule the Manager follows, applied to the invoice screen, Sarah, the dispatch board and the door-money
// confirm: every e-transfer entry is backed by a bank email that nothing else has used, and a SECOND payment of the
// same amount needs a SECOND e-transfer. Blocking is reserved for that double; everything else that looks off
// (no email at all, a different name, an email that predates the invoice, a typo'd amount) is let through with a
// warning that is shown on the spot AND written onto the payment's note, so nothing unverified is ever silent.
const ETRANSFER = 'E-transfer';
const wholeDollars = (c) => `$${(c / 100).toFixed(2)}`;
const dayOf = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
function whenOf(paidDate) { const t = paidDate ? Date.parse(`${String(paidDate).slice(0, 10)}T12:00:00-05:00`) : NaN; return Number.isFinite(t) ? t : Date.now(); }

export async function vetEtransfer(invoiceId, { amount = null, paidDate = null } = {}) {
  await ensurePaymentSchema();
  const { rows } = await query(
    `SELECT i.id, i.number, i.name, i.created_at, i.total::float AS total,
            COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)::float AS paid
       FROM invoices i WHERE i.id = $1`, [invoiceId]);
  if (!rows.length) return { ok: true, warnings: [], unchecked: true };
  const iv = rows[0];
  const balance = round2(iv.total - iv.paid);
  const amt = amount == null || amount === '' ? balance : round2(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: true, warnings: [], unchecked: true };
  const cents = Math.round(amt * 100);
  const whenMs = whenOf(paidDate);
  const lo = new Date(whenMs - WINDOW_MS).toISOString(); const hi = new Date(whenMs + WINDOW_MS).toISOString();
  const { rows: prior } = await query(
    `SELECT p.id, i.number, p.invoice_id, p.paid_at FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.method = $1 AND round(p.amount * 100)::int = $2 AND p.paid_at BETWEEN $3 AND $4`, [ETRANSFER, cents, lo, hi]);
  const priorSame = prior.filter((r) => r.invoice_id === iv.id);
  const warnings = [];
  const out = { number: iv.number, amount: amt, warnings };

  let parsed = null; let why = null;
  if (!mailReady()) why = 'the service mailbox is not connected';
  else { try { parsed = await parsedEmails(); } catch (e) { why = `the mailbox could not be read (${e?.message || e})`; } }

  if (!parsed) {
    if (priorSame.length) return { ...out, ok: false, block: `${iv.number} already has an e-transfer of ${wholeDollars(cents)} on ${dayOf(new Date(priorSame[0].paid_at).getTime())}, and I cannot read the bank emails to prove a second one arrived (${why}). A second payment needs a second e-transfer.` };
    warnings.push(`Could not check this against the bank emails (${why}), so it is recorded as NOT verified.`);
    return { ...out, ok: true, verified: false };
  }

  const claimed = await claimedIds();
  const used = consumedByStaff(parsed, claimed, await recentHumanPayments());
  const open = parsed.filter((x) => !claimed.has(x.id) && !used.has(x.id));
  const fits = open.filter((x) => x.p.amountCents === cents && (x.p.at == null || Math.abs(new Date(x.p.at).getTime() - whenMs) <= WINDOW_MS))
    .sort((a, b) => (sameName(b.p.name, iv.name) ? 1 : 0) - (sameName(a.p.name, iv.name) ? 1 : 0) || Math.abs(new Date(a.p.at || whenMs) - whenMs) - Math.abs(new Date(b.p.at || whenMs) - whenMs));
  if (fits.length) {
    const best = fits[0];
    if (!sameName(best.p.name, iv.name) && !/walk-in/i.test(iv.name || '')) warnings.push(`The e-transfer is from ${best.p.name} but ${iv.number} is for ${iv.name}. Check it is the right invoice.`);
    if (best.p.at && iv.created_at && new Date(best.p.at).getTime() < new Date(iv.created_at).getTime() - 36 * 3600_000) warnings.push(`That e-transfer arrived ${dayOf(new Date(best.p.at).getTime())}, before ${iv.number} was raised (${dayOf(new Date(iv.created_at).getTime())}). Check it belongs to this sale.`);
    return { ...out, ok: true, verified: true, backing: best, from: best.p.name };
  }
  if (prior.length) {
    const where = [...new Set(prior.map((r) => r.number))].join(', ');
    return { ...out, ok: false, block: `A ${wholeDollars(cents)} e-transfer is already on the ledger (${where}), and I cannot find a second bank email for ${wholeDollars(cents)} that nothing has used. A second payment needs a second e-transfer: wait for it to arrive, or have the owner record it with a reason.` };
  }
  warnings.push(`No unused bank e-transfer email for ${wholeDollars(cents)} was found in the last 14 days, so this is recorded as NOT verified. If the money has not arrived yet, remove the entry.`);
  const close = open.filter((x) => sameName(x.p.name, iv.name) && x.p.amountCents !== cents).slice(0, 2);
  for (const x of close) warnings.push(`There is an unused bank email from ${x.p.name} for ${wholeDollars(x.p.amountCents)}. Did you mean that amount?`);
  return { ...out, ok: true, verified: false };
}

async function claimEmail(msgId, p, number) {
  const prev = (await query('SELECT status, note FROM manager_payments WHERE msg_id = $1', [msgId])).rows[0] || null;
  const r = await query(
    `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status, invoice_number)
     VALUES ($1,$2,$3,$4,'applying',$5)
     ON CONFLICT (msg_id) DO UPDATE SET status = 'applying', invoice_number = $5, resolved_at = NULL
       WHERE manager_payments.status LIKE 'flag%' OR manager_payments.status = 'unmatched'
           OR (manager_payments.status = 'matched_by_staff' AND manager_payments.note ~ '^payment:[0-9]+$' AND manager_payments.note <> 'payment:0'
               AND substring(manager_payments.note from '^payment:([0-9]+)$')::int NOT IN (SELECT id FROM invoice_payments)) RETURNING id`,
    [msgId, p.name, p.amountCents, p.at ? new Date(p.at).toISOString() : null, number]);
  return r.rows[0] ? { id: r.rows[0].id, prev } : null;
}

export class PaymentCheckError extends Error {
  constructor(message, { canOverride = false } = {}) { super(message); this.name = 'PaymentCheckError'; this.code = 'DOUBLE_PAYMENT'; this.status = 409; this.canOverride = canOverride; }
}

// Run `apply()` (which records the payment) behind the check. Only e-transfers are checked; any other method just runs.
//   amount: null = "the whole balance" (mark paid).   override: { by, reason } from an admin who accepts a blocked double.
export async function withPaymentCheck(invoiceId, { method, amount = null, paidDate = null, isAdmin = false, overrideReason = '', by = '', apply }) {
  if (String(method) !== 'etransfer' || !hasDb()) return apply();
  let v;
  try { v = await vetEtransfer(invoiceId, { amount, paidDate }); }
  catch (e) { console.error('payment check failed', e?.message || e); v = { ok: true, verified: false, warnings: ['The payment check could not run, so this is recorded as NOT verified.'] }; }
  const overridden = !v.ok && isAdmin && String(overrideReason || '').trim().length >= 5;
  if (!v.ok && !overridden) throw new PaymentCheckError(v.block, { canOverride: isAdmin });

  let claim = null;
  if (v.ok && v.backing) {
    claim = await claimEmail(v.backing.id, v.backing.p, v.number);
    if (!claim) {
      // Another entry took that very email a moment ago. Look once more; it may have a twin.
      v = await vetEtransfer(invoiceId, { amount, paidDate });
      if (!v.ok) throw new PaymentCheckError(v.block, { canOverride: isAdmin });
      if (v.backing) { claim = await claimEmail(v.backing.id, v.backing.p, v.number); if (!claim) throw new PaymentCheckError('Another payment just used that bank email. Reload the invoice and check what is on it.', { canOverride: false }); }
    }
  }
  let result;
  try { result = await apply(); }
  catch (e) {
    if (claim) await query(claim.prev ? `UPDATE manager_payments SET status = $2, note = $3 WHERE id = $1` : `DELETE FROM manager_payments WHERE id = $1`, claim.prev ? [claim.id, claim.prev.status, claim.prev.note] : [claim.id]).catch(() => {});
    throw e;
  }
  const warnings = [...(v.warnings || [])];
  try {
    const { rows } = await query('SELECT max(id) AS id FROM invoice_payments WHERE invoice_id = $1', [invoiceId]);
    const payId = rows[0]?.id;
    const stamp = overridden ? `Double-payment check overridden${by ? ` by ${by}` : ''}: ${String(overrideReason).trim()}`
      : v.verified ? `Bank e-transfer from ${v.from} matched` : 'NOT verified against a bank e-transfer email';
    if (payId) await query(`UPDATE invoice_payments SET note = concat_ws(' · ', NULLIF(note,''), $2::text) WHERE id = $1`, [payId, stamp]);
    if (claim && payId) await query(`UPDATE manager_payments SET status = 'matched_by_staff', note = $2, resolved_at = now() WHERE id = $1`, [claim.id, `payment:${payId}`]);
    else if (claim) await query(`UPDATE manager_payments SET status = 'matched_by_staff', note = 'payment:0', resolved_at = now() WHERE id = $1`, [claim.id]);
  } catch (e) { console.error('payment stamp failed', e?.message || e); }
  const check = { verified: !!v.verified, from: v.from || null, overridden, warnings };
  return result && typeof result === 'object' ? { ...result, check } : { result, check };
}

// E-transfer entries in the ledger that no bank email backs, so somebody can look at them.
export async function unbackedEtransfers({ days = 10 } = {}) {
  if (!hasDb() || !mailReady()) return { ok: false, reason: 'The service mailbox is not connected.' };
  await ensurePaymentSchema();
  let parsed; try { parsed = await parsedEmails(); } catch (e) { return { ok: false, reason: `I could not read the mailbox: ${e?.message || e}` }; }
  const { rows } = await query(
    `SELECT p.id, p.amount::float AS amount, p.paid_at, p.note, i.number, i.name FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.method = $1 AND p.paid_at > now() - ($2::int * interval '1 day') ORDER BY p.paid_at DESC`, [ETRANSFER, days]);
  const claimedRows = (await query(`SELECT msg_id, note FROM manager_payments WHERE status IN ('paid','paid_by_owner','matched_by_staff','applying')`)).rows;
  const linkedPayments = new Set(claimedRows.map((c) => /^payment:(\d+)$/.exec(c.note || '')?.[1]).filter(Boolean).map(Number));
  // The Manager only ever records an e-transfer it has a bank email for, and an entry made through the check is linked to its email.
  const out = rows.filter((r) => !/by the Manager/i.test(r.note || '') && !linkedPayments.has(r.id))
    .map((r) => ({ id: r.id, number: r.number, name: r.name, note: r.note || '', amountCents: Math.round(r.amount * 100), atMs: r.paid_at ? new Date(r.paid_at).getTime() : null, paidAt: r.paid_at }));
  const pairs = pairStaffEntries(parsed, new Set(claimedRows.map((c) => c.msg_id)), out);
  const paired = new Set([...pairs.values()].map((r) => r.id));
  return { ok: true, entries: out.filter((e) => !paired.has(e.id)).map((e) => ({ invoice: e.number, customer: e.name, amount: e.amountCents / 100, date: e.paidAt ? dayOf(new Date(e.paidAt).getTime()) : null, note: e.note.slice(0, 120) })) };
}

const describe = (p, m) => {
  if (m.kind === 'already_recorded') return `${moneyWords(p.amountCents / 100)} e-transfer from ${p.name}: a payment of that amount is already on ${[...new Set(m.recorded.map((r) => r.number))].join(', ')}, so I did not apply it again (it would fit ${m.candidates.map((c) => c.number).join(', ')})`;
  const who = `${moneyWords(p.amountCents / 100)} e-transfer from ${p.name}`;
  if (m.kind === 'name_mismatch') return `${who} fits ${m.invoice.number} exactly, but the name is different (customer: ${m.invoice.customer})`;
  if (m.kind === 'ambiguous') return `${who} fits ${m.candidates.length} invoices (${m.candidates.map((c) => c.number).join(', ')}) and the name does not pick one`;
  if (m.kind === 'date_mismatch') return `${who} fits ${m.candidates.map((c) => c.number).join(', ')} but arrived before that invoice existed`;
  return `${who} — nothing owes that amount`;
};

// A flag must close once somebody has entered that money by hand. It is paired with its ledger entry under the same
// one-email-one-entry rule, from the stored row, so a flag older than the mailbox search closes too.
export async function settleFlagged() {
  await ensurePaymentSchema();
  const { rows } = await query(`SELECT msg_id, sender, amount_cents, received_at FROM manager_payments WHERE resolved_at IS NULL AND status LIKE 'flag%'`);
  if (!rows.length) return 0;
  const open = rows.map((r) => ({ id: r.msg_id, p: { name: r.sender, amountCents: r.amount_cents, at: r.received_at ? new Date(r.received_at).getTime() : null } }));
  const pairs = pairStaffEntries(open, new Set(), await recentHumanPayments());
  for (const [msgId, entry] of pairs) {
    await query(`UPDATE manager_payments SET status = 'matched_by_staff', note = $2, resolved_at = now() WHERE msg_id = $1 AND resolved_at IS NULL`, [msgId, `payment:${entry.id}`]);
  }
  return pairs.size;
}

// The owner says the flagged e-transfers are already dealt with. No money moves and no invoice changes. Each email
// stays used up, so it can never back another payment. Also returns the ones where an invoice under the same name
// still owes that exact amount, because those may not have been entered after all.
export async function clearFlagged({ by } = {}) {
  if (!by) throw new Error('Who is clearing these?');
  const paired = await settleFlagged();
  const { rows } = await query(
    `UPDATE manager_payments SET status = 'matched_by_staff', note = $1, resolved_at = now()
      WHERE resolved_at IS NULL AND status LIKE 'flag%' RETURNING sender, amount_cents`, [`Cleared by ${by}: already matched`]);
  const pool = await openInvoices();
  const stillOwing = [];
  for (const r of rows) {
    const hit = pool.find((i) => i.balanceCents === r.amount_cents && sameName(r.sender, i.customer));
    if (hit) stillOwing.push({ from: r.sender, amount: r.amount_cents / 100, invoice: hit.number });
  }
  return { paired, cleared: rows.length, stillOwing };
}

export async function scanPayments({ dept = 'sales', dry = false } = {}) {
  if (!hasDb()) return { ok: false, reason: 'No database.' };
  if (!mailReady()) return { ok: false, reason: 'The service mailbox is not connected, so I cannot read payment emails.' };
  await ensurePaymentSchema();
  let parsed;
  try { parsed = await parsedEmails(); }
  catch (e) { return { ok: false, reason: `I could not read the mailbox: ${e?.message || e}` }; }

  if (!dry) await settleFlagged();
  const pool = await openInvoices();
  const consumed =pairStaffEntries(parsed, await claimedIds(), await recentHumanPayments());
  const paid = []; const flagged = []; let seen = 0;
  const { applyPaymentToInvoice } = await import('./manager-tools');
  const { getInvoiceByNumber } = await import('./invoices');

  for (const { id: emailId, p } of parsed) {
    const e = { id: emailId };
    seen++;
    const { rows: ex } = await query('SELECT id, status, resolved_at FROM manager_payments WHERE msg_id = $1', [e.id]);
    if (ex[0] && (ex[0].status === 'paid' || ex[0].resolved_at)) continue;
    if (consumed.has(e.id)) {
      // Staff already entered this payment by hand. This bank email is spoken for: one e-transfer, one entry.
      if (!dry) await query(
        `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status, note, resolved_at) VALUES ($1,$2,$3,$4,'matched_by_staff',$5,now())
         ON CONFLICT (msg_id) DO UPDATE SET status = 'matched_by_staff', note = EXCLUDED.note, resolved_at = now()
           WHERE manager_payments.status LIKE 'flag%'`, [e.id, p.name, p.amountCents, p.at ? new Date(p.at).toISOString() : null, `payment:${consumed.get(e.id)?.id ?? 0}`]);
      continue;
    }
    const m = matchPayment(p, pool);
    const at = p.at ? new Date(p.at).toISOString() : null;

    if (m.kind === 'exact') {
      if (dry) { paid.push({ number: m.invoice.number, amount: p.amountCents / 100, from: p.name, dry: true }); continue; }
      // Claim the message first, so two overlapping scans cannot both apply it.
      const claim = await query(
        `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status, invoice_number)
         VALUES ($1,$2,$3,$4,'applying',$5)
         ON CONFLICT (msg_id) DO UPDATE SET status = 'applying', invoice_number = $5
           WHERE manager_payments.status LIKE 'flag%' OR manager_payments.status = 'unmatched'
           OR (manager_payments.status = 'matched_by_staff' AND manager_payments.note ~ '^payment:[0-9]+$' AND manager_payments.note <> 'payment:0'
               AND substring(manager_payments.note from '^payment:([0-9]+)$')::int NOT IN (SELECT id FROM invoice_payments)) RETURNING id`,
        [e.id, p.name, p.amountCents, at, m.invoice.number]);
      if (!claim.rowCount) continue;
      try {
        const inv = await getInvoiceByNumber(m.invoice.number);
        // Re-read at the last moment: somebody may have entered this very payment since the scan began.
        if (!['open', 'partial'].includes(inv.status) || Math.abs(Number(inv.balance) - p.amountCents / 100) > 0.005) throw new Error(`${inv.number} changed while I was reading, so I left it alone`);
        await applyPaymentToInvoice(inv, {
          amount: p.amountCents / 100, method: 'etransfer', date: p.at ? torontoDay(0, new Date(p.at)) : undefined,
          note: `e-Transfer from ${p.name}, verified by the Manager from the bank's email`
        });
        await query(`UPDATE manager_payments SET status = 'paid' WHERE id = $1`, [claim.rows[0].id]);
        await logAction({
          kind: 'payment_marked', via: 'auto',
          summary: `marked ${m.invoice.number} paid: ${moneyWords(p.amountCents / 100)} e-transfer from ${p.name} (amount, date and name all matched)`,
          detail: { dept, number: m.invoice.number, amount: p.amountCents / 100, from: p.name, msg: e.id }
        });
        paid.push({ number: m.invoice.number, amount: p.amountCents / 100, from: p.name });
        await notifyDone({ summary: `Marked ${m.invoice.number} paid: ${moneyWords(p.amountCents / 100)} e-transfer from ${p.name}, amount, date and name all matched`, dept, by: 'on its own' });
        const k = pool.findIndex((x) => x.number === m.invoice.number); if (k >= 0) pool.splice(k, 1);
      } catch (err) {
        await query(`UPDATE manager_payments SET status = 'flag_error', note = $2 WHERE id = $1`, [claim.rows[0].id, String(err?.message || err).slice(0, 300)]);
        flagged.push({ from: p.name, amount: p.amountCents / 100, why: `could not apply it: ${err?.message || err}` });
      }
      continue;
    }

    const status = `flag_${m.kind === 'none' ? 'unmatched' : m.kind}`;
    const note = describe(p, m);
    if (dry) { flagged.push({ from: p.name, amount: p.amountCents / 100, kind: m.kind, why: note }); continue; }
    const ins = await query(
      `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status, invoice_number, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (msg_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note
       RETURNING (xmax = 0) AS inserted`,
      [e.id, p.name, p.amountCents, at, status, m.invoice?.number || null, note]);
    flagged.push({ from: p.name, amount: p.amountCents / 100, kind: m.kind, why: note });
    if (ins.rows[0]?.inserted) await logAction({ kind: 'payment_flag', via: 'auto', summary: `needs you: ${note}`, detail: { dept, msg: e.id, kind: m.kind } });
  }
  return { ok: true, read: seen, marked_paid: paid, needs_him: flagged };
}

export async function reviewList() {
  if (!hasDb()) return [];
  await ensurePaymentSchema();
  const { rows } = await query(
    `SELECT id, sender, amount_cents, received_at, status, invoice_number, note FROM manager_payments
      WHERE resolved_at IS NULL AND status LIKE 'flag%' ORDER BY id DESC LIMIT 30`);
  return rows.map((r) => ({ payment_id: r.id, from: r.sender, amount: r.amount_cents / 100, arrived: r.received_at, kind: r.status.replace('flag_', ''), note: r.note, possible_invoice: r.invoice_number }));
}

export async function applyFlagged(id, number, { dept = 'sales', callId } = {}) {
  await ensurePaymentSchema();
  const { rows } = await query('SELECT * FROM manager_payments WHERE id = $1', [id]);
  const row = rows[0];
  if (!row || row.resolved_at) return { error: 'That payment is not waiting for a decision.' };
  const { getInvoiceByNumber } = await import('./invoices');
  const inv = await getInvoiceByNumber(String(number).trim().toUpperCase());
  if (!inv) return { error: `I cannot find invoice ${number}.` };
  const amount = row.amount_cents / 100;
  if (!['open', 'partial'].includes(inv.status) || amount > Number(inv.balance) + 0.005) return { error: `${inv.number} is owed ${moneyWords(inv.balance)}; ${moneyWords(amount)} does not fit.` };
  const { applyPaymentToInvoice } = await import('./manager-tools');
  await applyPaymentToInvoice(inv, { amount, method: 'etransfer', date: row.received_at ? torontoDay(0, new Date(row.received_at)) : undefined, note: `e-Transfer from ${row.sender}, applied by the Manager on the owner's word` });
  await query(`UPDATE manager_payments SET status = 'paid_by_owner', invoice_number = $2, resolved_at = now() WHERE id = $1`, [id, inv.number]);
  await logAction({ kind: 'payment_applied', via: 'voice', summary: `applied ${moneyWords(amount)} from ${row.sender} to ${inv.number} on your word`, detail: { dept, id, number: inv.number } });
  return { ok: true, said: `${inv.number} is paid` };
}
