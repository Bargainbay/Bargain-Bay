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
import { matchPayment, moneyWords } from './manager-policy';
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

const describe = (p, m) => {
  const who = `${moneyWords(p.amountCents / 100)} e-transfer from ${p.name}`;
  if (m.kind === 'name_mismatch') return `${who} fits ${m.invoice.number} exactly, but the name is different (customer: ${m.invoice.customer})`;
  if (m.kind === 'ambiguous') return `${who} fits ${m.candidates.length} invoices (${m.candidates.map((c) => c.number).join(', ')}) and the name does not pick one`;
  if (m.kind === 'date_mismatch') return `${who} fits ${m.candidates.map((c) => c.number).join(', ')} but arrived before that invoice existed`;
  return `${who} — nothing owes that amount`;
};

export async function scanPayments({ dept = 'sales', dry = false } = {}) {
  if (!hasDb()) return { ok: false, reason: 'No database.' };
  if (!gmailConfigured()) return { ok: false, reason: 'The service mailbox is not connected, so I cannot read payment emails.' };
  await ensurePaymentSchema();
  let mail;
  try { mail = await listSubjects(INBOX(), { query: SCAN_QUERY, max: 100 }); }
  catch (e) { return { ok: false, reason: `I could not read the mailbox: ${e?.message || e}` }; }

  const pool = await openInvoices();
  const paid = []; const flagged = []; let seen = 0;
  const { applyPaymentToInvoice } = await import('./manager-tools');
  const { getInvoiceByNumber } = await import('./invoices');

  for (const e of mail.emails || []) {
    const p = parseInteracReceived(e);
    if (!p) continue;
    seen++;
    const { rows: ex } = await query('SELECT id, status, resolved_at FROM manager_payments WHERE msg_id = $1', [e.id]);
    if (ex[0] && (ex[0].status === 'paid' || ex[0].resolved_at)) continue;
    const m = matchPayment(p, pool);
    const at = p.at ? new Date(p.at).toISOString() : null;

    if (m.kind === 'exact') {
      if (dry) { paid.push({ number: m.invoice.number, amount: p.amountCents / 100, from: p.name, dry: true }); continue; }
      // Claim the message first, so two overlapping scans cannot both apply it.
      const claim = await query(
        `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status, invoice_number)
         VALUES ($1,$2,$3,$4,'applying',$5)
         ON CONFLICT (msg_id) DO UPDATE SET status = 'applying', invoice_number = $5
           WHERE manager_payments.status LIKE 'flag%' OR manager_payments.status = 'unmatched' RETURNING id`,
        [e.id, p.name, p.amountCents, at, m.invoice.number]);
      if (!claim.rowCount) continue;
      try {
        const inv = await getInvoiceByNumber(m.invoice.number);
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
