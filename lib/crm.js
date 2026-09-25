// The CRM's working surface: what was said, and what happens next.
//
// lib/customers.js answers "who is this and what have they bought". This
// answers the two questions that make the record worth opening — and the second
// one is the whole point. Before this there was no way to write down "call them
// Thursday", which is the single thing a salesperson needs a CRM for.
//
// `customers.notes` remains, and is now the wrong place for anything time-bound:
// it is one blob with no author and no date, and the second person to edit it
// silently overwrites the first. Standing facts about somebody ("narrow
// staircase, use the side door") belong there. Everything that HAPPENED belongs
// here.
import { hasDb, query } from './db';
import { torontoToday } from './constants';

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'sms', 'visit', 'system'];

const clean = (v, max = 4000) => {
  const s = String(v == null ? '' : v).trim().slice(0, max);
  return s || null;
};

// ---------------------------------------------------------------------------
// What was said.

/**
 * Append one entry. APPEND-ONLY on purpose — a log that can be edited is a log
 * nobody can rely on when the question is what was actually promised. A
 * correction is a new entry.
 *
 * `at` is when it HAPPENED, which is not always when it was typed: a call
 * logged the next morning still happened yesterday.
 */
export async function logActivity({ customerId, kind = 'note', body, byEmail, byName, at } = {}) {
  if (!hasDb()) return null;
  const id = Number(customerId);
  const text = clean(body);
  if (!id || !text) return null;
  const k = ACTIVITY_KINDS.includes(kind) ? kind : 'note';

  const { rows } = await query(
    `INSERT INTO customer_activity (customer_id, kind, body, by_email, by_name, at)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now())) RETURNING id, at`,
    [id, k, text, clean(byEmail, 200), clean(byName, 200), at || null]
  );
  return rows[0] || null;
}

export async function customerActivity(customerId, { limit = 200 } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, kind, body, by_email, by_name, at
       FROM customer_activity WHERE customer_id = $1
      ORDER BY at DESC, id DESC LIMIT $2`,
    [Number(customerId), Math.min(Math.max(Number(limit) || 200, 1), 500)]
  ).catch(() => ({ rows: [] }));
  return rows;
}

// ---------------------------------------------------------------------------
// What happens next.

export async function addTask({ customerId, title, note, dueOn, ownerEmail, createdBy } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const id = Number(customerId);
  const t = clean(title, 300);
  if (!id) throw new Error('Which customer?');
  if (!t) throw new Error('What is the follow-up?');

  const { rows } = await query(
    `INSERT INTO customer_tasks (customer_id, title, note, due_on, owner_email, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, due_on`,
    [id, t, clean(note), dueOn || null, clean(ownerEmail, 200), clean(createdBy, 200)]
  );
  return rows[0];
}

/**
 * Close a task. `outcome` matters: a follow-up dropped on purpose and one that
 * was forgotten look identical without it.
 *
 * Completing also writes a line to the activity log, because "we said we would
 * ring them and we did" is exactly the thing the timeline should show — and it
 * is the one place a system-written entry is worth more than a typed one.
 */
export async function completeTask(taskId, { by, outcome, note } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query(
    `UPDATE customer_tasks
        SET done_at = now(), done_by = $2, outcome = $3
      WHERE id = $1 AND done_at IS NULL
      RETURNING id, customer_id, title`,
    [Number(taskId), clean(by, 200), clean(outcome, 200)]
  );
  if (!rows.length) return { ok: false, reason: 'already done, or no such follow-up' };

  const t = rows[0];
  await logActivity({
    customerId: t.customer_id,
    kind: 'system',
    body: `Follow-up done: ${t.title}${outcome ? ` — ${outcome}` : ''}${note ? `\n${note}` : ''}`,
    byEmail: by
  }).catch(() => {});
  return { ok: true, taskId: t.id };
}

export async function reopenTask(taskId, { by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query(
    `UPDATE customer_tasks SET done_at = NULL, done_by = NULL, outcome = NULL
      WHERE id = $1 AND done_at IS NOT NULL RETURNING id, customer_id, title`,
    [Number(taskId)]
  );
  if (!rows.length) return { ok: false };
  await logActivity({
    customerId: rows[0].customer_id, kind: 'system',
    body: `Follow-up reopened: ${rows[0].title}`, byEmail: by
  }).catch(() => {});
  return { ok: true };
}

export async function customerTasks(customerId, { includeDone = true } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, title, note, due_on, owner_email, created_by, created_at, done_at, done_by, outcome
       FROM customer_tasks
      WHERE customer_id = $1 ${includeDone ? '' : 'AND done_at IS NULL'}
      ORDER BY done_at IS NOT NULL, due_on NULLS LAST, id`,
    [Number(customerId)]
  ).catch(() => ({ rows: [] }));
  return rows;
}

/**
 * MY DAY — what is actually owed to somebody today.
 *
 * Three buckets, and the split is the point. Lumping them together produces a
 * list whose length means nothing: a run of overdue follow-ups reads the same
 * as a quiet Tuesday.
 *
 *   overdue  — due before today. Loudest, because this is the failure state.
 *   today    — due today.
 *   unowned  — nobody has picked it up. NOT hidden: an unowned follow-up is
 *              the one most likely to be forgotten, and a list scoped strictly
 *              to `me` would never show it to anybody.
 *
 * `soon` is deliberately NOT a bucket. A CRM that shows next week's work beside
 * today's is a CRM people stop reading.
 */
export async function myDay({ email, limit = 100 } = {}) {
  if (!hasDb()) return { overdue: [], today: [], unowned: [], counts: { overdue: 0, today: 0, unowned: 0 } };
  const me = clean(email, 200);
  const today = torontoToday();

  const { rows } = await query(
    `SELECT t.id, t.title, t.note, t.due_on, t.owner_email, t.created_by,
            -- BUCKETED IN SQL, not in JS. The driver hands a date column back
            -- as a Date object, and String(thatDate) is "Mon Sep 22 2026 ..."
            -- rather than an ISO date, so slicing ten characters off it and
            -- comparing put every OVERDUE follow-up in the today bucket --
            -- silently, which defeats the only reason the buckets exist.
            -- Postgres compares dates as dates.
            (t.due_on IS NOT NULL AND t.due_on < $2::date) AS is_overdue,
            c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
            c.phone AS customer_phone
       FROM customer_tasks t JOIN customers c ON c.id = t.customer_id
      WHERE t.done_at IS NULL
        AND (
          -- mine, due today or overdue
          (t.owner_email IS NOT NULL AND lower(t.owner_email) = lower($1) AND t.due_on IS NOT NULL AND t.due_on <= $2::date)
          -- or nobody's, whatever the date, including no date at all
          OR t.owner_email IS NULL
        )
      ORDER BY t.due_on NULLS LAST, t.id
      LIMIT $3`,
    [me || '', today, Math.min(Math.max(Number(limit) || 100, 1), 500)]
  ).catch(() => ({ rows: [] }));

  const overdue = [], todays = [], unowned = [];
  for (const r of rows) {
    if (!r.owner_email) unowned.push(r);
    else if (r.is_overdue) overdue.push(r);
    else todays.push(r);
  }
  return {
    overdue, today: todays, unowned,
    counts: { overdue: overdue.length, today: todays.length, unowned: unowned.length }
  };
}

/** Who a follow-up can be given to — the people already using the CRM. */
export async function taskOwners() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT DISTINCT lower(owner_email) AS email FROM customer_tasks
      WHERE owner_email IS NOT NULL ORDER BY 1 LIMIT 50`
  ).catch(() => ({ rows: [] }));
  return rows.map((r) => r.email);
}
