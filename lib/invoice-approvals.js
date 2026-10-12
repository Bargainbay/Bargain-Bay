// A rep asks an admin to approve a sale the consignment floor refused.
//
// Before this, the refusal said "ask an admin to approve the exception" and
// nothing carried the ask: no record, no email, nothing on the dashboard. The rep
// had to walk over, and the admin re-typed the sale.
//
// Rules that must hold:
//  * The REQUEST holds the invoice exactly as the rep typed it (`payload`). It is
//    never edited, so what the admin approves is what was asked for.
//  * Approving RAISES the invoice, credited to the REP who asked — the rep
//    leaderboard, `created_by` and lead source all read who made the sale, not who
//    clicked approve. The approver goes on the request row and in the audit log.
//  * A request is claimed with `UPDATE ... WHERE status = 'pending'` before any
//    work, so two admins (or two tabs) cannot raise the same invoice twice. If the
//    invoice then fails to raise (the unit sold meanwhile, say) the claim is put
//    back, so the request is not lost and the admin is told why.
//  * The floor is re-checked when the request is FILED, server-side. A client
//    saying "this was refused" is not taken as read: an under-floor request is the
//    only kind that can exist.
//  * Staff see only their own requests. The floor and the vendor's cost are in the
//    reason text, which is why a rep is shown the rep-visible message only.
import crypto from 'node:crypto';
import { hasDb, query } from './db';
import { priceInvoice, createAndSendInvoice } from './invoices';
import { consignmentFloorProblem } from './consignment';
import { sendEmail, esc } from './email';
import { SERVICE_EMAIL, money } from './constants';
import { SITE_URL } from './site';
import { audit } from './audit';

// The fields of an invoice body that mean something. Anything else a client sent
// (belowFloorOk especially) is dropped: the approval IS the override.
const KEEP = ['name', 'email', 'items', 'addHst', 'taxInclusive', 'daysUntilDue', 'memo', 'deliveryMethod',
  'address', 'city', 'postal', 'phone', 'sendEmail', 'invoiceDate', 'leadSource', 'leadBy'];

export function cleanPayload(body = {}) {
  const out = {};
  for (const k of KEEP) if (body[k] !== undefined) out[k] = body[k];
  out.addHst = !!out.addHst;
  out.taxInclusive = !!out.taxInclusive;
  return out;
}

const hashOf = (payload) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);

export const approvalsNotifyTo = () => process.env.APPROVAL_NOTIFY_TO || process.env.SERVICE_EMAIL || SERVICE_EMAIL;

// What a request looks like on a screen. `reason` carries the vendor's cost and the
// floor, so it is only included for an admin.
function shape(r, { admin }) {
  return {
    id: Number(r.id), status: r.status, requestedBy: r.requested_by, requestedName: r.requested_name,
    requestedAt: r.requested_at, customer: r.customer, total: r.total == null ? null : Number(r.total),
    repNote: r.rep_note || '', decidedName: r.decided_name || r.decided_by || '', decidedAt: r.decided_at,
    decisionNote: r.decision_note || '', invoiceNumber: r.invoice_number || '',
    ...(admin ? { reason: r.reason, payload: r.payload } : {
      reason: 'Under the floor on a vendor drop-off unit.', payload: undefined
    })
  };
}

/** File a request. Returns { id, existing } — filing the same sale twice returns the first. */
export async function requestApproval(session, body, { note = '' } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  const payload = cleanPayload(body);
  // Same conversion the invoice itself will go through, so a tax-inclusive sale is
  // compared like for like against a tax-in cost.
  const priced = priceInvoice(payload.items || [], { addHst: payload.addHst, taxInclusive: payload.taxInclusive && payload.addHst });
  const reason = await consignmentFloorProblem(priced.lineItems);
  if (!reason) {
    const e = new Error('That sale is not under the floor, so it does not need approval — just create it.');
    e.code = 'NOT_BELOW_FLOOR';
    throw e;
  }
  const who = String(session?.email || '').trim().toLowerCase();
  if (!who) throw new Error('Sign in again to ask for approval.');
  const hash = hashOf(payload);
  const dup = await query(
    `SELECT id FROM invoice_approval_requests WHERE requested_by = $1 AND payload_hash = $2 AND status = 'pending'`, [who, hash]);
  if (dup.rows.length) return { id: Number(dup.rows[0].id), existing: true };
  const { rows } = await query(
    `INSERT INTO invoice_approval_requests (requested_by, requested_name, payload, payload_hash, reason, customer, total, rep_note)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8) RETURNING id`,
    [who, session?.name || null, JSON.stringify(payload), hash, reason, payload.name || payload.email || null,
     priced.total, String(note || '').trim().slice(0, 500) || null]);
  const id = Number(rows[0].id);
  await audit(session, { action: 'invoice.approval_requested', entity: 'invoice_approval', entityId: id,
    summary: `Asked to approve a below-floor sale to ${payload.name || payload.email}, ${money(priced.total)}`, detail: { total: priced.total } });
  await notifyAdmin({ id, session, payload, total: priced.total, reason, note }).catch((e) => console.error('approval email failed', e?.message || e));
  return { id, existing: false };
}

async function notifyAdmin({ id, session, payload, total, reason, note }) {
  const rep = session?.name || session?.email || 'A rep';
  const lines = (payload.items || []).filter((i) => i?.description).map((i) => `<li>${esc(i.description)} — ${esc(money(Number(i.amount) || 0))}</li>`).join('');
  await sendEmail({
    to: approvalsNotifyTo(),
    subject: `Approval needed: ${rep} — ${payload.name || payload.email}, ${money(total)}`,
    html: `<p><b>${esc(rep)}</b> wants to sell below the consignment floor and needs your OK.</p>
      <p>Customer: <b>${esc(payload.name || '')}</b> ${esc(payload.email || '')}<br>Total (tax in): <b>${esc(money(total))}</b></p>
      <ul>${lines}</ul>
      <p style="color:#a00">${esc(reason)}</p>
      ${note ? `<p>Rep's note: ${esc(note)}</p>` : ''}
      <p><a href="${SITE_URL}/admin/dashboard#approvals">Approve or reject on your dashboard →</a></p>
      <p style="color:#666;font-size:12px">Approving raises and sends the invoice to the customer straight away, credited to ${esc(rep)}.</p>`
  });
}

/** Pending ones (admin: all; staff: their own, any status, recent). */
export async function listApprovals(session, { admin = false, limit = 30 } = {}) {
  if (!hasDb()) return [];
  const who = String(session?.email || '').trim().toLowerCase();
  const { rows } = admin
    ? await query(
        `SELECT * FROM invoice_approval_requests
          WHERE status = 'pending' OR decided_at > now() - interval '3 days'
          ORDER BY (status = 'pending') DESC, requested_at DESC LIMIT $1`, [limit])
    : await query(
        `SELECT * FROM invoice_approval_requests
          WHERE requested_by = $1 AND (status = 'pending' OR decided_at > now() - interval '7 days')
          ORDER BY requested_at DESC LIMIT $2`, [who, limit]);
  return rows.map((r) => shape(r, { admin }));
}

export async function pendingApprovalCount() {
  if (!hasDb()) return 0;
  try {
    const { rows } = await query(`SELECT count(*)::int AS n FROM invoice_approval_requests WHERE status = 'pending'`);
    return rows[0]?.n || 0;
  } catch { return 0; }
}

async function claim(id, status, session, note) {
  const { rows } = await query(
    `UPDATE invoice_approval_requests
        SET status = $2, decided_by = $3, decided_name = $4, decided_at = now(), decision_note = $5
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, status, String(session?.email || '').toLowerCase(), session?.name || null, String(note || '').trim().slice(0, 500) || null]);
  return rows[0] || null;
}

/** Approve: raise the invoice as the rep, and send it. */
export async function approveRequest(id, session, { note = '', raise = createAndSendInvoice } = {}) {
  const row = await claim(id, 'approved', session, note);
  if (!row) throw new Error('That request is no longer waiting — somebody already answered it.');
  const p = row.payload || {};
  try {
    const invoice = await raise({
      name: String(p.name || '').trim(), email: p.email, items: p.items || [],
      addHst: !!p.addHst, taxInclusive: !!p.taxInclusive,
      daysUntilDue: p.daysUntilDue, memo: p.memo, deliveryMethod: p.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
      address: p.address, city: p.city, postal: p.postal, phone: p.phone,
      sendEmail: p.sendEmail !== false, invoiceDate: p.invoiceDate,
      // The rep who made the sale gets the credit; the approver is on the request.
      createdBy: { email: row.requested_by, name: row.requested_name },
      leadSource: p.leadSource, leadBy: p.leadBy
    });
    await query(`UPDATE invoice_approval_requests SET invoice_id = $2, invoice_number = $3 WHERE id = $1`, [id, invoice?.id || null, invoice?.number || null]);
    await audit(session, { action: 'invoice.below_floor_approved', entity: 'invoice', entityId: invoice?.number,
      summary: `Approved below-floor sale for ${row.requested_name || row.requested_by}, total ${invoice?.total ?? '?'}`,
      detail: { requestId: id, requestedBy: row.requested_by, total: invoice?.total ?? null, reason: row.reason } });
    await tellRep(row, `Approved — invoice ${invoice?.number} was raised${p.sendEmail !== false ? ' and emailed to the customer' : ''}.`, note);
    return { invoice };
  } catch (e) {
    // Put it back: a request that errored is still a request somebody has to answer.
    await query(`UPDATE invoice_approval_requests SET status = 'pending', decided_by = NULL, decided_name = NULL, decided_at = NULL, decision_note = NULL WHERE id = $1`, [id]).catch(() => {});
    throw e;
  }
}

export async function rejectRequest(id, session, { note = '' } = {}) {
  const row = await claim(id, 'rejected', session, note);
  if (!row) throw new Error('That request is no longer waiting — somebody already answered it.');
  await audit(session, { action: 'invoice.below_floor_rejected', entity: 'invoice_approval', entityId: id,
    summary: `Rejected below-floor sale for ${row.requested_name || row.requested_by}`, detail: { note: note || null } });
  await tellRep(row, 'Not approved. Raise the price or talk to the owner.', note);
  return { ok: true };
}

/** The rep takes back their own ask. */
export async function withdrawRequest(id, session) {
  const { rows } = await query(
    `UPDATE invoice_approval_requests SET status = 'withdrawn', decided_at = now(), decided_by = $2
      WHERE id = $1 AND status = 'pending' AND requested_by = $2 RETURNING id`, [id, String(session?.email || '').toLowerCase()]);
  if (!rows.length) throw new Error('That request is not waiting any more.');
  return { ok: true };
}

async function tellRep(row, headline, note) {
  try {
    await sendEmail({
      to: row.requested_by,
      subject: `${headline.startsWith('Approved') ? 'Approved' : 'Not approved'}: ${row.customer || 'your sale'}`,
      html: `<p>${esc(headline)}</p>${note ? `<p>Note: ${esc(note)}</p>` : ''}<p>Customer: ${esc(row.customer || '')}, ${esc(money(Number(row.total) || 0))}.</p>`
    });
  } catch (e) { console.error('approval reply email failed', e?.message || e); }
}
