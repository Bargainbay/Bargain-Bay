// One answer to "what is this person allowed to do on dispatch", asked by every
// dispatch surface: the board, the run sheet, the POD, and the API behind them.
//
// It exists so the rule is written once. Dispatch has three kinds of user and
// they are easy to mix up:
//
//   admin        — the owner. Everything, here and everywhere else.
//   coordinator  — the dispatch hire (lib/dispatchers.js). Everything HERE and
//                  nothing anywhere else in the app.
//   sales        — takes orders, can put a stop on the board, must not see what
//                  we charge, pay, or make. Unchanged by this file's existence.
//
// `full` is the flag to branch on inside dispatch; it means "admin-equivalent
// here", which is true of the owner and of the coordinator. Use `isAdmin(session)`
// directly — never `full` — for the one thing that is not a dispatch operation:
// granting somebody else access to this portal.
import { getSession, isAdmin, isStaff } from './auth';
import { isDispatcher } from './dispatchers';

export async function dispatchAccess() {
  const session = await getSession();
  if (!session) return { session: null, allowed: false, full: false, coordinator: false };
  // Admin first, and without touching the database: the owner must be able to
  // open the board even when the access table is unreachable.
  if (isAdmin(session)) return { session, allowed: true, full: true, coordinator: false };
  if (await isDispatcher(session)) return { session, allowed: true, full: true, coordinator: true };
  if (isStaff(session)) return { session, allowed: true, full: false, coordinator: false };
  return { session, allowed: false, full: false, coordinator: false };
}
