// Who may use the Sales Hub, in one place. A rep (sales_rep) or an admin — NOT a
// plain sales associate, who has no Hub and stays cost-blind.
//
// The viewer is always built from the SESSION. Nothing a page or an API route
// receives in a request can say whose leads to read.
import { getSession, isAdmin, isSalesRep, canSeeCost } from './auth';

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
