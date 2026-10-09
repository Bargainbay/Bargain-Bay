// The change log: who did what to a price, an invoice, an order.
//
// APPEND-ONLY and BEST-EFFORT. It never throws and never blocks the action it
// describes: a failed log write must not fail a refund the customer is standing at
// the counter waiting on. The cost of that choice is that a logging outage leaves a
// gap, so a failed write is reported (lib/observe) rather than swallowed.
//
// The ACTOR is taken from the session by the caller, never from the request body —
// the same rule as invoices.created_by. If there is no session the entry is written
// as 'unknown' rather than not at all: an anonymous change is the one most worth
// seeing.
import { query, hasDb } from './db';
import { captureError } from './observe';

export async function audit(session, { action, entity, entityId = null, summary = null, detail = null }) {
  if (!hasDb()) return false;
  try {
    await query(
      `INSERT INTO audit_log (actor, actor_name, action, entity, entity_id, summary, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [String(session?.email || 'unknown').toLowerCase(), session?.name || null, action, entity,
       entityId == null ? null : String(entityId), summary ? String(summary).slice(0, 500) : null,
       detail ? JSON.stringify(detail) : null]
    );
    return true;
  } catch (e) {
    await captureError(e, { tags: { where: 'audit.write', action } }).catch(() => {});
    return false;
  }
}

export async function listAudit({ q = '', entity = '', actor = '', limit = 200, offset = 0 } = {}) {
  if (!hasDb()) return { rows: [], total: 0 };
  const where = []; const p = [];
  if (entity) { p.push(entity); where.push(`entity = $${p.length}`); }
  if (actor) { p.push(String(actor).toLowerCase()); where.push(`actor = $${p.length}`); }
  if (q) { p.push(`%${q}%`); where.push(`(entity_id ILIKE $${p.length} OR summary ILIKE $${p.length} OR action ILIKE $${p.length})`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const { rows } = await query(
    `SELECT id, at, actor, actor_name, action, entity, entity_id, summary, detail FROM audit_log ${w}
      ORDER BY at DESC, id DESC LIMIT ${lim} OFFSET ${Math.max(Number(offset) || 0, 0)}`, p);
  const t = await query(`SELECT count(*)::int AS n FROM audit_log ${w}`, p);
  return { rows, total: t.rows[0].n };
}
