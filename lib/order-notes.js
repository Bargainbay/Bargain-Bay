// Internal notes on an order or a delivery stop, and "extras".
//
// A note is for the next person who handles this customer — a different rep, a
// different driver — and is NEVER shown to the customer. An extra is a note that
// says the crew did something that was not on the job (carried it up three
// flights, removed a door, hooked up a dryer vent): it is what the office needs
// in front of it when deciding whether to adjust the bill, so open extras are
// listed on the dispatch board until somebody marks them billed.
//
// Keyed on the order AND/OR the job. A stop with a Bargain Bay order behind it
// stores both, so the note shows on the order board and on the stop; a stop for
// an external client has no order and carries job_id alone.
//
// Append-only. Author is stamped from the session, never the request body.
// Every read soft-fails to "no notes" so a missing table can't take a board down.
import { query, hasDb } from './db';

const MAX_LEN = 1000;
const KINDS = ['note', 'extra'];

const shape = (r) => ({
  id: r.id,
  orderId: r.order_id || null,
  jobId: r.job_id || null,
  kind: r.kind,
  body: r.body,
  author: r.author_name || r.author || '',
  role: r.author_role,
  at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  billedAt: r.billed_at instanceof Date ? r.billed_at.toISOString() : (r.billed_at || null),
  billedBy: r.billed_by || null
});

// Tie a note to the order behind a stop, so it shows on both.
async function orderOfJob(jobId) {
  const { rows } = await query('SELECT order_id FROM jobs WHERE id = $1', [Number(jobId)]);
  if (!rows.length) throw new Error('That stop does not exist.');
  return rows[0].order_id || null;
}

export async function addNote({ orderId, jobId, kind = 'note', body, by, role = 'staff' }) {
  if (!hasDb()) throw new Error('Database not configured.');
  if (!KINDS.includes(kind)) throw new Error('Unknown note type.');
  const text = String(body || '').trim();
  if (!text) throw new Error('Write the note first.');
  if (text.length > MAX_LEN) throw new Error(`Keep it under ${MAX_LEN} characters.`);
  let oid = orderId ? Number(orderId) : null;
  const jid = jobId ? Number(jobId) : null;
  if (!oid && !jid) throw new Error('Which order or stop is this about?');
  if (jid && !oid) oid = await orderOfJob(jid);
  const { rows } = await query(
    `INSERT INTO order_notes (order_id, job_id, kind, body, author, author_name, author_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [oid, jid, kind, text, by?.email || null, by?.name || by?.email || null, role === 'driver' ? 'driver' : 'staff']
  );
  return shape(rows[0]);
}

// Everything said about an order or stop, oldest first. A stop's view includes
// notes on its order (written by sales) and the order's includes its stops'.
export async function listNotes({ orderId, jobId }) {
  if (!hasDb()) return [];
  try {
    let oid = orderId ? Number(orderId) : null;
    const jid = jobId ? Number(jobId) : null;
    if (jid && !oid) oid = await orderOfJob(jid).catch(() => null);
    const { rows } = await query(
      `SELECT * FROM order_notes
        WHERE ($1::int IS NOT NULL AND order_id = $1) OR ($2::int IS NOT NULL AND job_id = $2)
        ORDER BY created_at, id`, [oid, jid]);
    return rows.map(shape);
  } catch { return []; }
}

// Every note on each stop (its own + its order's), for the dispatch cards, which
// show them inline ahead of the Actions button. Newest last.
export async function notesForJobs(jobIds) {
  const ids = (jobIds || []).map(Number).filter(Boolean);
  if (!hasDb() || !ids.length) return {};
  try {
    const { rows } = await query(
      `SELECT j.id AS for_job, n.*
         FROM jobs j
         JOIN order_notes n ON n.job_id = j.id OR (j.order_id IS NOT NULL AND n.order_id = j.order_id)
        WHERE j.id = ANY($1::int[])
        ORDER BY n.created_at, n.id`, [ids]);
    const out = {};
    for (const r of rows) (out[r.for_job] ||= []).push(shape(r));
    return out;
  } catch { return {}; }
}

// Counts for the board's cards: { [jobId]: { notes, extras } } — extras = unbilled.
export async function noteCountsForJobs(jobIds) {
  const ids = (jobIds || []).map(Number).filter(Boolean);
  if (!hasDb() || !ids.length) return {};
  try {
    const { rows } = await query(
      `SELECT j.id AS job_id,
              count(n.id) AS notes,
              count(n.id) FILTER (WHERE n.kind = 'extra' AND n.billed_at IS NULL) AS extras
         FROM jobs j
         JOIN order_notes n ON n.job_id = j.id OR (j.order_id IS NOT NULL AND n.order_id = j.order_id)
        WHERE j.id = ANY($1::int[])
        GROUP BY j.id`, [ids]);
    return Object.fromEntries(rows.map((r) => [r.job_id, { notes: Number(r.notes), extras: Number(r.extras) }]));
  } catch { return {}; }
}

// Open extras, newest first, with enough about the stop to act on without
// opening it. Not scoped to the day on screen — an extra written on Friday is
// billed on Monday.
export async function openExtras({ limit = 100 } = {}) {
  if (!hasDb()) return [];
  try {
    const { rows } = await query(
      `SELECT n.*, j.job_number, j.customer_name, j.job_date, o.order_number,
              COALESCE(o.name, j.customer_name) AS customer
         FROM order_notes n
         LEFT JOIN jobs j   ON j.id = n.job_id
         LEFT JOIN orders o ON o.id = COALESCE(n.order_id, j.order_id)
        WHERE n.kind = 'extra' AND n.billed_at IS NULL
        ORDER BY n.created_at DESC, n.id DESC LIMIT $1`, [limit]);
    return rows.map((r) => ({
      ...shape(r),
      jobNumber: r.job_number || null,
      orderNumber: r.order_number || null,
      customer: r.customer || '',
      jobDate: r.job_date ? (r.job_date instanceof Date ? r.job_date.toISOString().slice(0, 10) : String(r.job_date).slice(0, 10)) : null
    }));
  } catch { return []; }
}

// Billing handled (or put back). Only extras carry a billed state.
export async function setBilled(noteId, billed, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query(
    `UPDATE order_notes
        SET billed_at = CASE WHEN $2 THEN COALESCE(billed_at, now()) ELSE NULL END,
            billed_by = CASE WHEN $2 THEN $3 ELSE NULL END
      WHERE id = $1 AND kind = 'extra' RETURNING *`,
    [Number(noteId), !!billed, by?.name || by?.email || null]);
  if (!rows.length) throw new Error('That extra was not found.');
  return shape(rows[0]);
}
