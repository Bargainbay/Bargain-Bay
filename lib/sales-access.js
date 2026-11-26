// Who may use the Sales Hub, in one place. A rep (sales_rep) or an admin — NOT a
// plain sales associate, who has no Hub and stays cost-blind.
//
// The viewer is always built from the SESSION. Nothing a page or an API route
// receives in a request can say whose leads to read.
import { getSession, isAdmin, isSales, isSalesRep, canSeeCost } from './auth';
import { getDailyConfig } from './lead-daily';

export function hubViewer(session) {
  if (!session?.email) return null;
  const admin = isAdmin(session);
  if (!admin && !isSalesRep(session)) return null;
  return { email: session.email, name: session.name || '', admin, canSeeCost: canSeeCost(session) };
}

/** For API routes: the viewer, or null (answer 403). */
export async function requireHub() {
  return hubViewer(await getSession());
}

/**
 * The LEAD LIST only. Besides a rep or an admin, a sales associate who is on the daily call list
 * may open their own leads. Nothing else in the Hub opens to them: `leadsOnly` is checked by the
 * leads page and API, every other page still uses hubViewer, and cost stays hidden.
 */
export async function leadViewer(session) {
  const hub = hubViewer(session);
  if (hub) return hub;
  if (!session?.email || !isSales(session)) return null;
  const { reps } = await getDailyConfig();
  if (!reps.includes(session.email.trim().toLowerCase())) return null;
  return { email: session.email, name: session.name || '', admin: false, canSeeCost: false, leadsOnly: true };
}

export async function requireLeadViewer() {
  return leadViewer(await getSession());
}
