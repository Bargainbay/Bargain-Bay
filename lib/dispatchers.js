// The dispatch coordinator — the person who runs deliveries all day and touches
// nothing else in this business.
//
// WHY THIS IS NOT A NEW ENV VAR. ADMIN_EMAILS / SALES_EMAILS are fine for the
// owner and the people selling, whose access outlives any one month. A dispatch
// coordinator is a hire: they start on a Monday, they might not last the month,
// and the day they leave their access has to stop the same hour — not after a
// redeploy. Same reasoning as accountant_access (lib/accountants.js), and the
// same shape, including the part that matters later: the row records who let
// them in and when, and revoking keeps the row.
//
// WHAT THEY GET (the owner's decision, 2026-09-09): everything on the dispatch
// page — the board, stops, drivers, imports, run sheets, PODs, service tickets,
// what a job charges, what a driver is paid, the delivery P&L, running costs,
// cash the driver collected, and the weekly client invoice. Inside dispatch they
// are an admin.
//
// WHAT THEY DO NOT GET, and this is the whole point: they are NOT staff. They
// are not on isStaff and not on isAdmin, so every other surface in this app —
// the storefront orders, quotes, customer invoices, payroll, marketing,
// campaigns, coupons, operations, the books, the admin search box — refuses them
// without knowing this role exists. Access is granted by ADDING dispatch, never
// by widening isStaff. If you are ever tempted to put a coordinator in
// SALES_EMAILS to fix something, you have just handed them the sales portal.
//
// Granting access is itself NOT a dispatch operation: only an admin can add or
// remove a coordinator. A coordinator cannot appoint another one.
import { query, hasDb } from './db';
import { normalizeEmail } from './auth';

let ensured = null;
function ensureDispatcherSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!ensured) {
    ensured = query(`
      CREATE TABLE IF NOT EXISTS dispatch_access (
        email      text PRIMARY KEY,
        name       text,
        note       text,
        granted_by text,
        granted_at timestamptz NOT NULL DEFAULT now(),
        -- Revoking sets this rather than deleting the row. Who had the board,
        -- and when, is exactly what somebody asks about after a bad week.
        revoked_at timestamptz,
        revoked_by text
      );
      -- When they finished the walkthrough. Per PERSON, in the database, and
      -- deliberately NOT in the browser: the warehouse machine is shared and
      -- signed in and out all day (which is why this portal has a Sign out
      -- button at all), so localStorage would hide the tour from whoever sat
      -- down next and show it to her again the first time she opened the board
      -- on her own phone. NULL means they have not been walked through it yet.
      ALTER TABLE dispatch_access ADD COLUMN IF NOT EXISTS tour_seen_at timestamptz;
    `).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export async function listDispatchers() {
  if (!hasDb()) return [];
  await ensureDispatcherSchema();
  const { rows } = await query('SELECT * FROM dispatch_access ORDER BY revoked_at NULLS FIRST, granted_at DESC');
  return rows.map((r) => ({
    email: r.email,
    name: r.name || '',
    note: r.note || '',
    grantedBy: r.granted_by || null,
    grantedAt: r.granted_at ? r.granted_at.toISOString() : null,
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    revokedBy: r.revoked_by || null,
    active: !r.revoked_at
  }));
}

// Re-granting someone previously revoked clears the revocation rather than
// failing on the primary key — a coordinator comes back from leave, or the
// shared dispatch@ mailbox is handed to the next hire.
export async function grantDispatcher({ email, name, note, by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDispatcherSchema();
  const e = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Enter a valid email address.');
  await query(
    `INSERT INTO dispatch_access (email, name, note, granted_by)
       VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, dispatch_access.name),
       note = COALESCE(EXCLUDED.note, dispatch_access.note),
       granted_by = EXCLUDED.granted_by,
       granted_at = now(),
       revoked_at = NULL,
       revoked_by = NULL`,
    [e, String(name || '').trim() || null, String(note || '').trim() || null,
     normalizeEmail(by) || null]
  );
  return e;
}

export async function revokeDispatcher(email, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDispatcherSchema();
  const e = normalizeEmail(email);
  await query(
    'UPDATE dispatch_access SET revoked_at = now(), revoked_by = $2 WHERE email = $1 AND revoked_at IS NULL',
    [e, normalizeEmail(by) || null]
  );
  return e;
}

// Checked on every request to every dispatch surface, so it must fail CLOSED and
// must never throw the board down: no database, no coordinator.
//
// Returns the tour flag in the SAME read that answers "are they a coordinator",
// because the board asks this on every single request and a second round trip to
// find out whether to show a welcome card would be a query per page view for a
// thing that is true once in a person's life.
export async function dispatcherState(session) {
  const e = normalizeEmail(session?.email);
  if (!e || !hasDb()) return { active: false, tourSeen: true };
  try {
    await ensureDispatcherSchema();
    const { rows } = await query(
      'SELECT tour_seen_at FROM dispatch_access WHERE email = $1 AND revoked_at IS NULL LIMIT 1', [e]
    );
    if (!rows.length) return { active: false, tourSeen: true };
    return { active: true, tourSeen: !!rows[0].tour_seen_at };
  } catch {
    // Same failure shape as before: no answer means not a coordinator. tourSeen
    // is true on the way out so a database blip can never greet the owner with
    // a walkthrough he has run the shop without for a year.
    return { active: false, tourSeen: true };
  }
}

export async function isDispatcher(session) {
  return (await dispatcherState(session)).active;
}

// They have been walked through it. Only ever moves forward, and only ever for
// the person whose session is making the request — the email is never read off
// the request body, the same rule invoices.created_by follows, or one person
// could mark the walkthrough done for somebody who has not seen it.
export async function markTourSeen(session) {
  const e = normalizeEmail(session?.email);
  if (!e || !hasDb()) return false;
  try {
    await ensureDispatcherSchema();
    await query(
      'UPDATE dispatch_access SET tour_seen_at = now() WHERE email = $1 AND tour_seen_at IS NULL', [e]
    );
    return true;
  } catch {
    // Not worth failing the request over: the worst case is she is offered the
    // walkthrough again tomorrow, and it closes on one click.
    return false;
  }
}
