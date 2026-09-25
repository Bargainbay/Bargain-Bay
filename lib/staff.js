// Who works here, and what they can reach — in the database, so hiring or
// firing somebody stops requiring a redeploy.
//
// WHY THE ENVIRONMENT VARIABLES STAY. ADMIN_EMAILS and SALES_EMAILS are not
// replaced by this and must not be. They are read synchronously from the
// environment, they cannot be broken by a database problem, and they are what
// guarantees the owner can always get in — including to fix whatever has gone
// wrong with this table. This is ADDITIVE: a grant here is a second way in, and
// never the only way in.
//
// WHY THIS CACHE EXISTS, WHICH IS THE INTERESTING PART.
//
// `isAdmin(session)` has 101 call sites and `isStaff` another 28. Making them
// async would mean touching all 129 — and an unawaited `isAdmin()` returns a
// PROMISE, which is truthy, so every missed `await` is a silent authorisation
// bypass that reads like working code. In plain JavaScript with a linter that
// only checks no-undef, there is nothing to catch one. That is not a trade
// worth taking for a feature whose purpose is convenience.
//
// So the checks stay SYNCHRONOUS and read a module-level cache of the table,
// refreshed in the background. What that costs is precision on revocation:
//
//   · A GRANT is live everywhere within STAFF_TTL_MS.
//   · A REVOCATION is live on the instance that performed it immediately, and
//     everywhere else within STAFF_TTL_MS. Serverless gives each instance its
//     own memory — the same caveat lib/antifraud documents for rate limits.
//   · If the database is unreachable, table grants stop working and the
//     environment lists keep working. It fails CLOSED for this table and the
//     owner is never locked out.
//
// Thirty seconds of residual access for somebody being revoked is not the
// threat this exists to fix. The threat is somebody who left in March still
// having admin in June because nobody wanted to redeploy to remove them.
import { hasDb, query } from './db';
import { captureError } from './observe';

export const ROLES = ['admin', 'sales'];
export const STAFF_TTL_MS = 30_000;

// email -> Set(role). Empty until the first load, which is why the environment
// lists are checked FIRST by lib/auth and never depend on this.
let cache = new Map();
let loadedAt = 0;
let inFlight = null;

const norm = (e) => String(e || '').trim().toLowerCase();

/** Read the live grants into the cache. Safe to call concurrently. */
export function refreshStaff({ force = false } = {}) {
  if (!hasDb()) { cache = new Map(); loadedAt = Date.now(); return Promise.resolve(cache); }
  if (inFlight) return inFlight;
  if (!force && Date.now() - loadedAt < STAFF_TTL_MS) return Promise.resolve(cache);

  inFlight = query(
    `SELECT lower(email) AS email, role FROM staff_access WHERE revoked_at IS NULL`
  ).then(({ rows }) => {
    const next = new Map();
    for (const r of rows) {
      if (!next.has(r.email)) next.set(r.email, new Set());
      next.get(r.email).add(r.role);
    }
    cache = next;
    loadedAt = Date.now();
    return cache;
  }).catch((e) => {
    // Deliberately does NOT clear the cache. A blip should not sign everybody
    // out; a sustained outage means the cache goes stale and, eventually,
    // table-granted access stops — which is the right way round.
    captureError(e, { tags: { where: 'staff' }, fingerprint: 'staff:load-failed' }).catch(() => {});
    loadedAt = Date.now(); // back off rather than hammering a broken database
    return cache;
  }).finally(() => { inFlight = null; });

  return inFlight;
}

/**
 * The roles this email has been granted IN THE TABLE. Synchronous.
 *
 * Reads the cache and kicks off a refresh if it is stale, so the answer may be
 * up to STAFF_TTL_MS old. Never throws, never blocks.
 */
export function grantedRoles(email) {
  const key = norm(email);
  if (!key) return new Set();
  if (Date.now() - loadedAt >= STAFF_TTL_MS) refreshStaff().catch(() => {});
  return cache.get(key) || new Set();
}

export const hasGrantedRole = (email, role) => grantedRoles(email).has(role);

// ---- writing -------------------------------------------------------------

export async function grantRole({ email, role, note, by }) {
  if (!hasDb()) throw new Error('Database not configured.');
  const key = norm(email);
  if (!key || !key.includes('@')) throw new Error('Enter a valid email address.');
  if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}".`);

  // ON CONFLICT against the partial unique index: re-granting somebody who
  // already has it is a no-op rather than an error, because the person doing it
  // is usually not sure whether they already did.
  const { rows } = await query(
    `INSERT INTO staff_access (email, role, note, granted_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (lower(email), role) WHERE revoked_at IS NULL DO NOTHING
     RETURNING id`,
    [key, role, String(note || '').slice(0, 500) || null, by || null]
  );
  await refreshStaff({ force: true });
  return { ok: true, email: key, role, created: rows.length > 0 };
}

export async function revokeRole({ email, role, by }) {
  if (!hasDb()) throw new Error('Database not configured.');
  const key = norm(email);
  const { rowCount } = await query(
    `UPDATE staff_access SET revoked_at = now(), revoked_by = $3
      WHERE lower(email) = $1 AND role = $2 AND revoked_at IS NULL`,
    [key, role, by || null]
  );
  // Immediate on THIS instance; within STAFF_TTL_MS everywhere else.
  await refreshStaff({ force: true });
  return { ok: true, revoked: rowCount };
}

/**
 * Every grant, live and historical, newest first.
 *
 * The revoked ones are included on purpose: "who had admin, between which
 * dates, and who let them in" is exactly what gets asked afterwards.
 */
export async function listStaffAccess({ includeRevoked = true } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, email, role, note, granted_by, granted_at, revoked_by, revoked_at
       FROM staff_access
      ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'}
      ORDER BY revoked_at IS NOT NULL, granted_at DESC
      LIMIT 500`
  ).catch(() => ({ rows: [] }));
  return rows;
}
