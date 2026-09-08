// The money a driver comes back with, and the moment it becomes a payment.
//
// It used to become one at the door. The driver ticked "collected", tapped Done,
// and the invoice was marked PAID before anyone in the office had seen a note of
// it: revenue booked, receipt emailed to the customer, ledger locked. Every one
// of those is hard to walk back, and all of it rested on a tick box on a phone
// in a van.
//
// So a door collection is now a CLAIM. The driver reports what they took; the
// invoice stays open; the office confirms it against the cash they are holding
// (or the e-transfer that actually landed), and THAT is what records the
// payment through the ordinary invoice ledger — same function the Invoices page
// calls, so there is still exactly one way money gets recorded.
//
// Three states and no more: pending, confirmed, rejected. A rejected claim
// leaves the invoice untouched and the balance owing, which is the correct
// answer when the driver's $500 never reaches the office.
import { hasDb, query } from './db';
import { round2, money } from './constants';
import { recordInvoicePayment, PAYMENT_METHODS } from './invoices';
import { ensureJobSchema, jobInvoiceForPayment, noteJobEvent } from './jobs';

const clean = (v, n) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, n) : null;
};

const shape = (r) => ({
  id: r.id, jobId: r.job_id, invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number || null,
  amount: round2(Number(r.amount) || 0),
  method: r.method,
  methodLabel: PAYMENT_METHODS[r.method] || r.method,
  note: r.note || null,
  status: r.status,
  collectedAt: r.collected_at ? new Date(r.collected_at).toISOString() : null,
  byName: r.by_name || null
});

// The day a collection happened, Toronto, as the invoice ledger wants it. Money
// counts on the day it was handed over — not the day the office got round to
// confirming it — or a Saturday run lands in the wrong week's revenue.
const collectedOn = (row) =>
  new Date(row.collected_at || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

// ── The driver's side ────────────────────────────────────────────────────────

/**
 * Record what the driver says they took at the door. Writes NO payment: the
 * invoice is untouched and still shows the balance owing.
 *
 * `ref` is the offline queue's id for this report — a phone that finishes a stop
 * with no signal re-sends the whole close-out later, and without the ref the
 * office is asked to confirm the same money twice.
 */
export async function recordDoorCollection(jobId, { amount, method, note, ref } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const key = String(method || '').trim();
  if (!PAYMENT_METHODS[key]) throw new Error(`Pick a valid payment method: ${Object.keys(PAYMENT_METHODS).join(', ')}.`);
  const amt = round2(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('The amount collected must be a positive dollar figure.');

  // A replay of something already reported is answered, not written again.
  const tag = clean(ref, 80);
  if (tag) {
    const { rows } = await query('SELECT * FROM job_collections WHERE ref = $1', [tag]);
    if (rows.length) return { ...shape(rows[0]), pending: rows[0].status === 'pending', duplicate: true };
  }

  const target = await jobInvoiceForPayment(jobId);
  // Everything already reported on this invoice and not yet judged. Two stops on
  // one order, or a driver who taps twice, must not be able to claim more than
  // the invoice is worth.
  const { rows: open } = await query(
    `SELECT COALESCE(SUM(amount), 0) AS claimed FROM job_collections
      WHERE invoice_id = $1 AND status = 'pending'`,
    [target.invoiceId]
  );
  const claimed = round2(Number(open[0]?.claimed) || 0);
  const room = round2(target.balance - claimed);
  if (amt > room + 0.005) {
    throw new Error(claimed > 0
      ? `${money(claimed)} is already waiting to be confirmed on ${target.invoiceNumber} — only ${money(room)} of it is still unaccounted for.`
      : `That's more than the ${money(target.balance)} owing on ${target.invoiceNumber}.`);
  }

  const { rows } = await query(
    `INSERT INTO job_collections
       (job_id, invoice_id, invoice_number, amount, method, note, ref, by_email, by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [Number(jobId), target.invoiceId, target.invoiceNumber, amt, key, clean(note, 300), tag,
     clean(by?.email, 160)?.toLowerCase() || null, clean(by?.name, 120)]
  );

  await noteJobEvent(
    jobId, 'collected',
    `${PAYMENT_METHODS[key]} ${money(amt)} reported collected at the door on ${target.invoiceNumber}`
    + ' — waiting on the office to confirm it',
    by
  );

  return { ...shape(rows[0]), pending: true, balance: target.balance, invoiceNumber: target.invoiceNumber };
}

// ── The office's side ────────────────────────────────────────────────────────

/**
 * The money is in. Records it against the invoice through the ordinary ledger —
 * which is what marks the invoice paid, books the revenue and sends the receipt.
 *
 * Dated to the day it was COLLECTED, not the day it was confirmed.
 */
export async function confirmDoorCollection(id, by, { amount, method } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  // Claim the row first. Two people confirming the same $500 from two screens
  // would otherwise record it twice, and the second one is a refund to unpick.
  const { rows } = await query(
    `UPDATE job_collections
        SET status = 'confirmed', settled_at = now(), settled_by_email = $2, settled_by_name = $3
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [Number(id), clean(by?.email, 160)?.toLowerCase() || null, clean(by?.name, 120)]
  );
  if (!rows.length) {
    const { rows: cur } = await query('SELECT status FROM job_collections WHERE id = $1', [Number(id)]);
    if (!cur.length) throw new Error('That collection is no longer on the list.');
    throw new Error(`That money has already been ${cur[0].status === 'confirmed' ? 'confirmed' : 'marked not received'}.`);
  }
  const row = rows[0];

  // The office can correct what the driver typed — a $500 claim that turns out
  // to be $480 in the envelope is confirmed as $480, not argued about later.
  const amt = amount == null || amount === '' ? row.amount : round2(Number(amount));
  const key = String(method || row.method || '').trim();

  try {
    const r = await recordInvoicePayment(row.invoice_id, {
      amount: amt, method: key, paidDate: collectedOn(row),
      note: row.note || 'Collected at the door'
    });
    if (round2(Number(amt)) !== round2(Number(row.amount)) || key !== row.method) {
      await query('UPDATE job_collections SET amount = $2, method = $3 WHERE id = $1', [row.id, amt, key]);
    }
    await noteJobEvent(
      row.job_id, 'payment',
      `${PAYMENT_METHODS[key] || 'Payment'} ${money(amt)} confirmed received on ${row.invoice_number}`
      + (r.fullyPaid ? ' — paid in full' : ` — ${money(r.balance)} still owing`),
      by
    );
    return { ok: true, collection: shape({ ...row, amount: amt, method: key }), invoice: r };
  } catch (e) {
    // The ledger refused it, so this was never confirmed. Put it back on the
    // queue rather than losing the driver's report to a failed write.
    await query(
      `UPDATE job_collections SET status = 'pending', settled_at = NULL,
              settled_by_email = NULL, settled_by_name = NULL WHERE id = $1`,
      [row.id]
    ).catch(() => {});
    throw e;
  }
}

/**
 * It never arrived — or it was reported twice, or against the wrong stop. The
 * invoice is left exactly as it was, still owing, which is the whole point.
 */
export async function rejectDoorCollection(id, by, note) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const { rows } = await query(
    `UPDATE job_collections
        SET status = 'rejected', settled_at = now(), settled_by_email = $2,
            settled_by_name = $3, settled_note = $4
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [Number(id), clean(by?.email, 160)?.toLowerCase() || null, clean(by?.name, 120), clean(note, 300)]
  );
  if (!rows.length) throw new Error('That collection has already been dealt with.');
  const row = rows[0];
  await noteJobEvent(
    row.job_id, 'payment',
    `${PAYMENT_METHODS[row.method] || 'Payment'} ${money(row.amount)} reported on ${row.invoice_number} `
    + `was NOT received${row.settled_note ? `: ${row.settled_note}` : ''} — the balance is still owing`,
    by
  );
  return { ok: true, collection: shape(row) };
}

/**
 * What's waiting to be confirmed on these invoices — so the Invoices page can
 * say "the driver reports $500" instead of showing a silently unpaid invoice.
 */
export async function pendingCollectionsForInvoices(invoiceIds = []) {
  const ids = [...new Set(invoiceIds.filter((n) => Number.isFinite(Number(n))).map(Number))];
  if (!hasDb() || !ids.length) return new Map();
  try {
    const { rows } = await query(
      `SELECT c.*, j.job_number FROM job_collections c
         JOIN jobs j ON j.id = c.job_id
        WHERE c.invoice_id = ANY($1) AND c.status = 'pending'
        ORDER BY c.collected_at, c.id`,
      [ids]
    );
    const out = new Map();
    for (const r of rows) {
      if (!out.has(r.invoice_id)) out.set(r.invoice_id, []);
      out.get(r.invoice_id).push({ ...shape(r), jobNumber: r.job_number });
    }
    return out;
  } catch (e) {
    // A database that has never seen a driver has no table yet, and an invoice
    // list is not allowed to fail over that.
    console.error('pending collections for invoices failed', e.message);
    return new Map();
  }
}
