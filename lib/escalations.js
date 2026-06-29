// Pending escalations: a manager couldn't decide → Sarah asked the owners in the
// Management group → their reply is relayed back to the origin chat and (if
// auto-learn is on) saved to the playbook. Self-provisioning table.
import { query, hasDb } from './db';

let ensured = null;
async function ensure() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = query(`CREATE TABLE IF NOT EXISTS escalations (
    id serial PRIMARY KEY,
    origin_chat_id text,
    dept text,
    question text NOT NULL,
    mgmt_message_id text,
    status text NOT NULL DEFAULT 'open',
    answer text,
    created_at timestamptz DEFAULT now(),
    answered_at timestamptz
  )`).catch((e) => { ensured = null; throw e; });
  return ensured;
}

export async function createEscalation({ originChatId, dept, question, mgmtMessageId }) {
  if (!hasDb()) return null;
  await ensure();
  const { rows } = await query(
    'INSERT INTO escalations (origin_chat_id, dept, question, mgmt_message_id) VALUES ($1,$2,$3,$4) RETURNING id',
    [originChatId ? String(originChatId) : null, dept || null, question, mgmtMessageId ? String(mgmtMessageId) : null]
  );
  return rows[0].id;
}

// Find the open escalation the owner is replying to (by the management message id).
export async function openEscalationByMessage(mgmtMessageId) {
  if (!hasDb() || !mgmtMessageId) return null;
  try {
    await ensure();
    const { rows } = await query(
      "SELECT * FROM escalations WHERE mgmt_message_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1",
      [String(mgmtMessageId)]
    );
    return rows[0] || null;
  } catch { return null; }
}

export async function resolveEscalation(id, answer) {
  if (!hasDb()) return;
  await ensure();
  await query("UPDATE escalations SET status = 'answered', answer = $2, answered_at = now() WHERE id = $1", [id, answer]);
}
