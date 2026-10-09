// Claim deadline state, with no imports: the staff and seller screens run it in the browser.
const OPEN = ['open', 'responded', 'awaiting_refund'];
const t = (v) => new Date(v).getTime();

/** Overdue is judged by what the seller still owes: an answer while it is unanswered, a resolution until they have done their part. */
export function claimState(c, now = new Date()) {
  if (!OPEN.includes(c.status)) return { overdue: false, label: String(c.status).replace('_', ' ') };
  if (c.status === 'open' && !c.vendorRespondedAt && t(c.respondBy) < now.getTime()) return { overdue: true, label: 'response overdue' };
  if (!c.vendorDoneAt && t(c.resolveBy) < now.getTime()) return { overdue: true, label: 'resolution overdue' };
  return { overdue: false, label: String(c.status).replace('_', ' ') };
}
