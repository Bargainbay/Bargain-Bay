// What the team assistant remembers: a conversation per person, and the actions
// it has read back and is waiting for a yes on.
//
// THE CONFIRMATION IS ENFORCED HERE, NOT IN THE PROMPT. A write the assistant
// wants to make is stored as PENDING with the id of the request that proposed
// it, and `takeAction` refuses to run it from that same request. So the only way
// a unit moves or a stop is marked arrived is a second message from the person —
// the read-back has to have been heard and answered. A model that decides to
// "confirm" its own proposal in one breath gets an error back, not a done job.
// A misheard SKU on a warehouse floor is a fridge in the wrong lane; a misheard
// stop is a customer told a van has arrived when it hasn't.
import { hasDb, query } from '../db';

let _schema = null;
export function ensureAssistantSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS assistant_threads (
        id          bigserial PRIMARY KEY,
        person_key  text NOT NULL,
        person_name text,
        channel     text,
        lang        text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_threads_person ON assistant_threads (person_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS assistant_messages (
        id         bigserial PRIMARY KEY,
        thread_id  bigint NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
        role       text NOT NULL,
        content    text NOT NULL,
        lang       text,
        via        text,
        actions    jsonb,
        at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread ON assistant_messages (thread_id, id);
      CREATE TABLE IF NOT EXISTS assistant_pending (
        id          text PRIMARY KEY,
        person_key  text NOT NULL,
        thread_id   bigint,
        request_id  text NOT NULL,
        tool        text NOT NULL,
        input       jsonb NOT NULL,
        readback    text NOT NULL,
        status      text NOT NULL DEFAULT 'pending',
        result      jsonb,
        created_at  timestamptz NOT NULL DEFAULT now(),
        decided_at  timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_pending_thread ON assistant_pending (thread_id, status);
      CREATE TABLE IF NOT EXISTS assistant_prefs (
        person_key text PRIMARY KEY,
        banter     boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// A conversation goes quiet after a few hours and the next question starts a
// fresh one. "Move it to L3" at 4pm must not be read against a unit somebody
// talked about at 9am.
const THREAD_IDLE_HOURS = 4;
// How long a read-back stays answerable. Long enough to put a fridge down and
// say yes; short enough that a stray "yes" tomorrow can't set it off.
export const PENDING_MINUTES = 10;
// History sent back to the model. Context for the next turn, not a recording —
// the tables are the record.
const HISTORY_TURNS = 24;

export async function openThread(person, threadId, { channel, lang } = {}) {
  await ensureAssistantSchema();
  const id = Number(threadId);
  if (id) {
    const { rows } = await query(
      `UPDATE assistant_threads SET updated_at = now(), lang = COALESCE($3, lang)
        WHERE id = $1 AND person_key = $2
          AND updated_at > now() - make_interval(hours => $4::int)
        RETURNING id, lang`,
      [id, person.key, lang || null, THREAD_IDLE_HOURS]
    );
    if (rows.length) return rows[0];
  }
  const { rows } = await query(
    `INSERT INTO assistant_threads (person_key, person_name, channel, lang)
     VALUES ($1,$2,$3,$4) RETURNING id, lang`,
    [person.key, person.name || null, channel || null, lang || null]
  );
  return rows[0];
}

export async function loadHistory(threadId) {
  const { rows } = await query(
    `SELECT role, content FROM (
       SELECT id, role, content FROM assistant_messages
        WHERE thread_id = $1 ORDER BY id DESC LIMIT $2
     ) x ORDER BY id`,
    [Number(threadId), HISTORY_TURNS]
  );
  const out = rows.map((r) => ({ role: r.role, content: r.content }));
  // The API wants a user turn first; a window that starts mid-exchange drops
  // the orphaned reply rather than inventing a question for it.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export async function recentMessages(person, threadId, limit = 40) {
  await ensureAssistantSchema();
  const { rows } = await query(
    `SELECT m.role, m.content, m.lang, m.at FROM assistant_messages m
       JOIN assistant_threads t ON t.id = m.thread_id
      WHERE m.thread_id = $1 AND t.person_key = $2
      ORDER BY m.id DESC LIMIT $3`,
    [Number(threadId), person.key, limit]
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.content, lang: r.lang, at: r.at?.toISOString?.() || null }));
}

export async function appendMessage(threadId, { role, content, lang = null, via = null, actions = null }) {
  const text = String(content || '').trim();
  if (!text) return;
  await query(
    `INSERT INTO assistant_messages (thread_id, role, content, lang, via, actions) VALUES ($1,$2,$3,$4,$5,$6)`,
    [Number(threadId), role, text.slice(0, 8000), lang, via, actions && actions.length ? JSON.stringify(actions) : null]
  );
}

// Record a write the assistant wants to make. Anything still waiting in this
// conversation is superseded: on a voice channel there is one question on the
// table at a time, and "yes" must only ever mean the one just asked.
export async function proposeAction({ person, threadId, requestId, tool, input, readback }) {
  const id = `act_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  await query(
    `UPDATE assistant_pending SET status = 'superseded', decided_at = now()
      WHERE thread_id = $1 AND person_key = $2 AND status = 'pending'`,
    [Number(threadId), person.key]
  );
  await query(
    `INSERT INTO assistant_pending (id, person_key, thread_id, request_id, tool, input, readback)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, person.key, Number(threadId), requestId, tool, JSON.stringify(input || {}), readback]
  );
  return id;
}

export async function openPending(person, threadId) {
  if (!threadId) return [];
  await ensureAssistantSchema();
  const { rows } = await query(
    `SELECT id, tool, readback, request_id FROM assistant_pending
      WHERE thread_id = $1 AND person_key = $2 AND status = 'pending'
        AND created_at > now() - make_interval(mins => $3::int)
      ORDER BY created_at DESC`,
    [Number(threadId), person.key, PENDING_MINUTES]
  );
  return rows;
}

// Claim a pending action for running. Atomic, so two taps on "Yes" run it once.
// Returns { action } or { error } naming why it can't run.
export async function takeAction({ person, id, requestId }) {
  const { rows } = await query(
    `UPDATE assistant_pending SET status = 'running', decided_at = now()
      WHERE id = $1 AND person_key = $2 AND status = 'pending'
        AND request_id <> $3
        AND created_at > now() - make_interval(mins => $4::int)
      RETURNING id, tool, input, readback`,
    [String(id || ''), person.key, requestId, PENDING_MINUTES]
  );
  if (rows.length) return { action: rows[0] };
  const { rows: why } = await query(
    'SELECT status, request_id, created_at FROM assistant_pending WHERE id = $1 AND person_key = $2',
    [String(id || ''), person.key]
  );
  const r = why[0];
  if (!r) return { error: 'There is no action with that id waiting for this person.' };
  if (r.request_id === requestId) {
    return { error: 'NOT DONE. You proposed this in this same turn — read it back and wait for the person to answer before confirming.' };
  }
  if (r.status !== 'pending') return { error: `That action is already ${r.status}.` };
  return { error: `That read-back is more than ${PENDING_MINUTES} minutes old. Propose it again so they hear it fresh.` };
}

export async function finishAction(id, { ok, result }) {
  await query(
    `UPDATE assistant_pending SET status = $2, result = $3 WHERE id = $1`,
    [id, ok ? 'done' : 'failed', JSON.stringify(result || null)]
  );
}

export async function cancelAction({ person, id }) {
  const { rowCount } = await query(
    `UPDATE assistant_pending SET status = 'cancelled', decided_at = now()
      WHERE id = $1 AND person_key = $2 AND status = 'pending'`,
    [String(id || ''), person.key]
  );
  return rowCount > 0;
}

// How the driver wants to be talked to. Banter is ON by default — it is what
// the owner asked for — and a driver who would rather it just answered can
// switch it off from their own phone. Per person, not a global setting: one
// driver's taste is not another's.
export async function getBanter(person) {
  if (!person?.teams?.includes('driver')) return false;
  try {
    const { rows } = await query('SELECT banter FROM assistant_prefs WHERE person_key = $1', [person.key]);
    return rows.length ? !!rows[0].banter : true;
  } catch {
    return true;
  }
}

export async function setBanter(person, on) {
  await ensureAssistantSchema();
  await query(
    `INSERT INTO assistant_prefs (person_key, banter) VALUES ($1, $2)
     ON CONFLICT (person_key) DO UPDATE SET banter = EXCLUDED.banter, updated_at = now()`,
    [person.key, !!on]
  );
  return !!on;
}
