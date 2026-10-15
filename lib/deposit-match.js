// Matching an incoming e-transfer to the order or invoice it pays.
//
// THIS PROPOSES; A PERSON CONFIRMS. Confirming an order starts a vendor's 24-hour clock, sells a
// one-of-a-kind unit and emails people, and a deposit matched to the wrong order does all of that to
// the wrong customer. So the matcher ranks candidates and says how sure it is, and the button is a
// human's. The only thing "sure" changes is which button is highlighted.
//
// Pure scoring is exported (and tested) on its own; the database half is below it.
import { query } from './db';
import { round2 } from './constants';
import { recordInvoicePayment } from './invoices';

// --- pure ----------------------------------------------------------------------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);

/** A bank line that is plausibly a customer's e-transfer. Deliberately generous: a person decides. */
export function looksLikeEtransfer(t) {
  const text = `${t?.name || ''} ${t?.merchant_name || ''} ${t?.original_description || ''}`;
  return /e-?\s?transfer|etfr|interac|e-?tfr/i.test(text);
}

/** Plaid reports money IN as a NEGATIVE amount. Returns null for anything that is not a settled credit. */
export function mapDeposit(t) {
  if (!t || t.pending) return null;
  const amt = Number(t.amount);
  if (!Number.isFinite(amt) || amt >= 0) return null;
  if (!looksLikeEtransfer(t)) return null;
  const cents = Math.round(-amt * 100);
  if (cents <= 0) return null;
  return {
    extId: `plaid:${t.transaction_id}`, receivedOn: t.date, amountCents: cents,
    sender: String(t.merchant_name || t.name || '').slice(0, 160) || null,
    memo: String(t.original_description || '').slice(0, 300) || null
  };
}

/**
 * cand: { kind, ref, name, email, owingCents, createdAt }. Returns { score, why[], exact }.
 */
export function scoreCandidate(dep, cand) {
  const why = []; let score = 0;
  const exact = dep.amountCents === cand.owingCents;
  if (exact) { score += 60; why.push('amount matches exactly'); }
  else if (dep.amountCents < cand.owingCents) { score += 10; why.push('less than the amount owing (a deposit?)'); }
  else { score -= 30; why.push('more than the amount owing'); }
  const text = norm(`${dep.sender || ''} ${dep.memo || ''}`);
  const refKey = norm(cand.ref);
  const refDigits = String(cand.ref || '').replace(/\D/g, '');
  if (refKey && text.includes(refKey)) { score += 40; why.push(`mentions ${cand.ref}`); }
  else if (refDigits.length >= 4 && text.includes(refDigits)) { score += 30; why.push(`mentions ${refDigits}`); }
  const want = tokens(cand.name);
  if (want.length) {
    const hay = `${dep.sender || ''} ${dep.memo || ''}`.toLowerCase();
    const hit = want.filter((w) => hay.includes(w)).length;
    if (hit === want.length) { score += 25; why.push('sender name matches'); }
    else if (hit > 0) { score += 12; why.push('part of the name matches'); }
  }
  if (dep.receivedOn && cand.createdAt) {
    const day = new Date(`${String(dep.receivedOn).slice(0, 10)}T12:00:00Z`).getTime();
    const made = new Date(cand.createdAt).getTime();
    if (day < made - 36 * 3600000) { score -= 20; why.push('arrived before the order was made'); }
  }
  return { score, why, exact };
}

/**
 * Rank candidates. `confidence` is 'sure' only when the amount is exact, something other than the
 * amount agrees (the reference or the whole name), and no other candidate is close — two customers
 * who each owe $1,129.00 are exactly the case where an exact amount proves nothing.
 */
export function rankCandidates(dep, cands) {
  const ranked = cands.map((c) => ({ ...c, ...scoreCandidate(dep, c) }))
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);
  ranked.forEach((c, i) => {
    const next = ranked[i + 1];
    const corroborated = c.why.some((w) => /mentions|sender name matches/.test(w));
    const clear = !next || c.score - next.score >= 25;
    c.confidence = i === 0 && c.exact && corroborated && clear ? 'sure' : c.exact && c.score >= 70 ? 'likely' : 'maybe';
  });
  return ranked;
}

// --- database ------------------------------------------------------------------

export async function recordDeposit(d) {
  const r = await query(
    `INSERT INTO bank_deposits (ext_id, received_on, amount_cents, sender, memo) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (ext_id) DO NOTHING RETURNING id`, [d.extId, d.receivedOn, d.amountCents, d.sender, d.memo]);
  return r.rows.length > 0;
}

/** Who could this have paid? Unpaid storefront e-transfer orders, and open manual invoices. */
export async function openCandidates() {
  const out = [];
  const { rows: ords } = await query(
    `SELECT o.id, o.order_number, o.name, o.email, o.total, o.created_at
       FROM orders o
      WHERE o.status = 'pending_payment' AND o.payment_method = 'etransfer'
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND COALESCE(i.channel,'manual') <> 'web')
        AND o.created_at > now() - interval '45 days'`);
  for (const o of ords) out.push({ kind: 'order', id: o.id, ref: o.order_number, name: o.name, email: o.email, owingCents: Math.round(Number(o.total) * 100), createdAt: o.created_at });
  const { rows: invs } = await query(
    `SELECT i.id, i.number, i.name, i.email, i.total, i.created_at,
            i.total - COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) AS owing
       FROM invoices i
      WHERE i.status IN ('open','partial') AND COALESCE(i.channel,'manual') <> 'web'
        AND i.created_at > now() - interval '120 days'`);
  for (const i of invs) {
    const owing = Math.round(Number(i.owing) * 100);
    if (owing > 0) out.push({ kind: 'invoice', id: i.id, ref: i.number, name: i.name, email: i.email, owingCents: owing, createdAt: i.created_at });
  }
  return out;
}

export async function depositQueue({ status = 'new', limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT id, received_on, amount_cents, sender, memo, status, matched_kind, matched_ref, matched_by, matched_at, note
       FROM bank_deposits WHERE status = $1 ORDER BY received_on DESC, id DESC LIMIT $2`, [status, limit]);
  if (status !== 'new') return rows.map(shape);
  const cands = await openCandidates();
  return rows.map((r) => {
    const dep = shape(r);
    return { ...dep, suggestions: rankCandidates(dep, cands).slice(0, 3).map(({ kind, id, ref, name, owingCents, confidence, why, score }) => ({ kind, id, ref, name, owingCents, confidence, why, score })) };
  });
}
const shape = (r) => ({
  id: Number(r.id), receivedOn: String(r.received_on instanceof Date ? r.received_on.toISOString() : r.received_on).slice(0, 10),
  amountCents: Number(r.amount_cents), sender: r.sender, memo: r.memo, status: r.status,
  matchedKind: r.matched_kind, matchedRef: r.matched_ref, matchedBy: r.matched_by, matchedAt: r.matched_at, note: r.note
});

/**
 * A person says "this deposit paid that". The deposit is claimed first (so two screens cannot both act on
 * it) and handed back if the payment is refused.
 */
export async function confirmDeposit(depositId, { kind, id, by }) {
  if (!by) throw new Error('Who is confirming this?');
  const claim = await query(
    `UPDATE bank_deposits SET status = 'matched', matched_by = $2, matched_at = now() WHERE id = $1 AND status = 'new' RETURNING *`, [depositId, by]);
  if (!claim.rows.length) throw new Error('That deposit has already been dealt with.');
  const dep = claim.rows[0];
  const cents = Number(dep.amount_cents);
  const release = () => query(`UPDATE bank_deposits SET status = 'new', matched_by = NULL, matched_at = NULL WHERE id = $1`, [depositId]);
  try {
    let ref;
    if (kind === 'order') {
      const { rows } = await query(`SELECT id, order_number, status, total FROM orders WHERE id = $1`, [Number(id)]);
      const o = rows[0];
      if (!o) throw new Error('Order not found.');
      if (o.status !== 'pending_payment') throw new Error(`${o.order_number} is already ${String(o.status).replace('_', ' ')}.`);
      if (Math.round(Number(o.total) * 100) !== cents) throw new Error(`${o.order_number} is $${Number(o.total).toFixed(2)} but this deposit is $${(cents / 100).toFixed(2)}. Mark it paid by hand if that is right.`);
      const { updateOrderStatus } = await import('./orders');
      await updateOrderStatus(o.id, 'confirmed');
      ref = o.order_number;
    } else if (kind === 'invoice') {
      const { rows } = await query(`SELECT id, number, status FROM invoices WHERE id = $1`, [Number(id)]);
      const inv = rows[0];
      if (!inv) throw new Error('Invoice not found.');
      await recordInvoicePayment(inv.id, { amount: round2(cents / 100), method: 'etransfer', paidDate: String(dep.received_on instanceof Date ? dep.received_on.toISOString() : dep.received_on).slice(0, 10), note: `Bank deposit #${dep.id}` });
      ref = inv.number;
    } else throw new Error('Choose an order or an invoice.');
    await query(`UPDATE bank_deposits SET matched_kind = $2, matched_ref = $3 WHERE id = $1`, [depositId, kind, ref]);
    return { ok: true, ref };
  } catch (e) { await release().catch(() => {}); throw e; }
}

export async function ignoreDeposit(depositId, { by, note }) {
  const r = await query(`UPDATE bank_deposits SET status = 'ignored', matched_by = $2, matched_at = now(), note = $3 WHERE id = $1 AND status = 'new' RETURNING id`, [depositId, by, note || null]);
  if (!r.rows.length) throw new Error('That deposit has already been dealt with.');
  return { ok: true };
}
