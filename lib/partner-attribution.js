// Who sent a lead, and putting that on the customer the lead becomes. Imports only ./db so lib/leads.js can use it
// without a cycle (lib/partner-leads.js imports lib/leads.js for LeadError).
import { query } from './db';

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
