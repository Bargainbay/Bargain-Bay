// Who is talking to the assistant, and which teams' tools that gives them.
//
// IDENTITY COMES FROM THE SIGN-IN, NEVER FROM THE CONVERSATION. A driver asking
// "what's my next stop" is answered from THEIR userId; nothing they say can make
// the assistant read another driver's run. Same for cost: a rep who asks what a
// unit cost gets told it is not theirs to see, because the tools that would
// answer are not in their hands — the model can't call what it wasn't given.
//
// The teams follow the gates the screens already use:
//   driver    — users.is_driver (the /driver app)
//   sales     — SALES_EMAILS / ADMIN_EMAILS (the selling surfaces)
//   warehouse — any staff account (/admin/warehouse and /admin/parts are staff),
//               or an RS Ops crew member arriving through /api/ops/assistant
// A dispatch coordinator is on none of them and gets nothing here yet — adding
// them is a deliberate step, not a side effect (see CLAUDE.md, dispatch portal).
import { isAdmin, isSales } from '../auth';
import { isDriver } from '../drivers';

export const TEAMS = {
  driver: 'Delivery & service drivers',
  sales: 'Sales',
  warehouse: 'Warehouse, refurb & parts'
};

export async function personFromSession(session, { channel = 'web' } = {}) {
  if (!session?.userId) return null;
  const admin = isAdmin(session);
  const sales = isSales(session); // admin implies sales
  const teams = [];
  if (await isDriver(session)) teams.push('driver');
  if (sales) teams.push('sales');
  if (sales) teams.push('warehouse');
  if (!teams.length) return null;
  return {
    key: `user:${session.userId}`,
    userId: session.userId,
    email: session.email || null,
    name: session.name || session.email || 'there',
    teams,
    admin,
    channel
  };
}

// An RS Ops crew member. RS Ops signs people in by PIN and they have no account
// here; the shared RSOPS_INTAKE_KEY proves the request came from RS Ops, not
// which person is holding the phone — so the name is labelled for what it is,
// exactly as the warehouse scan route already does.
export function personFromRsops({ name, role } = {}) {
  const who = String(name || '').trim().slice(0, 60);
  if (!who) return null;
  return {
    key: `rsops:${who.toLowerCase()}`,
    userId: null,
    email: null,
    name: `${who} (RS Ops)`,
    rsopsRole: String(role || '').trim().slice(0, 30) || null,
    teams: ['warehouse'],
    admin: false,
    channel: 'rsops'
  };
}

export const byWho = (person) => ({ email: person.email || null, name: person.name || null });
