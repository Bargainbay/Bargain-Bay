// Who sent a lead, and putting that on the customer the lead becomes. Imports only ./db so lib/leads.js can use it
// without a cycle (lib/partner-leads.js imports lib/leads.js for LeadError).
import { query } from './db';
import { phoneKey } from './constants';
import { upsertCustomer } from './customers';
import { LEAD_CREDIT_DAYS } from './partner-lead-rules';

/** { partner_email, partner_member_email } for a partner lead, else null. Soft-fails to null (the columns may not exist yet). */
export async function partnerOfLead(leadId) {
  try {
    const { rows } = await query(`SELECT partner_email, partner_member_email FROM leads WHERE id = $1 AND partner_email IS NOT NULL`, [Number(leadId)]);
    return rows[0] || null;
  } catch { return null; }
}

/**
 * Put the sending partner and generator on the customer — only if the customer has no partner yet. A customer already under
 * someone is NEVER moved (same rule as every other way of attaching a partner).
 */
export async function stampPartnerOnCustomer(customerId, p) {
  try {
    await query(
      `UPDATE customers SET partner_email = $2, partner_member_email = $3, partner_set_by = 'lead', partner_set_at = now()
        WHERE id = $1 AND partner_email IS NULL`, [Number(customerId), p.partner_email, p.partner_member_email]);
  } catch { /* the lead is already linked; a missing column must not fail the conversion */ }
}

const lower = (e) => String(e || '').trim().toLowerCase();

/** A lead that did not die as junk or a wrong number, sent inside the credit window. */
const CREDITABLE = `l.partner_email IS NOT NULL AND NOT (l.stage = 'lost' AND l.lost_reason IN ('junk', 'wrong_number'))
  AND l.submitted_at > now() - interval '${LEAD_CREDIT_DAYS} days'`;

/**
 * At checkout: was this buyer sent to us as a partner lead? If so (and they are not already under a partner) they become that
 * partner's and that generator's customer, and the lead is linked to them. FIRST IN TIME WINS, so the earliest creditable lead
 * is the one used. Returns { attached, found }: `found` means a lead exists, so the caller must not hand the credit to a code.
 */
export async function attachFromLeadForOrder({ email, name, phone, userId } = {}) {
  try {
    const e = lower(email) || null; const pk = phoneKey(phone);
    if (!e && !pk) return { attached: false, found: false };
    const lead = (await query(
      `SELECT l.id, l.partner_email, l.partner_member_email, l.customer_id FROM leads l
        WHERE ${CREDITABLE} AND (($1::text IS NOT NULL AND lower(l.email) = $1) OR ($2::text IS NOT NULL AND l.phone_key = $2))
        ORDER BY l.submitted_at LIMIT 1`, [e, pk])).rows[0];
    if (!lead) return { attached: false, found: false };
    // A partner's own team buying for themselves earns nobody anything.
    const own = (await query(`SELECT 1 FROM referral_partners WHERE email = $1 UNION ALL SELECT 1 FROM partner_members WHERE member_email = $1 AND removed_at IS NULL`, [e])).rows[0];
    if (own) return { attached: false, found: true, own: true };
    const id = await upsertCustomer({ email, name, phone, userId });
    if (!id) return { attached: false, found: true };
    const r = await query(
      `UPDATE customers SET partner_email = $2, partner_member_email = $3, partner_set_by = 'lead', partner_set_at = now()
        WHERE id = $1 AND partner_email IS NULL RETURNING id`, [id, lead.partner_email, lead.partner_member_email]);
    if (!lead.customer_id) await query(`UPDATE leads SET customer_id = $2, updated_at = now() WHERE id = $1 AND customer_id IS NULL`, [lead.id, id]);
    return { attached: !!r.rows[0], found: true, partner: lead.partner_email };
  } catch { return { attached: false, found: false }; }
}

/**
 * Nightly/hourly safety net for the rep who forgot to press Convert: a creditable partner lead whose person has since become a
 * customer is linked to them (so its status can read Sold) and the customer is stamped with the partner, unless somebody else
 * already has them. The customer must have appeared AFTER the lead was sent: anybody already on file was refused at submit.
 */
export async function reconcilePartnerLeads() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (l.id) l.id, l.partner_email, l.partner_member_email, c.id AS cid
         FROM leads l
         JOIN customers c ON (l.email IS NOT NULL AND lower(c.email) = lower(l.email)) OR (l.phone_key IS NOT NULL AND c.phone_key = l.phone_key)
        WHERE l.customer_id IS NULL AND ${CREDITABLE} AND c.created_at >= l.submitted_at
        ORDER BY l.id, c.id`);
    let linked = 0;
    for (const r of rows) {
      await query(`UPDATE leads SET customer_id = $2, updated_at = now() WHERE id = $1 AND customer_id IS NULL`, [r.id, r.cid]);
      await stampPartnerOnCustomer(r.cid, { partner_email: r.partner_email, partner_member_email: r.partner_member_email });
      linked += 1;
    }
    return { linked };
  } catch { return { linked: 0 }; }
}
